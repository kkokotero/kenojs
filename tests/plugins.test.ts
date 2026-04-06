import type { KenoServer, RequestLoggerEntry } from "../src";
import type { RequestHandler } from "../src";

import { afterEach, describe, expect, it, vi } from "vitest";

import keno, {
  definePlugin,
  heartbeatPlugin,
  openApiPlugin,
  requestLoggerPlugin,
} from "../src";
import { httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("plugins", () => {
  it("registers plugins that add middleware and routes", async () => {
    const app = keno();

    await app.register(
      definePlugin<{ tenant: string }>((application, options) => {
        const middleware: RequestHandler = (_request, response, next) => {
          response.locals.tenant = options.tenant;
          return next();
        };

        application.use(middleware);

        application.get("/plugin", (_request, response) => {
          response.json({
            tenant: response.locals.tenant,
          });
        });
      }),
      { tenant: "enterprise" },
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/plugin",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      tenant: "enterprise",
    });
  });

  it("serves built-in heartbeat and openapi routes", async () => {
    const app = keno();

    await app.register(heartbeatPlugin, {
      name: "test-service",
      readyWhen: async () => false,
    });
    await app.register(openApiPlugin, {
      document: {
        info: {
          title: "Plugin API",
          version: "1.0.0",
        },
        openapi: "3.1.0",
        paths: {
          "/health": {
            get: {
              summary: "Health route",
            },
          },
        },
      },
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const health = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/health",
      port,
    });
    const ready = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/ready",
      port,
    });
    const openapi = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/openapi.json",
      port,
    });
    const docs = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/docs",
      port,
    });

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({
      name: "test-service",
      status: "ok",
    });

    expect(ready.statusCode).toBe(503);
    expect(JSON.parse(ready.body)).toMatchObject({
      status: "degraded",
    });

    const document = JSON.parse(openapi.body);
    expect(openapi.statusCode).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      {
        url: `http://127.0.0.1:${port}`,
      },
    ]);

    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain("Served by Keno's built-in OpenAPI plugin.");
  });

  it("runs plugin-provided request logging middleware", async () => {
    const entries: RequestLoggerEntry[] = [];
    const logger = vi.fn((entry: RequestLoggerEntry) => {
      entries.push(entry);
    });
    const app = keno();

    await app.register(requestLoggerPlugin, {
      logger,
    });

    app.get("/hello", (_request, response) => {
      response.json({ ok: true });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/hello",
      port,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger).toHaveBeenCalledTimes(1);
    expect(entries[0]).toMatchObject({
      method: "GET",
      path: "/hello",
      statusCode: 200,
    });
  });
});
