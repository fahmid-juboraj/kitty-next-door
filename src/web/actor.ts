// A cat drawn into a small canvas that moves around a fixed, full-viewport
// layer. Shared by the browser extension and the visit landing page.
import { CatBrain } from "../core/brain";
import type { Coat } from "../core/coats";
import { drawCat } from "../core/draw";

const W = 220;
const H = 190;
const OX = W / 2;
const OY = H - 6;

export class CatActor {
  readonly brain: CatBrain;
  readonly canvas: HTMLCanvasElement;
  coat: Coat;
  hovering = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 3);

  constructor(parent: Node, coat: Coat, opts: { x: number; groundY: number; scale?: number; demo?: boolean }) {
    this.coat = coat;
    this.scale = opts.scale ?? 1.5;
    this.brain = new CatBrain({ scale: this.scale, x: opts.x, groundY: opts.groundY, demo: opts.demo });
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    // Inline styles only: some sites' CSP blocks injected stylesheets.
    Object.assign(this.canvas.style, {
      position: "absolute", left: "0", top: "0", width: `${W}px`, height: `${H}px`,
      pointerEvents: "none", touchAction: "none", willChange: "transform",
    });
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    parent.appendChild(this.canvas);

    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.canvas.setPointerCapture(e.pointerId);
      this.brain.pointerDown(e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointermove", (e) => this.brain.pointerMove(e.clientX, e.clientY));
    const release = (e: PointerEvent) => {
      if (e.button !== 0 && e.type === "pointerup") return;
      this.brain.pointerUp();
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    // Keep clicks on the cat from reaching the page underneath.
    this.canvas.addEventListener("click", (e) => e.stopPropagation());
  }

  get left(): number { return Math.round(this.brain.x - OX); }
  get top(): number { return Math.round(this.brain.y - OY); }

  /** Head position in viewport pixels, for placing speech bubbles. */
  get headTop(): { x: number; y: number } {
    return { x: this.brain.x, y: this.brain.y - 80 * this.scale };
  }

  hitTest(x: number, y: number): boolean {
    const lx = x - this.left;
    const ly = y - this.top;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) return false;
    return this.ctx.getImageData(Math.floor(lx * this.dpr), Math.floor(ly * this.dpr), 1, 1).data[3] > 24;
  }

  /** Only the cat's own pixels catch the mouse; the rest of the page stays usable. */
  updateHover(cursor: { x: number; y: number } | null): void {
    this.hovering = cursor ? this.hitTest(cursor.x, cursor.y) : false;
    const active = this.hovering || this.brain.isHeld;
    this.canvas.style.pointerEvents = active ? "auto" : "none";
    this.canvas.style.cursor = this.brain.isHeld ? "grabbing" : active ? "grab" : "";
  }

  render(): void {
    this.canvas.style.transform = `translate(${this.left}px, ${this.top}px)`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, W, H);
    drawCat(this.ctx, this.brain.renderState(), this.coat, this.scale, OX, OY);
  }

  destroy(): void {
    this.canvas.remove();
  }
}

/** A plain-text speech bubble. Content is always set with textContent. */
export class Bubble {
  readonly el: HTMLDivElement;
  private hideAt = 0;

  constructor(parent: Node) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "absolute", left: "0", top: "0", maxWidth: "240px", padding: "8px 12px",
      background: "#fffaf3", color: "#3b2b27", border: "2px solid #3b2b27", borderRadius: "14px",
      font: "500 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,.18)",
      pointerEvents: "none", opacity: "0", transition: "opacity .25s", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
      transform: "translate(-9999px, 0)",
    });
    parent.appendChild(this.el);
  }

  /** Lines are rendered as separate text nodes; the first one is bold. */
  show(lines: string[], ms: number): void {
    this.el.replaceChildren();
    lines.filter(Boolean).forEach((line, i) => {
      const div = document.createElement("div");
      div.textContent = line;
      if (i === 0) div.style.fontWeight = "700";
      this.el.appendChild(div);
    });
    this.el.style.opacity = "1";
    this.hideAt = performance.now() + ms;
  }

  /** Keep the bubble above a point, inside the viewport. */
  follow(x: number, y: number): void {
    if (this.hideAt && performance.now() > this.hideAt) {
      this.el.style.opacity = "0";
      this.hideAt = 0;
    }
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    const top = Math.max(8, y - h);
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  destroy(): void {
    this.el.remove();
  }
}

/** Run `tick` at the rate it returns; pauses while the tab is hidden. */
export function startLoop(tick: (dt: number) => number): { stop(): void } {
  let last = performance.now();
  let timer = 0;
  let raf = 0;
  let stopped = false;
  const frame = () => {
    raf = 0;
    timer = 0;
    if (stopped || document.hidden) return;
    const now = performance.now();
    const fps = tick((now - last) / 1000);
    last = now;
    if (fps >= 60) raf = requestAnimationFrame(frame);
    else timer = window.setTimeout(frame, 1000 / fps);
  };
  const onVisible = () => {
    if (!document.hidden && !raf && !timer && !stopped) {
      last = performance.now();
      frame();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  frame();
  return {
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
