import type { IncomingHttpHeaders, OutgoingHttpHeaders, ServerHttp2Stream } from "node:http2";
import { Writable } from "node:stream";

import type { MinimalNodeRequest, MinimalNodeResponse } from "../shared/types";

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function isExtendedConnectWebSocketRequest(headers: IncomingHttpHeaders): boolean {
  const method = getHeaderValue(headers, ":method");
  const protocol = getHeaderValue(headers, ":protocol");

  return method?.toUpperCase() === "CONNECT" && protocol?.toLowerCase() === "websocket";
}

export function createHttp2StreamRequest(
  stream: ServerHttp2Stream,
  headers: IncomingHttpHeaders,
): MinimalNodeRequest {
  const authority = getHeaderValue(headers, ":authority") ?? getHeaderValue(headers, "host") ?? "";
  const requestHeaders: MinimalNodeRequest["headers"] = {
    ...headers,
    host: authority,
  };

  return {
    destroy(error?: Error): void {
      stream.destroy(error);
    },
    headers: requestHeaders,
    httpVersion: "2.0",
    httpVersionMajor: 2,
    method: getHeaderValue(headers, ":method")?.toUpperCase() ?? "GET",
    on(event, listener) {
      stream.on(event, listener);
      return this;
    },
    once(event, listener) {
      stream.once(event, listener);
      return this;
    },
    socket: stream.session?.socket ?? stream,
    url: getHeaderValue(headers, ":path") ?? "/",
  };
}

export class Http2StreamResponse extends Writable implements MinimalNodeResponse {
  headersSent = false;
  statusCode = 200;

  private readonly headers = new Map<string, number | string | string[]>();

  constructor(private readonly stream: ServerHttp2Stream) {
    super();
    stream.on("close", () => {
      if (!this.destroyed) {
        this.destroy();
      }
    });
  }

  getHeader(name: string): number | string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  setHeader(name: string, value: number | string | readonly string[]): void {
    const normalized: number | string | string[] =
      typeof value === "number" || typeof value === "string"
        ? value
        : [...value];
    this.headers.set(name.toLowerCase(), normalized);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.respond();
    this.stream.end();
    callback();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.respond();

    if (typeof chunk === "string") {
      this.stream.write(chunk, encoding, callback);
      return;
    }

    this.stream.write(chunk, callback);
  }

  private respond(): void {
    if (this.headersSent || this.stream.destroyed || this.stream.closed) {
      return;
    }

    const headers: OutgoingHttpHeaders = {
      ":status": this.statusCode,
    };

    for (const [name, value] of this.headers) {
      headers[name] = value;
    }

    this.stream.respond(headers);
    this.headersSent = true;
  }
}
