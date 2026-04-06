import { connect } from "node:http2";

import type { KenoServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno, { clearTemporaryTlsCache, temporaryTls } from "../src";
import { startServer } from "./helpers";

const servers: KenoServer[] = [];

afterEach(async () => {
  clearTemporaryTlsCache();

  while (servers.length > 0) {
    const server = servers.pop();

    if (server) {
      await server.close();
    }
  }
});

describe("temporary TLS certificates", () => {
  it("generates reusable in-memory certificates for local development", async () => {
    const first = await temporaryTls({
      commonName: "localhost",
      hosts: ["127.0.0.1"],
    });
    const second = await temporaryTls({
      commonName: "localhost",
      hosts: ["127.0.0.1"],
    });

    expect(first).toBe(second);
    expect(first.cert).toContain("BEGIN CERTIFICATE");
    expect(first.key).toContain("BEGIN");
    expect(first.hosts).toEqual(expect.arrayContaining(["localhost", "127.0.0.1", "::1"]));
  });

  it("can skip the cache when a fresh certificate is required", async () => {
    const first = await temporaryTls({ cache: false });
    const second = await temporaryTls({ cache: false });

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("starts a secure HTTP/2 listener without reading cert files from disk", async () => {
    const tls = await temporaryTls({
      commonName: "127.0.0.1",
      hosts: ["127.0.0.1"],
    });
    const app = keno();

    app.get("/health", (_request, response) => {
      response.json({
        secure: true,
        status: "ok",
      });
    });

    const { port, server } = await startServer(app, {
      allowHTTP1: true,
      tls,
      transport: "http2",
    });
    servers.push(server);

    const client = connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });

    const body = await new Promise<string>((resolve, reject) => {
      const stream = client.request({
        ":method": "GET",
        ":path": "/health",
      });

      let data = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        data += chunk;
      });
      stream.on("end", () => {
        resolve(data);
      });
      stream.on("error", reject);
      stream.end();
    });

    expect(JSON.parse(body)).toEqual({
      secure: true,
      status: "ok",
    });

    client.close();
  });
});
