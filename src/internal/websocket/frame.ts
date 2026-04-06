import { createRequire } from "node:module";

export class WebSocketProtocolError extends Error {
  readonly closeCode: number;

  constructor(message: string, closeCode = 1002) {
    super(message);
    this.name = "WebSocketProtocolError";
    this.closeCode = closeCode;
  }
}

export interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  rsv1: boolean;
}

export interface FrameBuildOptions {
  fin?: boolean;
  rsv1?: boolean;
}

export interface FrameParseOptions {
  allowRsv1?: boolean;
}

const VALID_CONTROL_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011]);
const require = createRequire(import.meta.url);

interface BufferUtilModule {
  unmask(buffer: Buffer, mask: Buffer): void;
}

function loadBufferUtil(): BufferUtilModule | undefined {
  if (process.env.KENO_NO_BUFFER_UTIL === "1" || process.env.WS_NO_BUFFER_UTIL) {
    return undefined;
  }

  try {
    return require("bufferutil") as BufferUtilModule;
  } catch {
    return undefined;
  }
}

const bufferUtil = loadBufferUtil();

export const OPCODES = {
  binary: 0x02,
  close: 0x08,
  continuation: 0x00,
  ping: 0x09,
  pong: 0x0a,
  text: 0x01,
} as const;

export function isValidCloseCode(code: number): boolean {
  if (VALID_CONTROL_CODES.has(code)) {
    return true;
  }

  return code >= 3000 && code < 5000;
}

export function buildFrame(
  opcode: number,
  payload: Buffer,
  options: FrameBuildOptions = {},
): Buffer {
  const header = buildFrameHeader(opcode, payload.byteLength, options);
  const frame = Buffer.allocUnsafe(header.byteLength + payload.byteLength);
  header.copy(frame, 0);
  payload.copy(frame, header.byteLength);
  return frame;
}

export function buildFrameHeader(
  opcode: number,
  payloadLength: number,
  options: FrameBuildOptions = {},
): Buffer {
  const fin = options.fin ?? true;
  const rsv1 = options.rsv1 ?? false;
  let offset = 2;
  let encodedLength = payloadLength;

  if (encodedLength > 125 && encodedLength < 65_536) {
    offset += 2;
    encodedLength = 126;
  } else if (encodedLength >= 65_536) {
    offset += 8;
    encodedLength = 127;
  }

  const header = Buffer.allocUnsafe(offset);
  header[0] = opcode | (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0);
  header[1] = encodedLength;

  if (encodedLength === 126) {
    header.writeUInt16BE(payloadLength, 2);
  } else if (encodedLength === 127) {
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  return header;
}

export function tryParseFrame(
  buffer: Buffer,
  options: FrameParseOptions = {},
): { consumed: number; frame: ParsedFrame } | null {
  if (buffer.byteLength < 2) {
    return null;
  }

  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;

  const rsv1 = (firstByte & 0x40) === 0x40;

  if ((firstByte & 0x30) !== 0 || (rsv1 && !options.allowRsv1)) {
    throw new WebSocketProtocolError("Reserved bits are not supported");
  }

  const fin = (firstByte & 0x80) === 0x80;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) === 0x80;

  if (!masked) {
    throw new WebSocketProtocolError("Client frames must be masked");
  }

  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.byteLength < 4) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.byteLength < 10) {
      return null;
    }

    const length = buffer.readBigUInt64BE(2);

    if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WebSocketProtocolError("Payload length exceeds JavaScript limits", 1009);
    }

    payloadLength = Number(length);
    offset = 10;
  }

  const isControl = opcode >= 0x08;

  if (isControl && (rsv1 || !fin || payloadLength > 125)) {
    throw new WebSocketProtocolError("Invalid control frame");
  }

  if (buffer.byteLength < offset + 4 + payloadLength) {
    return null;
  }

  const mask0 = buffer[offset] ?? 0;
  const mask1 = buffer[offset + 1] ?? 0;
  const mask2 = buffer[offset + 2] ?? 0;
  const mask3 = buffer[offset + 3] ?? 0;
  const payload = buffer.subarray(offset + 4, offset + 4 + payloadLength);

  unmaskPayload(payload, mask0, mask1, mask2, mask3);

  return {
    consumed: offset + 4 + payloadLength,
    frame: {
      fin,
      opcode,
      payload,
      rsv1,
    },
  };
}

function unmaskPayload(
  payload: Buffer,
  mask0: number,
  mask1: number,
  mask2: number,
  mask3: number,
): void {
  if (bufferUtil) {
    bufferUtil.unmask(payload, Buffer.from([mask0, mask1, mask2, mask3]));
    return;
  }

  const mask = (((mask0 & 0xff) << 24) | ((mask1 & 0xff) << 16) | ((mask2 & 0xff) << 8) | (mask3 & 0xff)) >>> 0;
  let index = 0;

  for (; index + 4 <= payload.byteLength; index += 4) {
    const value = payload.readUInt32BE(index);
    payload.writeUInt32BE((value ^ mask) >>> 0, index);
  }

  for (; index < payload.byteLength; index += 1) {
    const mask = index % 4 === 0 ? mask0 : index % 4 === 1 ? mask1 : index % 4 === 2 ? mask2 : mask3;
    payload[index] = (payload[index] ?? 0) ^ mask;
  }
}
