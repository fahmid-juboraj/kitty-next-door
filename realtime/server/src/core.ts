// One user's server-side logic, independent of Cloudflare so it can be tested
// in Node. The owner's record is the source of truth for where their cat is:
// every path home (recall, host sends it home, timeout, unfriend) ends here.
//
// Records are never held across a call to another user: each step loads,
// changes and saves in one go (`mutate`), because other messages can be
// handled while we wait on a peer.
import {
  CAPS, type ClientMsg, type ErrorCode, type Guest, type HomeReason, type Notice, type Person, type Profile,
  type ServerMsg, type Snapshot,
} from "../../shared/protocol";
import type { GiftId } from "../../../src/core/visit";

type Cat = Snapshot["cat"];

export interface UserRecord {
  code: string;
  tokenHash: string;
  profile: Profile;
  createdAt: number;
  friends: Record<string, { profile: Profile; since: number }>;
  incoming: Record<string, { profile: Profile; at: number }>;
  outgoing: Record<string, { at: number }>;
  cat: Cat;
  guests: Record<string, Guest>;
  rate: { friend: number[]; send: number[] };
}

export type FriendRequestResult =
  | { status: "accepted"; profile: Profile }
  | { status: "already"; profile: Profile }
  | { status: "pending" }
  | { status: "unknown" }
  | { status: "full" };
export type HostResult = "ok" | "not_friends" | "full" | "unknown";

/** What one user can ask of another. Implemented by `UserCore`, reached via Durable Object RPC. */
export interface PeerApi {
  friendRequest(from: string, profile: Profile): Promise<FriendRequestResult>;
  friendAccepted(from: string, profile: Profile): Promise<boolean>;
  friendDeclined(from: string): Promise<void>;
  unfriended(from: string): Promise<void>;
  hostGuest(guest: { owner: string; profile: Profile; msg: string; gift: GiftId }): Promise<HostResult>;
  removeGuest(owner: string): Promise<void>;
  catReturned(host: string, reason: HomeReason): Promise<void>;
  profileChanged(from: string, profile: Profile): Promise<void>;
  isCatWith(host: string): Promise<boolean>;
}

export interface CoreEnv {
  load(): Promise<UserRecord | undefined>;
  save(r: UserRecord): Promise<void>;
  wipe(): Promise<void>;
  peer(code: string): PeerApi;
  /** Deliver to every signed-in connection of this user. */
  send(msg: ServerMsg): void;
  setAlarm(at: number | null): Promise<void>;
  hash(token: string): Promise<string>;
  now(): number;
  stayMs: number;
}

const HOUR = 3_600_000;

export class UserCore implements PeerApi {
  constructor(private readonly env: CoreEnv) {}

  // ---- helpers ---------------------------------------------------------------

  private async mutate<T>(fn: (r: UserRecord) => T): Promise<T | undefined> {
    const r = await this.env.load();
    if (!r) return undefined;
    const out = fn(r);
    await this.env.save(r);
    return out;
  }

  private notice(n: Notice): void {
    this.env.send({ t: "notice", notice: n });
  }

  private error(error: ErrorCode, who?: Person): void {
    this.notice({ kind: "error", error, who });
  }

  private person(r: UserRecord, code: string): Person {
    return { code, profile: r.friends[code]?.profile ?? r.incoming[code]?.profile ?? null };
  }

  private async call<T>(code: string, fn: (p: PeerApi) => Promise<T>): Promise<T | "unreachable"> {
    try {
      return await fn(this.env.peer(code));
    } catch {
      return "unreachable";
    }
  }

  private allowRate(list: number[], max: number): boolean {
    const now = this.env.now();
    while (list.length && list[0] < now - HOUR) list.shift();
    if (list.length >= max) return false;
    list.push(now);
    return true;
  }

  static snapshot(r: UserRecord): Snapshot {
    return {
      me: { code: r.code, profile: r.profile },
      friends: Object.entries(r.friends).map(([code, f]) => ({ code, profile: f.profile })),
      incoming: Object.entries(r.incoming).map(([code, f]) => ({ code, profile: f.profile })),
      outgoing: Object.keys(r.outgoing).map((code) => ({ code, profile: null })),
      cat: r.cat,
      guests: Object.values(r.guests),
    };
  }

  async push(): Promise<void> {
    const r = await this.env.load();
    if (r) this.env.send({ t: "state", state: UserCore.snapshot(r) });
  }

  // ---- connection ------------------------------------------------------------

  /** Check the token, registering the code on first use. */
  async authenticate(code: string, token: string, profile: Profile): Promise<boolean> {
    const hash = await this.env.hash(token);
    const r = await this.env.load();
    if (!r) {
      await this.env.save({
        code, tokenHash: hash, profile, createdAt: this.env.now(),
        friends: {}, incoming: {}, outgoing: {}, cat: { where: "home" }, guests: {}, rate: { friend: [], send: [] },
      });
      return true;
    }
    return timingSafeEqual(r.tokenHash, hash) && r.code === code;
  }

  /** After signing in: sync the profile, tidy up guests, send the first snapshot. */
  async welcome(profile: Profile): Promise<void> {
    await this.setProfile(profile);
    await this.reconcileGuests();
    await this.push();
  }

  /** Drop guests whose owners no longer think their cat is here (e.g. a missed message). */
  private async reconcileGuests(): Promise<void> {
    const r = await this.env.load();
    if (!r) return;
    for (const owner of Object.keys(r.guests)) {
      const here = await this.call(owner, (p) => p.isCatWith(r.code));
      if (here === false) await this.mutate((x) => { delete x.guests[owner]; });
    }
  }

  async handle(m: ClientMsg): Promise<void> {
    switch (m.t) {
      case "hello": return; // handled by the transport
      case "profile": await this.setProfile(m.profile); break;
      case "friend_request": await this.requestFriend(m.code); break;
      case "friend_respond": await this.respondFriend(m.code, m.accept); break;
      case "unfriend": await this.unfriend(m.code); break;
      case "send_cat": await this.sendCat(m.to, m.msg, m.gift); break;
      case "recall": await this.recall("recalled"); break;
      case "send_home": await this.sendHome(m.owner); break;
      case "delete_me": await this.deleteMe(); return;
    }
    await this.push();
  }

  // ---- profile ---------------------------------------------------------------

  private async setProfile(profile: Profile): Promise<void> {
    const changed = await this.mutate((r) => {
      const same = JSON.stringify(r.profile) === JSON.stringify(profile);
      r.profile = profile;
      return same ? null : { code: r.code, friends: Object.keys(r.friends) };
    });
    if (!changed) return;
    await Promise.allSettled(changed.friends.map((f) => this.call(f, (p) => p.profileChanged(changed.code, profile))));
  }

  async profileChanged(from: string, profile: Profile): Promise<void> {
    await this.mutate((r) => {
      if (r.friends[from]) r.friends[from].profile = profile;
      if (r.guests[from]) r.guests[from].profile = profile;
    });
    await this.push();
  }

  // ---- friends ---------------------------------------------------------------

  private async requestFriend(code: string): Promise<void> {
    const r = await this.env.load();
    if (!r) return;
    if (code === r.code) return this.error("self");
    if (r.friends[code]) return this.error("already_friends", this.person(r, code));
    if (r.incoming[code]) return this.respondFriend(code, true);
    if (Object.keys(r.friends).length >= CAPS.friends) return this.error("too_many_friends");
    if (Object.keys(r.outgoing).length >= CAPS.pending) return this.error("too_many_pending");
    const allowed = await this.mutate((x) => this.allowRate(x.rate.friend, CAPS.friendRequestsPerHour));
    if (!allowed) return this.error("rate_limited");

    const res = await this.call(code, (p) => p.friendRequest(r.code, r.profile));
    if (res === "unreachable") return this.error("unreachable");
    if (res.status === "unknown") return this.error("no_such_cat");
    if (res.status === "full") return this.error("too_many_pending");
    if (res.status === "pending") {
      await this.mutate((x) => { x.outgoing[code] = { at: this.env.now() }; });
      return;
    }
    // "accepted" (they had already asked us) or "already" (repair a one-sided friendship).
    const profile = res.profile;
    await this.mutate((x) => {
      x.friends[code] = { profile, since: this.env.now() };
      delete x.outgoing[code];
      delete x.incoming[code];
    });
    this.notice({ kind: "friend_added", who: { code, profile } });
  }

  async friendRequest(from: string, profile: Profile): Promise<FriendRequestResult> {
    const r = await this.env.load();
    if (!r) return { status: "unknown" };
    if (r.friends[from]) return { status: "already", profile: r.profile };
    if (r.outgoing[from]) {
      await this.mutate((x) => {
        x.friends[from] = { profile, since: this.env.now() };
        delete x.outgoing[from];
      });
      this.notice({ kind: "friend_added", who: { code: from, profile } });
      await this.push();
      return { status: "accepted", profile: r.profile };
    }
    if (!r.incoming[from] && Object.keys(r.incoming).length >= CAPS.pending) return { status: "full" };
    await this.mutate((x) => { x.incoming[from] = { profile, at: this.env.now() }; });
    this.notice({ kind: "friend_request", who: { code: from, profile } });
    await this.push();
    return { status: "pending" };
  }

  private async respondFriend(code: string, accept: boolean): Promise<void> {
    const r = await this.env.load();
    const req = r?.incoming[code];
    if (!r || !req) return this.error("bad_message");
    if (accept && Object.keys(r.friends).length >= CAPS.friends) return this.error("too_many_friends");
    await this.mutate((x) => {
      delete x.incoming[code];
      if (accept) x.friends[code] = { profile: req.profile, since: this.env.now() };
    });
    if (!accept) {
      await this.call(code, (p) => p.friendDeclined(r.code));
      return;
    }
    const ok = await this.call(code, (p) => p.friendAccepted(r.code, r.profile));
    if (ok === true) {
      this.notice({ kind: "friend_added", who: { code, profile: req.profile } });
    } else {
      // They withdrew or left; don't keep a one-sided friendship.
      await this.mutate((x) => { delete x.friends[code]; });
      if (ok === "unreachable") this.error("unreachable");
    }
  }

  async friendAccepted(from: string, profile: Profile): Promise<boolean> {
    const added = await this.mutate((r) => {
      if (!r.outgoing[from]) return false;
      delete r.outgoing[from];
      r.friends[from] = { profile, since: this.env.now() };
      return true;
    });
    if (added) {
      this.notice({ kind: "friend_added", who: { code: from, profile } });
      await this.push();
    }
    return added === true;
  }

  async friendDeclined(from: string): Promise<void> {
    await this.mutate((r) => { delete r.outgoing[from]; });
    await this.push();
  }

  /** Remove `code` on this side, sending our cat home and their cat out. */
  private cutTies(r: UserRecord, code: string): { catCameHome: boolean; guestLeft: boolean } {
    delete r.friends[code];
    delete r.incoming[code];
    delete r.outgoing[code];
    const cat = r.cat;
    const catCameHome = (cat.where === "away" && cat.at === code) || (cat.where === "traveling" && cat.to === code);
    if (catCameHome) r.cat = { where: "home" };
    const guestLeft = !!r.guests[code];
    delete r.guests[code];
    return { catCameHome, guestLeft };
  }

  private async unfriend(code: string): Promise<void> {
    const res = await this.mutate((r) => ({ ...this.cutTies(r, code), me: r.code }));
    if (!res) return;
    if (res.catCameHome) {
      await this.env.setAlarm(null);
      this.notice({ kind: "cat_home", reason: "unfriended" });
    }
    await this.call(code, (p) => p.unfriended(res.me));
  }

  async unfriended(from: string): Promise<void> {
    const res = await this.mutate((r) => {
      const who = this.person(r, from);
      return { ...this.cutTies(r, from), who };
    });
    if (!res) return;
    if (res.catCameHome) {
      await this.env.setAlarm(null);
      this.notice({ kind: "cat_home", who: res.who, reason: "unfriended" });
    }
    if (res.guestLeft) this.notice({ kind: "guest_left", who: res.who });
    await this.push();
  }

  // ---- visits ----------------------------------------------------------------

  private async sendCat(to: string, msg: string, gift: GiftId): Promise<void> {
    const ready = await this.mutate((r) => {
      if (!r.friends[to]) return "not_friends" as const;
      if (r.cat.where !== "home") return "cat_busy" as const;
      if (!this.allowRate(r.rate.send, CAPS.sendsPerHour)) return "rate_limited" as const;
      r.cat = { where: "traveling", to };
      return { me: r.code, profile: r.profile, who: this.person(r, to) };
    });
    if (!ready) return;
    if (typeof ready === "string") return this.error(ready);
    await this.push(); // the cat starts walking off-screen right away

    const res = await this.call(to, (p) => p.hostGuest({ owner: ready.me, profile: ready.profile, msg, gift }));
    const now = this.env.now();
    const returnAt = now + this.env.stayMs;
    const arrived = await this.mutate((r) => {
      if (r.cat.where !== "traveling" || r.cat.to !== to) return false; // unfriended meanwhile
      r.cat = res === "ok" ? { where: "away", at: to, since: now, returnAt } : { where: "home" };
      return res === "ok";
    });
    if (arrived) {
      await this.env.setAlarm(returnAt);
    } else if (res !== "ok") {
      this.error(res === "full" ? "host_full" : res === "unreachable" ? "unreachable" : "not_friends", ready.who);
    }
  }

  async hostGuest(g: { owner: string; profile: Profile; msg: string; gift: GiftId }): Promise<HostResult> {
    const res = await this.mutate((r): HostResult => {
      if (!r.friends[g.owner]) return "not_friends";
      if (!r.guests[g.owner] && Object.keys(r.guests).length >= CAPS.guests) return "full";
      r.guests[g.owner] = { ...g, since: r.guests[g.owner]?.since ?? this.env.now() };
      return "ok";
    });
    if (!res) return "unknown";
    if (res === "ok") {
      this.notice({ kind: "guest_arrived", who: { code: g.owner, profile: g.profile } });
      await this.push();
    }
    return res;
  }

  /** Bring our cat home from wherever it is, and tell the host. */
  private async recall(reason: HomeReason): Promise<void> {
    const res = await this.mutate((r) => {
      if (r.cat.where === "traveling") return "busy" as const;
      if (r.cat.where !== "away") return null;
      const host = r.cat.at;
      r.cat = { where: "home" };
      return { host, me: r.code, who: this.person(r, host) };
    });
    if (res === "busy") return this.error("cat_busy");
    if (!res) return;
    await this.env.setAlarm(null);
    await this.call(res.host, (p) => p.removeGuest(res.me));
    this.notice({ kind: "cat_home", who: res.who, reason });
  }

  private async sendHome(owner: string): Promise<void> {
    const res = await this.mutate((r) => {
      const g = r.guests[owner];
      delete r.guests[owner];
      return g ? { me: r.code, who: { code: owner, profile: g.profile } } : null;
    });
    if (!res) return;
    this.notice({ kind: "guest_left", who: res.who });
    await this.call(owner, (p) => p.catReturned(res.me, "sent_home"));
  }

  async removeGuest(owner: string): Promise<void> {
    const g = await this.mutate((r) => {
      const guest = r.guests[owner];
      delete r.guests[owner];
      return guest;
    });
    if (g) {
      this.notice({ kind: "guest_left", who: { code: owner, profile: g.profile } });
      await this.push();
    }
  }

  async catReturned(host: string, reason: HomeReason): Promise<void> {
    const who = await this.mutate((r) => {
      const c = r.cat;
      if (!((c.where === "away" && c.at === host) || (c.where === "traveling" && c.to === host))) return null;
      r.cat = { where: "home" };
      return this.person(r, host);
    });
    if (!who) return;
    await this.env.setAlarm(null);
    this.notice({ kind: "cat_home", who, reason });
    await this.push();
  }

  async isCatWith(host: string): Promise<boolean> {
    const r = await this.env.load();
    const c = r?.cat;
    return !!c && ((c.where === "away" && c.at === host) || (c.where === "traveling" && c.to === host));
  }

  /** The visit timer ran out. */
  async alarm(): Promise<void> {
    const r = await this.env.load();
    if (!r || r.cat.where !== "away") return;
    if (this.env.now() < r.cat.returnAt - 1000) {
      await this.env.setAlarm(r.cat.returnAt);
      return;
    }
    await this.recall("timeout");
    await this.push();
  }

  // ---- account ---------------------------------------------------------------

  /** Leave: tell every friend (which brings cats home both ways), then erase everything. */
  private async deleteMe(): Promise<void> {
    const r = await this.env.load();
    if (!r) return;
    const others = new Set([...Object.keys(r.friends), ...Object.keys(r.guests), ...Object.keys(r.outgoing)]);
    if (r.cat.where === "away") others.add(r.cat.at);
    await Promise.allSettled([...others].map((c) => this.call(c, (p) => p.unfriended(r.code))));
    await this.env.setAlarm(null);
    await this.env.wipe();
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
