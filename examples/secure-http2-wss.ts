import keno from "keno";
import { temporaryTls } from "keno/certificates";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4112);
const app = keno();
const tls = await temporaryTls({
  commonName: host,
  hosts: [host],
});

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (request, response) => {
  response.json({
    host: request.host,
    secure: request.secure,
    transport: request.transport,
  });
});

app.ws("/events", (socket) => {
  socket.sendText("secure-ready");

  socket.on("text", (message) => {
    socket.sendText(`echo:${message}`);
  });
});

const server = app.listen({
  allowHTTP1: true,
  host,
  port,
  threaded: false,
  tls,
  transport: "http2",
});

await server.ready();

console.log(`Secure HTTP/2 and WSS example ready at https://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Secure HTTP/2 + WSS</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #09131d, #12273b);
        color: #f1f7ff;
      }

      main {
        max-width: 840px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
        color: #f1f7ff;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>HTTP/2 + WebSocket</h1>
      <p>
        Temporary certificates are generated in memory, so you can test secure transports
        without creating PEM files by hand.
      </p>
      <pre>curl -sk https://${host}:${port}/health</pre>
    </main>
  </body>
</html>
`;
