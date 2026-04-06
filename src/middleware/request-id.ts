import { randomUUID } from "node:crypto";

import type { RequestHandler, RequestIdMiddlewareOptions } from "../internal/shared/types";

export function requestId(options: RequestIdMiddlewareOptions = {}): RequestHandler {
  const headerName = (options.headerName ?? "x-request-id").toLowerCase();
  const generator = options.generator ?? randomUUID;
  const exposeHeader = options.exposeHeader ?? true;

  return async (request, response, next) => {
    const current = request.get(headerName);
    const value = current && current.trim() ? current : generator();

    response.locals.requestId = value;

    if (exposeHeader) {
      response.set(headerName, value);
    }

    await next();
  };
}
