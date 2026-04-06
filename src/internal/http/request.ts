import { EMPTY_ROUTE_PARAMS } from "../shared/constants";
import { HttpError } from "../shared/errors";
import { negotiateMedia, negotiateToken, matchesMime } from "../shared/media";
import { safeJsonParse } from "../shared/safe-json";
import { parseCookies } from "../shared/cookies";
import type {
  RawRequest,
  RequestScheme,
  RequestTransport,
  RouteParams,
  SizeInput,
} from "../shared/types";
import { inferTransport, parseSize, toHeaderValue } from "../shared/utils";

interface RequestScope {
  baseUrl: string;
  params: RouteParams;
  routePath: string | undefined;
}

interface BodyCache {
  buffer?: Buffer;
  bufferPromise?: Promise<Buffer>;
  json?: unknown;
  text?: string;
}

function buildQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const current = query[key];

    if (current === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }

    query[key] = [current, value];
  }

  return query;
}

export class KenoRequest<Params extends RouteParams = RouteParams> {
  body: unknown;
  readonly headers: RawRequest["headers"];
  readonly httpVersion: string;
  readonly httpVersionMajor: number;
  readonly method: string;
  readonly originalUrl: string;
  readonly raw: RawRequest;
  readonly scheme: RequestScheme;
  readonly secure: boolean;
  readonly transport: RequestTransport;
  readonly url: string;

  private readonly bodyCache: BodyCache = {};
  private cookiesValue: Readonly<Record<string, string>> | undefined;
  private hostValue: string | undefined;
  private parsedHost: { hostname: string; port?: number } | undefined;
  private parsedUrl:
    | {
        path: string;
        search: string;
      }
    | undefined;
  private queryValue: Readonly<Record<string, string | string[]>> | undefined;
  private searchParamsValue: URLSearchParams | undefined;
  private scope: RequestScope = {
    baseUrl: "",
    params: EMPTY_ROUTE_PARAMS,
    routePath: undefined,
  };

  constructor(raw: RawRequest) {
    const secure = Boolean((raw.socket as { encrypted?: boolean }).encrypted);

    this.raw = raw;
    this.originalUrl = raw.url ?? "/";
    this.url = this.originalUrl;
    this.method = (raw.method ?? "GET").toUpperCase();
    this.headers = raw.headers;
    this.httpVersion = raw.httpVersion;
    this.httpVersionMajor = raw.httpVersionMajor;
    this.secure = secure;
    this.scheme = secure ? "https" : "http";
    this.transport = inferTransport(raw.httpVersionMajor, secure);
  }

  get baseUrl(): string {
    return this.scope.baseUrl;
  }

  get params(): Readonly<Params> {
    return this.scope.params as Params;
  }

  get routePath(): string | undefined {
    return this.scope.routePath;
  }

  get ip(): string | undefined {
    return "remoteAddress" in this.raw.socket ? this.raw.socket.remoteAddress : undefined;
  }

  get protocol(): RequestScheme {
    return this.scheme;
  }

  get host(): string {
    if (this.hostValue !== undefined) {
      return this.hostValue;
    }

    const value = this.headers.host;
    this.hostValue = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
    return this.hostValue ?? "";
  }

  get hostname(): string {
    return this.getParsedHost().hostname;
  }

  get origin(): string {
    const host = this.host || "localhost";
    return `${this.scheme}://${host}`;
  }

  get port(): number | undefined {
    const { port } = this.getParsedHost();

    if (port !== undefined) {
      return port;
    }

    return "localPort" in this.raw.socket ? this.raw.socket.localPort : undefined;
  }

  get path(): string {
    return this.getParsedUrl().path;
  }

  get search(): string {
    return this.getParsedUrl().search;
  }

  get searchParams(): URLSearchParams {
    if (this.searchParamsValue) {
      return this.searchParamsValue;
    }

    this.searchParamsValue = new URLSearchParams(this.search);
    return this.searchParamsValue;
  }

  get query(): Readonly<Record<string, string | string[]>> {
    if (this.queryValue) {
      return this.queryValue;
    }

    this.queryValue = buildQuery(this.searchParams);
    return this.queryValue;
  }

  get cookies(): Readonly<Record<string, string>> {
    if (this.cookiesValue) {
      return this.cookiesValue;
    }

    this.cookiesValue = parseCookies(this.get("cookie"));
    return this.cookiesValue;
  }

  get xhr(): boolean {
    return this.get("x-requested-with")?.toLowerCase() === "xmlhttprequest";
  }

  get hasBody(): boolean {
    const contentLength = this.get("content-length");
    const transferEncoding = this.get("transfer-encoding");
    return Boolean((contentLength && contentLength !== "0") || transferEncoding);
  }

  get(name: string): string | undefined {
    const value = this.headers[toHeaderValue(name)];

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    return value;
  }

  header(name: string): string | undefined {
    return this.get(name);
  }

  cookie(name: string): string | undefined {
    return this.cookies[name];
  }

  param(name: string, fallback?: string): string | undefined {
    const fromParams = this.scope.params[name];

    if (fromParams !== undefined) {
      return fromParams;
    }

    const fromQuery = this.query[name];

    if (typeof fromQuery === "string") {
      return fromQuery;
    }

    if (Array.isArray(fromQuery)) {
      return fromQuery[0];
    }

    if (this.body && typeof this.body === "object" && name in this.body) {
      const value = (this.body as Record<string, unknown>)[name];
      return value === undefined ? fallback : String(value);
    }

    return fallback;
  }

  accepts(...types: string[]): string | false {
    return negotiateMedia(this.get("accept"), types);
  }

  acceptsCharsets(...charsets: string[]): string | false {
    return negotiateToken(this.get("accept-charset"), charsets, (value) => value.toLowerCase());
  }

  acceptsEncodings(...encodings: string[]): string | false {
    return negotiateToken(this.get("accept-encoding"), encodings, (value) => value.toLowerCase());
  }

  acceptsLanguages(...languages: string[]): string | false {
    return negotiateToken(this.get("accept-language"), languages, (value) => value.toLowerCase());
  }

  is(...types: string[]): string | false {
    const contentType = this.get("content-type");

    if (!contentType) {
      return false;
    }

    for (const type of types) {
      if (matchesMime(contentType, type)) {
        return type;
      }
    }

    return false;
  }

  async buffer(options: { limit?: SizeInput } = {}): Promise<Buffer> {
    if (this.bodyCache.buffer) {
      return this.bodyCache.buffer;
    }

    if (this.bodyCache.bufferPromise) {
      return this.bodyCache.bufferPromise;
    }

    const limit = parseSize(options.limit, 1024 * 1024);
    const contentLength = this.get("content-length");

    if (contentLength && Number.parseInt(contentLength, 10) > limit) {
      throw new HttpError(413, "Request entity too large");
    }

    this.bodyCache.bufferPromise = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      this.raw.on("data", (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        total += buffer.length;

        if (total > limit) {
          reject(new HttpError(413, "Request entity too large"));
          this.raw.destroy();
          return;
        }

        chunks.push(buffer);
      });

      this.raw.once("error", reject);
      this.raw.once("aborted", () => reject(new HttpError(400, "Request aborted")));
      this.raw.once("end", () => {
        const payload = Buffer.concat(chunks);
        this.bodyCache.buffer = payload;
        resolve(payload);
      });
    });

    return this.bodyCache.bufferPromise;
  }

  async text(options: { limit?: SizeInput } = {}): Promise<string> {
    if (this.bodyCache.text !== undefined) {
      return this.bodyCache.text;
    }

    const buffer = await this.buffer(options);
    const value = buffer.toString("utf8");
    this.bodyCache.text = value;
    return value;
  }

  async json<T>(options: { limit?: SizeInput } = {}): Promise<T> {
    if (this.bodyCache.json !== undefined) {
      return this.bodyCache.json as T;
    }

    const text = await this.text(options);

    try {
      const value = safeJsonParse<T>(text);
      this.bodyCache.json = value;
      return value;
    } catch {
      throw new HttpError(400, "Invalid JSON payload");
    }
  }

  snapshot(): RequestScope {
    return {
      baseUrl: this.scope.baseUrl,
      params: this.scope.params,
      routePath: this.scope.routePath,
    };
  }

  restore(scope: RequestScope): void {
    this.scope = scope;
  }

  setScope(scope: RequestScope): void {
    this.scope = scope;
  }

  private getParsedHost(): { hostname: string; port?: number } {
    if (this.parsedHost) {
      return this.parsedHost;
    }

    this.parsedHost = parseHost(this.host);
    return this.parsedHost;
  }

  private getParsedUrl(): { path: string; search: string } {
    if (this.parsedUrl) {
      return this.parsedUrl;
    }

    this.parsedUrl = parseUrl(this.originalUrl);
    return this.parsedUrl;
  }
}

function parseUrl(value: string): { path: string; search: string } {
  const hashIndex = value.indexOf("#");
  const cleanValue = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const searchIndex = cleanValue.indexOf("?");

  if (searchIndex === -1) {
    return {
      path: normalizeRequestPath(cleanValue),
      search: "",
    };
  }

  return {
    path: normalizeRequestPath(cleanValue.slice(0, searchIndex)),
    search: cleanValue.slice(searchIndex),
  };
}

function parseHost(value: string | undefined): { hostname: string; port?: number } {
  if (!value) {
    return { hostname: "" };
  }

  const first = value.split(",")[0]?.trim() ?? "";

  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    const hostname = (end === -1 ? first : first.slice(1, end)).toLowerCase();
    const portText = first.slice(end + 2);
    const port = portText ? Number.parseInt(portText, 10) : undefined;
    return port === undefined ? { hostname } : { hostname, port };
  }

  const lastColon = first.lastIndexOf(":");

  if (lastColon > -1 && first.indexOf(":") === lastColon) {
    const hostname = first.slice(0, lastColon).toLowerCase();
    const port = Number.parseInt(first.slice(lastColon + 1), 10);
    return Number.isNaN(port) ? { hostname } : { hostname, port };
  }

  return { hostname: first.toLowerCase() };
}

function normalizeRequestPath(value: string): string {
  if (value === "") {
    return "/";
  }

  return value.startsWith("/") ? value : `/${value}`;
}
