// Quick end-to-end check of a deployed server that cleans up after itself:
// two throwaway users befriend, send a cat, call it home, then delete both.
//   node tests/smoke.mjs [wss://kitty-next-door.kittynextdoor.workers.dev]
import { randomBytes } from "node:crypto";

const SERVER = process.argv[2] ?? "wss://kitty-next-door.kittynextdoor.workers.dev";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = () => [...randomBytes(8)].map((b) => ALPHABET[b % 32]).join("");

function user(cat) {
  const u = { code: code(), token: randomBytes(32).toString("base64url"), frames: [] };
  u.ws = new WebSocket(`${SERVER}/v1/connect/${u.code}`);
  u.ws.onmessage = (e) => u.frames.push(e.data === "pong" ? "pong" : JSON.parse(e.data));
  u.ready = new Promise((res, rej) => { u.ws.onopen = res; u.ws.onerror = () => rej(new Error("connect failed")); })
    .then(() => u.ws.send(JSON.stringify({ t: "hello", token: u.token, profile: { cat, coat: "ginger", owner: "smoke test" } })));
  u.send = (m) => u.ws.send(typeof m === "string" ? m : JSON.stringify(m));
  u.wait = async (pred, what, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (u.frames.some(pred)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${cat}: timed out waiting for ${what}`);
  };
  u.state = (pred, what) => u.wait((f) => f.t === "state" && pred(f.state), what);
  return u;
}

const t0 = Date.now();
const step = (s) => console.log(`${String(Date.now() - t0).padStart(5)} ms  ${s}`);
const a = user("SmokeA");
const b = user("SmokeB");
try {
  await Promise.all([a.ready, b.ready]);
  await a.state(() => true, "A signed in");
  await b.state(() => true, "B signed in");
  step("both signed in");
  a.send("ping");
  await a.wait((f) => f === "pong", "pong");
  step("keepalive ping answered");
  a.send({ t: "friend_request", code: b.code });
  await b.state((s) => s.incoming.some((p) => p.code === a.code), "request");
  b.send({ t: "friend_respond", code: a.code, accept: true });
  await a.state((s) => s.friends.some((p) => p.code === b.code), "friendship");
  step("friends");
  const sent = Date.now();
  a.send({ t: "send_cat", to: b.code, msg: "smoke", gift: "fish" });
  await b.state((s) => s.guests.some((g) => g.owner === a.code), "arrival");
  step(`cat arrived at B (${Date.now() - sent} ms after sending)`);
  a.send({ t: "recall" });
  await a.state((s) => s.cat.where === "home", "home");
  await b.state((s) => s.guests.length === 0, "guest gone");
  step("called home");
} finally {
  for (const u of [a, b]) try { u.send({ t: "delete_me" }); } catch { /* not connected */ }
  await new Promise((r) => setTimeout(r, 1500));
  step(`test accounts deleted (closed: ${a.ws.readyState === 3 && b.ws.readyState === 3})`);
}
