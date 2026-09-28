// Runs on every page: your cat (and a visiting guest, if any) lives in a
// closed shadow root on top of the page. Only the cats' own pixels catch the
// mouse, so the page underneath stays fully usable.
import { COATS, DEFAULT_COAT, type Coat } from "../core/coats";
import { GUEST_STAY_MS, VISIT_BASE } from "../core/config";
import { GIFTS, parseVisitFragment, type Visit } from "../core/visit";
import { Bubble, CatActor, startLoop } from "../web/actor";
import { ext } from "./api";
import {
  idleSeconds, loadStored, validGuest, validIdle, validSettings,
  type GuestRecord, type IdleRecord, type Settings, type Stored,
} from "./state";

const coatOf = (id: string): Coat => COATS[id] ?? DEFAULT_COAT;
const MEET_COOLDOWN_MS = 60_000;
const SAVE_EVERY_S = 10;

async function main(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  if (w.__kittyNextDoor || window.top !== window || !(document.documentElement instanceof HTMLHtmlElement)) return;
  w.__kittyNextDoor = true;

  const host = document.createElement("kitty-next-door");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: layout style;";
  const root = host.attachShadow({ mode: "closed" });
  // Attach to <html>, not <body>: single-page apps often replace the body.
  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });

  let stored: Stored = await loadStored();
  let settings: Settings = stored.settings;
  let idle: IdleRecord = stored.idle;
  let guestRecord: GuestRecord | null = stored.guest;
  let cursor: { x: number; y: number } | null = null;
  let own: CatActor | null = null;
  let guest: CatActor | null = null;
  let guestLeaving = false;
  let lastMeet = 0;
  let sinceSave = 0;
  const bubble = new Bubble(root);

  const hiddenHere = () => !settings.enabled || settings.disabledSites.includes(location.hostname);

  function greet(visit: Visit): void {
    bubble.show([
      `${GIFTS[visit.gift]} ${visit.name} is visiting you!`,
      visit.msg ? `“${visit.msg}”` : "",
      visit.from ? `— from ${visit.from}` : "",
    ], 9000);
  }

  function ensureCats(): void {
    if (hiddenHere()) {
      own?.destroy();
      guest?.destroy();
      own = guest = null;
      host.style.display = "none";
      return;
    }
    host.style.display = "";
    const width = innerWidth;
    const groundY = innerHeight;
    if (!own) {
      own = new CatActor(root, coatOf(settings.coat), { x: width * 0.7, groundY });
      if (stored.cat) own.brain.restore(stored.cat, width);
    } else {
      own.coat = coatOf(settings.coat);
    }
    if (guestRecord && !guest) {
      const rec = guestRecord;
      guest = new CatActor(root, coatOf(rec.visit.coat), { x: width * 0.3, groundY });
      guest.canvas.addEventListener("click", () => greet(rec.visit));
      guestLeaving = false;
      if (stored.guestCat) {
        guest.brain.restore(stored.guestCat, width);
      } else {
        // A fresh arrival walks straight over to say hello to your cat.
        // Enter from the nearer edge and stop just beside your cat.
        const side = own.brain.x > width / 2 ? 1 : -1;
        guest.brain.enterFrom(side, width, own.brain.x + side * 95);
        own.brain.waitFor(side > 0 ? width : 0, 14);
        lastMeet = 0;
      }
      if (!rec.greeted) {
        greet(rec.visit);
        rec.greeted = true;
        ext.storage.local.set({ guest: rec });
      }
    }
    if (!guestRecord && guest) {
      guest.destroy();
      guest = null;
    }
  }

  function save(): void {
    if (document.hidden) return;
    const items: Record<string, unknown> = {};
    if (own) items.cat = own.brain.snapshot();
    if (guest && !guest.brain.gone) items.guestCat = guest.brain.snapshot();
    if (Object.keys(items).length) ext.storage.local.set(items);
  }

  function tick(dt: number): number {
    if (hiddenHere() || !own) return 4;
    const base = { cursor, width: innerWidth, groundY: innerHeight, idleSeconds: idleSeconds(idle), hour: new Date().getHours() };
    own.brain.update(dt, { ...base, hovering: own.hovering });

    if (guest && guestRecord) {
      guest.brain.update(dt, { ...base, hovering: guest.hovering });
      if (!guestLeaving && Date.now() > guestRecord.expiresAt) {
        guestLeaving = true;
        guest.brain.leave();
        bubble.show([`${guestRecord.visit.name} is heading home`, "See you next time!"], 5000);
      }
      if (guest.brain.gone) {
        guest.destroy();
        guest = null;
        guestRecord = null;
        ext.storage.local.remove(["guest", "guestCat"]);
      } else if (own.brain.settled && guest.brain.settled && Math.abs(own.brain.x - guest.brain.x) < 110
          && Date.now() - lastMeet > MEET_COOLDOWN_MS) {
        lastMeet = Date.now();
        own.brain.meet(guest.brain.x);
        guest.brain.meet(own.brain.x);
      }
    }

    own.render();
    own.updateHover(cursor);
    if (guest) {
      guest.render();
      guest.updateHover(cursor);
    }
    const speaker = guest ?? own;
    bubble.follow(speaker.headTop.x, speaker.headTop.y);

    sinceSave += dt;
    if (sinceSave > SAVE_EVERY_S) {
      sinceSave = 0;
      save();
    }
    return Math.max(own.brain.fps, guest?.brain.fps ?? 0);
  }

  window.addEventListener("mousemove", (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    own?.updateHover(cursor);
    guest?.updateHover(cursor);
  }, { capture: true, passive: true });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return save();
    // Another tab may have moved the cat or changed settings meanwhile.
    stored = await loadStored();
    settings = stored.settings;
    idle = stored.idle;
    guestRecord = stored.guest;
    ensureCats();
    if (own && stored.cat) own.brain.restore(stored.cat, innerWidth);
    if (guest && stored.guestCat) guest.brain.restore(stored.guestCat, innerWidth);
  });
  window.addEventListener("pagehide", save);

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) settings = validSettings(changes.settings.newValue);
    if (changes.idle) idle = validIdle(changes.idle.newValue);
    if (changes.guest) {
      const next = validGuest(changes.guest.newValue);
      // A different guest replaces the current one.
      if (guest && (!next || JSON.stringify(next.visit) !== JSON.stringify(guestRecord?.visit))) {
        guest.destroy();
        guest = null;
        stored.guestCat = null;
      }
      guestRecord = next;
    }
    if (changes.settings || changes.guest) ensureCats();
  });

  if (location.href.split("#")[0].startsWith(VISIT_BASE.split("#")[0])) {
    // Let the landing page know the extension is here, so it hides its own demo cat.
    document.documentElement.dataset.kittyNextDoor = "installed";
    const offer = () => offerVisit(root, parseVisitFragment(location.hash), () => guestRecord);
    offer();
    window.addEventListener("hashchange", offer);
  }

  ensureCats();
  startLoop(tick);

  const testHooks = globalThis as unknown as { __KITTY_TEST__?: boolean; __kittyTest?: unknown };
  if (testHooks.__KITTY_TEST__) {
    testHooks.__kittyTest = {
      state: () => ({
        own: own && { activity: own.brain.activity, x: Math.round(own.brain.x) },
        guest: guest && { activity: guest.brain.activity, x: Math.round(guest.brain.x), leaving: guestLeaving },
        bubble: bubble.el.style.opacity === "1" ? bubble.el.textContent : "",
      }),
      acceptRect: () => root.querySelector("[data-accept]")?.getBoundingClientRect().toJSON() ?? null,
    };
  }
}

/** On the landing page, ask before a visiting cat moves in. Requires a real click. */
function offerVisit(root: ShadowRoot, visit: Visit | null, current: () => GuestRecord | null): void {
  root.querySelector("[data-offer]")?.remove();
  if (!visit) return;
  const existing = current();
  if (existing && JSON.stringify(existing.visit) === JSON.stringify(visit)) return;

  const card = document.createElement("div");
  card.dataset.offer = "";
  Object.assign(card.style, {
    position: "fixed", left: "50%", bottom: "200px", transform: "translateX(-50%)", pointerEvents: "auto",
    background: "#fffaf3", color: "#3b2b27", border: "2px solid #3b2b27", borderRadius: "16px",
    padding: "14px 18px", boxShadow: "0 8px 28px rgba(0,0,0,.2)", maxWidth: "min(360px, calc(100vw - 32px))",
    font: "500 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif", textAlign: "center",
  });
  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "16px";
  title.textContent = `${GIFTS[visit.gift]} ${visit.name} would like to stay with you for a day`;
  card.appendChild(title);
  if (existing) {
    const note = document.createElement("div");
    note.style.opacity = "0.75";
    note.style.marginTop = "4px";
    note.textContent = `${existing.visit.name} will head home to make room.`;
    card.appendChild(note);
  }
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "center", marginTop: "12px" });
  const button = (label: string, primary: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    Object.assign(b.style, {
      font: "600 14px system-ui, sans-serif", padding: "8px 14px", borderRadius: "10px", cursor: "pointer",
      border: "2px solid #3b2b27", background: primary ? "#f7ad63" : "transparent", color: "#3b2b27",
    });
    return b;
  };
  const yes = button("Let them stay", true);
  yes.dataset.accept = "";
  const no = button("Not now", false);
  row.append(yes, no);
  card.appendChild(row);
  root.appendChild(card);

  yes.addEventListener("click", async (e) => {
    if (!e.isTrusted) return;
    const now = Date.now();
    await ext.storage.local.remove("guestCat");
    await ext.storage.local.set({ guest: { visit, arrivedAt: now, expiresAt: now + GUEST_STAY_MS, greeted: false } });
    card.remove();
  });
  no.addEventListener("click", (e) => { if (e.isTrusted) card.remove(); });
}

main().catch(() => { /* never break the page */ });
