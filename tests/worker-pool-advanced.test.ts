import { afterEach, describe, expect, it } from "vitest";

import { createWorkerPool } from "../src";

const pools: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (pools.length > 0) {
    await pools.pop()?.close();
  }
});

describe("advanced worker pool behavior", () => {
  it("rejects work when the queue is full", async () => {
    const pool = createWorkerPool<{ delay: number }, { ok: boolean }>({
      entry: new URL("./fixtures/slow-worker.mjs", import.meta.url),
      maxQueue: 0,
      size: 1,
    });

    pools.push(pool);

    const first = pool.run({ delay: 80 });

    await expect(pool.run({ delay: 10 })).rejects.toThrow("Worker pool queue is full");

    await expect(first).resolves.toEqual({ ok: true });
  });

  it("times out long-running worker tasks", async () => {
    const pool = createWorkerPool<{ delay: number }, { ok: boolean }>({
      entry: new URL("./fixtures/slow-worker.mjs", import.meta.url),
      size: 1,
    });

    pools.push(pool);

    await expect(
      pool.run({ delay: 100 }, { timeout: 10 }),
    ).rejects.toThrow("Worker task timed out");
  });
});
