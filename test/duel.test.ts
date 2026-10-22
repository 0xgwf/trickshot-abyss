// Versus rules (src/game/duel.ts and the live choices in Battle): nothing pauses a versus run, and the
// opponent's rows are a burden, never a gift.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle } from '../src/game/battle.ts';
import { CFG, TILE, WORLD_H } from '../src/game/config.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { ENEMIES } from '../src/game/data/enemies.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { DUEL, Duel } from '../src/game/duel.ts';
import { applySnapshot, takeSnapshot } from '../src/net/snapshot.ts';
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

test('an open live offer that went stale (the ball was maxed meanwhile) is replaced, never applied', () => {
  const b = arena();
  b.live = true;
  b.addBall(BALLS.bleed);
  const ob = b.owned[0];
  b.gainXp(b.xpNeeded);
  step(b, 0.05);
  b.offers = [{ kind: 'upBall', ob }];
  ob.parts[0].lv = 3; // e.g. the Fusion Reactor's fission got there first
  b.choose(b.offers[0]);
  assert.equal(ob.parts[0].lv, 3);
  assert.equal(b.pendingLevelUps, 1, 'the level-up is still owed');
  assert.ok(b.offers?.length && !b.offers.some((o) => o.kind === 'upBall' && o.ob === ob), 'fresh offers');
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
  const { b } = versus();
  step(b, 2);
  const { rows, segRows } = b.stage;
  const progress = b.stage.progress;
  b.stage.landGarbage(3);
  const garbage = b.enemies.filter((e) => e.garbage);
  assert.equal(garbage.length, 3 * (b.stage.cols - 1), 'three rows with one gap each');
  assert.equal(new Set(garbage.map((e) => e.x)).size, b.stage.cols - 1, 'the gap is the same column all the way down');
  step(b, 0.5);
  assert.equal(b.stage.rows, rows);
  assert.equal(b.stage.segRows, segRows);
  assert.equal(b.stage.progress, progress);
  const drops = b.drops.length;
  b.kill(garbage[0]);
  assert.equal(b.drops.length, drops, 'no gem, gold or potion');
});

test('landing garbage shoves every enemy row down by its height, and the new rows come in at the top', () => {
  const { b } = versus();
  step(b, 6);
  const e = b.enemies.filter((x) => !x.dead && x.def.rank === 'normal').sort((p, q) => q.y - p.y)[0];
  const y = e.y;
  b.stage.landGarbage(3);
  step(b, 0.5);
  assert.ok(e.dead || (e.y - y >= TILE * 3 && e.y - y < TILE * 3 + 40), `moved ${e.y - y}`);
  const top = Math.min(...b.enemies.filter((x) => x.garbage).map((x) => x.y));
  assert.ok(top > -TILE * 1.5 && top < TILE, `garbage top row at ${top}`);
  step(b, 5);
  assert.ok(b.stage.rows > 0 && b.enemies.some((x) => !x.garbage && x.y < TILE), 'the level rows carry on above');
});

test('garbage lands during a miniboss fight too', () => {
  const { b } = versus();
  (b.stage as unknown as { checkpoint(): void }).checkpoint();
  assert.equal(b.stage.state, 'miniboss');
  b.stage.landGarbage(2);
  assert.ok(b.enemies.some((e) => e.garbage));
});

/** Kills `n` enemies at once, as one streak. */
const streak = (b: Battle, n: number, garbage = false) => {
  for (let i = 0; i < n; i++) {
    const e = dummy(b, 1);
    e.garbage = garbage;
    b.kill(e);
  }
};

test('kill streaks attack in chunks: a short streak sends nothing, every few kills more send a row', () => {
  const b = arena();
  const duel = new Duel(b);
  const K = DUEL.killsPerRow;
  streak(b, K - 1);
  duel.update(DUEL.streakGap);
  assert.equal(duel.take(), 0);
  streak(b, 2 * K + 1);
  duel.update(DUEL.streakGap / 2);
  assert.equal(duel.take(), 0, 'not while the streak is going');
  duel.update(DUEL.streakGap / 2);
  assert.equal(duel.take(), 2);
  streak(b, DUEL.killsPerRow * DUEL.maxAttack);
  assert.equal(duel.take(), DUEL.maxAttack, 'a full streak attacks at once');
});

test('only your own kills attack: garbage kills send nothing back; a miniboss sends a big attack', () => {
  const b = arena();
  const duel = new Duel(b);
  streak(b, 20, true);
  duel.update(DUEL.streakGap);
  assert.equal(duel.take(), 0);
  b.kill(dummy(b, 1, 0, 3, ENEMIES[Object.keys(ENEMIES).find((id) => ENEMIES[id].rank === 'miniboss')!]));
  assert.equal(duel.take(), DUEL.minibossRows);
});

test('attacking cancels the rows waiting to land first, and only the rest goes out', () => {
  const b = arena();
  const duel = new Duel(b);
  const K = DUEL.killsPerRow;
  duel.receive(3);
  streak(b, 2 * K);
  duel.update(DUEL.streakGap);
  assert.equal(duel.pending, 1);
  assert.equal(duel.take(), 0);
  streak(b, 3 * K);
  duel.update(DUEL.streakGap);
  assert.equal(duel.pending, 0);
  assert.equal(duel.take(), 2);
});

test('incoming rows wait out the delay, then land; one attack and the meter are capped', () => {
  const { b, duel } = versus();
  step(b, 1);
  duel.receive(2);
  step(b, DUEL.delay - 0.2);
  assert.ok(!b.enemies.some((e) => e.garbage), 'still waiting');
  assert.equal(duel.stage(duel.incoming[0]), 2, 'flashing just before it lands');
  step(b, 0.4);
  assert.ok(
    b.enemies.some((e) => e.garbage),
    'landed',
  );
  assert.equal(duel.pending, 0);
  duel.receive(10);
  duel.receive(10);
  duel.receive(10);
  assert.equal(duel.incoming[0].rows, DUEL.maxAttack);
  assert.equal(duel.pending, DUEL.maxPending);
});

test("the opponent's meter and streak travel in snapshots", () => {
  const { b, duel } = versus();
  duel.receive(3);
  duel.streak = 7;
  step(b, 1);
  const ghost = new Battle(CHARACTERS[0], 1, new Set(), 'boneyard');
  const shown = new Duel(ghost);
  applySnapshot(ghost, JSON.parse(JSON.stringify(takeSnapshot(b))));
  assert.equal(shown.pending, 3);
  assert.equal(shown.streak, duel.streak);
  assert.ok(Math.abs(shown.incoming[0].t - duel.incoming[0].t) < 0.01);
});

test('margin time: later in the match attacks grow (fractions carry over) and incoming rows land sooner', () => {
  const b = arena();
  const duel = new Duel(b);
  const K = DUEL.killsPerRow;
  assert.equal(duel.margin, 0);
  b.t = DUEL.marginStart + DUEL.marginStep; // step 2: attacks ×1.2² = ×1.44
  duel.update(0);
  assert.equal(duel.margin, 2);
  assert.equal(duel.delay, DUEL.delay - 2 * DUEL.marginDelay);
  let sent = 0;
  for (let i = 0; i < 5; i++) {
    streak(b, K);
    duel.update(DUEL.streakGap);
    sent += duel.take();
  }
  assert.equal(sent, Math.floor(5 * DUEL.marginAttack ** 2));
});

test('versus levels are shorter', () => {
  const { b } = versus();
  assert.equal(b.stage.segmentRows, DUEL.segmentRows);
});

test('garbage rows come down to the player like any other row', () => {
  const { b } = versus();
  b.stage.landGarbage(1);
  step(b, 0.5);
  const e = b.enemies.find((x) => x.garbage)!;
  const y = e.y;
  step(b, 3);
  assert.ok(e.y > y + TILE * 0.5 && e.y < WORLD_H);
});
