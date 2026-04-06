import type { RequestHandler, SecurityHeadersMiddlewareOptions } from "../internal/shared/types";

export function securityHeaders(
  options: SecurityHeadersMiddlewareOptions = {},
): RequestHandler {
  const contentSecurityPolicy = options.contentSecurityPolicy ?? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'";
  const crossOriginOpenerPolicy = options.crossOriginOpenerPolicy ?? "same-origin";
  const dnsPrefetchControl = options.dnsPrefetchControl ?? false;
  const frameOptions = options.frameOptions ?? "SAMEORIGIN";
  const referrerPolicy = options.referrerPolicy ?? "strict-origin-when-cross-origin";
  const xContentTypeOptions = options.xContentTypeOptions ?? true;

  return async (_request, response, next) => {
    if (contentSecurityPolicy) {
      response.set("content-security-policy", contentSecurityPolicy);
    }

    if (crossOriginOpenerPolicy) {
      response.set("cross-origin-opener-policy", crossOriginOpenerPolicy);
    }

    if (frameOptions) {
      response.set("x-frame-options", frameOptions);
    }

    if (referrerPolicy) {
      response.set("referrer-policy", referrerPolicy);
    }

    response.set("x-dns-prefetch-control", dnsPrefetchControl ? "on" : "off");

    if (xContentTypeOptions) {
      response.set("x-content-type-options", "nosniff");
    }

    await next();
  };
}
