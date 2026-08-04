import { useState } from "react";
import { HomeScreen } from "./components/HomeScreen";
import { RoomScreen } from "./components/RoomScreen";
import { getHostToken, saveHostToken } from "./hostToken";

/**
 * Top-level router. Two screens: Home (create/join) and Room (live session).
 * A `?room=CODE` query param deep-links straight to the join form.
 */
export function App() {
  const params = new URLSearchParams(window.location.search);
  const deepLinkRoom = params.get("room") ?? undefined;

  const [session, setSession] = useState<{ roomId: string; username: string; hostToken?: string } | null>(null);

  if (session) {
    return (
      <RoomScreen
        roomId={session.roomId}
        username={session.username}
        hostToken={session.hostToken}
        onLeave={() => {
          setSession(null);
          // Clean the URL so a refresh returns to Home.
          window.history.replaceState({}, "", window.location.pathname);
        }}
      />
    );
  }

  return (
    <HomeScreen
      initialRoomId={deepLinkRoom}
      onEnter={(roomId, username, hostToken) => {
        if (hostToken) saveHostToken(roomId, hostToken);
        window.history.replaceState({}, "", `/?room=${roomId}`);
        setSession({ roomId, username, hostToken: hostToken ?? getHostToken(roomId) });
      }}
    />
  );
}
