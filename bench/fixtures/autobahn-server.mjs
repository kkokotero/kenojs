import keno from "../../dist/index.js";

const host = process.env.KENO_AUTOBAHN_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.KENO_AUTOBAHN_PORT ?? "9001", 10);
const threaded = process.env.KENO_AUTOBAHN_THREADED === "1";

const app = keno();

app.ws(
  "/*path",
  {
    maxPayload: "16mb",
    perMessageDeflate: true,
  },
  (socket) => {
    socket.on("message", (event) => {
      if (event.isBinary) {
        socket.sendBinary(event.data);
        return;
      }

      socket.sendText(event.data);
    });
  },
);

const server = app.listen({
  host,
  port,
  threaded,
});

await server.ready();
console.log(`AUTOBAHN_READY ws://${host}:${port}`);

let closing = false;

async function shutdown(code = 0) {
  if (closing) {
    return;
  }

  closing = true;

  try {
    await server.close();
  } finally {
    process.exit(code);
  }
}

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});
