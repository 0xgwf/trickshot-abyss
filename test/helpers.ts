// Fixtures for the unit tests: an empty arena (no enemy rows, no crits), dummy enemies, direct hits
// and a damage log.
import type { Ball } from '../src/game/ball.ts';
import { Battle, type Controls } from '../src/game/battle.ts';
import { TILE, WORLD_W } from '../src/game/config.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { PASSIVES } from '../src/game/data/passives.ts';
import { Enemy } from '../src/game/enemy.ts';
import type { DamageKind, HitSide } from '../src/game/types.ts';

export type Parts = [string, number][];

/** A battle with an empty inventory and a frozen stage: nothing spawns or scrolls, crits are off. */
export function arena(char = 'warrior', passives: [string, number][] = [], seed = 1) {
  const b = new Battle(
    CHARACTERS.find((c) => c.id === char)!,
    seed,
    new Set(['boneyard', 'snowy']),
    'boneyard',
  );
  for (const ob of [...b.owned]) b.removeOwned(ob);
  b.queue.length = 0;
  b.babies = 0;
  b.passives = passives.map(([id, lv]) => ({ def: PASSIVES[id], lv }));
  b.recomputeStats();
  b.stats.critChance = 0;
  b.autofire = false;
  b.stage.update = () => {};
  b.stage.scrollPx = b.stage.floorScrollPx = 0;
  return b;
}

/** Every roll returns `u` (0 = minimum, 0.5 = middle). Only for code paths without retry loops. */
export function fixRolls(b: Battle, u: number) {
  b.rng.next = () => u;
}

/** A 1×1 enemy with lots of HP near the top of the field, out of the player's reach. */
export function dummy(b: Battle, hp = 1e9, col = 0, row = 3, def = ENEMIES.warrior) {
  const e = new Enemy(def, (WORLD_W - 8 * TILE) / 2 + col * TILE, row * TILE, hp, 0);
  b.enemies.push(e);
  return e;
}

/** A temporary ball on the field (not owned, so it never returns to the queue). */
export function ball(b: Battle, parts: Parts, opts: { baby?: boolean; x?: number; y?: number } = {}) {
  return b.spawnBall({
    parts: parts.map(([id, lv]) => ({ def: BALLS[id], lv })),
    baby: opts.baby ?? false,
    x: opts.x ?? WORLD_W / 2,
    y: opts.y ?? TILE * 10,
    angle: -Math.PI / 2,
    temp: true,
  });
}

export interface Dealt {
  e: Enemy;
  amount: number;
  kind: DamageKind;
  dealt: number;
}

/** Records every call to `Battle.damage` (the amount before and after enemy-side modifiers). */
export function damageLog(b: Battle) {
  const log: Dealt[] = [];
  const orig = b.damage.bind(b);
  b.damage = (e, amount, kind, crit, dot) => {
    const dealt = orig(e, amount, kind, crit, dot);
    log.push({ e, amount, kind, dealt });
    return dealt;
  };
  return log;
}

/** One direct hit; returns the damage of the hit itself (not of effects it triggers). */
export function hit(b: Battle, x: Ball | Parts, e: Enemy, side: HitSide = 'front') {
  const log = damageLog(b);
  const ballObj = Array.isArray(x) ? ball(b, x) : x;
  b.hitEnemy(ballObj, e, side);
  delete (b as { damage?: unknown }).damage; // drop the spy, back to the prototype method
  return log.find((d) => d.e === e && (d.kind === 'hit' || d.kind === 'baby'))?.dealt ?? 0;
}

export const IDLE: Controls = { moveX: 0, moveY: 0, aimX: WORLD_W / 2, aimY: 0, fire: false, recall: false };

/** Advances the battle without moving or shooting, at a given display frame rate. */
export function wait(b: Battle, seconds: number, fps = 60) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) b.update(1 / fps, IDLE);
}
