import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import keno from "../src";
import { startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("WebSocket compression", () => {
  it("negotiates permessage-deflate and exchanges compressed messages", async () => {
    const app = keno();

    app.ws(
      "/compressed",
      {
        perMessageDeflate: {
          threshold: 256,
        },
      },
      (socket) => {
        socket.sendText("x".repeat(4096));
        socket.on("text", (message) => {
          socket.sendText(message);
        });
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/compressed`, {
      perMessageDeflate: {
        threshold: 1,
      },
    });

    await onceOpen(socket);
    expect(socket.extensions).toContain("permessage-deflate");

    expect(await onceMessage(socket)).toBe("x".repeat(4096));

    socket.send("y".repeat(4096));
    expect(await onceMessage(socket)).toBe("y".repeat(4096));

    await closeSocket(socket);
  });

  it("flushes queued compressed frames before closing the socket", async () => {
    const app = keno();

    app.ws(
      "/compressed-close",
      {
        perMessageDeflate: true,
      },
      (socket) => {
        socket.sendText(`first:${"a".repeat(4096)}`);
        socket.sendText(`second:${"b".repeat(4096)}`);
        socket.close(1000, "done");
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/compressed-close`, {
      perMessageDeflate: {
        threshold: 1,
      },
    });

    await onceOpen(socket);
    const closeEvent = onceClose(socket);

    expect(await onceMessage(socket)).toBe(`first:${"a".repeat(4096)}`);
    expect(await onceMessage(socket)).toBe(`second:${"b".repeat(4096)}`);

    const { code, reason } = await closeEvent;
    expect(code).toBe(1000);
    expect(reason).toBe("done");
  });

  it("reuses the compression state safely across many compressed echoes", async () => {
    const app = keno();

    app.ws(
      "/compressed-many",
      {
        perMessageDeflate: {
          concurrencyLimit: 1,
          threshold: 1,
        },
      },
      (socket) => {
        socket.on("text", (message) => {
          socket.sendText(`echo:${message}`);
        });
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/compressed-many`, {
      perMessageDeflate: {
        threshold: 1,
      },
    });

    await onceOpen(socket);

    for (let index = 0; index < 12; index += 1) {
      const payload = `${index}:${"z".repeat(4096)}`;
      socket.send(payload);
      expect(await onceMessage(socket)).toBe(`echo:${payload}`);
    }

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

function onceMessage(socket: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handleMessage = (data: WebSocket.RawData) => {
      cleanup();
      resolve(toText(data));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before receiving a message: ${code} ${reason.toString("utf8")}`));
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

function toText(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}
