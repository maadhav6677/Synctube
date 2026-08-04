const isProduction = process.env.NODE_ENV === "production";

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    if (isProduction) throw new Error("CORS_ORIGIN must be set in production");
    return ["http://localhost:5173"];
  }

  return value.split(",").map((origin) => {
    const normalized = new URL(origin.trim()).origin;
    if (normalized === "null") throw new Error("CORS_ORIGIN must contain valid http(s) origins");
    return normalized;
  });
}

/** Centralized runtime configuration, validated at startup. */
export const config = {
  port: parsePort(process.env.PORT),
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN),
  dbFile: process.env.DB_FILE ?? "./data/watchparty.db",
  maxParticipantsPerRoom: 50,
};

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients such as server health checks and integration tests do
  // not send Origin. Browser connections must match the explicit allowlist.
  return !origin || config.corsOrigins.includes(origin);
}
