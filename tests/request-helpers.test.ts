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

describe("request helpers", () => {
  it("builds query arrays and resolves params from route, query and body", async () => {
    const app = keno();

    app.use(keno.json({ strict: false }));
    app.post("/items/:id", (request, response) => {
      response.json({
        baseUrl: request.baseUrl,
        fromBody: request.param("fromBody"),
        id: request.param("id"),
        path: request.path,
        query: request.query,
        routePath: request.routePath,
        search: request.search,
        tag: request.param("tag"),
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/items/42?tag=one&tag=two`, {
      body: JSON.stringify({ fromBody: "payload" }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      baseUrl: "",
      fromBody: "payload",
      id: "42",
      path: "/items/42",
      query: {
        tag: ["one", "two"],
      },
      routePath: "/items/:id",
      search: "?tag=one&tag=two",
      tag: "one",
    });
  });

  it("negotiates accepted media, encodings, charsets and languages", async () => {
    const app = keno();

    app.get("/negotiate", (request, response) => {
      response.json({
        charset: request.acceptsCharsets("utf-8", "iso-8859-1"),
        encoding: request.acceptsEncodings("br", "gzip", "identity"),
        language: request.acceptsLanguages("es", "en"),
        media: request.accepts("html", "json"),
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        accept: "application/json;q=0.9, text/html;q=0.5",
        "accept-charset": "utf-8, iso-8859-1;q=0.5",
        "accept-encoding": "gzip;q=0.8, br;q=1.0",
        "accept-language": "es-CO, en;q=0.7",
      },
      hostname: "127.0.0.1",
      path: "/negotiate",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      charset: "utf-8",
      encoding: "br",
      language: "es",
      media: "json",
    });
  });

  it("parses IPv6 hosts and derives host metadata correctly", async () => {
    const app = keno();

    app.get("/host", (request, response) => {
      response.json({
        host: request.host,
        hostname: request.hostname,
        origin: request.origin,
        port: request.port,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      headers: {
        host: "[::1]:8080",
      },
      hostname: "127.0.0.1",
      path: "/host",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      host: "[::1]:8080",
      hostname: "::1",
      origin: "http://[::1]:8080",
      port: 8080,
    });
  });

  it("reports xhr, content-type matches and request bodies consistently", async () => {
    const app = keno();

    app.use(keno.text());
    app.post("/inspect", (request, response) => {
      response.json({
        hasBody: request.hasBody,
        isText: request.is("text/plain", "application/json"),
        xhr: request.xhr,
      });
    });

    const { port, server } = await startServer(app);
    servers.push(server);

    const response = await httpRequest({
      body: "hello",
      headers: {
        "content-length": "5",
        "content-type": "text/plain; charset=utf-8",
        "x-requested-with": "XMLHttpRequest",
      },
      hostname: "127.0.0.1",
      method: "POST",
      path: "/inspect",
      port,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      hasBody: true,
      isText: "text/plain",
      xhr: true,
    });
  });
});
