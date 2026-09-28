// The Kitty Park's scenery, drawn in the same outlined style as the cats.
// Pure canvas code: used by the park page and by the art renderer.

export type Phase = "dawn" | "day" | "sunset" | "dusk" | "night";

const INK = "#3b2b27";

export function phaseFor(date = new Date()): Phase {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 7) return "dawn";
  if (h >= 7 && h < 17) return "day";
  if (h >= 17 && h < 19) return "sunset";
  if (h >= 19 && h < 21) return "dusk";
  return "night";
}

interface Palette {
  skyTop: string; skyBottom: string; hillFar: string; hillNear: string; grassTop: string; grassBottom: string;
  water: string; waterLight: string; leaf: string; leafDark: string; trunk: string; bench: string;
  sun: string | null; moon: boolean; stars: number; shade: string;
}

const PALETTES: Record<Phase, Palette> = {
  dawn: {
    skyTop: "#9fb8e8", skyBottom: "#ffd6c2", hillFar: "#b7c9a0", hillNear: "#9cc07e", grassTop: "#9fcf7a", grassBottom: "#6fae5a",
    water: "#8fc2df", waterLight: "#d5ecf6", leaf: "#7dbb63", leafDark: "#5c9c4b", trunk: "#9a6b4b", bench: "#c98a5a",
    sun: "#ffc98a", moon: false, stars: 0, shade: "rgba(0,0,0,0)",
  },
  day: {
    skyTop: "#7ec3f2", skyBottom: "#d8f0ff", hillFar: "#a9d18c", hillNear: "#8cc56d", grassTop: "#96d36e", grassBottom: "#62b053",
    water: "#6fb8e2", waterLight: "#cdeaf8", leaf: "#6bb85a", leafDark: "#4f9a45", trunk: "#9a6b4b", bench: "#d0915e",
    sun: "#ffe07a", moon: false, stars: 0, shade: "rgba(0,0,0,0)",
  },
  sunset: {
    skyTop: "#6c7fd0", skyBottom: "#ffb07a", hillFar: "#b39b8a", hillNear: "#9aa36e", grassTop: "#9fb46a", grassBottom: "#6f8f4f",
    water: "#b58fb8", waterLight: "#f6c6a8", leaf: "#7b9f55", leafDark: "#5e7f44", trunk: "#8a5b40", bench: "#c07c4e",
    sun: "#ff9a5a", moon: false, stars: 0, shade: "rgba(80,30,40,0.08)",
  },
  dusk: {
    skyTop: "#2f3a78", skyBottom: "#b77aa3", hillFar: "#5f5f7f", hillNear: "#4f6a55", grassTop: "#5f8054", grassBottom: "#3f5f40",
    water: "#5a6aa0", waterLight: "#9fa9d6", leaf: "#4f7a4a", leafDark: "#3b5f3a", trunk: "#6b4a3a", bench: "#8f6448",
    sun: null, moon: true, stars: 30, shade: "rgba(20,20,60,0.15)",
  },
  night: {
    skyTop: "#0f1535", skyBottom: "#2c3566", hillFar: "#2f3a55", hillNear: "#2a4538", grassTop: "#35553f", grassBottom: "#22382b",
    water: "#2f4577", waterLight: "#6c86c0", leaf: "#2f5a3e", leafDark: "#23452f", trunk: "#4d3a30", bench: "#6d4d3a",
    sun: null, moon: true, stars: 90, shade: "rgba(10,10,40,0.28)",
  },
};

export const paletteFor = (phase: Phase) => PALETTES[phase];

/** Deterministic randomness, so the scenery doesn't reshuffle on every redraw. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Lane { y: number; scale: number }

export interface Layout {
  horizon: number;
  lanes: Lane[];
  bench: { x: number; lane: number };
  lamp: { x: number; top: number };
  pond: { x: number; y: number; rx: number; ry: number };
  catScale: number;
}

export function layoutFor(W: number, H: number): Layout {
  const catScale = Math.max(0.85, Math.min(1.7, Math.min(W / 900, H / 620) * 1.45));
  const horizon = H * 0.52;
  // Narrow screens keep the bottom strip free for the buttons.
  const bottom = W < 600 ? H - 78 : H * 0.965;
  return {
    horizon,
    lanes: [
      { y: horizon + (bottom - horizon) * 0.47, scale: catScale * 0.72 },
      { y: horizon + (bottom - horizon) * 0.73, scale: catScale * 0.86 },
      { y: bottom, scale: catScale },
    ],
    bench: { x: W * 0.64, lane: 1 },
    lamp: { x: Math.min(W - 24, W * 0.64 + 150 * catScale * 0.86), top: horizon + (bottom - horizon) * 0.73 - 190 * catScale * 0.86 },
    pond: { x: W * 0.2, y: H * 0.69, rx: Math.min(W * 0.14, 220), ry: Math.min(H * 0.05, 34) },
    catScale,
  };
}

function outline(ctx: CanvasRenderingContext2D, w: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function hill(ctx: CanvasRenderingContext2D, W: number, base: number, amp: number, freq: number, phase: number, fill: string, H: number): void {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base - amp * (0.6 + 0.4 * Math.sin(x * freq + phase)) * Math.sin(Math.PI * (x / W) * 0.9 + 0.3));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, 3);
}

function tree(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, p: Palette): void {
  ctx.beginPath();
  ctx.roundRect(x - 9 * s, ground - 70 * s, 18 * s, 72 * s, 6 * s);
  ctx.fillStyle = p.trunk;
  ctx.fill();
  outline(ctx, 3);
  const blobs: [number, number, number][] = [[0, -110, 46], [-34, -86, 34], [34, -86, 34], [0, -76, 36]];
  ctx.beginPath();
  for (const [dx, dy, r] of blobs) {
    ctx.moveTo(x + dx * s + r * s, ground + dy * s);
    ctx.arc(x + dx * s, ground + dy * s, r * s, 0, Math.PI * 2);
  }
  // Thick stroke, then fill: one clean outline around the whole canopy.
  outline(ctx, 6);
  ctx.fillStyle = p.leaf;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 14 * s, ground - 96 * s, 16 * s, 0, Math.PI * 2);
  ctx.fillStyle = p.leafDark;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function bench(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, p: Palette): void {
  const w = 190 * s;
  ctx.fillStyle = p.bench;
  for (const lx of [x - w / 2 + 18 * s, x + w / 2 - 18 * s]) {
    ctx.beginPath();
    ctx.roundRect(lx - 6 * s, ground - 44 * s, 12 * s, 44 * s, 4 * s);
    ctx.fill();
    outline(ctx, 3);
  }
  ctx.beginPath();
  ctx.roundRect(x - w / 2, ground - 52 * s, w, 14 * s, 6 * s);
  ctx.fill();
  outline(ctx, 3);
  for (const dy of [-96, -76]) {
    ctx.beginPath();
    ctx.roundRect(x - w / 2 + 6 * s, ground + dy * s, w - 12 * s, 14 * s, 6 * s);
    ctx.fill();
    outline(ctx, 3);
  }
}

function lampPost(ctx: CanvasRenderingContext2D, x: number, ground: number, top: number, s: number, lit: boolean): void {
  ctx.beginPath();
  ctx.roundRect(x - 5 * s, top + 26 * s, 10 * s, ground - top - 26 * s, 4 * s);
  ctx.fillStyle = "#4d4a55";
  ctx.fill();
  outline(ctx, 3);
  ctx.beginPath();
  ctx.roundRect(x - 18 * s, top, 36 * s, 30 * s, 8 * s);
  ctx.fillStyle = lit ? "#ffe9a8" : "#e9e2cf";
  ctx.fill();
  outline(ctx, 3);
}

/** Everything that doesn't move. Redraw on resize and when the time of day changes. */
export function drawScenery(ctx: CanvasRenderingContext2D, W: number, H: number, phase: Phase): Layout {
  const p = PALETTES[phase];
  const L = layoutFor(W, H);
  const r = rng(7);

  const sky = ctx.createLinearGradient(0, 0, 0, L.horizon);
  sky.addColorStop(0, p.skyTop);
  sky.addColorStop(1, p.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < p.stars; i++) {
    ctx.globalAlpha = 0.35 + r() * 0.65;
    ctx.fillStyle = "#fff9e8";
    ctx.beginPath();
    ctx.arc(r() * W, r() * L.horizon * 0.85, 0.6 + r() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const orb = { x: W * 0.8, y: L.horizon * 0.34, r: Math.max(26, Math.min(W, H) * 0.055) };
  if (p.sun) {
    ctx.fillStyle = p.sun;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
    ctx.fill();
    outline(ctx, 3);
  } else if (p.moon) {
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf3d6";
    ctx.fill();
    outline(ctx, 3);
    ctx.beginPath();
    ctx.arc(orb.x - orb.r * 0.25, orb.y - orb.r * 0.1, orb.r * 0.14, 0, Math.PI * 2);
    ctx.arc(orb.x + orb.r * 0.2, orb.y + orb.r * 0.25, orb.r * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "#e8dcb4";
    ctx.fill();
  }

  hill(ctx, W, L.horizon - 20, 70, 0.006, 1.2, p.hillFar, H);
  hill(ctx, W, L.horizon + 18, 46, 0.009, 4.1, p.hillNear, H);

  const ground = ctx.createLinearGradient(0, L.horizon + 30, 0, H);
  ground.addColorStop(0, p.grassTop);
  ground.addColorStop(1, p.grassBottom);
  ctx.fillStyle = ground;
  ctx.fillRect(0, L.horizon + 40, W, H - L.horizon - 40);
  ctx.beginPath();
  ctx.moveTo(0, L.horizon + 40);
  ctx.lineTo(W, L.horizon + 40);
  outline(ctx, 3);

  // Back trees on the hill line, then the pond, then flowers.
  const ts = L.catScale * 0.8;
  for (const tx of [0.07, 0.36, 0.9]) tree(ctx, W * tx, L.horizon + 44, ts * (0.8 + r() * 0.3), p);

  ctx.beginPath();
  ctx.ellipse(L.pond.x, L.pond.y, L.pond.rx, L.pond.ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.water;
  ctx.fill();
  outline(ctx, 3);
  ctx.beginPath();
  ctx.ellipse(L.pond.x - L.pond.rx * 0.3, L.pond.y - L.pond.ry * 0.25, L.pond.rx * 0.35, L.pond.ry * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.waterLight;
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;
  for (const [dx, dy] of [[0.45, 0.1], [0.62, -0.3]]) {
    ctx.beginPath();
    ctx.ellipse(L.pond.x + L.pond.rx * dx, L.pond.y + L.pond.ry * dy, 14 * ts, 7 * ts, 0, 0.3, Math.PI * 2 - 0.3);
    ctx.lineTo(L.pond.x + L.pond.rx * dx, L.pond.y + L.pond.ry * dy);
    ctx.fillStyle = p.leaf;
    ctx.fill();
    outline(ctx, 2);
  }

  const petals = ["#ff9fb2", "#ffe27a", "#ffffff", "#c9a7ff"];
  for (let i = 0; i < Math.round(W / 22); i++) {
    const fx = r() * W;
    const fy = L.horizon + 60 + r() * (H - L.horizon - 70);
    if (Math.hypot((fx - L.pond.x) / L.pond.rx, (fy - L.pond.y) / L.pond.ry) < 1.3) continue;
    const s = (2.2 + r() * 2.2) * (fy / H) * 1.3;
    ctx.fillStyle = petals[i % petals.length];
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ctx.moveTo(fx + Math.cos(a) * s * 1.4 + s, fy + Math.sin(a) * s * 1.4);
      ctx.arc(fx + Math.cos(a) * s * 1.4, fy + Math.sin(a) * s * 1.4, s, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = "#f7ad63";
    ctx.beginPath();
    ctx.arc(fx, fy, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const bl = L.lanes[L.bench.lane];
  bench(ctx, L.bench.x, bl.y - 4, bl.scale, p);
  lampPost(ctx, L.lamp.x, bl.y - 4, L.lamp.top, bl.scale, phase === "dusk" || phase === "night");

  if (p.shade !== "rgba(0,0,0,0)") {
    ctx.fillStyle = p.shade;
    ctx.fillRect(0, 0, W, H);
  }
  return L;
}
