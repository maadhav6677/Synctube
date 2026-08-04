# Low-Level Design — YouTube Watch Party

Detailed module, class, and event-level design. Pairs with [HLD.md](./HLD.md).

## 1. Repository layout

```
server/
  src/
    config.ts               env-driven config (port, CORS, db file)
    index.ts                production entrypoint (listen + signals)
    server.ts               createApp() — wires Express + Socket.IO + domain
    db/database.ts          RoomStore — SQLite persistence (better-sqlite3)
    domain/
      roles.ts              Role/Permission types + permission matrix + can()
      Participant.ts        Participant class
      Room.ts               Room class (participants + authoritative video state)
      RoomManager.ts        RoomManager class (owns rooms, mediates persistence)
    realtime/
      events.ts             typed client<->server event contracts
      MessageHandler.ts     per-socket event handling + RBAC enforcement
    http/routes.ts          REST router (health, create room, lookup room)
  tests/                    vitest unit + live-socket integration tests
  scripts/demo.mjs          annotated end-to-end demo driver
client/
  src/
    socket.ts               shared Socket.IO client
    youtube.ts              URL→videoId parsing + IFrame API loader
    types.ts                shared types + client-side permission mirror
    App.tsx                 Home/Room router
    components/
      HomeScreen.tsx        create/join
      RoomScreen.tsx        live session: socket wiring + state mapping
      VideoPlayer.tsx       YouTube IFrame sync (feedback-loop guarded)
      ParticipantList.tsx   roster + host management controls
      Chat.tsx              text chat (bonus)
```

## 2. Domain classes (OOP)

### `Participant`
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable per-session id (not the socket id) |
| `username` | string | display name |
| `socketId` | string | current live socket, for targeted emits |
| `role` | Role | `host \| moderator \| participant \| viewer` |
| `joinedAt` | number | connection ordering for display |

- `can(permission)` → delegates to the matrix.
- `toJSON()` → wire view **without** `socketId` (never leak transport ids).

### `Room`
Owns `Map<participantId, Participant>` and `VideoState`.

- `add()` — accepts a role selected by the server's host-capability check.
- A disconnected host is not auto-promoted; the original host capability can
  reconnect, or the active host can explicitly transfer it.
- `assignRole()`, `transferHost()` — role mutations (transfer demotes old host
  to moderator).
- Playback: `play/pause/seek/changeVideo(atTime, now)` update `VideoState`.
- `effectiveTime(now)` — playhead advanced by elapsed wall-clock if playing.
- `snapshot(now)` — `{ videoId, playState, currentTime }` for `sync_state`.

`VideoState = { videoId, playState, currentTime, lastUpdatedAt }`. Storing
`currentTime` + `lastUpdatedAt` (rather than a live-ticking value) makes the
playhead computable at any moment and trivially persistable.

### `RoomManager`
- `createRoom()` — generates a unique 6-char code (unambiguous alphabet),
  inserts into the store.
- `getRoom(id)` — case-insensitive; rehydrates from SQLite on a memory miss.
- `persistVideoState(room)` — called after every playback mutation.
- `disposeIfEmpty(room)` — evicts empty rooms from memory; `pruneExpired()`
  removes rooms after their 24-hour lifetime.

### `RoomStore` (SQLite)
Thin, synchronous wrapper (`better-sqlite3`). `WAL` journal mode. `:memory:`
gives isolated DBs for tests. Methods: `insertRoom`, `getRoom`,
`updateVideoState`, `deleteRoom`, `countRooms`.

## 3. `MessageHandler` — the RBAC choke point

One instance per socket (`new MessageHandler(io, socket, rooms).register()`).
It holds the socket's `roomId` + `userId` and maps events to the domain.

Every state-changing handler follows the same shape:

```
const ctx = this.context();            // resolve room + sender participant
if (!ctx) return fail("NOT_IN_ROOM");
if (!ctx.me.can(<permission>))         // RBAC gate — before any mutation
    return fail("FORBIDDEN", …);
<mutate room>; persist; broadcast;     // only reached when authorized
```

This guarantees the "backend must validate permissions before processing
events" requirement — an unauthorized event produces an `error_message` to the
sender and nothing else.

## 4. WebSocket event contract

### Client → Server
| Event | Payload | Permission | Effect |
|-------|---------|-----------|--------|
| `join_room` | `{ roomId, username }` (ack) | — | join; assign role; ack snapshot |
| `leave_room` / disconnect | `{ roomId }` | — | leave; maybe promote new host |
| `play` / `pause` / `seek` | `{ time }` | `playback` | update state + broadcast |
| `change_video` | `{ videoId }` | `change_video` | swap video + broadcast |
| `assign_role` | `{ userId, role }` | `assign_role` (host) | change a role |
| `remove_participant` | `{ userId }` | `remove_participant` (host) | kick user |
| `transfer_host` | `{ userId }` | `transfer_host` (host) | hand over host |
| `chat_message` | `{ text }` | — | broadcast chat |

### Server → Client
| Event | Payload |
|-------|---------|
| `sync_state` | `{ playState, currentTime, videoId, origin }` |
| `user_joined` / `user_left` | `{ userId, username, participants }` |
| `role_assigned` | `{ userId, username, role, participants }` |
| `participant_removed` | `{ userId, participants }` |
| `host_transferred` | `{ oldHostId, newHostId, participants }` |
| `you_were_removed` | `{ roomId }` (to the kicked user only) |
| `chat_message` | `{ userId, username, text, at }` |
| `error_message` | `{ code, message }` (RBAC/validation failures) |

`sync_state.origin` (`play\|pause\|seek\|change_video\|snapshot`) lets clients
and tests distinguish the cause of a state update.

## 5. Frontend sync logic (`VideoPlayer.tsx`)

The hard part is avoiding a feedback loop: applying a remote state fires the
same YouTube `onStateChange` events a human would.

- A `suppress` ref is raised while applying a server snapshot and lowered after
  the YT events settle (400–800 ms), so programmatic changes don't echo back.
- Remote seeks only re-`seekTo` when local drift > ~1s, to avoid fighting
  YouTube's buffering.
- `onStateChange` distinguishes a genuine play from a seek-while-playing by
  comparing against the last known `playState`.
- Controllers (host/moderator) emit `play/pause/seek`; non-controllers render
  only and never emit.

## 6. Presence & host authority

On `disconnect`, `MessageHandler.onLeave()` removes the participant and
broadcasts `user_left`. Host access is granted only when the caller presents
the server-issued, hashed host capability. Transfer rotates that capability and
sends it privately to the new host. Empty rooms are disposed from memory.

## 7. Testing strategy

- **Unit** (`roles`, `room`, `roommanager`): permission matrix, duplicate-ID
  protection, host transfer, playhead math, persistence/rehydration.
- **Integration** (`integration.test.ts`): boots a real HTTP+Socket.IO server on
  an ephemeral port and drives it with real `socket.io-client` connections —
  join/roles, play/pause/seek/change-video sync across two clients, RBAC
  rejection (participant play is blocked **and not broadcast**), host
  assign/remove/transfer, host-capability enforcement, and chat.
- **Live demo** (`scripts/demo.mjs`): a 12-step annotated narrative against a
  running server, used for manual/visual verification.

Total: **33 automated tests**, all passing.

## 8. Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4001` | server port |
| `CORS_ORIGIN` | `http://localhost:5173` in development | exact allowlist; required in production |
| `DB_FILE` | `./data/watchparty.db` | SQLite path (`:memory:` for ephemeral) |
| `VITE_SERVER_URL` | `""` (proxy) | client build-time backend origin |
