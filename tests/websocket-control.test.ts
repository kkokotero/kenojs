import type { RawData } from "ws";

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

describe("websocket control and binary frames", () => {
  it("round-trips binary payloads", async () => {
    const app = keno();

    app.ws("/binary", (socket) => {
      socket.on("binary", (data) => {
        socket.sendBinary(data);
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/binary`);
    await onceOpen(socket);

    const received = onceMessage(socket);
    socket.send(Buffer.from([1, 2, 3, 4]));

    const message = await received;
    expect(Buffer.from(message)).toEqual(Buffer.from([1, 2, 3, 4]));

    await closeSocket(socket);
  });

  it("automatically answers ping frames with the same pong payload", async () => {
    const app = keno();

    app.ws("/control", () => {});

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/control`);
    await onceOpen(socket);

    const pong = oncePong(socket);
    socket.ping("probe");

    expect((await pong).toString("utf8")).toBe("probe");

    await closeSocket(socket);
  });
});

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

function onceMessage(socket: WebSocket): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const handleMessage = (data: RawData) => {
      cleanup();
      resolve(Buffer.from(data as Buffer));
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

function oncePong(socket: WebSocket): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
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
