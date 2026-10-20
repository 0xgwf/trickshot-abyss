// Direct-hit damage: the formula in Battle.hitEnemy and the balls and characters that change it.
// Expected numbers come from the card texts (which match the wiki) and config.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CFG, TILE, WORLD_W } from '../src/game/config.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { arena, ball, damageLog, dummy, fixRolls, hit, IDLE, type Parts } from './helpers.ts';

const LEVELS = [1, 2, 3];

test('a direct hit deals STR × the ball range × the level multiplier', () => {
  const b = arena(); // the Warrior, STR 7
  for (const def of Object.values(BALLS)) {
    if (def.ballMul) continue; // positional bonuses, tested below
    for (const lv of LEVELS) {
      const mul = 7 * CFG.levelDamage[lv - 1] * (def.dmgMul?.(lv) ?? 1);
      const lo = Math.max(1, Math.round(def.hit[0] * mul));
      const hi = Math.round(def.hit[1] * mul);
      for (let i = 0; i < 20; i++) {
        const dmg = hit(b, [[def.id, lv]], dummy(b));
        assert.ok(dmg >= lo && dmg <= hi, `${def.id} L${lv}: ${dmg} outside ${lo}–${hi}`);
      }
    }
  }
});

test('the Warrior hits for 25–45 with a base ball, ×1.25 at L2 and ×1.5 at L3', () => {
  const b = arena();
  const at = (u: number, lv = 1) => {
    fixRolls(b, u);
    return hit(b, [['ghost', lv]], dummy(b));
  };
  assert.equal(at(0), 25); // 7 × 3.5 = 24.5
  assert.equal(at(0.5), 35); // 7 × 5
  assert.equal(at(0.999999), 45); // 7 × 6.5 = 45.5, never quite reached
  assert.equal(at(0.5, 2), 44); // 35 × 1.25 = 43.75
  assert.equal(at(0.5, 3), 53); // 35 × 1.5 = 52.5
});

test('Iron doubles damage, Wind takes 25% off, Dark deals 3/4/5×', () => {
  const b = arena();
  fixRolls(b, 0.5);
  assert.equal(hit(b, [['iron', 1]], dummy(b)), 70);
  assert.equal(hit(b, [['wind', 1]], dummy(b)), 26); // 26.25
  assert.equal(hit(b, [['dark', 1]], dummy(b)), 105);
  assert.equal(hit(b, [['dark', 2]], dummy(b)), 175); // 35 × 1.25 × 4
  assert.equal(hit(b, [['dark', 3]], dummy(b)), 263); // 35 × 1.5 × 5 = 262.5
});

test('a critical hit deals double damage', () => {
  const b = arena();
  fixRolls(b, 0.5);
  b.stats.critChance = 1;
  assert.equal(hit(b, [['ghost', 1]], dummy(b)), 70);
});

test('the crit chance is 3% + 0.5% per DEX point', () => {
  assert.equal(arena('warrior').stats.critChance, 0); // the arena turns crits off
  for (const [char, dex] of [
    ['warrior', 4],
    ['itchy', 5],
    ['cohabitants', 3],
  ] as const) {
    const b = arena(char);
    b.recomputeStats();
    assert.ok(Math.abs(b.stats.critChance - (0.03 + 0.005 * dex)) < 1e-9, char);
  }
});

test('a fused ball hits with its stronger part and applies both effects', () => {
  const b = arena();
  fixRolls(b, 0.5);
  const e = dummy(b);
  assert.equal(
    hit(
      b,
      [
        ['burn', 1],
        ['iron', 1],
      ],
      e,
    ),
    70,
  );
  assert.equal(e.burn.stacks, 1);
});

test('each bleed stack adds 1 damage to every ball hit; Bleed adds 2/4/4 stacks up to 8/11/14', () => {
  const b = arena();
  fixRolls(b, 0.5);
  const e = dummy(b);
  e.bleed = e.bleedMax = 5;
  assert.equal(hit(b, [['ghost', 1]], e), 40);
  for (const [lv, add, cap] of [
    [1, 2, 8],
    [2, 4, 11],
    [3, 4, 14],
  ]) {
    const f = dummy(b);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      hit(b, [['bleed', lv]], f);
      seen.push(f.bleed);
    }
    assert.deepEqual(
      seen,
      [1, 2, 3, 4, 5].map((n) => Math.min(cap, n * add)),
      `L${lv}`,
    );
  }
});

test('frozen enemies take 25% more damage; Frostburn adds 25% to all other damage', () => {
  const b = arena();
  const e = dummy(b);
  assert.equal(b.damage(e, 100, 'hit'), 100);
  e.freeze = 1;
  assert.equal(b.damage(e, 100, 'hit'), 125);
  e.freeze = 0;
  e.frostburn.stacks = 1;
  assert.equal(b.damage(e, 100, 'hit'), 125);
  assert.equal(b.damage(e, 100, 'status', false, 'frostburn'), 100);
  e.freeze = 1;
  assert.equal(b.damage(e, 100, 'aoe'), 150);
});

test('INT raises status, area and passive damage by 5% per point above 3, not direct hits', () => {
  const b = arena('cogitator'); // INT 5
  const e = dummy(b);
  assert.equal(b.damage(e, 100, 'hit'), 100);
  assert.equal(b.damage(e, 100, 'baby'), 100);
  assert.equal(b.damage(e, 100, 'status'), 110);
  assert.equal(b.damage(e, 100, 'aoe'), 110);
  assert.equal(b.damage(e, 100, 'passive'), 110);
});

test('Stone starts at 300/350/400% and loses 40/35/30 points per hit, down to 50%', () => {
  for (const [lv, start, step] of [
    [1, 3, 0.4],
    [2, 3.5, 0.35],
    [3, 4, 0.3],
  ]) {
    const b = arena();
    fixRolls(b, 0.5);
    const s = ball(b, [['stone', lv]]);
    for (const part of s.parts) part.def.onLaunch?.(b, s, part.lv);
    const base = 35 * CFG.levelDamage[lv - 1];
    for (let i = 0; i < 12; i++) {
      const want = Math.round(base * Math.max(0.5, start - step * i));
      assert.equal(hit(b, s, dummy(b)), want, `L${lv} hit ${i + 1}`);
    }
  }
});

test('Assassin backstabs for +30/40/50%; other sides deal normal damage', () => {
  for (const [lv, bonus] of [
    [1, 0.3],
    [2, 0.4],
    [3, 0.5],
  ]) {
    const b = arena();
    fixRolls(b, 0.5);
    const plain = 7 * 6.1 * CFG.levelDamage[lv - 1]; // evolved range 4.2–8.0
    assert.equal(hit(b, [['assassin', lv]], dummy(b), 'front'), Math.round(plain));
    assert.equal(hit(b, [['assassin', lv]], dummy(b), 'back'), Math.round(plain * (1 + bonus)));
  }
});

test('Drill deals +50/75/100% until it touches the back wall', () => {
  for (const [lv, bonus] of [
    [1, 0.5],
    [2, 0.75],
    [3, 1],
  ]) {
    const b = arena();
    fixRolls(b, 0.5);
    const d = ball(b, [['drill', lv]]);
    const plain = 7 * 5.2 * CFG.levelDamage[lv - 1]; // range 3.6–6.8
    assert.equal(hit(b, d, dummy(b)), Math.round(plain * (1 + bonus)));
    d.hitBack = true;
    assert.equal(hit(b, d, dummy(b)), Math.round(plain));
  }
});

test('the Repentant deals 5% more per bounce', () => {
  const b = arena('repentant'); // STR 3
  fixRolls(b, 0.5);
  const g = ball(b, [['ghost', 1]]);
  assert.equal(hit(b, g, dummy(b)), 15);
  g.bounces = 4;
  assert.equal(hit(b, g, dummy(b)), 18);
});

test('baby balls hit for LEA × 2.75–4.25', () => {
  const b = arena(); // LEA 4: 11–17
  for (let i = 0; i < 50; i++) {
    const dmg = hit(b, ball(b, [], { baby: true }), dummy(b));
    assert.ok(dmg >= 11 && dmg <= 17, `${dmg}`);
  }
});

test('Cohabitants fire a mirrored copy; both deal half damage and the copy fades after 2.5 s', () => {
  const b = arena('cohabitants');
  const ob = b.addBall(BALLS.ghost);
  b.launch(ob, -1);
  assert.equal(b.balls.length, 2);
  const [main, copy] = b.balls;
  assert.equal(main.power, 0.5);
  assert.equal(copy.power, 0.5);
  assert.equal(copy.temp, true);
  assert.equal(copy.life, 2.5);
  assert.ok(Math.abs(Math.atan2(copy.vy, copy.vx) - (-Math.PI + 1)) < 1e-9, 'mirrored angle');
});

test('the Empty Nester fires a half-damage copy with every special ball', () => {
  const b = arena('emptynester');
  const ob = b.addBall(BALLS.ghost);
  b.launch(ob, -1);
  assert.equal(b.balls.length, 2);
  assert.equal(b.balls[0].power, 1);
  assert.equal(b.balls[1].power, 0.5);
  assert.equal(b.balls[1].life, 2.5);
});

// ------------------------------------------------------------------ piercing, beams and areas

/** Shoots a ball straight up from below a column of enemies and lets it fly until it reaches the top wall. */
function shootUp(b: ReturnType<typeof arena>, parts: Parts) {
  const s = ball(b, parts, { x: dummyX(3.5), y: TILE * 12 });
  for (const part of s.parts) part.def.onLaunch?.(b, s, part.lv);
  for (let i = 0; i < 120 && !s.dead && !s.hitBack; i++) b.update(1 / 60, IDLE);
  return s;
}

const dummyX = (col: number) => (WORLD_W - 8 * TILE) / 2 + col * TILE + TILE / 2;

// Assassin used to hit about 3 times: past the midline the nearest side was the back, which is solid.
for (const id of ['ghost', 'assassin'])
  test(`a piercing ball (${id}) hits each enemy once on its way through`, () => {
    const b = arena();
    const e = dummy(b, 1e9, 3.5, 5);
    const log = damageLog(b);
    shootUp(b, [[id, 1]]);
    assert.equal(log.filter((d) => d.e === e && d.kind === 'hit').length, 1);
  });

for (const id of ['freezeray', 'radiationbeam'])
  test(`${id}'s beam damages the enemies behind the one it hit, not the way back`, () => {
    const b = arena();
    const column = [2, 3, 4, 5, 6].map((row) => dummy(b, 1e9, 3.5, row));
    const log = damageLog(b);
    shootUp(b, [[id, 1]]);
    const struck = new Set(log.filter((d) => d.kind === 'aoe').map((d) => d.e));
    assert.ok(
      column.slice(0, 4).every((e) => struck.has(e)),
      `beam reached ${struck.size} of 5`,
    );
  });

for (const [lv, n] of [
  [1, 3],
  [3, 4],
] as const)
  test(`Earthquake L${lv} hits the ${n}×${n} tiles around the enemy`, () => {
    const b = arena();
    const grid = [];
    for (let row = 1; row <= 9; row++) for (let col = 0; col < 8; col++) grid.push(dummy(b, 1e9, col, row));
    const target = grid.find((e) => e.x === dummyX(4) - TILE / 2 && e.y === 5 * TILE)!;
    const log = damageLog(b);
    hit(b, [['earthquake', lv]], target);
    assert.equal(new Set(log.filter((d) => d.kind === 'aoe').map((d) => d.e)).size, n * n);
  });
