import type { Coat } from "./coats";
import type { Pose } from "./pose";

export interface Particle {
  kind: "heart" | "z" | "note";
  /** Cat-local units relative to the ground origin (not mirrored). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** Everything the renderer needs for one frame. Produced by the brain. */
export interface RenderState {
  pose: Pose;
  time: number;
  walkPhase: number;
  /** 0..1, how much of the walk cycle shows in the legs. */
  walkAmount: number;
  /** Where the eyes point, cat-local, roughly -1..1. */
  look: { x: number; y: number };
  headTilt: number;
  /** -1..1; passes through 0 while turning around. */
  facingScale: number;
  breathPhase: number;
  /** Multiplies eyeOpen for quick blinks. */
  blink: number;
  purr: number;
  squash: number;
  tailSway: number;
  particles: Particle[];
}

const OL = 2.1;
const LEG_W = 8;
const TAIL_W = 6.5;

type Pt = [number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function superellipse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, a: number, b: number, n: number, rot = 0,
): void {
  const steps = 56;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const e = 2 / n;
  ctx.beginPath();
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = a * Math.sign(c) * Math.abs(c) ** e;
    const y = b * Math.sign(s) * Math.abs(s) ** e;
    const px = cx + x * cr - y * sr;
    const py = cy + x * sr + y * cr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw = OL): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Stroke the current path twice to get a thick outlined limb. */
function outlinedStroke(ctx: CanvasRenderingContext2D, width: number, color: string, outline: string): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = width + OL * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = outline;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 0.01), Math.max(ry, 0.01), 0, 0, Math.PI * 2);
}

export function drawCat(
  ctx: CanvasRenderingContext2D,
  st: RenderState,
  coat: Coat,
  scale: number,
  ox: number,
  oy: number,
): void {
  const p = st.pose;
  const t = st.time;

  // Ground shadow, independent of facing.
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.fillStyle = `rgba(20, 12, 10, ${0.14 * (1 - p.airborne)})`;
  ellipse(ctx, p.bodyX * st.facingScale, -0.8, p.bodyW * 0.55, 2.6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(ox, oy);
  const sq = st.squash;
  ctx.scale(scale * st.facingScale * (1 + (1 - sq) * 0.6), scale * sq);
  if (st.purr > 0) ctx.translate(Math.sin(t * 95) * 0.28 * st.purr, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = coat.outline;

  const breath = (Math.sin(st.breathPhase) + 1) / 2;
  const bodyH = p.bodyH * (1 + breath * 0.035);
  const cr = Math.cos(p.bodyRot), sr = Math.sin(p.bodyRot);
  const toCat = (lx: number, ly: number): Pt => [
    p.bodyX + lx * cr - ly * sr,
    p.bodyY + lx * sr + ly * cr,
  ];

  const tail = tailPoints(p, st, toCat);
  const tailInFront = p.tailWrap >= 0.5;
  if (!tailInFront) drawTail(ctx, tail, coat);

  // A sitting cat's front legs stand in front of its chest.
  const frontLegsInFront = p.haunch > 0.5;
  drawLegs(ctx, p, st, coat, toCat, bodyH, frontLegsInFront ? "rest" : "all");

  // Body with tabby stripes along the back.
  superellipse(ctx, p.bodyX, p.bodyY, p.bodyW / 2, bodyH / 2, 2.6, p.bodyRot);
  fillStroke(ctx, coat.fur);
  if (coat.stripe) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = coat.stripe;
    ctx.lineWidth = 3.2;
    for (const sx of [-12, -4, 4]) {
      const [x1, y1] = toCat(sx, -bodyH / 2 - 1);
      const [x2, y2] = toCat(sx - 2.5, -bodyH / 2 + 6.5);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
    superellipse(ctx, p.bodyX, p.bodyY, p.bodyW / 2, bodyH / 2, 2.6, p.bodyRot);
    ctx.lineWidth = OL;
    ctx.stroke();
  }

  if (p.haunch > 0.02) {
    const h = p.haunch;
    ellipse(ctx, p.bodyX + 9, -3.2, 6 * h, 3.3 * h);
    fillStroke(ctx, coat.fur);
    ellipse(ctx, p.bodyX - 1, -10.5 * h, 12.5 * h, 10 * h);
    fillStroke(ctx, coat.fur);
  }
  if (frontLegsInFront) drawLegs(ctx, p, st, coat, toCat, bodyH, "chest");

  if (tailInFront) drawTail(ctx, tail, coat);

  if (p.frontPaws > 0.02) {
    const f = p.frontPaws;
    const px = p.bodyX + p.bodyW / 2 - 8;
    ellipse(ctx, px + 6, -3.2, 4.6 * f, 3.2 * f);
    fillStroke(ctx, coat.shade);
    ellipse(ctx, px, -3.2, 4.6 * f, 3.2 * f);
    fillStroke(ctx, coat.fur);
  }

  drawHead(ctx, p, st, coat, breath);
  ctx.restore();

  drawParticles(ctx, st.particles, coat, scale, ox, oy);
}

function drawLegs(
  ctx: CanvasRenderingContext2D, p: Pose, st: RenderState, coat: Coat,
  toCat: (x: number, y: number) => Pt, bodyH: number, which: "all" | "chest" | "rest",
): void {
  const hipY = bodyH / 2 - 6;
  // Far legs first so the near ones overlap them. Diagonal pairs share a phase.
  const legs = [
    { hip: p.backHipX + 3, front: false, far: true, phase: Math.PI },
    { hip: p.frontHipX + 3, front: true, far: true, phase: 0 },
    { hip: p.backHipX, front: false, far: false, phase: 0 },
    { hip: p.frontHipX, front: true, far: false, phase: Math.PI },
  ];
  const stride = 6.5 * st.walkAmount;
  const lift = 4 * st.walkAmount;
  for (const leg of legs) {
    const isChest = leg.front && !leg.far;
    if (which !== "all" && isChest !== (which === "chest")) continue;
    const ext = leg.front ? p.frontLegExt : p.backLegExt;
    if (ext < 0.04) continue;
    const [hx, hy] = toCat(leg.hip, hipY);
    const ph = st.walkPhase + leg.phase;
    const gx = hx + Math.sin(ph) * stride;
    const gy = -LEG_W / 2 - Math.max(0, Math.cos(ph)) * lift;
    const dx = hx + Math.sin(st.time * 5 + leg.phase) * 1.2 * p.airborne;
    const dy = hy + 11;
    let fx = lerp(gx, dx, p.airborne);
    let fy = lerp(gy, dy, p.airborne);
    fx = lerp(hx, fx, ext);
    fy = lerp(hy, fy, ext);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(fx, fy);
    outlinedStroke(ctx, LEG_W, leg.far ? coat.shade : coat.fur, coat.outline);
  }
}

function tailPoints(p: Pose, st: RenderState, toCat: (x: number, y: number) => Pt): Pt[] {
  const base = toCat(-p.bodyW / 2 + 5, -2);
  const sway = st.tailSway;
  const t = st.time;
  const a = p.tailAngle + Math.sin(t * 1.7) * 0.2 * sway;
  const c = p.tailCurl + Math.sin(t * 1.7 + 0.9) * 0.28 * sway;
  const L = p.tailLen;
  const step = (from: Pt, ang: number, len: number): Pt => [
    from[0] + Math.cos(ang) * len,
    from[1] + Math.sin(ang) * len,
  ];
  const a1 = step(base, a, L * 0.45);
  const a2 = step(a1, a + c, L * 0.35);
  const a3 = step(a2, a + c * 2, L * 0.3);

  // Wrapped along the ground in front of the body, tip flicking gently.
  const r = TAIL_W / 2;
  const w1: Pt = [base[0] - 5, -r];
  const w2: Pt = [base[0] + 8, -r];
  const w3: Pt = [base[0] + L * 0.8, -r - 0.8 - (Math.sin(t * 1.3) + 1) * 0.9 * sway];

  const w = p.tailWrap;
  const mix = (u: Pt, v: Pt): Pt => [lerp(u[0], v[0], w), lerp(u[1], v[1], w)];
  return [base, mix(a1, w1), mix(a2, w2), mix(a3, w3)];
}

function drawTail(ctx: CanvasRenderingContext2D, pts: Pt[], coat: Coat): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
  outlinedStroke(ctx, TAIL_W, coat.fur, coat.outline);
}

function drawHead(ctx: CanvasRenderingContext2D, p: Pose, st: RenderState, coat: Coat, breath: number): void {
  ctx.save();
  ctx.translate(p.headX, p.headY - breath * 0.6);
  ctx.rotate(p.headRot + st.headTilt);

  for (const s of [-1, 1]) {
    const e = p.earPerk;
    ctx.save();
    ctx.translate(s * (8.8 + (1 - e) * 2.5), -9.5 + (1 - e) * 3);
    ctx.rotate(s * (0.32 + (1 - e) * 0.9));
    ctx.beginPath();
    ctx.moveTo(-5.8, 1);
    ctx.lineTo(-0.9, -10.2);
    ctx.quadraticCurveTo(0, -11.8, 0.9, -10.2);
    ctx.lineTo(5.8, 1);
    ctx.closePath();
    fillStroke(ctx, coat.fur);
    ctx.beginPath();
    ctx.moveTo(-3.2, 0.5);
    ctx.lineTo(0, -7.2);
    ctx.lineTo(3.2, 0.5);
    ctx.closePath();
    ctx.fillStyle = coat.innerEar;
    ctx.fill();
    ctx.restore();
  }

  superellipse(ctx, 0, 0, 16.5, 14, 2.4);
  fillStroke(ctx, coat.fur);
  if (coat.stripe) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = coat.stripe;
    ctx.lineWidth = 2.2;
    for (const [x1, y1, x2, y2] of [[0, -14.5, 0, -9.8], [-4.2, -14, -3.3, -10.4], [4.2, -14, 3.3, -10.4]]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
    superellipse(ctx, 0, 0, 16.5, 14, 2.4);
    ctx.lineWidth = OL;
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = coat.blush;
  for (const s of [-1, 1]) {
    ellipse(ctx, s * 10.8, 4.8, 2.7, 1.7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const s of [-1, 1]) drawEye(ctx, s * 6.8, 0.2, p, st, coat);

  // Nose and "w" mouth.
  ctx.beginPath();
  ctx.moveTo(-1.8, 2.5);
  ctx.lineTo(1.8, 2.5);
  ctx.lineTo(0, 4.3);
  ctx.closePath();
  ctx.fillStyle = coat.nose;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.stroke();

  if (p.mouthOpen > 0.05) {
    ellipse(ctx, 0, 6.9, 2.2, 2 * p.mouthOpen);
    ctx.fillStyle = "#8e3f45";
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 4.3);
  ctx.lineTo(0, 5.2);
  ctx.moveTo(-3.2, 5);
  ctx.quadraticCurveTo(-1.6, 7.2, 0, 5.2);
  ctx.quadraticCurveTo(1.6, 7.2, 3.2, 5);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * 12, 2.6);
    ctx.lineTo(s * 19.5, 1.1);
    ctx.moveTo(s * 12, 4.4);
    ctx.lineTo(s * 19.5, 5.4);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, ex: number, ey: number, p: Pose, st: RenderState, coat: Coat): void {
  const open = Math.min(1, Math.max(0, p.eyeOpen * st.blink));
  const rx = 2.9 * p.eyeSize;
  const ry = 3.8 * p.eyeSize;
  ctx.lineWidth = 1.6;

  if (p.eyeHappy > 0.5) {
    ctx.beginPath();
    ctx.arc(ex, ey + 2, 3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (open < 0.12) {
    ctx.beginPath();
    ctx.arc(ex, ey - 1.2, 3, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }

  const lx = ex + st.look.x * 1.9;
  const ly = ey + st.look.y * 1.4;
  const lid = ly - ry + (1 - open) * 2 * ry;
  ctx.save();
  ctx.beginPath();
  const bowClip = 0.8 + p.eyeHappy * 5;
  ctx.moveTo(lx - rx - 1, lid + 0.2);
  ctx.quadraticCurveTo(lx, lid - bowClip, lx + rx + 1, lid + 0.2);
  ctx.lineTo(lx + rx + 1, ly + ry + 1);
  ctx.lineTo(lx - rx - 1, ly + ry + 1);
  ctx.closePath();
  ctx.clip();
  ellipse(ctx, lx, ly, rx, ry);
  ctx.fillStyle = coat.eye;
  ctx.fill();
  if (coat.pupil) {
    ellipse(ctx, lx + st.look.x * 0.5, ly, rx * 0.45, ry * 0.82);
    ctx.fillStyle = coat.pupil;
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ellipse(ctx, lx - 0.9, ly - 1.5, 1.25 * p.eyeSize, 1.25 * p.eyeSize);
  ctx.fill();
  ellipse(ctx, lx + 1.1, ly + 1.3, 0.55, 0.55);
  ctx.fill();
  ctx.restore();

  if (open < 0.97) {
    // A flat lid reads as unimpressed; a bowed one (eyeHappy) reads as soft and content.
    const bow = 0.8 + p.eyeHappy * 5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(lx - rx - 0.4, lid + 0.2);
    ctx.quadraticCurveTo(lx, lid - bow, lx + rx + 0.4, lid + 0.2);
    ctx.stroke();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D, particles: Particle[], coat: Coat, scale: number, ox: number, oy: number,
): void {
  if (particles.length === 0) return;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = coat.outline;
  ctx.lineJoin = "round";
  for (const pt of particles) {
    const k = pt.age / pt.life;
    ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
    if (pt.kind === "heart") {
      const s = 3.2;
      const { x, y } = pt;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.9);
      ctx.bezierCurveTo(x - s * 1.7, y - s * 0.2, x - s * 0.7, y - s * 1.5, x, y - s * 0.5);
      ctx.bezierCurveTo(x + s * 0.7, y - s * 1.5, x + s * 1.7, y - s * 0.2, x, y + s * 0.9);
      ctx.fillStyle = "#ff7d96";
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.stroke();
    } else {
      ctx.font = `bold ${pt.kind === "z" ? 7 + k * 3 : 8}px "Segoe UI", sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 2;
      const ch = pt.kind === "z" ? "z" : "♪";
      ctx.strokeText(ch, pt.x, pt.y);
      ctx.fillText(ch, pt.x, pt.y);
    }
  }
  ctx.restore();
}
