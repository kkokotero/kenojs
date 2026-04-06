import keno from "keno";
import { createWebSocketClient } from "keno/client";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4117);
const app = keno();

app.ws("/events", (socket) => {
  socket.sendText(JSON.stringify({
    type: "ready",
  }));

  socket.on("text", (message) => {
    socket.sendText(JSON.stringify({
      received: message,
      type: "echo",
    }));
  });
});

const server = app.listen({
  host,
  port,
  threaded: false,
});

await server.ready();

const client = createWebSocketClient<{ received?: string; type: string }, { hello: string }>(
  `ws://${host}:${port}/events`,
  {
    autoConnect: false,
  },
);

client.on("json", (payload) => {
  console.log("json", payload);
});
client.on("text", (payload) => {
  console.log("text", payload);
});

await client.connect();
client.sendJson({
  hello: "world",
});

setTimeout(async () => {
  client.close(1000, "done");
  await server.close();
}, 250);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
