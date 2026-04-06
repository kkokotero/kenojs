import { execFile } from "node:child_process";
import { isMainThread, threadId } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { KenoServer } from "../src";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import keno from "../src";
import { getAvailablePort, httpRequest } from "./helpers";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const servers: KenoServer[] = [];

function createFixtureModuleUrl(search: Record<string, string | number>): string {
  const url = new URL("./fixtures/auto-threaded-entry.mjs", import.meta.url);

  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, String(value));
  }

  return url.href;
}

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], {
    cwd: PROJECT_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
}, 60_000);

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("auto threading", () => {
  it("falls back to single-thread mode for implicit threading in vitest", async () => {
    const app = keno();

    app.get("/threaded", (_request, response) => {
      response.json({
        isMainThread,
        threadId,
      });
    });
    const server = app.listen({
      port: await getAvailablePort(),
    });
    servers.push(server);
    await server.ready();

    const address = server.address() as { port: number };
    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/threaded",
      port: address.port,
    });
    const payload = JSON.parse(response.body) as {
      isMainThread: boolean;
      threadId: number;
    };

    expect(payload.isMainThread).toBe(true);
    expect(payload.threadId).toBe(0);
  });

  it("supports explicit threaded startup from an importable module entry", async () => {
    const port = await getAvailablePort();
    const module = await import(
      /* @vite-ignore */
      createFixtureModuleUrl({ seed: Date.now() }),
    );
    const server = (module.app as ReturnType<typeof keno>).listen({
      port,
      threaded: {
        entry: new URL("./fixtures/auto-threaded-entry.mjs", import.meta.url),
        workers: 2,
      },
    });
    servers.push(server);
    await server.ready();

    const responses = await Promise.all(
      Array.from({ length: 24 }, () =>
        httpRequest({
          hostname: "127.0.0.1",
          path: "/threaded",
          port,
        }),
      ),
    );

    const threadIds = new Set(
      responses.map((response) => JSON.parse(response.body).threadId as number),
    );

    expect(threadIds.size).toBeGreaterThan(1);
  }, 20_000);

  it("falls back to single-thread mode when the captured entry is not importable", async () => {
    const originalCaptureStackTrace = Error.captureStackTrace;

    Error.captureStackTrace = (targetObject: object) => {
      Object.defineProperty(targetObject, "stack", {
        configurable: true,
        value: "Error\n    at unknown:1:1",
      });
    };

    try {
      const app = keno();

      app.get("/threaded", (_request, response) => {
        response.json({
          isMainThread,
          threadId,
        });
      });

      const server = app.listen({
        port: await getAvailablePort(),
        threaded: {
          workers: 2,
        },
      });
      servers.push(server);
      await server.ready();

      const address = server.address() as { port: number };
      const response = await httpRequest({
        hostname: "127.0.0.1",
        path: "/threaded",
        port: address.port,
      });
      const payload = JSON.parse(response.body) as {
        isMainThread: boolean;
        threadId: number;
      };

      expect(payload.isMainThread).toBe(true);
      expect(payload.threadId).toBe(0);
    } finally {
      Error.captureStackTrace = originalCaptureStackTrace;
    }
  });

  it("does not treat source files from other libraries as internal keno frames", () => {
    const originalCaptureStackTrace = Error.captureStackTrace;

    Error.captureStackTrace = (targetObject: object) => {
      Object.defineProperty(targetObject, "stack", {
        configurable: true,
        value: "Error\n    at /tmp/another-lib/src/index.ts:1:1",
      });
    };

    try {
      const app = keno() as unknown as { sourceEntryUrl?: string };
      expect(app.sourceEntryUrl).toBe("file:///tmp/another-lib/src/index.ts");
    } finally {
      Error.captureStackTrace = originalCaptureStackTrace;
    }
  });

  it("falls back to single-thread mode for implicit threading on bun runtimes", async () => {
    const originalBunVersion = process.versions.bun;

    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.3.11",
    });

    try {
      const app = keno();

      app.get("/threaded", (_request, response) => {
        response.json({
          isMainThread,
          threadId,
        });
      });

      const server = app.listen({
        port: await getAvailablePort(),
      });
      servers.push(server);
      await server.ready();

      const address = server.address() as { port: number };
      const response = await httpRequest({
        hostname: "127.0.0.1",
        path: "/threaded",
        port: address.port,
      });
      const payload = JSON.parse(response.body) as {
        isMainThread: boolean;
        threadId: number;
      };

      expect(payload.isMainThread).toBe(true);
      expect(payload.threadId).toBe(0);
    } finally {
      if (originalBunVersion === undefined) {
        delete (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun;
      } else {
        Object.defineProperty(process.versions, "bun", {
          configurable: true,
          value: originalBunVersion,
        });
      }
    }
  });

  it("captures the real entry file for package self-imports under tsx", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["--import", "tsx", "./tests/fixtures/self-import-source-entry.ts"],
      {
        cwd: PROJECT_ROOT,
      },
    );

    expect(stdout.trim()).toContain("/tests/fixtures/self-import-source-entry.ts");
    expect(stdout.trim()).not.toContain("/dist/chunk-");
  });
});
