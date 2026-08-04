import { io, Socket } from "socket.io-client";

/**
 * Single shared Socket.IO connection.
 *
 * In dev, VITE_SERVER_URL is empty and Vite proxies /socket.io to :4001.
 * In prod, VITE_SERVER_URL points at the deployed backend origin.
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "";

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ["websocket"],
});

export const API_BASE = SERVER_URL;
