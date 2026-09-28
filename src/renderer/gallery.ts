// Renders every pose and coat to PNGs so the art can be reviewed without
// running the overlay. `npm run gallery` writes art/gallery.png, art/hero.png,
// art/og.png and the icons in assets/.
import { COATS, DEFAULT_COAT } from "../core/coats";
import { drawCat, type RenderState } from "../core/draw";
import { clonePose, POSES, type Pose, type PoseName } from "../core/pose";
import type { PetBridge } from "../main/preload";
import { renderHero, renderOg, renderParkOg, renderPromo } from "./marketing";

declare global {
  interface Window { pet: PetBridge }
}

function stateFor(pose: Pose, extra: Partial<RenderState> = {}): RenderState {
  return {
    pose, time: 0.6, walkPhase: 0, walkAmount: 0, look: { x: 0.25, y: 0.1 }, headTilt: 0,
    facingScale: 1, breathPhase: 0, blink: 1, purr: 0, squash: 1, tailSway: 1, particles: [],
    ...extra,
  };
}

function with_(name: PoseName, over: Partial<Pose>): Pose {
  return { ...clonePose(POSES[name]), ...over };
}

const frames: { label: string; st: RenderState }[] = [
  { label: "stand", st: stateFor(clonePose(POSES.stand)) },
  { label: "walk A", st: stateFor(clonePose(POSES.stand), { walkAmount: 1, walkPhase: 0.5 }) },
  { label: "walk B", st: stateFor(clonePose(POSES.stand), { walkAmount: 1, walkPhase: 0.5 + Math.PI }) },
  { label: "sit (watching)", st: stateFor(clonePose(POSES.sit), { look: { x: -0.6, y: -0.8 } }) },
  { label: "sleepy (night)", st: stateFor(with_("sit", { eyeOpen: 0.8, eyeHappy: 0.35 }), { look: { x: -0.3, y: -0.5 } }) },
  { label: "slow blink", st: stateFor(with_("sit", { eyeOpen: 0.45, eyeHappy: 0.45 }), { look: { x: 0, y: -0.3 } }) },
  { label: "purr", st: stateFor(with_("loaf", { eyeHappy: 1, earPerk: 0.7 }), {
    particles: [{ kind: "heart", x: 22, y: -52, vx: 0, vy: 0, age: 0.5, life: 2 }],
  }) },
  { label: "boop", st: stateFor(with_("sit", { mouthOpen: 1, earPerk: 1 }), { look: { x: 0.2, y: -0.6 } }) },
  { label: "loaf", st: stateFor(clonePose(POSES.loaf)) },
  { label: "sleep", st: stateFor(clonePose(POSES.sleep), {
    particles: [{ kind: "z", x: 30, y: -42, vx: 0, vy: 0, age: 0.8, life: 3 }],
  }) },
  { label: "carried", st: stateFor(clonePose(POSES.carried)) },
  { label: "fall", st: stateFor(clonePose(POSES.fall)) },
  { label: "facing left", st: stateFor(clonePose(POSES.stand), { facingScale: -1 }) },
];

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#555"): void {
  ctx.fillStyle = color;
  ctx.font = "14px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

async function main(): Promise<void> {
  const big = 3;
  const cellW = 230, cellH = 290, cols = 7;
  const rows = Math.ceil(frames.length / cols);
  const smallH = 170;
  const W = cellW * cols;
  const H = cellH * rows + smallH * 2;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#eef0f4";
  ctx.fillRect(0, 0, W, H);

  frames.forEach((f, i) => {
    const cx = (i % cols) * cellW + cellW / 2;
    const cy = Math.floor(i / cols) * cellH + cellH - 40;
    drawCat(ctx, f.st, DEFAULT_COAT, big, cx, cy);
    label(ctx, f.label, cx, cy + 28);
  });

  // Real size (1.6x) on a light and a dark strip, every coat, a few poses.
  const coats = Object.values(COATS);
  const poses: PoseName[] = ["stand", "sit", "loaf", "sleep"];
  for (const [row, bg, fg] of [[0, "#f7f7f7", "#555"], [1, "#1f2430", "#ccc"]] as const) {
    const y0 = cellH * rows + row * smallH;
    ctx.fillStyle = bg;
    ctx.fillRect(0, y0, W, smallH);
    const step = W / (coats.length * poses.length);
    coats.forEach((coat, ci) => poses.forEach((pn, pi) => {
      const cx = (ci * poses.length + pi) * step + step / 2;
      drawCat(ctx, stateFor(clonePose(POSES[pn])), coat, 1.6, cx, y0 + smallH - 30);
      if (pi === 0) label(ctx, coat.name, cx + step * 1.5, y0 + smallH - 8, fg);
    }));
  }
  await window.pet.savePng("art/gallery.png", canvas.toDataURL("image/png"));

  // App / tray icon: the sitting cat's face, cropped to fill the square.
  for (const size of [300, 256, 128, 48, 32, 16]) {
    const ic = document.createElement("canvas");
    ic.width = ic.height = size;
    const ictx = ic.getContext("2d")!;
    const sit = POSES.sit;
    const s = size / 44;
    const ox = size / 2 - sit.headX * s;
    const oy = size / 2 - (sit.headY - 4) * s;
    drawCat(ictx, stateFor(clonePose(sit), { look: { x: 0, y: 0 } }), DEFAULT_COAT, s, ox, oy);
    await window.pet.savePng(`assets/icon-${size}.png`, ic.toDataURL("image/png"));
  }
  await window.pet.savePng("art/hero.png", renderHero().toDataURL("image/png"));
  await window.pet.savePng("art/og.png", renderOg().toDataURL("image/png"));
  await window.pet.savePng("art/og-park.png", renderParkOg().toDataURL("image/png"));
  await window.pet.savePng("store/promo-440x280.png", renderPromo(440, 280).toDataURL("image/png"));
  await window.pet.savePng("store/promo-1400x560.png", renderPromo(1400, 560).toDataURL("image/png"));
  window.pet.galleryDone();
}

main();
