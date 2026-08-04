import { Router } from "express";
import { RoomManager } from "../domain/RoomManager.js";
import { createHostToken, hashHostToken } from "../security/hostToken.js";

const ROOM_ID = /^[A-HJ-NP-Z2-9]{6}$/;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/**
 * REST surface. WebSockets carry all realtime traffic; HTTP is only used for
 * lifecycle actions that happen before a socket exists (create/lookup room)
 * plus a health check for the deployment platform.
 */
export function createRouter(rooms: RoomManager): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Health check (used by Render/Railway readiness probes).
  router.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      liveRooms: rooms.liveRoomCount(),
      participants: rooms.totalParticipants(),
    });
  });

  // Create a new room. Creator becomes Host when they join over the socket.
  router.post("/api/rooms", (req, res) => {
    const candidate = req.body?.videoId;
    const videoId = candidate === undefined || candidate === "" ? null : typeof candidate === "string" ? candidate.trim() : null;
    if (candidate !== undefined && candidate !== "" && (!videoId || !VIDEO_ID.test(videoId))) {
      res.status(400).json({ error: "videoId must be a valid YouTube video ID" });
      return;
    }

    rooms.pruneExpired(Date.now());
    const hostToken = createHostToken();
    const room = rooms.createRoom(videoId, hashHostToken(hostToken));
    // The token is returned exactly once and is never embedded in an invite URL.
    res.status(201).json({ roomId: room.id, videoId: room.video.videoId, hostToken });
  });

  // Look up whether a room exists (used by the join screen before connecting).
  router.get("/api/rooms/:id", (req, res) => {
    rooms.pruneExpired(Date.now());
    const roomId = req.params.id.toUpperCase();
    if (!ROOM_ID.test(roomId)) {
      res.status(400).json({ error: "Invalid room code" });
      return;
    }
    const room = rooms.getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json({
      roomId: room.id,
      videoId: room.video.videoId,
    });
  });

  return router;
}
