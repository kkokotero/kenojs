import type { CorsMiddlewareOptions, RequestHandler } from "../internal/shared/types";

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function cors(options: CorsMiddlewareOptions = {}): RequestHandler {
  const allowMethods = normalizeHeaderValue(options.allowMethods) ?? DEFAULT_METHODS.join(", ");
  const allowHeaders = normalizeHeaderValue(options.allowHeaders);
  const exposeHeaders = normalizeHeaderValue(options.exposeHeaders);

  return async (request, response, next) => {
    const origin = request.get("origin");
    const allowedOrigin = resolveAllowedOrigin(options.allowOrigin, origin);

    if (allowedOrigin) {
      response.set("access-control-allow-origin", allowedOrigin);
      response.vary("origin");
    }

    if (options.allowCredentials) {
      response.set("access-control-allow-credentials", "true");
    }

    if (allowMethods) {
      response.set("access-control-allow-methods", allowMethods);
    }

    if (exposeHeaders) {
      response.set("access-control-expose-headers", exposeHeaders);
    }

    if (options.maxAge !== undefined) {
      response.set("access-control-max-age", String(options.maxAge));
    }

    if (request.method === "OPTIONS" && request.get("access-control-request-method")) {
      response.set(
        "access-control-allow-headers",
        allowHeaders ?? request.get("access-control-request-headers") ?? "",
      );
      response.status(204).end();
      return;
    }

    await next();
  };
}

function normalizeHeaderValue(value: readonly string[] | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.join(", ");
}

function resolveAllowedOrigin(
  rule: CorsMiddlewareOptions["allowOrigin"],
  origin: string | undefined,
): string | undefined {
  if (rule === false) {
    return undefined;
  }

  if (rule === undefined || rule === true) {
    return origin ?? "*";
  }

  if (typeof rule === "string") {
    return rule;
  }

  if (Array.isArray(rule)) {
    return origin && rule.includes(origin) ? origin : undefined;
  }

  if (rule instanceof RegExp) {
    return origin && rule.test(origin) ? origin : undefined;
  }

  return undefined;
}
