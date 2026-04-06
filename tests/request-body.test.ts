import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("request body parsing", () => {
  it("parses JSON directly from the request and reuses the cached payload", async () => {
    const app = keno();

    app.post("/direct-json", async (request, response) => {
      const first = await request.json<{ ok: boolean }>();
      const second = await request.json<{ ok: boolean }>();

      response.json({
        ok: first.ok,
        sameReference: first === second,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/direct-json`, {
      body: JSON.stringify({ ok: true }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      sameReference: true,
    });
  });

  it("supports text middleware with a custom content type", async () => {
    const app = keno();

    app.use(keno.text({ defaultType: "application/graphql" }));
    app.post("/graphql", (request, response) => {
      response.json({
        body: request.body,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
      body: "{ users { id } }",
      headers: {
        "content-type": "application/graphql",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: "{ users { id } }",
    });
  });

  it("rejects primitive JSON values in strict mode", async () => {
    const app = keno();

    app.use(keno.json());
    app.post("/strict", (_request, response) => {
      response.sendStatus(204);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/strict`, {
      body: "123",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "JSON payload must be an object or an array",
    });
  });

  it("accepts primitive JSON values when strict mode is disabled", async () => {
    const app = keno();

    app.use(keno.json({ strict: false }));
    app.post("/loose", (request, response) => {
      response.json({
        body: request.body,
        type: typeof request.body,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/loose`, {
      body: "123",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: 123,
      type: "number",
    });
  });

  it("rejects malformed JSON payloads", async () => {
    const app = keno();

    app.post("/invalid-json", async (request, response) => {
      await request.json();
      response.sendStatus(204);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/invalid-json`, {
      body: '{"ok":',
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON payload",
    });
  });

  it("rejects prototype poisoning keys in JSON payloads", async () => {
    const app = keno();

    app.post("/unsafe-json", async (request, response) => {
      await request.json();
      response.sendStatus(204);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/unsafe-json`, {
      body: '{"ok":true,"__proto__":{"polluted":true}}',
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON payload",
    });
  });

  it("rejects constructor.prototype poisoning in JSON payloads", async () => {
    const app = keno();

    app.post("/unsafe-constructor", async (request, response) => {
      await request.json();
      response.sendStatus(204);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/unsafe-constructor`, {
      body: '{"constructor":{"prototype":{"polluted":true}}}',
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON payload",
    });
  });

  it("enforces body size limits before reading oversized payloads", async () => {
    const app = keno();

    app.post("/limited", async (request, response) => {
      await request.buffer({ limit: "4b" });
      response.send("ok");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      body: "hello",
      headers: {
        "content-length": "5",
      },
      hostname: "127.0.0.1",
      method: "POST",
      path: "/limited",
      port,
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: "Request entity too large",
    });
  });
});
