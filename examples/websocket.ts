import { randomUUID } from "node:crypto";

import keno, { KenoWebSocket } from "keno";

type EventSeverity = "critical" | "info" | "warn";

interface OpsEvent {
  createdAt: string;
  id: string;
  payload: Record<string, unknown>;
  severity: EventSeverity;
  source: string;
  title: string;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4102);
const app = keno();
const heartbeat = keno.createWebSocketHeartbeat({
  intervalMs: 15_000,
  timeoutMs: 5_000,
});
const rooms = keno.createWebSocketRooms({
  heartbeat,
});
const recentEvents: OpsEvent[] = [
  createOpsEvent({
    payload: {
      region: "us-east-1",
      service: "billing",
    },
    severity: "info",
    source: "scheduler",
    title: "Daily reconciliation completed",
  }),
  createOpsEvent({
    payload: {
      activeUsers: 1241,
      p95Ms: 218,
    },
    severity: "warn",
    source: "api-gateway",
    title: "Latency spike detected",
  }),
];

app.use(keno.json({ limit: "512kb" }));

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (_request, response) => {
  response.json({
    activeClients: rooms.size("ops"),
    eventsBuffered: recentEvents.length,
    status: "ok",
  });
});

app.get("/api/events", (request, response) => {
  const limit = clamp(readInteger(firstQueryValue(request.query.limit), 20), 1, 100);

  response.json({
    activeClients: rooms.size("ops"),
    items: recentEvents.slice(-limit).reverse(),
  });
});

app.post("/api/events", (request, response) => {
  const body = toRecord(request.body);
  const title = readString(body.title);
  const source = readString(body.source) ?? "manual";
  const severity = normalizeSeverity(body.severity) ?? "info";
  const payload = toRecord(body.payload);

  if (!title) {
    response.status(400).json({
      error: "Expected a `title` field",
    });
    return;
  }

  const event = createOpsEvent({
    payload,
    severity,
    source,
    title,
  });

  pushEvent(event);
  broadcast({
    event,
    type: "event",
  });

  response.status(201).json(event);
});

app.ws(
  "/ws/ops",
  {
    maxPayload: "256kb",
    perMessageDeflate: true,
    protocols: ["json"],
  },
  (socket) => {
    rooms.join("ops", socket);

    safeSend(socket, {
      activeClients: rooms.size("ops"),
      items: [...recentEvents].reverse(),
      type: "snapshot",
    });
    broadcast({
      activeClients: rooms.size("ops"),
      type: "presence",
    });

    socket.on("text", (message) => {
      const command = parseJsonRecord(message);

      if (!command) {
        safeSend(socket, {
          error: "Expected a JSON object payload",
          type: "error",
        });
        return;
      }

      if (command.type === "ping") {
        safeSend(socket, {
          timestamp: new Date().toISOString(),
          type: "pong",
        });
      }
    });

    socket.on("close", () => {
      rooms.leave(socket);
      broadcast({
        activeClients: rooms.size("ops"),
        type: "presence",
      });
    });
  },
);

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`WebSocket operations feed ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSeverity(value: unknown): EventSeverity | undefined {
  return value === "critical" || value === "info" || value === "warn"
    ? value
    : undefined;
}

function createOpsEvent(input: Omit<OpsEvent, "createdAt" | "id">): OpsEvent {
  return {
    ...input,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
  };
}

function pushEvent(event: OpsEvent): void {
  recentEvents.push(event);

  if (recentEvents.length > 100) {
    recentEvents.splice(0, recentEvents.length - 100);
  }
}

function broadcast(payload: Record<string, unknown>): void {
  rooms.broadcast("ops", payload);
}

function safeSend(socket: KenoWebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState !== KenoWebSocket.OPEN) {
    return;
  }

  socket.sendText(JSON.stringify(payload));
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return toRecord(parsed);
  } catch {
    return undefined;
  }
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Ops Feed</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #0f2743, #071421 70%);
        color: #e8f2ff;
      }

      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 40px 24px 80px;
      }

      .layout {
        display: grid;
        gap: 20px;
        grid-template-columns: minmax(280px, 340px) 1fr;
      }

      @media (max-width: 800px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      section {
        background: rgba(8, 24, 40, 0.75);
        border: 1px solid rgba(130, 180, 255, 0.14);
        border-radius: 20px;
        padding: 18px 20px;
      }

      input, select, textarea, button {
        width: 100%;
        box-sizing: border-box;
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(130, 180, 255, 0.16);
        background: rgba(7, 20, 33, 0.8);
        color: inherit;
      }

      button {
        cursor: pointer;
        background: linear-gradient(135deg, #4da3ff, #7ec9ff);
        color: #04111f;
        font-weight: 700;
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 14px 0 0;
        display: grid;
        gap: 12px;
      }

      li {
        padding: 14px 16px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
      }

      code, pre {
        font-family: "IBM Plex Mono", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Operations Feed</h1>
      <p>Publish incidents over HTTP and watch them appear live over WebSocket.</p>
      <div class="layout">
        <section>
          <h2>Publish Event</h2>
          <form id="event-form">
            <input name="title" placeholder="Title" value="Manual deployment approved">
            <input name="source" placeholder="Source" value="release-manager">
            <select name="severity">
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="critical">critical</option>
            </select>
            <textarea name="payload" rows="6">{"region":"eu-west-1","service":"checkout"}</textarea>
            <button type="submit">Publish</button>
          </form>
        </section>
        <section>
          <h2>Live Feed</h2>
          <div id="status">Connecting...</div>
          <ul id="events"></ul>
        </section>
      </div>
    </main>
    <script>
      const statusNode = document.querySelector("#status");
      const list = document.querySelector("#events");
      const socket = new WebSocket(\`ws://\${location.host}/ws/ops\`);

      function addEvent(entry) {
        const item = document.createElement("li");
        item.innerHTML = \`<strong>\${entry.title ?? entry.type}</strong><br><code>\${JSON.stringify(entry, null, 2)}</code>\`;
        list.prepend(item);
      }

      socket.addEventListener("open", () => {
        statusNode.textContent = "Connected";
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data);

        if (payload.type === "snapshot") {
          list.innerHTML = "";
          payload.items.forEach(addEvent);
          statusNode.textContent = \`Connected. Active clients: \${payload.activeClients}\`;
          return;
        }

        if (payload.type === "presence") {
          statusNode.textContent = \`Connected. Active clients: \${payload.activeClients}\`;
          return;
        }

        addEvent(payload.event ?? payload);
      });

      document.querySelector("#event-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = {
          payload: JSON.parse(form.get("payload")),
          severity: form.get("severity"),
          source: form.get("source"),
          title: form.get("title"),
        };

        await fetch("/api/events", {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      });
    </script>
  </body>
</html>
`;
