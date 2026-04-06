import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const primaryPort = readPort(process.env.PORT_A, 4106);
const secondaryPort = readPort(process.env.PORT_B, 4107);
const app = keno();

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (request, response) => {
  response.json({
    host: request.host,
    status: "ok",
    transport: request.transport,
  });
});

const multi = app.listenMany([
  {
    host,
    port: primaryPort,
    threaded: false,
    transport: "http",
  },
  {
    host,
    port: secondaryPort,
    threaded: false,
    transport: "http",
  },
]);

await multi.ready();

console.log(`Multi-server example ready at http://${host}:${primaryPort} and http://${host}:${secondaryPort}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Multi Server</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f6fff9;
        color: #153528;
      }

      main {
        max-width: 820px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #153528;
        color: #e9fff1;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>One app, multiple listeners</h1>
      <p>Use the same Keno app behind separate ports or transports.</p>
      <pre>GET http://${host}:${primaryPort}/health
GET http://${host}:${secondaryPort}/health</pre>
    </main>
  </body>
</html>
`;
