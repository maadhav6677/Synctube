import { describe, it, expect } from "vitest";
import { can, isAssignableRole, isValidRole } from "../src/domain/roles.js";

describe("RBAC permission matrix", () => {
  it("host has full control", () => {
    for (const p of [
      "playback",
      "change_video",
      "assign_role",
      "remove_participant",
      "transfer_host",
    ] as const) {
      expect(can("host", p)).toBe(true);
    }
  });

  it("moderator can control playback and change video but not manage users", () => {
    expect(can("moderator", "playback")).toBe(true);
    expect(can("moderator", "change_video")).toBe(true);
    expect(can("moderator", "assign_role")).toBe(false);
    expect(can("moderator", "remove_participant")).toBe(false);
    expect(can("moderator", "transfer_host")).toBe(false);
  });

  it("participant and viewer are watch-only", () => {
    for (const role of ["participant", "viewer"] as const) {
      expect(can(role, "playback")).toBe(false);
      expect(can(role, "change_video")).toBe(false);
      expect(can(role, "assign_role")).toBe(false);
    }
  });

  it("host is not directly assignable; moderator/participant/viewer are", () => {
    expect(isAssignableRole("host")).toBe(false);
    expect(isAssignableRole("moderator")).toBe(true);
    expect(isAssignableRole("participant")).toBe(true);
    expect(isAssignableRole("viewer")).toBe(true);
    expect(isAssignableRole("emperor")).toBe(false);
  });

  it("validates role names", () => {
    expect(isValidRole("host")).toBe(true);
    expect(isValidRole("nope")).toBe(false);
  });
});
