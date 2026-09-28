// Visit links carry a cat to a friend's screen. The whole visit lives in the
// URL fragment (never sent to any server), so anyone can craft one: treat
// every field as hostile, and only ever render it as plain text.
import { COATS } from "./coats";

export const GIFTS = {
  fish: "🐟",
  yarn: "🧶",
  flower: "🌸",
  mouse: "🐭",
} as const;
export type GiftId = keyof typeof GIFTS;

export interface Visit {
  v: 1;
  /** The visiting cat's name. */
  name: string;
  coat: string;
  /** Who sent it. */
  from: string;
  msg: string;
  gift: GiftId;
}

export const LIMITS = { name: 24, from: 24, msg: 80, fragment: 1024 } as const;

// Control characters, zero-width characters and bidi overrides can disguise
// text, so strip them (as code point ranges).
const UNSAFE_RANGES: [number, number][] = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff],
];
const isUnsafe = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return UNSAFE_RANGES.some(([a, b]) => cp >= a && cp <= b);
};

/** Trim, strip unsafe characters, collapse whitespace, cap by code points. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  const chars = Array.from(input.replace(/\s+/g, " ")).filter((c) => !isUnsafe(c));
  return Array.from(chars.join("").trim()).slice(0, max).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Normalize a draft into a valid visit, or null if it can't be one. */
export function sanitizeVisit(raw: unknown): Visit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const name = cleanText(r.name, LIMITS.name);
  if (!name) return null;
  const coat = typeof r.coat === "string" && Object.hasOwn(COATS, r.coat) ? r.coat : null;
  if (!coat) return null;
  const gift = typeof r.gift === "string" && Object.hasOwn(GIFTS, r.gift) ? (r.gift as GiftId) : "fish";
  return {
    v: 1,
    name,
    coat,
    from: cleanText(r.from, LIMITS.from),
    msg: cleanText(r.msg, LIMITS.msg),
    gift,
  };
}

export function encodeVisit(visit: Visit): string {
  const clean = sanitizeVisit(visit);
  if (!clean) throw new Error("invalid visit");
  return toBase64Url(new TextEncoder().encode(JSON.stringify(clean)));
}

/** Parse a URL fragment like "#visit=…". Returns null for anything malformed. */
export function parseVisitFragment(hash: string): Visit | null {
  if (typeof hash !== "string" || hash.length > LIMITS.fragment) return null;
  const m = /^#?visit=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  const bytes = fromBase64Url(m[1]);
  if (!bytes) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return null;
  }
  return sanitizeVisit(json);
}

export function visitUrl(base: string, visit: Visit): string {
  return `${base.split("#")[0]}#visit=${encodeVisit(visit)}`;
}
