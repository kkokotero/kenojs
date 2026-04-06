import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import type { RequestHandler, RouteParams } from "../shared/types";
import type {
  ThreadedHandlerOptions,
  WorkerPoolEvents,
  WorkerPoolOptions,
  WorkerPoolTaskOptions,
} from "../shared/types";

import { TypedEventEmitter } from "../shared/typed-emitter";
import {
  createInlineWorkerUrl,
  resolveWorkerEntryUrl,
  resolveWorkerExecArgv,
} from "./worker-runtime";

type PoolTask<Input, Output> = {
  id: number;
  options: WorkerPoolTaskOptions;
  payload: Input;
  reject: (reason?: unknown) => void;
  resolve: (value: Output) => void;
};

type WorkerState = {
  activeTaskId: number | undefined;
  busy: boolean;
  workerId: number;
  worker: Worker;
};

type TaskState<Output> = {
  reject: (reason?: unknown) => void;
  resolve: (value: Output) => void;
  timeout: NodeJS.Timeout | undefined;
};

type WorkerErrorMessage = {
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  taskId?: number;
  type: "error";
  workerId: number;
};

type WorkerResultMessage<Output> = {
  result: Output;
  taskId: number;
  type: "result";
  workerId: number;
};

type WorkerMessage<Output> = WorkerErrorMessage | WorkerResultMessage<Output>;

const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";

const { entryUrl, workerId } = workerData;

async function resolveTask(moduleExports) {
  const candidates = [
    moduleExports.run,
    moduleExports.default,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
  }

  throw new TypeError(
    'Worker pool entries must export a "run" function or a default function',
  );
}

const moduleExports = await import(entryUrl);
const run = await resolveTask(moduleExports);

parentPort?.on("message", async (message) => {
  if (message?.type === "shutdown") {
    process.exit(0);
  }

  if (message?.type !== "run") {
    return;
  }

  try {
    const result = await run(message.payload);
    parentPort?.postMessage({
      result,
      taskId: message.taskId,
      type: "result",
      workerId,
    });
  } catch (error) {
    const resolvedError =
      error instanceof Error
        ? error
        : new Error("Worker task failed");

    parentPort?.postMessage({
      error: {
        message: resolvedError.message,
        name: resolvedError.name,
        stack: resolvedError.stack,
      },
      taskId: message.taskId,
      type: "error",
      workerId,
    });
  }
});
`;

export class KenoWorkerPool<Input = unknown, Output = unknown> extends TypedEventEmitter<WorkerPoolEvents> {
  private closed = false;
  private closing = false;
  private readonly entryUrl: string;
  private readonly maxQueue: number;
  private nextTaskId = 1;
  private readonly queue: PoolTask<Input, Output>[] = [];
  private readonly states = new Map<number, WorkerState>();
  private readonly tasks = new Map<number, TaskState<Output>>();

  constructor(private readonly options: WorkerPoolOptions) {
    super();
    this.entryUrl = resolveWorkerEntryUrl(options.entry);
    this.maxQueue = options.maxQueue ?? Number.POSITIVE_INFINITY;

    const size = Math.max(1, options.size ?? Math.max(1, availableParallelism() - 1));

    for (let workerId = 0; workerId < size; workerId += 1) {
      this.spawnWorker(workerId);
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get size(): number {
    return this.states.size;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.closing = true;

    const closeError = new Error("Worker pool closed");

    while (this.queue.length > 0) {
      this.queue.shift()?.reject(closeError);
    }

    for (const [taskId, task] of this.tasks) {
      clearTimeout(task.timeout);
      task.reject(closeError);
      this.tasks.delete(taskId);
    }

    const workers = Array.from(this.states.values(), (state) => state.worker);

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

    this.states.clear();
    this.emit("close");
  }

  run(payload: Input, options: WorkerPoolTaskOptions = {}): Promise<Output> {
    if (this.closed) {
      return Promise.reject(new Error("Worker pool is closed"));
    }

    if (this.queue.length >= this.maxQueue && !this.getIdleWorker()) {
      return Promise.reject(new Error("Worker pool queue is full"));
    }

    return new Promise<Output>((resolve, reject) => {
      const task: PoolTask<Input, Output> = {
        id: this.nextTaskId,
        options,
        payload,
        reject,
        resolve,
      };

      this.nextTaskId += 1;

      const worker = this.getIdleWorker();

      if (worker) {
        this.startTask(worker, task);
        return;
      }

      this.queue.push(task);
    });
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const worker = this.getIdleWorker();

      if (!worker) {
        return;
      }

      const task = this.queue.shift();

      if (!task) {
        return;
      }

      this.startTask(worker, task);
    }
  }

  private getIdleWorker(): WorkerState | undefined {
    for (const state of this.states.values()) {
      if (!state.busy) {
        return state;
      }
    }

    return undefined;
  }

  private handleTaskMessage(workerId: number, message: WorkerMessage<Output>): void {
    const state = this.states.get(workerId);

    if (!state) {
      return;
    }

    if (message.type === "result") {
      const task = this.tasks.get(message.taskId);

      if (!task) {
        return;
      }

      clearTimeout(task.timeout);
      this.tasks.delete(message.taskId);
      state.activeTaskId = undefined;
      state.busy = false;
      task.resolve(message.result);
      this.drainQueue();
      return;
    }

    const error = new Error(message.error.message);
    error.name = message.error.name;

    if (message.error.stack) {
      error.stack = message.error.stack;
    }

    if (message.taskId !== undefined) {
      const task = this.tasks.get(message.taskId);

      if (task) {
        clearTimeout(task.timeout);
        this.tasks.delete(message.taskId);
        state.activeTaskId = undefined;
        state.busy = false;
        task.reject(error);
        this.drainQueue();
      }
    }

    this.emit("error", error, workerId);
  }

  private handleTaskTimeout(workerId: number, taskId: number, timeout: number): void {
    const state = this.states.get(workerId);
    const task = this.tasks.get(taskId);

    if (!state || !task) {
      return;
    }

    this.tasks.delete(taskId);
    state.activeTaskId = undefined;
    state.busy = false;
    task.reject(new Error(`Worker task timed out after ${timeout}ms`));
    void state.worker.terminate().catch(() => undefined);
  }

  private spawnWorker(workerId: number): void {
    const worker = new Worker(createInlineWorkerUrl(WORKER_SOURCE), {
      execArgv: resolveWorkerExecArgv(this.options.execArgv),
      workerData: {
        entryUrl: this.entryUrl,
        workerId,
      },
    });

    this.states.set(workerId, {
      activeTaskId: undefined,
      busy: false,
      workerId,
      worker,
    });

    worker.on("online", () => {
      this.emit("online", workerId);
    });
    worker.on("message", (message: WorkerMessage<Output>) => {
      this.handleTaskMessage(workerId, message);
    });
    worker.on("error", (error) => {
      this.emit("error", error, workerId);
    });
    worker.on("exit", (code) => {
      const state = this.states.get(workerId);
      const activeTaskId = state?.activeTaskId;

      this.states.delete(workerId);

      if (activeTaskId !== undefined) {
        const task = this.tasks.get(activeTaskId);

        if (task) {
          clearTimeout(task.timeout);
          this.tasks.delete(activeTaskId);
          task.reject(new Error(`Worker ${workerId} exited while processing a task`));
        }
      }

      if (this.closing) {
        return;
      }

      if (code !== 0) {
        this.emit("error", new Error(`Worker ${workerId} exited with code ${String(code)}`), workerId);
      }

      this.spawnWorker(workerId);
      this.drainQueue();
    });
  }

  private startTask(worker: WorkerState, task: PoolTask<Input, Output>): void {
    worker.activeTaskId = task.id;
    worker.busy = true;

    const timeout =
      task.options.timeout === undefined
        ? undefined
        : setTimeout(() => {
            this.handleTaskTimeout(worker.workerId, task.id, task.options.timeout ?? 0);
          }, task.options.timeout);

    this.tasks.set(task.id, {
      reject: task.reject,
      resolve: task.resolve,
      timeout,
    });

    worker.worker.postMessage(
      {
        payload: task.payload,
        taskId: task.id,
        type: "run",
      },
      task.options.transferList ? [...task.options.transferList] : undefined,
    );
  }
}

export function createWorkerPool<Input = unknown, Output = unknown>(
  options: WorkerPoolOptions,
): KenoWorkerPool<Input, Output> {
  return new KenoWorkerPool<Input, Output>(options);
}

export function threaded<
  Path extends string = string,
  Input = {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    host: string;
    method: string;
    params: RouteParams;
    path: string;
    query: Readonly<Record<string, string | string[]>>;
    search: string;
    url: string;
  },
  Output = unknown,
>(
  pool: KenoWorkerPool<Input, Output>,
  options: ThreadedHandlerOptions<Path, Input, Output> = {},
): RequestHandler<Path> {
  return async (request, response, next) => {
    try {
      const payload = options.input
        ? await options.input(request, response)
        : ({
            body: request.body,
            headers: request.headers,
            host: request.host,
            method: request.method,
            params: request.params,
            path: request.path,
            query: request.query,
            search: request.search,
            url: request.url,
          } as Input);

      const taskOptions: WorkerPoolTaskOptions = {};

      if (options.timeout !== undefined) {
        taskOptions.timeout = options.timeout;
      }

      const transferList = options.transferList?.(payload, request, response);

      if (transferList) {
        taskOptions.transferList = transferList;
      }

      const result = await pool.run(payload, taskOptions);

      if (options.output) {
        await options.output(result, request, response);
        return;
      }

      if (!response.finished) {
        response.json(result);
      }
    } catch (error) {
      await next(error);
    }
  };
}
