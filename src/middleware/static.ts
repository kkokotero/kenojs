import type { RequestHandler, StaticMiddlewareOptions } from "../internal/shared/types";

import { createStaticHandler } from "../internal/http/static-service";

export function serveStatic(root: string, options: StaticMiddlewareOptions = {}): RequestHandler {
  return createStaticHandler(root, options);
}
