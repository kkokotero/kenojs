import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno, { HttpError } from "../src";
import { httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("error behavior", () => {
  it("forwards next(error) into registered error middleware", async () => {
    const app = keno();

    app.get("/next-error", (_request, _response, next) => {
      return next(new HttpError(409, "Conflict"));
    });

    app.use((error, _request, response, _next) => {
      response.status(590).json({
        message: error instanceof Error ? error.message : "unknown",
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/next-error",
      port,
    });

    expect(response.statusCode).toBe(590);
    expect(JSON.parse(response.body)).toEqual({
      message: "Conflict",
    });
  });

  it("hides generic 500 error messages by default", async () => {
    const app = keno();

    app.get("/boom", () => {
      throw new Error("sensitive failure");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/boom",
      port,
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: "Internal Server Error",
    });
  });

  it("preserves status headers from HttpError responses", async () => {
    const app = keno();

    app.get("/rate-limit", () => {
      throw new HttpError(429, "Too Many Requests", {
        headers: {
          "retry-after": "5",
          "x-ratelimit-policy": "burst",
        },
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/rate-limit",
      port,
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.headers["x-ratelimit-policy"]).toBe("burst");
    expect(JSON.parse(response.body)).toEqual({
      error: "Too Many Requests",
    });
  });
});
