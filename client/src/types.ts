export type Role = "host" | "moderator" | "participant" | "viewer";

export interface Participant {
  id: string;
  username: string;
  role: Role;
  joinedAt: number;
}

export interface VideoSnapshot {
  videoId: string | null;
  playState: string; // "playing" | "paused"
  currentTime: number;
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  at: number;
}

/** Permissions mirror the backend matrix so the UI can pre-disable controls.
 *  The backend remains the source of truth and re-validates every action. */
export function canControlPlayback(role: Role): boolean {
  return role === "host" || role === "moderator";
}
export function canManageRoom(role: Role): boolean {
  return role === "host";
}
