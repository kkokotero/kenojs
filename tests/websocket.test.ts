import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { messageData, onceEvent, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("WebSocket routes", () => {
  it("upgrades a typed route and exchanges text messages", async () => {
    const app = keno();

    app.ws("/chat/:room", (socket, request) => {
      socket.sendText(`joined:${request.params.room}`);
      socket.on("text", (message) => {
        socket.sendText(`echo:${message}`);
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/chat/lobby`);
    const firstMessage = onceEvent<Event & { data: unknown }>(socket, "message");

    await onceEvent(socket, "open");

    expect(await messageData((await firstMessage).data)).toBe("joined:lobby");

    const echo = onceEvent<Event & { data: unknown }>(socket, "message");
    socket.send("hello");

    expect(await messageData((await echo).data)).toBe("echo:hello");

    socket.close(1000, "done");
    await onceEvent(socket, "close");
  });

  it("preserves UTF-8 text payload lengths for multibyte messages", async () => {
    const app = keno();

    app.ws("/utf8", (socket) => {
      socket.on("text", (message) => {
        socket.sendText(`echo:${message}`);
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/utf8`);
    await onceEvent(socket, "open");

    const echo = onceEvent<Event & { data: unknown }>(socket, "message");
    socket.send("hola ñandú");

    expect(await messageData((await echo).data)).toBe("echo:hola ñandú");

    socket.close(1000, "done");
    await onceEvent(socket, "close");
  });
});
