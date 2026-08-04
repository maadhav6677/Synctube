/**
 * Live end-to-end demo driver.
 *
 * Connects real Socket.IO clients to a running server and walks through the
 * full feature set — join/roles, playback sync, RBAC rejection, host actions,
 * chat — printing an annotated narrative of what each client observes.
 *
 * Usage:  node scripts/demo.mjs [serverUrl]   (default http://localhost:4000)
 */
import { io } from "socket.io-client";

const URL = process.argv[2] ?? "http://localhost:4000";
const log = (...a) => console.log(...a);
const ok = (m) => log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => log(`  \x1b[36m•\x1b[0m ${m}`);
const step = (n, m) => log(`\n\x1b[1m\x1b[35m[${n}] ${m}\x1b[0m`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return io(URL, { transports: ["websocket"], forceNew: true });
}
function join(sock, roomId, username, hostToken) {
  return new Promise((res) => sock.emit("join_room", { roomId, username, hostToken }, res));
}

async function createRoom(videoId) {
  return (
    await fetch(`${URL}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(videoId ? { videoId } : {}),
    })
  ).json();
}
/**
 * Waits for the next event that satisfies `predicate`. Uses a persistent
 * listener (not `once`) so that already-buffered/irrelevant events — e.g. the
 * initial `snapshot` sync a client gets on join — are skipped rather than
 * mistakenly consumed. This makes the demo deterministic regardless of
 * broadcast timing.
 */
function waitFor(sock, event, predicate = () => true, timeout = 3000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      sock.off(event, handler);
      rej(new Error(`timeout: ${event}`));
    }, timeout);
    const handler = (p) => {
      if (!predicate(p)) return;
      clearTimeout(t);
      sock.off(event, handler);
      res(p);
    };
    sock.on(event, handler);
  });
}
const isOrigin = (o) => (p) => p.origin === o;

async function main() {
  log(`\x1b[1m🎬 Watch Party — live end-to-end demo against ${URL}\x1b[0m`);

  // --- create a room over REST ---
  step(1, "Create a room via REST");
  const created = await createRoom("dQw4w9WgXcQ");
  const roomId = created.roomId;
  ok(`room created: ${roomId} (video ${created.videoId})`);

  // --- two clients join ---
  step(2, "Alice and Bob join over WebSocket");
  const alice = connect();
  const bob = connect();
  const aliceAck = await join(alice, roomId, "Alice", created.hostToken);
  const bobAck = await join(bob, roomId, "Bob");
  ok(`Alice joined as: \x1b[33m${aliceAck.you.role}\x1b[0m (creator ⇒ host)`);
  ok(`Bob joined as:   \x1b[90m${bobAck.you.role}\x1b[0m (default)`);
  info(`roster: ${bobAck.participants.map((p) => `${p.username}:${p.role}`).join(", ")}`);

  // --- playback sync: host drives, Bob observes ---
  step(3, "Host (Alice) plays → Bob receives synced state");
  let sync = waitFor(bob, "sync_state", isOrigin("play"));
  alice.emit("play", { time: 30 });
  let s = await sync;
  ok(`Bob's player told: playState=${s.playState}, t≈${s.currentTime.toFixed(1)}s, via '${s.origin}'`);

  step(4, "Host seeks to 2:00 → Bob follows");
  sync = waitFor(bob, "sync_state", isOrigin("seek"));
  alice.emit("seek", { time: 120 });
  s = await sync;
  ok(`Bob seeked to t≈${s.currentTime.toFixed(1)}s (origin '${s.origin}')`);

  step(5, "Host changes the video → Bob's player swaps");
  sync = waitFor(bob, "sync_state", isOrigin("change_video"));
  alice.emit("change_video", { videoId: "9bZkp7q19f0" });
  s = await sync;
  ok(`Bob now on videoId=${s.videoId} (origin '${s.origin}')`);

  // --- RBAC: Bob (participant) is rejected ---
  step(6, "RBAC — Bob (participant) tries to control playback → REJECTED");
  await sleep(150); // let step-5 broadcasts fully settle first
  let aliceGotSync = false;
  const leakSpy = () => (aliceGotSync = true);
  alice.on("sync_state", leakSpy);
  const err = waitFor(bob, "error_message");
  bob.emit("play", { time: 5 });
  const e = await err;
  ok(`Server rejected Bob with code=${e.code}: "${e.message}"`);
  await sleep(200);
  aliceGotSync
    ? log("  \x1b[31m✗ leaked sync to host!\x1b[0m")
    : ok("host received NO sync_state — mutation was blocked server-side");
  alice.off("sync_state", leakSpy);

  // --- host promotes Bob to moderator ---
  step(7, "Host promotes Bob → Moderator");
  const roleEv = waitFor(bob, "role_assigned");
  alice.emit("assign_role", { userId: bobAck.you.id, role: "moderator" });
  const r = await roleEv;
  ok(`role_assigned broadcast: ${r.username} → \x1b[34m${r.role}\x1b[0m`);

  step(8, "Now Moderator (Bob) CAN control playback → Alice follows");
  sync = waitFor(alice, "sync_state");
  bob.emit("play", { time: 42 });
  s = await sync;
  ok(`Alice received Bob's play: t≈${s.currentTime.toFixed(1)}s — moderator authorized`);

  // --- chat ---
  step(9, "Chat broadcast");
  const chat = waitFor(bob, "chat_message");
  alice.emit("chat_message", { text: "This part is great!" });
  const c = await chat;
  ok(`Bob received chat from ${c.username}: "${c.text}"`);

  // --- transfer host ---
  step(10, "Transfer host: Alice → Bob");
  const th = waitFor(bob, "host_transferred");
  alice.emit("transfer_host", { userId: bobAck.you.id });
  const t = await th;
  const rosterAfter = Object.fromEntries(t.participants.map((p) => [p.username, p.role]));
  ok(`host_transferred: Bob=${rosterAfter.Bob}, Alice=${rosterAfter.Alice}`);

  // --- remove participant ---
  step(11, "New host (Bob) removes Alice");
  const kicked = waitFor(alice, "you_were_removed");
  const removed = waitFor(bob, "participant_removed");
  bob.emit("remove_participant", { userId: aliceAck.you.id });
  await kicked;
  const rem = await removed;
  ok(`Alice got 'you_were_removed'; roster now: ${rem.participants.map((p) => p.username).join(", ") || "(empty)"}`);

  // --- host capability remains required after a disconnect ---
  step(12, "Host capability: a participant cannot gain control when host leaves");
  const created2 = await createRoom();
  const room2 = created2.roomId;
  const carol = connect();
  const dave = connect();
  const carolAck = await join(carol, room2, "Carol", created2.hostToken);
  await join(dave, room2, "Dave");
  info(`room ${room2}: Carol=${carolAck.you.role}, Dave=participant`);
  const left = waitFor(dave, "user_left");
  carol.close();
  await left;
  const denied = waitFor(dave, "error_message");
  dave.emit("play", { time: 1 });
  ok(`Carol left; Dave remains unprivileged (${(await denied).code})`);

  log(`\n\x1b[1m\x1b[32m✅ All demo steps passed.\x1b[0m`);

  [alice, bob, carol, dave].forEach((s) => s.close());
  await sleep(200);
  process.exit(0);
}

main().catch((err) => {
  console.error("\x1b[31mDemo failed:\x1b[0m", err);
  process.exit(1);
});
