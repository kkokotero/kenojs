import { randomUUID } from "node:crypto";

import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4100);
const app = keno();

app.use(keno.cors({
  allowOrigin: true,
  exposeHeaders: ["x-request-id"],
}));
app.use(keno.requestId());
app.use(keno.securityHeaders());
app.use(keno.json({ limit: "1mb" }));

await app.register(keno.heartbeatPlugin, {
  details: () => ({
    features: ["cookies", "json", "openapi", "request-id"],
  }),
  name: "basic-example",
});

await app.register(keno.openApiPlugin, {
  document: {
    info: {
      title: "Keno Basic Example API",
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths: {
      "/api/contact": {
        post: {
          summary: "Submit a contact request",
        },
      },
      "/api/hello/{name}": {
        get: {
          summary: "Resolve a greeting for the provided name",
        },
      },
      "/api/sessions": {
        post: {
          summary: "Create an example browser session",
        },
      },
    },
  },
  title: "Basic Example Docs",
});

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/api/hello/:name", (request, response) => {
  const include = splitCommaList(firstQueryValue(request.query.include));

  response.json({
    include,
    message: `Hello, ${request.params.name}!`,
    origin: request.origin,
    query: request.query,
    requestId: response.locals.requestId,
    transport: request.transport,
  });
});

app.post("/api/sessions", (request, response) => {
  const body = toRecord(request.body);
  const name = readString(body.name);

  if (!name) {
    response.status(400).json({
      error: "The `name` field is required",
    });
    return;
  }

  const sessionId = randomUUID();

  response
    .status(201)
    .cookie("session", sessionId, {
      httpOnly: true,
      maxAge: 60 * 60,
      path: "/",
      sameSite: "lax",
    })
    .json({
      requestId: response.locals.requestId,
      sessionId,
      user: name,
    });
});

app.post("/api/contact", (request, response) => {
  const body = toRecord(request.body);
  const name = readString(body.name);
  const email = readString(body.email);
  const message = readString(body.message);

  if (!name || !email || !message) {
    response.status(400).json({
      error: "Expected `name`, `email`, and `message`",
    });
    return;
  }

  response.status(201).json({
    id: randomUUID(),
    requestId: response.locals.requestId,
    receivedAt: new Date().toISOString(),
    summary: `${name} sent ${message.length} characters`,
  });
});

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Basic example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function splitCommaList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Basic Example</title>
    <style>
      :root {
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color-scheme: light;
      }

      body {
        margin: 0;
        background: linear-gradient(135deg, #eef4ff, #ffffff 55%);
        color: #102035;
      }

      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 56px 24px 72px;
      }

      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }

      article {
        padding: 18px 20px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 14px 40px rgba(16, 32, 53, 0.08);
      }

      pre {
        overflow-x: auto;
        padding: 14px;
        border-radius: 14px;
        background: #102035;
        color: #e7eefc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Basic Keno Example</h1>
      <p>
        Small but realistic HTTP starter with JSON parsing, route params, query handling,
        cookies, browser-friendly endpoints, built-in middlewares, and plugins.
      </p>
      <div class="grid">
        <article>
          <h2>Health</h2>
          <pre>GET /health</pre>
        </article>
        <article>
          <h2>Hello Route</h2>
          <pre>GET /api/hello/kkokotero?include=profile,roles</pre>
        </article>
        <article>
          <h2>Create Session</h2>
          <pre>POST /api/sessions
{"name":"Karen"}</pre>
        </article>
        <article>
          <h2>Contact Form</h2>
          <pre>POST /api/contact
{"name":"Karen","email":"hi@example.com","message":"Need a quote"}</pre>
        </article>
        <article>
          <h2>OpenAPI</h2>
          <pre>GET /openapi.json
GET /docs</pre>
        </article>
      </div>
    </main>
  </body>
</html>
`;
