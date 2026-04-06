import type {
  WebSocketRoomMember,
  WebSocketRoomsOptions,
} from "../shared/types";

import { KenoWebSocket } from "./connection";

type RoomState<Meta> = Map<KenoWebSocket, Meta | undefined>;

export class KenoWebSocketRooms<Meta = unknown> {
  private readonly closeBindings = new Map<KenoWebSocket, () => void>();
  private readonly rooms = new Map<string, RoomState<Meta>>();
  private readonly socketRooms = new Map<KenoWebSocket, Set<string>>();

  constructor(private readonly options: WebSocketRoomsOptions = {}) {}

  join(roomName: string, socket: KenoWebSocket, meta?: Meta): void {
    const room = normalizeRoomName(roomName);
    let members = this.rooms.get(room);

    if (!members) {
      members = new Map();
      this.rooms.set(room, members);
    }

    members.set(socket, meta);

    let assignedRooms = this.socketRooms.get(socket);

    if (!assignedRooms) {
      assignedRooms = new Set();
      this.socketRooms.set(socket, assignedRooms);
    }

    assignedRooms.add(room);
    this.ensureSocketCleanup(socket);
    this.options.heartbeat?.track(socket);
  }

  leave(socket: KenoWebSocket, roomName?: string): void {
    if (roomName) {
      this.removeSocketFromRoom(socket, normalizeRoomName(roomName));
      return;
    }

    const rooms = this.socketRooms.get(socket);

    if (!rooms) {
      return;
    }

    for (const room of Array.from(rooms)) {
      this.removeSocketFromRoom(socket, room);
    }
  }

  broadcast(roomName: string, payload: unknown): void {
    const room = this.rooms.get(normalizeRoomName(roomName));

    if (!room) {
      return;
    }

    for (const socket of room.keys()) {
      if (socket.readyState !== KenoWebSocket.OPEN) {
        continue;
      }

      sendPayload(socket, payload);
    }
  }

  members(roomName: string): WebSocketRoomMember<Meta>[] {
    const room = this.rooms.get(normalizeRoomName(roomName));

    if (!room) {
      return [];
    }

    return Array.from(room, ([socket, meta]) => ({
      meta,
      socket,
    }));
  }

  roomNames(): string[] {
    return Array.from(this.rooms.keys()).sort();
  }

  roomsOf(socket: KenoWebSocket): string[] {
    return Array.from(this.socketRooms.get(socket) ?? []).sort();
  }

  size(roomName: string): number {
    return this.rooms.get(normalizeRoomName(roomName))?.size ?? 0;
  }

  private ensureSocketCleanup(socket: KenoWebSocket): void {
    if (this.closeBindings.has(socket)) {
      return;
    }

    const handleClose = () => {
      this.leave(socket);
    };

    socket.once("close", handleClose);
    this.closeBindings.set(socket, handleClose);
  }

  private removeSocketFromRoom(socket: KenoWebSocket, roomName: string): void {
    const room = this.rooms.get(roomName);

    if (room) {
      room.delete(socket);

      if (room.size === 0) {
        this.rooms.delete(roomName);
      }
    }

    const assignedRooms = this.socketRooms.get(socket);

    if (!assignedRooms) {
      return;
    }

    assignedRooms.delete(roomName);

    if (assignedRooms.size > 0) {
      return;
    }

    this.socketRooms.delete(socket);
    this.options.heartbeat?.untrack(socket);

    const handleClose = this.closeBindings.get(socket);

    if (handleClose) {
      socket.off("close", handleClose);
      this.closeBindings.delete(socket);
    }
  }
}

export function createWebSocketRooms<Meta = unknown>(
  options: WebSocketRoomsOptions = {},
): KenoWebSocketRooms<Meta> {
  return new KenoWebSocketRooms<Meta>(options);
}

function normalizeRoomName(value: string): string {
  const roomName = value.trim();

  if (!roomName) {
    throw new TypeError("Room names cannot be empty");
  }

  return roomName;
}

function sendPayload(socket: KenoWebSocket, payload: unknown): void {
  if (
    payload instanceof Uint8Array ||
    payload instanceof ArrayBuffer ||
    ArrayBuffer.isView(payload)
  ) {
    socket.sendBinary(payload);
    return;
  }

  if (typeof payload === "string") {
    socket.sendText(payload);
    return;
  }

  socket.sendText(JSON.stringify(payload));
}
