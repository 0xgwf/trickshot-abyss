import { TILE } from './config.ts';
import type { HitSide, Range } from './types.ts';

export type EnemyAi =
  'melee' | 'archer' | 'bishop' | 'beast' | 'hurler' | 'brigade' | 'ballista' | 'champion' | 'howler' | 'king' | 'queen';

export interface EnemyDef {
  id: string;
  zh: string;
  en: string;
  /** Wiki "Health Scale" relative to the level's 1x enemy. */
  hpMul: number;
  /** Footprint in tiles. */
  w: number;
  h: number;
  ai: EnemyAi;
  /** Damage of a melee hit or of reaching the bottom (est.). */
  dmg: number;
  xp: number;
  rank: 'normal' | 'miniboss' | 'boss';
  /** Pixel sprite to draw (defaults to the id). */
  sprite?: string;
  tint?: 'ice';
  /** Balls hitting this side bounce off without dealing damage (shields). */
  immuneSide?: HitSide;
}

/** One stack-based damage-over-time status (burn, poison, frostburn, venom, disease, darkflame). */
export interface Dot {
  stacks: number;
  max: number;
  dmg: Range;
  timer: number; // remaining seconds; all stacks share it and it refreshes on application
  tick: number; // time until next damage tick
  /** Disease: chance per second to pass a stack to a nearby enemy. */
  spread?: number;
}

/** Hit box part; balls only damage "weak" parts (e.g. the Skeleton King's crown). */
export interface Collider {
  x: number;
  y: number;
  w: number;
  h: number;
  weak: boolean;
}

export const newDot = (): Dot => ({ stacks: 0, max: 0, dmg: [0, 0], timer: 0, tick: 1 });

export interface Curse {
  hits: number;
  needed: number;
  dmg: Range;
}

export class Enemy {
  readonly def: EnemyDef;
  /** Top-left in world px. */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  dead = false;
  /** Row index at which it spawned (drives HP scaling). */
  row: number;
  /** Custom hit boxes (bosses); null means the whole box is weak. */
  colliders: Collider[] | null = null;
  invulnerable = false;
  dropsLoot = true;

  flash = 0;
  shake = 0;
  attackCd = 0;
  windup = 0; // >0 while telegraphing a melee attack
  shootCd = 0;
  aiTimer = 0;
  aiState = 0;
  aiAngle = 0;

  // --- statuses ---
  bleed = 0;
  bleedMax = 0;
  burn: Dot = newDot();
  poison: Dot = newDot();
  frostburn: Dot = newDot();
  venom: Dot = newDot();
  disease: Dot = newDot();
  darkflame: Dot = newDot();
  freeze = 0;
  slow = 0; // fraction
  slowTimer = 0;
  blind = 0;
  curse: Curse | null = null;
  radiation = 0;
  radiationMax = 0;
  radiationPer = 0.1;
  radiationTimer = 0; // Infinity for Nuclear Bomb
  leech: { rate: number; max: number; tick: number } | null = null;
  rod: { interval: number; timer: number; dmg: Range; targets: number } | null = null;
  maggots: Range | null = null;
  sapped = false; // lifesteal roll already happened
  attackDown = 0; // fraction
  overgrowth = 0;

  constructor(def: EnemyDef, x: number, y: number, hp: number, row: number) {
    this.def = def;
    this.x = x;
    this.y = y;
    this.w = def.w * TILE;
    this.h = def.h * TILE;
    this.hp = hp;
    this.maxHp = hp;
    this.row = row;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get cy() {
    return this.y + this.h / 2;
  }

  get frozen() {
    return this.freeze > 0;
  }

  get isBoss() {
    return this.def.rank !== 'normal';
  }

  /** Movement multiplier from slow/freeze/venom. */
  get speedMul() {
    if (this.freeze > 0) return 0;
    let m = 1;
    if (this.slowTimer > 0) m *= 1 - this.slow;
    if (this.venom.stacks > 0) m *= Math.max(0.3, 1 - 0.06 * this.venom.stacks);
    return m;
  }

  /** Extra damage taken from freeze, frostburn and radiation. */
  damageTakenMul(kind: 'frostburn' | 'other') {
    let m = 1;
    if (this.freeze > 0) m += 0.25;
    if (this.frostburn.stacks > 0 && kind !== 'frostburn') m += 0.25;
    if (this.radiation > 0) m += this.radiation * this.radiationPer;
    return m;
  }

  distToPoint(px: number, py: number) {
    const dx = Math.max(this.x - px, 0, px - (this.x + this.w));
    const dy = Math.max(this.y - py, 0, py - (this.y + this.h));
    return Math.hypot(dx, dy);
  }
}
