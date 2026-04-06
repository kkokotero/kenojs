import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as http from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import keno from "../src";

type Closeable = {
  close: () => Promise<void>;
  url: string;
};

type HttpRunner = readonly [name: string, start: () => Promise<Closeable>];
type WebSocketRunner = readonly [name: string, start: () => Promise<Closeable>];

type HttpBenchResult = {
  latencyMs: number;
  name: string;
  requestsPerSec: number;
  throughputMiB: number;
};

type WebSocketBenchResult = {
  durationMs: number;
  messagesPerSec: number;
  name: string;
};

type BenchmarkReport = {
  benchmarkVersion: number;
  cpuBound: HttpBenchResult[];
  generatedAt: string;
  httpHello: HttpBenchResult[];
  options: BenchmarkOptions;
  staticFile: HttpBenchResult[];
  websocketCompressed: WebSocketBenchResult[];
  websocketEcho: WebSocketBenchResult[];
};

type BenchmarkOptions = {
  connections: number;
  cpuValue: number;
  duration: number;
  pipelining: number;
  wsClients: number;
  wsMessages: number;
};

const STATIC_FILE = join(import.meta.dirname, "fixtures", "static.txt");
const STATIC_ROOT = dirname(STATIC_FILE);
const TLS_CERTIFICATE = readFileSync(join(import.meta.dirname, "..", "tests", "fixtures", "certificate.pem"));
const TLS_KEY = readFileSync(join(import.meta.dirname, "..", "tests", "fixtures", "key.pem"));
const require = createRequire(import.meta.url);

const options = parseOptions(process.argv.slice(2));

await main();

async function main(): Promise<void> {
  const previousReport = await readPreviousReport();
  const report: BenchmarkReport = {
    benchmarkVersion: 3,
    cpuBound: await runCpuBenchmarks(),
    generatedAt: new Date().toISOString(),
    httpHello: await runHttpBenchmarks(),
    options,
    staticFile: await runStaticBenchmarks(),
    websocketCompressed: await runWebSocketBenchmarks(true),
    websocketEcho: await runWebSocketBenchmarks(false),
  };

  console.log("\nHTTP hello");
  console.table(withRelativeSpeed(report.httpHello, previousReport?.httpHello));

  console.log("\nCPU-bound route");
  console.table(withRelativeSpeed(report.cpuBound, previousReport?.cpuBound));

  console.log("\nStatic file");
  console.table(withRelativeSpeed(report.staticFile, previousReport?.staticFile));

  console.log("\nWebSocket echo");
  console.table(withRelativeMessages(report.websocketEcho, previousReport?.websocketEcho));

  console.log("\nWebSocket echo with permessage-deflate");
  console.table(withRelativeMessages(report.websocketCompressed, previousReport?.websocketCompressed));

  if (previousReport && !haveComparableOptions(previousReport, report)) {
    console.log("\nNote: the previous benchmark used different runtime options, so deltas are approximate.");
  }

  const resultsDirectory = join(import.meta.dirname, "results");
  await mkdir(resultsDirectory, { recursive: true });

  const serialized = JSON.stringify(report, null, 2);
  await writeFile(join(resultsDirectory, "latest.json"), serialized);
  await writeFile(join(resultsDirectory, `${toSnapshotName(report.generatedAt)}.json`), serialized);
}

async function runHttpBenchmarks(): Promise<HttpBenchResult[]> {
  const runners: HttpRunner[] = [
    ["keno", startKenoHelloServer],
    ["keno-plugin-stack", startKenoPluginHelloServer],
    ["keno-threaded", startKenoThreadedHelloServer],
    ["node", startNodeHelloServer],
    ["express", startExpressHelloServer],
    ["fastify", startFastifyHelloServer],
    ["koa", startKoaHelloServer],
    ["tinyhttp", startTinyHttpHelloServer],
    ["hono", startHonoHelloServer],
  ];

  return runHttpScenario("/hello", runners);
}

async function runStaticBenchmarks(): Promise<HttpBenchResult[]> {
  const runners: HttpRunner[] = [
    ["keno", startKenoStaticServer],
    ["keno-threaded", startKenoThreadedStaticServer],
    ["node", startNodeStaticServer],
    ["express", startExpressStaticServer],
    ["fastify", startFastifyStaticServer],
    ["koa", startKoaStaticServer],
    ["tinyhttp", startTinyHttpStaticServer],
  ];

  return runHttpScenario("/assets/static.txt", runners);
}

async function runCpuBenchmarks(): Promise<HttpBenchResult[]> {
  const runners: HttpRunner[] = [
    ["keno", startKenoCpuServer],
    ["keno-worker-pool", startKenoWorkerPoolCpuServer],
    ["keno-threaded", startKenoThreadedCpuServer],
    ["node", startNodeCpuServer],
    ["express", startExpressCpuServer],
    ["fastify", startFastifyCpuServer],
    ["koa", startKoaCpuServer],
    ["tinyhttp", startTinyHttpCpuServer],
    ["hono", startHonoCpuServer],
  ];

  return runHttpScenario(`/cpu/${options.cpuValue}`, runners);
}

async function runHttpScenario(
  path: string,
  runners: readonly HttpRunner[],
): Promise<HttpBenchResult[]> {
  const results: HttpBenchResult[] = [];

  for (const [name, start] of runners) {
    const runtime = await start();

    try {
      await warmHttpEndpoint(`${runtime.url}${path}`);
      const stats = await runAutocannon(`${runtime.url}${path}`);
      results.push({
        latencyMs: Number(stats.latency.average.toFixed(2)),
        name,
        requestsPerSec: Number(stats.requests.average.toFixed(2)),
        throughputMiB: Number((stats.throughput.average / 1024 / 1024).toFixed(2)),
      });
    } finally {
      await runtime.close();
    }
  }

  return results;
}

async function runWebSocketBenchmarks(compressed: boolean): Promise<WebSocketBenchResult[]> {
  const runners: WebSocketRunner[] = [
    ["keno", () => startKenoWebSocketServer(compressed)],
    ["keno-rooms", () => startKenoRoomsWebSocketServer(compressed)],
    ["keno-threaded", () => startKenoThreadedWebSocketServer(compressed)],
    ["ws", () => startRawWebSocketServer(compressed)],
    ["fastify-websocket", () => startFastifyWebSocketServer(compressed)],
  ];

  if (!compressed) {
    runners.push(["websocket", startLegacyWebSocketServer]);
  }

  const results: WebSocketBenchResult[] = [];

  for (const [name, start] of runners) {
    const runtime = await start();

    try {
      await warmWebSocketEndpoint(`${runtime.url}/echo`, compressed);
      const stats = await runWebSocketScenario(`${runtime.url}/echo`, compressed);
      results.push({
        durationMs: Number(stats.durationMs.toFixed(2)),
        messagesPerSec: Number(stats.messagesPerSec.toFixed(2)),
        name,
      });
    } finally {
      await runtime.close();
    }
  }

  return results;
}

async function runAutocannon(url: string): Promise<any> {
  const autocannon = require("autocannon") as any;

  return new Promise((resolve, reject) => {
    autocannon(
      {
        connections: options.connections,
        duration: options.duration,
        pipelining: options.pipelining,
        url,
      },
      (error: Error | null, result: any) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );
  });
}

async function runWebSocketScenario(url: string, compressed: boolean): Promise<{
  durationMs: number;
  messagesPerSec: number;
}> {
  const { WebSocket } = await import("ws");

  const totalMessages = options.wsClients * options.wsMessages;
  const payload = compressed ? "x".repeat(4096) : "ping";
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: options.wsClients }, async () => {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url, {
          perMessageDeflate: compressed
            ? {
                threshold: 1,
              }
            : false,
        });
        let remaining = options.wsMessages;

        const cleanup = () => {
          socket.removeAllListeners();
        };

        socket.on("open", () => {
          socket.send(payload);
        });
        socket.on("message", () => {
          remaining -= 1;

          if (remaining <= 0) {
            socket.close();
            return;
          }

          socket.send(payload);
        });
        socket.on("close", () => {
          cleanup();
          resolve();
        });
        socket.on("error", (error) => {
          cleanup();
          reject(error);
        });
      });
    }),
  );

  const durationMs = performance.now() - startedAt;

  return {
    durationMs,
    messagesPerSec: totalMessages / (durationMs / 1000),
  };
}

async function startKenoHelloServer(): Promise<Closeable> {
  const app = keno();

  app.get("/hello", (_request, response) => {
    response.json({ ok: true });
  });

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();
  return {
    close: () => server.close(),
    url: httpUrlFromAddress(server.address() as AddressInfo),
  };
}

async function startKenoPluginHelloServer(): Promise<Closeable> {
  const app = keno();

  app.use(keno.cors({
    allowOrigin: true,
  }));
  app.use(keno.requestId());
  app.use(keno.securityHeaders());
  await app.register(keno.heartbeatPlugin, {
    name: "bench",
  });
  await app.register(keno.openApiPlugin, {
    docsPath: false,
    document: {
      info: {
        title: "Benchmark API",
        version: "1.0.0",
      },
      openapi: "3.1.0",
      paths: {
        "/hello": {
          get: {
            summary: "Hello route",
          },
        },
      },
    },
  });

  app.get("/hello", (_request, response) => {
    response.json({ ok: true });
  });

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();
  return {
    close: () => server.close(),
    url: httpUrlFromAddress(server.address() as AddressInfo),
  };
}

async function startNodeHelloServer(): Promise<Closeable> {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end('{"ok":true}');
  });

  return listenNodeServer(server);
}

async function startExpressHelloServer(): Promise<Closeable> {
  const express = require("express") as typeof import("express");
  const app = express();

  app.get("/hello", (_request: any, response: any) => {
    response.json({ ok: true });
  });

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startFastifyHelloServer(): Promise<Closeable> {
  const { default: fastify } = await import("fastify");
  const app = fastify({
    logger: false,
  });

  app.get("/hello", async () => ({ ok: true }));

  await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    close: () => app.close(),
    url: app.listeningOrigin as string,
  };
}

async function startKoaHelloServer(): Promise<Closeable> {
  const Koa = require("koa") as any;
  const Router = require("@koa/router") as any;
  const app = new Koa();
  const router = new Router();

  app.on("error", () => {});

  router.get("/hello", (context: any) => {
    context.body = { ok: true };
  });

  app.use(router.routes());

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startTinyHttpHelloServer(): Promise<Closeable> {
  const { App } = require("@tinyhttp/app") as any;
  const app = new App();

  app.get("/hello", (_request: any, response: any) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end('{"ok":true}');
  });

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startHonoHelloServer(): Promise<Closeable> {
  const { Hono } = await import("hono");
  const { serve } = await import("@hono/node-server");
  const app = new Hono();

  app.get("/hello", (context) => context.json({ ok: true }));

  return wrapListeningNodeServer(
    serve({
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    }) as unknown as http.Server,
  );
}

async function startKenoStaticServer(): Promise<Closeable> {
  const app = keno();

  app.use(
    "/assets",
    keno.static(STATIC_ROOT, {
      immutable: true,
      maxAge: 60_000,
    }),
  );

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();
  return {
    close: () => server.close(),
    url: httpUrlFromAddress(server.address() as AddressInfo),
  };
}

async function startKenoThreadedHelloServer(): Promise<Closeable> {
  return startKenoThreadClusterServer("hello");
}

async function startKenoCpuServer(): Promise<Closeable> {
  const app = keno();

  app.get("/cpu/:value", (request, response) => {
    response.json({
      value: fibonacci(Number(request.params.value)),
    });
  });

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();

  return {
    close: () => server.close(),
    url: httpUrlFromAddress(server.address() as AddressInfo),
  };
}

async function startKenoWorkerPoolCpuServer(): Promise<Closeable> {
  const app = keno();
  const pool = keno.createWorkerPool<{ value: number }, { value: number }>({
    entry: new URL("./fixtures/cpu-worker.mjs", import.meta.url),
    size: Math.max(1, Math.min(4, availableParallelism() - 1)),
  });

  app.get(
    "/cpu/:value",
    keno.threaded(pool, {
      input: (request) => ({
        value: Number(request.params.value),
      }),
    }),
  );

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();

  return {
    close: async () => {
      await server.close();
      await pool.close();
    },
    url: httpUrlFromAddress(server.address() as AddressInfo),
  };
}

async function startKenoThreadedCpuServer(): Promise<Closeable> {
  return startKenoThreadClusterServer("cpu");
}

async function startKenoThreadedStaticServer(): Promise<Closeable> {
  return startKenoThreadClusterServer("static");
}

async function startNodeStaticServer(): Promise<Closeable> {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    createReadStream(STATIC_FILE).pipe(response);
  });

  return listenNodeServer(server);
}

async function startNodeCpuServer(): Promise<Closeable> {
  const server = http.createServer((request, response) => {
    const value = readCpuValue(request.url);
    const body = JSON.stringify({
      value: fibonacci(value),
    });

    response.setHeader("content-length", String(Buffer.byteLength(body)));
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(body);
  });

  return listenNodeServer(server);
}

async function startExpressStaticServer(): Promise<Closeable> {
  const express = require("express") as typeof import("express");
  const app = express();

  app.use(
    "/assets",
    express.static(STATIC_ROOT, {
      fallthrough: false,
      immutable: true,
      maxAge: "60s",
    }),
  );

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startFastifyStaticServer(): Promise<Closeable> {
  const { default: fastify } = await import("fastify");
  const { default: fastifyStatic } = await import("@fastify/static");
  const app = fastify({
    logger: false,
  });

  await app.register(fastifyStatic, {
    immutable: true,
    maxAge: "60s",
    prefix: "/assets/",
    root: STATIC_ROOT,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    close: () => app.close(),
    url: app.listeningOrigin,
  };
}

async function startKoaStaticServer(): Promise<Closeable> {
  const Koa = require("koa") as any;
  const koaStatic = require("koa-static") as any;
  const app = new Koa();
  const serve = koaStatic(STATIC_ROOT, {
    immutable: true,
    maxage: 60_000,
  });

  app.on("error", () => {});

  app.use(async (context: any, next: () => Promise<void>) => {
    if (!context.path.startsWith("/assets")) {
      await next();
      return;
    }

    const originalPath = context.path;
    context.path = context.path.slice("/assets".length) || "/";

    try {
      await serve(context, next);
    } finally {
      context.path = originalPath;
    }
  });

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startTinyHttpStaticServer(): Promise<Closeable> {
  const { App } = require("@tinyhttp/app") as any;
  const sirv = require("sirv") as any;
  const app = new App();

  app.use(
    "/assets",
    sirv(STATIC_ROOT, {
      dev: false,
      etag: true,
      immutable: true,
      maxAge: 60,
    }),
  );

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startExpressCpuServer(): Promise<Closeable> {
  const express = require("express") as typeof import("express");
  const app = express();

  app.get("/cpu/:value", (request: any, response: any) => {
    response.json({
      value: fibonacci(Number(request.params.value)),
    });
  });

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startFastifyCpuServer(): Promise<Closeable> {
  const { default: fastify } = await import("fastify");
  const app = fastify({
    logger: false,
  });

  app.get("/cpu/:value", async (request: any) => ({
    value: fibonacci(Number(request.params.value)),
  }));

  await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    close: () => app.close(),
    url: app.listeningOrigin as string,
  };
}

async function startKoaCpuServer(): Promise<Closeable> {
  const Koa = require("koa") as any;
  const Router = require("@koa/router") as any;
  const app = new Koa();
  const router = new Router();

  app.on("error", () => {});

  router.get("/cpu/:value", (context: any) => {
    context.body = {
      value: fibonacci(Number(context.params.value)),
    };
  });

  app.use(router.routes());

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startTinyHttpCpuServer(): Promise<Closeable> {
  const { App } = require("@tinyhttp/app") as any;
  const app = new App();

  app.get("/cpu/:value", (request: any, response: any) => {
    const body = JSON.stringify({
      value: fibonacci(Number(request.params.value)),
    });

    response.setHeader("content-length", String(Buffer.byteLength(body)));
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(body);
  });

  return wrapListeningNodeServer(app.listen(0, "127.0.0.1"));
}

async function startHonoCpuServer(): Promise<Closeable> {
  const { Hono } = await import("hono");
  const { serve } = await import("@hono/node-server");
  const app = new Hono();

  app.get("/cpu/:value", (context) => {
    const value = Number(context.req.param("value"));
    return context.json({
      value: fibonacci(value),
    });
  });

  return wrapListeningNodeServer(
    serve({
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    }) as unknown as http.Server,
  );
}

async function startKenoWebSocketServer(compressed: boolean): Promise<Closeable> {
  const app = keno();

  app.ws(
    "/echo",
    {
      perMessageDeflate: compressed,
    },
    (socket) => {
      socket.on("text", (message) => {
        socket.sendText(message);
      });
    },
  );

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();
  const address = server.address() as AddressInfo;

  return {
    close: () => server.close(),
    url: `ws://127.0.0.1:${address.port}`,
  };
}

async function startKenoRoomsWebSocketServer(compressed: boolean): Promise<Closeable> {
  const app = keno();
  const heartbeat = keno.createWebSocketHeartbeat({
    intervalMs: 60_000,
    timeoutMs: 10_000,
  });
  const rooms = keno.createWebSocketRooms({
    heartbeat,
  });

  app.ws(
    "/echo",
    {
      perMessageDeflate: compressed,
    },
    (socket) => {
      const roomName = `room_${Math.random().toString(36).slice(2, 10)}`;

      rooms.join(roomName, socket);

      socket.on("text", (message) => {
        rooms.broadcast(roomName, message);
      });
      socket.on("close", () => {
        rooms.leave(socket);
      });
    },
  );

  const server = app.listen({ port: 0, threaded: false });
  await server.ready();
  const address = server.address() as AddressInfo;

  return {
    close: async () => {
      heartbeat.close();
      await server.close();
    },
    url: `ws://127.0.0.1:${address.port}`,
  };
}

async function startKenoThreadedWebSocketServer(compressed: boolean): Promise<Closeable> {
  const runtime = await startKenoThreadClusterServer("ws", compressed);

  return {
    close: runtime.close,
    url: runtime.url.replace("http://", "ws://"),
  };
}

async function startRawWebSocketServer(compressed: boolean): Promise<Closeable> {
  const { WebSocketServer } = await import("ws");
  const server = http.createServer();
  const wss = new WebSocketServer({
    perMessageDeflate: compressed,
    server,
  });

  wss.on("connection", (socket) => {
    socket.on("message", (message, isBinary) => {
      socket.send(message, { binary: isBinary });
    });
  });

  const runtime = await listenNodeServer(server);

  return {
    close: async () => {
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
      await runtime.close();
    },
    url: runtime.url.replace("http://", "ws://"),
  };
}

async function startFastifyWebSocketServer(compressed: boolean): Promise<Closeable> {
  const { default: fastify } = await import("fastify");
  const fastifyWebsocket = require("@fastify/websocket") as any;
  const app = fastify({
    logger: false,
  });

  await app.register(fastifyWebsocket, {
    options: {
      perMessageDeflate: compressed,
    },
  });

  (app as any).get("/echo", { websocket: true }, (socket: any) => {
    socket.on("message", (message: Buffer, isBinary: boolean) => {
      socket.send(message, { binary: isBinary });
    });
  });

  await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    close: () => app.close(),
    url: app.listeningOrigin.replace("http://", "ws://"),
  };
}

async function startLegacyWebSocketServer(): Promise<Closeable> {
  const { server: LegacyWebSocketServer } = require("websocket") as any;
  const server = http.createServer();
  const websocketServer = new LegacyWebSocketServer({
    autoAcceptConnections: false,
    httpServer: server,
  });

  websocketServer.on("request", (request: any) => {
    const connection = request.accept(undefined, request.origin);

    connection.on("message", (message: any) => {
      if (message.type === "binary") {
        connection.sendBytes(message.binaryData);
        return;
      }

      connection.sendUTF(message.utf8Data ?? "");
    });
  });

  const runtime = await listenNodeServer(server);

  return {
    close: async () => {
      websocketServer.shutDown();
      await runtime.close();
    },
    url: runtime.url.replace("http://", "ws://"),
  };
}

async function listenNodeServer(server: http.Server): Promise<Closeable> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
    server.once("error", reject);
  });

  return {
    close: () => closeNodeServer(server),
    url: httpUrlFromAddress(server.address()),
  };
}

async function startKenoThreadClusterServer(
  scenario: "cpu" | "hello" | "static" | "ws",
  compressed = false,
): Promise<Closeable> {
  const port = await getAvailablePort();
  const entry = new URL("./fixtures/thread-cluster-app.mjs", import.meta.url);
  entry.searchParams.set("scenario", scenario);
  if (compressed) {
    entry.searchParams.set("compressed", "1");
  }

  const cluster = keno.createThreadCluster({
    entry,
    execArgv: ["--import", "tsx"],
    host: "127.0.0.1",
    port,
    workers: Math.max(1, Math.min(availableParallelism(), 4)),
  });

  cluster.listen();
  await cluster.ready();

  return {
    close: () => cluster.close(),
    url: `http://127.0.0.1:${port}`,
  };
}

async function wrapListeningNodeServer(server: http.Server): Promise<Closeable> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }

  return {
    close: () => closeNodeServer(server),
    url: httpUrlFromAddress(server.address()),
  };
}

function closeNodeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function httpUrlFromAddress(address: string | AddressInfo | null): string {
  if (!address || typeof address === "string") {
    throw new TypeError("Expected a TCP address");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function getAvailablePort(): Promise<number> {
  const server = createNetServer();

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  const port = address.port;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

function parseOptions(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];

    if (!key?.startsWith("--")) {
      continue;
    }

    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
      continue;
    }

    values.set(key.slice(2), value);
    index += 1;
  }

  return {
    connections: readNumber(values, "connections", 100),
    cpuValue: readNumber(values, "cpu-value", 28),
    duration: readNumber(values, "duration", 8),
    pipelining: readNumber(values, "pipelining", 1),
    wsClients: readNumber(values, "ws-clients", 25),
    wsMessages: readNumber(values, "ws-messages", 1000),
  };
}

function fibonacci(value: number): number {
  if (value <= 1) {
    return value;
  }

  return fibonacci(value - 1) + fibonacci(value - 2);
}

function readCpuValue(url = "/cpu/0"): number {
  const parts = url.split("/");
  const last = parts[parts.length - 1] ?? "0";
  const value = Number.parseInt(last, 10);
  return Number.isFinite(value) ? value : 0;
}

function readNumber(values: ReadonlyMap<string, string>, key: string, fallback: number): number {
  const raw = values.get(key);

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readPreviousReport(): Promise<BenchmarkReport | undefined> {
  try {
    const raw = await readFile(join(import.meta.dirname, "results", "latest.json"), "utf8");
    return JSON.parse(raw) as BenchmarkReport;
  } catch {
    return undefined;
  }
}

function toSnapshotName(timestamp: string): string {
  return timestamp.replaceAll(":", "-").replaceAll(".", "-");
}

function haveComparableOptions(previous: BenchmarkReport, current: BenchmarkReport): boolean {
  if (!previous.options) {
    return true;
  }

  return JSON.stringify(previous.options) === JSON.stringify(current.options);
}

async function warmHttpEndpoint(url: string): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve, reject) => {
      const request = http.get(url, (response) => {
        response.resume();
        response.once("end", resolve);
      });

      request.once("error", reject);
    });
  }
}

async function warmWebSocketEndpoint(url: string, compressed: boolean): Promise<void> {
  const { WebSocket } = await import("ws");
  const payload = compressed ? "w".repeat(1024) : "warmup";

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, {
      perMessageDeflate: compressed
        ? {
            threshold: 1,
          }
        : false,
    });
    let remaining = 8;

    const cleanup = () => {
      socket.removeAllListeners();
    };

    socket.on("open", () => {
      socket.send(payload);
    });
    socket.on("message", () => {
      remaining -= 1;

      if (remaining <= 0) {
        socket.close();
        return;
      }

      socket.send(payload);
    });
    socket.on("close", () => {
      cleanup();
      resolve();
    });
    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

function withRelativeSpeed(
  results: HttpBenchResult[],
  previousResults: readonly HttpBenchResult[] = [],
): Array<HttpBenchResult & {
  latencyDelta: string;
  previousLatencyMs: number | null;
  previousReqPerSec: number | null;
  relative: string;
  reqDelta: string;
}> {
  const fastest = Math.max(...results.map((result) => result.requestsPerSec));
  const previousByName = new Map(previousResults.map((result) => [result.name, result]));

  return results.map((result) => ({
    ...result,
    latencyDelta: formatDelta(result.latencyMs, previousByName.get(result.name)?.latencyMs),
    previousLatencyMs: previousByName.get(result.name)?.latencyMs ?? null,
    previousReqPerSec: previousByName.get(result.name)?.requestsPerSec ?? null,
    relative: `${((result.requestsPerSec / fastest) * 100).toFixed(1)}%`,
    reqDelta: formatDelta(result.requestsPerSec, previousByName.get(result.name)?.requestsPerSec),
  }));
}

function withRelativeMessages(
  results: WebSocketBenchResult[],
  previousResults: readonly WebSocketBenchResult[] = [],
): Array<WebSocketBenchResult & {
  durationDelta: string;
  msgDelta: string;
  previousDurationMs: number | null;
  previousMessagesPerSec: number | null;
  relative: string;
}> {
  const fastest = Math.max(...results.map((result) => result.messagesPerSec));
  const previousByName = new Map(previousResults.map((result) => [result.name, result]));

  return results.map((result) => ({
    ...result,
    durationDelta: formatDelta(result.durationMs, previousByName.get(result.name)?.durationMs),
    msgDelta: formatDelta(result.messagesPerSec, previousByName.get(result.name)?.messagesPerSec),
    previousDurationMs: previousByName.get(result.name)?.durationMs ?? null,
    previousMessagesPerSec: previousByName.get(result.name)?.messagesPerSec ?? null,
    relative: `${((result.messagesPerSec / fastest) * 100).toFixed(1)}%`,
  }));
}

function formatDelta(current: number, previous: number | undefined): string {
  if (previous === undefined || previous === 0) {
    return "n/a";
  }

  const delta = ((current - previous) / previous) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}
