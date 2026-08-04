import { customAlphabet } from "nanoid";
import { Room } from "./Room.js";
import { RoomStore } from "../db/database.js";

/** Human-friendly room codes: 6 uppercase/number chars, no ambiguous 0/O/1/I. */
const genRoomCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

/**
 * Owns the collection of live Rooms and mediates persistence.
 *
 * In-memory Map is the fast path for realtime lookups; the RoomStore keeps a
 * durable copy of room metadata + video state so rooms can be rehydrated after
 * a restart. This is the single place that creates/loads/destroys rooms.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private store: RoomStore, private now: () => number = () => Date.now()) {}

  createRoom(initialVideoId: string | null = null, hostTokenHash = ""): Room {
    let id = genRoomCode();
    while (this.rooms.has(id) || this.store.getRoom(id)) id = genRoomCode();

    const createdAt = this.now();
    const expiresAt = createdAt + 86_400_000;
    const room = new Room(id, createdAt, initialVideoId, hostTokenHash, expiresAt);
    this.rooms.set(id, room);
    this.store.insertRoom({
      id,
      created_at: createdAt,
      expires_at: expiresAt,
      host_token_hash: hostTokenHash,
      video_id: initialVideoId,
      play_state: room.video.playState,
      position_seconds: room.video.currentTime,
      last_updated_at: room.video.lastUpdatedAt,
    });
    return room;
  }

  /** Returns a live room, rehydrating from the store if it exists there only. */
  getRoom(id: string): Room | undefined {
    const key = id.toUpperCase();
    const live = this.rooms.get(key);
    if (live) return live;

    const row = this.store.getRoom(key);
    if (!row) return undefined;

    const room = new Room(row.id, row.created_at, row.video_id, row.host_token_hash, row.expires_at);
    room.video = {
      videoId: row.video_id,
      playState: row.play_state as Room["video"]["playState"],
      currentTime: row.position_seconds,
      lastUpdatedAt: row.last_updated_at,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  exists(id: string): boolean {
    return this.getRoom(id) !== undefined;
  }

  /** Persists the room's current video state (called after playback mutations). */
  persistVideoState(room: Room): void {
    this.store.updateVideoState(room.id, {
      video_id: room.video.videoId,
      play_state: room.video.playState,
      position_seconds: room.video.currentTime,
      last_updated_at: room.video.lastUpdatedAt,
    });
  }

  persistHostToken(room: Room): void {
    this.store.updateHostTokenHash(room.id, room.hostTokenHash);
  }

  pruneExpired(now: number): number {
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= now) this.rooms.delete(id);
    }
    return this.store.deleteExpired(now);
  }

  /** Drops an empty room from memory. Metadata is retained in the store. */
  disposeIfEmpty(room: Room): boolean {
    if (room.isEmpty()) {
      this.rooms.delete(room.id);
      return true;
    }
    return false;
  }

  liveRoomCount(): number {
    return this.rooms.size;
  }

  totalParticipants(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.size;
    return n;
  }
}
