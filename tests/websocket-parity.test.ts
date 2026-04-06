import { request as httpRequest } from "node:http";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import keno from "../src";
import { startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("websocket parity features", () => {
  it("tracks connected clients and exposes negotiated extensions", async () => {
    const app = keno();

    app.ws(
      "/tracked",
      {
        perMessageDeflate: true,
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    expect(server.clients.size).toBe(0);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/tracked`, {
      perMessageDeflate: true,
    });

    await onceOpen(socket);
    expect(server.clients.size).toBe(1);

    const [client] = [...server.clients];
    expect(client?.extensions).toEqual({
      permessageDeflate: true,
    });

    await closeSocket(socket);
    await wait(10);
    expect(server.clients.size).toBe(0);
  });

  it("adds custom headers to successful upgrade responses", async () => {
    const app = keno();

    app.ws(
      "/headers",
      {
        headers: (request) => ({
          "x-keno-socket": request.path,
        }),
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/headers`);
    const upgraded = onceUpgrade(socket);

    await onceOpen(socket);
    expect((await upgraded).headers["x-keno-socket"]).toBe("/headers");

    await closeSocket(socket);
  });

  it("drops unsafe custom handshake headers instead of writing them to the socket", async () => {
    const app = keno();

    app.ws(
      "/safe-headers",
      {
        headers: () => ({
          "x-keno-safe": "ok",
          "x-keno-unsafe": "bad\r\nx-injected: nope",
        }),
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/safe-headers`);
    const upgraded = onceUpgrade(socket);

    await onceOpen(socket);
    const response = await upgraded;

    expect(response.headers["x-keno-safe"]).toBe("ok");
    expect(response.headers["x-keno-unsafe"]).toBeUndefined();
    expect(response.headers["x-injected"]).toBeUndefined();

    await closeSocket(socket);
  });

  it("propagates verifyClient rejection headers", async () => {
    const app = keno();

    app.ws(
      "/restricted",
      {
        verifyClient: () => ({
          headers: {
            "retry-after": "15",
          },
          message: "slow down",
          ok: false,
          status: 429,
        }),
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await sendUpgradeRequest(port, "/restricted");

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("15");
    expect(response.body).toBe("slow down");
  });

  it("does not auto-reply with pong when autoPong is disabled", async () => {
    const app = keno();

    app.ws(
      "/manual-pong",
      {
        autoPong: false,
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/manual-pong`);

    await onceOpen(socket);
    socket.ping("probe");

    expect(await waitForPong(socket, 100)).toBeUndefined();

    await closeSocket(socket);
  });

  it("can pause and resume websocket reads explicitly", async () => {
    const app = keno();
    let wasPausedOnConnect = false;
    let wasPausedBeforeResume = false;
    let wasPausedAfterResume = true;

    app.ws("/paused", (socket) => {
      socket.pause();
      wasPausedOnConnect = socket.isPaused;

      setTimeout(() => {
        wasPausedBeforeResume = socket.isPaused;
        socket.resume();
        wasPausedAfterResume = socket.isPaused;
      }, 50);

      socket.on("text", (message) => {
        socket.sendText(message);
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/paused`);
    await onceOpen(socket);

    const startedAt = Date.now();
    const echo = onceMessage(socket);
    socket.send("held");

    expect(await echo).toBe("held");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(wasPausedOnConnect).toBe(true);
    expect(wasPausedBeforeResume).toBe(true);
    expect(wasPausedAfterResume).toBe(false);

    await closeSocket(socket);
  });

  it("advertises websocket version 13 on invalid handshake versions", async () => {
    const app = keno();

    app.ws("/version", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await sendUpgradeRequest(port, "/version", {
      "sec-websocket-version": "12",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["sec-websocket-version"]).toBe("13");
  });
});

function onceMessage(socket: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handleMessage = (data: WebSocket.RawData) => {
      cleanup();
      resolve(Buffer.from(data as Buffer).toString("utf8"));
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before message: ${code} ${reason.toString("utf8")}`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      socket.off("message", handleMessage);
      socket.off("close", handleClose);
      socket.off("error", handleError);
    }

    socket.once("message", handleMessage);
    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before opening: ${code} ${reason.toString("utf8")}`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      socket.off("open", handleOpen);
      socket.off("close", handleClose);
      socket.off("error", handleError);
    }

    socket.once("open", handleOpen);
    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}

function onceUpgrade(socket: WebSocket): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve) => {
    socket.once("upgrade", resolve);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForPong(socket: WebSocket, timeoutMs: number): Promise<Buffer | undefined> {
  return await new Promise<Buffer | undefined>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, timeoutMs);

    const handlePong = (data: Buffer) => {
      cleanup();
      resolve(data);
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before pong: ${code} ${reason.toString("utf8")}`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      clearTimeout(timer);
      socket.off("pong", handlePong);
      socket.off("close", handleClose);
      socket.off("error", handleError);
    }

    socket.once("pong", handlePong);
    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleClose = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      socket.off("close", handleClose);
      socket.off("error", handleError);
    }

    socket.once("close", handleClose);
    socket.once("error", handleError);
    socket.close(1000, "done");
  });
}

function sendUpgradeRequest(
  port: number,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ body: string; headers: import("node:http").IncomingHttpHeaders; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        connection: "Upgrade",
        host: `127.0.0.1:${port}`,
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        ...extraHeaders,
      },
      hostname: "127.0.0.1",
      method: "GET",
      path,
      port,
    }, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          body,
          headers: response.headers,
          statusCode: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}
