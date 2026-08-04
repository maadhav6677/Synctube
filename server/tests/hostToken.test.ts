import { describe, expect, it } from "vitest";
import { createHostToken, hasHostAccess, hashHostToken } from "../src/security/hostToken.js";

describe("host capabilities", () => {
  it("is random, hash-only server state, and rejects incorrect tokens", () => {
    const token = createHostToken();
    const hash = hashHostToken(token);

    expect(token).not.toBe(createHostToken());
    expect(hash).not.toContain(token);
    expect(hasHostAccess(token, hash)).toBe(true);
    expect(hasHostAccess("not-the-token", hash)).toBe(false);
    expect(hasHostAccess(undefined, hash)).toBe(false);
  });
});
