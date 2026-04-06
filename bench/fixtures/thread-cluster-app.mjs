import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import keno from "../../dist/index.js";

const entryUrl = new URL(import.meta.url);
const scenario = entryUrl.searchParams.get("scenario") ?? "hello";
const compressed = entryUrl.searchParams.get("compressed") === "1";
const staticRoot = dirname(fileURLToPath(new URL("./static.txt", import.meta.url)));

export function createApp() {
  const app = keno();

  switch (scenario) {
    case "cpu":
      app.get("/cpu/:value", (request, response) => {
        response.json({
          value: fibonacci(Number(request.params.value)),
        });
      });
      break;
    case "static":
      app.use(
        "/assets",
        keno.static(staticRoot, {
          immutable: true,
          maxAge: 60_000,
        }),
      );
      break;
    case "ws":
      app.ws(
        "/echo",
        {
          perMessageDeflate: compressed,
        },
        (socket) => {
          socket.on("text", (message) => {
            socket.sendText(message);
          });
        },
      );
      break;
    case "hello":
    default:
      app.get("/hello", (_request, response) => {
        response.json({ ok: true });
      });
      break;
  }

  return app;
}

export default createApp;

function fibonacci(value) {
  if (value <= 1) {
    return value;
  }

  return fibonacci(value - 1) + fibonacci(value - 2);
}
