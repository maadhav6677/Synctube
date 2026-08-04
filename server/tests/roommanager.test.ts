import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RoomStore } from "../src/db/database.js";
import { RoomManager } from "../src/domain/RoomManager.js";

describe("RoomManager + persistence", () => {
  let store: RoomStore;
  let mgr: RoomManager;

  beforeEach(() => {
    store = new RoomStore(":memory:");
    mgr = new RoomManager(store);
  });
  afterEach(() => store?.close());

  it("creates rooms with unique 6-char codes", () => {
    const a = mgr.createRoom();
    const b = mgr.createRoom();
    expect(a.id).toMatch(/^[A-Z0-9]{6}$/);
    expect(a.id).not.toBe(b.id);
    expect(store.countRooms()).toBe(2);
  });

  it("is case-insensitive on lookup", () => {
    const room = mgr.createRoom("vid1");
    expect(mgr.getRoom(room.id.toLowerCase())?.id).toBe(room.id);
  });

  it("rehydrates room video state from the store", () => {
    const room = mgr.createRoom("vid1");
    room.play(42, 5000);
    mgr.persistVideoState(room);

    // Fresh manager over the SAME store simulates a server restart.
    const mgr2 = new RoomManager(store);
    const revived = mgr2.getRoom(room.id);
    expect(revived?.video.videoId).toBe("vid1");
    expect(revived?.video.currentTime).toBe(42);
    expect(revived?.video.playState).toBe("playing");
  });

  it("disposes empty rooms from memory but keeps metadata", () => {
    const room = mgr.createRoom();
    expect(mgr.disposeIfEmpty(room)).toBe(true);
    expect(mgr.liveRoomCount()).toBe(0);
    expect(store.getRoom(room.id)).toBeDefined();
  });
});
