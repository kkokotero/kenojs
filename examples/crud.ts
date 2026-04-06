import { randomUUID } from "node:crypto";

import keno from "keno";

type TaskStatus = "done" | "in_progress" | "todo";

interface Task {
  createdAt: string;
  description: string;
  id: string;
  owner: string;
  status: TaskStatus;
  title: string;
  updatedAt: string;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4101);
const app = keno();
const api = keno.Router();
const tasks = new Map<string, Task>();

seedTasks(tasks);
app.use(keno.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    tasks: tasks.size,
  });
});

api.get("/tasks", (request, response) => {
  const status = normalizeStatus(firstQueryValue(request.query.status));
  const owner = readString(firstQueryValue(request.query.owner));
  const search = readString(firstQueryValue(request.query.q))?.toLowerCase();
  const limit = clamp(readInteger(firstQueryValue(request.query.limit), 20), 1, 100);

  const items = Array.from(tasks.values())
    .filter((task) => !status || task.status === status)
    .filter((task) => !owner || task.owner.toLowerCase() === owner.toLowerCase())
    .filter((task) => {
      if (!search) {
        return true;
      }

      const haystack = `${task.title} ${task.description} ${task.owner}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);

  response.json({
    filters: {
      owner: owner ?? null,
      q: search ?? null,
      status: status ?? null,
    },
    items,
    total: items.length,
  });
});

api.get("/tasks/:id", (request, response) => {
  const task = tasks.get(request.params.id);

  if (!task) {
    response.status(404).json({
      error: "Task not found",
    });
    return;
  }

  response
    .links({
      collection: "/api/tasks",
    })
    .json(task);
});

api.post("/tasks", (request, response) => {
  const body = toRecord(request.body);
  const title = readString(body.title);
  const description = readString(body.description) ?? "";
  const owner = readString(body.owner);
  const status = normalizeStatus(body.status);

  if (!title || !owner) {
    response.status(400).json({
      error: "Expected `title` and `owner`",
    });
    return;
  }

  const now = new Date().toISOString();
  const task: Task = {
    createdAt: now,
    description,
    id: randomUUID(),
    owner,
    status: status ?? "todo",
    title,
    updatedAt: now,
  };

  tasks.set(task.id, task);
  response
    .status(201)
    .location(`/api/tasks/${task.id}`)
    .json(task);
});

api.patch("/tasks/:id", (request, response) => {
  const task = tasks.get(request.params.id);

  if (!task) {
    response.status(404).json({
      error: "Task not found",
    });
    return;
  }

  const body = toRecord(request.body);
  const nextStatus = body.status === undefined ? task.status : normalizeStatus(body.status);

  if (body.status !== undefined && !nextStatus) {
    response.status(400).json({
      error: "Invalid status. Use `todo`, `in_progress`, or `done`",
    });
    return;
  }

  const updatedTask: Task = {
    ...task,
    description: readOptionalString(body.description) ?? task.description,
    owner: readOptionalString(body.owner) ?? task.owner,
    status: nextStatus ?? task.status,
    title: readOptionalString(body.title) ?? task.title,
    updatedAt: new Date().toISOString(),
  };

  tasks.set(updatedTask.id, updatedTask);
  response.json(updatedTask);
});

api.delete("/tasks/:id", (request, response) => {
  if (!tasks.has(request.params.id)) {
    response.status(404).json({
      error: "Task not found",
    });
    return;
  }

  tasks.delete(request.params.id);
  response.status(204).end();
});

app.use("/api", api);

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`CRUD example ready at http://${host}:${port}`);

function seedTasks(store: Map<string, Task>): void {
  const now = new Date();

  for (const seed of [
    {
      description: "Gather final requirements from sales and support",
      owner: "marina",
      status: "in_progress",
      title: "Prepare enterprise onboarding checklist",
    },
    {
      description: "Create sample dashboards and initial alert rules",
      owner: "diego",
      status: "todo",
      title: "Set up observability workspace",
    },
    {
      description: "Review API tokens, CORS rules, and backup flow",
      owner: "carla",
      status: "done",
      title: "Security review for public portal",
    },
  ] as const) {
    const createdAt = new Date(now.getTime() - store.size * 60_000).toISOString();
    const id = randomUUID();

    store.set(id, {
      createdAt,
      description: seed.description,
      id,
      owner: seed.owner,
      status: seed.status,
      title: seed.title,
      updatedAt: createdAt,
    });
  }
}

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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeStatus(value: unknown): TaskStatus | undefined {
  return value === "todo" || value === "in_progress" || value === "done"
    ? value
    : undefined;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno CRUD Example</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f7fbff, #eef5ff);
        color: #14304a;
      }

      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }

      article {
        border-radius: 18px;
        background: #ffffff;
        padding: 18px 20px;
        box-shadow: 0 14px 36px rgba(20, 48, 74, 0.08);
      }

      pre {
        padding: 14px;
        border-radius: 14px;
        background: #14304a;
        color: #ebf2ff;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Task CRUD API</h1>
      <p>
        In-memory task service with filtering, create, update, and delete flows.
        Useful as a realistic starting point for internal tools or dashboards.
      </p>
      <div class="grid">
        <article>
          <h2>List</h2>
          <pre>GET /api/tasks?status=todo&owner=diego</pre>
        </article>
        <article>
          <h2>Create</h2>
          <pre>POST /api/tasks
{"title":"Ship beta","owner":"ana"}</pre>
        </article>
        <article>
          <h2>Update</h2>
          <pre>PATCH /api/tasks/:id
{"status":"done"}</pre>
        </article>
        <article>
          <h2>Delete</h2>
          <pre>DELETE /api/tasks/:id</pre>
        </article>
      </div>
    </main>
  </body>
</html>
`;
