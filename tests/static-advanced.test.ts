import { dirname } from "node:path";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";
import { fixturePath, httpRequest, startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("advanced static middleware", () => {
  it("serves directory index files by default", async () => {
    const app = keno();

    app.use("/site", keno.static(dirname(fixturePath("site/index.html"))));

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/site/",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain("static site index");
  });

  it("returns a 404 payload when fallthrough is disabled and the asset is missing", async () => {
    const app = keno();

    app.use(
      "/site",
      keno.static(dirname(fixturePath("site/index.html")), {
        fallthrough: false,
      }),
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/site/missing.txt",
      port,
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: "Static asset not found",
    });
  });

  it("can disable directory indexes and fall through to later handlers", async () => {
    const app = keno();

    app.use(
      "/site",
      keno.static(dirname(fixturePath("site/index.html")), {
        index: false,
      }),
    );
    app.get("/site/", (_request, response) => {
      response.send("fallback index");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/site/",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fallback index");
  });
});
