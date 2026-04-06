import { isMainThread, threadId } from "node:worker_threads";

import keno from "../../dist/index.js";

const app = keno();

app.get("/threaded", (_request, response) => {
  response.json({
    isMainThread,
    threadId,
  });
});

export { app };
export default app;
