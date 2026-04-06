import keno from "keno";

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4111);
const app = keno();

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    supported: ["application/json", "text/html", "text/plain"],
  });
});

app.get("/reports/:id", (request, response) => {
  const forced = firstQueryValue(request.query.format);
  const preferred = forced
    ? normalizeFormat(forced)
    : request.accepts("application/json", "text/html", "text/plain");

  response
    .vary("accept")
    .links({
      collection: "/",
      self: request.originalUrl,
    });

  const report = {
    generatedAt: new Date().toISOString(),
    id: request.params.id,
    locale: request.acceptsLanguages("es", "en", "pt") || "any",
    preferredEncoding: request.acceptsEncodings("br", "gzip", "identity") || "identity",
    score: 94,
    summary: "Adoption remains healthy across enterprise accounts.",
  };

  if (!preferred) {
    response.status(406).json({
      error: "Not acceptable",
    });
    return;
  }

  if (preferred === "application/json") {
    response.json(report);
    return;
  }

  if (preferred === "text/plain") {
    response.type("txt").send(
      `Report ${report.id}\nScore: ${report.score}\nLocale: ${report.locale}\n${report.summary}`,
    );
    return;
  }

  response.type("html").send(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Report ${report.id}</title>
      <style>
        body { font-family: "IBM Plex Sans", sans-serif; margin: 40px; color: #17324d; }
        article { max-width: 720px; padding: 24px; border-radius: 18px; background: #f7fbff; }
      </style>
    </head>
    <body>
      <article>
        <h1>Report ${report.id}</h1>
        <p><strong>Score:</strong> ${report.score}</p>
        <p><strong>Locale:</strong> ${report.locale}</p>
        <p>${report.summary}</p>
      </article>
    </body>
  </html>`);
});

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Content negotiation example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeFormat(value: string): "application/json" | "text/html" | "text/plain" | false {
  if (value === "json") {
    return "application/json";
  }

  if (value === "html") {
    return "text/html";
  }

  if (value === "text") {
    return "text/plain";
  }

  return false;
}

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Content Negotiation</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #fcfffe;
        color: #173d33;
      }

      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      pre {
        padding: 16px;
        border-radius: 14px;
        background: #173d33;
        color: #effff8;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Content negotiation</h1>
      <p>Example of <code>Accept</code>, languages, encodings, and explicit format overrides.</p>
      <pre>curl -H "Accept: application/json" http://${host}:${port}/reports/q1
curl -H "Accept: text/plain" http://${host}:${port}/reports/q1
curl http://${host}:${port}/reports/q1?format=html</pre>
    </main>
  </body>
</html>
`;
