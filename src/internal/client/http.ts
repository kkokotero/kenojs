import type { MaybePromise, PathParams } from "../shared/types";

export type HttpClientMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

export type HttpClientQueryPrimitive = boolean | Date | number | string | bigint | null | undefined;
export type HttpClientQueryValue =
  | HttpClientQueryPrimitive
  | readonly HttpClientQueryPrimitive[];

export type HttpClientPathParams = Record<string, boolean | number | string | bigint>;
export type HttpClientQuery = Record<string, HttpClientQueryValue>;

export interface HttpClientRouteDefinition<
  Response = unknown,
  Body = never,
  Query = never,
  Params = never,
> {
  body?: Body;
  params?: Params;
  query?: Query;
  response: Response;
}

export type HttpClientEndpoint<
  Response = unknown,
  Body = never,
  Query = never,
  Params = never,
> = HttpClientRouteDefinition<Response, Body, Query, Params>;

export type HttpClientSchema = Record<
  string,
  Partial<Record<HttpClientMethod, HttpClientRouteDefinition<any, any, any, any>>>
>;

export interface HttpClientRouteContract<
  Path extends string = string,
  Methods extends Partial<Record<HttpClientMethod, HttpClientRouteDefinition<any, any, any, any>>> = Partial<
    Record<HttpClientMethod, HttpClientRouteDefinition<any, any, any, any>>
  >,
> {
  methods: Methods;
  path: Path;
}

export type HttpClientSchemaFromRoutes<
  Routes extends readonly HttpClientRouteContract<string, any>[],
> = {
  [Route in Routes[number] as Route["path"]]: Route["methods"];
};

export function defineHttpEndpoint<
  Response = unknown,
  Body = never,
  Query = never,
  Params = never,
>(): HttpClientEndpoint<Response, Body, Query, Params> {
  return {} as HttpClientEndpoint<Response, Body, Query, Params>;
}

export function defineHttpRoute<
  Path extends string,
  Methods extends Partial<Record<HttpClientMethod, HttpClientRouteDefinition<any, any, any, any>>>,
>(
  path: Path,
  methods: Methods,
): HttpClientRouteContract<Path, Methods> {
  return {
    methods,
    path,
  };
}

export function defineHttpRoutes<
  const Routes extends readonly HttpClientRouteContract<string, any>[],
>(...routes: Routes): Routes {
  return routes;
}

export function defineHttpSchema<const Schema extends HttpClientSchema>(
  schema: Schema,
): Schema {
  return schema;
}

export interface HttpClientRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  delay?: "constant" | "exponential" | ((attempt: number) => number);
  jitter?: boolean;
  maxDelayMs?: number;
  methods?: readonly HttpClientMethod[];
  statuses?: readonly number[];
}

export interface HttpClientRequestOptions<
  Body = unknown,
  Query extends HttpClientQuery = HttpClientQuery,
  Params extends HttpClientPathParams = HttpClientPathParams,
> {
  body?: Body;
  headers?: HeadersInit;
  params?: Params;
  query?: Query;
  retry?: false | HttpClientRetryOptions;
  signal?: AbortSignal;
  timeout?: number;
  timeoutMs?: number;
}

export interface HttpClientOptions<Schema extends HttpClientSchema = HttpClientSchema> {
  baseURL?: string | URL;
  baseUrl?: string | URL;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
  middleware?: readonly HttpClientMiddleware<Schema>[];
  retry?: HttpClientRetryOptions;
  timeout?: number;
  timeoutMs?: number;
}

export interface HttpClientPreparedSendOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeout?: number;
  timeoutMs?: number;
}

export interface HttpClientMiddlewareContext<Schema extends HttpClientSchema = HttpClientSchema> {
  attempt: number;
  client: HttpClient<Schema>;
  request: Request;
}

export type HttpClientMiddleware<Schema extends HttpClientSchema = HttpClientSchema> = (
  context: HttpClientMiddlewareContext<Schema>,
  next: () => Promise<HttpClientResponse>,
) => MaybePromise<HttpClientResponse>;

type ResolvedRetryOptions = {
  attempts: number;
  baseDelayMs: number;
  delay: "constant" | "exponential" | ((attempt: number) => number);
  jitter: boolean;
  maxDelayMs: number;
  methods: ReadonlySet<HttpClientMethod>;
  statuses: ReadonlySet<number>;
};

type HttpClientExpectation =
  | {
      kind: "none";
    }
  | {
      kind: "ok";
    }
  | {
      kind: "status";
      statuses: readonly number[];
    };

type RouteFor<
  Schema extends HttpClientSchema,
  Path extends string,
  Method extends HttpClientMethod,
> = Path extends keyof Schema
  ? Method extends keyof Schema[Path]
    ? NonNullable<Schema[Path][Method]>
    : never
  : never;

type PathsForMethod<
  Schema extends HttpClientSchema,
  Method extends HttpClientMethod,
> = Extract<{
  [Path in keyof Schema]: Method extends keyof Schema[Path]
    ? Path
    : never;
}[keyof Schema], string>;

type RouteBody<Route> = Route extends { body?: infer Body }
  ? Exclude<Body, undefined>
  : never;

type RouteQuery<Route> = Route extends { query?: infer Query }
  ? Exclude<Query, undefined>
  : never;

type RouteParams<Path extends string, Route> = [Route extends { params?: infer Params }
  ? Exclude<Params, undefined>
  : never] extends [never]
  ? PathParams<Path> & HttpClientPathParams
  : Route extends { params?: infer Params }
    ? Exclude<Params, undefined> & HttpClientPathParams
    : never;

type RouteResponse<Route> = Route extends { response: infer Response }
  ? Response
  : unknown;

type Expand<T> = T extends infer Resolved
  ? { [Key in keyof Resolved]: Resolved[Key] }
  : never;

type OptionalField<Key extends string, Value> = [Value] extends [never]
  ? {}
  : keyof Value extends never
    ? {}
    : { [Property in Key]?: Value };

type RequiredField<Key extends string, Value> = [Value] extends [never]
  ? {}
  : keyof Value extends never
    ? {}
    : { [Property in Key]: Value };

export type HttpClientTypedRequestOptions<
  Path extends string,
  Route,
> = Expand<
  Omit<HttpClientRequestOptions, "body" | "params" | "query"> &
  RequiredField<"params", RouteParams<Path, Route>> &
  OptionalField<"body", RouteBody<Route>> &
  OptionalField<"query", RouteQuery<Route>>
>;

const DEFAULT_RETRYABLE_METHODS = new Set<HttpClientMethod>([
  "GET",
  "HEAD",
  "OPTIONS",
]);

const DEFAULT_RETRYABLE_STATUSES = new Set<number>([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const NO_EXPECTATION: HttpClientExpectation = {
  kind: "none",
};

const OK_EXPECTATION: HttpClientExpectation = {
  kind: "ok",
};

export class HttpClientError extends Error {
  readonly request: Request;
  readonly response: HttpClientResponse | undefined;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: {
      request: Request;
      response?: HttpClientResponse;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = "HttpClientError";
    this.request = options.request;
    this.response = options.response;
    this.status = options.response?.status;
  }
}

export class HttpClientResponse {
  constructor(
    readonly raw: Response,
    readonly request: Request,
    readonly attempts: number,
  ) {}

  get headers(): Headers {
    return this.raw.headers;
  }

  get ok(): boolean {
    return this.raw.ok;
  }

  get redirected(): boolean {
    return this.raw.redirected;
  }

  get status(): number {
    return this.raw.status;
  }

  get statusText(): string {
    return this.raw.statusText;
  }

  get url(): string {
    return this.raw.url;
  }

  clone(): HttpClientResponse {
    return new HttpClientResponse(this.raw.clone(), this.request.clone(), this.attempts);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.raw.arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async json<T = unknown>(): Promise<T> {
    const payload = await this.raw.text();

    if (!payload.trim()) {
      return undefined as T;
    }

    return JSON.parse(payload) as T;
  }

  stream(): ReadableStream<Uint8Array> {
    if (!this.raw.body) {
      throw new TypeError("Response body is not available as a stream");
    }

    return this.raw.body;
  }

  async text(): Promise<string> {
    return this.raw.text();
  }
}

export class HttpClientPreparedRequest {
  constructor(
    readonly url: URL,
    readonly method: HttpClientMethod,
    readonly headers: Headers,
    private readonly body: BodyInit | undefined,
    private readonly defaultFetch: typeof globalThis.fetch,
    private readonly baseSignal: AbortSignal | undefined,
    private readonly defaultTimeout: number | undefined,
  ) {}

  get request(): Request {
    return createRequest(
      this.url,
      this.method,
      this.headers,
      this.body,
      this.baseSignal,
    );
  }

  clone(): HttpClientPreparedRequest {
    return new HttpClientPreparedRequest(
      new URL(this.url),
      this.method,
      new Headers(this.headers),
      this.body,
      this.defaultFetch,
      this.baseSignal,
      this.defaultTimeout,
    );
  }

  toRequest(options: HttpClientPreparedSendOptions = {}): Request {
    return createRequest(
      this.url,
      this.method,
      this.headers,
      this.body,
      options.signal ?? this.baseSignal,
    );
  }

  async fetch(options: HttpClientPreparedSendOptions = {}): Promise<Response> {
    const fetchImpl = options.fetch ?? this.defaultFetch;
    const signalState = createRequestSignal(
      options.signal ?? this.baseSignal,
      resolveTimeout(options.timeout, options.timeoutMs) ?? this.defaultTimeout,
    );
    const request = createRequest(
      this.url,
      this.method,
      this.headers,
      this.body,
      signalState.signal,
    );

    try {
      return await fetchImpl(request);
    } finally {
      signalState.cleanup();
    }
  }

  async response(options: HttpClientPreparedSendOptions = {}): Promise<HttpClientResponse> {
    const signal = options.signal ?? this.baseSignal;
    const request = this.toRequest(
      signal
        ? {
            signal,
          }
        : {},
    );
    const raw = await this.fetch(options);
    return new HttpClientResponse(raw, request, 1);
  }
}

export class HttpClientRequestBuilder implements PromiseLike<HttpClientResponse> {
  private responsePromise: Promise<HttpClientResponse> | undefined;

  constructor(
    private readonly client: HttpClient<any>,
    private readonly method: HttpClientMethod,
    private readonly input: string | URL,
    private readonly options: HttpClientRequestOptions,
    private readonly expectation: HttpClientExpectation = NO_EXPECTATION,
  ) {}

  expect(status: number | readonly number[]): HttpClientRequestBuilder {
    return new HttpClientRequestBuilder(
      this.client,
      this.method,
      this.input,
      this.options,
      {
        kind: "status",
        statuses: Array.isArray(status) ? [...status] : [status],
      },
    );
  }

  ok(): HttpClientRequestBuilder {
    return new HttpClientRequestBuilder(
      this.client,
      this.method,
      this.input,
      this.options,
      OK_EXPECTATION,
    );
  }

  expectOk(): HttpClientRequestBuilder {
    return this.ok();
  }

  prepare(): HttpClientPreparedRequest {
    return this.client.prepareRequest(
      this.method,
      this.input,
      this.options,
    );
  }

  async fetch(options: HttpClientPreparedSendOptions = {}): Promise<Response> {
    return this.prepare().fetch(options);
  }

  response(): Promise<HttpClientResponse> {
    if (!this.responsePromise) {
      this.responsePromise = this.client.execute(
        this.method,
        this.input,
        this.options,
        this.expectation,
      );
    }

    return this.responsePromise;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.response()).arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    return (await this.response()).bytes();
  }

  async json<T = unknown>(): Promise<T> {
    return (await this.response()).json<T>();
  }

  async stream(): Promise<ReadableStream<Uint8Array>> {
    return (await this.response()).stream();
  }

  async text(): Promise<string> {
    return (await this.response()).text();
  }

  then<TResult1 = HttpClientResponse, TResult2 = never>(
    onfulfilled?: ((value: HttpClientResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.response().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<HttpClientResponse | TResult> {
    return this.response().catch(onrejected ?? undefined);
  }

  finally(onfinally?: (() => void) | null): Promise<HttpClientResponse> {
    return this.response().finally(onfinally ?? undefined);
  }
}

export class HttpClient<Schema extends HttpClientSchema = HttpClientSchema> {
  private readonly baseURL: string | undefined;
  private readonly defaultFetch: typeof globalThis.fetch;
  private readonly defaultHeaders: Headers;
  private readonly defaultRetry: ResolvedRetryOptions;
  private readonly defaultTimeout: number | undefined;
  private readonly middlewares: HttpClientMiddleware<Schema>[];

  constructor(options: HttpClientOptions<Schema> = {}) {
    this.baseURL = (options.baseURL ?? options.baseUrl)?.toString();
    this.defaultFetch = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = new Headers(options.headers);
    this.defaultRetry = resolveRetryOptions(options.retry);
    this.defaultTimeout = resolveTimeout(options.timeout, options.timeoutMs);
    this.middlewares = [...(options.middleware ?? [])];

    if (typeof this.defaultFetch !== "function") {
      throw new TypeError("A fetch implementation is required to create an HTTP client");
    }
  }

  use(middleware: HttpClientMiddleware<Schema>): this {
    this.middlewares.push(middleware);
    return this;
  }

  extend<ExtendedSchema extends HttpClientSchema = {}>(
    options: HttpClientOptions<Schema & ExtendedSchema> = {},
  ): HttpClient<Schema & ExtendedSchema> {
    const headers = new Headers(this.defaultHeaders);
    const nextOptions: HttpClientOptions<Schema & ExtendedSchema> = {
      fetch: options.fetch ?? this.defaultFetch,
      headers,
      middleware: [
        ...((this.middlewares as unknown) as HttpClientMiddleware<Schema & ExtendedSchema>[]),
        ...((options.middleware ?? []) as HttpClientMiddleware<Schema & ExtendedSchema>[]),
      ],
      retry: materializeRetryOptions(mergeRetryOptions(this.defaultRetry, options.retry)),
    };

    applyHeaders(headers, options.headers);

    const baseURL = options.baseURL ?? options.baseUrl ?? this.baseURL;
    const timeout = resolveTimeout(options.timeout, options.timeoutMs) ?? this.defaultTimeout;

    if (baseURL !== undefined) {
      nextOptions.baseURL = baseURL;
    }

    if (timeout !== undefined) {
      nextOptions.timeout = timeout;
    }

    return new HttpClient<Schema & ExtendedSchema>(nextOptions);
  }

  prepareRequest<Path extends string>(
    method: HttpClientMethod,
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientPreparedRequest {
    const headers = new Headers(this.defaultHeaders);

    applyHeaders(headers, options.headers);

    const url = resolveRequestUrl(this.baseURL, input, options.params, options.query);
    const body = serializeRequestBody(options.body, headers);

    return new HttpClientPreparedRequest(
      url,
      method,
      headers,
      body,
      this.defaultFetch,
      options.signal,
      resolveTimeout(options.timeout, options.timeoutMs) ?? this.defaultTimeout,
    );
  }

  prepare<Path extends string>(
    method: HttpClientMethod,
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientPreparedRequest {
    return this.prepareRequest(method, input, options);
  }

  request<Path extends string>(
    method: HttpClientMethod,
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return new HttpClientRequestBuilder(this, method, input, options);
  }

  delete<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("DELETE", input, options);
  }

  get<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("GET", input, options);
  }

  head<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("HEAD", input, options);
  }

  options<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("OPTIONS", input, options);
  }

  patch<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("PATCH", input, options);
  }

  post<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("POST", input, options);
  }

  put<Path extends string>(
    input: Path | URL,
    options: HttpClientRequestOptions<
      unknown,
      HttpClientQuery,
      PathParams<Path> & HttpClientPathParams
    > = {},
  ): HttpClientRequestBuilder {
    return this.request("PUT", input, options);
  }

  DELETE<Path extends PathsForMethod<Schema, "DELETE">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "DELETE">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "DELETE">>> {
    return new HttpClientRequestBuilder(
      this,
      "DELETE",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "DELETE">>>();
  }

  GET<Path extends PathsForMethod<Schema, "GET">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "GET">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "GET">>> {
    return new HttpClientRequestBuilder(
      this,
      "GET",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "GET">>>();
  }

  HEAD<Path extends PathsForMethod<Schema, "HEAD">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "HEAD">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "HEAD">>> {
    return new HttpClientRequestBuilder(
      this,
      "HEAD",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "HEAD">>>();
  }

  OPTIONS<Path extends PathsForMethod<Schema, "OPTIONS">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "OPTIONS">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "OPTIONS">>> {
    return new HttpClientRequestBuilder(
      this,
      "OPTIONS",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "OPTIONS">>>();
  }

  PATCH<Path extends PathsForMethod<Schema, "PATCH">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "PATCH">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "PATCH">>> {
    return new HttpClientRequestBuilder(
      this,
      "PATCH",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "PATCH">>>();
  }

  POST<Path extends PathsForMethod<Schema, "POST">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "POST">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "POST">>> {
    return new HttpClientRequestBuilder(
      this,
      "POST",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "POST">>>();
  }

  PUT<Path extends PathsForMethod<Schema, "PUT">>(
    path: Path,
    options?: HttpClientTypedRequestOptions<Path, RouteFor<Schema, Path, "PUT">>,
  ): Promise<RouteResponse<RouteFor<Schema, Path, "PUT">>> {
    return new HttpClientRequestBuilder(
      this,
      "PUT",
      path,
      (options ?? {}) as HttpClientRequestOptions,
    )
      .expectOk()
      .json<RouteResponse<RouteFor<Schema, Path, "PUT">>>();
  }

  async execute(
    method: HttpClientMethod,
    input: string | URL,
    options: HttpClientRequestOptions,
    expectation: HttpClientExpectation,
  ): Promise<HttpClientResponse> {
    const mergedRetry = mergeRetryOptions(this.defaultRetry, options.retry);
    const timeout = resolveTimeout(options.timeout, options.timeoutMs) ?? this.defaultTimeout;
    const baseHeaders = new Headers(this.defaultHeaders);

    applyHeaders(baseHeaders, options.headers);

    const url = resolveRequestUrl(this.baseURL, input, options.params, options.query);
    const body = serializeRequestBody(options.body, baseHeaders);
    const attempts = mergedRetry.attempts;
    const canRetry = mergedRetry.methods.has(method);

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const signalState = createRequestSignal(options.signal, timeout);
      const request = createRequest(url, method, baseHeaders, body, signalState.signal);
      const context: HttpClientMiddlewareContext<Schema> = {
        attempt,
        client: this,
        request,
      };

      try {
        const response = await this.runMiddlewares(context, attempt);

        if (
          canRetry &&
          attempt < attempts &&
          mergedRetry.statuses.has(response.status)
        ) {
          await cancelResponseBody(response);
          await waitForRetry(
            calculateRetryDelay(mergedRetry, attempt + 1),
            options.signal,
          );
          continue;
        }

        signalState.cleanup();
        return enforceExpectation(response, expectation);
      } catch (error) {
        signalState.cleanup();
        const resolvedError = signalState.didTimeout()
          ? createTimeoutError(timeout ?? 0)
          : error;

        if (canRetry && attempt < attempts && isRetryableNetworkError(resolvedError)) {
          lastError = resolvedError;
          await waitForRetry(
            calculateRetryDelay(mergedRetry, attempt + 1),
            options.signal,
          );
          continue;
        }

        throw resolvedError;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("HTTP client request failed");
  }

  private async runMiddlewares(
    context: HttpClientMiddlewareContext<Schema>,
    attempt: number,
  ): Promise<HttpClientResponse> {
    const dispatch = async (index: number): Promise<HttpClientResponse> => {
      const middleware = this.middlewares[index];

      if (!middleware) {
        const raw = await this.defaultFetch(context.request);
        return new HttpClientResponse(raw, context.request, attempt);
      }

      return middleware(context, async () => {
        return dispatch(index + 1);
      });
    };

    return dispatch(0);
  }
}

export function createHttpClient<Schema extends HttpClientSchema = HttpClientSchema>(
  options: HttpClientOptions<Schema> = {},
): HttpClient<Schema> {
  return new HttpClient(options);
}

function applyHeaders(target: Headers, headers: HeadersInit | undefined): void {
  if (!headers) {
    return;
  }

  const source = new Headers(headers);

  source.forEach((value, key) => {
    target.set(key, value);
  });
}

function applyQuery(url: URL, query: HttpClientQuery | undefined): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, key, value);
  }
}

function appendQueryValue(
  searchParams: URLSearchParams,
  key: string,
  value: HttpClientQueryValue,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendQueryValue(searchParams, key, entry);
    }

    return;
  }

  const normalized = normalizeQueryPrimitive(value as HttpClientQueryPrimitive);

  if (normalized !== undefined) {
    searchParams.append(key, normalized);
  }
}

function calculateRetryDelay(
  retry: ResolvedRetryOptions,
  attempt: number,
): number {
  const rawDelay =
    typeof retry.delay === "function"
      ? retry.delay(attempt)
      : retry.delay === "constant"
        ? retry.baseDelayMs
        : retry.baseDelayMs * Math.max(1, 2 ** (attempt - 2));
  const cappedDelay = Math.min(retry.maxDelayMs, Math.max(0, rawDelay));

  if (!retry.jitter) {
    return cappedDelay;
  }

  return Math.round(cappedDelay * (0.5 + Math.random()));
}

async function cancelResponseBody(response: HttpClientResponse): Promise<void> {
  try {
    await response.raw.body?.cancel();
  } catch {
    // Ignore cancellation failures before the retry path.
  }
}

function createRequest(
  url: URL,
  method: HttpClientMethod,
  headers: Headers,
  body: BodyInit | undefined,
  signal: AbortSignal | undefined,
): Request {
  const init: RequestInit & {
    duplex?: "half";
  } = {
    headers: new Headers(headers),
    method,
  };

  if (body !== undefined) {
    init.body = body;
  }

  if (signal) {
    init.signal = signal;
  }

  if (body instanceof ReadableStream) {
    init.duplex = "half";
  }

  return new Request(url, init);
}

function createRequestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  cleanup: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal | undefined;
} {
  if (!signal && timeoutMs === undefined) {
    return {
      cleanup: () => {},
      didTimeout: () => false,
      signal: undefined,
    };
  }

  const controller = new AbortController();
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const abortFromSource = () => {
    controller.abort(signal?.reason);
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", abortFromSource, {
        once: true,
      });
    }
  }

  if (timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort(createTimeoutError(timeoutMs));
    }, timeoutMs);
  }

  return {
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      signal?.removeEventListener("abort", abortFromSource);
    },
    didTimeout: () => didTimeout,
    signal: controller.signal,
  };
}

function createTimeoutError(timeoutMs: number): DOMException {
  return new DOMException(
    `Request timed out after ${timeoutMs}ms`,
    "TimeoutError",
  );
}

function encodePathParam(
  params: HttpClientPathParams,
  key: string,
  wildcard: boolean,
): string {
  const value = params[key];

  if (value === undefined) {
    throw new TypeError(`Missing path parameter "${key}"`);
  }

  const normalized = String(value);

  if (!wildcard) {
    return encodeURIComponent(normalized);
  }

  return normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function enforceExpectation(
  response: HttpClientResponse,
  expectation: HttpClientExpectation,
): HttpClientResponse {
  if (expectation.kind === "none") {
    return response;
  }

  if (expectation.kind === "ok") {
    if (response.ok) {
      return response;
    }

    throw new HttpClientError(
      `Expected a successful response, received ${response.status}`,
      {
        request: response.request,
        response,
      },
    );
  }

  if (expectation.statuses.includes(response.status)) {
    return response;
  }

  throw new HttpClientError(
    `Expected status ${expectation.statuses.join(", ")}, received ${response.status}`,
    {
      request: response.request,
      response,
    },
  );
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === "string" ||
    value instanceof ArrayBuffer ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream ||
    ArrayBuffer.isView(value);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return false;
  }

  return error instanceof TypeError;
}

function mergeRetryOptions(
  base: ResolvedRetryOptions,
  override: false | HttpClientRetryOptions | undefined,
): ResolvedRetryOptions {
  if (override === false) {
    return resolveRetryOptions({
      attempts: 1,
    });
  }

  if (!override) {
    return base;
  }

  return resolveRetryOptions({
    attempts: override.attempts ?? base.attempts,
    baseDelayMs: override.baseDelayMs ?? base.baseDelayMs,
    delay: override.delay ?? base.delay,
    jitter: override.jitter ?? base.jitter,
    maxDelayMs: override.maxDelayMs ?? base.maxDelayMs,
    methods: override.methods ?? [...base.methods],
    statuses: override.statuses ?? [...base.statuses],
  });
}

function materializeRetryOptions(
  retry: ResolvedRetryOptions,
): HttpClientRetryOptions {
  return {
    attempts: retry.attempts,
    baseDelayMs: retry.baseDelayMs,
    delay: retry.delay,
    jitter: retry.jitter,
    maxDelayMs: retry.maxDelayMs,
    methods: [...retry.methods],
    statuses: [...retry.statuses],
  };
}

function normalizeQueryPrimitive(
  value: HttpClientQueryPrimitive,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function resolveRequestUrl(
  baseURL: string | undefined,
  input: string | URL,
  params: HttpClientPathParams | undefined,
  query: HttpClientQuery | undefined,
): URL {
  const rawInput = typeof input === "string"
    ? applyPathParams(input, params)
    : input.toString();
  let url: URL;

  if (baseURL) {
    url = new URL(rawInput, baseURL);
  } else if (canParseAbsoluteUrl(rawInput)) {
    url = new URL(rawInput);
  } else {
    throw new TypeError(
      "Relative requests require a baseURL or baseUrl option",
    );
  }

  applyQuery(url, query);
  return url;
}

function resolveRetryOptions(
  retry: HttpClientRetryOptions | undefined,
): ResolvedRetryOptions {
  return {
    attempts: Math.max(1, retry?.attempts ?? 1),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? 200),
    delay: retry?.delay ?? "exponential",
    jitter: retry?.jitter ?? true,
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? 5_000),
    methods: new Set(retry?.methods ?? DEFAULT_RETRYABLE_METHODS),
    statuses: new Set(retry?.statuses ?? DEFAULT_RETRYABLE_STATUSES),
  };
}

function resolveTimeout(
  timeout: number | undefined,
  timeoutMs: number | undefined,
): number | undefined {
  const resolved = timeout ?? timeoutMs;

  if (resolved === undefined) {
    return undefined;
  }

  return Math.max(0, resolved);
}

function serializeRequestBody(
  body: unknown,
  headers: Headers,
): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (isBodyInit(body)) {
    return body;
  }

  const payload = JSON.stringify(body);

  if (payload === undefined) {
    return undefined;
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return payload;
}

function applyPathParams(
  input: string,
  params: HttpClientPathParams | undefined,
): string {
  if (!params) {
    return input;
  }

  return input
    .replace(/\*([A-Za-z0-9_]+)/g, (_match, key: string) => {
      return encodePathParam(params, key, true);
    })
    .replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
      return encodePathParam(params, key, false);
    });
}

function canParseAbsoluteUrl(value: string): boolean {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  if (signal?.aborted) {
    throw signal.reason;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener("abort", abortListener);
      resolve();
    }, delayMs);

    const abortListener = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", abortListener);
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", abortListener, {
      once: true,
    });
  });
}
