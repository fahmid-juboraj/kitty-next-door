import { CatBrain } from "../core/brain";
import { DEFAULT_COAT } from "../core/coats";
import { drawCat } from "../core/draw";
import type { PetBridge } from "../main/preload";

declare global {
  interface Window { pet: PetBridge }
}

const SCALE = 1.6;
// The cat draws into a small canvas that moves around a full-screen transparent window.
const CANVAS_W = 220;
const CANVAS_H = 190;
const ORIGIN_X = CANVAS_W / 2;
const ORIGIN_Y = CANVAS_H - 6;

const pet = window.pet;
const canvas = document.getElementById("cat") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(CANVAS_W * dpr);
canvas.height = Math.round(CANVAS_H * dpr);
canvas.style.width = `${CANVAS_W}px`;
canvas.style.height = `${CANVAS_H}px`;

let width = window.innerWidth;
let height = window.innerHeight;
let cursor: { x: number; y: number } | null = null;
let idleSeconds = 0;
let hovering = false;
let clickThrough = true;

const demo = new URLSearchParams(location.search).has("demo");
const brain = new CatBrain({ scale: SCALE, x: width * 0.75, groundY: height, demo });

function canvasLeft(): number { return Math.round(brain.x - ORIGIN_X); }
function canvasTop(): number { return Math.round(brain.y - ORIGIN_Y); }

/** Is the cursor over a visible pixel of the cat? */
function hitTest(x: number, y: number): boolean {
  const lx = x - canvasLeft();
  const ly = y - canvasTop();
  if (lx < 0 || ly < 0 || lx >= CANVAS_W || ly >= CANVAS_H) return false;
  return ctx.getImageData(Math.floor(lx * dpr), Math.floor(ly * dpr), 1, 1).data[3] > 24;
}

// Read by `--selftest` and the on-screen test harness (PET2_TEST_STATE).
(window as unknown as { __debug: () => object }).__debug = () => ({
  rect: { x: canvasLeft(), y: canvasTop(), width: CANVAS_W, height: CANVAS_H },
  origin: { x: Math.round(brain.x), y: Math.round(brain.y) },
  activity: brain.activity,
  hovering,
  clickThrough,
  held: brain.isHeld,
  purr: Math.round(brain.purrLevel * 100) / 100,
});

function setClickThrough(through: boolean): void {
  if (through === clickThrough) return;
  clickThrough = through;
  pet.setClickThrough(through);
}

/** Only the cat itself catches the mouse; everywhere else clicks go to the apps below. */
function updateHover(): void {
  hovering = cursor ? hitTest(cursor.x, cursor.y) : false;
  if (!brain.isHeld) setClickThrough(!hovering);
}

pet.onCursor((x, y) => {
  cursor = { x, y };
  updateHover();
});

pet.onBounds((w, h) => {
  width = w;
  height = h;
});

async function pollIdle(): Promise<void> {
  try { idleSeconds = await pet.idleSeconds(); } catch { /* keep last value */ }
}
setInterval(pollIdle, 1000);

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  brain.pointerDown(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => brain.pointerMove(e.clientX, e.clientY));
canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  brain.pointerUp();
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  pet.showMenu();
});

let last = performance.now();

function frame(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  brain.update(dt, { cursor, hovering, width, groundY: height, idleSeconds, hour: new Date().getHours() });

  canvas.style.transform = `translate(${canvasLeft()}px, ${canvasTop()}px)`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawCat(ctx, brain.renderState(), DEFAULT_COAT, SCALE, ORIGIN_X, ORIGIN_Y);
  // The cat moves under a resting cursor too, so re-check what's under it.
  updateHover();

  // A napping cat redraws a few times a second; an active one runs at full rate.
  const fps = brain.fps;
  if (fps >= 60) requestAnimationFrame(frame);
  else setTimeout(frame, 1000 / fps);
}

pollIdle();
frame();
