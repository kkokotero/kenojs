import { randomUUID } from "node:crypto";

import keno, { KenoWebSocket } from "keno";

interface ChatMessage {
  id: string;
  room: string;
  sentAt: string;
  text: string;
  type: "message" | "system";
  user: string;
}

interface RoomState {
  messages: ChatMessage[];
}

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4103);
const app = keno();
const heartbeat = keno.createWebSocketHeartbeat({
  intervalMs: 15_000,
  timeoutMs: 5_000,
});
const roomSockets = keno.createWebSocketRooms<string>({
  heartbeat,
});
const rooms = new Map<string, RoomState>();

app.use(keno.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (_request, response) => {
  response.json({
    rooms: rooms.size,
    status: "ok",
  });
});

app.get("/api/rooms", (_request, response) => {
  response.json({
    items: Array.from(rooms.entries()).map(([name, room]) => ({
      members: uniqueMembers(name).length,
      messages: room.messages.length,
      name,
    })),
  });
});

app.get("/api/rooms/:room/messages", (request, response) => {
  const room = rooms.get(normalizeRoomName(request.params.room));
  const limit = clamp(readInteger(firstQueryValue(request.query.limit), 30), 1, 100);

  response.json({
    items: room ? room.messages.slice(-limit) : [],
    room: normalizeRoomName(request.params.room),
  });
});

app.ws(
  "/ws/chat/:room",
  {
    maxPayload: "128kb",
    perMessageDeflate: true,
    verifyClient: (request) => {
      const user = normalizeUserName(firstQueryValue(request.query.user));

      if (!user) {
        return {
          message: "Missing ?user=<name>",
          ok: false,
          status: 400,
        };
      }

      return true;
    },
  },
  (socket, request) => {
    const roomName = normalizeRoomName(request.params.room);
    const user = normalizeUserName(firstQueryValue(request.query.user)) as string;
    const room = getOrCreateRoom(roomName);

    roomSockets.join(roomName, socket, user);

    safeSend(socket, {
      items: room.messages.slice(-30),
      members: uniqueMembers(roomName),
      room: roomName,
      type: "snapshot",
      user,
    });

    const joinedMessage = createMessage({
      room: roomName,
      text: `${user} joined the room`,
      type: "system",
      user: "system",
    });
    pushMessage(room, joinedMessage);
    broadcastRoom(roomName, {
      members: uniqueMembers(roomName),
      message: joinedMessage,
      type: "presence",
    });

    socket.on("text", (raw) => {
      const payload = parseJsonRecord(raw);

      if (!payload || payload.type !== "message") {
        safeSend(socket, {
          error: "Expected {\"type\":\"message\",\"text\":\"...\"}",
          type: "error",
        });
        return;
      }

      const text = readString(payload.text);

      if (!text) {
        safeSend(socket, {
          error: "Message text is required",
          type: "error",
        });
        return;
      }

      const message = createMessage({
        room: roomName,
        text,
        type: "message",
        user,
      });
      pushMessage(room, message);
      broadcastRoom(roomName, {
        members: uniqueMembers(roomName),
        message,
        type: "message",
      });
    });

    socket.on("close", () => {
      const currentRoom = rooms.get(roomName);

      if (!currentRoom) {
        return;
      }

      roomSockets.leave(socket);

      const leftMessage = createMessage({
        room: roomName,
        text: `${user} left the room`,
        type: "system",
        user: "system",
      });
      pushMessage(currentRoom, leftMessage);
      broadcastRoom(roomName, {
        members: uniqueMembers(roomName),
        message: leftMessage,
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

console.log(`Realtime chat ready at http://${host}:${port}`);

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

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRoomName(value: string): string {
  return value.trim().toLowerCase() || "general";
}

function normalizeUserName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, 24) : undefined;
}

function getOrCreateRoom(name: string): RoomState {
  const current = rooms.get(name);

  if (current) {
    return current;
  }

  const room: RoomState = {
    messages: [],
  };
  rooms.set(name, room);
  return room;
}

function uniqueMembers(roomName: string): string[] {
  return Array.from(
    new Set(
      roomSockets.members(roomName)
        .map((member) => member.meta)
        .filter((value): value is string => typeof value === "string"),
    ),
  ).sort();
}

function createMessage(input: Omit<ChatMessage, "id" | "sentAt">): ChatMessage {
  return {
    ...input,
    id: randomUUID(),
    sentAt: new Date().toISOString(),
  };
}

function pushMessage(room: RoomState, message: ChatMessage): void {
  room.messages.push(message);

  if (room.messages.length > 100) {
    room.messages.splice(0, room.messages.length - 100);
  }
}

function safeSend(socket: KenoWebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState !== KenoWebSocket.OPEN) {
    return;
  }

  socket.sendText(JSON.stringify(payload));
}

function broadcastRoom(roomName: string, payload: Record<string, unknown>): void {
  roomSockets.broadcast(roomName, payload);
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Realtime Chat</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #fdf7f0, #fffdf9);
        color: #2b1a12;
      }

      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 40px 24px 80px;
      }

      .grid {
        display: grid;
        gap: 20px;
        grid-template-columns: 280px 1fr;
      }

      @media (max-width: 820px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }

      section {
        background: #ffffff;
        border-radius: 20px;
        padding: 18px 20px;
        box-shadow: 0 16px 40px rgba(43, 26, 18, 0.08);
      }

      input, button {
        width: 100%;
        box-sizing: border-box;
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid #eadccd;
      }

      button {
        cursor: pointer;
        background: #f6a35c;
        color: #2b1a12;
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
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff6ee;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Realtime Chat</h1>
      <div class="grid">
        <section>
          <h2>Join</h2>
          <input id="room" placeholder="Room" value="general">
          <input id="user" placeholder="User" value="karen">
          <button id="connect">Connect</button>
          <p id="status">Disconnected</p>
        </section>
        <section>
          <h2>Messages</h2>
          <div style="display:flex; gap:10px;">
            <input id="text" placeholder="Write a message">
            <button id="send" style="width:auto;">Send</button>
          </div>
          <ul id="messages"></ul>
        </section>
      </div>
    </main>
    <script>
      let socket;
      const statusNode = document.querySelector("#status");
      const messages = document.querySelector("#messages");
      const roomInput = document.querySelector("#room");
      const userInput = document.querySelector("#user");
      const textInput = document.querySelector("#text");

      function renderMessage(entry) {
        const item = document.createElement("li");
        item.textContent = \`[\${entry.type}] \${entry.user}: \${entry.text}\`;
        messages.appendChild(item);
      }

      document.querySelector("#connect").addEventListener("click", () => {
        if (socket) {
          socket.close();
        }

        messages.innerHTML = "";
        const room = encodeURIComponent(roomInput.value || "general");
        const user = encodeURIComponent(userInput.value || "guest");
        socket = new WebSocket(\`ws://\${location.host}/ws/chat/\${room}?user=\${user}\`);

        socket.addEventListener("open", () => {
          statusNode.textContent = "Connected";
        });

        socket.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data);

          if (payload.type === "snapshot") {
            payload.items.forEach(renderMessage);
            statusNode.textContent = \`Connected as \${payload.user} in \${payload.room}\`;
            return;
          }

          if (payload.message) {
            renderMessage(payload.message);
          }
        });

        socket.addEventListener("close", () => {
          statusNode.textContent = "Disconnected";
        });
      });

      document.querySelector("#send").addEventListener("click", () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(JSON.stringify({
          text: textInput.value,
          type: "message",
        }));
        textInput.value = "";
      });
    </script>
  </body>
</html>
`;
