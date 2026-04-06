import { performance } from "node:perf_hooks";

import type { RequestLoggerEntry, RequestLoggerPluginOptions } from "../shared/types";
import type { RequestHandler } from "../shared/types";

import { definePlugin } from "./define";

export const requestLoggerPlugin = definePlugin<RequestLoggerPluginOptions>((app, options = {}) => {
  const ignored = new Set(options.ignorePaths ?? []);
  const log = options.logger ?? defaultLogger;
  const requestIdHeader = (options.requestIdHeader ?? "x-request-id").toLowerCase();

  const middleware: RequestHandler = (request, response, next) => {
    if (ignored.has(request.path)) {
      return next();
    }

    const startedAt = performance.now();
    const finalize = () => {
      const requestId =
        typeof response.locals.requestId === "string"
          ? response.locals.requestId
          : request.get(requestIdHeader);
      const entry: RequestLoggerEntry = {
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        ...(requestId ? { requestId } : {}),
      };

      log(entry);
    };

    response.raw.once("finish", finalize);
    return next();
  };

  app.use(middleware);
}, {
  name: "request-logger",
});

function defaultLogger(entry: RequestLoggerEntry): void {
  console.info(
    `${entry.method} ${entry.path} ${entry.statusCode} ${entry.durationMs}ms` +
      (entry.requestId ? ` requestId=${entry.requestId}` : ""),
  );
}
