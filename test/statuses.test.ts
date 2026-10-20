// Status effects: damage over time, caps, durations and proc chances, checked against the card texts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { arena, damageLog, dummy, hit, wait } from './helpers.ts';

type Dot = 'burn' | 'poison' | 'frostburn' | 'darkflame';

// [ball, level, status, seconds it lasts, stack cap, damage per stack per second]
const DOTS: [string, number, Dot, number, number, [number, number]][] = [
  ['burn', 1, 'burn', 3, 3, [4, 8]],
  ['burn', 2, 'burn', 3, 3, [7, 11]],
  ['burn', 3, 'burn', 5, 5, [7, 11]],
  ['poison', 1, 'poison', 6, 5, [1, 4]],
  ['poison', 2, 'poison', 6, 5, [2, 5]],
  ['poison', 3, 'poison', 9, 8, [2, 5]],
  ['frozenflame', 1, 'frostburn', 20, 4, [8, 12]],
  ['frozenflame', 3, 'frostburn', 30, 5, [10, 16]],
  ['banishedflame', 1, 'darkflame', 2, 6, [1, 30]],
  ['banishedflame', 3, 'darkflame', 2, 8, [1, 35]],
];

for (const [id, lv, dot, secs, cap, [lo, hi]] of DOTS) {
  test(`${id} L${lv}: one stack of ${dot} ticks once per second for ${secs} s, ${lo}–${hi} per tick`, () => {
    const b = arena();
    const e = dummy(b);
    hit(b, [[id, lv]], e);
    assert.equal(e[dot].stacks, 1);
    const log = damageLog(b);
    wait(b, secs + 2);
    const ticks = log.filter((d) => d.e === e && d.kind === 'status').map((d) => d.dealt);
    // Banished Flame deals 1–100 more when it goes out.
    const want = dot === 'darkflame' ? secs + 1 : secs;
    assert.equal(ticks.length, want, `ticks: ${ticks.join(', ')}`);
    for (const t of ticks.slice(0, secs)) assert.ok(t >= lo && t <= hi, `tick ${t} outside ${lo}–${hi}`);
    assert.equal(e[dot].stacks, 0, 'expired');
  });

  test(`${id} L${lv}: ${dot} stacks up to ${cap} and each hit refreshes the duration`, () => {
    const b = arena();
    const e = dummy(b);
    for (let i = 0; i < cap + 3; i++) {
      hit(b, [[id, lv]], e);
      wait(b, 0.5);
    }
    assert.equal(e[dot].stacks, cap);
    assert.ok(e[dot].timer > secs - 0.6, `timer ${e[dot].timer.toFixed(2)} not refreshed`);
  });
}

test('n stacks of burn deal n times the damage per tick', () => {
  const b = arena();
  const e = dummy(b);
  for (let i = 0; i < 3; i++) hit(b, [['burn', 1]], e);
  const log = damageLog(b);
  wait(b, 1.01);
  const [tick] = log.filter((d) => d.kind === 'status');
  assert.ok(tick.dealt >= 12 && tick.dealt <= 24, `3 stacks × 4–8, got ${tick.dealt}`);
});

test('status damage is raised by INT', () => {
  const b = arena('emptynester'); // INT 6: ×1.15
  const e = dummy(b);
  hit(b, [['burn', 1]], e);
  const log = damageLog(b);
  wait(b, 3.5);
  for (const d of log.filter((x) => x.kind === 'status')) assert.equal(d.dealt, Math.max(1, Math.round(d.amount * 1.15)));
});

// [ball, level, chance in the card text, did it trigger?]
const CHANCES: [string, number, number, (b: ReturnType<typeof arena>, e: ReturnType<typeof dummy>, hp: number) => boolean][] = [
  ['freeze', 1, 0.04, (_b, e) => e.freeze > 0],
  ['freeze', 2, 0.07, (_b, e) => e.freeze > 0],
  ['vampire', 1, 0.045, (b, _e, hp) => b.player.hp > hp],
  ['vampire', 2, 0.06, (b, _e, hp) => b.player.hp > hp],
  ['broodmother', 1, 0.25, (b) => b.balls.some((x) => x.baby)],
  ['broodmother', 3, 0.45, (b) => b.balls.some((x) => x.baby)],
];

for (const [id, lv, p, fired] of CHANCES) {
  test(`${id} L${lv} triggers on ${+(p * 100).toFixed(1)}% of hits`, () => {
    const b = arena();
    const n = 4000;
    let count = 0;
    for (let i = 0; i < n; i++) {
      b.balls.length = 0;
      b.player.hp = b.player.maxHp - 10;
      const hp = b.player.hp;
      const e = dummy(b);
      hit(b, [[id, lv]], e);
      if (fired(b, e, hp)) count++;
      b.enemies.length = 0;
    }
    // Within 4 standard deviations.
    const sd = Math.sqrt(n * p * (1 - p));
    assert.ok(Math.abs(count - n * p) < 4 * sd, `${count} of ${n}, expected about ${Math.round(n * p)}`);
  });
}

test('Freeze L1 holds an enemy for 5 s; bosses only for 30% of that', () => {
  const b = arena();
  const e = dummy(b);
  b.applyFreeze(e, 5);
  assert.equal(e.freeze, 5);
  assert.equal(e.speedMul, 0);
  const boss = dummy(b, 1e9, 0, 3, ENEMIES.king);
  b.applyFreeze(boss, 5);
  assert.equal(boss.freeze, 1.5);
});

test('Wind slows by 30% for 5 s at L1 and 45% for 8 s at L3', () => {
  const b = arena();
  const e = dummy(b);
  hit(b, [['wind', 1]], e);
  assert.equal(e.speedMul, 0.7);
  assert.equal(e.slowTimer, 5);
  const f = dummy(b);
  hit(b, [['wind', 3]], f);
  assert.equal(f.speedMul, 0.55);
  assert.equal(f.slowTimer, 8);
});

// ------------------------------------------------------------------ frame rates and caps

// The browser steps the game once per display frame, so this has to hold on 120/144 Hz screens too.
for (const fps of [30, 60, 120, 144, 165])
  test(`damage over time keeps its last tick at ${fps} fps`, () => {
    for (const [id, lv, dot, secs] of DOTS.filter(([, , d]) => d !== 'darkflame')) {
      const b = arena();
      const e = dummy(b);
      hit(b, [[id, lv]], e);
      const log = damageLog(b);
      wait(b, secs + 2, fps);
      assert.equal(log.filter((d) => d.kind === 'status').length, secs, `${id} L${lv} (${dot})`);
    }
  });

test('a status cap from a stronger source does not outlast the status', () => {
  const b = arena();
  const e = dummy(b);
  b.applyDot(e, 'burn', 1, 5, 3, [7, 11]); // e.g. Inferno: cap 5
  wait(b, 4);
  assert.equal(e.burn.stacks, 0);
  for (let i = 0; i < 6; i++) hit(b, [['burn', 1]], e);
  assert.equal(e.burn.stacks, 3);
});
