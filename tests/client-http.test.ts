import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import keno, { type KenoServer } from "../src";
import {
  HttpClientError,
  createHttpClient,
  defineHttpEndpoint,
  defineHttpRoute,
  defineHttpRoutes,
  type HttpClientEndpoint,
  type HttpClientSchemaFromRoutes,
} from "../src/client";
import { startServer } from "./helpers";

interface UserRecord {
  id: string;
  include: string[];
  requestSource: string;
}

interface CreatedUser {
  id: string;
  name: string;
}

type ClientSchema = {
  "/users": {
    POST: HttpClientEndpoint<CreatedUser, { name: string }>;
  };
  "/users/:id": {
    GET: HttpClientEndpoint<
      UserRecord,
      never,
      { include?: readonly string[] },
      { id: string }
    >;
  };
};

describe("http client", () => {
  let server: KenoServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("supports typed endpoint helpers and fluent request builders", async () => {
    const unstableAttempts = {
      count: 0,
    };
    const headerProbe = {
      value: "",
    };

    const started = await startServer(createHttpClientApp(unstableAttempts, headerProbe));
    server = started.server;

    const client = createHttpClient<ClientSchema>({
      baseURL: `http://127.0.0.1:${started.port}`,
    });

    const typedUser = await client.GET("/users/:id", {
      params: {
        id: "42",
      },
      query: {
        include: ["teams", "roles"],
      },
    });
    const rawResponse = await client.get("/users/:id", {
      params: {
        id: "42",
      },
      query: {
        include: ["teams"],
      },
    });
    const created = await client
      .post("/users", {
        body: {
          name: "ana",
        },
      })
      .expect(201)
      .json<CreatedUser>();

    expectTypeOf(typedUser).toEqualTypeOf<UserRecord>();
    expectTypeOf(created).toEqualTypeOf<CreatedUser>();
    expect(typedUser).toEqual({
      id: "42",
      include: ["teams", "roles"],
      requestSource: "",
    });
    expect(rawResponse.ok).toBe(true);
    expect(await rawResponse.json<UserRecord>()).toEqual({
      id: "42",
      include: ["teams"],
      requestSource: "",
    });
    expect(created).toEqual({
      id: "user-ana",
      name: "ana",
    });
  });

  it("runs middleware, retries idempotent requests, and enforces timeouts", async () => {
    const unstableAttempts = {
      count: 0,
    };
    const headerProbe = {
      value: "",
    };

    const started = await startServer(createHttpClientApp(unstableAttempts, headerProbe));
    server = started.server;

    const seenStatuses: number[] = [];
    const seenUrls: string[] = [];
    const client = createHttpClient({
      baseURL: `http://127.0.0.1:${started.port}`,
      retry: {
        attempts: 2,
        baseDelayMs: 1,
        jitter: false,
      },
    });

    client.use(async (context, next) => {
      const headers = new Headers(context.request.headers);

      headers.set("x-client-source", "typed-http-client");
      context.request = new Request(context.request, {
        headers,
      });
      seenUrls.push(context.request.url);

      const response = await next();

      seenStatuses.push(response.status);
      return response;
    });

    const unstable = await client
      .get("/unstable")
      .expect(200)
      .json<{ ok: true }>();

    expect(unstableAttempts.count).toBe(2);
    expect(unstable).toEqual({
      ok: true,
    });
    expect(headerProbe.value).toBe("typed-http-client");
    expect(seenStatuses).toEqual([503, 200]);
    expect(seenUrls.every((url) => url.endsWith("/unstable"))).toBe(true);

    let timeoutError: unknown;

    try {
      await client
        .get("/slow", {
          timeout: 10,
        })
        .expectOk()
        .json();
    } catch (error) {
      timeoutError = error;
    }

    expect(timeoutError).toBeInstanceOf(DOMException);
    expect((timeoutError as DOMException).name).toBe("TimeoutError");
  });

  it("surfaces raw responses cleanly and supports text and stream helpers", async () => {
    const unstableAttempts = {
      count: 0,
    };
    const headerProbe = {
      value: "",
    };

    const started = await startServer(createHttpClientApp(unstableAttempts, headerProbe));
    server = started.server;

    const client = createHttpClient({
      baseURL: `http://127.0.0.1:${started.port}`,
    });
    const missing = await client.get("/missing");
    const textDownload = await client.get("/download").expect(200).text();
    const stream = await client.get("/download").expect(200).stream();

    expect(missing.ok).toBe(false);
    expect(await missing.json<{ error: string }>()).toEqual({
      error: "Not Found",
    });
    await expect(
      client.get("/missing").expect(200).json(),
    ).rejects.toBeInstanceOf(HttpClientError);
    expect(textDownload).toBe("chunk-onechunk-twochunk-three");
    expect(await readStream(stream)).toBe("chunk-onechunk-twochunk-three");
  });

  it("extends clients and supports prepared requests with shared route contracts", async () => {
    const unstableAttempts = {
      count: 0,
    };
    const headerProbe = {
      value: "",
    };

    const started = await startServer(createHttpClientApp(unstableAttempts, headerProbe));
    server = started.server;

    const routes = defineHttpRoutes(
      defineHttpRoute("/users/:id", {
        GET: defineHttpEndpoint<
          UserRecord,
          never,
          { include?: readonly string[] },
          { id: string }
        >(),
      }),
      defineHttpRoute("/users", {
        POST: defineHttpEndpoint<CreatedUser, { name: string }>(),
      }),
    );

    type SharedSchema = HttpClientSchemaFromRoutes<typeof routes>;

    expectTypeOf<SharedSchema>().toEqualTypeOf<ClientSchema>();

    const baseClient = createHttpClient<SharedSchema>({
      headers: {
        authorization: "Bearer root-token",
      },
    });
    const client = baseClient.extend({
      baseURL: `http://127.0.0.1:${started.port}`,
      headers: {
        "x-client-source": "prepared-client",
      },
    });
    const prepared = client.get("/users/:id", {
      params: {
        id: "42",
      },
      query: {
        include: ["ops"],
      },
    }).prepare();

    expect(prepared.request.url).toBe(`http://127.0.0.1:${started.port}/users/42?include=ops`);
    expect(prepared.request.headers.get("authorization")).toBe("Bearer root-token");
    expect(prepared.request.headers.get("x-client-source")).toBe("prepared-client");

    const response = await prepared.fetch();

    expect(await response.json()).toEqual({
      id: "42",
      include: ["ops"],
      requestSource: "prepared-client",
    });
    expect(await client.GET("/users/:id", {
      params: {
        id: "42",
      },
      query: {
        include: ["ops"],
      },
    })).toEqual({
      id: "42",
      include: ["ops"],
      requestSource: "prepared-client",
    });
  });
});

function createHttpClientApp(
  unstableAttempts: { count: number },
  headerProbe: { value: string },
) {
  const app = keno();

  app.use(keno.json());

  app.get("/users/:id", (request, response) => {
    const include = readQueryList(request.query.include);

    response.json({
      id: request.params.id,
      include,
      requestSource: request.header("x-client-source") ?? "",
    });
  });

  app.post("/users", (request, response) => {
    const body = toRecord(request.body);
    const name = typeof body.name === "string" ? body.name : "unknown";

    response.status(201).json({
      id: `user-${name}`,
      name,
    });
  });

  app.get("/unstable", (request, response) => {
    unstableAttempts.count += 1;
    headerProbe.value = request.header("x-client-source") ?? "";

    if (unstableAttempts.count === 1) {
      response.status(503).json({
        error: "retry me",
      });
      return;
    }

    response.json({
      ok: true,
    });
  });

  app.get("/download", async (_request, response) => {
    const raw = response.raw;
    const chunks = ["chunk-one", "chunk-two", "chunk-three"];
    const total = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0);

    raw.statusCode = 200;
    raw.setHeader("content-type", "text/plain; charset=utf-8");
    raw.setHeader("content-length", total);

    for (const chunk of chunks) {
      writeRawChunk(raw, chunk);
      await delay(5);
    }

    raw.end();
  });

  app.get("/slow", async (_request, response) => {
    await delay(40);
    response.json({
      ok: true,
    });
  });

  return app;
}

function readQueryList(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? [...value] : [value];
}

function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  return new Promise<string>((resolve, reject) => {
    const readNext = () => {
      void reader.read().then(({ done, value }) => {
        if (done) {
          resolve(output);
          return;
        }

        output += decoder.decode(value, {
          stream: true,
        });
        readNext();
      }, reject);
    };

    readNext();
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeRawChunk(
  raw: {
    write: (chunk: string) => unknown;
  },
  chunk: string,
): void {
  raw.write(chunk);
}
