import { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";
import {
  type Participant,
  type Role,
  type VideoSnapshot,
  type ChatMessage,
  canControlPlayback,
  canManageRoom,
} from "../types";
import { parseVideoId } from "../youtube";
import { VideoPlayer } from "./VideoPlayer";
import { ParticipantList } from "./ParticipantList";
import { Chat } from "./Chat";
import { saveHostToken } from "../hostToken";

interface Props {
  roomId: string;
  username: string;
  hostToken?: string;
  onLeave: () => void;
}

/**
 * The live room. Owns the socket session: connects, joins, subscribes to all
 * server events, and maps them into React state. All control actions emit
 * socket events; the server validates and echoes authoritative state back.
 */
export function RoomScreen({ roomId, username, hostToken, onLeave }: Props) {
  const [meId, setMeId] = useState("");
  const [myRole, setMyRole] = useState<Role>("participant");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [snapshot, setSnapshot] = useState<VideoSnapshot>({
    videoId: null,
    playState: "paused",
    currentTime: 0,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toast, setToast] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [connected, setConnected] = useState(false);

  const amController = canControlPlayback(myRole);
  const amHost = canManageRoom(myRole);

  // Keep my own role in sync as the participant roster updates.
  const myRoleFromRoster = useMemo(
    () => participants.find((p) => p.id === meId)?.role,
    [participants, meId]
  );
  useEffect(() => {
    if (myRoleFromRoster) setMyRole(myRoleFromRoster);
  }, [myRoleFromRoster]);

  useEffect(() => {
    socket.connect();

    const flashToast = (msg: string) => {
      setToast(msg);
      setTimeout(() => setToast(""), 3000);
    };

    socket.on("connect", () => {
      setConnected(true);
      socket.emit(
        "join_room",
        { roomId, username, hostToken },
        (res: any) => {
          if (!res.ok) {
            flashToast(res.error ?? "Failed to join");
            onLeave();
            return;
          }
          setMeId(res.you.id);
          setMyRole(res.you.role);
          setParticipants(res.participants);
          setSnapshot(res.video);
        }
      );
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("sync_state", (s: any) =>
      setSnapshot({ videoId: s.videoId, playState: s.playState, currentTime: s.currentTime })
    );
    socket.on("user_joined", (p: any) => {
      setParticipants(p.participants);
      flashToast(`${p.username} joined`);
    });
    socket.on("user_left", (p: any) => {
      setParticipants(p.participants);
      flashToast(`${p.username} left`);
    });
    socket.on("role_assigned", (p: any) => {
      setParticipants(p.participants);
      flashToast(`${p.username} is now ${p.role}`);
    });
    socket.on("participant_removed", (p: any) => setParticipants(p.participants));
    socket.on("host_transferred", (p: any) => {
      setParticipants(p.participants);
      flashToast(`Host transferred`);
    });
    socket.on("host_credentials", (p: any) => {
      if (typeof p.hostToken === "string") saveHostToken(roomId, p.hostToken);
    });
    socket.on("you_were_removed", () => {
      flashToast("You were removed from the room");
      setTimeout(onLeave, 800);
    });
    socket.on("chat_message", (m: ChatMessage) =>
      setMessages((prev) => [...prev, m])
    );
    socket.on("error_message", (e: any) => flashToast(`⚠️ ${e.message}`));

    return () => {
      socket.emit("leave_room", { roomId });
      socket.removeAllListeners();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, username]);

  // --- control emitters ---
  const play = (time: number) => socket.emit("play", { time });
  const pause = (time: number) => socket.emit("pause", { time });
  const seek = (time: number) => socket.emit("seek", { time });

  function changeVideo(e: React.FormEvent) {
    e.preventDefault();
    const id = parseVideoId(videoInput);
    if (!id) {
      setToast("⚠️ Invalid YouTube URL or ID");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    socket.emit("change_video", { videoId: id });
    setVideoInput("");
  }

  const assignRole = (userId: string, role: Role) => socket.emit("assign_role", { userId, role });
  const removeParticipant = (userId: string) => socket.emit("remove_participant", { userId });
  const transferHost = (userId: string) => socket.emit("transfer_host", { userId });
  const sendChat = (text: string) => socket.emit("chat_message", { text });

  const shareLink = `${window.location.origin}/?room=${roomId}`;

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <span className="room-title">🎬 Watch Party</span>
          <span className="room-code">Room {roomId}</span>
          <span className={`conn-dot ${connected ? "on" : "off"}`} title={connected ? "connected" : "disconnected"} />
        </div>
        <div className="room-header-actions">
          <button
            className="btn-small"
            onClick={() => {
              navigator.clipboard?.writeText(shareLink);
              setToast("Invite link copied!");
              setTimeout(() => setToast(""), 2000);
            }}
          >
            📋 Copy invite
          </button>
          <span className={`role-badge role-${myRole}`}>You: {myRole}</span>
          <button className="btn-small btn-danger" onClick={onLeave}>Leave</button>
        </div>
      </header>

      <div className="room-body">
        <main className="room-main">
          <VideoPlayer
            snapshot={snapshot}
            canControl={amController}
            onPlay={play}
            onPause={pause}
            onSeek={seek}
          />

          {amController ? (
            <form className="video-change" onSubmit={changeVideo}>
              <input
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                placeholder="Paste a YouTube URL or video ID to change video…"
              />
              <button type="submit" className="btn-secondary">Change video</button>
            </form>
          ) : (
            <div className="controls-locked">
              🔒 Playback is controlled by the host/moderators.
            </div>
          )}
        </main>

        <aside className="room-side">
          <ParticipantList
            participants={participants}
            meId={meId}
            amHost={amHost}
            onAssignRole={assignRole}
            onRemove={removeParticipant}
            onTransferHost={transferHost}
          />
          <Chat messages={messages} meId={meId} onSend={sendChat} />
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
