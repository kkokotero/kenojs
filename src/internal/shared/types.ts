import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  IncomingHttpHeaders as Http2IncomingHttpHeaders,
  Http2SecureServer,
  Http2Server,
  Http2ServerRequest,
  Http2ServerResponse,
  SecureServerOptions as Http2SecureServerOptions,
  ServerHttp2Stream,
  ServerOptions as Http2ServerOptions,
} from "node:http2";
import type { Server as HttpsServer } from "node:https";
import type { Socket } from "node:net";
import type { Duplex, Writable } from "node:stream";
import type { TlsOptions, TLSSocket } from "node:tls";
import type { TransferListItem } from "node:worker_threads";

import type { KenoRequest } from "../http/request";
import type { KenoResponse } from "../http/response";
import type { KenoApplication } from "../http/application";
import type { KenoRouter } from "../http/router";
import type { KenoThreadCluster } from "../concurrency/thread-cluster";
import type { KenoWebSocket } from "../websocket/connection";
import type { KenoServer } from "../transport/server";

export type MaybePromise<T> = T | Promise<T>;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type ServerTransport = "http" | "https" | "http2";

export type RequestScheme = "http" | "https";

export type RequestTransport = "http" | "https" | "http2" | "http2s";

export type SizeUnit = "b" | "kb" | "mb" | "gb";

export type SizeInput = number | `${number}${SizeUnit}`;

export type RouteParams = Record<string, string>;
export type HostPattern = string | RegExp | readonly (string | RegExp)[];

export type StripParamModifier<Value extends string> =
  Value extends `${infer Name}?`
    ? Name
    : Value extends `${infer Name}*`
      ? Name
      : Value;

type ExtractNamedParams<Path extends string> =
  Path extends `${string}:${infer Tail}`
    ? Tail extends `${infer Param}/${infer Rest}`
      ? { [Key in StripParamModifier<Param>]: string } & ExtractNamedParams<`/${Rest}`>
      : { [Key in StripParamModifier<Tail>]: string }
    : {};

type ExtractWildcardParams<Path extends string> =
  Path extends `${string}*${infer Tail}`
    ? Tail extends `${infer Param}/${infer Rest}`
      ? {
          [Key in StripParamModifier<Param extends "" ? "wildcard" : Param>]: string;
        } & ExtractWildcardParams<`/${Rest}`>
      : {
          [Key in StripParamModifier<Tail extends "" ? "wildcard" : Tail>]: string;
        }
    : {};

export type PathParams<Path extends string> = ExtractNamedParams<Path> &
  ExtractWildcardParams<Path>;

export type NextFunction = (error?: unknown) => MaybePromise<void>;

export type RequestHandler<Path extends string = string> = (
  request: KenoRequest<PathParams<Path>>,
  response: KenoResponse,
  next: NextFunction,
) => MaybePromise<void>;

export type ErrorHandler = (
  error: unknown,
  request: KenoRequest,
  response: KenoResponse,
  next: NextFunction,
) => MaybePromise<void>;

export type UseEntry<Path extends string = string> =
  | RequestHandler<Path>
  | ErrorHandler
  | KenoRouter;

export type KenoPluginSetup<Options = void> = (
  application: KenoApplication,
  options: Options,
) => MaybePromise<void>;

export interface KenoPluginDefinition<Options = void> {
  name?: string;
  setup: KenoPluginSetup<Options>;
}

export type KenoPlugin<Options = void> =
  | KenoPluginSetup<Options>
  | KenoPluginDefinition<Options>;

export interface CookieOptions {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}

export interface SendFileStat {
  mtime: Date;
  mtimeMs: number;
  size: number;
}

export interface SendFileOptions {
  buffer?: Buffer;
  cacheControl?: boolean;
  contentType?: string;
  etag?: boolean;
  lastModified?: boolean;
  stat?: SendFileStat;
}

export type WebSocketVerificationResult =
  | boolean
  | {
      ok: boolean;
      headers?: Record<string, string>;
      message?: string;
      status?: number;
    };

export interface WebSocketRouteOptions<Path extends string = string> {
  autoPong?: boolean;
  closeTimeout?: number;
  headers?: Record<string, string> | ((request: KenoRequest<PathParams<Path>>) => MaybePromise<Record<string, string>>);
  handleProtocols?: (
    protocols: ReadonlySet<string>,
    request: KenoRequest<PathParams<Path>>,
  ) => MaybePromise<string | false | undefined>;
  maxPayload?: SizeInput;
  perMessageDeflate?: boolean | PerMessageDeflateOptions;
  protocols?: readonly string[];
  skipUTF8Validation?: boolean;
  verifyClient?: (
    request: KenoRequest<PathParams<Path>>,
  ) => MaybePromise<WebSocketVerificationResult>;
}

export type WebSocketHandler<Path extends string = string> = (
  socket: KenoWebSocket,
  request: KenoRequest<PathParams<Path>>,
) => MaybePromise<void>;

export interface JsonParserOptions {
  limit?: SizeInput;
  strict?: boolean;
}

export interface CorsMiddlewareOptions {
  allowCredentials?: boolean;
  allowHeaders?: readonly string[] | string;
  allowMethods?: readonly HttpMethod[] | string;
  allowOrigin?: boolean | string | readonly string[] | RegExp;
  exposeHeaders?: readonly string[] | string;
  maxAge?: number;
}

export interface RequestIdMiddlewareOptions {
  exposeHeader?: boolean;
  generator?: () => string;
  headerName?: string;
}

export interface SecurityHeadersMiddlewareOptions {
  contentSecurityPolicy?: false | string;
  crossOriginOpenerPolicy?: false | string;
  dnsPrefetchControl?: boolean;
  frameOptions?: false | "DENY" | "SAMEORIGIN";
  referrerPolicy?: false | string;
  xContentTypeOptions?: boolean;
}

export interface TextParserOptions {
  defaultType?: string;
  limit?: SizeInput;
}

export interface PerMessageDeflateOptions {
  concurrencyLimit?: number;
  level?: number;
  memLevel?: number;
  threshold?: SizeInput;
}

export interface TemporaryTlsOptions {
  algorithm?: "sha1" | "sha256" | "sha384" | "sha512";
  cache?: boolean;
  commonName?: string;
  curve?: "P-256" | "P-384" | "P-521";
  days?: number;
  hosts?: readonly string[];
  keySize?: number;
  keyType?: "ec" | "rsa";
  passphrase?: string;
}

export interface TemporaryTlsResult extends TlsOptions {
  cert: string;
  commonName: string;
  fingerprint: string;
  hosts: readonly string[];
  key: string;
  passphrase?: string;
}

export interface NegotiatedPerMessageDeflate {
  clientNoContextTakeover: true;
  concurrencyLimit: number;
  level: number;
  memLevel: number;
  serverNoContextTakeover: true;
  threshold: number;
}

export interface StaticMiddlewareOptions {
  cacheControl?: boolean;
  dotfiles?: "allow" | "deny" | "ignore";
  etag?: boolean;
  fallthrough?: boolean;
  immutable?: boolean;
  index?: false | string;
  lastModified?: boolean;
  maxAge?: SizeInput;
}

export interface HeartbeatPluginOptions {
  details?: Record<string, unknown> | (() => MaybePromise<Record<string, unknown>>);
  healthPath?: string;
  livePath?: string;
  name?: string;
  readyPath?: string;
  readyWhen?: () => MaybePromise<boolean>;
}

export interface OpenApiPluginOptions {
  docsPath?: false | string;
  document: Record<string, unknown>;
  jsonPath?: string;
  title?: string;
}

export interface RequestLoggerEntry {
  durationMs: number;
  method: string;
  path: string;
  requestId?: string;
  statusCode: number;
}

export interface RequestLoggerPluginOptions {
  ignorePaths?: readonly string[];
  logger?: (entry: RequestLoggerEntry) => void;
  requestIdHeader?: string;
}

export type NodeRequest = IncomingMessage | Http2ServerRequest;

export type NodeResponse =
  | ServerResponse<IncomingMessage>
  | Http2ServerResponse<Http2ServerRequest>;

export type NodeUpgradeSocket = Socket | TLSSocket | Duplex;

export interface MinimalNodeRequest {
  destroy: (error?: Error) => void;
  headers: NodeRequest["headers"];
  httpVersion: string;
  httpVersionMajor: number;
  method?: string;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  once: (event: string, listener: (...args: any[]) => void) => unknown;
  socket: NodeUpgradeSocket;
  url?: string;
}

export type RawRequest = NodeRequest | MinimalNodeRequest;

export interface MinimalNodeResponse extends Writable {
  getHeader: (name: string) => number | string | string[] | undefined;
  headersSent: boolean;
  removeHeader: (name: string) => void;
  setHeader: (name: string, value: number | string | readonly string[]) => void;
  statusCode: number;
}

export type RawResponse = NodeResponse | MinimalNodeResponse;

export interface MinimalNodeServer {
  address?: () => unknown;
  close: (callback?: (error?: Error) => void) => unknown;
  listen: (...args: any[]) => unknown;
  off: (event: string, listener: (...args: any[]) => void) => unknown;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  once: (event: string, listener: (...args: any[]) => void) => unknown;
}

export type RawNodeServer =
  | import("node:http").Server
  | HttpsServer
  | Http2Server
  | Http2SecureServer
  | MinimalNodeServer;

export interface AppListenOptions {
  allowHTTP1?: boolean;
  backlog?: number;
  host?: string;
  http2?: Omit<Http2ServerOptions & Http2SecureServerOptions, "allowHTTP1">;
  port?: number;
  reusePort?: boolean;
  server?: RawNodeServer;
  signal?: AbortSignal;
  tls?: TlsOptions;
  threaded?: boolean | ThreadedServerOptions;
  transport?: ServerTransport;
}

export type ListenCallback = (server: KenoServer) => void;
export type MultiListenCallback = (servers: readonly KenoServer[]) => void;
export type ThreadClusterCallback = (cluster: KenoThreadCluster) => void;

export interface ThreadedServerOptions {
  entry?: string | URL;
  execArgv?: readonly string[];
  workers?: number;
}

export interface ThreadClusterOptions extends Omit<AppListenOptions, "server" | "signal" | "threaded"> {
  entry: string | URL;
  execArgv?: readonly string[];
  workers?: number;
}

export interface WorkerPoolOptions {
  entry: string | URL;
  execArgv?: readonly string[];
  maxQueue?: number;
  size?: number;
}

export interface WorkerPoolTaskOptions {
  timeout?: number;
  transferList?: readonly TransferListItem[];
}

export interface ThreadedHandlerOptions<
  Path extends string = string,
  Input = unknown,
  Output = unknown,
> {
  input?: (
    request: KenoRequest<PathParams<Path>>,
    response: KenoResponse,
  ) => MaybePromise<Input>;
  output?: (
    result: Output,
    request: KenoRequest<PathParams<Path>>,
    response: KenoResponse,
  ) => MaybePromise<void>;
  timeout?: number;
  transferList?: (
    payload: Input,
    request: KenoRequest<PathParams<Path>>,
    response: KenoResponse,
  ) => readonly TransferListItem[];
}

export interface ServerEvents {
  close: [];
  connection: [socket: KenoWebSocket, request: KenoRequest];
  error: [error: Error];
  listening: [server: KenoServer];
  request: [request: RawRequest, response: RawResponse];
  stream: [stream: ServerHttp2Stream, headers: Http2IncomingHttpHeaders];
  upgrade: [request: NodeRequest, socket: NodeUpgradeSocket, head: Buffer];
}

export interface MultiServerEvents {
  close: [];
  error: [error: Error, server: KenoServer];
  listening: [servers: readonly KenoServer[]];
}

export interface ThreadClusterEvents {
  close: [];
  error: [error: Error, workerId: number];
  listening: [cluster: KenoThreadCluster];
  workerExit: [workerId: number, code: number | null];
  workerListening: [workerId: number, address: unknown];
}

export interface WorkerPoolEvents {
  close: [];
  error: [error: Error, workerId: number];
  online: [workerId: number];
}

export interface WebSocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface WebSocketHeartbeatOptions {
  closeCode?: number;
  closeReason?: string;
  intervalMs?: number;
  payload?: string | Uint8Array | ArrayBuffer | ArrayBufferView;
  timeoutMs?: number;
}

export interface WebSocketHeartbeatController {
  track: (socket: KenoWebSocket) => void;
  untrack: (socket: KenoWebSocket) => void;
}

export interface WebSocketRoomMember<Meta = unknown> {
  meta: Meta | undefined;
  socket: KenoWebSocket;
}

export interface WebSocketRoomsOptions {
  heartbeat?: WebSocketHeartbeatController;
}

export interface WebSocketMessageEvent {
  data: string | Uint8Array;
  isBinary: boolean;
}

export interface WebSocketEvents {
  binary: [data: Uint8Array];
  close: [event: WebSocketCloseEvent];
  drain: [];
  error: [error: Error];
  message: [event: WebSocketMessageEvent];
  ping: [data: Uint8Array];
  pong: [data: Uint8Array];
  text: [data: string];
}
