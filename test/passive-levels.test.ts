// Every passive gets stronger with its level (the original lets all passives, evolved ones too, reach L3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PASSIVES } from '../src/game/data/passives.ts';
import { arena, ball, dummy, fixRolls } from './helpers.ts';

const LEVELS = [1, 2, 3] as const;

test('every passive card changes between L1 and L3, so an upgrade is never empty', () => {
  for (const def of Object.values(PASSIVES)) assert.notEqual(def.desc(1), def.desc(3), def.id);
});

test('Everflowing Goblet overheals at 20/30/40% efficiency', () => {
  for (const [lv, pct] of [
    [1, 0.2],
    [2, 0.3],
    [3, 0.4],
  ]) {
    const b = arena('warrior', [['everflowing', lv]]);
    b.heal(10);
    assert.ok(Math.abs(b.player.hp - (b.player.maxHp + 10 * pct)) < 1e-9, `L${lv}: ${b.player.hp}`);
  }
});

test('Eye of the Beholder dodges 10/15/20% of attacks', () => {
  for (const [lv, dodge] of [
    [1, 0.1],
    [2, 0.15],
    [3, 0.2],
  ])
    assert.equal(arena('warrior', [['beholder', lv]]).stats.dodge, dodge);
});

test('Cornucopia adds 0–1 / 0–2 / 1–2 baby balls each time babies spawn', () => {
  for (const [lv, lo, hi] of [
    [1, 0, 1],
    [2, 0, 2],
    [3, 1, 2],
  ]) {
    const b = arena('warrior', [['cornucopia', lv]]);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      b.balls.length = 0;
      b.spawnBaby(300, 300);
      seen.add(b.balls.length - 1);
    }
    assert.deepEqual(
      [...seen].sort(),
      Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
      `L${lv}`,
    );
  }
});

test('Inglorious Hammer strikes a random enemy for 150/175/200% of a base hit', () => {
  for (const [lv, mul] of [
    [1, 1.5],
    [2, 1.75],
    [3, 2],
  ]) {
    const b = arena('warrior', [['hammer', lv]]);
    fixRolls(b, 0.5);
    const e = dummy(b, 1e6);
    PASSIVES.hammer.onWall!(b, ball(b, [['ghost', 1]]), lv, false);
    assert.equal(1e6 - e.hp, Math.round(35 * mul), `L${lv}`); // the Warrior's middle roll is 35
  }
});

test('Remote Detonator and Windweaver fire balls of their own level', () => {
  for (const lv of LEVELS) {
    const b = arena('warrior', [['detonator', lv]]);
    PASSIVES.detonator.onKill!(b, dummy(b), lv);
    assert.deepEqual(
      b.balls.map((x) => x.parts.map((p) => `${p.def.id}${p.lv}`).join()),
      [`bomb${lv}`],
    );
    const w = arena('warrior', [['windweaver', lv]]);
    PASSIVES.windweaver.onGem!(w, lv);
    assert.deepEqual(
      w.balls.map((x) => x.parts.map((p) => `${p.def.id}${p.lv}`).join()),
      [`wind${lv}`],
    );
  }
});

test('Wings of the Anointed: balls +40/60/80%, movement +20/30/40%', () => {
  const plain = arena().stats;
  for (const [lv, ballMul, moveMul] of [
    [1, 1.4, 1.2],
    [2, 1.6, 1.3],
    [3, 1.8, 1.4],
  ]) {
    const st = arena('warrior', [['wings', lv]]).stats;
    assert.ok(Math.abs(st.ballSpeedMul - ballMul) < 1e-9, `L${lv} balls`);
    assert.ok(Math.abs(st.moveSpeed / plain.moveSpeed - moveMul) < 1e-9, `L${lv} move`);
  }
});
