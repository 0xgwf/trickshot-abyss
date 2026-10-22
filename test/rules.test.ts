// The rule switches in config.ts (RULES): the current behaviour follows the original, and each switch
// still brings back the old one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES, TILE, WORLD_H } from '../src/game/config.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { IDLE, arena, ball, damageLog, dummy, fixRolls } from './helpers.ts';

/** Runs `fn` with some rules changed, then puts them back. */
function withRules(changes: Partial<typeof RULES>, fn: () => void) {
  const saved = { ...RULES };
  Object.assign(RULES, changes);
  try {
    fn();
  } finally {
    Object.assign(RULES, saved);
  }
}

/** Hemorrhage bursting 12 bleed stacks on a boss with 10000 HP; returns the burst damage. */
function hemorrhageOnBoss() {
  const b = arena();
  const boss = dummy(b, 10000, 0, 3, ENEMIES.king);
  boss.bleed = boss.bleedMax = 12;
  const log = damageLog(b);
  BALLS.hemorrhage.onHit!(b, ball(b, [['hemorrhage', 1]]), boss, 1);
  return log.find((d) => d.kind === 'status')?.dealt;
}

test('Hemorrhage bursts bosses for the full 20% (RULES.hemorrhageBossMul = 0.25 restores a quarter)', () => {
  assert.equal(hemorrhageOnBoss(), 2000);
  withRules({ hemorrhageBossMul: 0.25 }, () => assert.equal(hemorrhageOnBoss(), 500));
});

test('Reaper can kill bosses (RULES.reaperKillsBosses = false restores the exception)', () => {
  const reap = () => {
    const b = arena();
    fixRolls(b, 0); // every chance succeeds
    const boss = dummy(b, 10000, 0, 3, ENEMIES.king);
    BALLS.reaper.onHit!(b, ball(b, [['reaper', 1]]), boss, 1);
    return boss.dead;
  };
  assert.equal(reap(), true);
  assert.doesNotMatch(BALLS.reaper.desc(1), /首领除外/);
  withRules({ reaperKillsBosses: false }, () => {
    assert.equal(reap(), false);
    assert.match(BALLS.reaper.desc(1), /首领除外/);
  });
});

test('one hit deals at most 9999 (RULES.maxHitDamage = Infinity removes the cap)', () => {
  const b = arena();
  assert.equal(b.damage(dummy(b), 50000, 'hit'), 9999);
  withRules({ maxHitDamage: Infinity }, () => assert.equal(b.damage(dummy(b), 50000, 'hit'), 50000));
});

test('Everflowing Goblet stops overhealing at 3× max HP, also between level-ups', () => {
  const b = arena('warrior', [['everflowing', 3]]);
  const max = b.player.maxHp;
  b.player.hp = max * 3 - 1;
  b.heal(100);
  assert.equal(b.player.hp, max * 3);
  const plain = arena();
  plain.player.hp = plain.player.maxHp - 5;
  plain.heal(100);
  assert.equal(plain.player.hp, plain.player.maxHp);
});

test('Wings of the Anointed no longer keeps Fleet Feet’s full speed while shooting (RULES.wingsFullSpeedShooting restores it)', () => {
  assert.equal(arena('warrior', [['fleetfeet', 1]]).stats.moveFullWhileShooting, true);
  assert.equal(arena('warrior', [['wings', 1]]).stats.moveFullWhileShooting, false);
  withRules({ wingsFullSpeedShooting: true }, () => assert.equal(arena('warrior', [['wings', 1]]).stats.moveFullWhileShooting, true));
});

test('balls turn back as they touch the bottom edge (RULES.returnAtBottomEdge = false waits until they are off-screen)', () => {
  /** Drops a special ball straight down, away from the player; returns its lowest point and whether it came back. */
  const drop = () => {
    const b = arena();
    b.addBall(BALLS.bleed);
    const ob = b.owned[0];
    b.queue.length = 0;
    const x = b.left + TILE;
    const ball = b.spawnBall({ parts: ob.parts, owned: ob, baby: false, x, y: WORLD_H - TILE * 3, angle: Math.PI / 2, temp: false });
    let lowest = 0;
    for (let i = 0; i < 240 && !ball.dead; i++) {
      if (ball.state === 'fly') lowest = Math.max(lowest, ball.y + ball.r);
      b.update(1 / 60, IDLE);
    }
    return { lowest, back: ball.dead && b.queue.includes(ob) };
  };
  const now = drop();
  assert.ok(now.lowest <= WORLD_H + 1e-9, `${now.lowest}`);
  assert.ok(now.back, 'the player gets it back');
  withRules({ returnAtBottomEdge: false }, () => assert.ok(drop().lowest > WORLD_H));
});
