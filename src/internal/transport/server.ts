import * as http from "node:http";
import * as http2 from "node:http2";
import * as https from "node:https";

import type { KenoApplication } from "../http/application";
import { createThreadCluster } from "../concurrency/thread-cluster";
import {
  createHttp2StreamRequest,
  Http2StreamResponse,
  isExtendedConnectWebSocketRequest,
} from "../http/http2";
import { TypedEventEmitter } from "../shared/typed-emitter";
import type {
  AppListenOptions,
  ListenCallback,
  MinimalNodeServer,
  NodeRequest,
  NodeUpgradeSocket,
  RawNodeServer,
  ServerEvents,
  ThreadedServerOptions,
  ServerTransport,
} from "../shared/types";
import type { KenoRequest } from "../http/request";
import type { KenoWebSocket } from "../websocket/connection";

function createRawNodeServer(options: Required<Pick<AppListenOptions, "allowHTTP1" | "transport">> & AppListenOptions): RawNodeServer {
  switch (options.transport) {
    case "http":
      return http.createServer();
    case "https":
      if (!options.tls) {
        throw new TypeError("TLS options are required when transport is \"https\"");
      }

      return https.createServer(options.tls);
    case "http2": {
      const http2Options = options.http2 ?? {};
      const settings = {
        enableConnectProtocol: true,
        ...http2Options.settings,
      };

      if (options.tls) {
        return http2.createSecureServer(
          {
            allowHTTP1: options.allowHTTP1,
            ...http2Options,
            settings,
            ...options.tls,
          },
        );
      }

      return http2.createServer({
        ...http2Options,
        settings,
      });
    }
    default:
      throw new TypeError(`Unsupported transport "${String(options.transport)}"`);
  }
}

function closeRawServer(server: RawNodeServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function listenRawServer(
  server: RawNodeServer,
  options: Pick<AppListenOptions, "backlog" | "host" | "port" | "reusePort">,
): void {
  const listenOptions = {
    backlog: options.backlog,
    host: options.host,
    port: options.port ?? 0,
    ...(options.reusePort ? { reusePort: true } : {}),
  };

  server.listen(listenOptions);
}

const EMPTY_CLIENTS = new Set<KenoWebSocket>();

type PlaceholderServerOwner = TypedEventEmitter<ServerEvents> & {
  address: () => unknown;
  close: () => Promise<void>;
  listen: (callback?: ListenCallback) => unknown;
};

class BootstrapServerPlaceholder extends TypedEventEmitter<ServerEvents> {
  readonly raw: RawNodeServer;
  private closed = false;

  constructor() {
    super();
    this.raw = createPlaceholderRawServer(this);
  }

  address(): unknown {
    return undefined;
  }

  get clients(): ReadonlySet<KenoWebSocket> {
    return EMPTY_CLIENTS;
  }

  listen(callback?: ListenCallback): this {
    if (callback) {
      queueMicrotask(() => {
        callback(this as unknown as KenoServer);
      });
    }

    queueMicrotask(() => {
      this.emit("listening", this as unknown as KenoServer);
    });

    return this;
  }

  async ready(): Promise<KenoServer> {
    return this as unknown as KenoServer;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.emit("close");
  }

  registerWebSocket(): void {}
}

class ThreadedServerAdapter extends TypedEventEmitter<ServerEvents> {
  readonly raw: RawNodeServer;
  private closed = false;
  private listening = false;

  constructor(
    private readonly cluster: ReturnType<typeof createThreadCluster>,
  ) {
    super();
    this.raw = createPlaceholderRawServer(this);

    this.cluster.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
    this.cluster.on("error", (error) => {
      this.emit("error", error);
    });
    this.cluster.on("listening", () => {
      this.listening = true;
      this.emit("listening", this as unknown as KenoServer);
    });
  }

  address(): unknown {
    return this.cluster.addresses()[0];
  }

  get clients(): ReadonlySet<KenoWebSocket> {
    return EMPTY_CLIENTS;
  }

  listen(callback?: ListenCallback): this {
    if (callback) {
      this.once("listening", callback);
    }

    this.cluster.listen();
    return this;
  }

  async ready(): Promise<KenoServer> {
    await this.cluster.ready();
    this.listening = true;
    return this as unknown as KenoServer;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.cluster.close();
  }

  registerWebSocket(): void {}
}

function createPlaceholderRawServer(owner: PlaceholderServerOwner): MinimalNodeServer {
  return {
    address: () => owner.address(),
    close: (callback?: (error?: Error) => void) => {
      void owner.close().then(
        () => {
          callback?.();
        },
        (error: Error) => {
          callback?.(error);
        },
      );
    },
    listen: (...args: unknown[]) => {
      const callback = args.find((value): value is ListenCallback => typeof value === "function");
      return owner.listen(callback);
    },
    off: (event, listener) => owner.off(event as keyof ServerEvents, listener as never),
    on: (event, listener) => owner.on(event as keyof ServerEvents, listener as never),
    once: (event, listener) => owner.once(event as keyof ServerEvents, listener as never),
  };
}

export class KenoServer extends TypedEventEmitter<ServerEvents> {
  readonly raw: RawNodeServer;

  private readonly websocketClients = new Set<KenoWebSocket>();
  private attached = false;
  private readonly isOwned: boolean;
  private readonly normalizedOptions: Required<Pick<AppListenOptions, "allowHTTP1" | "transport">> & AppListenOptions;
  private readonly requestListener: ((request: http.IncomingMessage, response: http.ServerResponse) => void) | undefined;
  private readonly streamListener: ((stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void) | undefined;
  private readonly upgradeListener: (request: NodeRequest, socket: NodeUpgradeSocket, head: Buffer) => void;
  private readonly rawCloseListener: () => void;
  private readonly rawErrorListener: (error: Error) => void;
  private readonly rawListeningListener: () => void;

  constructor(
    private readonly application: KenoApplication,
    options: AppListenOptions = {},
  ) {
    super();

    this.normalizedOptions = {
      allowHTTP1: options.allowHTTP1 ?? Boolean(options.tls),
      transport: options.transport ?? "http",
      ...options,
    };

    this.raw = this.normalizedOptions.server ?? createRawNodeServer(this.normalizedOptions);
    this.isOwned = !this.normalizedOptions.server;

    this.requestListener =
      this.normalizedOptions.transport === "http2"
        ? undefined
        : (request, response) => {
            this.emit("request", request, response);
            void this.application.handleNodeRequest(request, response);
          };

    this.upgradeListener = (request, socket, head) => {
      this.emit("upgrade", request, socket, head);
      void this.application.handleUpgrade(request, socket, head, this);
    };

    this.streamListener =
      this.normalizedOptions.transport === "http2"
        ? (stream, headers) => {
            this.emit("stream", stream, headers);

            if (!isExtendedConnectWebSocketRequest(headers)) {
              const request = createHttp2StreamRequest(stream, headers);
              const response = new Http2StreamResponse(stream);
              this.emit("request", request, response);
              void this.application.handleNodeRequest(request, response);
              return;
            }

            void this.application.handleHttp2Stream(stream, headers, this);
          }
        : undefined;

    this.rawCloseListener = () => {
      this.detach();
      this.emit("close");
    };

    this.rawErrorListener = (error) => {
      this.emit("error", error);
    };

    this.rawListeningListener = () => {
      this.emit("listening", this);
    };

    this.attach();

    if (this.normalizedOptions.signal) {
      this.normalizedOptions.signal.addEventListener(
        "abort",
        () => {
          void this.close();
        },
        { once: true },
      );
    }
  }

  address(): unknown {
    return this.raw.address?.();
  }

  get clients(): ReadonlySet<KenoWebSocket> {
    return this.websocketClients;
  }

  listen(callback?: ListenCallback): this {
    if (callback) {
      this.once("listening", callback);
    }

    if (!this.isOwned) {
      queueMicrotask(() => {
        this.emit("listening", this);
      });
      return this;
    }

    listenRawServer(this.raw, this.normalizedOptions);
    return this;
  }

  async ready(): Promise<this> {
    const address = this.address();

    if (address) {
      return this;
    }

    await new Promise<void>((resolve) => {
      this.once("listening", () => {
        resolve();
      });
    });

    return this;
  }

  async close(): Promise<void> {
    for (const socket of this.websocketClients) {
      socket.close(1001, "Server shutting down");
    }

    if (!this.isOwned) {
      this.detach();
      this.emit("close");
      return;
    }

    await closeRawServer(this.raw);
  }

  registerWebSocket(socket: KenoWebSocket, request: KenoRequest): void {
    this.websocketClients.add(socket);
    socket.once("close", () => {
      this.websocketClients.delete(socket);
    });
    this.emit("connection", socket, request);
  }

  private attach(): void {
    if (this.attached) {
      return;
    }

    this.attached = true;
    if (this.requestListener) {
      this.raw.on("request", this.requestListener);
    }
    this.raw.on("upgrade", this.upgradeListener);
    if (this.streamListener) {
      this.raw.on("stream", this.streamListener);
    }
    this.raw.on("close", this.rawCloseListener);
    this.raw.on("error", this.rawErrorListener);
    this.raw.on("listening", this.rawListeningListener);
  }

  private detach(): void {
    if (!this.attached) {
      return;
    }

    this.attached = false;
    if (this.requestListener) {
      this.raw.off("request", this.requestListener);
    }
    this.raw.off("upgrade", this.upgradeListener);
    if (this.streamListener) {
      this.raw.off("stream", this.streamListener);
    }
    this.raw.off("close", this.rawCloseListener);
    this.raw.off("error", this.rawErrorListener);
    this.raw.off("listening", this.rawListeningListener);
  }
}

export function createBootstrapServerPlaceholder(): KenoServer {
  return new BootstrapServerPlaceholder() as unknown as KenoServer;
}

export function createThreadedServer(options: AppListenOptions & { threaded: ThreadedServerOptions }): KenoServer {
  const { server: _server, signal, threaded, ...clusterBaseOptions } = options;
  const cluster = createThreadCluster({
    ...clusterBaseOptions,
    entry: threaded.entry as string | URL,
    ...(threaded.execArgv ? { execArgv: threaded.execArgv } : {}),
    ...(threaded.workers !== undefined ? { workers: threaded.workers } : {}),
  });

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        void cluster.close();
      },
      { once: true },
    );
  }

  return new ThreadedServerAdapter(cluster) as unknown as KenoServer;
}
