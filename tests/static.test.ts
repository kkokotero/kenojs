import { dirname } from "node:path";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { fixturePath, httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("Static middleware", () => {
  it("serves mounted assets with cache headers", async () => {
    const app = keno();

    app.use(
      "/assets",
      keno.static(dirname(fixturePath("hello.txt")), {
        immutable: true,
        maxAge: 60_000,
      }),
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/hello.txt",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("hello from keno\n");
    expect(response.headers["cache-control"]).toBe("public, max-age=60, immutable");
    expect(response.headers.etag).toBeDefined();
    expect(response.headers["last-modified"]).toBeDefined();
  });

  it("falls through to later routes when an asset is missing", async () => {
    const app = keno();

    app.use("/assets", keno.static(dirname(fixturePath("hello.txt"))));
    app.get("/assets/missing.txt", (_request, response) => {
      response.status(200).send("fallback");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/missing.txt",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fallback");
  });
});
