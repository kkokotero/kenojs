import { threadId } from "node:worker_threads";

import keno from "keno";

const app = keno();

app.get("/", (_request, response) => {
  response.type("html").send(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Keno Thread Cluster Worker</title>
      <style>
        body { font-family: "IBM Plex Sans", sans-serif; margin: 40px; color: #17324d; }
        article { max-width: 720px; padding: 24px; border-radius: 18px; background: #f7fbff; }
      </style>
    </head>
    <body>
      <article>
        <h1>Thread cluster worker</h1>
        <p>Refresh this page several times and inspect <code>/health</code> to see different workers replying.</p>
      </article>
    </body>
  </html>`);
});

app.get("/health", (_request, response) => {
  response.json({
    pid: process.pid,
    status: "ok",
    threadId,
  });
});

export default app;
