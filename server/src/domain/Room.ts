import { Participant } from "./Participant.js";
import type { Role } from "./roles.js";

export type PlayState = "playing" | "paused";

/**
 * Authoritative video state for a room. The server is the single source of
 * truth; clients render whatever this says. `currentTime` + `lastUpdatedAt`
 * let a late joiner compute the *effective* playhead (see `effectiveTime`).
 */
export interface VideoState {
  videoId: string | null;
  playState: PlayState;
  currentTime: number; // seconds into the video, as of lastUpdatedAt
  lastUpdatedAt: number; // epoch ms when currentTime was last authoritative
}

/**
 * A watch room. Pure domain object — it knows nothing about Socket.IO. It
 * owns participants + video state and enforces structural invariants (e.g.
 * there is always exactly one host while anyone is present). Broadcasting is
 * the MessageHandler's job.
 */
export class Room {
  readonly id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  hostTokenHash: string;
  private participants = new Map<string, Participant>(); // keyed by participant id
  private bannedAddresses = new Set<string>();
  video: VideoState;

  constructor(
    id: string,
    createdAt: number,
    initialVideoId: string | null = null,
    hostTokenHash = "",
    expiresAt = createdAt + 86_400_000
  ) {
    this.id = id;
    this.createdAt = createdAt;
    this.hostTokenHash = hostTokenHash;
    this.expiresAt = expiresAt;
    this.video = {
      videoId: initialVideoId,
      playState: "paused",
      currentTime: 0,
      lastUpdatedAt: createdAt,
    };
  }

  // ---- participant management -------------------------------------------

  get size(): number {
    return this.participants.size;
  }

  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  list(): Participant[] {
    return [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  get(id: string): Participant | undefined {
    return this.participants.get(id);
  }

  getBySocketId(socketId: string): Participant | undefined {
    for (const p of this.participants.values()) {
      if (p.socketId === socketId) return p;
    }
    return undefined;
  }

  hasHost(): boolean {
    return this.list().some((p) => p.role === "host");
  }

  /** Adds a participant with the role chosen by the authenticated boundary. */
  add(params: {
    id: string;
    username: string;
    socketId: string;
    joinedAt: number;
    role?: Role;
  }): Participant {
    if (this.participants.has(params.id)) {
      throw new Error("Duplicate participant id");
    }
    const role: Role = params.role ?? "participant";
    const participant = new Participant({ ...params, role });
    this.participants.set(participant.id, participant);
    return participant;
  }

  isFull(maxParticipants: number): boolean {
    return this.size >= maxParticipants;
  }

  banAddress(address: string): void {
    if (address) this.bannedAddresses.add(address);
  }

  isAddressBanned(address: string): boolean {
    return this.bannedAddresses.has(address);
  }

  remove(id: string): Participant | undefined {
    const p = this.participants.get(id);
    if (!p) return undefined;
    this.participants.delete(id);
    return p;
  }

  // ---- role mutations ----------------------------------------------------

  assignRole(targetId: string, role: Role): Participant | undefined {
    const target = this.participants.get(targetId);
    if (!target) return undefined;
    target.role = role;
    return target;
  }

  /**
   * Transfers host from the current host to `targetId`. The old host is
   * demoted to moderator. Returns { oldHost, newHost } or undefined on failure.
   */
  transferHost(
    currentHostId: string,
    targetId: string
  ): { oldHost: Participant; newHost: Participant } | undefined {
    const oldHost = this.participants.get(currentHostId);
    const newHost = this.participants.get(targetId);
    if (!oldHost || !newHost || oldHost.role !== "host" || oldHost.id === newHost.id) {
      return undefined;
    }
    oldHost.role = "moderator";
    newHost.role = "host";
    return { oldHost, newHost };
  }

  // ---- video state -------------------------------------------------------

  /** Effective playhead right now, accounting for elapsed wall-clock if playing. */
  effectiveTime(now: number): number {
    if (this.video.playState === "playing" && this.video.videoId) {
      return this.video.currentTime + (now - this.video.lastUpdatedAt) / 1000;
    }
    return this.video.currentTime;
  }

  play(atTime: number, now: number): void {
    this.video.currentTime = atTime;
    this.video.playState = "playing";
    this.video.lastUpdatedAt = now;
  }

  pause(atTime: number, now: number): void {
    this.video.currentTime = atTime;
    this.video.playState = "paused";
    this.video.lastUpdatedAt = now;
  }

  seek(atTime: number, now: number): void {
    this.video.currentTime = Math.max(0, atTime);
    this.video.lastUpdatedAt = now;
  }

  changeVideo(videoId: string, now: number): void {
    this.video.videoId = videoId;
    this.video.currentTime = 0;
    this.video.playState = "paused";
    this.video.lastUpdatedAt = now;
  }

  /** State snapshot for `sync_state`, with playhead advanced to `now`. */
  snapshot(now: number) {
    return {
      videoId: this.video.videoId,
      playState: this.video.playState,
      currentTime: this.effectiveTime(now),
    };
  }
}
