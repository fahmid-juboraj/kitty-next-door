// Live test against a local `wrangler dev` (real workerd runtime, real
// Durable Objects, real WebSockets). Start the server first:
//   cd realtime/server && npx wrangler dev --local --port 8787 --var STAY_SECONDS:4
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

const SERVER = process.env.KITTY_SERVER ?? "ws://127.0.0.1:8787";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newCode = () => [...randomBytes(8)].map((b) => ALPHABET[b % 32]).join("");
const newToken = () => randomBytes(32).toString("base64url");
const clients = [];

class Client {
  constructor(cat, { code = newCode(), token = newToken(), caps = ["letters", "park"] } = {}) {
    Object.assign(this, { cat, code, token, caps, frames: [], closed: null });
    clients.push(this);
  }
  get profile() { return { cat: this.cat, coat: "ginger", owner: `${this.cat}'s human` }; }
  async open() {
    this.ws = new WebSocket(`${SERVER}/v1/connect/${this.code}`);
    this.ws.addEventListener("message", (e) => this.frames.push(e.data === "pong" ? "pong" : JSON.parse(e.data)));
    this.ws.addEventListener("close", (e) => { this.closed = e.code; });
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    return this;
  }
  async connect() {
    await this.open();
    this.send({ t: "hello", token: this.token, profile: this.profile, caps: this.caps });
    await this.waitFor((f) => f.t === "state");
    return this;
  }
  send(m) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }
  async waitFor(pred, ms = 5000, from = 0) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.frames.slice(from).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${this.cat}: timed out; last frames ${JSON.stringify(this.frames.slice(-3))}`);
  }
  /** Wait for a state snapshot (after `from`) matching `pred`. */
  state(pred, ms, from) { return this.waitFor((f) => f.t === "state" && pred(f.state), ms, from).then((f) => f.state); }
  notice(pred, ms, from) { return this.waitFor((f) => f.t === "notice" && pred(f.notice), ms, from).then((f) => f.notice); }
  mark() { return this.frames.length; }
  close() { try { this.ws.close(); } catch {} }
}

async function friends(a, b) {
  a.send({ t: "friend_request", code: b.code });
  await b.state((s) => s.incoming.some((p) => p.code === a.code));
  b.send({ t: "friend_respond", code: a.code, accept: true });
  await a.state((s) => s.friends.some((p) => p.code === b.code));
}

after(() => clients.forEach((c) => c.close()));

test("register, then a wrong token for the same code is rejected", async () => {
  const a = await new Client("Mochi").connect();
  const s = await a.state(() => true);
  assert.equal(s.me.code, a.code);
  assert.equal(s.cat.where, "home");
  const imposter = await new Client("Evil", { code: a.code }).open();
  imposter.send({ t: "hello", token: newToken(), profile: imposter.profile });
  await imposter.notice((n) => n.error === "bad_token");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(imposter.closed, 4001);
});

test("before hello, junk and oversized frames are refused; ping gets an automatic pong", async () => {
  const c = await new Client("Tofu").open();
  c.send({ t: "recall" });
  await c.notice((n) => n.error === "not_authed");
  c.send("{not json");
  await c.notice((n) => n.error === "bad_message", 5000, 1);
  c.send("x".repeat(5000));
  c.send("ping");
  await c.waitFor((f) => f === "pong");
});

test("friends, send, the cat moves in real time, then the timer brings it home", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  await friends(a, b);

  const m = b.mark();
  a.send({ t: "send_cat", to: b.code, msg: "miss you", gift: "yarn" });
  const sa = await a.state((s) => s.cat.where === "away");
  assert.equal(sa.cat.at, b.code);
  const arrived = await b.notice((n) => n.kind === "guest_arrived", 5000, m);
  assert.equal(arrived.who.code, a.code);
  const sb = await b.state((s) => s.guests.length === 1, 5000, m);
  assert.equal(sb.guests[0].msg, "miss you");

  // STAY_SECONDS=4 on the dev server: the Durable Object alarm walks it home.
  const home = await a.notice((n) => n.kind === "cat_home", 9000);
  assert.equal(home.reason, "timeout");
  await b.state((s) => s.guests.length === 0, 5000);
});

test("a non-friend can't receive your cat", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  a.send({ t: "send_cat", to: b.code, msg: "", gift: "fish" });
  await a.notice((n) => n.error === "not_friends");
});

test("offline friend: the cat waits and is there when they come online", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  await friends(a, b);
  b.close();
  await new Promise((r) => setTimeout(r, 300));
  a.send({ t: "send_cat", to: b.code, msg: "surprise", gift: "flower" });
  await a.state((s) => s.cat.where === "away");
  const b2 = await new Client("Kiki", { code: b.code, token: b.token }).connect();
  const s = await b2.state(() => true);
  assert.equal(s.guests[0]?.owner, a.code);
  assert.equal(s.guests[0]?.msg, "surprise");
});

test("recall and send-home both bring the cat back", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  await friends(a, b);
  a.send({ t: "send_cat", to: b.code, msg: "", gift: "fish" });
  await b.state((s) => s.guests.length === 1);
  a.send({ t: "recall" });
  await a.notice((n) => n.kind === "cat_home" && n.reason === "recalled");
  await b.state((s) => s.guests.length === 0);

  let m = a.mark();
  a.send({ t: "send_cat", to: b.code, msg: "", gift: "fish" });
  await b.state((s) => s.guests.length === 1, 5000, b.mark() - 1);
  b.send({ t: "send_home", owner: a.code });
  const n = await a.notice((x) => x.kind === "cat_home" && x.reason === "sent_home", 5000, m);
  assert.equal(n.who.code, b.code);
  m = a.mark();
  await a.state((s) => s.cat.where === "home", 5000, 0);
});

test("deleting an account closes it and tidies up the friend's side", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  await friends(a, b);
  a.send({ t: "send_cat", to: b.code, msg: "", gift: "fish" });
  await b.state((s) => s.guests.length === 1);
  a.send({ t: "delete_me" });
  await b.state((s) => s.friends.length === 0 && s.guests.length === 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.closed, 4002);
  // The code is free again: a new token can register it.
  const again = await new Client("Mochi", { code: a.code }).connect();
  assert.equal((await again.state(() => true)).friends.length, 0);
});

test("letters arrive with the cat, line breaks intact", async () => {
  const a = await new Client("Mochi").connect();
  const b = await new Client("Kiki").connect();
  await friends(a, b);
  const letter = ["Dear Kiki,", "", "The recipe:", "1. flour 🍞", "2. love"].join("\n");
  a.send({ t: "send_cat", to: b.code, msg: "for you", gift: "flower", letter });
  const s = await b.state((x) => x.guests.length === 1);
  assert.equal(s.guests[0].letter, letter);
});

test("the park: spectators see cats come and go, crowns, and never a friend code", async () => {
  const spectator = new WebSocket(`${SERVER}/v1/park`);
  const frames = [];
  spectator.onmessage = (e) => { if (e.data !== "pong") frames.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { spectator.onopen = res; spectator.onerror = rej; });
  const waitFrame = async (pred, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = frames.find(pred);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("park frame timeout: " + JSON.stringify(frames.slice(-3)));
  };
  await waitFrame((f) => f.t === "park");

  const a = await new Client("ParkCat").connect();
  a.send({ t: "to_park" });
  await a.state((s) => s.cat.where === "park");
  const joined = await waitFrame((f) => f.t === "join" && f.cat.cat === "ParkCat");
  assert.match(joined.cat.id, /^[a-z0-9]{12}$/);
  a.send({ t: "recall" });
  await waitFrame((f) => f.t === "leave" && f.id === joined.cat.id);
  await a.notice((n) => n.kind === "cat_home");

  // Junk from a spectator is ignored; ping gets pong.
  spectator.send("{nonsense");
  spectator.send("ping");
  assert.ok(!JSON.stringify(frames).includes(a.code), "spectators never see a friend code");
  spectator.close();
});
