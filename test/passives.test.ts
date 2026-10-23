// Passives: requirements, radii and triggers, checked against the card texts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CFG, TILE } from '../src/game/config.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { PASSIVES } from '../src/game/data/passives.ts';
import { arena, ball, damageLog, dummy, IDLE, wait } from './helpers.ts';

// [passive, ball that used to unlock it in the level-up offers, why it could never trigger]
const NEEDS: [string, string, string][] = [
  ['frozenspike', 'frozenflame', 'Frozen Flame applies frostburn, not freeze'],
  ['midnightoil', 'frozenflame', 'Frozen Flame applies frostburn, not burn'],
  ['midnightoil', 'banishedflame', 'Banished Flame applies darkflame, not burn'],
  ['cursedelixir', 'nuclearbomb', 'Nuclear Bomb applies radiation, not poison'],
  ['cursedelixir', 'radiationbeam', 'Radiation Beam applies radiation, not poison'],
];

for (const [passive, ballId, why] of NEEDS)
  test(`${passive} is not offered for ${ballId}: ${why}`, () => {
    const b = arena();
    b.addBall(BALLS[ballId], 3);
    assert.equal(PASSIVES[passive].requires?.(b), false);
  });

test('Magnet widens the catch range by 1/1.5/2 tiles', () => {
  // A ball falls past the player, 90% of Magnet's bonus further out than the plain catch range.
  const caught = (magnet: number, bonus: number) => {
    const b = arena('warrior', magnet ? [['magnet', magnet]] : []);
    const p = b.player;
    const s = ball(b, [['ghost', 1]]);
    const plain = p.r + s.r + CFG.catchRadius * TILE;
    s.x = p.x + plain + 0.9 * bonus * TILE;
    s.y = p.y;
    s.age = 1;
    s.vx = 0;
    s.vy = 1;
    b.update(1 / 60, IDLE);
    return s.dead;
  };
  for (const [lv, bonus] of [
    [1, 1],
    [2, 1.5],
    [3, 2],
  ]) {
    assert.equal(caught(0, bonus), false, `without Magnet, ${bonus} tiles`);
    assert.equal(caught(lv, bonus), true, `L${lv}`);
  }
});

test('Crown of Thorns destroys the 2 nearest regular enemies even with a boss closer', () => {
  const b = arena('warrior', [['thorns', 1]]);
  const p = b.player;
  const boss = dummy(b, 1e9, 0, 3, ENEMIES.brigade);
  boss.x = p.x - boss.w / 2;
  boss.y = p.y - boss.h - TILE * 0.2;
  const others = [1, 2, 3].map((i) => dummy(b, 1e9, i, 2));
  b.hurtPlayer(5, false, 'melee');
  assert.equal(boss.dead, false);
  assert.equal(others.filter((e) => e.dead).length, 2);
});

for (const id of ['magma', 'swamp', 'glacier'])
  test(`${id}'s pools deal 6–12 per second to enemies next to them`, () => {
    const b = arena();
    const s = ball(b, [[id, 1]], { x: 300, y: 400 });
    // Drop one pool, then take the ball away.
    for (let i = 0; i < 60 && !b.zones.length; i++) b.update(1 / 60, IDLE);
    s.dead = true;
    const z = b.zones[0];
    assert.ok(z, 'a pool was dropped');
    const e = dummy(b);
    e.x = z.x + z.r + TILE * 0.3;
    e.y = z.y - e.h / 2;
    const log = damageLog(b);
    wait(b, 3);
    assert.ok(log.filter((d) => d.e === e).length >= 2, 'no aura damage from the pool');
  });
