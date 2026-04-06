# Keno

<p align="center">
  <img src="./misc/banner.svg" alt="Keno Logo">
</p>

<p align="center">
  <img alt="npm package" src="https://img.shields.io/badge/npm-keno-CB3837?logo=npm&logoColor=white">
  <img alt="Node 18.17+" src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript first" src="https://img.shields.io/badge/typescript-first-3178C6?logo=typescript&logoColor=white">
  <img alt="ESM only" src="https://img.shields.io/badge/esm-only-f59e0b">
  <img alt="Transports" src="https://img.shields.io/badge/transports-http%20%7C%20https%20%7C%20http2%20%7C%20ws-0f766e">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-16a34a">
</p>

`keno` is a TypeScript-first server toolkit and modern client stack for building HTTP, WebSocket, and HTTP/2 applications with typed routing, familiar middleware, modular public imports, and scalable transport primitives.

## Why Keno Exists

`keno` was created to keep the small-app experience pleasant without painting larger systems into a corner.

Many Node server stacks feel strong in one dimension and awkward in another:

- good routing, but no built-in story for WebSockets
- flexible middleware, but little help for host-aware routing or multi-listener setups
- good server ergonomics, but a disconnected client story

`keno` aims to keep one mental model across those layers instead:

- familiar `app.use(...)`, `app.get(...)`, and `app.ws(...)`
- typed route params and request helpers that stay pleasant in TypeScript
- modular subpath exports for tree-shakeable public imports
- built-in transport and concurrency primitives when an app grows past a single listener
- an HTTP client and WebSocket client that follow the same DX-first approach

## Highlights

- Express-like HTTP routing and middleware chaining
- Typed route params inferred from path patterns
- Built-in request helpers for JSON, text, cookies, content negotiation, and host metadata
- Built-in response helpers for JSON, redirects, files, downloads, cookies, links, and cache headers
- WebSocket routing with protocol negotiation and `permessage-deflate`
- WebSocket rooms and heartbeat utilities
- Fetch-style HTTP client with middleware, retries, timeout, prepared requests, and typed route contracts
- WebSocket client for browser, Bun, and Node runtimes with a `WebSocket` implementation
- Host-aware routing with `host(...)` and `domain(...)`
- One app, multiple listeners through `listenMany(...)` and `keno/multi-server`
- Worker pools for CPU-bound endpoints
- Thread clustering with `reusePort`
- `http`, `https`, and `http2` transports, including RFC 8441 extended `CONNECT` for WebSockets over HTTP/2
- Temporary TLS generation for local secure development
- Plugin system with built-in heartbeat, request logger, and OpenAPI plugins
- Public folder-based subpath imports such as `keno/client`, `keno/middleware`, and `keno/worker-pool`
- Benchmark harness and Autobahn WebSocket conformance runner in-repo

## Project Health

- [Contributing guide](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md)

## Installation

```bash
npm install keno
```

Runtime notes:

- Server APIs target Node `>=18.17.0`
- The package is ESM-only
- The HTTP client works in fetch-compatible runtimes
- The WebSocket client works in browsers, Bun, and Node runtimes that provide `globalThis.WebSocket`, or with an injected constructor

## Quick Start

```ts
import keno from "keno";

const app = keno();

app.use(keno.requestId());
app.use(keno.securityHeaders());
app.use(keno.json());

app.get("/users/:id", (request, response) => {
  response.json({
    id: request.params.id,
    requestId: response.locals.requestId,
    transport: request.transport,
  });
});

app.ws("/events", (socket) => {
  socket.sendText("ready");

  socket.on("text", (message) => {
    socket.sendText(`echo:${message}`);
  });
});

await app.listen(3000).ready();
```

## HTTP Client Quick Start

```ts
import { createHttpClient } from "keno/client";

type User = {
  id: string;
  name: string;
};

const client = createHttpClient({
  baseURL: "https://api.myapp.com",
  headers: {
    authorization: "Bearer token",
  },
  timeout: 3000,
});

const user = await client
  .get("/users/:id", {
    params: {
      id: "42",
    },
  })
  .expectOk()
  .json<User>();

const prepared = client.get("/users/:id", {
  params: {
    id: "42",
  },
}).prepare();

const raw = await prepared.fetch();
console.log(user, raw.status);
```

## Design Model

`keno` is centered on a small set of runtime building blocks:

- `keno()` and `createApp()`
  - Create an application instance with HTTP, WebSocket, plugin, and transport support.
- `KenoRouter`
  - Compose route trees and mount them under prefixes or host patterns.
- `KenoRequest`
  - Runtime request view with params, query, cookies, body parsing, and content negotiation helpers.
- `KenoResponse`
  - Chainable response builder for JSON, files, downloads, redirects, cookies, and headers.
- `KenoWebSocket`
  - Typed event-based WebSocket connection wrapper.
- `HttpClient`
  - Fetch-style client with fluent builders, middleware, retries, and typed route contracts.
- `KenoWebSocketClient`
  - Isomorphic reconnect-capable WebSocket client.

This keeps the everyday API small while still leaving room for host-aware routing, secure transports, concurrency, and shared contracts.

## Public Imports

`keno` keeps the public surface modular through folder-based subpath exports:

- App and routing: `keno`, `keno/application`, `keno/router`, `keno/request`, `keno/response`, `keno/types`
- Middleware and plugins: `keno/middleware`, `keno/plugins`
- Clients and realtime: `keno/client`, `keno/websocket`
- Transport and concurrency: `keno/certificates`, `keno/multi-server`, `keno/thread-cluster`, `keno/worker-pool`

Example:

```ts
import { createApp } from "keno/application";
import { json, requestId } from "keno/middleware";
import { createHttpClient } from "keno/client";
import { createWorkerPool, threaded } from "keno/worker-pool";

const app = createApp();
const client = createHttpClient();

app.use(requestId());
app.use(json());
```

## Routing And Middleware

The core router keeps a familiar shape on purpose:

```ts
import keno from "keno";

const app = keno();
const api = keno.Router();

app.use(async (request, response, next) => {
  const startedAt = Date.now();

  await next();

  console.log(request.method, request.path, response.statusCode, Date.now() - startedAt);
});

api.get("/users/:id", (request, response) => {
  response.json({
    id: request.params.id,
  });
});

app.use("/api", api);
app.host("api.local.test", api);
```

Built-in middleware today:

- `cors(...)`
- `json(...)`
- `text(...)`
- `requestId(...)`
- `securityHeaders(...)`
- `serveStatic(...)` and `static(...)`

## Request And Response Helpers

Request helpers include:

- `request.params`, `request.query`, `request.cookies`, and `request.body`
- `request.get(...)`, `request.header(...)`, `request.cookie(...)`, and `request.param(...)`
- `request.accepts(...)`, `request.acceptsLanguages(...)`, `request.acceptsEncodings(...)`, and `request.acceptsCharsets(...)`
- `request.is(...)`, `request.xhr`, and `request.hasBody`
- `request.origin`, `request.host`, `request.hostname`, `request.ip`, `request.secure`, and `request.transport`
- `await request.buffer()`, `await request.text()`, and `await request.json<T>()`

Response helpers include:

- `response.status(...)`, `response.type(...)`, `response.json(...)`, and `response.send(...)`
- `response.cookie(...)` and `response.clearCookie(...)`
- `response.redirect(...)`
- `await response.sendFile(...)` and `await response.download(...)`
- `response.links(...)`, `response.vary(...)`, `response.location(...)`, and `response.attachment(...)`
- `response.set(...)`, `response.append(...)`, `response.remove(...)`, and `response.sendStatus(...)`

## WebSockets

WebSocket routes use the same routing model as HTTP routes:

```ts
import keno from "keno";

const app = keno();
const rooms = keno.createWebSocketRooms();

app.ws("/chat/:room", (socket, request) => {
  const room = request.params.room;

  rooms.join(room, socket);
  socket.sendText(`joined:${room}`);

  socket.on("text", (message) => {
    rooms.broadcast(room, {
      message,
      room,
      type: "message",
    });
  });

  socket.on("close", () => {
    rooms.leave(socket);
  });
});
```

Realtime features currently available:

- `app.ws(...)` handlers with typed route params
- protocol negotiation during the handshake
- `permessage-deflate` support
- `createWebSocketRooms()` for room membership and broadcast
- `createWebSocketHeartbeat()` for keepalive management
- `createWebSocketClient()` in `keno/client`
- WebSocket over `http`, `https`, and `http2`

If your Node runtime does not expose `globalThis.WebSocket`, inject one explicitly:

```ts
import { WebSocket } from "ws";
import { createWebSocketClient } from "keno/client";

const client = createWebSocketClient("ws://127.0.0.1:3000/events", {
  WebSocket,
});
```

## Plugins

Applications can register reusable behavior through plugins:

```ts
import keno from "keno";

const app = keno();

await app.register(keno.heartbeatPlugin, {
  details: () => ({
    region: "local",
    transport: "http",
  }),
  name: "public-api",
});

await app.register(keno.openApiPlugin, {
  title: "Public API Docs",
  document: {
    openapi: "3.1.0",
    info: {
      title: "Public API",
      version: "1.0.0",
    },
    paths: {},
  },
});
```

Built-in plugins:

- `heartbeatPlugin`
- `openApiPlugin`
- `requestLoggerPlugin`

Custom plugins can be defined with `definePlugin(...)`.

## HTTP Client

The HTTP client is designed to feel modern without getting in the way.

### Fluent requests

```ts
import { createHttpClient } from "keno/client";

const client = createHttpClient({
  baseURL: "https://api.myapp.com",
});

const created = await client
  .post("/users", {
    body: {
      name: "Keno",
    },
  })
  .expect(201)
  .json<{ id: string; name: string }>();
```

### Middleware, retries, timeout, and `extend(...)`

```ts
const client = createHttpClient({
  retry: {
    attempts: 3,
    baseDelayMs: 200,
  },
  timeout: 3000,
}).extend({
  baseURL: "https://api.myapp.com",
  headers: {
    authorization: "Bearer token",
  },
});

client.use(async (context, next) => {
  console.log("request", context.request.method, context.request.url);

  const response = await next();

  console.log("response", response.status);
  return response;
});
```

### Prepared requests

Prepared requests are useful when you want `keno` to structure the request, but you want to decide later how to send it:

```ts
const prepared = client.prepare("GET", "/users/:id", {
  params: {
    id: "42",
  },
  query: {
    include: ["teams", "permissions"],
  },
});

const request = prepared.toRequest();
const raw = await prepared.fetch();
const response = await prepared.response();

console.log(request.url, raw.status, response.ok);
```

The fluent builder exposes the same preparation flow:

```ts
const prepared = client.get("/users/:id", {
  params: {
    id: "42",
  },
}).prepare();
```

### Typed route contracts

Server and client code can share lightweight route definitions:

```ts
import {
  createHttpClient,
  defineHttpEndpoint,
  defineHttpRoute,
  defineHttpRoutes,
  type HttpClientSchemaFromRoutes,
} from "keno/client";

type CreateUser = {
  name: string;
};

type User = {
  id: string;
  name: string;
};

const routes = defineHttpRoutes(
  defineHttpRoute("/users/:id", {
    GET: defineHttpEndpoint<User, never, never, { id: string }>(),
  }),
  defineHttpRoute("/users", {
    POST: defineHttpEndpoint<User, CreateUser>(),
  }),
);

type Api = HttpClientSchemaFromRoutes<typeof routes>;

const client = createHttpClient<Api>({
  baseURL: "https://api.myapp.com",
});

const user = await client.GET("/users/:id", {
  params: {
    id: "42",
  },
});

const created = await client.POST("/users", {
  body: {
    name: "Ana",
  },
});
```

## Transport And Concurrency

`keno` can stay minimal for a single-process app, but it also includes higher-level transport and concurrency primitives when needed.

### Secure HTTP/2

```ts
import keno from "keno";
import { temporaryTls } from "keno/certificates";

const app = keno();
const tls = await temporaryTls({
  commonName: "127.0.0.1",
  hosts: ["127.0.0.1"],
});

await app.listen({
  host: "127.0.0.1",
  port: 3000,
  transport: "http2",
  allowHTTP1: true,
  tls,
}).ready();
```

### Worker pool endpoints

```ts
import { createApp } from "keno/application";
import { createWorkerPool, threaded } from "keno/worker-pool";

const app = createApp();
const pool = createWorkerPool<{ value: number }, { result: number }>({
  entry: new URL("./worker.ts", import.meta.url),
  execArgv: ["--import", "tsx/esm"],
  size: 4,
});

app.get(
  "/cpu/:value",
  threaded(pool, {
    input: (request) => ({
      value: Number(request.params.value),
    }),
  }),
);
```

Other transport and concurrency features:

- `listenMany(...)` for one app behind multiple listeners
- `keno/multi-server` exports for explicit multi-listener orchestration
- `createThreadCluster(...)` in `keno/thread-cluster`
- `threaded: true` listener support with `reusePort`
- temporary TLS helpers in `keno/certificates`

## Examples

The repository ships with runnable examples you can start directly from the project root.

Core HTTP:

- `npm run example:basic`
- `npm run example:client-http`
- `npm run example:crud`
- `npm run example:hosts`
- `npm run example:modular-imports`
- `npm run example:multi-server`
- `npm run example:content-negotiation`
- `npm run example:webhook-text`

Files and static delivery:

- `npm run example:static-site`
- `npm run example:download-center`

WebSocket and realtime:

- `npm run example:client-websocket`
- `npm run example:websocket`
- `npm run example:realtime-chat`
- `npm run example:http2`

Concurrency:

- `npm run example:thread-cluster`
- `npm run example:threaded-endpoints`

If one of the default ports is already in use, override it per run:

```bash
PORT=3100 npm run example:basic
```

More details live in [examples/README.md](./examples/README.md).

## Benchmarks And WebSocket Conformance

`keno` includes an in-repo benchmark harness and Autobahn runner.

Run the benchmark suite:

```bash
npm run bench
```

For a shorter pass:

```bash
npm run bench:quick
```

Run the Autobahn WebSocket conformance harness:

```bash
npm run autobahn
```

The benchmark harness currently covers:

- HTTP hello-world throughput
- CPU-bound route throughput
- static file throughput
- WebSocket echo throughput
- compressed WebSocket echo throughput

Current comparison targets include raw Node.js plus frameworks such as `express`, `fastify`, `koa`, `tinyhttp`, `hono`, `ws`, `@fastify/websocket`, and `websocket`.

Latest stored snapshot:

- Source: `bench/results/latest.json`
- Generated at: `2026-04-03T22:21:35.129Z`
- Profile: `duration=5s`, `connections=50`, `pipelining=1`, `wsClients=20`, `wsMessages=500`, `cpuValue=28`

Benchmark numbers are environment-dependent, so treat them as a reproducible local snapshot rather than a universal ranking. The `Vs keno` column uses the plain `keno` server in the same benchmark group as the baseline.

### HTTP Hello-World

| Runtime | Req/s | Latency (ms) | Vs keno |
| --- | ---: | ---: | ---: |
| keno | 15325.60 | 3.04 | 1x |
| keno-plugin-stack | 11165.60 | 4.08 | 0.73x |
| keno-threaded | 39558.67 | 0.79 | 2.58x |
| node | 17083.20 | 2.27 | 1.11x |
| express | 10196 | 4.34 | 0.67x |
| fastify | 14831.20 | 3.01 | 0.97x |
| koa | 11700 | 3.78 | 0.76x |
| tinyhttp | 12285.60 | 3.60 | 0.80x |
| hono | 14005.60 | 3.06 | 0.91x |

### CPU-Bound Route

| Runtime | Req/s | Latency (ms) | Vs keno |
| --- | ---: | ---: | ---: |
| keno | 290 | 175.22 | 1x |
| keno-worker-pool | 1042.34 | 47.28 | 3.59x |
| keno-threaded | 1011.50 | 48.73 | 3.49x |
| node | 285 | 180.06 | 0.98x |
| express | 290 | 177.21 | 1x |
| fastify | 290 | 175.59 | 1x |
| koa | 285 | 178.35 | 0.98x |
| tinyhttp | 290 | 173.33 | 1x |
| hono | 290 | 172.65 | 1x |

### Static File

| Runtime | Req/s | Latency (ms) | Vs keno |
| --- | ---: | ---: | ---: |
| keno | 13074.67 | 3.17 | 1x |
| keno-threaded | 26235.20 | 1.39 | 2.01x |
| node | 7489.20 | 6.20 | 0.57x |
| express | 7130.80 | 6.47 | 0.55x |
| fastify | 7494 | 6.15 | 0.57x |
| koa | 5009.20 | 9.49 | 0.38x |
| tinyhttp | 7120.40 | 6.48 | 0.54x |

### WebSocket Echo

| Runtime | Msgs/s | Duration (ms) | Vs keno |
| --- | ---: | ---: | ---: |
| keno | 26282.55 | 380.48 | 1x |
| keno-rooms | 27957.90 | 357.68 | 1.06x |
| keno-threaded | 47797.39 | 209.22 | 1.82x |
| ws | 34734.30 | 287.90 | 1.32x |
| fastify-websocket | 34821.78 | 287.18 | 1.32x |
| websocket | 28844.27 | 346.69 | 1.10x |

### WebSocket Compressed Echo

| Runtime | Msgs/s | Duration (ms) | Vs keno |
| --- | ---: | ---: | ---: |
| keno | 7475.16 | 1337.76 | 1x |
| keno-rooms | 7809.26 | 1280.53 | 1.04x |
| keno-threaded | 11070.89 | 903.27 | 1.48x |
| ws | 9938.65 | 1006.17 | 1.33x |
| fastify-websocket | 11629.25 | 859.90 | 1.56x |

More details live in [bench/README.md](./bench/README.md).

## Validation

The repository is validated with:

- `npm run typecheck`
- `npm test`
- `npm run build`

For the full local gate:

```bash
npm run check
```
