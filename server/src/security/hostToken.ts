import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A bearer capability for the host role. Never put this value in a URL. */
export function createHostToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHostToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hasHostAccess(token: unknown, expectedHash: string): boolean {
  if (typeof token !== "string" || !expectedHash) return false;
  const actual = Buffer.from(hashHostToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
