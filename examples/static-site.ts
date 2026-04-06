import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4108);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "static-site-public");
const app = keno();

app.get("/", async (_request, response) => {
  await response.sendFile(join(publicDir, "index.html"));
});

app.get("/health", (_request, response) => {
  response.json({
    publicDir,
    status: "ok",
  });
});

app.get("/api/metrics", (_request, response) => {
  response.json({
    buildTarget: "node-and-bun",
    routes: 4,
    transport: "http",
    websocketReady: true,
  });
});

app.use("/assets", keno.static(publicDir, {
  immutable: false,
  index: false,
}));

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Static site example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
