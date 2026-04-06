import { createApp } from "keno/application";
import { json } from "keno/middleware";
import { KenoRouter } from "keno/router";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4105);
const app = createApp();
const api = new KenoRouter();
const orders = new Map<string, { id: string; customer: string; total: number }>();

orders.set("ord_demo_1", {
  customer: "Northwind Trading",
  id: "ord_demo_1",
  total: 1280,
});

app.use(json());

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

api.get("/orders/:id", (request, response) => {
  const order = orders.get(request.params.id);

  if (!order) {
    response.status(404).json({
      error: "Order not found",
    });
    return;
  }

  response.json(order);
});

api.post("/orders", (request, response) => {
  const body = toRecord(request.body);
  const customer = readString(body.customer);
  const total = readNumber(body.total);

  if (!customer || total === undefined) {
    response.status(400).json({
      error: "Expected `customer` and numeric `total`",
    });
    return;
  }

  const id = `ord_${Math.random().toString(36).slice(2, 8)}`;
  const order = { customer, id, total };
  orders.set(id, order);
  response.status(201).location(`/api/orders/${id}`).json(order);
});

app.use("/api", api);

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Modular imports example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Modular Imports</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #fffdf8;
        color: #38281b;
      }

      main {
        max-width: 820px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #38281b;
        color: #fff5ea;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Folder-based public imports</h1>
      <p>
        This demo uses <code>keno/application</code>, <code>keno/middleware</code>,
        and <code>keno/router</code> directly.
      </p>
      <pre>GET /api/orders/ord_demo_1
POST /api/orders
{"customer":"Acme","total":4200}</pre>
    </main>
  </body>
</html>
`;
