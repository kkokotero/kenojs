import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import keno from "keno";

type DownloadItem = {
  description: string;
  filename: string;
  kind: "json" | "text" | "csv";
  slug: string;
  title: string;
};

const host = process.env.HOST ?? "127.0.0.1";
const port = readPort(process.env.PORT, 4109);
const filesDir = join(dirname(fileURLToPath(import.meta.url)), "download-center-files");
const items: readonly DownloadItem[] = [
  {
    description: "Quarterly revenue and retention forecast",
    filename: "q1-forecast.csv",
    kind: "csv",
    slug: "forecast",
    title: "Q1 Forecast",
  },
  {
    description: "Example team roster exported as JSON",
    filename: "team-roster.json",
    kind: "json",
    slug: "team-roster",
    title: "Team Roster",
  },
  {
    description: "Lightweight operational runbook for on-call checks",
    filename: "runbook.txt",
    kind: "text",
    slug: "runbook",
    title: "Runbook",
  },
];
const app = keno();

app.get("/", (_request, response) => {
  response.type("html").send(INDEX_HTML);
});

app.get("/health", (_request, response) => {
  response.json({
    files: items.length,
    status: "ok",
  });
});

app.get("/api/files", (_request, response) => {
  response
    .links({
      docs: "/",
    })
    .json({
      items,
    });
});

app.get("/downloads/:slug", async (request, response) => {
  const item = items.find((entry) => entry.slug === request.params.slug);

  if (!item) {
    response.status(404).json({
      error: "Unknown file",
    });
    return;
  }

  await response.download(join(filesDir, item.filename), item.filename);
});

app.get("/preview/:slug", async (request, response) => {
  const item = items.find((entry) => entry.slug === request.params.slug);

  if (!item) {
    response.status(404).json({
      error: "Unknown file",
    });
    return;
  }

  await response.sendFile(join(filesDir, item.filename), {
    cacheControl: false,
  });
});

const server = app.listen({
  host,
  port,
  threaded: false,
});
await server.ready();

console.log(`Download center example ready at http://${host}:${port}`);

function readPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Keno Download Center</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f8fbff;
        color: #17324d;
      }

      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      ul {
        display: grid;
        gap: 14px;
        list-style: none;
        padding: 0;
      }

      li {
        background: #ffffff;
        border-radius: 18px;
        padding: 18px 20px;
        box-shadow: 0 14px 36px rgba(23, 50, 77, 0.08);
      }

      a {
        color: #0a67c2;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Download Center</h1>
      <p>Example of file previews, direct downloads, and response helpers.</p>
      <ul>
        ${items.map((item) => `
          <li>
            <strong>${item.title}</strong><br>
            ${item.description}<br>
            <a href="/preview/${item.slug}">Preview</a> |
            <a href="/downloads/${item.slug}">Download</a>
          </li>
        `).join("")}
      </ul>
    </main>
  </body>
</html>`;
