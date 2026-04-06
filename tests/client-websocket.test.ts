import { afterEach, describe, expect, it } from "vitest";

import keno, { type KenoServer } from "../src";
import { createWebSocketClient } from "../src/client";
import { startServer } from "./helpers";

describe("websocket client", () => {
  let server: KenoServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("connects, emits json/text events, and sends json payloads", async () => {
    let connections = 0;
    const app = keno();

    app.ws("/events", (socket) => {
      connections += 1;
      socket.sendText(JSON.stringify({
        type: "ready",
      }));

      socket.on("text", (message) => {
        socket.sendText(JSON.stringify({
          received: message,
          type: "echo",
        }));
      });
    });

    const started = await startServer(app);
    server = started.server;
    const client = createWebSocketClient<{ type: string; received?: string }, { hello: string }>(
      `ws://127.0.0.1:${started.port}/events`,
      {
        autoConnect: false,
      },
    );
    const jsonMessages: Array<{ received?: string; type: string }> = [];
    const textMessages: string[] = [];

    client.on("json", (payload) => {
      jsonMessages.push(payload);
    });
    client.on("text", (payload) => {
      textMessages.push(payload);
    });

    await client.connect();
    client.sendJson({
      hello: "world",
    });

    await waitFor(() => jsonMessages.length >= 2);

    expect(connections).toBe(1);
    expect(jsonMessages[0]).toEqual({
      type: "ready",
    });
    expect(jsonMessages[1]).toEqual({
      received: "{\"hello\":\"world\"}",
      type: "echo",
    });
    expect(textMessages).toHaveLength(2);
    client.close(1000, "done");
  });

  it("reconnects automatically when retry is enabled", async () => {
    let connections = 0;
    const app = keno();

    app.ws("/reconnect", (socket) => {
      connections += 1;

      if (connections === 1) {
        setTimeout(() => {
          socket.close(3001, "retry");
        }, 5);
        return;
      }

      socket.sendText(JSON.stringify({
        type: "ready",
      }));
      socket.on("text", (message) => {
        socket.sendText(JSON.stringify({
          message,
          type: "ack",
        }));
      });
    });

    const started = await startServer(app);
    server = started.server;
    const client = createWebSocketClient<{ message?: string; type: string }>(
      `ws://127.0.0.1:${started.port}/reconnect`,
      {
        autoConnect: false,
        retry: {
          attempts: 3,
          baseDelayMs: 5,
          jitter: false,
        },
      },
    );
    const retries: number[] = [];
    const jsonMessages: Array<{ message?: string; type: string }> = [];

    client.on("retry", ({ attempt }) => {
      retries.push(attempt);
    });
    client.on("json", (payload) => {
      jsonMessages.push(payload);
    });

    await client.connect();
    await waitFor(() => retries.length === 1);
    await waitFor(() => jsonMessages.some((message) => message.type === "ready"));
    client.send("hello");

    await waitFor(() => jsonMessages.some((message) => message.type === "ack"));

    expect(connections).toBe(2);
    expect(retries).toEqual([2]);
    expect(jsonMessages).toContainEqual({
      type: "ready",
    });
    expect(jsonMessages).toContainEqual({
      message: "hello",
      type: "ack",
    });
    client.close(1000, "done");
  });
});

function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }

      setTimeout(check, 5);
    };

    check();
  });
}
