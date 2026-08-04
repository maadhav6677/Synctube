import { useState } from "react";
import { API_BASE } from "../socket";

interface Props {
  initialRoomId?: string;
  onEnter: (roomId: string, username: string, hostToken?: string) => void;
}

/** Landing page: create a fresh room or join an existing one by code/link. */
export function HomeScreen({ initialRoomId, onEnter }: Props) {
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRoom() {
    if (!username.trim()) return setError("Enter a display name first.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || typeof data.roomId !== "string" || typeof data.hostToken !== "string") {
        setError(data.error ?? "Could not create a room.");
        return;
      }
      onEnter(data.roomId, username.trim(), data.hostToken);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!username.trim()) return setError("Enter a display name first.");
    const code = roomCode.trim().toUpperCase();
    if (!code) return setError("Enter a room code.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${code}`);
      if (!res.ok) {
        setError("Room not found.");
        return;
      }
      onEnter(code, username.trim());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <div className="home-card">
        <h1>🎬 Watch Party</h1>
        <p className="subtitle">Watch YouTube together, in perfect sync.</p>

        <label>
          Display name
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. Alice"
            maxLength={32}
          />
        </label>

        <div className="home-actions">
          <button className="btn-primary" onClick={createRoom} disabled={busy}>
            Create a room
          </button>
        </div>

        <div className="divider"><span>or join</span></div>

        <div className="join-row">
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
          />
          <button className="btn-secondary" onClick={joinRoom} disabled={busy}>
            Join
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>
    </div>
  );
}
