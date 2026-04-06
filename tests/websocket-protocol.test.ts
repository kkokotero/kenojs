import { createConnection, type Socket } from "node:net";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("raw websocket protocol behavior", () => {
  it("reassembles fragmented text messages", async () => {
    const app = keno();

    app.ws("/fragments", (socket) => {
      socket.on("text", (message) => {
        socket.sendText(`echo:${message}`);
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/fragments");

    client.sendFrame(0x01, Buffer.from("hel"), { fin: false });
    client.sendFrame(0x00, Buffer.from("lo"));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x01);
    expect(frame.payload.toString("utf8")).toBe("echo:hello");

    await client.close();
  });

  it("rejects unmasked client frames with a protocol close", async () => {
    const app = keno();

    app.ws("/strict", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/strict");

    client.sendFrame(0x01, Buffer.from("a"), {
      mask: false,
    });

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects unexpected continuation frames", async () => {
    const app = keno();

    app.ws("/continuation", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/continuation");

    client.sendFrame(0x00, Buffer.from("orphan"));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects a new data frame while a fragmented message is in progress", async () => {
    const app = keno();

    app.ws("/fragment-race", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/fragment-race");

    client.sendFrame(0x01, Buffer.from("hel"), { fin: false });
    client.sendFrame(0x01, Buffer.from("lo"));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects fragmented control frames", async () => {
    const app = keno();

    app.ws("/control-fragment", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/control-fragment");

    client.sendFrame(0x09, Buffer.from("x"), { fin: false });

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects oversized control frames", async () => {
    const app = keno();

    app.ws("/control-size", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/control-size");

    client.sendFrame(0x09, Buffer.alloc(126, 0x61));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects close frames with a one-byte payload", async () => {
    const app = keno();

    app.ws("/close-payload", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/close-payload");

    client.sendFrame(0x08, Buffer.from([0x03]));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1002);

    await client.close();
  });

  it("rejects invalid UTF-8 text payloads by default", async () => {
    const app = keno();

    app.ws("/utf8-strict", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/utf8-strict");

    client.sendFrame(0x01, Buffer.from([0xc3, 0x28]));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x08);
    expect(readCloseCode(frame.payload)).toBe(1007);

    await client.close();
  });

  it("can skip UTF-8 validation for trusted text clients", async () => {
    const app = keno();

    app.ws(
      "/utf8-lenient",
      {
        skipUTF8Validation: true,
      },
      (socket) => {
        socket.on("text", (message) => {
          socket.sendText(message);
        });
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const client = await openRawWebSocket(port, "/utf8-lenient");

    client.sendFrame(0x01, Buffer.from([0xc3, 0x28]));

    const frame = await client.readFrame();
    expect(frame.opcode).toBe(0x01);
    expect(frame.payload.toString("utf8")).toBe("�(");

    await client.close();
  });
});

type RawServerFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
};

type RawWebSocketClient = {
  close: () => Promise<void>;
  headers: Record<string, string>;
  readFrame: () => Promise<RawServerFrame>;
  sendFrame: (
    opcode: number,
    payload: Buffer,
    options?: {
      fin?: boolean;
      mask?: boolean;
      rsv1?: boolean;
    },
  ) => void;
  socket: Socket;
  statusCode: number;
};

async function openRawWebSocket(port: number, path: string): Promise<RawWebSocketClient> {
  const socket = createConnection({
    host: "127.0.0.1",
    port,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  let buffer = Buffer.alloc(0);
  let ended = false;
  let error: Error | undefined;
  const waiters = new Set<() => void>();

  const notify = () => {
    for (const waiter of [...waiters]) {
      waiter();
    }
  };

  socket.on("data", (chunk) => {
    const nextChunk = Buffer.from(chunk);
    buffer = buffer.byteLength === 0 ? nextChunk : Buffer.concat([buffer, nextChunk]);
    notify();
  });
  socket.on("close", () => {
    ended = true;
    notify();
  });
  socket.on("error", (caught) => {
    error = caught;
    notify();
  });

  socket.write(
    [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"),
  );

  const responseBuffer = await waitForBuffer(() => {
    const boundary = buffer.indexOf("\r\n\r\n");

    if (boundary === -1) {
      return undefined;
    }

    const head = buffer.subarray(0, boundary);
    buffer = buffer.subarray(boundary + 4);
    return head;
  });

  const lines = responseBuffer.toString("utf8").split("\r\n");
  const statusLine = lines.shift() ?? "";
  const statusCode = Number.parseInt(statusLine.split(" ")[1] ?? "0", 10);
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
  }

  return {
    close: async () => {
      if (socket.destroyed) {
        return;
      }

      socket.destroy();
      await new Promise<void>((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }

        socket.once("close", () => {
          resolve();
        });
      });
    },
    headers,
    readFrame: async () => {
      return await waitForBuffer(() => {
        const parsed = parseServerFrame(buffer);

        if (!parsed) {
          return undefined;
        }

        buffer = buffer.subarray(parsed.consumed);
        return parsed.frame;
      });
    },
    sendFrame: (opcode, payload, options = {}) => {
      socket.write(buildClientFrame(opcode, payload, options));
    },
    socket,
    statusCode,
  };

  async function waitForBuffer<T>(read: () => T | undefined): Promise<T> {
    while (true) {
      const value = read();

      if (value !== undefined) {
        return value;
      }

      if (error) {
        throw error;
      }

      if (ended) {
        throw new Error("Socket closed before enough data arrived");
      }

      await new Promise<void>((resolve) => {
        const waiter = () => {
          waiters.delete(waiter);
          resolve();
        };

        waiters.add(waiter);
      });
    }
  }
}

function buildClientFrame(
  opcode: number,
  payload: Buffer,
  options: {
    fin?: boolean;
    mask?: boolean;
    rsv1?: boolean;
  } = {},
): Buffer {
  const fin = options.fin ?? true;
  const masked = options.mask ?? true;
  const rsv1 = options.rsv1 ?? false;
  const firstByte = opcode | (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  let header = Buffer.from([firstByte, masked ? 0x80 : 0x00]);

  if (payload.byteLength < 126) {
    header[1] = (masked ? 0x80 : 0x00) | payload.byteLength;
  } else if (payload.byteLength < 65_536) {
    header = Buffer.alloc(masked ? 4 : 4);
    header[0] = firstByte;
    header[1] = (masked ? 0x80 : 0x00) | 126;
    header.writeUInt16BE(payload.byteLength, 2);
  } else {
    header = Buffer.alloc(masked ? 10 : 10);
    header[0] = firstByte;
    header[1] = (masked ? 0x80 : 0x00) | 127;
    header.writeBigUInt64BE(BigInt(payload.byteLength), 2);
  }

  if (!masked) {
    return Buffer.concat([header, payload]);
  }

  const maskedPayload = Buffer.from(payload);

  for (let index = 0; index < maskedPayload.byteLength; index += 1) {
    const maskByte = mask[index % 4] ?? 0;
    const currentByte = maskedPayload[index] ?? 0;
    maskedPayload[index] = currentByte ^ maskByte;
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

function parseServerFrame(buffer: Buffer): { consumed: number; frame: RawServerFrame } | undefined {
  if (buffer.byteLength < 2) {
    return undefined;
  }

  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;
  const fin = (firstByte & 0x80) === 0x80;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) === 0x80;

  if (masked) {
    throw new Error("Server frames must not be masked");
  }

  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.byteLength < 4) {
      return undefined;
    }

    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.byteLength < 10) {
      return undefined;
    }

    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (buffer.byteLength < offset + payloadLength) {
    return undefined;
  }

  return {
    consumed: offset + payloadLength,
    frame: {
      fin,
      opcode,
      payload: buffer.subarray(offset, offset + payloadLength),
    },
  };
}

function readCloseCode(payload: Buffer): number | undefined {
  if (payload.byteLength < 2) {
    return undefined;
  }

  return payload.readUInt16BE(0);
}
