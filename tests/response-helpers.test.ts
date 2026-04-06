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

describe("response helpers", () => {
  it("supports redirect responses", async () => {
    const app = keno();

    app.get("/redirect", (_request, response) => {
      response.redirect("/target", 301);
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/redirect",
      port,
    });

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/target");
    expect(response.body).toContain("Redirecting to /target");
  });

  it("supports clearCookie and attachment helpers", async () => {
    const app = keno();

    app.get("/attachment", (_request, response) => {
      response.clearCookie("session", { path: "/" });
      response.attachment("report.txt");
      response.send("ready");
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/attachment",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="report.txt"');
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers["set-cookie"]).toEqual([
      expect.stringContaining("session="),
    ]);
    expect(String(response.headers["set-cookie"]?.[0] ?? "")).toContain("Max-Age=0");
  });

  it("supports append, remove and explicit content types", async () => {
    const app = keno();

    app.get("/headers", (_request, response) => {
      response.append("x-tag", "one");
      response.append("x-tag", ["two", "three"]);
      response.set("x-remove", "yes");
      response.remove("x-remove");
      response.type("json");
      response.send('{"ok":true}');
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      hostname: "127.0.0.1",
      path: "/headers",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-tag"]).toBe("one, two, three");
    expect(response.rawHeaders.filter((value) => value === "x-tag")).toHaveLength(3);
    expect(response.headers["x-remove"]).toBeUndefined();
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.body).toBe('{"ok":true}');
  });
});
