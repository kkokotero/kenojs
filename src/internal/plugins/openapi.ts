import type { OpenApiPluginOptions } from "../shared/types";

import { definePlugin } from "./define";

export const openApiPlugin = definePlugin<OpenApiPluginOptions>((app, options) => {
  const jsonPath = options.jsonPath ?? "/openapi.json";
  const docsPath = options.docsPath ?? "/docs";
  const title = options.title ?? "Keno API Docs";

  app.get(jsonPath, (request, response) => {
    response.json(buildDocument(options.document, request.origin));
  });

  if (docsPath !== false) {
    app.get(docsPath, (_request, response) => {
      response.type("html").send(renderDocsHtml(title, jsonPath));
    });
  }
}, {
  name: "openapi",
});

function buildDocument(document: Record<string, unknown>, origin: string): Record<string, unknown> {
  if ("servers" in document) {
    return document;
  }

  return {
    ...document,
    servers: [{ url: origin }],
  };
}

function renderDocsHtml(title: string, jsonPath: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f8fbff;
        color: #17324d;
      }

      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      article {
        background: #ffffff;
        border-radius: 18px;
        padding: 18px 20px;
        box-shadow: 0 14px 36px rgba(23, 50, 77, 0.08);
        margin-top: 16px;
      }

      code, pre {
        font-family: "IBM Plex Mono", monospace;
      }

      pre {
        padding: 14px;
        border-radius: 14px;
        background: #17324d;
        color: #eef6ff;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>Served by Keno's built-in OpenAPI plugin.</p>
      <div id="content">Loading...</div>
    </main>
    <script>
      const content = document.querySelector("#content");

      fetch(${JSON.stringify(jsonPath)})
        .then((response) => response.json())
        .then((document) => {
          const paths = Object.entries(document.paths ?? {});

          content.innerHTML = paths.map(([path, operations]) => {
            const operationHtml = Object.entries(operations).map(([method, details]) => {
              return \`<li><strong>\${method.toUpperCase()}</strong> \${path} <br><small>\${details.summary ?? ""}</small></li>\`;
            }).join("");

            return \`<article><h2>\${path}</h2><ul>\${operationHtml}</ul></article>\`;
          }).join("") || "<pre>No paths defined in the OpenAPI document.</pre>";
        })
        .catch((error) => {
          content.innerHTML = \`<pre>\${String(error)}</pre>\`;
        });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
