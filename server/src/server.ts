import http from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const isProduction = process.env.NODE_ENV === "production";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const clientDist = process.env.CLIENT_DIST ?? resolve(projectRoot, "client", "dist");

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
  if (isProduction) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              objectSrc: ["'none'"],
              scriptSrc: ["'self'", "https://www.youtube.com"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https:"],
              frameSrc: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
              connectSrc: ["'self'", "wss:"],
              frameAncestors: ["'none'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    next();
  });
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
  if (isProduction) {
    // Register the API first, then let the compiled SPA own browser routes.
    // This keeps deep links working without allowing missing API paths to
    // silently return HTML instead of a JSON 404 response.
    if (!existsSync(clientDist)) {
      throw new Error(`Client build not found at ${clientDist}. Run the client production build first.`);
    }
    app.use(express.static(clientDist));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.includes(".")) return next();
      res.sendFile(resolve(clientDist, "index.html"));
    });
  }
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
