// The WebExtension APIs the live extension uses (promise-based in Chrome MV3
// and Firefox).
type Changes = Record<string, { newValue?: unknown; oldValue?: unknown }>;
type Listener<A extends unknown[]> = { addListener(cb: (...args: A) => void): void };

export interface LiveApi {
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: Listener<[Changes, string]>;
  };
  idle?: { setDetectionInterval(s: number): void; queryState(s: number): Promise<string>; onStateChanged: Listener<[string]> };
  alarms?: { create(name: string, info: { periodInMinutes: number }): void; onAlarm: Listener<[{ name: string }]> };
  runtime: {
    sendMessage(msg: unknown): Promise<unknown>;
    onMessage: Listener<[unknown, unknown, (r?: unknown) => void]>;
    getPlatformInfo?(): Promise<unknown>;
  };
  tabs?: { query(q: object): Promise<{ url?: string }[]> };
  permissions?: {
    contains(p: { origins: string[] }): Promise<boolean>;
    request(p: { origins: string[] }): Promise<boolean>;
  };
}

const g = globalThis as unknown as { browser?: LiveApi; chrome?: LiveApi };
export const ext: LiveApi = (g.browser ?? g.chrome)!;

declare const __SERVER__: string;
/** Server base URL, injected at build time (KITTY_SERVER). */
export const SERVER: string = typeof __SERVER__ === "string" ? __SERVER__ : "ws://127.0.0.1:8787";

/** Storage keys used only by the live extension. */
export const K = {
  identity: "rt_identity",
  state: "rt_state",
  conn: "rt_conn",
  notice: "rt_notice",
  owner: "rt_owner",
  seen: "rt_seen",
  guestPos: "rt_guest_pos",
  error: "rt_fatal",
  /** Set after "Delete my account"; the extension stays offline until you start fresh. */
  deleted: "rt_deleted",
} as const;

export type Conn = "online" | "connecting" | "offline";
