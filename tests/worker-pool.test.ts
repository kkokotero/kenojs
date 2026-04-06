import { threadId } from "node:worker_threads";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno, { createWorkerPool, threaded } from "../src";
import { httpRequest, startServer } from "./helpers";

const pools: Array<{ close: () => Promise<void> }> = [];
const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }

  while (pools.length > 0) {
    await pools.pop()?.close();
  }
});

describe("worker pools", () => {
  it("offloads route work to worker threads", async () => {
    const pool = createWorkerPool<{ value: number }, { threadId: number; value: number }>({
      entry: new URL("./fixtures/worker-task.mjs", import.meta.url),
      size: 2,
    });
    const app = keno();

    pools.push(pool);

    app.get(
      "/work/:value",
      threaded(pool, {
        input: (request) => ({
          value: Number(request.params.value),
        }),
      }),
    );

    const started = await startServer(app);
    servers.push(started.server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/work/21",
      port: started.port,
    });

    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body) as {
      threadId: number;
      value: number;
    };

    expect(payload.value).toBe(42);
    expect(payload.threadId).not.toBe(threadId);
  });
});
