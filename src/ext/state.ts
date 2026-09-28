// Everything the extension keeps in storage.local, validated on every read:
// storage is shared by all tabs and should never be trusted blindly.
import type { CatSnapshot } from "../core/brain";
import { COATS } from "../core/coats";
import { cleanText, LIMITS, sanitizeVisit, type Visit } from "../core/visit";
import { ext } from "./api";

export interface Settings {
  enabled: boolean;
  coat: string;
  name: string;
  /** Hostnames where the cat stays hidden. */
  disabledSites: string[];
}

export interface GuestRecord {
  visit: Visit;
  arrivedAt: number;
  expiresAt: number;
  /** Whether the guest has already said hello (shown once, on arrival). */
  greeted: boolean;
}

export interface IdleRecord {
  state: "active" | "idle" | "locked";
  since: number;
}

export interface Stored {
  settings: Settings;
  cat: Partial<CatSnapshot> | null;
  guest: GuestRecord | null;
  guestCat: Partial<CatSnapshot> | null;
  idle: IdleRecord;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, coat: "ginger", name: "Mochi", disabledSites: [] };

export function validSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    coat: typeof r.coat === "string" && Object.hasOwn(COATS, r.coat) ? r.coat : DEFAULT_SETTINGS.coat,
    name: cleanText(r.name, LIMITS.name) || DEFAULT_SETTINGS.name,
    disabledSites: Array.isArray(r.disabledSites)
      ? r.disabledSites.filter((s): s is string => typeof s === "string" && s.length < 256).slice(0, 500)
      : [],
  };
}

export function validGuest(raw: unknown): GuestRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const visit = sanitizeVisit(r.visit);
  if (!visit || typeof r.arrivedAt !== "number" || typeof r.expiresAt !== "number") return null;
  return { visit, arrivedAt: r.arrivedAt, expiresAt: r.expiresAt, greeted: r.greeted === true };
}

function validSnapshot(raw: unknown): Partial<CatSnapshot> | null {
  return raw && typeof raw === "object" ? (raw as Partial<CatSnapshot>) : null;
}

function validIdle(raw: unknown): IdleRecord {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const state = r.state === "idle" || r.state === "locked" ? r.state : "active";
  return { state, since: typeof r.since === "number" ? r.since : Date.now() };
}

export async function loadStored(): Promise<Stored> {
  const r = await ext.storage.local.get(["settings", "cat", "guest", "guestCat", "idle"]);
  return {
    settings: validSettings(r.settings),
    cat: validSnapshot(r.cat),
    guest: validGuest(r.guest),
    guestCat: validSnapshot(r.guestCat),
    idle: validIdle(r.idle),
  };
}

/** The browser reports idle after 60s; add that back to get "seconds without input". */
export const IDLE_DETECTION_S = 60;

export function idleSeconds(idle: IdleRecord, now = Date.now()): number {
  return idle.state === "active" ? 0 : IDLE_DETECTION_S + (now - idle.since) / 1000;
}

export { validIdle };
