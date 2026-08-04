import type { Role, Permission } from "./roles.js";
import { can } from "./roles.js";

/**
 * A single user connected to a Room.
 *
 * `id` is a stable per-session identifier (not the socket id) so that role
 * assignments and removals reference the user rather than the transport.
 * `socketId` links back to the live Socket.IO connection for targeted emits.
 */
export class Participant {
  readonly id: string;
  readonly username: string;
  socketId: string;
  role: Role;
  readonly joinedAt: number;

  constructor(params: {
    id: string;
    username: string;
    socketId: string;
    role: Role;
    joinedAt: number;
  }) {
    this.id = params.id;
    this.username = params.username;
    this.socketId = params.socketId;
    this.role = params.role;
    this.joinedAt = params.joinedAt;
  }

  can(permission: Permission): boolean {
    return can(this.role, permission);
  }

  /** Serializable view sent to clients (no socketId leaked to the room). */
  toJSON() {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      joinedAt: this.joinedAt,
    };
  }
}
