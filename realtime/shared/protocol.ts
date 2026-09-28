// Messages between the extension and the server. Both sides validate every
// message with the functions below: anything malformed is dropped.
import { COATS } from "../../src/core/coats";
import { cleanText, GIFTS, LIMITS, type GiftId } from "../../src/core/visit";

/** Crockford base32 (no I, L, O, U), 8 characters, e.g. "7K2F9QXM". */
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** 32 random bytes, base64url. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const MAX_FRAME = 2048;

export const CAPS = {
  friends: 50,
  pending: 20,
  guests: 3,
  /** Per rolling hour. */
  friendRequestsPerHour: 10,
  sendsPerHour: 20,
} as const;

/** Normalize user-typed codes: case, dashes/spaces, and look-alike letters. */
export function normCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return CODE_RE.test(s) ? s : null;
}

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export interface Profile {
  /** The cat's name. */
  cat: string;
  coat: string;
  /** The person's display name (optional). */
  owner: string;
}

export function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cat = cleanText(r.cat, LIMITS.name);
  const coat = typeof r.coat === "string" && Object.hasOwn(COATS, r.coat) ? r.coat : null;
  if (!cat || !coat) return null;
  return { cat, coat, owner: cleanText(r.owner, LIMITS.from) };
}

const giftOf = (g: unknown): GiftId => (typeof g === "string" && Object.hasOwn(GIFTS, g) ? (g as GiftId) : "fish");

// ---- client -> server --------------------------------------------------------

export type ClientMsg =
  | { t: "hello"; token: string; profile: Profile }
  | { t: "profile"; profile: Profile }
  | { t: "friend_request"; code: string }
  | { t: "friend_respond"; code: string; accept: boolean }
  | { t: "unfriend"; code: string }
  | { t: "send_cat"; to: string; msg: string; gift: GiftId }
  | { t: "recall" }
  | { t: "send_home"; owner: string }
  | { t: "delete_me" };

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_FRAME) return null;
  let m: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    m = v;
  } catch {
    return null;
  }
  switch (m.t) {
    case "hello": {
      const profile = sanitizeProfile(m.profile);
      return typeof m.token === "string" && TOKEN_RE.test(m.token) && profile ? { t: "hello", token: m.token, profile } : null;
    }
    case "profile": {
      const profile = sanitizeProfile(m.profile);
      return profile ? { t: "profile", profile } : null;
    }
    case "friend_request":
    case "unfriend": {
      const code = normCode(m.code);
      return code ? { t: m.t, code } : null;
    }
    case "friend_respond": {
      const code = normCode(m.code);
      return code && typeof m.accept === "boolean" ? { t: "friend_respond", code, accept: m.accept } : null;
    }
    case "send_cat": {
      const to = normCode(m.to);
      return to ? { t: "send_cat", to, msg: cleanText(m.msg, LIMITS.msg), gift: giftOf(m.gift) } : null;
    }
    case "send_home": {
      const owner = normCode(m.owner);
      return owner ? { t: "send_home", owner } : null;
    }
    case "recall":
    case "delete_me":
      return { t: m.t };
    default:
      return null;
  }
}

// ---- server -> client --------------------------------------------------------

export interface Person {
  code: string;
  profile: Profile | null;
}

export interface Guest {
  owner: string;
  profile: Profile;
  msg: string;
  gift: GiftId;
  since: number;
}

export type CatWhere =
  | { where: "home" }
  | { where: "traveling"; to: string }
  | { where: "away"; at: string; since: number; returnAt: number };

export interface Snapshot {
  me: { code: string; profile: Profile };
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  cat: CatWhere;
  guests: Guest[];
}

export type NoticeKind =
  | "friend_request" | "friend_added" | "guest_arrived" | "guest_left" | "cat_home" | "error";

export type HomeReason = "recalled" | "sent_home" | "timeout" | "unfriended" | "host_left";

export type ErrorCode =
  | "bad_message" | "not_authed" | "bad_token" | "no_such_cat" | "self" | "not_friends" | "already_friends"
  | "too_many_friends" | "too_many_pending" | "rate_limited" | "cat_busy" | "host_full" | "unreachable";

export interface Notice {
  kind: NoticeKind;
  /** Who it's about, if anyone. */
  who?: Person;
  reason?: HomeReason;
  error?: ErrorCode;
}

export type ServerMsg = { t: "state"; state: Snapshot } | { t: "notice"; notice: Notice };

function sanitizePerson(raw: unknown): Person | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const code = normCode(r.code);
  return code ? { code, profile: sanitizeProfile(r.profile) } : null;
}

const people = (raw: unknown, max: number): Person[] =>
  Array.isArray(raw) ? raw.slice(0, max).map(sanitizePerson).filter((p): p is Person => !!p) : [];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function sanitizeCat(raw: unknown): CatWhere {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.where === "away") {
    const at = normCode(r.at);
    if (at) return { where: "away", at, since: num(r.since), returnAt: num(r.returnAt) };
  }
  if (r.where === "traveling") {
    const to = normCode(r.to);
    if (to) return { where: "traveling", to };
  }
  return { where: "home" };
}

function sanitizeGuest(raw: unknown): Guest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const owner = normCode(r.owner);
  const profile = sanitizeProfile(r.profile);
  if (!owner || !profile) return null;
  return { owner, profile, msg: cleanText(r.msg, LIMITS.msg), gift: giftOf(r.gift), since: num(r.since) };
}

const ERRORS: ErrorCode[] = [
  "bad_message", "not_authed", "bad_token", "no_such_cat", "self", "not_friends", "already_friends",
  "too_many_friends", "too_many_pending", "rate_limited", "cat_busy", "host_full", "unreachable",
];
const KINDS: NoticeKind[] = ["friend_request", "friend_added", "guest_arrived", "guest_left", "cat_home", "error"];
const REASONS: HomeReason[] = ["recalled", "sent_home", "timeout", "unfriended", "host_left"];

/** Client-side validation of whatever the server sent. */
export function parseServerMsg(raw: unknown): ServerMsg | null {
  if (typeof raw !== "string" || raw.length > 256 * 1024) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
    if (!m || typeof m !== "object") return null;
  } catch {
    return null;
  }
  if (m.t === "state" && m.state && typeof m.state === "object") {
    const s = m.state as Record<string, unknown>;
    const me = s.me as Record<string, unknown> | undefined;
    const code = normCode(me?.code);
    const profile = sanitizeProfile(me?.profile);
    if (!code || !profile) return null;
    return {
      t: "state",
      state: {
        me: { code, profile },
        friends: people(s.friends, CAPS.friends),
        incoming: people(s.incoming, CAPS.pending),
        outgoing: people(s.outgoing, CAPS.pending),
        cat: sanitizeCat(s.cat),
        guests: Array.isArray(s.guests)
          ? s.guests.slice(0, CAPS.guests).map(sanitizeGuest).filter((g): g is Guest => !!g) : [],
      },
    };
  }
  if (m.t === "notice" && m.notice && typeof m.notice === "object") {
    const n = m.notice as Record<string, unknown>;
    if (!KINDS.includes(n.kind as NoticeKind)) return null;
    const notice: Notice = { kind: n.kind as NoticeKind };
    const who = sanitizePerson(n.who);
    if (who) notice.who = who;
    if (REASONS.includes(n.reason as HomeReason)) notice.reason = n.reason as HomeReason;
    if (ERRORS.includes(n.error as ErrorCode)) notice.error = n.error as ErrorCode;
    return { t: "notice", notice };
  }
  return null;
}
