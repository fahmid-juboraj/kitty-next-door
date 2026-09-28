// The cat's behavior. Pure logic: no DOM, no Electron. The host feeds it
// cursor/idle/screen info and draws whatever `renderState()` returns.
import type { Particle, RenderState } from "./draw";
import { blendPose, clonePose, POSES, type Pose, type PoseName } from "./pose";

/** The parts of a cat worth keeping between tabs and sessions. */
export interface CatSnapshot {
  xFrac: number;
  energy: number;
  affection: number;
  facing: 1 | -1;
}

export type Activity = "stand" | "walk" | "sit" | "loaf" | "sleep" | "carried" | "fall" | "land";

export interface WorldInput {
  /** Overlay-local pixels, or null when unknown. */
  cursor: { x: number; y: number } | null;
  /** True when the cursor is over the cat's visible pixels. */
  hovering: boolean;
  width: number;
  groundY: number;
  idleSeconds: number;
  hour: number;
}

const WALK_SPEED = 34; // cat units per second
const GRAVITY = 2400; // px/s²
const SLOW_BLINK_S = 2.4;

const POSE_FOR: Record<Activity, PoseName> = {
  stand: "stand", walk: "stand", sit: "sit", loaf: "loaf", sleep: "sleep",
  carried: "carried", fall: "fall", land: "stand",
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const approach = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

function pickWeighted<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = Math.random() * entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  for (const [k, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return k;
  }
  return entries[0][0];
}

export class CatBrain {
  /** Ground-origin position in overlay pixels. */
  x: number;
  y: number;
  facing: 1 | -1 = 1;
  activity: Activity = "sit";

  private readonly scale: number;
  private timer = rand(4, 8);
  private pose: Pose = clonePose(POSES.sit);
  private time = 0;
  private walkPhase = 0;
  private walkAmount = 0;
  private walkTargetX = 0;
  private facingScale = 1;
  private breathPhase = 0;
  private look = { x: 0.3, y: 0 };
  private lookTarget = { x: 0.3, y: 0 };
  private headTilt = 0;
  private attention = 0;
  private attentionTimer = 0;
  private saccadeTimer = 0;
  private behindTimer = 0;
  private energy = 0.8;
  private affection = 0.5;
  private blink = 1;
  private blinkTimer = rand(2, 5);
  private blinkT = -1;
  /** Seconds into a slow blink; negative while waiting to start; null when idle. */
  private slowBlinkT: number | null = null;
  private purr = 0;
  private rub = 0;
  private heartTimer = 0;
  private zTimer = 0;
  private boop = 0;
  private grumpy = 0;
  private squash = 1;
  private vx = 0;
  private vy = 0;
  private dragging = false;
  private press: { x: number; y: number; t: number } | null = null;
  private dragPrev: { x: number; t: number } | null = null;
  private dragVx = 0;
  private userAway = false;
  private greetPending = false;
  private lastCursor: { x: number; y: number } | null = null;
  private cursorStill = 0;
  private particles: Particle[] = [];
  private width = 800;
  private groundY = 600;
  /** Walking off-screen for good (a guest going home). */
  private exiting = false;
  private isGone = false;
  /** Walking-speed multiplier for the current walk (1 = stroll, 2+ = zoomies). */
  private speedMul = 1;

  private readonly awayAfterS: number;
  private readonly slowBlinkRate: number;

  /** `demo` shortens timers so the greeting and slow blink are quick to capture on video. */
  constructor(opts: { scale: number; x: number; groundY: number; demo?: boolean }) {
    this.scale = opts.scale;
    this.awayAfterS = opts.demo ? 10 : 120;
    this.slowBlinkRate = opts.demo ? 0.5 : 0.05;
    this.x = opts.x;
    this.y = opts.groundY;
    this.groundY = opts.groundY;
  }

  /** True while the mouse button is held on the cat (dragging or about to). */
  get isHeld(): boolean {
    return this.dragging || this.press !== null;
  }

  get purrLevel(): number {
    return this.purr;
  }

  /** Walked off the edge after `leave()`. */
  get gone(): boolean {
    return this.isGone;
  }

  /** Sitting, standing or loafing, and not being handled. */
  get settled(): boolean {
    return !this.isHeld && !this.exiting &&
      (this.activity === "sit" || this.activity === "stand" || this.activity === "loaf");
  }

  snapshot(): CatSnapshot {
    return {
      xFrac: clamp(this.x / Math.max(1, this.width), 0, 1),
      energy: this.energy,
      affection: this.affection,
      facing: this.facing,
    };
  }

  restore(s: Partial<CatSnapshot>, width: number): void {
    this.width = width;
    if (typeof s.xFrac === "number" && Number.isFinite(s.xFrac)) this.x = clamp(s.xFrac, 0, 1) * width;
    if (typeof s.energy === "number" && Number.isFinite(s.energy)) this.energy = clamp(s.energy, 0, 1);
    if (typeof s.affection === "number" && Number.isFinite(s.affection)) this.affection = clamp(s.affection, 0, 1);
    if (s.facing === 1 || s.facing === -1) this.facing = s.facing;
    this.facingScale = this.facing;
  }

  /** Start just off-screen on one side and walk in, to `targetX` if given. */
  enterFrom(side: -1 | 1, width: number, targetX?: number): void {
    this.width = width;
    this.x = side < 0 ? -40 * this.scale : width + 40 * this.scale;
    this.facing = side < 0 ? 1 : -1;
    this.facingScale = this.facing;
    const margin = 50 * this.scale;
    this.walkTargetX = targetX !== undefined
      ? clamp(targetX, margin, width - margin)
      : side < 0 ? rand(0.15, 0.4) * width : rand(0.6, 0.85) * width;
    this.setActivity("walk", Infinity);
  }

  /** Walk off the nearest edge; `gone` turns true once out of sight. */
  leave(): void {
    this.exiting = true;
    this.walkTargetX = this.x < this.width / 2 ? -60 * this.scale : this.width + 60 * this.scale;
    this.setActivity("walk", Infinity);
  }

  /** Something arriving at `x`: stop, turn toward it, and sit watching for a while. */
  waitFor(x: number, seconds: number): void {
    if (this.isHeld || this.exiting) return;
    this.facing = x > this.x ? 1 : -1;
    this.setActivity("sit", seconds);
    this.attention = 0;
    this.lookTarget = { x: 0.9, y: 0 };
    this.saccadeTimer = seconds;
  }

  /** Walk to `x` at `speedMul` times normal speed, then carry on as usual. For scenes like the park. */
  goTo(x: number, speedMul = 1): void {
    if (this.isHeld || this.exiting) return;
    const margin = 50 * this.scale;
    this.walkTargetX = clamp(x, margin, this.width - margin);
    if (Math.abs(this.walkTargetX - this.x) < 8) return;
    this.speedMul = speedMul;
    this.setActivity("walk", Infinity);
  }

  /** Another cat is close by: turn to it, sit together, share a heart. */
  meet(otherX: number): void {
    if (!this.settled) return;
    this.facing = otherX > this.x ? 1 : -1;
    this.setActivity("sit", rand(6, 10));
    this.attention = 0;
    this.lookTarget = { x: 0.9, y: 0 };
    this.saccadeTimer = 4;
    this.spawn("heart", 2);
  }

  /** Suggested redraw rate so a napping cat costs almost nothing. */
  get fps(): number {
    if (this.dragging || this.activity === "fall" || this.activity === "walk" || this.purr > 0.05) return 60;
    if (this.activity === "sleep") return 12;
    return 24;
  }

  update(dtRaw: number, w: WorldInput): void {
    const dt = Math.min(dtRaw, 0.1);
    this.time += dt;
    this.width = w.width;
    if (this.groundY !== w.groundY && this.activity !== "carried" && this.activity !== "fall") this.y = w.groundY;
    this.groundY = w.groundY;
    const night = w.hour >= 23 || w.hour < 6;

    this.trackPresence(w);
    this.trackCursor(dt, w);

    this.energy = clamp(
      this.activity === "sleep" ? this.energy + dt / (8 * 60) : this.energy - dt / ((night ? 15 : 30) * 60),
      0, 1,
    );

    this.updateActivity(dt, w, night);
    this.updateEyes(dt, w);
    this.updateEffects(dt);
    this.updatePose(dt, night);
  }

  // ---- input from the host ----------------------------------------------

  pointerDown(x: number, y: number): void {
    this.press = { x, y, t: this.time };
  }

  pointerMove(x: number, y: number): void {
    if (!this.press) return;
    if (!this.dragging && Math.hypot(x - this.press.x, y - this.press.y) > 6) {
      this.dragging = true;
      this.setActivity("carried", Infinity);
      this.purr = 0;
      this.rub = 0;
      this.dragPrev = { x, t: this.time };
    }
    if (this.dragging) {
      // Hold the cat by the scruff, just behind the head.
      this.x = clamp(x - 2 * this.scale * this.facing, 0, this.width);
      this.y = Math.min(y + 50 * this.scale, this.groundY);
      if (this.dragPrev && this.time > this.dragPrev.t) {
        this.dragVx = (x - this.dragPrev.x) / (this.time - this.dragPrev.t);
      }
      this.dragPrev = { x, t: this.time };
    }
  }

  pointerUp(): void {
    if (this.dragging) {
      this.dragging = false;
      this.vx = clamp(this.dragVx * 0.3, -600, 600);
      this.vy = 0;
      this.setActivity(this.y >= this.groundY - 1 ? "land" : "fall", Infinity);
      if (this.activity === "land") this.onLanded();
    } else if (this.press) {
      this.onBoop();
    }
    this.press = null;
    this.dragPrev = null;
  }

  // ---- behavior -------------------------------------------------------------

  private trackPresence(w: WorldInput): void {
    if (!this.userAway && w.idleSeconds > this.awayAfterS) {
      this.userAway = true;
    } else if (this.userAway && w.idleSeconds < 2) {
      this.userAway = false;
      this.greetPending = true;
      if (this.activity === "sleep" || this.activity === "loaf") this.timer = rand(0.8, 1.8);
    }
  }

  private trackCursor(dt: number, w: WorldInput): void {
    const c = w.cursor;
    if (c && this.lastCursor) {
      const moved = Math.hypot(c.x - this.lastCursor.x, c.y - this.lastCursor.y);
      this.cursorStill = moved < 1 ? this.cursorStill + dt : 0;
      // Rubbing the cursor over the cat is petting.
      if (w.hovering && !this.dragging && !this.press) this.rub += moved;
    }
    this.rub *= Math.exp(-dt * 1.5);
    this.lastCursor = c ? { ...c } : null;

    if (this.rub > 90 && this.activity !== "carried" && this.activity !== "fall") {
      if (this.activity === "walk" || this.activity === "stand") this.setActivity("sit", rand(8, 14));
      if (this.activity === "sleep") this.setActivity("loaf", rand(10, 20));
      this.affection = clamp(this.affection + dt * 0.02, 0, 1);
    }
  }

  private setActivity(a: Activity, duration: number): void {
    this.activity = a;
    this.timer = duration;
  }

  private updateActivity(dt: number, w: WorldInput, night: boolean): void {
    const S = this.scale;
    switch (this.activity) {
      case "carried":
        return;
      case "fall": {
        this.vy += GRAVITY * dt;
        this.y += this.vy * dt;
        this.x = clamp(this.x + this.vx * dt, 20, this.width - 20);
        this.vx *= Math.exp(-dt * 1.5);
        if (this.y >= this.groundY) {
          this.y = this.groundY;
          this.setActivity("land", 0.4);
          this.onLanded();
        }
        return;
      }
      case "walk": {
        const dx = this.walkTargetX - this.x;
        const speed = WALK_SPEED * S * this.speedMul;
        if (Math.abs(dx) < 4) {
          this.speedMul = 1;
          if (this.exiting) this.isGone = true;
          else this.decideNext(w, night);
          return;
        }
        this.facing = dx > 0 ? 1 : -1;
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        this.walkPhase += (dt * WALK_SPEED * this.speedMul * Math.PI * 2) / 26;
        return;
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    // After the thump, sit and look mildly offended.
    if (this.activity === "land") this.setActivity("sit", rand(5, 9));
    else this.decideNext(w, night);
  }

  private decideNext(w: WorldInput, night: boolean): void {
    const cursor = w.cursor;
    if (this.exiting) return this.leave();

    if (this.greetPending) {
      // You came back: wake, look at you, slow-blink, then come over.
      this.greetPending = false;
      if (this.activity === "sleep" || this.activity === "loaf") {
        this.setActivity("sit", rand(1.8, 2.6));
        this.attention = 1;
        this.attentionTimer = 6;
        this.slowBlinkT = -0.6;
        this.greetPending = !!cursor;
        return;
      }
      if (cursor) return this.walkTo(cursor.x, 1);
    }

    if (this.userAway) {
      if (this.activity !== "loaf" && this.activity !== "sleep") return this.setActivity("loaf", rand(10, 25));
      return this.setActivity("sleep", rand(120, 300));
    }

    if (this.activity === "sleep" && this.energy < 0.9) return this.setActivity("sleep", rand(40, 90));

    const next = pickWeighted({
      sit: 3,
      stand: 1,
      loaf: 1.5 + (1 - this.energy) * 2,
      walk: 0.5 + this.energy * 2.5,
      sleep: Math.max(0, 0.45 - this.energy) * 20 + (night ? 3 : 0),
    });
    switch (next) {
      case "walk": {
        if (cursor && Math.random() < 0.35 + this.affection * 0.2) return this.walkTo(cursor.x, 0.85);
        const dist = rand(150, 600) * (Math.random() < 0.5 ? -1 : 1);
        return this.walkTo(this.x + dist, 1);
      }
      case "sit": return this.setActivity("sit", rand(6, 18));
      case "stand": return this.setActivity("stand", rand(2, 6));
      case "loaf": return this.setActivity("loaf", rand(12, 40));
      case "sleep": return this.setActivity("sleep", night ? rand(240, 600) : rand(60, 200));
    }
  }

  /** Walk toward `targetX`, stopping `approachFrac` of the way (to not sit on the cursor). */
  private walkTo(targetX: number, approachFrac: number): void {
    const margin = 50 * this.scale;
    const tx = this.x + (targetX - this.x) * approachFrac;
    this.walkTargetX = clamp(tx, margin, this.width - margin);
    this.speedMul = 1;
    if (Math.abs(this.walkTargetX - this.x) < 20) return this.setActivity("sit", rand(5, 12));
    this.setActivity("walk", Infinity);
  }

  private onLanded(): void {
    this.squash = 0.72;
    this.grumpy = 2.5;
    this.vx = 0;
    this.vy = 0;
    this.timer = 0.4;
  }

  private onBoop(): void {
    this.boop = 1;
    this.squash = Math.min(this.squash, 0.9);
    this.attention = 1;
    this.attentionTimer = 4;
    this.spawn("heart", 1);
    this.affection = clamp(this.affection + 0.02, 0, 1);
    if (this.activity === "sleep") {
      this.grumpy = 1.5;
      this.setActivity("sit", rand(4, 8));
    } else if (this.activity === "walk" && !this.exiting) {
      this.setActivity("stand", rand(2, 4));
    }
  }

  private headPx(): { x: number; y: number } {
    return {
      x: this.x + this.pose.headX * this.scale * this.facingScale,
      y: this.y + this.pose.headY * this.scale,
    };
  }

  private updateEyes(dt: number, w: WorldInput): void {
    const c = w.cursor;
    const awake = this.activity !== "sleep";

    this.attentionTimer -= dt;
    if (this.attentionTimer <= 0) {
      const settled = this.activity === "sit" || this.activity === "stand" || this.activity === "loaf";
      let p = settled ? 0.6 : 0.25;
      if (c && Math.abs(c.x - this.x) < 250 && this.cursorStill < 0.5) p = 0.85;
      this.attention = Math.random() < p ? 1 : 0;
      this.attentionTimer = rand(2, 7);
    }

    if (this.attention > 0.5 && c && awake) {
      const h = this.headPx();
      const dx = (c.x - h.x) * this.facing;
      const dy = c.y - h.y;
      const d = Math.hypot(dx, dy) || 1;
      const mag = Math.min(1, d / 90);
      this.lookTarget = { x: (dx / d) * mag, y: (dy / d) * mag };

      // A sitting cat turns around if you've been behind it for a while.
      if (dx < -120 && (this.activity === "sit" || this.activity === "stand")) {
        this.behindTimer += dt;
        if (this.behindTimer > 1.2) {
          this.facing = this.facing === 1 ? -1 : 1;
          this.behindTimer = 0;
        }
      } else {
        this.behindTimer = 0;
      }

      if (this.cursorStill > 2.5 && this.slowBlinkT === null && Math.random() < dt * this.slowBlinkRate) this.slowBlinkT = 0;
    } else {
      this.saccadeTimer -= dt;
      if (this.saccadeTimer <= 0) {
        const walking = this.activity === "walk";
        this.lookTarget = walking ? { x: 0.5, y: 0.1 } : { x: rand(-0.4, 0.9), y: rand(-0.5, 0.4) };
        this.saccadeTimer = rand(1, 3.5);
      }
    }
    this.look.x = approach(this.look.x, this.lookTarget.x, 12, dt);
    this.look.y = approach(this.look.y, this.lookTarget.y, 12, dt);
    this.headTilt = approach(this.headTilt, this.attention > 0.5 ? this.look.x * 0.06 + this.look.y * 0.04 : 0, 4, dt);

    // Quick blinks.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkTimer = rand(2.5, 7);
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.16;
      this.blink = k < 0.5 ? 1 - k * 2 : Math.min(1, (k - 0.5) * 2);
      if (k >= 1) this.blinkT = -1;
    } else {
      this.blink = 1;
    }
    if (this.slowBlinkT !== null) {
      this.slowBlinkT += dt;
      if (this.slowBlinkT > SLOW_BLINK_S) {
        this.slowBlinkT = null;
        this.affection = clamp(this.affection + 0.01, 0, 1);
      }
    }
  }

  /** 1 = open, 0 = closed. Close slowly, hold, open slowly. */
  private slowBlinkFactor(): number {
    const t = this.slowBlinkT;
    if (t === null || t < 0) return 1;
    if (t < 0.9) return 1 - t / 0.9;
    if (t < 1.4) return 0;
    return Math.min(1, (t - 1.4) / 1.0);
  }

  private spawn(kind: Particle["kind"], n = 1): void {
    const hx = this.pose.headX * this.facingScale;
    for (let i = 0; i < n; i++) {
      this.particles.push(kind === "z"
        ? { kind, x: hx + 10 * this.facing, y: this.pose.headY - 14, vx: 3 * this.facing, vy: -6, age: 0, life: 3 }
        : { kind, x: hx + rand(-6, 6), y: this.pose.headY - 18, vx: rand(-3, 3), vy: -12, age: 0, life: 1.6 });
    }
  }

  private updateEffects(dt: number): void {
    const petting = this.rub > 90 && this.activity !== "carried" && this.activity !== "fall";
    this.purr = approach(this.purr, petting ? 1 : 0, petting ? 3 : 1.2, dt);
    if (this.purr > 0.5) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.spawn("heart");
        this.heartTimer = rand(0.5, 0.9);
      }
    }
    if (this.activity === "sleep" && this.purr < 0.1) {
      this.zTimer -= dt;
      if (this.zTimer <= 0) {
        this.spawn("z");
        this.zTimer = 1.9;
      }
    }
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.boop = Math.max(0, this.boop - dt * 2);
    this.grumpy = Math.max(0, this.grumpy - dt);
    this.squash = approach(this.squash, 1, 7, dt);
    this.walkAmount = approach(this.walkAmount, this.activity === "walk" ? 1 : 0, 8, dt);
    this.facingScale = approach(this.facingScale, this.facing, 14, dt);
    const breathPeriod = this.activity === "sleep" ? 4.2 : 2.8;
    this.breathPhase += (dt * Math.PI * 2) / breathPeriod;
  }

  private updatePose(dt: number, night: boolean): void {
    const target = clonePose(POSES[POSE_FOR[this.activity]]);
    const awake = this.activity !== "sleep";

    // Soft, bowed lids read as sleepy/content; flat lids (grumpy, below) read as unimpressed.
    if (awake && night) {
      target.eyeOpen *= 0.8;
      target.eyeHappy = 0.35;
    }
    if (awake && this.slowBlinkT !== null && this.slowBlinkT >= 0) target.eyeHappy = Math.max(target.eyeHappy, 0.45);
    if (this.grumpy > 0) {
      target.earPerk = Math.min(target.earPerk, 0.45);
      target.eyeOpen = Math.min(target.eyeOpen, 0.6);
      target.eyeHappy = 0;
    }
    if (this.purr > 0.3) {
      target.eyeHappy = 1;
      target.earPerk = Math.min(target.earPerk, 0.75);
    }
    if (this.boop > 0) {
      target.mouthOpen = 1;
      target.earPerk = 1;
    }
    if (awake) target.eyeOpen *= this.slowBlinkFactor();

    const fast = this.activity === "carried" || this.activity === "fall";
    blendPose(this.pose, target, 1 - Math.exp(-(fast ? 14 : 6) * dt));
    // Eyes and mouth react faster than the body moves.
    const kFace = 1 - Math.exp(-14 * dt);
    this.pose.eyeOpen += (target.eyeOpen - this.pose.eyeOpen) * kFace;
    this.pose.mouthOpen += (target.mouthOpen - this.pose.mouthOpen) * kFace;
    this.pose.eyeHappy = target.eyeHappy;
  }

  renderState(): RenderState {
    const sleeping = this.activity === "sleep";
    return {
      pose: this.pose,
      time: this.time,
      walkPhase: this.walkPhase,
      walkAmount: this.walkAmount,
      look: this.look,
      headTilt: this.headTilt,
      facingScale: this.facingScale,
      breathPhase: this.breathPhase,
      blink: this.blink,
      purr: this.purr,
      squash: this.squash,
      tailSway: sleeping ? 0.25 : this.activity === "walk" ? 1.2 : this.purr > 0.3 ? 1.4 : 0.8,
      particles: this.particles,
    };
  }
}
