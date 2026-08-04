import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend URL is injected at build time via VITE_SERVER_URL.
// In dev we proxy /api and the socket to the backend on :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
});
