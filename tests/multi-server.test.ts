import type { KenoMultiServer } from "../src";

import { afterEach, describe, expect, it } from "vitest";

import keno from "../src";

let multiServer: KenoMultiServer | undefined;

afterEach(async () => {
  if (multiServer) {
    await multiServer.close();
    multiServer = undefined;
  }
});

describe("multi-server support", () => {
  it("serves the same app from multiple listeners", async () => {
    const app = keno();

    app.get("/health", (_request, response) => {
      response.sendStatus(204);
    });

    multiServer = app.listenMany([
      { port: 0, transport: "http" },
      { port: 0, transport: "http" },
    ]);
    await multiServer.ready();

    const addresses = multiServer.addresses();
    const first = addresses[0] as { port: number };
    const second = addresses[1] as { port: number };

    const firstResponse = await fetch(`http://127.0.0.1:${first.port}/health`);
    const secondResponse = await fetch(`http://127.0.0.1:${second.port}/health`);

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);
  });
});
