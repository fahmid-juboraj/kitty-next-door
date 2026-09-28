// Marketing art for the website, drawn with the same code as the cat itself:
//   art/hero.png  a visit in progress inside a browser window (transparent background)
//   art/og.png    1200x630 link-preview image (WhatsApp, X, Messenger, Discord)
import { COATS } from "../core/coats";
import { drawCat, type Particle, type RenderState } from "../core/draw";
import { clonePose, POSES } from "../core/pose";

const INK = "#3b2b27";
const FONT = `"Segoe UI", system-ui, sans-serif`;

function sitting(facing: 1 | -1, particles: Particle[] = []): RenderState {
  return {
    pose: { ...clonePose(POSES.sit), eyeHappy: 0.2 }, time: 0.9, walkPhase: 0, walkAmount: 0,
    look: { x: 0.95, y: -0.05 }, headTilt: 0.05, facingScale: facing, breathPhase: 0, blink: 1,
    purr: 0, squash: 1, tailSway: 1, particles,
  };
}

const heart = (x: number, y: number): Particle => ({ kind: "heart", x, y, vx: 0, vy: 0, age: 0.3, life: 2 });

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A speech bubble like the one on the page: first line bold. */
function bubble(ctx: CanvasRenderingContext2D, cx: number, bottom: number, lines: string[], size: number): void {
  const pad = size * 0.9;
  const lh = size * 1.4;
  ctx.font = `700 ${size}px ${FONT}`;
  const widths = lines.map((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${size}px ${FONT}`;
    return ctx.measureText(l).width;
  });
  const w = Math.max(...widths) + pad * 2;
  const h = lines.length * lh + pad * 1.4;
  const x = cx - w / 2;
  const y = bottom - h;
  ctx.fillStyle = INK;
  roundRect(ctx, x, y + size * 0.3, w, h, size * 1.1);
  ctx.fill();
  ctx.fillStyle = "#fffaf3";
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.16;
  roundRect(ctx, x, y, w, h, size * 1.1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${size}px ${FONT}`;
    ctx.globalAlpha = i === 0 ? 1 : 0.8;
    ctx.fillText(l, x + pad, y + pad * 0.75 + i * lh);
  });
  ctx.globalAlpha = 1;
}

export function renderHero(): HTMLCanvasElement {
  const W = 1600, H = 1000;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const wx = 60, wy = 40, ww = 1480, wh = 900, r = 40;

  // Browser window with a hard shadow.
  ctx.fillStyle = INK;
  roundRect(ctx, wx, wy + 18, ww, wh, r);
  ctx.fill();
  ctx.fillStyle = "#fffdf9";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  roundRect(ctx, wx, wy, ww, wh, r);
  ctx.fill();
  ctx.stroke();

  // Title bar, dots and an address pill.
  ctx.save();
  roundRect(ctx, wx, wy, ww, wh, r);
  ctx.clip();
  ctx.fillStyle = "#f6e6d2";
  ctx.fillRect(wx, wy, ww, 84);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(wx, wy + 84);
  ctx.lineTo(wx + ww, wy + 84);
  ctx.stroke();
  ["#f28b82", "#f7c85c", "#8fd19e"].forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(wx + 50 + i * 42, wy + 42, 13, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.stroke();
  });
  ctx.fillStyle = "#fffdf9";
  roundRect(ctx, wx + 210, wy + 20, 620, 44, 22);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#9a857c";
  ctx.font = `500 22px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("any-website-you-like.com", wx + 240, wy + 43);

  // "Page content" placeholders.
  ctx.fillStyle = "#f1e5d6";
  roundRect(ctx, wx + 110, wy + 150, 760, 46, 23);
  ctx.fill();
  [[1220, 0], [1120, 1], [1180, 2], [700, 3]].forEach(([w, i]) => {
    roundRect(ctx, wx + 110, wy + 240 + i * 50, w, 24, 12);
    ctx.fill();
  });

  // Your cat (ginger) and the visitor (Kiki) sitting together.
  const ground = wy + wh - 30;
  const s = 5.2;
  drawCat(ctx, sitting(1, [heart(33, -72), heart(43, -86)]), COATS.ginger, s, 640, ground);
  drawCat(ctx, sitting(-1), COATS.black, s, 990, ground);
  bubble(ctx, 1240, ground - 330, ["🧶 Kiki is visiting you!", "“Thinking of you!”", "— from Sam"], 30);
  return c;
}

export function renderOg(): HTMLCanvasElement {
  const W = 1200, H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fdf4e8";
  ctx.fillRect(0, 0, W, H);
  // Soft ground band.
  ctx.fillStyle = "#f6e6d2";
  ctx.fillRect(0, 540, W, 90);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 540);
  ctx.lineTo(W, 540);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 78px ${FONT}`;
  ctx.fillText("Kitty Next Door", 70, 170);
  ctx.font = `500 36px ${FONT}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText("A cat that keeps you company", 72, 240);
  ctx.fillText("and walks over to visit your friends.", 72, 290);
  ctx.globalAlpha = 1;

  // Pill: free on every browser.
  ctx.font = `700 26px ${FONT}`;
  const label = "Free · Chrome · Edge · Firefox · Windows";
  const lw = ctx.measureText(label).width + 44;
  ctx.fillStyle = "#f7ad63";
  roundRect(ctx, 70, 340, lw, 56, 28);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText(label, 92, 369);

  drawCat(ctx, sitting(1, [heart(33, -72)]), COATS.ginger, 3.3, 800, 540);
  drawCat(ctx, sitting(-1), COATS.black, 3.3, 1020, 540);
  return c;
}
