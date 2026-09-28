// A pose is a flat bag of numbers so any two poses can be blended.
// Units are "cat units" (scaled at draw time). Origin is the ground point
// under the cat, +x is the direction the cat faces, +y points down.
export interface Pose {
  bodyX: number;
  bodyY: number;
  bodyW: number;
  bodyH: number;
  bodyRot: number;
  headX: number;
  headY: number;
  headRot: number;
  /** Hip x in body-local space. */
  frontHipX: number;
  backHipX: number;
  /** 0 = legs tucked inside the body, 1 = fully extended. */
  frontLegExt: number;
  backLegExt: number;
  /** 0 = feet on the ground, 1 = legs dangling. */
  airborne: number;
  /** Sitting thigh. */
  haunch: number;
  /** Paws peeking out at the front while loafing. */
  frontPaws: number;
  /** Tail direction (radians, local space) and curl. */
  tailAngle: number;
  tailCurl: number;
  tailLen: number;
  /** 0 = tail in the air, 1 = wrapped along the ground in front. */
  tailWrap: number;
  earPerk: number;
  eyeOpen: number;
  eyeHappy: number;
  eyeSize: number;
  mouthOpen: number;
}

export type PoseName = "stand" | "sit" | "loaf" | "sleep" | "carried" | "fall";

const stand: Pose = {
  bodyX: -2, bodyY: -21, bodyW: 44, bodyH: 27, bodyRot: 0,
  headX: 19, headY: -36, headRot: 0,
  frontHipX: 12, backHipX: -13, frontLegExt: 1, backLegExt: 1, airborne: 0,
  haunch: 0, frontPaws: 0,
  tailAngle: -2.3, tailCurl: 0.55, tailLen: 24, tailWrap: 0,
  earPerk: 1, eyeOpen: 1, eyeHappy: 0, eyeSize: 1, mouthOpen: 0,
};

export const POSES: Record<PoseName, Pose> = {
  stand,
  sit: {
    ...stand,
    bodyX: -6, bodyY: -21, bodyW: 38, bodyH: 29, bodyRot: -0.6,
    headX: 12, headY: -46,
    frontHipX: 13, backHipX: -10, backLegExt: 0,
    haunch: 1,
    tailAngle: -2.9, tailCurl: 0.2, tailLen: 25, tailWrap: 1,
  },
  loaf: {
    ...stand,
    bodyX: -2, bodyY: -14, bodyW: 46, bodyH: 27,
    headX: 18, headY: -28,
    frontLegExt: 0, backLegExt: 0, frontPaws: 1,
    tailAngle: -2.9, tailCurl: 0.2, tailWrap: 1,
    earPerk: 0.85,
  },
  sleep: {
    ...stand,
    bodyX: -2, bodyY: -13, bodyW: 47, bodyH: 25,
    headX: 17, headY: -21, headRot: 0.14,
    frontLegExt: 0, backLegExt: 0, frontPaws: 1,
    tailAngle: -2.9, tailCurl: 0.2, tailWrap: 1,
    earPerk: 0.55, eyeOpen: 0,
  },
  carried: {
    ...stand,
    bodyX: 0, bodyY: -30, bodyW: 40, bodyH: 26, bodyRot: -1.4,
    headX: 3, headY: -57,
    frontHipX: 11, backHipX: -12, airborne: 1,
    tailAngle: -4.75, tailCurl: 0.35, tailLen: 22,
    earPerk: 0.35, eyeOpen: 0.55,
  },
  fall: {
    ...stand,
    bodyX: 0, bodyY: -30, bodyW: 40, bodyH: 26, bodyRot: -1.2,
    headX: 5, headY: -56,
    frontHipX: 11, backHipX: -12, airborne: 1,
    tailAngle: -1.5, tailCurl: 0.8, tailLen: 24,
    earPerk: 0.1, eyeOpen: 1, eyeSize: 1.15,
  },
};

export function clonePose(p: Pose): Pose {
  return { ...p };
}

/** Move `cur` toward `target` in place. `k` is the blend fraction for this frame. */
export function blendPose(cur: Pose, target: Pose, k: number): void {
  for (const key in target) {
    const K = key as keyof Pose;
    cur[K] += (target[K] - cur[K]) * k;
  }
}
