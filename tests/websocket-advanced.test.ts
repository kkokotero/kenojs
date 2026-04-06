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

describe("advanced WebSocket behavior", () => {
  it("selects a configured subprotocol", async () => {
    const app = keno();

    app.ws(
      "/protocols",
      {
        protocols: ["json"],
      },
      (socket) => {
        socket.sendText("ready");
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/protocols`, ["chat", "json"]);

    await onceOpen(socket);
    expect(socket.protocol).toBe("json");
    await closeSocket(socket);
  });

  it("supports custom protocol negotiation", async () => {
    const app = keno();

    app.ws(
      "/custom-protocol",
      {
        handleProtocols: async (protocols) => {
          return protocols.has("chat.v2") ? "chat.v2" : false;
        },
      },
      (socket) => {
        socket.sendText("ready");
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/custom-protocol`, ["chat.v1", "chat.v2"]);

    await onceOpen(socket);
    expect(socket.protocol).toBe("chat.v2");
    await closeSocket(socket);
  });

  it("rejects clients through verifyClient", async () => {
    const app = keno();

    app.ws(
      "/restricted",
      {
        verifyClient: () => ({
          message: "Nope",
          ok: false,
          status: 401,
        }),
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await sendRawUpgradeRequest(port, "/restricted");

    expect(response.statusCode).toBe(401);
    expect(response.body).toBe("Nope");
  });

  it("closes sockets that exceed the configured payload limit", async () => {
    const app = keno();

    app.ws(
      "/limited",
      {
        maxPayload: 16,
      },
      () => {},
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/limited`);

    await onceOpen(socket);
    const closed = onceClose(socket);
    socket.send("x".repeat(128));

    const event = await closed;
    expect(event.code).toBe(1009);
  });
});

function sendRawUpgradeRequest(port: number, path: string): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        connection: "Upgrade",
        host: `127.0.0.1:${port}`,
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
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
          statusCode: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.end();
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

function onceClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
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
