import { describe, it, expect } from "vitest";
import { Room } from "../src/domain/Room.js";

function mkRoom() {
  return new Room("ABC123", 1000);
}

describe("Room participant management", () => {
  it("uses the role selected by the server boundary", () => {
    const room = mkRoom();
    const host = room.add({ id: "u1", username: "Alice", socketId: "s1", joinedAt: 1, role: "host" });
    const p2 = room.add({ id: "u2", username: "Bob", socketId: "s2", joinedAt: 2 });
    expect(host.role).toBe("host");
    expect(p2.role).toBe("participant");
    expect(room.size).toBe(2);
  });

  it("rejects duplicate participant ids", () => {
    const room = mkRoom();
    room.add({ id: "u1", username: "Alice", socketId: "s1", joinedAt: 1, role: "host" });
    expect(() => room.add({ id: "u1", username: "Imposter", socketId: "s2", joinedAt: 2 })).toThrow(
      "Duplicate participant id"
    );
  });

  it("transfers host and demotes old host to moderator", () => {
    const room = mkRoom();
    room.add({ id: "u1", username: "Alice", socketId: "s1", joinedAt: 1, role: "host" });
    room.add({ id: "u2", username: "Bob", socketId: "s2", joinedAt: 2 });
    const res = room.transferHost("u1", "u2");
    expect(res?.newHost.role).toBe("host");
    expect(res?.oldHost.role).toBe("moderator");
  });

  it("rejects invalid host transfer (non-host initiator)", () => {
    const room = mkRoom();
    room.add({ id: "u1", username: "Alice", socketId: "s1", joinedAt: 1, role: "host" });
    room.add({ id: "u2", username: "Bob", socketId: "s2", joinedAt: 2 });
    expect(room.transferHost("u2", "u1")).toBeUndefined(); // u2 isn't host
  });
});

describe("Room video state", () => {
  it("advances effective time while playing", () => {
    const room = mkRoom();
    room.changeVideo("dQw4w9WgXcQ", 1000);
    room.play(10, 1000);
    // 2 seconds of wall-clock later
    expect(room.effectiveTime(3000)).toBeCloseTo(12, 3);
  });

  it("freezes effective time when paused", () => {
    const room = mkRoom();
    room.changeVideo("dQw4w9WgXcQ", 1000);
    room.play(10, 1000);
    room.pause(12, 3000);
    expect(room.effectiveTime(9999)).toBeCloseTo(12, 3);
  });

  it("seek clamps negative time to zero", () => {
    const room = mkRoom();
    room.seek(-5, 1000);
    expect(room.video.currentTime).toBe(0);
  });

  it("change_video resets playhead and pauses", () => {
    const room = mkRoom();
    room.play(50, 1000);
    room.changeVideo("newVid", 2000);
    expect(room.video.videoId).toBe("newVid");
    expect(room.video.currentTime).toBe(0);
    expect(room.video.playState).toBe("paused");
  });
});
