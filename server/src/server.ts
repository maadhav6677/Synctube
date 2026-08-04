import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { RoomStore } from "./db/database.js";
import { RoomManager } from "./domain/RoomManager.js";
import { MessageHandler } from "./realtime/MessageHandler.js";
import { createRouter } from "./http/routes.js";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./realtime/events.js";
import { config, isAllowedOrigin } from "./config.js";

export interface AppHandle {
  httpServer: http.Server;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  store: RoomStore;
  close: () => Promise<void>;
}

/**
 * Builds the full app (Express + Socket.IO) around a given DB file without
 * binding a port. Tests call this with ":memory:" and an ephemeral port; the
 * production entrypoint calls it with the configured DB file.
 */
export function createApp(dbFile: string): AppHandle {
  const store = new RoomStore(dbFile);
  const rooms = new RoomManager(store);

  const app = express();
  app.disable("x-powered-by");
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.corsOrigins, methods: ["GET", "POST"] }));
  app.use(express.json({ limit: "10kb" }));
  app.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    })
  );
  app.use(
    "/api/rooms",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    })
  );
  app.use(createRouter(rooms));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Malformed JSON request body" });
      return;
    }
    console.error("Unhandled request error", error);
    res.status(500).json({ error: "Internal server error" });
  });

  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.corsOrigins, methods: ["GET", "POST"] },
    maxHttpBufferSize: 10_000,
    allowRequest: (request, callback) => callback(null, isAllowedOrigin(request.headers.origin)),
  });

  // One MessageHandler per connection — encapsulates that socket's session.
  io.on("connection", (socket) => {
    new MessageHandler(io, socket, rooms).register();
  });

  const expiryTimer = setInterval(() => rooms.pruneExpired(Date.now()), 60 * 60_000);
  expiryTimer.unref();

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(expiryTimer);
      io.close(() => {
        httpServer.close(() => {
          store.close();
          resolve();
        });
      });
    });

  return { httpServer, io, rooms, store, close };
}
