// The public park's logic, independent of Cloudflare so it can be tested in
// Node. Owners' records stay the source of truth: the park only mirrors who is
// here, and tidies up if an owner no longer thinks their cat is in the park.
import { COATS } from "../../../src/core/coats";
import { CAPS, type ParkCat, type ParkMsg, type Profile } from "../../shared/protocol";

export interface ParkEntry {
  owner: string;
  cat: string;
  coat: string;
  since: number;
}

export interface ParkState {
  cats: Record<string, ParkEntry>;
  byOwner: Record<string, string>;
  blocked: string[];
  crown: string | null;
  crownedAt: number;
}

export interface ParkOwner {
  isInPark(parkId: string): Promise<boolean>;
  crowned(): Promise<void>;
}

export interface ParkEnv {
  load(): Promise<ParkState | undefined>;
  save(s: ParkState): Promise<void>;
  /** Broadcast to everyone watching the park. */
  send(msg: ParkMsg): void;
  owner(code: string): ParkOwner;
  setAlarm(at: number | null): Promise<void>;
  randomId(): string;
  now(): number;
}

const TIDY_EVERY_MS = 10 * 60_000;
const CROWN_EVERY_MS = 60 * 60_000;

// A small, imperfect filter: names are shown to anyone who opens the park.
const BLOCKED_WORDS = [
  "fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "porn", "sex", "nazi", "hitler", "rape",
  "nigg", "fag", "whore", "slut", "bastard", "asshole", "retard", "kkk", "penis", "vagina",
];

function normalizeForFilter(s: string): string {
  return s.toLowerCase()
    .replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s").replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

/** The name shown in the park: the cat's name, unless it trips the filter. */
export function parkName(profile: Profile): string {
  const n = normalizeForFilter(profile.cat);
  if (BLOCKED_WORDS.some((w) => n.includes(w))) return `${COATS[profile.coat]?.name ?? "A"} cat`;
  return profile.cat;
}

const empty = (): ParkState => ({ cats: {}, byOwner: {}, blocked: [], crown: null, crownedAt: 0 });
const view = (id: string, e: ParkEntry): ParkCat => ({ id, cat: e.cat, coat: e.coat, since: e.since });

export class ParkCore {
  constructor(private readonly env: ParkEnv) {}

  private async state(): Promise<ParkState> {
    return (await this.env.load()) ?? empty();
  }

  async snapshot(): Promise<ParkMsg> {
    const s = await this.state();
    return { t: "park", cats: Object.entries(s.cats).map(([id, e]) => view(id, e)), crown: s.crown };
  }

  async join(owner: string, profile: Profile): Promise<{ id: string } | "full" | "blocked"> {
    const s = await this.state();
    if (s.blocked.includes(owner)) return "blocked";
    const previous = s.byOwner[owner];
    if (previous) this.drop(s, previous);
    if (Object.keys(s.cats).length >= CAPS.parkCats) {
      await this.env.save(s);
      return "full";
    }
    const id = this.env.randomId();
    const entry: ParkEntry = { owner, cat: parkName(profile), coat: profile.coat, since: this.env.now() };
    s.cats[id] = entry;
    s.byOwner[owner] = id;
    const crownNow = !s.crown;
    if (crownNow) {
      s.crown = id;
      s.crownedAt = this.env.now();
    }
    await this.env.save(s);
    this.env.send({ t: "join", cat: view(id, entry) });
    if (crownNow) {
      this.env.send({ t: "crown", id });
      await this.env.owner(owner).crowned().catch(() => {});
    }
    await this.env.setAlarm(this.env.now() + TIDY_EVERY_MS);
    return { id };
  }

  /** Remove without saving; the caller saves. */
  private drop(s: ParkState, id: string): void {
    const e = s.cats[id];
    if (!e) return;
    delete s.cats[id];
    if (s.byOwner[e.owner] === id) delete s.byOwner[e.owner];
    this.env.send({ t: "leave", id });
    if (s.crown === id) {
      s.crown = null;
      this.env.send({ t: "crown", id: null });
    }
  }

  async leave(id: string): Promise<void> {
    const s = await this.state();
    if (!s.cats[id]) return;
    this.drop(s, id);
    await this.env.save(s);
  }

  /** Every 10 minutes while anyone is here: drop ghosts, rotate the crown hourly. */
  async alarm(): Promise<void> {
    const s = await this.state();
    for (const [id, e] of Object.entries(s.cats)) {
      let here = true;
      try { here = await this.env.owner(e.owner).isInPark(id); } catch { /* keep on errors */ }
      if (!here) this.drop(s, id);
    }
    const ids = Object.keys(s.cats);
    let newCrown: string | null = null;
    if (ids.length && (!s.crown || !s.cats[s.crown] || this.env.now() - s.crownedAt >= CROWN_EVERY_MS)) {
      newCrown = ids[Math.floor(Math.random() * ids.length)];
      s.crown = newCrown;
      s.crownedAt = this.env.now();
    }
    await this.env.save(s);
    if (newCrown) {
      this.env.send({ t: "crown", id: newCrown });
      await this.env.owner(s.cats[newCrown].owner).crowned().catch(() => {});
    }
    await this.env.setAlarm(ids.length ? this.env.now() + TIDY_EVERY_MS : null);
  }

  // ---- moderation (behind the STATS_KEY secret) ----

  async adminList(): Promise<{ id: string; cat: string; coat: string; since: number }[]> {
    const s = await this.state();
    return Object.entries(s.cats).map(([id, e]) => view(id, e));
  }

  async kick(id: string, block: boolean): Promise<boolean> {
    const s = await this.state();
    const e = s.cats[id];
    if (!e) return false;
    if (block && !s.blocked.includes(e.owner)) s.blocked.push(e.owner);
    this.drop(s, id);
    await this.env.save(s);
    return true;
  }
}
