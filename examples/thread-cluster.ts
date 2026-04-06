import { availableParallelism } from "node:os";

import { createThreadCluster } from "keno/thread-cluster";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4113);
const workers = readPort(process.env.WORKERS, Math.max(2, Math.min(availableParallelism(), 4)));

const cluster = createThreadCluster({
  entry: new URL("./thread-cluster-app.ts", import.meta.url),
  execArgv: ["--import", "tsx/esm"],
  host,
  port,
  workers,
});

cluster.listen();
await cluster.ready();

console.log(`Thread cluster example ready at http://${host}:${port} with ${workers} workers`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
