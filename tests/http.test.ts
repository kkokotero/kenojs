import type { KenoRequest, KenoResponse, KenoServer, NextFunction } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno, { HttpError } from "../src";
import { startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("HTTP routing", () => {
  it("supports nested routers, params and response locals", async () => {
    const app = keno();
    const api = keno.Router();

    app.use((request: KenoRequest, response: KenoResponse, next: NextFunction) => {
      response.locals.traceId = `${request.method}:${request.path}`;
      return next();
    });

    api.get("/users/:id", (request, response) => {
      response.json({
        id: request.params.id,
        traceId: response.locals.traceId,
      });
    });

    app.use("/api", api);

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/api/users/42`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "42",
      traceId: "GET:/api/users/42",
    });
  });

  it("parses JSON bodies with the built-in middleware", async () => {
    const app = keno();

    app.use(keno.json());
    app.post("/echo", (request, response) => {
      response.json({
        body: request.body,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/echo`, {
      body: JSON.stringify({ ok: true }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: { ok: true },
    });
  });

  it("supports exact route chaining and HEAD fallback", async () => {
    const app = keno();

    app.get(
      "/hello",
      (_request, response, next) => {
        response.set("x-step", "one");
        return next();
      },
      (_request, response) => {
        response.send("ok");
      },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const getResponse = await fetch(`http://127.0.0.1:${port}/hello`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("x-step")).toBe("one");
    expect(await getResponse.text()).toBe("ok");

    const headResponse = await fetch(`http://127.0.0.1:${port}/hello`, {
      method: "HEAD",
    });

    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("content-length")).toBe("2");
    expect(await headResponse.text()).toBe("");
  });

  it("resolves parameterized and wildcard routes through the fast route tree", async () => {
    const app = keno();

    app.get("/users/:id", (request, response) => {
      response.json({
        id: request.params.id,
      });
    });

    app.get("/files/*rest", (request, response) => {
      response.json({
        rest: request.params.rest,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const userResponse = await fetch(`http://127.0.0.1:${port}/users/42`);
    const fileResponse = await fetch(`http://127.0.0.1:${port}/files/a/b/c.txt`);

    expect(userResponse.status).toBe(200);
    expect(await userResponse.json()).toEqual({
      id: "42",
    });

    expect(fileResponse.status).toBe(200);
    expect(await fileResponse.json()).toEqual({
      rest: "a/b/c.txt",
    });
  });

  it("supports async error middleware", async () => {
    const app = keno();

    app.get("/boom", () => {
      throw new HttpError(418, "Teapot");
    });

    app.use((error, _request, response, _next) => {
      response.status(555).json({
        message: error instanceof Error ? error.message : "unknown",
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/boom`);

    expect(response.status).toBe(555);
    expect(await response.json()).toEqual({
      message: "Teapot",
    });
  });
});
