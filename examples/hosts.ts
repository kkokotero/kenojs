import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4104);
const app = keno();
const api = keno.Router();
const admin = keno.Router();

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

api.get("/status", (request, response) => {
  response.json({
    area: "api",
    host: request.host,
    hostname: request.hostname,
    transport: request.transport,
  });
});

admin.get("/status", (request, response) => {
  response.json({
    area: "admin",
    host: request.host,
    ip: request.ip,
    transport: request.transport,
  });
});

app.host("api.local.test", api);
app.host("admin.local.test", admin);

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Host routing example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Host Routing</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f7fafc;
        color: #173046;
      }

      main {
        max-width: 840px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #173046;
        color: #eef6ff;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Host-aware routing</h1>
      <p>Try these requests with a custom <code>Host</code> header:</p>
      <pre>curl -H "Host: api.local.test" http://${host}:${port}/status
curl -H "Host: admin.local.test" http://${host}:${port}/status</pre>
    </main>
  </body>
</html>
`;
