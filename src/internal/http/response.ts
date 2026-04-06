import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import type { CookieOptions, RawResponse, SendFileOptions } from "../shared/types";

import { serializeCookie } from "../shared/cookies";
import { HttpError } from "../shared/errors";
import { extensionToMime, filePathToMime } from "../shared/media";
import { statusMessage } from "../shared/status";
import { toBuffer } from "../shared/utils";
import type { KenoRequest } from "./request";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

export class KenoResponse {
  readonly raw: RawResponse;
  private localsValue: Record<string, unknown> | undefined;

  constructor(
    raw: RawResponse,
    private readonly request: KenoRequest,
  ) {
    this.raw = raw;
  }

  get locals(): Record<string, unknown> {
    if (this.localsValue) {
      return this.localsValue;
    }

    this.localsValue = {};
    return this.localsValue;
  }

  get finished(): boolean {
    return this.raw.writableEnded || this.raw.destroyed;
  }

  get headersSent(): boolean {
    return this.raw.headersSent;
  }

  get statusCode(): number {
    return this.raw.statusCode;
  }

  status(code: number): this {
    this.raw.statusCode = code;
    return this;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  set(name: string | Record<string, string>, value?: string): this {
    if (typeof name === "string") {
      if (value === undefined) {
        return this;
      }

      this.raw.setHeader(name, value);
      return this;
    }

    for (const [header, headerValue] of Object.entries(name)) {
      this.raw.setHeader(header, headerValue);
    }

    return this;
  }

  get(name: string): number | string | string[] | undefined {
    return this.raw.getHeader(name);
  }

  append(name: string, value: string | readonly string[]): this {
    const current = this.get(name);
    const values = Array.isArray(value) ? [...value] : [value];

    if (current === undefined) {
      this.raw.setHeader(name, values.length === 1 ? values[0] ?? "" : values);
      return this;
    }

    if (Array.isArray(current)) {
      this.raw.setHeader(name, [...current, ...values]);
      return this;
    }

    this.raw.setHeader(name, [String(current), ...values]);
    return this;
  }

  remove(name: string): this {
    this.raw.removeHeader(name);
    return this;
  }

  type(value: string): this {
    this.raw.setHeader("content-type", extensionToMime(value));
    return this;
  }

  location(value: string): this {
    this.set("location", value);
    return this;
  }

  links(values: Record<string, string>): this {
    const headerValue = Object.entries(values)
      .map(([relation, location]) => `<${location}>; rel="${relation}"`)
      .join(", ");

    if (headerValue) {
      this.append("link", headerValue);
    }

    return this;
  }

  vary(field: string): this {
    const current = this.get("vary");

    if (!current) {
      this.set("vary", field);
      return this;
    }

    const entries = new Set(
      String(current)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );

    entries.add(field);
    this.set("vary", [...entries].join(", "));
    return this;
  }

  cookie(name: string, value: string, options: CookieOptions = {}): this {
    this.append("set-cookie", serializeCookie(name, value, options));
    return this;
  }

  clearCookie(name: string, options: Omit<CookieOptions, "expires" | "maxAge"> = {}): this {
    return this.cookie(name, "", {
      ...options,
      expires: new Date(0),
      maxAge: 0,
    });
  }

  attachment(filename?: string): this {
    if (filename) {
      const resolvedType = filePathToMime(filename);

      if (resolvedType && !this.get("content-type")) {
        this.type(resolvedType);
      }

      this.set("content-disposition", `attachment; filename="${basename(filename)}"`);
      return this;
    }

    this.set("content-disposition", "attachment");
    return this;
  }

  json(payload: unknown): this {
    const body = JSON.stringify(payload) ?? "null";

    if (this.raw.getHeader("content-type") === undefined) {
      this.raw.setHeader("content-type", JSON_CONTENT_TYPE);
    }

    return this.sendRaw(body, Buffer.byteLength(body));
  }

  send(payload?: unknown): this {
    if (payload === undefined) {
      return this.end();
    }

    if (
      typeof payload === "string" ||
      payload instanceof Uint8Array ||
      payload instanceof ArrayBuffer ||
      ArrayBuffer.isView(payload)
    ) {
      if (this.raw.getHeader("content-type") === undefined) {
        this.raw.setHeader(
          "content-type",
          typeof payload === "string" ? TEXT_CONTENT_TYPE : "application/octet-stream",
        );
      }

      if (typeof payload === "string") {
        return this.sendRaw(payload, Buffer.byteLength(payload));
      }

      const buffer = toBuffer(payload);
      return this.sendRaw(buffer, buffer.byteLength);
    }

    if (typeof payload === "object") {
      return this.json(payload);
    }

    const body = String(payload);

    if (this.raw.getHeader("content-type") === undefined) {
      this.raw.setHeader("content-type", TEXT_CONTENT_TYPE);
    }

    return this.sendRaw(body, Buffer.byteLength(body));
  }

  redirect(location: string, status = 302): this {
    this.status(status);
    this.location(location);
    return this.send(`${status} ${statusMessage(status)}. Redirecting to ${location}`);
  }

  sendStatus(code: number): this {
    this.status(code);
    this.raw.setHeader("content-type", TEXT_CONTENT_TYPE);
    return this.send(statusMessage(code));
  }

  end(payload?: string | Uint8Array | ArrayBuffer | ArrayBufferView): this {
    if (payload === undefined) {
      this.raw.end();
      return this;
    }

    if (typeof payload === "string") {
      return this.sendRaw(payload, Buffer.byteLength(payload));
    }

    const buffer = toBuffer(payload);
    return this.sendRaw(buffer, buffer.byteLength);
  }

  async sendFile(pathname: string, options: SendFileOptions = {}): Promise<this> {
    const details = options.stat ?? await stat(pathname).catch(() => undefined);
    const raw = this.raw;
    const buffer = options.buffer;

    if (!details || ("isFile" in details && typeof details.isFile === "function" && !details.isFile())) {
      throw new HttpError(404, `File not found: ${pathname}`);
    }

    if (raw.getHeader("content-type") === undefined) {
      raw.setHeader(
        "content-type",
        options.contentType ?? filePathToMime(pathname) ?? "application/octet-stream",
      );
    }

    raw.setHeader("content-length", buffer?.byteLength ?? details.size);

    if (options.cacheControl ?? true) {
      raw.setHeader("cache-control", "public, max-age=0");
    }

    if (options.lastModified ?? true) {
      raw.setHeader("last-modified", details.mtime.toUTCString());
    }

    if (options.etag ?? true) {
      raw.setHeader("etag", createWeakEtag(details.size, details.mtimeMs));
    }

    if (this.request.method === "HEAD") {
      this.raw.end();
      return this;
    }

    if (buffer) {
      raw.end(buffer);
      return this;
    }

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(pathname);

      stream.on("error", reject);
      this.raw.once("error", reject);
      this.raw.once("finish", () => resolve());
      stream.pipe(this.raw as NodeJS.WritableStream);
    });

    return this;
  }

  async download(pathname: string, filename?: string): Promise<this> {
    this.attachment(filename ?? pathname);
    return this.sendFile(pathname);
  }

  private sendRaw(payload: Buffer | string, length: number): this {
    if (this.raw.getHeader("content-length") === undefined) {
      this.raw.setHeader("content-length", length);
    }

    if (this.request.method === "HEAD") {
      this.raw.end();
      return this;
    }

    this.raw.end(payload);
    return this;
  }
}

function createWeakEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}
