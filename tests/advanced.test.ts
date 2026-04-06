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

describe("advanced routing and response helpers", () => {
  it("supports host routing and richer request helpers", async () => {
    const app = keno();
    const api = keno.Router();

    api.post("/inspect", (request, response) => {
      response.json({
        accepts: request.accepts("html", "json"),
        cookie: request.cookie("session"),
        hasBody: request.hasBody,
        hostname: request.hostname,
        host: request.host,
        is: request.is("json", "text/*"),
        param: request.param("from"),
        protocol: request.protocol,
        xhr: request.xhr,
      });
    });
    app.host("api.example.test", api);

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      body: JSON.stringify({ from: "body" }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: "session=abc123",
        host: "api.example.test",
        "x-requested-with": "XMLHttpRequest",
      },
      hostname: "127.0.0.1",
      method: "POST",
      path: "/inspect?from=query",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accepts: "json",
      cookie: "abc123",
      hasBody: true,
      host: "api.example.test",
      hostname: "api.example.test",
      is: "json",
      param: "query",
      protocol: "http",
      xhr: true,
    });
  });

  it("supports cookies, vary, links and sendFile helpers", async () => {
    const app = keno();

    app.get("/file", async (_request, response) => {
      response.cookie("token", "secret", {
        httpOnly: true,
        path: "/",
      });
      response.links({
        next: "/next",
      });
      response.vary("accept");
      await response.download(fixturePath("hello.txt"));
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        host: "files.example.test",
      },
      hostname: "127.0.0.1",
      method: "GET",
      path: "/file",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("hello from keno\n");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="hello.txt"');
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers.vary).toBe("accept");
    expect(response.headers.link).toBe('</next>; rel="next"');
    expect(response.headers["set-cookie"]).toEqual(["token=secret; Path=/; HttpOnly"]);
  });
});
