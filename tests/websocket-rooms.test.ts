import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KenoWebSocket,
  createWebSocketHeartbeat,
  createWebSocketRooms,
} from "../src";

class FakeSocket extends EventEmitter {
  readonly binaryFrames: Uint8Array[] = [];
  readonly closeFrames: { code: number; reason: string }[] = [];
  readonly textFrames: string[] = [];
  pingCount = 0;
  readyState = KenoWebSocket.OPEN;

  sendBinary(data: Uint8Array | ArrayBuffer | ArrayBufferView): void {
    this.binaryFrames.push(
      data instanceof Uint8Array
        ? data
        : Buffer.from(data instanceof ArrayBuffer ? data : data.buffer),
    );
  }

  sendText(data: string): void {
    this.textFrames.push(data);
  }

  ping(): void {
    this.pingCount += 1;
  }

  close(code = 1000, reason = ""): void {
    this.closeFrames.push({ code, reason });
    this.readyState = KenoWebSocket.CLOSED;
    this.emit("close", {
      code,
      reason,
      wasClean: false,
    });
  }

  terminate(): void {
    this.readyState = KenoWebSocket.CLOSED;
  }
}

const heartbeats: Array<{ close: () => void }> = [];

afterEach(() => {
  while (heartbeats.length > 0) {
    heartbeats.pop()?.close();
  }
});

describe("websocket rooms and heartbeat", () => {
  it("tracks memberships and broadcasts within a room", () => {
    const heartbeatController = {
      track: vi.fn(),
      untrack: vi.fn(),
    };
    const rooms = createWebSocketRooms<string>({
      heartbeat: heartbeatController,
    });
    const alpha = new FakeSocket() as unknown as KenoWebSocket;
    const beta = new FakeSocket() as unknown as KenoWebSocket;
    const gamma = new FakeSocket() as unknown as KenoWebSocket;

    rooms.join("general", alpha, "ana");
    rooms.join("general", beta, "bruno");
    rooms.join("ops", gamma, "carla");

    rooms.broadcast("general", {
      type: "message",
      value: "hello",
    });

    expect(rooms.size("general")).toBe(2);
    expect(rooms.roomNames()).toEqual(["general", "ops"]);
    expect(rooms.roomsOf(beta)).toEqual(["general"]);
    expect(rooms.members("general").map((member) => member.meta)).toEqual(["ana", "bruno"]);
    expect((alpha as unknown as FakeSocket).textFrames).toEqual(['{"type":"message","value":"hello"}']);
    expect((beta as unknown as FakeSocket).textFrames).toEqual(['{"type":"message","value":"hello"}']);
    expect((gamma as unknown as FakeSocket).textFrames).toEqual([]);
    expect(heartbeatController.track).toHaveBeenCalledTimes(3);

    rooms.leave(beta);
    expect(rooms.size("general")).toBe(1);
    expect(heartbeatController.untrack).toHaveBeenCalledTimes(1);
  });

  it("pings tracked sockets and closes stale ones", async () => {
    const heartbeat = createWebSocketHeartbeat({
      intervalMs: 5,
      timeoutMs: 5,
    });
    heartbeats.push(heartbeat);

    const socket = new FakeSocket() as unknown as KenoWebSocket;
    heartbeat.track(socket);

    await delay(20);

    expect((socket as unknown as FakeSocket).pingCount).toBeGreaterThan(0);
    expect((socket as unknown as FakeSocket).closeFrames[0]).toMatchObject({
      code: 1001,
      reason: "Heartbeat timeout",
    });
  });

  it("keeps a socket alive when it answers pong frames", async () => {
    const heartbeat = createWebSocketHeartbeat({
      intervalMs: 5,
      timeoutMs: 20,
    });
    heartbeats.push(heartbeat);

    const socket = new FakeSocket() as unknown as KenoWebSocket;
    heartbeat.track(socket);

    await delay(8);
    (socket as unknown as FakeSocket).emit("pong", new Uint8Array(0));
    heartbeat.close();

    expect((socket as unknown as FakeSocket).pingCount).toBeGreaterThan(0);
    expect((socket as unknown as FakeSocket).closeFrames).toHaveLength(0);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
