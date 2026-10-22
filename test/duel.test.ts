// Versus rules (src/game/duel.ts and the live choices in Battle): nothing pauses a versus run, and the
// opponent's rows are a burden, never a gift.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle } from '../src/game/battle.ts';
import { CFG, TILE, WORLD_H } from '../src/game/config.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { Duel } from '../src/game/duel.ts';
import { IDLE, arena, dummy } from './helpers.ts';

const versus = (seed = 3) => {
  const b = new Battle(CHARACTERS[0], seed, new Set(['boneyard', 'snowy']), 'boneyard');
  b.live = true;
  return { b, duel: new Duel(b) };
};

const step = (b: Battle, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) b.update(1 / 60, IDLE);
};

test('a live level-up waits beside the field: the run goes on, the player can be hurt, and it picks itself', () => {
  const b = arena();
  b.live = true;
  b.gainXp(b.xpNeeded);
  step(b, 0.1);
  assert.equal(b.phase, 'play');
  assert.ok(b.offers?.length, 'offers are open');
  const t = b.t;
  const hp = b.player.hp;
  b.player.invuln = 0;
  b.hurtPlayer(10, false);
  assert.ok(b.player.hp < hp, 'no invulnerability while choosing');
  step(b, CFG.liveChoiceTime);
  assert.ok(b.t > t + CFG.liveChoiceTime - 0.2, 'time kept running');
  assert.equal(b.offers, null, 'picked itself');
  assert.equal(b.pendingLevelUps, 0);
});

test('choose() applies a live offer and opens the next pending one', () => {
  const b = arena();
  b.live = true;
  b.gainXp(b.xpNeeded);
  b.gainXp(b.xpNeeded);
  step(b, 0.05);
  assert.equal(b.pendingLevelUps, 2);
  b.choose(b.offers![0]);
  assert.equal(b.pendingLevelUps, 1);
  assert.ok(b.offers?.length, 'the second level-up is offered');
  assert.equal(b.phase, 'play');
});

test('the Fusion Reactor resolves itself in a live run', () => {
  const b = arena();
  b.live = true;
  b.pendingReactors = 1;
  step(b, 0.05);
  assert.equal(b.phase, 'play');
  assert.equal(b.pendingReactors, 0);
});

test('garbage rows are extra: they do not move the run towards the checkpoint, and drop nothing', () => {
  const { b, duel } = versus();
  step(b, 2);
  const { rows, segRows } = b.stage;
  const progress = b.stage.progress;
  duel.receive(3);
  const garbage = b.enemies.filter((e) => e.garbage);
  assert.equal(garbage.length, 3 * (b.stage.cols - 1), 'three rows with one gap each');
  assert.equal(new Set(garbage.map((e) => e.x)).size, b.stage.cols - 1, 'the gap is the same column all the way down');
  assert.equal(b.stage.rows, rows);
  assert.equal(b.stage.segRows, segRows);
  assert.equal(b.stage.progress, progress);
  const drops = b.drops.length;
  b.kill(garbage[0]);
  assert.equal(b.drops.length, drops, 'no gem, gold or potion');
});

test('garbage lands during a miniboss fight too', () => {
  const { b, duel } = versus();
  (b.stage as unknown as { checkpoint(): void }).checkpoint();
  assert.equal(b.stage.state, 'miniboss');
  duel.receive(2);
  assert.ok(b.enemies.some((e) => e.garbage));
});

test('only your own kills attack: garbage kills send nothing back', () => {
  const b = arena();
  const duel = new Duel(b);
  for (let i = 0; i < 25; i++) {
    const e = dummy(b, 1);
    e.garbage = true;
    b.kill(e);
  }
  assert.equal(duel.take(), 0);
  for (let i = 0; i < 25; i++) b.kill(dummy(b, 1));
  assert.ok(duel.take() > 0);
  b.kill(dummy(b, 1, 0, 3, ENEMIES[Object.keys(ENEMIES).find((id) => ENEMIES[id].rank === 'miniboss')!]));
  assert.ok(duel.take() >= 2, 'a miniboss sends a big attack');
});

test('garbage rows come down to the player like any other row', () => {
  const { b, duel } = versus();
  duel.receive(1);
  const e = b.enemies.find((x) => x.garbage)!;
  const y = e.y;
  step(b, 3);
  assert.ok(e.y > y + TILE * 0.5 && e.y < WORLD_H);
});
