// Holds the one WebSocket to the server for this browser. Everything else
// (content scripts, popup) talks to it through storage and runtime messages.
import { cleanText, LIMITS } from "../../../src/core/visit";
import { validSettings } from "../../../src/ext/state";
import { parseClientMsg, parseServerMsg, TOKEN_RE, CODE_RE, type Profile } from "../../shared/protocol";
import { ext, K, SERVER, type Conn } from "./api";

const IDLE_S = 60;
const KEEPALIVE_MS = 20_000;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let ws: WebSocket | null = null;
let ready = false; // signed in and received the first snapshot
let queue: string[] = [];
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wantOnline = true;
let everConnected = false;

interface Identity { code: string; token: string }

function randomCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => ALPHABET[x % 32]).join("");
}
function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function identity(fresh = false): Promise<Identity> {
  const r = await ext.storage.local.get(K.identity);
  const id = r[K.identity] as Partial<Identity> | undefined;
  if (!fresh && id && typeof id.code === "string" && CODE_RE.test(id.code) && typeof id.token === "string" && TOKEN_RE.test(id.token)) {
    return id as Identity;
  }
  const created = { code: randomCode(), token: randomToken() };
  await ext.storage.local.set({ [K.identity]: created });
  return created;
}

async function profile(): Promise<Profile> {
  const r = await ext.storage.local.get(["settings", K.owner]);
  const s = validSettings(r.settings);
  return { cat: s.name, coat: s.coat, owner: cleanText(r[K.owner], LIMITS.from) };
}

const setConn = (c: Conn) => ext.storage.local.set({ [K.conn]: c });

async function connect(): Promise<void> {
  if (!wantOnline || (ws && ws.readyState <= WebSocket.OPEN)) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  // After "Delete my account", never quietly register a new one.
  if ((await ext.storage.local.get(K.deleted))[K.deleted]) {
    wantOnline = false;
    await setConn("offline");
    return;
  }
  const id = await identity();
  ready = false;
  setConn("connecting");
  const sock = new WebSocket(`${SERVER}/v1/connect/${id.code}`);
  ws = sock;

  sock.onopen = async () => {
    sock.send(JSON.stringify({ t: "hello", token: id.token, profile: await profile() }));
  };
  sock.onmessage = async (e) => {
    if (e.data === "pong") return;
    const m = parseServerMsg(e.data);
    if (!m) return;
    if (m.t === "state") {
      await ext.storage.local.set({ [K.state]: m.state, [K.conn]: "online", [K.error]: null });
      if (!ready) {
        ready = true;
        everConnected = true;
        backoff = 1000;
        const pending = queue;
        queue = [];
        pending.forEach((f) => sock.send(f));
      }
      return;
    }
    if (m.notice.kind === "error" && m.notice.error === "bad_token") {
      // Someone else already owns this code. On a brand-new install, just pick another.
      if (!everConnected) {
        await identity(true);
      } else {
        await ext.storage.local.set({ [K.error]: "bad_token" });
        wantOnline = false;
      }
      return;
    }
    await ext.storage.local.set({ [K.notice]: { notice: m.notice, id: `${Date.now()}-${Math.random()}` } });
  };
  sock.onclose = async (e) => {
    if (ws === sock) ws = null;
    ready = false;
    if (e.code === 4002) {
      // Account deleted: forget everything tied to it, and stay offline.
      wantOnline = false;
      await ext.storage.local.remove([K.identity, K.state, K.seen, K.guestPos]);
      await ext.storage.local.set({ [K.deleted]: true });
    }
    await setConn("offline");
    if (wantOnline) {
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  };
  sock.onerror = () => { /* onclose follows */ };
}

function sendAction(action: unknown): void {
  const frame = JSON.stringify(action);
  const m = parseClientMsg(frame);
  if (!m || m.t === "hello") return;
  if (ws && ready && ws.readyState === WebSocket.OPEN) ws.send(frame);
  else {
    if (queue.length < 20) queue.push(frame);
    wantOnline = true;
    connect();
  }
}

// Actions from the popup and content scripts.
ext.runtime.onMessage.addListener(async (msg) => {
  const m = msg as { rt?: unknown; reconnect?: boolean; startFresh?: boolean } | null;
  if (m?.startFresh) await ext.storage.local.remove(K.deleted);
  if (m?.rt) sendAction(m.rt);
  if (m?.reconnect || m?.startFresh) { wantOnline = true; backoff = 1000; connect(); }
});

// Profile edits go straight to the server.
ext.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !(changes.settings || changes[K.owner])) return;
  sendAction({ t: "profile", profile: await profile() });
});

// Stay connected while you're at the computer; drop the connection when idle or locked
// (arrivals wait on the server and show up when you're back).
ext.idle?.setDetectionInterval(IDLE_S);
ext.idle?.onStateChanged.addListener((state) => {
  ext.storage.local.set({ idle: { state, since: Date.now() } });
  wantOnline = state === "active";
  if (wantOnline) { backoff = 1000; connect(); }
  else ws?.close(1000, "idle");
});

// Keepalive: Chrome counts WebSocket traffic as activity; Firefox needs an API call.
setInterval(() => {
  if (!wantOnline) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
  ext.runtime.getPlatformInfo?.().catch(() => {});
}, KEEPALIVE_MS);

// If the browser unloaded the background anyway, this wakes it to reconnect.
ext.alarms?.create("rt-wake", { periodInMinutes: 1 });
ext.alarms?.onAlarm.addListener(() => { if (wantOnline) connect(); });

connect();
