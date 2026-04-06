import { constants, createDeflateRaw, inflateRawSync, type DeflateRaw } from "node:zlib";

import type {
  NegotiatedPerMessageDeflate,
  PerMessageDeflateOptions,
} from "../shared/types";
import { parseSize } from "../shared/utils";

import { WebSocketProtocolError } from "./frame";

const DEFAULT_THRESHOLD = 1024;
const DEFAULT_LEVEL = 1;
const DEFAULT_MEM_LEVEL = 5;
const DEFAULT_CONCURRENCY_LIMIT = 10;
const EXTENSION_NAME = "permessage-deflate";
const SYNC_FLUSH_TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const concurrencyGates = new Map<number, ZlibConcurrencyGate>();

type CompressionResult = {
  compressed: boolean;
  payload: Buffer;
};

class ZlibConcurrencyGate {
  private active = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => {
        this.pending.push(resolve);
      });
    }

    this.active += 1;

    try {
      return await task();
    } finally {
      this.active -= 1;
      this.pending.shift()?.();
    }
  }
}

function getConcurrencyGate(limit: number): ZlibConcurrencyGate {
  const normalizedLimit = Number.isFinite(limit) && limit > 0
    ? Math.max(1, Math.trunc(limit))
    : DEFAULT_CONCURRENCY_LIMIT;
  const existing = concurrencyGates.get(normalizedLimit);

  if (existing) {
    return existing;
  }

  const gate = new ZlibConcurrencyGate(normalizedLimit);
  concurrencyGates.set(normalizedLimit, gate);
  return gate;
}

export function negotiatePerMessageDeflate(
  headerValue: string | undefined,
  option: boolean | PerMessageDeflateOptions | undefined,
): NegotiatedPerMessageDeflate | undefined {
  if (!option || !headerValue || !includesExtension(headerValue, EXTENSION_NAME)) {
    return undefined;
  }

  return {
    clientNoContextTakeover: true,
    concurrencyLimit:
      typeof option === "object"
        ? Math.max(1, Math.trunc(option.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT))
        : DEFAULT_CONCURRENCY_LIMIT,
    level:
      typeof option === "object"
        ? option.level ?? DEFAULT_LEVEL
        : DEFAULT_LEVEL,
    memLevel:
      typeof option === "object"
        ? option.memLevel ?? DEFAULT_MEM_LEVEL
        : DEFAULT_MEM_LEVEL,
    serverNoContextTakeover: true,
    threshold:
      typeof option === "object"
        ? parseSize(option.threshold, DEFAULT_THRESHOLD)
        : DEFAULT_THRESHOLD,
  };
}

export function perMessageDeflateResponseHeader(): string {
  return `${EXTENSION_NAME}; server_no_context_takeover; client_no_context_takeover`;
}

export class PerMessageDeflateCompressor {
  private readonly concurrencyGate: ZlibConcurrencyGate;
  private deflate: DeflateRaw | undefined;
  private pendingChunks: Buffer[] = [];
  private pendingLength = 0;
  private pendingError: Error | undefined;
  private rejectPending: ((error: Error) => void) | undefined;

  constructor(private readonly config: NegotiatedPerMessageDeflate) {
    this.concurrencyGate = getConcurrencyGate(config.concurrencyLimit);
  }

  async compress(payload: Buffer): Promise<CompressionResult> {
    if (payload.byteLength < this.config.threshold) {
      return {
        compressed: false,
        payload,
      };
    }

    return await this.concurrencyGate.run(async () => await this.compressWithStream(payload));
  }

  close(): void {
    const rejection = this.rejectPending;
    this.rejectPending = undefined;
    this.pendingChunks = [];
    this.pendingError = undefined;
    this.pendingLength = 0;

    if (!this.deflate) {
      rejection?.(new Error("The deflate stream was closed while data was being processed"));
      return;
    }

    this.deflate.removeAllListeners();
    this.deflate.close();
    this.deflate = undefined;
    rejection?.(new Error("The deflate stream was closed while data was being processed"));
  }

  private async compressWithStream(payload: Buffer): Promise<CompressionResult> {
    const deflate = this.getDeflate();
    this.pendingError = undefined;

    return await new Promise<CompressionResult>((resolve, reject) => {
      this.rejectPending = reject;

      const complete = (): void => {
        this.rejectPending = undefined;
        const error = this.pendingError;

        if (error) {
          this.close();
          reject(error);
          return;
        }

        const compressed = consumePendingChunks(this.pendingChunks, this.pendingLength);
        this.pendingChunks = [];
        this.pendingLength = 0;

        if (this.config.serverNoContextTakeover) {
          deflate.reset();
        }

        const trimmed = trimSyncFlushTrailer(compressed);

        if (trimmed.byteLength >= payload.byteLength) {
          resolve({
            compressed: false,
            payload,
          });
          return;
        }

        resolve({
          compressed: true,
          payload: trimmed,
        });
      };

      deflate.write(payload);
      deflate.flush(constants.Z_SYNC_FLUSH, complete);
    });
  }

  private getDeflate(): DeflateRaw {
    if (this.deflate) {
      return this.deflate;
    }

    const deflate = createDeflateRaw({
      finishFlush: constants.Z_SYNC_FLUSH,
      flush: constants.Z_SYNC_FLUSH,
      level: this.config.level,
      memLevel: this.config.memLevel,
    });

    deflate.on("data", (chunk: Buffer) => {
      this.pendingChunks.push(chunk);
      this.pendingLength += chunk.byteLength;
    });
    deflate.on("error", (error) => {
      this.pendingError = error;
    });

    this.deflate = deflate;
    return deflate;
  }
}

export function decompressMessage(payload: Buffer): Buffer {
  try {
    const complete = Buffer.allocUnsafe(payload.byteLength + SYNC_FLUSH_TRAILER.byteLength);
    payload.copy(complete, 0);
    SYNC_FLUSH_TRAILER.copy(complete, payload.byteLength);

    return inflateRawSync(complete, {
      finishFlush: constants.Z_SYNC_FLUSH,
    });
  } catch {
    throw new WebSocketProtocolError("Invalid permessage-deflate payload", 1007);
  }
}

function includesExtension(headerValue: string, extension: string): boolean {
  return headerValue
    .split(",")
    .map((entry) => entry.split(";", 1)[0]?.trim().toLowerCase())
    .some((entry) => entry === extension);
}

function trimSyncFlushTrailer(payload: Buffer): Buffer {
  return payload.byteLength > SYNC_FLUSH_TRAILER.byteLength &&
    payload.subarray(payload.byteLength - SYNC_FLUSH_TRAILER.byteLength).equals(SYNC_FLUSH_TRAILER)
    ? payload.subarray(0, payload.byteLength - SYNC_FLUSH_TRAILER.byteLength)
    : payload;
}

function consumePendingChunks(chunks: readonly Buffer[], totalLength: number): Buffer {
  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }

  if (chunks.length === 1) {
    const [single] = chunks;
    return single ? Buffer.from(single) : Buffer.alloc(0);
  }

  return Buffer.concat(chunks, totalLength);
}
