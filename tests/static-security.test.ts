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

describe("static middleware security", () => {
  it("blocks path traversal outside the mounted root", async () => {
    const app = keno();

    app.use("/assets", keno.static(dirname(fixturePath("hello.txt")), { fallthrough: false }));

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/%2e%2e/%2e%2e/package.json",
      port,
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: "Forbidden static asset path",
    });
  });

  it("ignores dotfiles by default and falls through", async () => {
    const app = keno();

    app.use("/assets", keno.static(dirname(fixturePath("hello.txt"))));
    app.get("/assets/.hidden.txt", (_request, response) => {
      response.send("fallback");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/.hidden.txt",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fallback");
  });

  it("can deny dotfiles explicitly", async () => {
    const app = keno();

    app.use(
      "/assets",
      keno.static(dirname(fixturePath("hello.txt")), {
        dotfiles: "deny",
        fallthrough: false,
      }),
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/.hidden.txt",
      port,
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: "Forbidden static asset path",
    });
  });

  it("rejects malformed encoded paths when fallthrough is disabled", async () => {
    const app = keno();

    app.use(
      "/assets",
      keno.static(dirname(fixturePath("hello.txt")), {
        fallthrough: false,
      }),
    );

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/assets/%E0%A4%A.txt",
      port,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "Malformed static asset path",
    });
  });
});
