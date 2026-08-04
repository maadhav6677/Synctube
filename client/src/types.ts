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

export interface CreatedRoomResponse {
  roomId: string;
  hostToken: string;
}

export interface JoinRoomSuccess {
  ok: true;
  you: Participant;
  roomId: string;
  participants: Participant[];
  video: VideoSnapshot;
}

export interface JoinRoomFailure {
  ok: false;
  error?: string;
}

export type JoinRoomResult = JoinRoomSuccess | JoinRoomFailure;

export interface ParticipantRosterEvent {
  username: string;
  participants: Participant[];
}

export interface RoleAssignedEvent extends ParticipantRosterEvent {
  role: Role;
}

export interface ParticipantRemovedEvent {
  participants: Participant[];
}

export interface HostTransferredEvent {
  participants: Participant[];
}

export interface HostCredentialsEvent {
  hostToken: string;
}

export interface SocketErrorEvent {
  message: string;
}

/** Permissions mirror the backend matrix so the UI can pre-disable controls.
 *  The backend remains the source of truth and re-validates every action. */
export function canControlPlayback(role: Role): boolean {
  return role === "host" || role === "moderator";
}
export function canManageRoom(role: Role): boolean {
  return role === "host";
}
