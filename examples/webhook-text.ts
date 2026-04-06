import { createHmac, timingSafeEqual } from "node:crypto";

import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4110);
const sharedSecret = process.env.WEBHOOK_SECRET ?? "keno-dev-secret";
const app = keno();

app.use(keno.text({ limit: "256kb" }));

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML.replaceAll("__SECRET__", sharedSecret));
});

app.get("/health", (_request, response) => {
  response.json({
    secretConfigured: Boolean(sharedSecret),
    status: "ok",
  });
});

app.post("/webhooks/deploy", (request, response) => {
  const payload = typeof request.body === "string" ? request.body : "";
  const signature = request.get("x-keno-signature");

  if (!signature) {
    response.status(401).json({
      error: "Missing x-keno-signature header",
    });
    return;
  }

  if (!isValidSignature(signature, payload, sharedSecret)) {
    response.status(401).json({
      error: "Invalid signature",
    });
    return;
  }

  const fields = parseKeyValueText(payload);

  response.status(202).json({
    acceptedAt: new Date().toISOString(),
    environment: fields.environment ?? "unknown",
    project: fields.project ?? "unknown",
    rawLength: payload.length,
    status: "accepted",
  });
});

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Webhook text example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidSignature(signature: string, payload: string, secret: string): boolean {
  const expected = createSignature(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function createSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function parseKeyValueText(input: string): Record<string, string> {
  const output: Record<string, string> = {};

  for (const line of input.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (key) {
      output[key] = value;
    }
  }

  return output;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Text Webhook</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #111827;
        color: #eef2ff;
      }

      main {
        max-width: 840px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #030712;
        color: #c7d2fe;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Plain-text webhook</h1>
      <p>Useful for providers that send signed raw text or line-based event payloads.</p>
      <pre>payload="project=keno
environment=staging
revision=7e9a21"

signature=$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "__SECRET__" | sed 's/^.* //')

curl -X POST http://${host}:${port}/webhooks/deploy \\
  -H "content-type: text/plain" \\
  -H "x-keno-signature: $signature" \\
  --data "$payload"</pre>
    </main>
  </body>
</html>
`;
