import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import type {
  ThreadClusterCallback,
  ThreadClusterEvents,
  ThreadClusterOptions,
} from "../shared/types";

import { TypedEventEmitter } from "../shared/typed-emitter";
import {
  createInlineWorkerUrl,
  resolveWorkerEntryUrl,
  resolveWorkerExecArgv,
} from "./worker-runtime";

type WorkerSnapshot = {
  address?: unknown;
  ready: boolean;
  worker: Worker;
};

type WorkerErrorMessage = {
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  type: "error";
  workerId: number;
};

type WorkerListeningMessage = {
  address: unknown;
  type: "listening";
  workerId: number;
};

type WorkerMessage = WorkerErrorMessage | WorkerListeningMessage;

const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";

const { entryUrl, listenOptions, workerId } = workerData;
const CONTEXT_SYMBOL = Symbol.for("keno.thread-bootstrap.context");
const REGISTRY_SYMBOL = Symbol.for("keno.thread-bootstrap.apps");

function shouldMuteBootstrapConsole(workerId) {
  const mode = process.env.KENO_THREAD_BOOTSTRAP_LOGS ?? "primary";

  if (mode === "all") {
    return false;
  }

  if (mode === "none") {
    return true;
  }

  return workerId !== 0;
}

function muteBootstrapConsole(workerId) {
  if (!shouldMuteBootstrapConsole(workerId)) {
    return () => {};
  }

  const originals = new Map();

  for (const method of ["debug", "info", "log", "trace", "warn"]) {
    const original = console[method];

    if (typeof original !== "function") {
      continue;
    }

    originals.set(method, original);
    console[method] = () => {};
  }

  return () => {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  };
}

function isApp(value) {
  return Boolean(
    value &&
      typeof value.listen === "function",
  );
}

function consumeBootstrappedApp(entryUrl) {
  const registry = globalThis[REGISTRY_SYMBOL];

  if (!(registry instanceof Map)) {
    return undefined;
  }

  const app = registry.get(entryUrl);

  if (app) {
    registry.delete(entryUrl);
  }

  return app;
}

async function resolveApp(moduleExports, entryUrl) {
  const bootstrapped = consumeBootstrappedApp(entryUrl);

  if (isApp(bootstrapped)) {
    return bootstrapped;
  }

  const candidates = [
    moduleExports.app,
    moduleExports.default,
    moduleExports.createApp,
  ];

  for (const candidate of candidates) {
    if (isApp(candidate)) {
      return candidate;
    }

    if (typeof candidate === "function") {
      const value = await candidate();

      if (isApp(value)) {
        return value;
      }
    }
  }

  throw new TypeError(
    "Thread cluster entries must export an object with listen(), an app named export, or a createApp/default factory",
  );
}

globalThis[CONTEXT_SYMBOL] = {
  entryUrl,
  mode: "capture-app",
};

let moduleExports;
const restoreBootstrapConsole = muteBootstrapConsole(workerId);

try {
  moduleExports = await import(entryUrl);
} finally {
  restoreBootstrapConsole();
  delete globalThis[CONTEXT_SYMBOL];
}

const app = await resolveApp(moduleExports, entryUrl);
const server = await app.listen({
  ...listenOptions,
  threaded: false,
  reusePort: true,
});

if (typeof server?.on === "function") {
  server.on("error", (error) => {
    parentPort?.postMessage({
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      type: "error",
      workerId,
    });
  });
}

if (typeof server?.ready === "function") {
  await server.ready();
}

parentPort?.postMessage({
  address: typeof server?.address === "function" ? server.address() : undefined,
  type: "listening",
  workerId,
});

parentPort?.on("message", async (message) => {
  if (message?.type !== "shutdown") {
    return;
  }

  try {
    if (typeof server?.close === "function") {
      await server.close();
    }
  } finally {
    process.exit(0);
  }
});
`;

export class KenoThreadCluster extends TypedEventEmitter<ThreadClusterEvents> {
  private closing = false;
  private readonly entryUrl: string;
  private readonly workerSnapshots = new Map<number, WorkerSnapshot>();
  private listening = false;
  private readyPromise: Promise<this> | undefined;
  private rejectReady: ((reason?: unknown) => void) | undefined;
  private resolveReady: ((value: this) => void) | undefined;

  constructor(private readonly options: ThreadClusterOptions) {
    super();
    this.entryUrl = resolveWorkerEntryUrl(options.entry);
  }

  addresses(): unknown[] {
    return Array.from(this.workerSnapshots.values(), (snapshot) => snapshot.address);
  }

  listen(callback?: ThreadClusterCallback): this {
    if (callback) {
      this.once("listening", callback);
    }

    if (this.listening) {
      return this;
    }

    this.listening = true;
    this.readyPromise = new Promise<this>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const workerCount = this.options.workers ?? availableParallelism();

    for (let workerId = 0; workerId < workerCount; workerId += 1) {
      this.spawnWorker(workerId);
    }

    return this;
  }

  async ready(): Promise<this> {
    if (!this.readyPromise) {
      this.listen();
    }

    return this.readyPromise as Promise<this>;
  }

  async close(): Promise<void> {
    this.closing = true;
    const workers = Array.from(this.workerSnapshots.values(), (snapshot) => snapshot.worker);

    await Promise.all(
      workers.map(async (worker) => {
        if (worker.threadId === -1) {
          return;
        }

        const exited = new Promise<void>((resolve) => {
          worker.once("exit", () => {
            resolve();
          });
        });

        worker.postMessage({ type: "shutdown" });
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            setTimeout(() => {
              void worker.terminate().finally(resolve);
            }, 1_000);
          }),
        ]);
      }),
    );

    this.workerSnapshots.clear();
    this.emit("close");
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.type === "error") {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      if (message.error.stack) {
        error.stack = message.error.stack;
      }
      this.emit("error", error, message.workerId);
      this.rejectReady?.(error);
      return;
    }

    const snapshot = this.workerSnapshots.get(message.workerId);

    if (!snapshot) {
      return;
    }

    snapshot.address = message.address;
    snapshot.ready = true;
    this.emit("workerListening", message.workerId, message.address);

    if (Array.from(this.workerSnapshots.values()).every((entry) => entry.ready)) {
      this.resolveReady?.(this);
      this.emit("listening", this);
    }
  }

  private spawnWorker(workerId: number): void {
    const worker = new Worker(createInlineWorkerUrl(WORKER_SOURCE), {
      execArgv: resolveWorkerExecArgv(this.options.execArgv),
      workerData: {
        entryUrl: this.entryUrl,
        listenOptions: {
          ...this.options,
          entry: undefined,
          execArgv: undefined,
          workers: undefined,
        },
        workerId,
      },
    });

    this.workerSnapshots.set(workerId, {
      ready: false,
      worker,
    });

    worker.on("message", (message: WorkerMessage) => {
      this.handleWorkerMessage(message);
    });
    worker.on("error", (error) => {
      this.emit("error", error, workerId);
      this.rejectReady?.(error);
    });
    worker.on("exit", (code) => {
      this.workerSnapshots.delete(workerId);
      this.emit("workerExit", workerId, code);

      if (!this.closing) {
        const error = new Error(`Worker ${workerId} exited before the cluster was closed`);
        this.emit("error", error, workerId);
        this.rejectReady?.(error);
      }
    });
  }
}

export function createThreadCluster(options: ThreadClusterOptions): KenoThreadCluster {
  return new KenoThreadCluster(options);
}
