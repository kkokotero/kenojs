import { randomBytes } from "node:crypto";
import { connect } from "node:http2";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { messageData, onceEvent, readFixture, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("HTTP/2 and secure WebSocket support", () => {
  it("serves HTTP/2 requests and accepts WSS on the same secure listener", async () => {
    const app = keno();

    app.get("/health", (request, response) => {
      response.json({
        scheme: request.scheme,
        transport: request.transport,
      });
    });

    app.ws("/secure", (socket) => {
      socket.sendText("secure-ready");
    });

    const { port, server } = await startServer(app, {
      allowHTTP1: true,
      tls: {
        cert: readFixture("certificate.pem"),
        key: readFixture("key.pem"),
      },
      transport: "http2",
    });
    servers.push(server);

    const client = connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });

    const body = await new Promise<string>((resolve, reject) => {
      const stream = client.request({
        ":method": "GET",
        ":path": "/health",
      });

      let data = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        data += chunk;
      });
      stream.on("end", () => {
        resolve(data);
      });
      stream.on("error", reject);
      stream.end();
    });

    expect(JSON.parse(body)).toEqual({
      scheme: "https",
      transport: "http2s",
    });

    client.close();

    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    try {
      const socket = new WebSocket(`wss://127.0.0.1:${port}/secure`);
      const message = onceEvent<Event & { data: unknown }>(socket, "message");

      await onceEvent(socket, "open");
      expect(await messageData((await message).data)).toBe("secure-ready");

      socket.close(1000, "done");
      await onceEvent(socket, "close");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      }
    }
  });

  it("accepts WebSocket over HTTP/2 extended CONNECT without HTTP/1.1 fallback", async () => {
    const app = keno();

    app.ws(
      "/h2/socket",
      {
        perMessageDeflate: true,
      },
      (socket, request) => {
        socket.sendText(`ready:${request.transport}`);
        socket.on("text", (message) => {
          socket.sendText(`echo:${message}`);
        });
      },
    );

    const { port, server } = await startServer(app, {
      tls: {
        cert: readFixture("certificate.pem"),
        key: readFixture("key.pem"),
      },
      transport: "http2",
    });
    servers.push(server);

    const client = connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
      settings: {
        enableConnectProtocol: true,
      },
    });

    await onceRemoteSettings(client);

    const stream = client.request({
      ":authority": `127.0.0.1:${port}`,
      ":method": "CONNECT",
      ":path": "/h2/socket",
      ":protocol": "websocket",
      ":scheme": "https",
      "sec-websocket-extensions": "permessage-deflate",
      "sec-websocket-version": "13",
    });

    const responseHeaders = await onceResponse(stream);
    expect(responseHeaders[":status"]).toBe(200);
    expect(String(responseHeaders["sec-websocket-extensions"] ?? "")).toContain("permessage-deflate");

    const reader = createServerFrameReader(stream);
    expect((await reader()).payload.toString("utf8")).toBe("ready:http2s");

    stream.write(buildMaskedClientFrame(0x01, Buffer.from("hello-http2")));
    expect((await reader()).payload.toString("utf8")).toBe("echo:hello-http2");

    stream.write(buildMaskedClientFrame(0x08, buildClosePayload(1000, "done")));
    expect((await reader()).opcode).toBe(0x08);
    await onceEnd(stream);
    client.destroy();
    await onceClientClose(client);
  });
});

function onceRemoteSettings(client: ReturnType<typeof connect>): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("remoteSettings", () => {
      cleanup();
      resolve();
    });
    client.once("error", (error) => {
      cleanup();
      reject(error);
    });

    function cleanup(): void {
      client.off("error", reject);
    }
  });
}

function onceResponse(
  stream: ReturnType<typeof connect>["request"] extends (...args: any[]) => infer T ? T : never,
): Promise<Record<string, string | string[] | number>> {
  return new Promise((resolve, reject) => {
    stream.once("response", (headers) => {
      cleanup();
      resolve(headers as Record<string, string | string[] | number>);
    });
    stream.once("error", (error) => {
      cleanup();
      reject(error);
    });

    function cleanup(): void {
      stream.off("error", reject);
    }
  });
}

function onceEnd(
  stream: ReturnType<typeof connect>["request"] extends (...args: any[]) => infer T ? T : never,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleEnd = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      stream.off("end", handleEnd);
      stream.off("close", handleEnd);
      stream.off("error", handleError);
    }

    stream.once("end", handleEnd);
    stream.once("close", handleEnd);
    stream.once("error", handleError);
  });
}

function onceClientClose(client: ReturnType<typeof connect>): Promise<void> {
  return new Promise((resolve) => {
    client.once("close", () => {
      resolve();
    });
  });
}

function createServerFrameReader(
  stream: ReturnType<typeof connect>["request"] extends (...args: any[]) => infer T ? T : never,
): () => Promise<{ fin: boolean; opcode: number; payload: Buffer; rsv1: boolean }> {
  let buffer = Buffer.alloc(0);

  return () =>
    new Promise((resolve, reject) => {
      const existing = tryParseServerFrame(buffer);

      if (existing) {
        buffer = buffer.subarray(existing.consumed);
        resolve(existing.frame);
        return;
      }

      const handleData = (chunk: Buffer) => {
        buffer = buffer.byteLength === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
        const parsed = tryParseServerFrame(buffer);

        if (!parsed) {
          return;
        }

        cleanup();
        buffer = buffer.subarray(parsed.consumed);
        resolve(parsed.frame);
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      function cleanup(): void {
        stream.off("data", handleData);
        stream.off("error", handleError);
      }

      stream.on("data", handleData);
      stream.once("error", handleError);
    });
}

function buildMaskedClientFrame(
  opcode: number,
  payload: Buffer,
  fin = true,
  rsv1 = false,
): Buffer {
  let offset = 6;
  let payloadLength = payload.byteLength;

  if (payloadLength > 125 && payloadLength < 65_536) {
    offset += 2;
    payloadLength = 126;
  } else if (payloadLength >= 65_536) {
    offset += 8;
    payloadLength = 127;
  }

  const frame = Buffer.allocUnsafe(offset + payload.byteLength);
  const mask = randomBytes(4);
  frame[0] = opcode | (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0);
  frame[1] = payloadLength | 0x80;

  if (payloadLength === 126) {
    frame.writeUInt16BE(payload.byteLength, 2);
    mask.copy(frame, 4);
  } else if (payloadLength === 127) {
    frame.writeBigUInt64BE(BigInt(payload.byteLength), 2);
    mask.copy(frame, 10);
  } else {
    mask.copy(frame, 2);
  }

  payload.copy(frame, offset);

  for (let index = 0; index < payload.byteLength; index += 1) {
    const value = frame[offset + index];

    if (value === undefined) {
      continue;
    }

    frame[offset + index] = value ^ (mask[index % 4] ?? 0);
  }

  return frame;
}

function buildClosePayload(code: number, reason: string): Buffer {
  const reasonBuffer = Buffer.from(reason);
  const payload = Buffer.allocUnsafe(2 + reasonBuffer.byteLength);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  return payload;
}

function tryParseServerFrame(
  buffer: Buffer,
): { consumed: number; frame: { fin: boolean; opcode: number; payload: Buffer; rsv1: boolean } } | null {
  if (buffer.byteLength < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  if (firstByte === undefined || secondByte === undefined) {
    return null;
  }

  const fin = (firstByte & 0x80) === 0x80;
  const rsv1 = (firstByte & 0x40) === 0x40;
  const opcode = firstByte & 0x0f;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if ((secondByte & 0x80) === 0x80) {
    throw new Error("Server frames must not be masked");
  }

  if (payloadLength === 126) {
    if (buffer.byteLength < 4) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.byteLength < 10) {
      return null;
    }

    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (buffer.byteLength < offset + payloadLength) {
    return null;
  }

  return {
    consumed: offset + payloadLength,
    frame: {
      fin,
      opcode,
      payload: buffer.subarray(offset, offset + payloadLength),
      rsv1,
    },
  };
}
