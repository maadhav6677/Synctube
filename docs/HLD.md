# High-Level Design — YouTube Watch Party

## 1. Problem & Goals

Build a system where multiple users watch a YouTube video **in sync**: when one
authorized user plays, pauses, seeks, or changes the video, everyone in the
room sees the same thing within a fraction of a second. Rooms have **roles**
(Host / Moderator / Participant / Viewer) and the backend **enforces** who may
control playback or manage the room.

Non-functional goals: low-latency realtime updates, a single authoritative
source of truth for playback, bounded public-facing inputs, and durable rooms
when deployed with persistent storage.

## 2. Architecture Overview

```
        ┌──────────────┐         ┌──────────────┐
        │  Browser A   │         │  Browser B   │
        │ React + YT   │         │ React + YT   │
        │ IFrame API   │         │ IFrame API   │
        └──────┬───────┘         └──────┬───────┘
               │  WebSocket (Socket.IO)  │
               │  + REST (create/lookup) │
        ┌──────▼─────────────────────────▼───────┐
        │            Node.js Server               │
        │  Express (REST)   Socket.IO (realtime)  │
        │  ┌───────────────────────────────────┐  │
        │  │ MessageHandler (per socket)       │  │  ← RBAC enforced here
        │  │   ↓ calls domain                  │  │
        │  │ RoomManager → Room → Participant  │  │  ← OOP domain model
        │  └───────────────────────────────────┘  │
        │              │ persist                    │
        │        ┌─────▼──────┐                     │
        │        │  SQLite    │  rooms + video state│
        │        └────────────┘                     │
        └─────────────────────────────────────────┘
```

- **Frontend (React + TS + Vite):** renders the UI, embeds the YouTube IFrame
  player, and translates user actions into WebSocket events. It never trusts
  itself for authority — it renders whatever `sync_state` the server sends.
- **REST (Express):** only the pre-socket lifecycle — create a room, check a
  room exists, health check. Everything realtime goes over WebSockets.
- **WebSocket (Socket.IO):** bidirectional channel carrying playback events,
  role/participant events, and chat.
- **Domain layer (OOP):** `RoomManager` owns `Room`s; each `Room` owns
  `Participant`s and the authoritative `VideoState`. Pure, transport-agnostic,
  unit-testable.
- **Persistence (SQLite):** room metadata, expiry, hashed host capability, and
  last-known video state. Presence (who's connected) is ephemeral.

## 3. Why the server is the source of truth

Each room has one authoritative `VideoState { videoId, playState, currentTime,
lastUpdatedAt }`. Clients are dumb renderers. This avoids the classic
distributed-consensus problem: there is no "which client is right" — the server
decides, broadcasts, and every client converges. A late joiner is handed a
snapshot with the playhead advanced by elapsed wall-clock (`effectiveTime`), so
they start already in sync.

## 4. Realtime flow (play example)

1. Host clicks play → browser emits `play { time }`.
2. Server's `MessageHandler` checks `participant.can("playback")`. If denied →
   `error_message` back to sender only; **no broadcast, no mutation**.
3. If allowed → mutate `Room.video`, persist to SQLite, then
   `io.to(roomId).emit("sync_state", …)` to the whole room.
4. Every client (including sender) applies the authoritative state to its
   YouTube player.

Because the mutation and broadcast happen only after the permission check, a
hacked client that emits raw events still cannot affect anyone else.

## 5. Role-Based Access Control

A single permission matrix (`roles.ts`) maps each role to a set of permissions
(`playback`, `change_video`, `assign_role`, `remove_participant`,
`transfer_host`). The `MessageHandler` consults it before every state-changing
event. The frontend uses a mirror of this matrix to pre-disable controls, but
the backend check is the real gate.

Host is a server-issued capability, not "the first person to join." Its random
token is returned once at room creation, stored by the browser only in session
storage, and stored by the server only as a hash. Transfer rotates the token.

| Role | play/pause/seek | change video | manage roles/users |
|------|:---:|:---:|:---:|
| Host | ✅ | ✅ | ✅ |
| Moderator | ✅ | ✅ | ❌ |
| Participant / Viewer | ❌ | ❌ | ❌ |

## 6. Persistence model

- `rooms` table: `id`, `created_at`, `expires_at`, `host_token_hash`,
  `video_id`, `play_state`, `position_seconds`, `last_updated_at`.
- Written on room create and after every playback mutation.
- On lookup, if a room isn't in memory it is rehydrated from SQLite.
- Rooms expire after 24 hours, bounding database growth. Empty rooms are
  dropped from memory before expiry.

## 7. Scalability path (design-ready)

The current build runs as a single process and requires a persistent volume for
SQLite. Do not horizontally scale this implementation.
To reach the bonus target (1,000+ users / 100+ rooms):

- Run N stateless Node instances behind a load balancer with sticky sessions.
- Add the **Socket.IO Redis adapter** so `io.to(room).emit(...)` fans out across
  instances via **Redis Pub/Sub**.
- Move authoritative room/video state to Redis (or keep SQLite→Postgres for
  durable metadata) so any instance can serve any room.
- The domain model is already transport-agnostic, so only the broadcast + state
  store are swapped — no domain rewrite.

## 8. Key trade-offs

- **Socket.IO over raw `ws`:** gives rooms, acks, auto-reconnect, and a
  ready-made Redis adapter — worth the small overhead for this feature set.
- **SQLite over Postgres:** zero-ops for local + single-instance deploy; the
  store is a thin interface so swapping to Postgres is mechanical.
- **Client as dumb renderer:** simpler correctness, at the cost of a ~1s drift
  correction threshold in the player to avoid fighting YouTube's buffering.
- **Time sync:** we advance the playhead by server wall-clock, not per-client
  clock offset (NTP-style) — accurate enough for casual co-watching.
