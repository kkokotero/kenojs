import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno, { cors, requestId, securityHeaders } from "../src";
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

describe("extra middleware", () => {
  it("handles CORS preflight requests", async () => {
    const app = keno();

    app.use(cors({
      allowHeaders: ["content-type", "x-request-id"],
      allowMethods: ["GET", "POST"],
      allowOrigin: ["https://app.example.com"],
      maxAge: 60,
    }));

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        "access-control-request-headers": "content-type, x-request-id",
        "access-control-request-method": "POST",
        origin: "https://app.example.com",
      },
      hostname: "127.0.0.1",
      method: "OPTIONS",
      path: "/anything",
      port,
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(response.headers["access-control-allow-headers"]).toBe("content-type, x-request-id");
  });

  it("sets a request id and exposes it to handlers", async () => {
    const app = keno();

    app.use(requestId({
      generator: () => "req_fixed",
    }));
    app.get("/", (_request, response) => {
      response.json({
        requestId: response.locals.requestId,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/",
      port,
    });

    expect(response.headers["x-request-id"]).toBe("req_fixed");
    expect(JSON.parse(response.body)).toEqual({
      requestId: "req_fixed",
    });
  });

  it("applies default security headers", async () => {
    const app = keno();

    app.use(securityHeaders());
    app.get("/", (_request, response) => {
      response.send("ok");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      method: "GET",
      path: "/",
      port,
    });

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
