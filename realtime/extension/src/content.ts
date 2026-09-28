// Shows your cat (when it's home) and any visiting cats on every page, driven
// by the snapshot the background keeps in storage. When your cat is sent out
// it walks off the screen; when it comes back it walks in again.
import type { CatSnapshot } from "../../../src/core/brain";
import { COATS, DEFAULT_COAT, type Coat } from "../../../src/core/coats";
import { GIFTS } from "../../../src/core/visit";
import { idleSeconds, validIdle, validSettings, type IdleRecord, type Settings } from "../../../src/ext/state";
import { Bubble, CatActor, startLoop } from "../../../src/web/actor";
import { parseServerMsg, type Guest, type Notice, type Snapshot } from "../../shared/protocol";
import { ext, K } from "./api";
import { describeNotice } from "./text";

const coatOf = (id: string): Coat => COATS[id] ?? DEFAULT_COAT;
const MEET_COOLDOWN_MS = 60_000;
const SAVE_EVERY_S = 10;

/** Re-validate the stored snapshot the same way as a server frame. */
function snapshotFrom(raw: unknown): Snapshot | null {
  if (!raw) return null;
  const m = parseServerMsg(JSON.stringify({ t: "state", state: raw }));
  return m?.t === "state" ? m.state : null;
}

const catIsHome = (s: Snapshot | null) => !s || s.cat.where === "home";

interface GuestView {
  guest: Guest;
  actor: CatActor;
  leaving: boolean;
}

class Toast {
  readonly el: HTMLDivElement;
  private timer = 0;
  constructor(parent: Node) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "fixed", top: "16px", right: "16px", maxWidth: "min(320px, calc(100vw - 32px))",
      padding: "10px 14px", background: "#fffaf3", color: "#3b2b27", border: "2px solid #3b2b27",
      borderRadius: "14px", boxShadow: "0 6px 20px rgba(0,0,0,.18)", pointerEvents: "none",
      font: "500 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif", opacity: "0",
      transform: "translateY(-8px)", transition: "opacity .25s, transform .25s", overflowWrap: "anywhere",
    });
    parent.appendChild(this.el);
  }
  show(text: string): void {
    this.el.textContent = text;
    this.el.style.opacity = "1";
    this.el.style.transform = "translateY(0)";
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.style.opacity = "0";
      this.el.style.transform = "translateY(-8px)";
    }, 6000);
  }
}

async function main(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  if (w.__kittyNextDoorLive || window.top !== window || !(document.documentElement instanceof HTMLHtmlElement)) return;
  w.__kittyNextDoorLive = true;
  // Two cat extensions would mean two cats on every page; defer to the other one.
  const otherExtension = () => !!document.querySelector("kitty-next-door");
  if (otherExtension()) return;

  const host = document.createElement("kitty-next-door-live");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: layout style;";
  const root = host.attachShadow({ mode: "closed" });
  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });

  const keys = ["settings", "cat", "idle", K.state, K.seen, K.guestPos];
  const read = async () => {
    const r = await ext.storage.local.get(keys);
    return {
      settings: validSettings(r.settings),
      catPos: (r.cat ?? null) as Partial<CatSnapshot> | null,
      idle: validIdle(r.idle),
      state: snapshotFrom(r[K.state]),
      seen: (r[K.seen] && typeof r[K.seen] === "object" ? r[K.seen] : {}) as Record<string, number>,
      guestPos: (r[K.guestPos] && typeof r[K.guestPos] === "object" ? r[K.guestPos] : {}) as Record<string, Partial<CatSnapshot>>,
    };
  };

  let stored = await read();
  let settings: Settings = stored.settings;
  let idle: IdleRecord = stored.idle;
  let state: Snapshot | null = stored.state;
  let cursor: { x: number; y: number } | null = null;
  let own: CatActor | null = null;
  let ownLeaving = false;
  /** Was the cat home at the last sync? A cat coming back walks in instead of appearing. */
  let wasHome = catIsHome(state);
  const guests = new Map<string, GuestView>();
  let lastMeet = 0;
  let sinceSave = 0;
  const bubble = new Bubble(root);
  const toast = new Toast(root);

  const hiddenHere = () => !settings.enabled || settings.disabledSites.includes(location.hostname);

  function greet(g: Guest): void {
    bubble.show([
      `${GIFTS[g.gift]} ${g.profile.cat} is visiting you!`,
      g.msg ? `“${g.msg}”` : "",
      g.profile.owner ? `— from ${g.profile.owner}` : "",
    ], 9000);
  }

  function removeAll(): void {
    own?.destroy();
    own = null;
    for (const v of guests.values()) v.actor.destroy();
    guests.clear();
  }

  /** Bring the cats on this page in line with the latest snapshot. */
  function sync(): void {
    if (hiddenHere() || otherExtension()) {
      removeAll();
      host.style.display = "none";
      return;
    }
    host.style.display = "";
    const width = innerWidth;
    const groundY = innerHeight;

    // Your cat.
    const home = catIsHome(state);
    if (home) {
      if (!own) {
        own = new CatActor(root, coatOf(settings.coat), { x: width * 0.7, groundY });
        ownLeaving = false;
        if (!wasHome) own.brain.enterFrom(Math.random() < 0.5 ? -1 : 1, width);
        else if (stored.catPos) own.brain.restore(stored.catPos, width);
      } else if (ownLeaving) {
        // Came back before it finished leaving: turn around.
        own.destroy();
        own = new CatActor(root, coatOf(settings.coat), { x: width * 0.7, groundY });
        own.brain.enterFrom(Math.random() < 0.5 ? -1 : 1, width);
        ownLeaving = false;
      }
      own.coat = coatOf(settings.coat);
    } else if (own && !ownLeaving) {
      own.brain.leave();
      ownLeaving = true;
    }
    wasHome = home;

    // Visitors.
    const now = new Set(state?.guests.map((g) => g.owner) ?? []);
    for (const g of state?.guests ?? []) {
      const view = guests.get(g.owner);
      if (view) {
        view.guest = g;
        view.actor.coat = coatOf(g.profile.coat);
        continue;
      }
      const actor = new CatActor(root, coatOf(g.profile.coat), { x: width * 0.3, groundY });
      actor.canvas.addEventListener("click", () => greet(g));
      guests.set(g.owner, { guest: g, actor, leaving: false });
      const pos = stored.guestPos[g.owner];
      if (stored.seen[g.owner] === g.since) {
        if (pos) actor.brain.restore(pos, width);
      } else {
        // A new arrival walks in from the nearer edge to say hello to your cat.
        const target = own && !ownLeaving ? own.brain.x : width / 2;
        const side = target > width / 2 ? 1 : -1;
        actor.brain.enterFrom(side, width, target + side * 95);
        own?.brain.waitFor(side > 0 ? width : 0, 14);
        lastMeet = 0;
        greet(g);
        stored.seen[g.owner] = g.since;
        ext.storage.local.set({ [K.seen]: stored.seen });
      }
    }
    for (const [owner, view] of guests) {
      if (!now.has(owner) && !view.leaving) {
        view.actor.brain.leave();
        view.leaving = true;
      }
    }
  }

  function save(): void {
    if (document.hidden) return;
    const items: Record<string, unknown> = {};
    if (own && !ownLeaving) items.cat = own.brain.snapshot();
    const pos: Record<string, Partial<CatSnapshot>> = {};
    for (const [owner, v] of guests) if (!v.leaving) pos[owner] = v.actor.brain.snapshot();
    items[K.guestPos] = pos;
    ext.storage.local.set(items);
  }

  function tick(dt: number): number {
    if (hiddenHere()) return 4;
    const base = { cursor, width: innerWidth, groundY: innerHeight, idleSeconds: idleSeconds(idle), hour: new Date().getHours() };
    let fps = 4;

    if (own) {
      own.brain.update(dt, { ...base, hovering: own.hovering });
      if (ownLeaving && own.brain.gone) {
        own.destroy();
        own = null;
        ownLeaving = false;
      } else {
        own.render();
        own.updateHover(cursor);
        fps = Math.max(fps, own.brain.fps);
      }
    }

    let speaker: CatActor | null = own && !ownLeaving ? own : null;
    for (const [owner, v] of guests) {
      v.actor.brain.update(dt, { ...base, hovering: v.actor.hovering });
      if (v.leaving && v.actor.brain.gone) {
        v.actor.destroy();
        guests.delete(owner);
        continue;
      }
      v.actor.render();
      v.actor.updateHover(cursor);
      fps = Math.max(fps, v.actor.brain.fps);
      if (!v.leaving) {
        speaker = v.actor;
        if (own && !ownLeaving && own.brain.settled && v.actor.brain.settled
            && Math.abs(own.brain.x - v.actor.brain.x) < 110 && Date.now() - lastMeet > MEET_COOLDOWN_MS) {
          lastMeet = Date.now();
          own.brain.meet(v.actor.brain.x);
          v.actor.brain.meet(own.brain.x);
        }
      }
    }
    if (speaker) bubble.follow(speaker.headTop.x, speaker.headTop.y);

    sinceSave += dt;
    if (sinceSave > SAVE_EVERY_S) {
      sinceSave = 0;
      save();
    }
    return fps;
  }

  window.addEventListener("mousemove", (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    own?.updateHover(cursor);
    for (const v of guests.values()) v.actor.updateHover(cursor);
  }, { capture: true, passive: true });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return save();
    stored = await read();
    settings = stored.settings;
    idle = stored.idle;
    state = stored.state;
    if (own && !ownLeaving && stored.catPos) own.brain.restore(stored.catPos, innerWidth);
    for (const [owner, v] of guests) {
      const pos = stored.guestPos[owner];
      if (pos && !v.leaving) v.actor.brain.restore(pos, innerWidth);
    }
    sync();
  });
  window.addEventListener("pagehide", save);

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) settings = validSettings(changes.settings.newValue);
    if (changes.idle) idle = validIdle(changes.idle.newValue);
    if (changes[K.state]) state = snapshotFrom(changes[K.state].newValue);
    if (changes.settings || changes[K.state]) sync();
    const n = changes[K.notice]?.newValue as { notice?: Notice } | undefined;
    if (n?.notice && !document.hidden && !hiddenHere()) {
      const text = describeNotice(n.notice, state);
      // Arrivals already get a speech bubble.
      if (text && n.notice.kind !== "guest_arrived") toast.show(text);
    }
  });

  sync();
  // The other extension might inject a moment later.
  setTimeout(sync, 800);
  startLoop(tick);

  const hooks = globalThis as unknown as { __KITTY_TEST__?: boolean; __kittyLiveTest?: unknown };
  if (hooks.__KITTY_TEST__) {
    hooks.__kittyLiveTest = {
      state: () => ({
        own: own && { activity: own.brain.activity, x: Math.round(own.brain.x), leaving: ownLeaving },
        guests: [...guests.values()].map((v) => ({ owner: v.guest.owner, activity: v.actor.brain.activity, x: Math.round(v.actor.brain.x), leaving: v.leaving })),
        bubble: bubble.el.style.opacity === "1" ? bubble.el.textContent : "",
        toast: toast.el.style.opacity === "1" ? toast.el.textContent : "",
      }),
    };
  }
}

main().catch(() => { /* never break the page */ });
