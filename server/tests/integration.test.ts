import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as Client, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createApp, type AppHandle } from "../src/server.js";

/**
 * End-to-end realtime tests. A real HTTP+Socket.IO server is booted on an
 * ephemeral port and real socket.io-client connections drive it — the same
 * path the browser takes. These prove: room join/role assignment, playback
 * sync across clients, and server-side RBAC rejection.
 */

let app: AppHandle;
let url: string;

beforeAll(async () => {
  app = createApp(":memory:");
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  const port = (app.httpServer.address() as AddressInfo).port;
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  await app?.close();
});

function connect(): Socket {
  return Client(url, { transports: ["websocket"], forceNew: true });
}

/**
 * Wait for the next event matching `predicate`, with a timeout. Uses a
 * persistent listener so already-buffered/irrelevant events (e.g. the initial
 * `snapshot` sync a client receives on join) are skipped rather than
 * mistakenly consumed — making these tests deterministic under any broadcast
 * timing.
 */
function once<T = any>(
  sock: Socket,
  event: string,
  predicate: (p: T) => boolean = () => true,
  timeout = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeout);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      sock.off(event, handler);
      resolve(payload);
    };
    sock.on(event, handler);
  });
}

/** Wait for a sync_state produced by a specific action (ignores join snapshot). */
function onSync(sock: Socket, origin: string, timeout = 3000) {
  return once<any>(sock, "sync_state", (p) => p.origin === origin, timeout);
}

const hostTokens = new Map<string, string>();

function join(sock: Socket, roomId: string, username: string, hostToken?: string): Promise<any> {
  return new Promise((resolve) => {
    sock.emit("join_room", { roomId, username, hostToken }, (res: any) => resolve(res));
  });
}

function joinHost(sock: Socket, roomId: string, username: string): Promise<any> {
  return join(sock, roomId, username, hostTokens.get(roomId));
}

async function createRoom(videoId?: string): Promise<string> {
  const res = await fetch(`${url}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId }),
  });
  const body = await res.json();
  hostTokens.set(body.roomId, body.hostToken);
  return body.roomId;
}

describe("REST", () => {
  it("health check reports ok", async () => {
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("creates and looks up a room", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const res = await fetch(`${url}/api/rooms/${roomId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).videoId).toBe("dQw4w9WgXcQ");
  });

  it("returns the host capability only when creating a room", async () => {
    const roomId = await createRoom();
    const lookup = await fetch(`${url}/api/rooms/${roomId}`);
    expect(await lookup.json()).not.toHaveProperty("hostToken");
  });

  it("404s on unknown room", async () => {
    const res = await fetch(`${url}/api/rooms/ZZZZZZ`);
    expect(res.status).toBe(404);
  });
});

describe("join + roles", () => {
  it("creator becomes host, second joiner becomes participant", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      const hostAck = await joinHost(host, roomId, "Alice");
      expect(hostAck.ok).toBe(true);
      expect(hostAck.you.role).toBe("host");

      const guestAck = await join(guest, roomId, "Bob");
      expect(guestAck.you.role).toBe("participant");
      expect(guestAck.participants).toHaveLength(2);
    } finally {
      host.close();
      guest.close();
    }
  });

  it("rejects joining a non-existent room", async () => {
    const sock = connect();
    try {
      const ack = await join(sock, "NOPE00", "Ghost");
      expect(ack.ok).toBe(false);
    } finally {
      sock.close();
    }
  });

  it("does not allow a client-supplied user id to become host", async () => {
    const roomId = await createRoom();
    const guest = connect();
    try {
      const ack = await new Promise<any>((resolve) => {
        guest.emit("join_room", { roomId, username: "Mallory", userId: "host-id" }, resolve);
      });
      expect(ack.you.role).toBe("participant");
    } finally {
      guest.close();
    }
  });
});

describe("playback synchronization", () => {
  it("host play/pause/seek broadcasts to all participants", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");

      // guest should receive host's play as a sync_state
      const playP = onSync(guest, "play");
      host.emit("play", { time: 5 });
      const play = await playP;
      expect(play.playState).toBe("playing");
      expect(play.currentTime).toBeCloseTo(5, 1);
      expect(play.origin).toBe("play");

      const seekP = onSync(guest, "seek");
      host.emit("seek", { time: 120 });
      const seek = await seekP;
      expect(seek.currentTime).toBeCloseTo(120, 1);
      expect(seek.origin).toBe("seek");

      const pauseP = onSync(guest, "pause");
      host.emit("pause", { time: 121 });
      const pause = await pauseP;
      expect(pause.playState).toBe("paused");
    } finally {
      host.close();
      guest.close();
    }
  });

  it("change_video by host syncs new videoId to room", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");
      const p = onSync(guest, "change_video");
      host.emit("change_video", { videoId: "9bZkp7q19f0" });
      const s = await p;
      expect(s.videoId).toBe("9bZkp7q19f0");
      expect(s.origin).toBe("change_video");
    } finally {
      host.close();
      guest.close();
    }
  });
});

describe("RBAC enforcement over the wire", () => {
  it("participant play is rejected and NOT broadcast", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");

      // The participant tries to play — expect an error back to them...
      const errP = once(guest, "error_message");
      // ...and the host must NOT receive any sync_state from it.
      let hostGotSync = false;
      host.on("sync_state", () => (hostGotSync = true));

      guest.emit("play", { time: 3 });
      const err = await errP;
      expect(err.code).toBe("FORBIDDEN");

      await new Promise((r) => setTimeout(r, 150));
      expect(hostGotSync).toBe(false);
    } finally {
      host.close();
      guest.close();
    }
  });

  it("participant cannot change_video", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");
      const errP = once(guest, "error_message");
      guest.emit("change_video", { videoId: "9bZkp7q19f0" });
      expect((await errP).code).toBe("FORBIDDEN");
    } finally {
      host.close();
      guest.close();
    }
  });

  it("participant cannot assign roles", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      const hostAck = await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");
      const errP = once(guest, "error_message");
      guest.emit("assign_role", { userId: hostAck.you.id, role: "participant" });
      expect((await errP).code).toBe("FORBIDDEN");
    } finally {
      host.close();
      guest.close();
    }
  });
});

describe("host capabilities", () => {
  it("host promotes participant to moderator; moderator can then control playback", async () => {
    const roomId = await createRoom("dQw4w9WgXcQ");
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      const guestAck = await join(guest, roomId, "Bob");

      const roleP = once(guest, "role_assigned");
      host.emit("assign_role", { userId: guestAck.you.id, role: "moderator" });
      const role = await roleP;
      expect(role.role).toBe("moderator");

      // Now the (moderator) guest can drive playback — host should receive it.
      const syncP = onSync(host, "play");
      guest.emit("play", { time: 7 });
      const sync = await syncP;
      expect(sync.currentTime).toBeCloseTo(7, 1);
    } finally {
      host.close();
      guest.close();
    }
  });

  it("host removes a participant; they are kicked from the room", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      const guestAck = await join(guest, roomId, "Bob");

      const kickedP = once(guest, "you_were_removed");
      const removedP = once(host, "participant_removed");
      host.emit("remove_participant", { userId: guestAck.you.id });

      await kickedP;
      const removed = await removedP;
      expect(removed.participants).toHaveLength(1);
    } finally {
      host.close();
      guest.close();
    }
  });

  it("transfer host swaps roles between the two", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      const hostAck = await joinHost(host, roomId, "Alice");
      const guestAck = await join(guest, roomId, "Bob");

      const tP = once(guest, "host_transferred");
      host.emit("transfer_host", { userId: guestAck.you.id });
      const t = await tP;
      expect(t.newHostId).toBe(guestAck.you.id);
      expect(t.oldHostId).toBe(hostAck.you.id);

      const roster = t.participants;
      expect(roster.find((p: any) => p.id === guestAck.you.id).role).toBe("host");
      expect(roster.find((p: any) => p.id === hostAck.you.id).role).toBe("moderator");
    } finally {
      host.close();
      guest.close();
    }
  });
});

describe("presence + chat", () => {
  it("does not promote a participant when the host disconnects", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      const guestAck = await join(guest, roomId, "Bob");

      const leftP = once(guest, "user_left");
      host.close(); // host disconnects

      await leftP;
      const denied = once(guest, "error_message");
      guest.emit("play", { time: 1 });
      expect((await denied).code).toBe("FORBIDDEN");
      expect(guestAck.you.role).toBe("participant");
    } finally {
      host.close();
      guest.close();
    }
  });

  it("broadcasts chat messages to the room", async () => {
    const roomId = await createRoom();
    const host = connect();
    const guest = connect();
    try {
      await joinHost(host, roomId, "Alice");
      await join(guest, roomId, "Bob");
      const p = once(guest, "chat_message");
      host.emit("chat_message", { text: "hello room" });
      const msg = await p;
      expect(msg.text).toBe("hello room");
      expect(msg.username).toBe("Alice");
    } finally {
      host.close();
      guest.close();
    }
  });
});
