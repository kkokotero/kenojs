import { statusMessage } from "./status";

export class HttpError extends Error {
  readonly expose: boolean;
  readonly headers: Record<string, string> | undefined;
  readonly statusCode: number;

  constructor(
    statusCode: number,
    message = statusMessage(statusCode),
    options: { expose?: boolean; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.expose = options.expose ?? statusCode < 500;
    this.headers = options.headers;
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
