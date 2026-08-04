import { createApp } from "./server.js";
import { config } from "./config.js";

/** Production entrypoint: build the app around the persistent DB and listen. */
const app = createApp(config.dbFile);

app.httpServer.listen(config.port, () => {
  console.log(`[watch-party] listening on port ${config.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`\n[watch-party] ${sig} received, shutting down...`);
    await app.close();
    process.exit(0);
  });
}
