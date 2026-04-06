import { createApp } from "keno/application";
import { createWorkerPool, threaded } from "keno/worker-pool";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4114);
const app = createApp();
const pool = createWorkerPool<{ value: number }, { durationMs: number; value: number; result: number }>({
  entry: new URL("./threaded-worker.ts", import.meta.url),
  execArgv: ["--import", "tsx/esm"],
  size: 4,
});

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get(
  "/cpu/:value",
  threaded(pool, {
    input: (request) => ({
      value: Number(request.params.value),
    }),
  }),
);

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Threaded endpoints example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Worker Pool Example</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #fff9fb;
        color: #4a1830;
      }

      main {
        max-width: 820px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #4a1830;
        color: #fff1f8;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Worker pool endpoints</h1>
      <p>Offload CPU-heavy work without blocking the main event loop.</p>
      <pre>GET /cpu/38</pre>
    </main>
  </body>
</html>
`;
