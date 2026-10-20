// Data integrity: ids, pools, references between tables and the card texts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALLS, EVOLVED_BALLS, basePool } from '../src/game/data/balls.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { LEVELS } from '../src/game/data/levels.ts';
import { EVOLVED_PASSIVES, PASSIVES, passivePool } from '../src/game/data/passives.ts';

const ALL = new Set(['boneyard', 'snowy']);
const BAD_TEXT = /undefined|NaN|\[object|Infinity/;

test('ball and passive ids are unique, and the pools hold only base items', () => {
  // BALLS/PASSIVES are built with Object.fromEntries, so a duplicate id would silently replace another entry.
  const balls = [...basePool(ALL), ...EVOLVED_BALLS.map((d) => d.id)];
  assert.equal(new Set(balls).size, balls.length);
  assert.equal(Object.keys(BALLS).length, balls.length, 'a ball is missing from both the pool and the evolutions');
  for (const id of basePool(ALL)) assert.equal(BALLS[id].evolved, false, id);
  for (const d of EVOLVED_BALLS) assert.equal(BALLS[d.id], d, d.id);

  const passives = [...passivePool(ALL), ...EVOLVED_PASSIVES.map((d) => d.id)];
  assert.equal(new Set(passives).size, passives.length);
  assert.equal(Object.keys(PASSIVES).length, passives.length);
  for (const id of passivePool(ALL)) assert.equal(PASSIVES[id].evolved, false, id);
  for (const d of EVOLVED_PASSIVES) assert.equal(PASSIVES[d.id], d, d.id);
});

test('every card text renders for L1–L3 without undefined or NaN', () => {
  for (const def of [...Object.values(BALLS), ...Object.values(PASSIVES)])
    for (const lv of [1, 2, 3]) {
      const text = def.desc(lv);
      assert.ok(text.length > 0, `${def.id} L${lv} is empty`);
      assert.doesNotMatch(text, BAD_TEXT, `${def.id} L${lv}: ${text}`);
    }
  for (const c of CHARACTERS) assert.doesNotMatch(c.ability + c.flavor, BAD_TEXT, c.id);
});

test('ball stats are sane', () => {
  for (const def of Object.values(BALLS)) {
    const [lo, hi] = def.hit;
    assert.ok(lo > 0 && lo <= hi, `${def.id} hit ${lo}–${hi}`);
    for (const lv of [1, 2, 3]) {
      for (const [name, f] of [
        ['cooldown', def.cooldown],
        ['dmgMul', def.dmgMul],
        ['speedMul', def.speedMul],
      ] as const) {
        const x = f?.(lv);
        if (x !== undefined) assert.ok(Number.isFinite(x) && x >= 0, `${def.id} L${lv} ${name} = ${x}`);
      }
    }
    if (def.evolved) assert.ok(def.recipes?.length, `${def.id} has no recipe`);
    else assert.ok(def.pool, `${def.id} is in no pool`);
  }
});

test('characters start with an existing base ball', () => {
  for (const c of CHARACTERS) {
    const start = BALLS[c.startBall];
    assert.ok(start, `${c.id}: ${c.startBall}`);
    assert.equal(start.evolved, false, c.id);
    for (const [k, v] of Object.entries(c.stats)) assert.ok(Number.isInteger(v) && v > 0, `${c.id} ${k} = ${v}`);
  }
});

test('levels only spawn enemies that exist, with the right rank', () => {
  for (const level of LEVELS) {
    assert.equal(level.weights.length, 3, `${level.id}: one weight table per segment`);
    for (const w of level.weights)
      for (const [id, weight] of Object.entries(w)) {
        assert.ok(ENEMIES[id], `${level.id}: ${id}`);
        assert.equal(ENEMIES[id].rank, 'normal', `${level.id}: ${id}`);
        assert.ok(weight > 0, `${level.id}: ${id}`);
      }
    assert.equal(level.minibosses.length, 2, level.id);
    for (const id of level.minibosses) assert.equal(ENEMIES[id]?.rank, 'miniboss', `${level.id}: ${id}`);
    assert.equal(ENEMIES[level.boss]?.rank, 'boss', `${level.id}: ${level.boss}`);
  }
  for (const [key, e] of Object.entries(ENEMIES)) {
    assert.equal(e.id, key);
    assert.ok(e.hpMul > 0 && e.w > 0 && e.h > 0 && e.dmg >= 0 && e.xp >= 0, key);
  }
});
