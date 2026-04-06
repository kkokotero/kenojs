import { HttpError } from "../internal/shared/errors";
import type { JsonParserOptions, RequestHandler } from "../internal/shared/types";

export function json(options: JsonParserOptions = {}): RequestHandler {
  const { strict = true } = options;

  return async (request, _response, next) => {
    const contentType = request.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      await next();
      return;
    }

    const payload = await request.json(
      options.limit === undefined ? {} : { limit: options.limit },
    );

    if (strict && payload !== null && typeof payload !== "object") {
      throw new HttpError(400, "JSON payload must be an object or an array");
    }

    request.body = payload;
    await next();
  };
}
