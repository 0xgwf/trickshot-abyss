import type { Battle } from './battle.ts';
import type { Ball } from './ball.ts';
import type { Enemy } from './enemy.ts';

export type Range = readonly [number, number];

export type HitSide = 'front' | 'back' | 'left' | 'right';

/** Where damage came from; passives and modifiers key off this. */
export type DamageKind = 'hit' | 'baby' | 'aoe' | 'status' | 'passive' | 'minion';

export interface BallDef {
  id: string;
  zh: string;
  en: string;
  evolved: boolean;
  /** Only the 14 default balls (+ Dark after the first clear) show up in level-ups. */
  pool?: 'default' | 'boneyard-clear' | 'snowy-clear';
  color: string;
  /** Direct-hit damage, wiki "STR × a–b". */
  hit: Range;
  /** Each recipe is a list of slots; each slot lists the ball ids that can fill it. */
  recipes?: string[][][];
  desc(lv: number): string;
  passThrough?: boolean;
  /** Passes through only when hitting these sides (Assassin: the front). */
  pierceSides?: HitSide[];
  destroyOnHit?: boolean;
  /** Spawns other balls; spawned babies don't inherit spawners (avoids runaway chains). */
  spawner?: boolean;
  cooldown?(lv: number): number;
  /** Extra multiplier for a specific hit (backstabs, Drill before the back wall…). */
  ballMul?(b: Battle, ball: Ball, e: Enemy, lv: number, side: HitSide): number;
  speedMul?(lv: number): number;
  dmgMul?(lv: number): number;
  onLaunch?(b: Battle, ball: Ball, lv: number): void;
  /** Called after the direct hit has been dealt. */
  onHit?(b: Battle, ball: Ball, e: Enemy, lv: number): void;
  /** Called when bouncing off a side wall or the back (top) wall. */
  onWall?(b: Battle, ball: Ball, lv: number, back: boolean): void;
  /** Any bounce: walls or enemies. */
  onBounce?(b: Battle, ball: Ball, lv: number): void;
  onTick?(b: Battle, ball: Ball, lv: number, dt: number): void;
}

export interface Part {
  def: BallDef;
  lv: number;
}

export interface PassiveDef {
  id: string;
  zh: string;
  en: string;
  evolved: boolean;
  recipes?: string[][][];
  desc(lv: number): string;
  /** Offered only when this returns true (e.g. needs a Freeze source). */
  requires?(b: Battle): boolean;
  /** Multiplier on a ball's direct-hit damage. */
  hitMul?(b: Battle, ball: Ball, e: Enemy, lv: number): number;
  /** Extra crit chance for a given hit (absolute, e.g. 0.2). */
  critChance?(b: Battle, ball: Ball, e: Enemy, lv: number): number;
  onHit?(b: Battle, ball: Ball, e: Enemy, lv: number): void;
  onWall?(b: Battle, ball: Ball, lv: number, back: boolean): void;
  onBounce?(b: Battle, ball: Ball, lv: number): void;
  onLaunch?(b: Battle, ball: Ball, lv: number): void;
  onKill?(b: Battle, e: Enemy, lv: number): void;
  onCatch?(b: Battle, ball: Ball, lv: number): void;
  onGem?(b: Battle, lv: number): void;
  onPlayerHit?(b: Battle, lv: number, ranged: boolean, dmg: number): number;
  onHeal?(b: Battle, lv: number): void;
  onTick?(b: Battle, lv: number, dt: number): void;
  /** Called each time a new row of enemies enters the field. */
  onRow?(b: Battle, lv: number): void;
  /** Static modifiers applied when stats are recomputed. */
  stats?(s: DerivedStats, lv: number): void;
}

export interface DerivedStats {
  maxHp: number;
  moveSpeed: number; // tiles/s
  ballSpeed: number; // tiles/s
  fireInterval: number; // s
  baseDamage: number; // STR
  babyCount: number;
  babyDamage: Range;
  critChance: number;
  statusPower: number;
  aoePower: number;
  passivePower: number;
  damageTaken: number; // multiplier
  dodge: number;
  catchRadius: number; // tiles
  pickupRadius: number; // tiles
  ballSpeedMul: number;
  moveFullWhileShooting: boolean;
  babyDamageMul: number;
  scatterAim: number; // radians of random spread
  babyCountMul: number;
}

export interface CharacterDef {
  id: string;
  zh: string;
  en: string;
  flavor: string;
  ability: string;
  startBall: string;
  stats: { end: number; str: number; lea: number; spd: number; dex: number; int: number };
  color: string;
  unlock: 'default' | 'boneyard' | 'snowy';
}
