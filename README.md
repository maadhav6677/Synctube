# 🎬 YouTube Watch Party

Watch YouTube videos together in perfect sync. Create a room, share the code,
and everyone's player mirrors the host's play / pause / seek / video changes in
real time — with **role-based access control** enforced on the server.

> Built for the Full-Stack assignment. Runs fully locally; deployment-ready for
> Render/Railway (see [Deployment](#deployment)).

**Live URL:** [synctube-watch-party.onrender.com](https://synctube-watch-party.onrender.com/)

---

## Screenshots

| Home screen | Host view — video ready |
|---|---|
| ![Synctube home screen](./docs/screenshots/01-home.png) | ![host with a video ready](./docs/screenshots/06-host-video-ready.png) |

| Host view — playback | Host managing participants and roles |
|---|---|
| ![host playing a video](./docs/screenshots/07-host-video-playing.png) | ![host managing participants and roles](./docs/screenshots/08-host-no-video.png) |

## Features

- ✅ **Real-time sync** — play / pause / seek / change-video propagate to all participants
- ✅ **Rooms** — create or join via a 6-character code / shareable link
- ✅ **WebSockets** — Socket.IO bidirectional channel; server is the source of truth
- ✅ **YouTube IFrame API** — embedded, controllable, feedback-loop-guarded player
- ✅ **Role-Based Access Control** — Host / Moderator / Participant / Viewer, **enforced on the backend**
- ✅ **Host capabilities** — assign roles, remove participants, **transfer host**
- ✅ **Host capability** — only the creator (or an explicitly transferred host) can hold host authority
- ✅ **Persistence** — room/video state persists when deployed with durable storage
- ✅ **Text chat** (bonus)
- ✅ **OOP server** (bonus) — `Room`, `Participant`, `RoomManager`, `MessageHandler` classes
- ✅ **35 automated tests** (unit + live-socket integration)

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express |
| Realtime | Socket.IO |
| Database | SQLite (`better-sqlite3`) |
| Video | YouTube IFrame Player API |

## Architecture

Clients are dumb renderers; the server holds each room's authoritative video
state and broadcasts it. RBAC is checked in the `MessageHandler` **before** any
mutation or broadcast, so a hacked client cannot control a room it lacks
permission for.

Full write-ups: **[docs/HLD.md](./docs/HLD.md)** · **[docs/LLD.md](./docs/LLD.md)**

```
Browser (React + YT IFrame) ⇄ Socket.IO ⇄ Node server
                                              │ MessageHandler (RBAC gate)
                                              │ RoomManager → Room → Participant
                                              └ SQLite (rooms + video state)
```

---

## Getting Started (local)

**Prerequisites:** Node.js ≥ 20.

### 1. Backend

```bash
cd server
npm ci
npm run dev            # http://localhost:4001  (or: npm run build && npm start)
```

### 2. Frontend

```bash
cd client
npm ci
npm run dev            # http://localhost:5173
```

Open **http://localhost:5173**, enter a name, click **Create a room**, then open
the copied invite link in a second browser window to see live sync. The Vite dev
server proxies `/api` and the WebSocket to the backend on `:4001`.

### 3. Try it

1. Window A: create a room, paste a YouTube URL, press play/seek.
2. Window B: open the invite link → the video mirrors A in real time.
3. Window B is a **Participant** — its controls are locked.
4. In Window A's participant list, promote B to **Moderator** → B can now control playback.
5. Try **remove** or **transfer host** from A's roster.

## Testing

```bash
cd server
npm test               # 35 tests: unit + live-socket integration
```

The integration suite boots a real Socket.IO server and drives it with real
client connections — proving sync and RBAC over the wire.

### Live end-to-end demo

With the backend running (`npm run dev` in `server/`):

```bash
cd server
node scripts/demo.mjs http://localhost:4001
```

Prints an annotated walkthrough: room creation, join/roles, play/seek/
change-video sync, **RBAC rejection**, promote-to-moderator, chat, transfer-host,
and removal. See
[docs/RESULTS.md](./docs/RESULTS.md) for captured output.

## Configuration

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4001` | backend port |
| `CORS_ORIGIN` | `http://localhost:5173` in development | exact allowed frontend origin(s), comma-separated; **required in production** |
| `DB_FILE` | `./data/watchparty.db` | SQLite file (`:memory:` = ephemeral) |
| `VITE_SERVER_URL` | `""` (dev proxy) | client → backend origin in prod builds |

When a room is created, the server returns a random host capability. The browser
stores it in `sessionStorage`; it is never put in the invite URL. Do not clear
browser session data if you need to retain host access. Host transfer rotates
the capability and gives it only to the new host.

## Deployment

This implementation is intentionally a **single backend instance**. It uses an
in-memory room registry and SQLite, so do not enable horizontal scaling. For
multi-instance deployment, migrate room data to a managed database and add a
Socket.IO adapter such as Redis.

For the free Render deployment, rooms are temporary: its filesystem is reset
when the service sleeps, restarts, or redeploys. The assignment's realtime
features work while the service is running; durable SQLite storage requires a
paid persistent disk or a database migration.

1. Create one **Web Service** from the repository root with build command
   `cd server && npm ci && npm run build && cd ../client && npm ci && npm run build`
   and start command `node server/dist/index.js`.
2. Set `NODE_ENV=production` and
   `CORS_ORIGIN=https://synctube-watch-party.onrender.com`. Never use `*` for
   `CORS_ORIGIN`. Leave `VITE_SERVER_URL` unset so the frontend, API, and
   WebSocket connection use the same HTTPS origin.
3. Confirm HTTPS, WebSocket connectivity, `/api/health`, and room sync in two
   browser sessions before publishing the public URL.

## What I'd explain in a walkthrough

- **Socket.IO** provides rooms, acks, reconnection, and a clear future adapter path for scale.
- **WebSockets** give a persistent duplex channel so state changes push instantly instead of polling.
- **RBAC** is one permission matrix consulted in the per-socket `MessageHandler` before every mutation.
- **YouTube IFrame** sync avoids feedback loops via a suppression guard and a drift threshold.
- **Security**: host authority is a server-issued capability; inputs, HTTP requests, and socket actions are bounded and rate-limited. In production, Helmet sends CSP, anti-clickjacking, referrer, and permissions headers.
