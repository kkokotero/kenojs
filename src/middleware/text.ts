import type { RequestHandler, TextParserOptions } from "../internal/shared/types";

export function text(options: TextParserOptions = {}): RequestHandler {
  const expectedType = options.defaultType ?? "text/plain";

  return async (request, _response, next) => {
    const contentType = request.get("content-type") ?? "";

    if (!contentType.includes(expectedType)) {
      await next();
      return;
    }

    request.body = await request.text(
      options.limit === undefined ? {} : { limit: options.limit },
    );
    await next();
  };
}
