// The Kitty Park: a live, public page. Cats sent from the extension appear
// here for everyone watching, alongside a few resident park cats. Cats are
// simulated locally in each viewer (same behavior code as the real cat); the
// server only says who is in the park and who wears the crown.
import { CatBrain } from "../core/brain";
import { COATS, DEFAULT_COAT } from "../core/coats";
import { drawCat } from "../core/draw";
import { startLoop } from "../web/actor";
import { parseParkMsg, type ParkCat } from "../../realtime/shared/protocol";
import { drawScenery, paletteFor, phaseFor, rng, type Layout, type Phase } from "./park-scene";

interface ParkedCat {
  id: string;
  name: string;
  coat: string;
  resident: boolean;
  lane: number;
  brain: CatBrain;
  leaving: boolean;
}

const RESIDENTS = [
  { id: "resident-pudding", name: "Pudding", coat: "cream", lane: 2 },
  { id: "resident-biscuit", name: "Biscuit", coat: "grey", lane: 1 },
  { id: "resident-pepper", name: "Pepper", coat: "black", lane: 0 },
];
const MEET_COOLDOWN_MS = 40_000;
const FPS = 30;

const $ = (id: string) => document.getElementById(id)!;
const bg = $("bg") as HTMLCanvasElement;
const fx = $("fx") as HTMLCanvasElement;
const bgx = bg.getContext("2d")!;
const fxx = fx.getContext("2d")!;
const dpr = Math.min(window.devicePixelRatio || 1, 2);

let W = 0, H = 0;
let phase: Phase = phaseFor();
let layout: Layout;
const cats = new Map<string, ParkedCat>();
let crownId: string | null = null;
let selected: string | null = null;
let cursor: { x: number; y: number } | null = null;
let held: ParkedCat | null = null;
let hovered: ParkedCat | null = null;
const pairMet = new Map<string, number>();
let time = 0;

// ---- scenery ------------------------------------------------------------------

function resize(): void {
  W = innerWidth;
  H = innerHeight;
  for (const c of [bg, fx]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
  }
  bgx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = drawScenery(bgx, W, H, phase);
  for (const c of cats.values()) {
    c.brain.restore({ xFrac: Math.min(1, c.brain.x / Math.max(1, W)) }, W);
  }
}

// Moving bits: clouds by day, butterflies, fireflies at night, pond ripples.
const r = rng(11);
const clouds = Array.from({ length: 4 }, (_, i) => ({ x: 0.25 + i * 0.28 + r() * 0.1, y: 0.12 + r() * 0.2, s: 0.6 + r() * 0.5, v: 0.004 + r() * 0.006 }));
const butterflies = Array.from({ length: 6 }, (_, i) => ({ x: r(), y: 0.55 + r() * 0.3, v: (r() - 0.5) * 0.04, p: r() * 10, c: ["#ff9fb2", "#ffe27a", "#9fd2ff", "#c9a7ff"][i % 4] }));
const fireflies = Array.from({ length: 26 }, () => ({ x: r(), y: 0.5 + r() * 0.45, p: r() * 10, v: r() }));

function drawClouds(): void {
  const p = paletteFor(phase);
  if (!p.sun) return;
  fxx.fillStyle = phase === "sunset" ? "#ffe3d2" : "#ffffff";
  fxx.strokeStyle = "#3b2b27";
  fxx.lineWidth = 3;
  for (const c of clouds) {
    c.x = (c.x + c.v / FPS) % 1.3;
    const x = (c.x - 0.15) * W, y = c.y * layout.horizon, s = c.s * layout.catScale * 16;
    fxx.beginPath();
    for (const [dx, dy, rr] of [[0, 0, 1.2], [1.3, 0.3, 0.95], [-1.3, 0.35, 0.9], [0.6, -0.55, 0.85]]) {
      fxx.moveTo(x + dx * s + rr * s, y + dy * s);
      fxx.arc(x + dx * s, y + dy * s, rr * s, 0, Math.PI * 2);
    }
    // A thick stroke then a fill leaves one clean outer outline.
    fxx.lineWidth = 6;
    fxx.stroke();
    fxx.fill();
  }
}

function drawCritters(): void {
  if (phase === "day" || phase === "dawn") {
    for (const b of butterflies) {
      b.x = (b.x + b.v / FPS + 1) % 1;
      const x = b.x * W, y = b.y * H + Math.sin(time * 1.6 + b.p) * 18;
      const flap = 0.35 + Math.abs(Math.sin(time * 11 + b.p)) * 0.65;
      fxx.fillStyle = b.c;
      fxx.strokeStyle = "#3b2b27";
      fxx.lineWidth = 1.5;
      for (const side of [-1, 1]) {
        fxx.beginPath();
        fxx.ellipse(x + side * 5 * flap, y, 6 * flap, 5, 0, 0, Math.PI * 2);
        fxx.fill();
        fxx.stroke();
      }
    }
  } else if (phase === "dusk" || phase === "night") {
    for (const f of fireflies) {
      const x = (f.x + Math.sin(time * 0.3 + f.p) * 0.03) * W;
      const y = f.y * H + Math.cos(time * 0.5 + f.p) * 14;
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(time * (1 + f.v) + f.p));
      const g = fxx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, `rgba(255, 240, 150, ${a})`);
      g.addColorStop(1, "rgba(255, 240, 150, 0)");
      fxx.fillStyle = g;
      fxx.fillRect(x - 9, y - 9, 18, 18);
    }
    // Lamp glow.
    const lx = layout.lamp.x, ly = layout.lamp.top + 14 * layout.lanes[1].scale;
    const gr = 160 * layout.catScale;
    const g = fxx.createRadialGradient(lx, ly, 4, lx, ly, gr);
    g.addColorStop(0, "rgba(255, 226, 150, 0.45)");
    g.addColorStop(1, "rgba(255, 226, 150, 0)");
    fxx.fillStyle = g;
    fxx.fillRect(lx - gr, ly - gr, gr * 2, gr * 2);
  }
  // Pond ripples.
  const { x, y, rx, ry } = layout.pond;
  for (let i = 0; i < 2; i++) {
    const k = ((time * 0.25 + i * 0.5) % 1);
    fxx.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - k)})`;
    fxx.lineWidth = 2;
    fxx.beginPath();
    fxx.ellipse(x + rx * 0.15, y + ry * 0.1, rx * 0.2 * (0.3 + k), ry * 0.3 * (0.3 + k), 0, 0, Math.PI * 2);
    fxx.stroke();
  }
}

// ---- cats -----------------------------------------------------------------------

function laneWithRoom(): number {
  const counts = [0, 0, 0];
  for (const c of cats.values()) counts[c.lane]++;
  return counts.indexOf(Math.min(...counts));
}

function addCat(p: { id: string; name: string; coat: string }, resident: boolean, arrive: boolean, lane = laneWithRoom()): void {
  if (cats.has(p.id)) return;
  const L = layout.lanes[lane];
  const brain = new CatBrain({ scale: L.scale, x: W * (0.1 + Math.random() * 0.8), groundY: L.y });
  if (arrive) brain.enterFrom(Math.random() < 0.5 ? -1 : 1, W, W * (0.2 + Math.random() * 0.6));
  cats.set(p.id, { id: p.id, name: p.name, coat: p.coat, resident, lane, brain, leaving: false });
}

function removeCat(id: string): void {
  const c = cats.get(id);
  if (!c || c.leaving) return;
  c.leaving = true;
  c.brain.leave();
}

const visitors = () => [...cats.values()].filter((c) => !c.resident && !c.leaving);

function bbox(c: ParkedCat): { x0: number; x1: number; y0: number; y1: number } {
  const s = layout.lanes[c.lane].scale;
  return { x0: c.brain.x - 34 * s, x1: c.brain.x + 34 * s, y0: c.brain.y - 76 * s, y1: c.brain.y + 2 };
}

function catAt(x: number, y: number): ParkedCat | null {
  // Front lanes first: they're drawn on top.
  const list = [...cats.values()].filter((c) => !c.leaving).sort((a, b) => b.lane - a.lane);
  for (const c of list) {
    const b = bbox(c);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return c;
  }
  return null;
}

/** Every few seconds, make something happen between cats. */
function direct(): void {
  const awake = [...cats.values()].filter((c) => !c.leaving && c.brain !== held?.brain && c.brain.settled);
  if (awake.length < 2) return;
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const roll = Math.random();
  const night = phase === "night" || phase === "dusk";
  if (night && roll < 0.35) {
    // Gather at the bench for a nap.
    const c = pick(awake);
    if (c.lane === layout.bench.lane) c.brain.goTo(layout.bench.x + (Math.random() - 0.5) * 140 * layout.lanes[c.lane].scale);
    return;
  }
  const a = pick(awake);
  const sameLane = awake.filter((c) => c !== a && c.lane === a.lane);
  if (!sameLane.length) return;
  const b = pick(sameLane);
  if (roll < 0.72) {
    // Go say hello.
    const side = a.brain.x < b.brain.x ? -1 : 1;
    a.brain.goTo(b.brain.x + side * 75 * layout.lanes[a.lane].scale);
  } else {
    // Zoomies: one dashes off, the other gives chase.
    const target = a.brain.x < W / 2 ? W * (0.75 + Math.random() * 0.2) : W * (0.05 + Math.random() * 0.2);
    a.brain.goTo(target, 2.6);
    b.brain.goTo(target + (target > W / 2 ? -70 : 70) * layout.lanes[a.lane].scale, 2.3);
  }
}

function meetUps(): void {
  const list = [...cats.values()].filter((c) => !c.leaving);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.lane !== b.lane || !a.brain.settled || !b.brain.settled) continue;
      if (Math.abs(a.brain.x - b.brain.x) > 100 * layout.lanes[a.lane].scale) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (Date.now() - (pairMet.get(key) ?? 0) < MEET_COOLDOWN_MS) continue;
      pairMet.set(key, Date.now());
      a.brain.meet(b.brain.x);
      b.brain.meet(a.brain.x);
    }
  }
}

function label(text: string, x: number, y: number, strong = false): void {
  fxx.font = `${strong ? 800 : 700} 13px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = fxx.measureText(text).width + 16;
  fxx.fillStyle = "rgba(255, 250, 243, 0.95)";
  fxx.strokeStyle = "#3b2b27";
  fxx.lineWidth = 2;
  fxx.beginPath();
  fxx.roundRect(x - w / 2, y - 22, w, 22, 11);
  fxx.fill();
  fxx.stroke();
  fxx.fillStyle = "#3b2b27";
  fxx.textAlign = "center";
  fxx.textBaseline = "middle";
  fxx.fillText(text, x, y - 11);
  fxx.textAlign = "start";
}

function frame(dt: number): void {
  time += dt;
  fxx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxx.clearRect(0, 0, W, H);
  drawClouds();
  drawCritters();

  const hour = new Date().getHours();
  const ordered = [...cats.values()].sort((a, b) => a.lane - b.lane || a.brain.y - b.brain.y);
  for (const c of ordered) {
    const L = layout.lanes[c.lane];
    const hovering = !!cursor && hovered === c;
    c.brain.update(dt, { cursor, hovering, width: W, groundY: L.y, idleSeconds: 0, hour });
    if (c.leaving && c.brain.gone) {
      cats.delete(c.id);
      continue;
    }
    drawCat(fxx, c.brain.renderState(), COATS[c.coat] ?? DEFAULT_COAT, L.scale, c.brain.x, c.brain.y);
    const top = c.brain.y - 82 * L.scale;
    if (c.id === crownId) {
      fxx.font = `${Math.round(26 * L.scale)}px system-ui, "Segoe UI Emoji", sans-serif`;
      fxx.textAlign = "center";
      fxx.fillText("👑", c.brain.x + 4 * L.scale * c.brain.facing, top + Math.sin(time * 2) * 2);
      fxx.textAlign = "start";
    }
    if (c === hovered || c.id === selected) {
      label(c.resident ? `${c.name} · lives here` : c.name, c.brain.x, top - (c.id === crownId ? 26 * L.scale : 4), c.id === selected);
    }
  }
  meetUps();
}

// ---- pointer: hover, pet, pick up, select --------------------------------------

fx.addEventListener("pointermove", (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  if (held) {
    held.brain.pointerMove(e.clientX, e.clientY);
    return;
  }
  hovered = catAt(e.clientX, e.clientY);
  fx.style.cursor = hovered ? "grab" : "";
});
fx.addEventListener("pointerleave", () => { cursor = null; hovered = null; });
fx.addEventListener("pointerdown", (e) => {
  const c = catAt(e.clientX, e.clientY);
  if (!c) {
    selected = null;
    return;
  }
  fx.setPointerCapture(e.pointerId);
  held = c;
  selected = c.id;
  c.brain.pointerDown(e.clientX, e.clientY);
  fx.style.cursor = "grabbing";
});
const release = () => {
  held?.brain.pointerUp();
  held = null;
  fx.style.cursor = hovered ? "grab" : "";
};
fx.addEventListener("pointerup", release);
fx.addEventListener("pointercancel", release);

// ---- HUD --------------------------------------------------------------------------

function renderHud(): void {
  const n = visitors().length;
  $("count").textContent = n === 0
    ? "No visiting cats yet. Be the first!"
    : `🐾 ${n} ${n === 1 ? "cat is" : "cats are"} visiting right now`;
  const crowned = crownId ? cats.get(crownId) : null;
  $("crown").hidden = !crowned;
  if (crowned) $("crownName").textContent = crowned.name;
}

$("bring").addEventListener("click", () => { $("bringPanel").hidden = !$("bringPanel").hidden; });
$("closeBring").addEventListener("click", () => { $("bringPanel").hidden = true; });

// ---- postcard -----------------------------------------------------------------------

async function postcard(): Promise<void> {
  const out = document.createElement("canvas");
  out.width = 1200;
  out.height = 630;
  const o = out.getContext("2d")!;
  // Cover-crop the current scene into 1200x630.
  const scale = Math.max(1200 / fx.width, 630 / fx.height);
  const sw = 1200 / scale, sh = 630 / scale;
  const sx = (fx.width - sw) / 2, sy = fx.height - sh;
  o.drawImage(bg, sx, sy, sw, sh, 0, 0, 1200, 630);
  o.drawImage(fx, sx, sy, sw, sh, 0, 0, 1200, 630);
  const star = selected ? cats.get(selected) : crownId ? cats.get(crownId) : null;
  const n = visitors().length;
  const title = star ? `${star.name} at the Kitty Park` : `${Math.max(n, 1)} ${n === 1 ? "cat" : "cats"} at the Kitty Park`;
  o.fillStyle = "rgba(255, 250, 243, 0.96)";
  o.strokeStyle = "#3b2b27";
  o.lineWidth = 4;
  o.beginPath();
  o.roundRect(28, 24, 640, 104, 22);
  o.fill();
  o.stroke();
  o.fillStyle = "#3b2b27";
  o.font = `800 40px system-ui, "Segoe UI", sans-serif`;
  o.textBaseline = "alphabetic";
  o.fillText(`🌳 ${title}`, 52, 76);
  o.font = `600 22px system-ui, "Segoe UI", sans-serif`;
  o.globalAlpha = 0.75;
  o.fillText(`${location.host}/park`, 54, 110);
  o.globalAlpha = 1;
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
  if (!blob) return;
  const file = new File([blob], "kitty-park-postcard.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Kitty Park", text: `${title} 🐾 ${location.origin}/park/` });
      return;
    } catch { /* cancelled: fall back to download */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kitty-park-postcard.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("postcard").addEventListener("click", () => { postcard(); });

// ---- live connection ----------------------------------------------------------------

function serverUrl(): string | null {
  const override = new URLSearchParams(location.search).get("server");
  if (override && /^wss?:\/\/[^/]+$/.test(override)) return override;
  if (location.protocol !== "https:" && location.protocol !== "http:") return null;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

let backoff = 1000;
function connect(): void {
  const base = serverUrl();
  if (!base) return;
  const ws = new WebSocket(`${base}/v1/park`);
  let ping: ReturnType<typeof setInterval> | null = null;
  ws.onopen = () => {
    backoff = 1000;
    $("live").textContent = "● live";
    ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    const m = parseParkMsg(e.data);
    if (!m) return;
    if (m.t === "park") {
      const ids = new Set(m.cats.map((c) => c.id));
      for (const c of visitors()) if (!ids.has(c.id)) removeCat(c.id);
      for (const c of m.cats) addCat(visitorOf(c), false, false);
      crownId = m.crown;
    } else if (m.t === "join") {
      addCat(visitorOf(m.cat), false, true);
    } else if (m.t === "leave") {
      removeCat(m.id);
      if (crownId === m.id) crownId = null;
    } else if (m.t === "crown") {
      crownId = m.id;
    }
    renderHud();
  };
  ws.onclose = () => {
    if (ping) clearInterval(ping);
    $("live").textContent = "○ reconnecting…";
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}
const visitorOf = (c: ParkCat) => ({ id: c.id, name: c.cat, coat: c.coat });

// ---- go -------------------------------------------------------------------------------

resize();
window.addEventListener("resize", resize);
for (const res of RESIDENTS) addCat(res, true, false, res.lane);
renderHud();
setInterval(direct, 3200);
setInterval(() => {
  const p = phaseFor();
  if (p !== phase) {
    phase = p;
    resize();
  }
}, 60_000);
connect();
startLoop((dt) => {
  frame(dt);
  return FPS;
});

// For screenshots and tests: ?phase=night forces a time of day.
const forced = new URLSearchParams(location.search).get("phase") as Phase | null;
if (forced && ["dawn", "day", "sunset", "dusk", "night"].includes(forced)) {
  phase = forced;
  resize();
  setInterval(() => { if (phase !== forced) { phase = forced; resize(); } }, 1000);
}
const hooks = globalThis as unknown as { __KITTY_TEST__?: boolean; __parkTest?: unknown };
if (hooks.__KITTY_TEST__) {
  hooks.__parkTest = {
    cats: () => [...cats.values()].map((c) => ({ id: c.id, name: c.name, resident: c.resident, leaving: c.leaving, lane: c.lane, activity: c.brain.activity, x: Math.round(c.brain.x) })),
    crown: () => crownId,
    count: () => $("count").textContent,
    add: (id: string, name: string, coat: string) => { addCat({ id, name, coat }, false, true); renderHud(); },
  };
}
