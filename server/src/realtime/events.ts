import type { Role } from "../domain/roles.js";

/**
 * Wire contract between client and server. Kept in one place so the frontend
 * (which imports an equivalent copy) and backend agree on payload shapes.
 */

export interface ParticipantView {
  id: string;
  username: string;
  role: Role;
  joinedAt: number;
}

// ---- Client -> Server ----------------------------------------------------
export interface ClientToServerEvents {
  join_room: (
    payload: { roomId: string; username: string; hostToken?: string },
    ack: (res: JoinAck) => void
  ) => void;
  leave_room: (payload: { roomId: string }) => void;
  play: (payload: { time?: number }) => void;
  pause: (payload: { time?: number }) => void;
  seek: (payload: { time: number }) => void;
  change_video: (payload: { videoId: string }) => void;
  assign_role: (payload: { userId: string; role: Role }) => void;
  remove_participant: (payload: { userId: string }) => void;
  transfer_host: (payload: { userId: string }) => void;
  chat_message: (payload: { text: string }) => void;
}

export type JoinAck =
  | {
      ok: true;
      you: ParticipantView;
      roomId: string;
      participants: ParticipantView[];
      video: { videoId: string | null; playState: string; currentTime: number };
    }
  | { ok: false; error: string };

// ---- Server -> Client ----------------------------------------------------
export interface ServerToClientEvents {
  sync_state: (payload: {
    playState: string;
    currentTime: number;
    videoId: string | null;
    origin?: string; // action that produced this state: play|pause|seek|change_video|snapshot
  }) => void;
  user_joined: (payload: {
    userId: string;
    username: string;
    role: Role;
    participants: ParticipantView[];
  }) => void;
  user_left: (payload: {
    userId: string;
    username: string;
    participants: ParticipantView[];
  }) => void;
  role_assigned: (payload: {
    userId: string;
    username: string;
    role: Role;
    participants: ParticipantView[];
  }) => void;
  participant_removed: (payload: {
    userId: string;
    participants: ParticipantView[];
  }) => void;
  host_transferred: (payload: {
    oldHostId: string;
    newHostId: string;
    participants: ParticipantView[];
  }) => void;
  you_were_removed: (payload: { roomId: string }) => void;
  chat_message: (payload: {
    userId: string;
    username: string;
    text: string;
    at: number;
  }) => void;
  error_message: (payload: { code: string; message: string }) => void;
  host_credentials: (payload: { hostToken: string }) => void;
}
