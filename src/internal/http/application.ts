/** biome-ignore-all lint/suspicious/noImplicitAnyLet: <explanation> */
import type { IncomingHttpHeaders, ServerHttp2Stream } from "node:http2";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  AppListenOptions,
  KenoPlugin,
  ListenCallback,
  MultiListenCallback,
  NodeRequest,
  NodeUpgradeSocket,
  RawRequest,
  RawResponse,
} from "../shared/types";

import {
  getThreadBootstrapContext,
  registerThreadBootstrapApp,
} from "../concurrency/bootstrap";
import { EMPTY_ROUTE_PARAMS } from "../shared/constants";
import { HttpError, isHttpError } from "../shared/errors";
import { statusMessage } from "../shared/status";
import { isPromiseLike } from "../shared/utils";
import { KenoMultiServer } from "../transport/multi-server";
import {
  createBootstrapServerPlaceholder,
  createThreadedServer,
  KenoServer,
} from "../transport/server";
import {
  acceptExtendedConnectWebSocket,
  rejectExtendedConnect,
  rejectUpgrade,
  upgradeWebSocket,
} from "../websocket/handshake";
import { KenoWebSocket } from "../websocket/connection";
import { createHttp2StreamRequest } from "./http2";
import { KenoRequest } from "./request";
import { KenoResponse } from "./response";
import { KenoRouter } from "./router";

type ListenArgs =
  | [port: number, callback?: ListenCallback]
  | [port: number, host: string, callback?: ListenCallback]
  | [options: AppListenOptions, callback?: ListenCallback];

const INTERNAL_PACKAGE_ROOT = resolveInternalPackageRoot(import.meta.url);

function normalizeListenArguments(args: ListenArgs): {
  callback: ListenCallback | undefined;
  options: AppListenOptions;
} {
  const [first, second, third] = args;

  if (typeof first === "number") {
    if (typeof second === "string") {
      return {
        callback: third,
        options: {
          host: second,
          port: first,
        },
      };
    }

    return {
      callback: second as ListenCallback | undefined,
      options: {
        port: first,
      },
    };
  }

  return {
    callback: typeof second === "function" ? second : undefined,
    options: first,
  };
}

export class KenoApplication extends KenoRouter {
  private readonly settings = new Map<string, unknown>();
  private readonly sourceEntryUrl = captureCallerEntryUrl();

  async register<Options>(
    plugin: KenoPlugin<Options>,
    options: Options,
  ): Promise<this>;
  async register(plugin: KenoPlugin<void>): Promise<this>;
  async register<Options>(
    plugin: KenoPlugin<Options>,
    options?: Options,
  ): Promise<this> {
    const setup = typeof plugin === "function" ? plugin : plugin.setup;
    await setup(this, options as Options);
    return this;
  }

  async plugin<Options>(
    plugin: KenoPlugin<Options>,
    options: Options,
  ): Promise<this>;
  async plugin(plugin: KenoPlugin<void>): Promise<this>;
  async plugin<Options>(
    plugin: KenoPlugin<Options>,
    options?: Options,
  ): Promise<this> {
    return this.register(plugin, options as Options);
  }

  createServer(options: AppListenOptions = {}): KenoServer {
    const normalizedOptions = normalizeThreadedOptions(
      options,
      this.sourceEntryUrl,
    );

    if (
      shouldBootstrapThreadedApplication(normalizedOptions, this.sourceEntryUrl)
    ) {
      registerThreadBootstrapApp(this.sourceEntryUrl as string, this);
      return createBootstrapServerPlaceholder();
    }

    if (
      typeof normalizedOptions.threaded === "object" &&
      normalizedOptions.threaded.entry
    ) {
      return createThreadedServer(
        normalizedOptions as AppListenOptions & {
          threaded: NonNullable<AppListenOptions["threaded"]> & {
            entry: string | URL;
          };
        },
      );
    }

    return new KenoServer(this, normalizedOptions);
  }

  createMultiServer(optionsList: readonly AppListenOptions[]): KenoMultiServer {
    return new KenoMultiServer(this, optionsList);
  }

  listen(...args: ListenArgs): KenoServer {
    const { callback, options } = normalizeListenArguments(args);
    const server = this.createServer(options);
    server.listen(callback);
    return server;
  }

  listenMany(
    optionsList: readonly AppListenOptions[],
    callback?: MultiListenCallback,
  ): KenoMultiServer {
    const server = this.createMultiServer(optionsList);
    server.listen(callback);
    return server;
  }

  set(name: string, value: unknown): this {
    this.settings.set(name.toLowerCase(), value);
    return this;
  }

  setting<T>(name: string, fallback?: T): T | undefined {
    const value = this.settings.get(name.toLowerCase());
    return value === undefined ? fallback : (value as T | undefined);
  }

  enable(name: string): this {
    return this.set(name, true);
  }

  disable(name: string): this {
    return this.set(name, false);
  }

  enabled(name: string): boolean {
    return this.setting<boolean>(name) === true;
  }

  disabled(name: string): boolean {
    return !this.enabled(name);
  }

  handleNodeRequest(rawRequest: RawRequest, rawResponse: RawResponse): void {
    const request = new KenoRequest(rawRequest);
    const response = new KenoResponse(rawResponse, request);
    const state = {
      baseUrl: "",
      method: request.method,
      params: EMPTY_ROUTE_PARAMS,
      pathname: request.path,
      request,
      response,
    } as const;

    const finish = async (error: unknown): Promise<void> => {
      if (error !== this.noErrorToken) {
        await this.sendError(response, error);
        return;
      }

      if (!response.finished) {
        response.status(404).json({ error: "Not Found" });
      }
    };
    const direct = this.tryDispatchDirectRoute(state, finish);

    if (direct !== false) {
      if (isPromiseLike(direct)) {
        void direct.catch((error) => {
          void this.sendError(response, error);
        });
      }

      return;
    }

    const dispatched = this.dispatch(state, finish);

    if (isPromiseLike(dispatched)) {
      void dispatched.catch((error) => {
        void this.sendError(response, error);
      });
    }
  }

  async handleUpgrade(
    rawRequest: NodeRequest,
    socket: NodeUpgradeSocket,
    head: Buffer,
    server: KenoServer,
  ): Promise<void> {
    const request = new KenoRequest(rawRequest);
    const route = this.resolveWebSocketRoute(
      request.path,
      "",
      {},
      request.hostname,
    );

    if (!route) {
      rejectUpgrade(socket, 404, "Unknown WebSocket route");
      return;
    }

    request.setScope({
      baseUrl: route.baseUrl,
      params: route.params,
      routePath: route.routePath,
    });

    let webSocket;

    try {
      webSocket = await upgradeWebSocket(request, socket, head, route);
    } catch (error) {
      rejectUpgrade(
        socket,
        400,
        error instanceof Error ? error.message : "Unable to upgrade WebSocket",
      );
      return;
    }

    if (!webSocket) {
      return;
    }

    server.registerWebSocket(webSocket, request);

    void Promise.resolve(route.handler(webSocket, request as never)).catch(
      (error: unknown) => {
        if (webSocket.listenerCount("error") > 0) {
          webSocket.emit(
            "error",
            error instanceof Error
              ? error
              : new Error("Unhandled WebSocket route error"),
          );
        }

        if (webSocket.readyState < KenoWebSocket.CLOSING) {
          webSocket.close(1011, "Unhandled WebSocket route error");
        }
      },
    );
  }

  async handleHttp2Stream(
    stream: ServerHttp2Stream,
    headers: IncomingHttpHeaders,
    server: KenoServer,
  ): Promise<void> {
    const request = new KenoRequest(createHttp2StreamRequest(stream, headers));
    const route = this.resolveWebSocketRoute(
      request.path,
      "",
      {},
      request.hostname,
    );

    if (!route) {
      rejectExtendedConnect(stream, 404, "Unknown WebSocket route");
      return;
    }

    request.setScope({
      baseUrl: route.baseUrl,
      params: route.params,
      routePath: route.routePath,
    });

    let webSocket;

    try {
      webSocket = await acceptExtendedConnectWebSocket(request, stream, route);
    } catch (error) {
      rejectExtendedConnect(
        stream,
        400,
        error instanceof Error
          ? error.message
          : "Unable to open the HTTP/2 WebSocket stream",
      );
      return;
    }

    if (!webSocket) {
      return;
    }

    server.registerWebSocket(webSocket, request);

    void Promise.resolve(route.handler(webSocket, request as never)).catch(
      (error: unknown) => {
        if (webSocket.listenerCount("error") > 0) {
          webSocket.emit(
            "error",
            error instanceof Error
              ? error
              : new Error("Unhandled WebSocket route error"),
          );
        }

        if (webSocket.readyState < KenoWebSocket.CLOSING) {
          webSocket.close(1011, "Unhandled WebSocket route error");
        }
      },
    );
  }

  private async sendError(
    response: KenoResponse,
    error: unknown,
  ): Promise<void> {
    if (response.finished) {
      return;
    }

    const resolved = isHttpError(error)
      ? error
      : error instanceof Error
        ? new HttpError(500, error.message, { expose: false })
        : new HttpError(500, statusMessage(500), { expose: false });

    if (resolved.headers) {
      response.set(resolved.headers);
    }

    response.status(resolved.statusCode).json({
      error: resolved.expose
        ? resolved.message
        : statusMessage(resolved.statusCode),
    });
  }
}

function captureCallerEntryUrl(): string | undefined {
  const holder = {} as { stack?: string };

  Error.captureStackTrace(holder, captureCallerEntryUrl);

  for (const line of String(holder.stack ?? "")
    .split("\n")
    .slice(1)) {
    const target = parseStackTarget(line);

    if (
      !target ||
      isInternalKenoFrame(target) ||
      !isImportableEntryTarget(target)
    ) {
      continue;
    }

    return toEntryUrl(target);
  }

  return undefined;
}

function isInternalKenoFrame(target: string): boolean {
  if (target.startsWith("bun:") || target.startsWith("node:")) {
    return true;
  }

  const normalizedTarget = normalizeStackTargetPath(target);

  if (!normalizedTarget || !INTERNAL_PACKAGE_ROOT) {
    return false;
  }

  if (
    normalizedTarget !== INTERNAL_PACKAGE_ROOT &&
    !normalizedTarget.startsWith(`${INTERNAL_PACKAGE_ROOT}/`)
  ) {
    return false;
  }

  const relativeTarget =
    normalizedTarget === INTERNAL_PACKAGE_ROOT
      ? ""
      : normalizedTarget.slice(INTERNAL_PACKAGE_ROOT.length + 1);

  return (
    relativeTarget === "src/index.ts" ||
    relativeTarget.startsWith("src/internal/") ||
    /^dist\/chunk-[^/]+\.[cm]?js$/u.test(relativeTarget) ||
    relativeTarget === "dist/index.js" ||
    relativeTarget.startsWith("dist/internal/")
  );
}

function isImportableEntryTarget(target: string): boolean {
  const normalized = target.trim();

  if (!normalized) {
    return false;
  }

  return !(
    normalized === "unknown" ||
    normalized === "native" ||
    normalized === "[eval]" ||
    normalized.startsWith("eval at ") ||
    (normalized.startsWith("<") && normalized.endsWith(">"))
  );
}

function normalizeThreadedOptions(
  options: AppListenOptions,
  sourceEntryUrl: string | undefined,
): AppListenOptions {
  if (options.server || options.threaded === false) {
    return {
      ...options,
      threaded: false,
    };
  }

  if (
    options.threaded === undefined &&
    shouldDisableImplicitThreading(sourceEntryUrl)
  ) {
    return {
      ...options,
      threaded: false,
    };
  }

  if (
    options.threaded === undefined &&
    (options.port === undefined || options.port === 0)
  ) {
    return {
      ...options,
      threaded: false,
    };
  }

  if (typeof options.threaded === "object") {
    const entry = options.threaded.entry ?? sourceEntryUrl;

    if (!entry) {
      return {
        ...options,
        threaded: false,
      };
    }

    return {
      ...options,
      threaded: {
        ...options.threaded,
        entry,
      },
    };
  }

  if (!sourceEntryUrl) {
    return {
      ...options,
      threaded: false,
    };
  }

  return {
    ...options,
    threaded: {
      entry: sourceEntryUrl,
    },
  };
}

function shouldDisableImplicitThreading(
  sourceEntryUrl: string | undefined,
): boolean {
  if (!sourceEntryUrl) {
    return true;
  }

  if (process.versions.bun) {
    return true;
  }

  if (
    process.env.VITEST ||
    process.env.VITEST_POOL_ID ||
    process.env.VITEST_WORKER_ID
  ) {
    return true;
  }

  return /(?:^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?(?:[?#]|$)/u.test(
    sourceEntryUrl,
  );
}

function parseStackTarget(line: string): string | undefined {
  const normalized = line
    .trim()
    .replace(/^at\s+/u, "")
    .replace(/\)$/u, "");
  const location = normalized.includes("(")
    ? normalized.slice(normalized.lastIndexOf("(") + 1) || normalized
    : normalized;
  const match = /^(.*):\d+:\d+$/u.exec(location);

  return match?.[1];
}

function normalizeStackTargetPath(target: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    if (!target.startsWith("file:")) {
      return undefined;
    }

    return fileURLToPath(new URL(target)).replaceAll("\\", "/");
  }

  return target.split(/[?#]/u, 1)[0]?.replaceAll("\\", "/");
}

function resolveInternalPackageRoot(moduleUrl: string): string | undefined {
  const normalizedPath = fileURLToPath(moduleUrl).replaceAll("\\", "/");

  for (const marker of ["/src/", "/dist/"]) {
    const index = normalizedPath.lastIndexOf(marker);

    if (index !== -1) {
      return normalizedPath.slice(0, index);
    }
  }

  return undefined;
}

function shouldBootstrapThreadedApplication(
  options: AppListenOptions,
  sourceEntryUrl: string | undefined,
): boolean {
  const context = getThreadBootstrapContext();
  const threaded = options.threaded;

  if (!context || !sourceEntryUrl || threaded === false) {
    return false;
  }

  const entry =
    typeof threaded === "object"
      ? (threaded.entry ?? sourceEntryUrl)
      : sourceEntryUrl;

  return entry === context.entryUrl;
}

function toEntryUrl(target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return new URL(target).href;
  }

  return pathToFileURL(target).href;
}

export function createApp(): KenoApplication {
  return new KenoApplication();
}

export function createServer(
  application: KenoApplication,
  options: AppListenOptions = {},
): KenoServer {
  return application.createServer(options);
}

export function createMultiServer(
  application: KenoApplication,
  optionsList: readonly AppListenOptions[],
): KenoMultiServer {
  return application.createMultiServer(optionsList);
}
