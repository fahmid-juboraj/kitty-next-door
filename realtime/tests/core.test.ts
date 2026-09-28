// Server logic tests: several users talking to each other in memory, with a
// fake clock, fake storage and optional unreachable peers.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { UserCore, type CoreEnv, type PeerApi, type UserRecord } from "../server/src/core";
import { ParkCore, parkName, type ParkState } from "../server/src/parkcore";
import type { Cap, Notice, ParkMsg, Profile, ServerMsg, Snapshot } from "../shared/protocol";

let now = 1_000_000;
const STAY = 60_000;
const PARK_STAY = 30_000;

interface User {
  code: string;
  token: string;
  core: UserCore;
  record: () => UserRecord | undefined;
  sent: ServerMsg[];
  alarm: number | null;
}

const world = new Map<string, User>();
const unreachable = new Set<string>();

// One real park, with fake storage; spectator frames are recorded.
let parkState: ParkState | undefined;
let parkFrames: ParkMsg[] = [];
let parkAlarm: number | null = null;
let parkDown = false;
let nextId = 0;
const park = new ParkCore({
  load: async () => (parkState ? structuredClone(parkState) : undefined),
  save: async (s) => { parkState = structuredClone(s); },
  send: (m) => parkFrames.push(m),
  owner: (code) => (world.get(code) ?? makeUser(code)).core,
  setAlarm: async (at) => { parkAlarm = at; },
  randomId: () => `park${String(nextId++).padStart(8, "0")}`,
  now: () => now,
});
const parkApi = {
  join: (o: string, p: Profile) => (parkDown ? Promise.reject(new Error("down")) : park.join(o, p)),
  leave: (id: string) => (parkDown ? Promise.reject(new Error("down")) : park.leave(id)),
};

function makeUser(code: string): User {
  let rec: UserRecord | undefined;
  const u = { code, token: code.padEnd(43, "x"), sent: [] as ServerMsg[], alarm: null as number | null } as User;
  const env: CoreEnv = {
    load: async () => (rec ? structuredClone(rec) : undefined),
    save: async (r) => { rec = structuredClone(r); },
    wipe: async () => { rec = undefined; },
    peer: (c) => {
      if (unreachable.has(c)) {
        return new Proxy({}, { get: () => async () => { throw new Error("down"); } }) as PeerApi;
      }
      return (world.get(c) ?? ghost(c)).core;
    },
    park: () => parkApi,
    send: (m) => u.sent.push(m),
    setAlarm: async (at) => { u.alarm = at; },
    hash: async (t) => `h:${t}`,
    now: () => now,
    stayMs: STAY,
    parkStayMs: PARK_STAY,
  };
  u.core = new UserCore(env);
  u.record = () => rec;
  return u;
}

/** A code nobody has registered. */
function ghost(code: string): User {
  return makeUser(code);
}

const profile = (cat: string, owner = ""): Profile => ({ cat, coat: "ginger", owner });

/** A signed-in user. `caps` defaults to a current client; pass [] for a 0.1.0 client. */
async function join(code: string, cat: string, caps: Cap[] = ["letters", "park"]): Promise<User> {
  const u = makeUser(code);
  world.set(code, u);
  assert.equal(await u.core.authenticate(code, u.token, profile(cat, `${cat}'s human`)), true);
  await u.core.welcome(profile(cat, `${cat}'s human`), caps);
  return u;
}

const lastState = (u: User): Snapshot => {
  const s = [...u.sent].reverse().find((m) => m.t === "state");
  assert.ok(s && s.t === "state", `${u.code} has no state`);
  return s.state;
};
const notices = (u: User): Notice[] => u.sent.flatMap((m) => (m.t === "notice" ? [m.notice] : []));
const errors = (u: User) => notices(u).filter((n) => n.kind === "error").map((n) => n.error);

async function befriend(a: User, b: User): Promise<void> {
  await a.core.handle({ t: "friend_request", code: b.code });
  await b.core.handle({ t: "friend_respond", code: a.code, accept: true });
}

let A: User, B: User, C: User;

beforeEach(async () => {
  world.clear();
  unreachable.clear();
  parkState = undefined;
  parkFrames = [];
  parkAlarm = null;
  parkDown = false;
  nextId = 0;
  now = 1_000_000;
  A = await join("AAAAAAAA", "Mochi");
  B = await join("BBBBBBBB", "Kiki");
  C = await join("CCCCCCCC", "Tofu");
});

test("registration: the same code with a different token is rejected", async () => {
  assert.equal(await A.core.authenticate(A.code, "z".repeat(43), profile("Evil")), false);
  assert.equal(await A.core.authenticate(A.code, A.token, profile("Mochi")), true);
});

test("friend request, accept, both sides become friends", async () => {
  await A.core.handle({ t: "friend_request", code: B.code });
  assert.deepEqual(lastState(A).outgoing.map((p) => p.code), [B.code]);
  assert.deepEqual(lastState(B).incoming.map((p) => p.code), [A.code]);
  assert.ok(notices(B).some((n) => n.kind === "friend_request" && n.who?.code === A.code));

  await B.core.handle({ t: "friend_respond", code: A.code, accept: true });
  assert.deepEqual(lastState(A).friends.map((p) => p.code), [B.code]);
  assert.deepEqual(lastState(B).friends.map((p) => p.code), [A.code]);
  assert.equal(lastState(A).friends[0].profile?.cat, "Kiki");
  assert.equal(lastState(A).outgoing.length, 0);
});

test("declining removes the request on both sides", async () => {
  await A.core.handle({ t: "friend_request", code: B.code });
  await B.core.handle({ t: "friend_respond", code: A.code, accept: false });
  assert.equal(lastState(A).outgoing.length, 0);
  assert.equal(lastState(B).incoming.length, 0);
  assert.equal(lastState(A).friends.length, 0);
});

test("crossing requests become a friendship automatically", async () => {
  await A.core.handle({ t: "friend_request", code: B.code });
  await B.core.handle({ t: "friend_request", code: A.code });
  assert.deepEqual(lastState(A).friends.map((p) => p.code), [B.code]);
  assert.deepEqual(lastState(B).friends.map((p) => p.code), [A.code]);
});

test("requests to yourself or to unknown codes fail", async () => {
  await A.core.handle({ t: "friend_request", code: A.code });
  await A.core.handle({ t: "friend_request", code: "ZZZZZZZZ" });
  assert.deepEqual(errors(A), ["self", "no_such_cat"]);
  assert.equal(world.has("ZZZZZZZZ"), false);
});

test("friend requests are rate limited", async () => {
  for (let i = 0; i < 12; i++) await A.core.handle({ t: "friend_request", code: `D${i}`.padEnd(8, "0").slice(0, 8) });
  assert.ok(errors(A).includes("rate_limited"));
});

test("you can't send your cat to a non-friend", async () => {
  await A.core.handle({ t: "send_cat", to: B.code, msg: "hi", gift: "fish" });
  assert.deepEqual(errors(A), ["not_friends"]);
  assert.equal(lastState(A).cat.where, "home");
  assert.equal(B.record()!.guests[A.code], undefined);
});

test("send: the cat leaves home and appears at the friend's", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "miss you", gift: "yarn" });
  const cat = lastState(A).cat;
  assert.equal(cat.where, "away");
  assert.equal(cat.where === "away" && cat.at, B.code);
  assert.equal(A.alarm, now + STAY);
  const g = lastState(B).guests;
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].owner, g[0].msg, g[0].gift, g[0].profile.cat], [A.code, "miss you", "yarn", "Mochi"]);
  assert.ok(notices(B).some((n) => n.kind === "guest_arrived"));
  // Already away: can't be in two places.
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  assert.ok(errors(A).includes("cat_busy"));
});

test("offline host: the guest waits in their record and shows up when they connect", async () => {
  await befriend(A, B);
  B.sent.length = 0; // B is "offline": nothing delivered
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  B.sent.length = 0;
  await B.core.welcome(profile("Kiki", "Kiki's human"));
  assert.equal(lastState(B).guests[0].owner, A.code);
});

test("recall brings the cat home and the host loses the guest", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await A.core.handle({ t: "recall" });
  assert.equal(lastState(A).cat.where, "home");
  assert.equal(A.alarm, null);
  assert.equal(lastState(B).guests.length, 0);
  assert.ok(notices(A).some((n) => n.kind === "cat_home" && n.reason === "recalled"));
});

test("host sends the guest home", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await B.core.handle({ t: "send_home", owner: A.code });
  assert.equal(lastState(B).guests.length, 0);
  assert.equal(lastState(A).cat.where, "home");
  assert.ok(notices(A).some((n) => n.kind === "cat_home" && n.reason === "sent_home" && n.who?.code === B.code));
});

test("the visit timer brings the cat home, but not early", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  now += STAY / 2;
  await A.core.alarm();
  assert.equal(lastState(A).cat.where, "away");
  now += STAY;
  await A.core.alarm();
  assert.equal(lastState(A).cat.where, "home");
  assert.equal(B.record()!.guests[A.code], undefined);
  assert.ok(notices(A).some((n) => n.kind === "cat_home" && n.reason === "timeout"));
});

test("a host takes at most 3 guests; the 4th cat stays home", async () => {
  const others = [await join("DDDDDDDD", "D"), await join("EEEEEEEE", "E"), await join("FFFFFFFF", "F"), C];
  for (const o of others) {
    await befriend(o, B);
    await o.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  }
  assert.equal(Object.keys(B.record()!.guests).length, 3);
  assert.ok(errors(C).includes("host_full"));
  assert.equal(lastState(C).cat.where, "home");
});

test("unfriending during a visit sends cats home both ways", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await B.core.handle({ t: "send_cat", to: A.code, msg: "", gift: "fish" });
  await B.core.handle({ t: "unfriend", code: A.code });
  for (const u of [A, B]) {
    const s = lastState(u);
    assert.equal(s.cat.where, "home", u.code);
    assert.equal(s.guests.length, 0, u.code);
    assert.equal(s.friends.length, 0, u.code);
  }
});

test("recall racing with send-home ends consistent", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await Promise.all([A.core.handle({ t: "recall" }), B.core.handle({ t: "send_home", owner: A.code })]);
  assert.equal(A.record()!.cat.where, "home");
  assert.deepEqual(B.record()!.guests, {});
});

test("an unreachable host: the cat never leaves", async () => {
  await befriend(A, B);
  unreachable.add(B.code);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  assert.equal(lastState(A).cat.where, "home");
  assert.ok(errors(A).includes("unreachable"));
});

test("a guest the owner no longer thinks is there gets tidied up on connect", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  // Simulate a lost removeGuest: A is home, B still lists the guest.
  unreachable.add(B.code);
  await A.core.handle({ t: "recall" });
  unreachable.clear();
  assert.ok(B.record()!.guests[A.code]);
  await B.core.welcome(profile("Kiki"));
  assert.deepEqual(B.record()!.guests, {});
});

test("sends are rate limited", async () => {
  await befriend(A, B);
  for (let i = 0; i < 21; i++) {
    await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
    await A.core.handle({ t: "recall" });
  }
  assert.ok(errors(A).includes("rate_limited"));
});

test("deleting your account erases it and cleans up friends, guests and cats", async () => {
  await befriend(A, B);
  await befriend(A, C);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await C.core.handle({ t: "send_cat", to: A.code, msg: "", gift: "fish" });
  await A.core.handle({ t: "delete_me" });
  assert.equal(A.record(), undefined);
  assert.deepEqual(B.record()!.guests, {});
  assert.deepEqual(B.record()!.friends, {});
  assert.equal(C.record()!.cat.where, "home");
  assert.deepEqual(C.record()!.friends, {});
});

test("profile changes reach friends and hosted guests", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  await A.core.handle({ t: "profile", profile: { cat: "Mochi II", coat: "black", owner: "F" } });
  assert.equal(B.record()!.friends[A.code].profile.cat, "Mochi II");
  assert.equal(B.record()!.guests[A.code].profile.coat, "black");
});

test("at the friend cap: 50 friends, 3 visiting, then delete cleans every one of them", async () => {
  const codes: string[] = [];
  for (let i = 0; i < 50; i++) {
    const code = `F${String(i).padStart(2, "0")}`.padEnd(8, "Z").replace(/[ILOU]/g, "1");
    const u = await join(code, `Cat${i}`);
    await u.core.handle({ t: "friend_request", code: A.code });
    await A.core.handle({ t: "friend_respond", code, accept: true });
    codes.push(code);
  }
  assert.equal(Object.keys(A.record()!.friends).length, 50);
  // A 51st friend is refused.
  await B.core.handle({ t: "friend_request", code: A.code });
  await A.core.handle({ t: "friend_respond", code: B.code, accept: true });
  assert.ok(errors(A).includes("too_many_friends"));

  for (const c of codes.slice(0, 4)) await world.get(c)!.core.handle({ t: "send_cat", to: A.code, msg: "", gift: "fish" });
  assert.equal(Object.keys(A.record()!.guests).length, 3);
  await A.core.handle({ t: "send_cat", to: codes[10], msg: "", gift: "fish" });

  await A.core.handle({ t: "delete_me" });
  assert.equal(A.record(), undefined);
  for (const c of codes) {
    const r = world.get(c)!.record()!;
    assert.deepEqual(r.friends, {}, c);
    assert.deepEqual(r.guests, {}, c);
    assert.equal(r.cat.where, "home", c);
  }
});


// ---- letters ------------------------------------------------------------------

test("a letter travels with the cat and leaves with it", async () => {
  await befriend(A, B);
  const letter = "Dear Kiki,\n\nHere's the recipe you asked for:\n1. flour\n2. love";
  await A.core.handle({ t: "send_cat", to: B.code, msg: "hi", gift: "fish", letter });
  assert.equal(lastState(B).guests[0].letter, letter);
  await A.core.handle({ t: "recall" });
  assert.deepEqual(B.record()!.guests, {});
  assert.ok(!JSON.stringify(B.record()).includes("recipe"), "letter is gone from the host's record");
});

test("a friend on 0.1.0 still gets the visit, and the sender is told the letter didn't arrive", async () => {
  const old = await join("DDDDDDDD", "Oldie", []);
  await befriend(A, old);
  await A.core.handle({ t: "send_cat", to: old.code, msg: "hi", gift: "fish", letter: "secret plans" });
  assert.equal(lastState(old).guests.length, 1);
  assert.equal(lastState(old).guests[0].letter, undefined);
  assert.equal(lastState(A).cat.where, "away");
  assert.ok(errors(A).includes("letter_not_delivered"));
  assert.ok(!JSON.stringify(old.record()).includes("secret plans"));
});

test("no letter, no complaint", async () => {
  const old = await join("DDDDDDDD", "Oldie", []);
  await befriend(A, old);
  await A.core.handle({ t: "send_cat", to: old.code, msg: "hi", gift: "fish" });
  assert.deepEqual(errors(A), []);
});

// ---- park -----------------------------------------------------------------------

const parkCats = () => Object.values(parkState?.cats ?? {});

test("to the park and back: the owner's record and the park agree", async () => {
  await A.core.handle({ t: "to_park" });
  const cat = lastState(A).cat;
  assert.equal(cat.where, "park");
  assert.ok(!("parkId" in cat), "the park entry id stays on the server");
  assert.equal(A.alarm, now + PARK_STAY);
  assert.equal(parkCats().length, 1);
  assert.equal(parkCats()[0].cat, "Mochi");
  // Spectators never see a friend code.
  assert.ok(!JSON.stringify(parkFrames).includes(A.code));
  assert.ok(parkFrames.some((f) => f.t === "join" && f.cat.cat === "Mochi"));

  await A.core.handle({ t: "recall" });
  assert.equal(lastState(A).cat.where, "home");
  assert.equal(parkCats().length, 0);
  assert.ok(parkFrames.some((f) => f.t === "leave"));
});

test("the park trip timer brings the cat home", async () => {
  await A.core.handle({ t: "to_park" });
  now += PARK_STAY + 1;
  await A.core.alarm();
  assert.equal(lastState(A).cat.where, "home");
  assert.equal(parkCats().length, 0);
  assert.ok(notices(A).some((n) => n.kind === "cat_home" && n.reason === "timeout"));
});

test("a cat in the park can't also visit a friend", async () => {
  await befriend(A, B);
  await A.core.handle({ t: "to_park" });
  await A.core.handle({ t: "send_cat", to: B.code, msg: "", gift: "fish" });
  assert.ok(errors(A).includes("cat_busy"));
  assert.deepEqual(B.record()!.guests, {});
});

test("the first cat in an empty park is crowned Cat of the Hour, and its owner hears about it", async () => {
  await A.core.handle({ t: "to_park" });
  assert.ok(parkState!.crown);
  assert.ok(parkFrames.some((f) => f.t === "crown" && f.id === parkState!.crown));
  assert.ok(notices(A).some((n) => n.kind === "crowned"));
  await B.core.handle({ t: "to_park" });
  assert.ok(!notices(B).some((n) => n.kind === "crowned"), "only one crown at a time");
});

test("a full park turns cats away; they stay home", async () => {
  for (let i = 0; i < 60; i++) await (await join(`P${String(i).padStart(2, "0")}`.padEnd(8, "Z").replace(/[ILOU]/g, "1"), `C${i}`)).core.handle({ t: "to_park" });
  assert.equal(parkCats().length, 60);
  await A.core.handle({ t: "to_park" });
  assert.ok(errors(A).includes("park_full"));
  assert.equal(lastState(A).cat.where, "home");
});

test("the park drops ghosts: cats whose owners think they're home", async () => {
  await A.core.handle({ t: "to_park" });
  parkDown = true; // the leave call is lost
  await A.core.handle({ t: "recall" });
  parkDown = false;
  assert.equal(parkCats().length, 1);
  await park.alarm();
  assert.equal(parkCats().length, 0);
});

test("deleting your account takes your cat out of the park", async () => {
  await A.core.handle({ t: "to_park" });
  await A.core.handle({ t: "delete_me" });
  assert.equal(parkCats().length, 0);
});

test("park moderation: kicked and blocked cats can't come back", async () => {
  await A.core.handle({ t: "to_park" });
  const [id] = Object.keys(parkState!.cats);
  assert.equal(await park.kick(id, true), true);
  assert.equal(parkCats().length, 0);
  await A.core.handle({ t: "recall" });
  await A.core.handle({ t: "to_park" });
  assert.ok(errors(A).includes("park_full"));
  assert.equal(parkCats().length, 0);
});

test("park names: rude names are replaced by the coat", () => {
  assert.equal(parkName({ cat: "Mochi", coat: "ginger", owner: "" }), "Mochi");
  assert.equal(parkName({ cat: "sh1t head", coat: "black", owner: "" }), "Midnight cat");
  assert.equal(parkName({ cat: "F.U.C.K", coat: "grey", owner: "" }), "Grey Tabby cat");
});
