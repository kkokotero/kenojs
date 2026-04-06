import type { KenoThreadCluster } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import { createThreadCluster } from "../src";
import { getAvailablePort, httpRequest } from "./helpers";

const clusters: KenoThreadCluster[] = [];

afterEach(async () => {
  while (clusters.length > 0) {
    const cluster = clusters.pop();

    if (cluster) {
      await cluster.close();
    }
  }
});

describe("thread clusters", () => {
  it("distributes requests across worker threads", async () => {
    const port = await getAvailablePort();
    const cluster = createThreadCluster({
      entry: new URL("./fixtures/thread-entry.mjs", import.meta.url),
      host: "127.0.0.1",
      port,
      workers: 2,
    });

    clusters.push(cluster);
    cluster.listen();
    await cluster.ready();

    const responses = await Promise.all(
      Array.from({ length: 24 }, () =>
        httpRequest({
          hostname: "127.0.0.1",
          method: "GET",
          path: "/thread",
          port,
        }),
      ),
    );

    const workerIds = new Set(
      responses.map((response) => JSON.parse(response.body).threadId as number),
    );

    expect(workerIds.size).toBeGreaterThan(1);
  });

  it("only emits bootstrap logs from the primary worker and keeps runtime logs from all workers", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const callback = args.find((value): value is () => void => typeof value === "function");
      callback?.();
      return true;
    }) as typeof process.stdout.write;

    try {
      const port = await getAvailablePort();
      const cluster = createThreadCluster({
        entry: new URL("./fixtures/thread-entry-logging.mjs", import.meta.url),
        host: "127.0.0.1",
        port,
        workers: 3,
      });

      clusters.push(cluster);
      cluster.listen();
      await cluster.ready();

      const responses = await Promise.all(
        Array.from({ length: 24 }, () =>
          httpRequest({
            hostname: "127.0.0.1",
            method: "GET",
            path: "/log",
            port,
          }),
        ),
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });

      const bootLogs = output.match(/^BOOT_LOG:\d+$/gmu) ?? [];
      const runtimeLogs = output.match(/^RUNTIME_LOG:\d+$/gmu) ?? [];
      const responseWorkerIds = new Set(
        responses.map((response) => JSON.parse(response.body).threadId as number),
      );
      const runtimeWorkerIds = new Set(
        runtimeLogs.map((entry) => Number.parseInt(entry.split(":")[1] ?? "-1", 10)),
      );

      expect(bootLogs).toHaveLength(1);
      expect(runtimeWorkerIds.size).toBeGreaterThan(1);

      for (const workerId of responseWorkerIds) {
        expect(runtimeWorkerIds.has(workerId)).toBe(true);
      }
    } finally {
      process.stdout.write = originalWrite as typeof process.stdout.write;
    }
  });
});
