import { isUtf8 } from "node:buffer";
import type { Duplex } from "node:stream";

import { TypedEventEmitter } from "../shared/typed-emitter";
import type {
  NegotiatedPerMessageDeflate,
  WebSocketCloseEvent,
  WebSocketEvents,
} from "../shared/types";
import { toBuffer } from "../shared/utils";

import {
  buildFrame,
  buildFrameHeader,
  isValidCloseCode,
  OPCODES,
  tryParseFrame,
  WebSocketProtocolError,
} from "./frame";
import { decompressMessage, PerMessageDeflateCompressor } from "./permessage-deflate";

interface WebSocketOptions {
  autoPong?: boolean;
  closeTimeout?: number;
  maxPayload?: number;
  perMessageDeflate?: NegotiatedPerMessageDeflate;
  protocol?: string;
  skipUTF8Validation?: boolean;
}

type NormalizedWebSocketOptions = {
  autoPong: boolean;
  closeTimeout: number;
  maxPayload: number;
  perMessageDeflate?: NegotiatedPerMessageDeflate;
  protocol: string;
  skipUTF8Validation: boolean;
};

interface PendingCompressedFrame {
  opcode: number;
  payload: Buffer;
}

const EMPTY_EXTENSIONS = Object.freeze({});
const PERMESSAGE_DEFLATE_EXTENSIONS = Object.freeze({
  permessageDeflate: true,
});

export class KenoWebSocket extends TypedEventEmitter<WebSocketEvents> {
  static readonly CLOSED = 3;
  static readonly CLOSING = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  private buffer: Buffer = Buffer.alloc(0);
  private closeCode = 1005;
  private closeReason = "";
  private closeTimer: NodeJS.Timeout | undefined;
  private compressedQueue: PendingCompressedFrame[] = [];
  private compressedQueueIndex = 0;
  private fragmentedCompressed = false;
  private fragmentedLength = 0;
  private fragmentedOpcode: number | undefined;
  private fragments: Buffer[] = [];
  private flushingCompressedQueue = false;
  private hasReceivedCloseFrame = false;
  private hasReportedClose = false;
  private hasSentCloseFrame = false;
  private readonly maxPayload: number;
  private pendingCloseFrame: Buffer | undefined;
  private paused = false;
  private readyStateValue = KenoWebSocket.OPEN;
  private readonly compressor: PerMessageDeflateCompressor | undefined;

  readonly protocol: string;
  readonly raw: Duplex;

  constructor(
    socket: Duplex,
    private readonly options: NormalizedWebSocketOptions,
  ) {
    super();
    this.raw = socket;
    this.protocol = options.protocol;
    this.maxPayload = options.maxPayload;
    this.compressor = options.perMessageDeflate
      ? new PerMessageDeflateCompressor(options.perMessageDeflate)
      : undefined;

    if ("setNoDelay" in socket && typeof socket.setNoDelay === "function") {
      socket.setNoDelay(true);
    }

    socket.on("data", (chunk: Buffer) => {
      this.handleChunk(chunk);
    });
    socket.on("drain", () => {
      this.emit("drain");
    });
    socket.on("error", (error) => {
      this.emitError(error);
    });
    socket.on("close", () => {
      this.handleClose();
    });
    socket.on("end", () => {
      if (this.readyStateValue < KenoWebSocket.CLOSING) {
        this.readyStateValue = KenoWebSocket.CLOSING;
      }

      this.handleClose();
    });
    socket.on("finish", () => {
      if (this.readyStateValue < KenoWebSocket.CLOSING) {
        return;
      }

      this.handleClose();
    });
  }

  get bufferedAmount(): number {
    return this.raw.writableLength;
  }

  get readyState(): number {
    return this.readyStateValue;
  }

  get extensions(): Readonly<Record<string, true>> {
    return this.options.perMessageDeflate
      ? PERMESSAGE_DEFLATE_EXTENSIONS
      : EMPTY_EXTENSIONS;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  send(data: string | Uint8Array | ArrayBuffer | ArrayBufferView): void {
    this.assertOpen();

    if (typeof data === "string") {
      if (!this.options.perMessageDeflate) {
        this.writeTextFrame(data);
        return;
      }

      this.writeFrame(OPCODES.text, Buffer.from(data));
      return;
    }

    this.writeFrame(OPCODES.binary, toBuffer(data));
  }

  sendText(data: string): void {
    this.send(data);
  }

  sendBinary(data: Uint8Array | ArrayBuffer | ArrayBufferView): void {
    this.assertOpen();
    this.writeFrame(OPCODES.binary, toBuffer(data));
  }

  ping(data: string | Uint8Array | ArrayBuffer | ArrayBufferView = new Uint8Array(0)): void {
    this.assertOpen();
    const payload = toBuffer(data);

    if (payload.byteLength > 125) {
      throw new RangeError("Ping payloads must be 125 bytes or smaller");
    }

    this.writeFrame(OPCODES.ping, payload);
  }

  pong(data: string | Uint8Array | ArrayBuffer | ArrayBufferView = new Uint8Array(0)): void {
    this.assertOpen();
    const payload = toBuffer(data);

    if (payload.byteLength > 125) {
      throw new RangeError("Pong payloads must be 125 bytes or smaller");
    }

    this.writeFrame(OPCODES.pong, payload);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyStateValue >= KenoWebSocket.CLOSING) {
      return;
    }

    if (!isValidCloseCode(code)) {
      throw new RangeError(`Invalid close code "${code}"`);
    }

    const reasonBuffer = Buffer.from(reason);

    if (reasonBuffer.byteLength > 123) {
      throw new RangeError("Close reason must be 123 bytes or smaller");
    }

    this.closeCode = code;
    this.closeReason = reason;
    this.readyStateValue = KenoWebSocket.CLOSING;

    const payload = Buffer.allocUnsafe(2 + reasonBuffer.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);

    const frame = buildFrame(OPCODES.close, payload);

    if (this.hasPendingCompressedFrames()) {
      this.pendingCloseFrame = frame;
      void this.flushCompressedQueue();
      return;
    }

    this.writeCloseFrame(frame);
  }

  terminate(): void {
    this.compressor?.close();
    this.compressedQueue = [];
    this.compressedQueueIndex = 0;
    this.pendingCloseFrame = undefined;
    this.paused = false;
    this.readyStateValue = KenoWebSocket.CLOSED;
    this.raw.destroy();
  }

  pause(): void {
    if (this.readyStateValue === KenoWebSocket.CLOSED || this.readyStateValue === KenoWebSocket.CONNECTING) {
      return;
    }

    if ("pause" in this.raw && typeof this.raw.pause === "function") {
      this.raw.pause();
    }

    this.paused = true;
  }

  resume(): void {
    if (this.readyStateValue === KenoWebSocket.CLOSED || this.readyStateValue === KenoWebSocket.CONNECTING) {
      return;
    }

    if ("resume" in this.raw && typeof this.raw.resume === "function") {
      this.raw.resume();
    }

    this.paused = false;
  }

  private assertOpen(): void {
    if (this.readyStateValue !== KenoWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
  }

  private fail(error: WebSocketProtocolError): void {
    this.emitError(error);

    if (!this.hasSentCloseFrame && this.readyStateValue < KenoWebSocket.CLOSING) {
      this.readyStateValue = KenoWebSocket.CLOSING;
      this.hasSentCloseFrame = true;
      this.raw.write(buildFrame(OPCODES.close, buildClosePayload(error.closeCode, error.message)));
    }

    this.raw.destroy();
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer =
      this.buffer.byteLength === 0 ? (chunk as Buffer) : Buffer.concat([this.buffer, chunk]);

    try {
      while (this.buffer.byteLength > 0) {
        const parsed = tryParseFrame(this.buffer, {
          allowRsv1: this.options.perMessageDeflate !== undefined,
        });

        if (!parsed) {
          return;
        }

        this.buffer = this.buffer.subarray(parsed.consumed);
        this.handleFrame(parsed.frame);
      }
    } catch (error) {
      if (error instanceof WebSocketProtocolError) {
        this.fail(error);
        return;
      }

      this.emitError(error as Error);
      this.raw.destroy();
    }
  }

  private handleFrame(frame: { fin: boolean; opcode: number; payload: Buffer; rsv1: boolean }): void {
    switch (frame.opcode) {
      case OPCODES.continuation:
        this.handleContinuation(frame);
        return;
      case OPCODES.text:
      case OPCODES.binary:
        this.handleDataFrame(frame);
        return;
      case OPCODES.ping:
        this.emit("ping", frame.payload);

        if (this.options.autoPong && this.readyStateValue === KenoWebSocket.OPEN) {
          this.writeFrame(OPCODES.pong, frame.payload);
        }
        return;
      case OPCODES.pong:
        this.emit("pong", frame.payload);
        return;
      case OPCODES.close:
        this.handleCloseFrame(frame.payload);
        return;
      default:
        throw new WebSocketProtocolError(`Unsupported opcode "${frame.opcode}"`);
    }
  }

  private handleContinuation(frame: { fin: boolean; payload: Buffer; rsv1: boolean }): void {
    if (this.fragmentedOpcode === undefined) {
      throw new WebSocketProtocolError("Unexpected continuation frame");
    }

    if (frame.rsv1) {
      throw new WebSocketProtocolError("Continuation frames must not enable RSV1");
    }

    this.fragmentedLength += frame.payload.byteLength;
    this.ensurePayloadLimit(this.fragmentedLength);
    this.fragments.push(frame.payload);

    if (!frame.fin) {
      return;
    }

    const payload = Buffer.concat(this.fragments, this.fragmentedLength);
    const opcode = this.fragmentedOpcode;
    const compressed = this.fragmentedCompressed;
    this.fragments = [];
    this.fragmentedCompressed = false;
    this.fragmentedLength = 0;
    this.fragmentedOpcode = undefined;
    this.emitMessage(opcode, payload, compressed);
  }

  private handleDataFrame(frame: { fin: boolean; opcode: number; payload: Buffer; rsv1: boolean }): void {
    this.ensurePayloadLimit(frame.payload.byteLength);

    if (this.fragmentedOpcode !== undefined) {
      throw new WebSocketProtocolError("A fragmented message is already in progress");
    }

    if (!frame.fin) {
      this.fragmentedOpcode = frame.opcode;
      this.fragmentedCompressed = frame.rsv1;
      this.fragmentedLength = frame.payload.byteLength;
      this.fragments = [frame.payload];
      return;
    }

    this.emitMessage(frame.opcode, frame.payload, frame.rsv1);
  }

  private emitMessage(opcode: number, payload: Buffer, compressed: boolean): void {
    const message = compressed ? this.inflateMessage(payload) : payload;

    if (opcode === OPCODES.text) {
      if (!this.options.skipUTF8Validation && !isUtf8(message)) {
        throw new WebSocketProtocolError("Received invalid UTF-8 data", 1007);
      }

      const text = message.toString("utf8");
      this.emit("message", { data: text, isBinary: false });
      this.emit("text", text);
      return;
    }

    const data = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    this.emit("message", { data, isBinary: true });
    this.emit("binary", data);
  }

  private handleCloseFrame(payload: Buffer): void {
    this.hasReceivedCloseFrame = true;

    if (payload.byteLength === 1) {
      throw new WebSocketProtocolError("Close frames must be empty or include a two-byte close code");
    }

    if (payload.byteLength >= 2) {
      const code = payload.readUInt16BE(0);

      if (!isValidCloseCode(code)) {
        throw new WebSocketProtocolError("Invalid close code");
      }

      const reasonBuffer = payload.subarray(2);

      if (
        reasonBuffer.byteLength > 0 &&
        !this.options.skipUTF8Validation &&
        !isUtf8(reasonBuffer)
      ) {
        throw new WebSocketProtocolError("Close reason must be valid UTF-8", 1007);
      }

      this.closeCode = code;
      this.closeReason = reasonBuffer.toString("utf8");
    }

    if (!this.hasSentCloseFrame) {
      this.pendingCloseFrame = undefined;
      this.hasSentCloseFrame = true;
      this.raw.write(
        buildFrame(OPCODES.close, payload.byteLength === 0 ? buildClosePayload(1000, "") : payload),
      );
    }

    this.readyStateValue = KenoWebSocket.CLOSING;
    this.raw.end();
  }

  private handleClose(): void {
    if (this.hasReportedClose) {
      return;
    }

    this.hasReportedClose = true;

    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }

    if (this.readyStateValue !== KenoWebSocket.CLOSED) {
      this.readyStateValue = KenoWebSocket.CLOSED;
    }

    this.compressedQueue = [];
    this.compressedQueueIndex = 0;
    this.compressor?.close();
    this.pendingCloseFrame = undefined;
    this.paused = false;

    const event: WebSocketCloseEvent = {
      code: this.closeCode,
      reason: this.closeReason,
      wasClean: this.hasReceivedCloseFrame || this.hasSentCloseFrame,
    };

    this.emit("close", event);
  }

  private ensurePayloadLimit(length: number): void {
    if (length > this.maxPayload) {
      throw new WebSocketProtocolError("Message exceeds the configured max payload", 1009);
    }
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (
      this.options.perMessageDeflate &&
      (opcode === OPCODES.text || opcode === OPCODES.binary)
    ) {
      this.enqueueCompressedFrame(opcode, payload);
      return;
    }

    if (opcode === OPCODES.text || opcode === OPCODES.binary) {
      this.writeDataFrame(opcode, payload, false);
      return;
    }

    this.raw.write(buildFrame(opcode, payload));
  }

  private inflateMessage(payload: Buffer): Buffer {
    if (!this.options.perMessageDeflate) {
      throw new WebSocketProtocolError("Compressed messages require permessage-deflate support");
    }

    const message = decompressMessage(payload);
    this.ensurePayloadLimit(message.byteLength);
    return message;
  }

  private emitError(error: Error): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
    }
  }

  private writeDataFrame(opcode: number, payload: Buffer, compressed: boolean): boolean {
    const header = buildFrameHeader(opcode, payload.byteLength, { rsv1: compressed });

    if ("cork" in this.raw && typeof this.raw.cork === "function") {
      this.raw.cork();
      this.raw.write(header);
      const wrote = this.raw.write(payload);
      this.raw.uncork();
      return wrote;
    }

    return this.raw.write(buildFrame(opcode, payload, { rsv1: compressed }));
  }

  private writeTextFrame(payload: string): void {
    const length = Buffer.byteLength(payload);
    const header = buildFrameHeader(OPCODES.text, length);

    if ("cork" in this.raw && typeof this.raw.cork === "function") {
      this.raw.cork();
      this.raw.write(header);
      this.raw.write(payload);
      this.raw.uncork();
      return;
    }

    this.raw.write(buildFrame(OPCODES.text, Buffer.from(payload)));
  }

  private enqueueCompressedFrame(opcode: number, payload: Buffer): void {
    this.compressedQueue.push({ opcode, payload });
    void this.flushCompressedQueue();
  }

  private async flushCompressedQueue(): Promise<void> {
    if (this.flushingCompressedQueue) {
      return;
    }

    this.flushingCompressedQueue = true;

    try {
      while (this.compressedQueueIndex < this.compressedQueue.length) {
        const frame = this.compressedQueue[this.compressedQueueIndex];

        if (!frame || !this.options.perMessageDeflate || this.raw.destroyed) {
          break;
        }

        const result = await (this.compressor?.compress(frame.payload) ?? Promise.resolve({
          compressed: false,
          payload: frame.payload,
        }));
        this.compressedQueueIndex += 1;

        const wrote = this.writeDataFrame(frame.opcode, result.payload, result.compressed);

        if (!wrote && !this.raw.destroyed) {
          await waitForDrain(this.raw);
        }
      }
    } catch (error) {
      this.emitError(error as Error);
      this.raw.destroy();
    } finally {
      if (this.compressedQueueIndex >= this.compressedQueue.length) {
        this.compressedQueue = [];
        this.compressedQueueIndex = 0;
      }

      this.flushingCompressedQueue = false;

      if (this.pendingCloseFrame && !this.hasPendingCompressedFrames() && !this.raw.destroyed) {
        this.writeCloseFrame(this.pendingCloseFrame);
        this.pendingCloseFrame = undefined;
      }
    }
  }

  private hasPendingCompressedFrames(): boolean {
    return this.flushingCompressedQueue || this.compressedQueueIndex < this.compressedQueue.length;
  }

  private writeCloseFrame(frame: Buffer): void {
    this.hasSentCloseFrame = true;
    this.raw.write(frame);
    this.closeTimer = setTimeout(() => {
      this.terminate();
    }, this.options.closeTimeout);
    this.closeTimer.unref();
    this.raw.end();
  }
}

function buildClosePayload(code: number, reason: string): Buffer {
  const reasonBuffer = Buffer.from(reason);
  const payload = Buffer.allocUnsafe(2 + reasonBuffer.byteLength);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  return payload;
}

export function createWebSocket(socket: Duplex, options: WebSocketOptions = {}): KenoWebSocket {
  return new KenoWebSocket(socket, {
    autoPong: options.autoPong ?? true,
    closeTimeout: options.closeTimeout ?? 5000,
    maxPayload: options.maxPayload ?? 1024 * 1024,
    protocol: options.protocol ?? "",
    skipUTF8Validation: options.skipUTF8Validation ?? false,
    ...(options.perMessageDeflate ? { perMessageDeflate: options.perMessageDeflate } : {}),
  });
}

function waitForDrain(socket: Duplex): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("close", handleClose);
      socket.off("drain", handleDrain);
      socket.off("error", handleError);
    };

    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before the write buffer drained"));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("drain", handleDrain);
    socket.once("close", handleClose);
    socket.once("error", handleError);
  });
}
