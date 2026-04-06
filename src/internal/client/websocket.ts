import { TypedEventEmitter } from "../shared/typed-emitter";

export interface WebSocketClientRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  jitter?: boolean;
  maxDelayMs?: number;
}

export interface WebSocketClientOptions {
  autoConnect?: boolean;
  protocols?: string | readonly string[];
  retry?: WebSocketClientRetryOptions;
  WebSocket?: typeof globalThis.WebSocket;
}

export interface WebSocketClientRetryEvent {
  attempt: number;
  delayMs: number;
}

interface WebSocketClientEvents<Incoming> {
  close: [event: CloseEvent];
  error: [error: Error];
  json: [payload: Incoming];
  open: [];
  retry: [event: WebSocketClientRetryEvent];
  text: [payload: string];
}

type ResolvedWebSocketRetryOptions = {
  attempts: number;
  baseDelayMs: number;
  jitter: boolean;
  maxDelayMs: number;
};

export class KenoWebSocketClient<
  Incoming = unknown,
  Outgoing = unknown,
> extends TypedEventEmitter<WebSocketClientEvents<Incoming>> {
  private readonly retry: ResolvedWebSocketRetryOptions;
  private readonly WebSocketConstructor: typeof globalThis.WebSocket;
  private connectPromise: Promise<void> | undefined;
  private currentAttempt = 0;
  private explicitClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private socket: WebSocket | undefined;

  constructor(
    private readonly url: string | URL,
    private readonly options: WebSocketClientOptions = {},
  ) {
    super();
    this.retry = resolveWebSocketRetryOptions(options.retry);
    this.WebSocketConstructor = options.WebSocket ?? globalThis.WebSocket;

    if (typeof this.WebSocketConstructor !== "function") {
      throw new TypeError("A WebSocket implementation is required");
    }

    if (options.autoConnect !== false) {
      void this.connect();
    }
  }

  get protocol(): string {
    return this.socket?.protocol ?? "";
  }

  get readyState(): number {
    return this.socket?.readyState ?? WebSocket.CLOSED;
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.explicitClose = false;
    this.clearReconnectTimer();
    this.connectPromise = this.openWithRetries(1);

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  close(code?: number, reason?: string): void {
    this.explicitClose = true;
    this.clearReconnectTimer();
    this.socket?.close(code, reason);
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    this.socket.send(data);
  }

  sendJson(payload: Outgoing): void {
    this.send(JSON.stringify(payload));
  }

  private async openWithRetries(startAttempt: number): Promise<void> {
    for (let attempt = startAttempt; attempt <= this.retry.attempts; attempt += 1) {
      this.currentAttempt = attempt;

      try {
        await this.openOnce(attempt);
        return;
      } catch (error) {
        if (this.explicitClose) {
          throw error;
        }

        if (attempt >= this.retry.attempts) {
          throw error;
        }

        const delayMs = calculateWebSocketRetryDelay(this.retry, attempt + 1);

        this.emit("retry", {
          attempt: attempt + 1,
          delayMs,
        });
        await delay(delayMs);
      }
    }
  }

  private openOnce(attempt: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new this.WebSocketConstructor(
        this.url.toString(),
        this.options.protocols as string | string[] | undefined,
      );

      let settled = false;

      const cleanup = () => {
        socket.removeEventListener("close", onCloseBeforeOpen);
        socket.removeEventListener("error", onErrorBeforeOpen);
        socket.removeEventListener("open", onOpen);
      };

      const onCloseBeforeOpen = (event: Event) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error(`WebSocket closed before opening on attempt ${attempt}: ${(event as CloseEvent).code}`));
      };

      const onErrorBeforeOpen = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error(`WebSocket connection failed on attempt ${attempt}`));
      };

      const onOpen = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.attachSocket(socket);
        resolve();
      };

      socket.addEventListener("close", onCloseBeforeOpen, {
        once: true,
      });
      socket.addEventListener("error", onErrorBeforeOpen, {
        once: true,
      });
      socket.addEventListener("open", onOpen, {
        once: true,
      });
    });
  }

  private attachSocket(socket: WebSocket): void {
    this.socket = socket;

    socket.addEventListener("close", (event) => {
      this.socket = undefined;
      this.emit("close", event);

      if (this.explicitClose) {
        return;
      }

      const nextAttempt = this.currentAttempt + 1;

      if (nextAttempt > this.retry.attempts) {
        return;
      }

      const delayMs = calculateWebSocketRetryDelay(this.retry, nextAttempt);

      this.emit("retry", {
        attempt: nextAttempt,
        delayMs,
      });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        void this.openWithRetries(nextAttempt).catch((error) => {
          this.emit("error", resolveWebSocketError(error));
        });
      }, delayMs);
    });

    socket.addEventListener("error", () => {
      this.emit("error", new Error("WebSocket error"));
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    this.emit("open");
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await toWebSocketText(data);

    if (text === undefined) {
      return;
    }

    this.emit("text", text);

    try {
      this.emit("json", JSON.parse(text) as Incoming);
    } catch {
      // Ignore invalid JSON payloads.
    }
  }
}

export function createWebSocketClient<
  Incoming = unknown,
  Outgoing = unknown,
>(
  url: string | URL,
  options: WebSocketClientOptions = {},
): KenoWebSocketClient<Incoming, Outgoing> {
  return new KenoWebSocketClient(url, options);
}

function calculateWebSocketRetryDelay(
  retry: ResolvedWebSocketRetryOptions,
  attempt: number,
): number {
  const delayMs = Math.min(
    retry.maxDelayMs,
    retry.baseDelayMs * Math.max(1, 2 ** (attempt - 2)),
  );

  if (!retry.jitter) {
    return delayMs;
  }

  return Math.round(delayMs * (0.5 + Math.random()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveWebSocketError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("WebSocket client failed");
}

function resolveWebSocketRetryOptions(
  retry: WebSocketClientRetryOptions | undefined,
): ResolvedWebSocketRetryOptions {
  return {
    attempts: Math.max(1, retry?.attempts ?? 1),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? 100),
    jitter: retry?.jitter ?? true,
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? 1_000),
  };
}

async function toWebSocketText(data: unknown): Promise<string | undefined> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Blob) {
    return data.text();
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }

  return undefined;
}
