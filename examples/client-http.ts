import keno from "keno";
import {
  createHttpClient,
  defineHttpEndpoint,
  defineHttpRoute,
  defineHttpRoutes,
  type HttpClientSchemaFromRoutes,
} from "keno/client";

interface UserRecord {
  id: string;
  name: string;
}

const routes = defineHttpRoutes(
  defineHttpRoute("/users/:id", {
    GET: defineHttpEndpoint<UserRecord, never, never, { id: string }>(),
  }),
  defineHttpRoute("/users", {
    POST: defineHttpEndpoint<UserRecord, { name: string }>(),
  }),
);

type Api = HttpClientSchemaFromRoutes<typeof routes>;

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4116);
const app = keno();

app.use(keno.json());

app.get("/users/:id", (request, response) => {
  response.json({
    id: request.params.id,
    name: request.params.id === "42" ? "Keno" : "Unknown",
  });
});

app.post("/users", (request, response) => {
  const body = toRecord(request.body);
  const name = typeof body.name === "string" ? body.name : "Anonymous";

  response.status(201).json({
    id: name.toLowerCase(),
    name,
  });
});

const server = app.listen({
  host,
  port,
  threaded: false,
});

await server.ready();

const client = createHttpClient<Api>({
  headers: {
    authorization: "Bearer demo-token",
  },
}).extend({
  baseURL: `http://${host}:${port}`,
  headers: {
    "x-client-source": "example-client",
  },
});

client.use(async (context, next) => {
  console.log("request", context.request.method, context.request.url);

  const response = await next();

  console.log("response", response.status);
  return response;
});

const existing = await client.GET("/users/:id", {
  params: {
    id: "42",
  },
});
const created = await client
  .post("/users", {
    body: {
      name: "Ana",
    },
  })
  .expect(201)
  .json<UserRecord>();
const prepared = client.get("/users/:id", {
  params: {
    id: "42",
  },
}).prepare();
const preparedResponse = await prepared.fetch();

console.log("typed GET", existing);
console.log("fluent POST", created);
console.log("prepared request", prepared.request.url);
console.log("prepared fetch", await preparedResponse.json());

await server.close();

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
