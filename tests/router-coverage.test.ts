import type { KenoRequest, KenoResponse, KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("router coverage", () => {
  it("supports wildcard hosts through domain()", async () => {
    const app = keno();

    app.domain("*.example.test", (request: KenoRequest, response: KenoResponse) => {
      response.json({
        host: request.host,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        host: "api.example.test",
      },
      hostname: "127.0.0.1",
      path: "/",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      host: "api.example.test",
    });
  });

  it("supports regexp host scopes", async () => {
    const app = keno();

    app.host(/^admin\./iu, (request: KenoRequest, response: KenoResponse) => {
      response.send(request.hostname);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        host: "admin.internal.test",
      },
      hostname: "127.0.0.1",
      path: "/",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("admin.internal.test");
  });

  it("preserves baseUrl and routePath in nested routers", async () => {
    const app = keno();
    const api = keno.Router();
    const users = keno.Router();

    users.get("/:id", (request, response) => {
      response.json({
        baseUrl: request.baseUrl,
        routePath: request.routePath,
      });
    });

    api.use("/users", users);
    app.use("/api", api);

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/api/users/42`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      baseUrl: "/api/users",
      routePath: "/:id",
    });
  });

  it("handles all() routes across methods", async () => {
    const app = keno();

    app.all("/anything", (request, response) => {
      response.json({
        method: request.method,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/anything`, {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "PATCH",
    });
  });
});
