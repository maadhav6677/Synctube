import type { Server, Socket } from "socket.io";
import { customAlphabet } from "nanoid";
import { RoomManager } from "../domain/RoomManager.js";
import { Room } from "../domain/Room.js";
import { Participant } from "../domain/Participant.js";
import { isAssignableRole } from "../domain/roles.js";
import { config } from "../config.js";
import { createHostToken, hasHostAccess, hashHostToken } from "../security/hostToken.js";
import { SlidingWindowRateLimiter } from "../security/SlidingWindowRateLimiter.js";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./events.js";

const genUserId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const ROOM_ID = /^[A-HJ-NP-Z2-9]{6}$/;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const MAX_VIDEO_SECONDS = 86_400;

function isDisplayName(value: string): boolean {
  return value.length > 0 && value.length <= 32 && !/[\p{C}]/u.test(value);
}

type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Encapsulates all realtime event handling for a single socket connection.
 *
 * Design: one MessageHandler instance per connected socket. It wires the raw
 * Socket.IO events to the domain model (RoomManager / Room / Participant) and
 * is the sole place where RBAC is enforced — a control event is validated
 * against the sender's role *before* any state mutation or broadcast. This is
 * the "backend must validate permissions" requirement.
 */
export class MessageHandler {
  private roomId: string | null = null;
  private userId: string | null = null;
  private readonly eventLimiter = new SlidingWindowRateLimiter();
  private readonly chatLimiter = new SlidingWindowRateLimiter();

  constructor(
    private io: IOServer,
    private socket: IOSocket,
    private rooms: RoomManager,
    private now: () => number = () => Date.now()
  ) {}

  /** Register all event listeners for this socket. */
  register(): void {
    this.socket.on("join_room", (p, ack) => this.withRateLimit(() => this.onJoin(p, ack)));
    this.socket.on("leave_room", () => this.withRateLimit(() => this.onLeave()));
    this.socket.on("play", (p) => this.withRateLimit(() => this.onPlayback("play", p?.time)));
    this.socket.on("pause", (p) => this.withRateLimit(() => this.onPlayback("pause", p?.time)));
    this.socket.on("seek", (p) => this.withRateLimit(() => this.onPlayback("seek", p?.time)));
    this.socket.on("change_video", (p) => this.withRateLimit(() => this.onChangeVideo(p)));
    this.socket.on("assign_role", (p) => this.withRateLimit(() => this.onAssignRole(p)));
    this.socket.on("remove_participant", (p) => this.withRateLimit(() => this.onRemoveParticipant(p)));
    this.socket.on("transfer_host", (p) => this.withRateLimit(() => this.onTransferHost(p)));
    this.socket.on("chat_message", (p) => this.withRateLimit(() => this.onChat(p)));
    this.socket.on("disconnect", () => this.onLeave());
  }

  // ---- helpers -----------------------------------------------------------

  private fail(code: string, message: string): void {
    this.socket.emit("error_message", { code, message });
  }

  private withRateLimit(action: () => void): void {
    if (!this.eventLimiter.allow(40, 10_000)) {
      this.fail("RATE_LIMITED", "Too many actions; please slow down");
      return;
    }
    try {
      action();
    } catch {
      this.fail("BAD_REQUEST", "Invalid event payload");
    }
  }

  private remoteAddress(): string {
    return this.socket.handshake.address || "unknown";
  }

  /** Resolve current room + the sender's participant, or null if not joined. */
  private context(): { room: Room; me: Participant } | null {
    if (!this.roomId || !this.userId) return null;
    const room = this.rooms.getRoom(this.roomId);
    if (!room) return null;
    const me = room.get(this.userId);
    if (!me) return null;
    return { room, me };
  }

  private participantsView(room: Room) {
    return room.list().map((p) => p.toJSON());
  }

  private broadcastState(room: Room, origin: string): void {
    const snap = room.snapshot(this.now());
    this.io.to(room.id).emit("sync_state", { ...snap, origin });
  }

  // ---- join / leave ------------------------------------------------------

  private onJoin(
    payload: { roomId: string; username: string; hostToken?: string },
    ack?: (res: any) => void
  ): void {
    if (this.roomId) {
      ack?.({ ok: false, error: "A socket may join only one room" });
      return;
    }
    const roomId = typeof payload?.roomId === "string" ? payload.roomId.toUpperCase().trim() : "";
    const username = typeof payload?.username === "string" ? payload.username.trim() : "";
    if (!ROOM_ID.test(roomId) || !isDisplayName(username)) {
      ack?.({ ok: false, error: "Provide a valid room code and display name" });
      return;
    }
    const room = this.rooms.getRoom(roomId);
    if (!room) {
      ack?.({ ok: false, error: "Room not found" });
      return;
    }
    if (room.expiresAt <= this.now()) {
      this.rooms.pruneExpired(this.now());
      ack?.({ ok: false, error: "Room has expired" });
      return;
    }
    if (room.isAddressBanned(this.remoteAddress())) {
      ack?.({ ok: false, error: "You cannot rejoin this room" });
      return;
    }
    if (room.isFull(config.maxParticipantsPerRoom)) {
      ack?.({ ok: false, error: "This room is full" });
      return;
    }

    const wantsHost = hasHostAccess(payload?.hostToken, room.hostTokenHash);
    if (wantsHost && room.hasHost()) {
      ack?.({ ok: false, error: "The host is already connected" });
      return;
    }
    const userId = genUserId();
    const me = room.add({
      id: userId,
      username,
      socketId: this.socket.id,
      joinedAt: this.now(),
      role: wantsHost ? "host" : "participant",
    });

    this.roomId = room.id;
    this.userId = me.id;
    this.socket.join(room.id);

    // Acknowledge the joiner with full room snapshot so they render immediately.
    ack?.({
      ok: true,
      you: me.toJSON(),
      roomId: room.id,
      participants: this.participantsView(room),
      video: room.snapshot(this.now()),
    });

    // Tell everyone (including joiner) about the new participant + roster.
    this.io.to(room.id).emit("user_joined", {
      userId: me.id,
      username: me.username,
      role: me.role,
      participants: this.participantsView(room),
    });

    // Push current authoritative playback state to just the new socket.
    this.socket.emit("sync_state", {
      ...room.snapshot(this.now()),
      origin: "snapshot",
    });
  }

  private onLeave(): void {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;

    room.remove(me.id);
    this.socket.leave(room.id);

    this.io.to(room.id).emit("user_left", {
      userId: me.id,
      username: me.username,
      participants: this.participantsView(room),
    });

    this.rooms.disposeIfEmpty(room);
    this.roomId = null;
    this.userId = null;
  }

  // ---- playback (RBAC: playback) ----------------------------------------

  private onPlayback(kind: "play" | "pause" | "seek", time?: number): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;

    if (!me.can("playback")) {
      return this.fail(
        "FORBIDDEN",
        `Role '${me.role}' cannot control playback`
      );
    }

    const now = this.now();
    if (time !== undefined && (!Number.isFinite(time) || time < 0 || time > MAX_VIDEO_SECONDS)) {
      return this.fail("BAD_REQUEST", "Playback time is invalid");
    }
    const t = typeof time === "number" ? time : room.effectiveTime(now);
    if (kind === "play") room.play(t, now);
    else if (kind === "pause") room.pause(t, now);
    else room.seek(t, now);

    this.rooms.persistVideoState(room);
    this.broadcastState(room, kind);
  }

  // ---- change video (RBAC: change_video) --------------------------------

  private onChangeVideo(payload: { videoId: string }): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;

    if (!me.can("change_video")) {
      return this.fail("FORBIDDEN", `Role '${me.role}' cannot change the video`);
    }
    const videoId = typeof payload?.videoId === "string" ? payload.videoId.trim() : "";
    if (!VIDEO_ID.test(videoId)) return this.fail("BAD_REQUEST", "videoId must be a valid YouTube video ID");

    room.changeVideo(videoId, this.now());
    this.rooms.persistVideoState(room);
    this.broadcastState(room, "change_video");
  }

  // ---- assign role (RBAC: assign_role, host only) -----------------------

  private onAssignRole(payload: { userId: string; role: string }): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;

    if (!me.can("assign_role")) {
      return this.fail("FORBIDDEN", "Only the host can assign roles");
    }
    if (!isAssignableRole(payload?.role)) {
      return this.fail(
        "BAD_REQUEST",
        "Assignable roles: moderator, participant, viewer"
      );
    }
    const target = room.get(typeof payload?.userId === "string" ? payload.userId : "");
    if (!target) return this.fail("NOT_FOUND", "Target participant not found");
    if (target.id === me.id) {
      return this.fail("BAD_REQUEST", "Host cannot change their own role; use transfer host");
    }

    room.assignRole(target.id, payload.role);
    this.io.to(room.id).emit("role_assigned", {
      userId: target.id,
      username: target.username,
      role: target.role,
      participants: this.participantsView(room),
    });
  }

  // ---- remove participant (RBAC: remove_participant, host only) ---------

  private onRemoveParticipant(payload: { userId: string }): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;

    if (!me.can("remove_participant")) {
      return this.fail("FORBIDDEN", "Only the host can remove participants");
    }
    const target = room.get(typeof payload?.userId === "string" ? payload.userId : "");
    if (!target) return this.fail("NOT_FOUND", "Target participant not found");
    if (target.id === me.id) {
      return this.fail("BAD_REQUEST", "Host cannot remove themselves");
    }

    const targetSocketId = target.socketId;
    room.remove(target.id);
    room.banAddress(this.io.sockets.sockets.get(targetSocketId)?.handshake.address ?? "");

    // Notify the removed user, force them out of the socket room, and tell rest.
    this.io.to(targetSocketId).emit("you_were_removed", { roomId: room.id });
    this.io.sockets.sockets.get(targetSocketId)?.disconnect(true);
    this.io.to(room.id).emit("participant_removed", {
      userId: target.id,
      participants: this.participantsView(room),
    });
  }

  // ---- transfer host (RBAC: transfer_host, host only) -------------------

  private onTransferHost(payload: { userId: string }): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;

    if (!me.can("transfer_host")) {
      return this.fail("FORBIDDEN", "Only the host can transfer host");
    }
    const result = room.transferHost(me.id, typeof payload?.userId === "string" ? payload.userId : "");
    if (!result) return this.fail("BAD_REQUEST", "Invalid host transfer target");

    const hostToken = createHostToken();
    room.hostTokenHash = hashHostToken(hostToken);
    this.rooms.persistHostToken(room);
    this.io.to(result.newHost.socketId).emit("host_credentials", { hostToken });

    this.io.to(room.id).emit("host_transferred", {
      oldHostId: result.oldHost.id,
      newHostId: result.newHost.id,
      participants: this.participantsView(room),
    });
  }

  // ---- chat (bonus) ------------------------------------------------------

  private onChat(payload: { text: string }): void {
    const ctx = this.context();
    if (!ctx) return this.fail("NOT_IN_ROOM", "You are not in a room");
    const { room, me } = ctx;
    if (!this.chatLimiter.allow(8, 10_000)) {
      return this.fail("RATE_LIMITED", "Please wait before sending another message");
    }
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) return;
    if (text.length > 500) return this.fail("BAD_REQUEST", "Messages are limited to 500 characters");
    this.io.to(room.id).emit("chat_message", {
      userId: me.id,
      username: me.username,
      text,
      at: this.now(),
    });
  }
}
