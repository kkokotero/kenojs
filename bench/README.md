# Benchmarks

Run the benchmark suite with:

```bash
npm run bench
```

For a shorter pass:

```bash
npm run bench:quick
```

The suite currently includes:

- HTTP hello-world throughput
- CPU-bound route throughput
- static file throughput
- WebSocket echo throughput
- compressed WebSocket echo throughput

Current comparison targets include:

- `keno`
- `keno-threaded`
- `keno-worker-pool`
- raw Node.js
- `express`
- `fastify`
- `koa`
- `tinyhttp`
- `hono`
- `ws`
- `@fastify/websocket`
- `websocket`
- `keno-threaded`

The runner prints tables to the terminal and writes a machine-readable report to `bench/results/latest.json`.
Each run also writes a timestamped snapshot next to `latest.json`, and the console tables include deltas against the previous `latest.json` when one exists.

Run the WebSocket conformance harness with:

```bash
npm run autobahn
```

`npm run autobahn` will:

- build `keno`
- boot an echo server fixture with `permessage-deflate`
- run Autobahn in `fuzzingclient` mode using Docker when available, or `wstest` if it exists locally
- write reports under `bench/autobahn/results/<timestamp>/reports`

Tuneable flags:

- `--duration <seconds>`
- `--connections <count>`
- `--cpu-value <n>`
- `--pipelining <count>`
- `--ws-clients <count>`
- `--ws-messages <count>`
