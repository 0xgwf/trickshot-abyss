import type { Enemy } from './enemy.ts';
import type { Part } from './types.ts';

let nextUid = 1;

/** A special ball the player owns (occupies a slot). */
export interface OwnedBall {
  uid: number;
  /** One part normally, two when fused. */
  parts: Part[];
  fused: boolean;
  state: 'queued' | 'flying' | 'cooldown';
  cooldown: number;
}

export const newOwnedBall = (parts: Part[], fused = false): OwnedBall => ({
  uid: nextUid++,
  parts,
  fused,
  state: 'queued',
  cooldown: 0,
});

export type BallTag = 'normal' | 'iron' | 'stone' | 'sniper' | 'flesh' | 'wind';

/** A ball on the field. */
export class Ball {
  readonly uid = nextUid++;
  parts: Part[];
  owned: OwnedBall | null;
  baby: boolean;
  /** Spawned extras vanish at the bottom instead of returning. */
  temp: boolean;
  tag: BallTag = 'normal';
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  r: number;
  speed: number;
  state: 'fly' | 'return' = 'fly';
  age = 0;
  bounces = 0;
  /** Running damage multiplier (Stone erosion, Hourglass decay, Steel growth…). */
  dmgMul = 1;
  hitWall = false;
  hitBack = false;
  /** Passes through enemies until it touches the back wall (Ethereal Cloak, Drill…). */
  pierceUntilBack = false;
  /** Passes through enemies until it touches any wall (The Embedded). */
  pierceUntilWall = false;
  pierce = false;
  dieOnHit = false;
  dieOnWall = false;
  /** Damage multiplier for spawned babies (Cohabitants etc.). */
  power = 1;
  nextHitBonus = 0;
  /** Per-enemy re-hit cooldown so pass-through balls hit each enemy once per pass. */
  hitCd = new Map<Enemy, number>();
  /** Behaviour timers keyed by name (auras, emitters). */
  timers: Record<string, number> = {};
  trail: { x: number; y: number }[] = [];
  /** Seconds left before a temporary copy fades out (Infinity = until it leaves the bottom). */
  life = Infinity;
  /** For the Repentant: flying back up after touching the back wall. */
  repentReturn = false;
  dead = false;

  constructor(parts: Part[], owned: OwnedBall | null, x: number, y: number, r: number, speed: number, baby: boolean, temp: boolean) {
    this.parts = parts;
    this.owned = owned;
    this.x = x;
    this.y = y;
    this.r = r;
    this.speed = speed;
    this.baby = baby;
    this.temp = temp;
  }

  get passThrough() {
    return this.pierce || this.pierceUntilBack || this.pierceUntilWall || this.parts.some((p) => p.def.passThrough);
  }

  get destroysOnHit() {
    return this.dieOnHit || this.parts.some((p) => p.def.destroyOnHit);
  }

  setAngle(a: number) {
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  }

  /** Re-normalises velocity to the current speed. */
  normalize() {
    const len = Math.hypot(this.vx, this.vy) || 1;
    this.vx = (this.vx / len) * this.speed;
    this.vy = (this.vy / len) * this.speed;
  }
}
