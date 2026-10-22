// Smooth playback of the opponent's field: blending two snapshots, and a whole run replayed through a
// jittery network at 60 fps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { Playback, blend } from '../src/net/playback.ts';
import { takeSnapshot, type Snapshot } from '../src/net/snapshot.ts';
import { arena, dummy } from './helpers.ts';

/** Deterministic [0, 1) numbers (mulberry32). */
const rand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const wire = (s: Snapshot) => JSON.parse(JSON.stringify(s)) as Snapshot;

test('blending matches entities by id, and leaves jumps, deaths and births alone', () => {
  const b = arena();
  const walker = dummy(b, 1e9, 0);
  const jumper = dummy(b, 1e9, 2);
  const dying = dummy(b, 1e9, 4);
  const a = takeSnapshot(b);
  walker.x += 10;
  jumper.x += 600;
  dying.dead = true;
  dummy(b, 1e9, 6);
  const later = takeSnapshot(b);
  later.at = a.at + 1 / 30;
  const x = (s: Snapshot, i: number) => s.enemies[i][1];
  const half = blend(a, later, 0.5);
  assert.equal(half.enemies.length, 3, 'the field at the earlier snapshot: the newborn is not there yet');
  assert.equal(x(half, 0), x(a, 0) + 5, 'moves halfway');
  assert.equal(x(half, 1), x(a, 1), 'a jump is not drawn as a slide');
  assert.equal(x(half, 2), x(a, 2), 'stays until it is gone');
  const ahead = blend(later, a, -0.5);
  assert.equal(x(ahead, 0), x(later, 0) + 5, 'extrapolates along the last motion');
});

/**
 * Plays a run through a network that delivers each snapshot after 5–45 ms, in order like TCP, with
 * `stalls` of them stuck for 150 ms more; the receiver draws at about 60 fps with uneven frames.
 */
function replay(stalls: number) {
  const b = new Battle(CHARACTERS[0], 11, new Set(['boneyard', 'snowy']), 'boneyard');
  const net = rand(5);
  const SENDER = 1000; // the sender's clock runs 1000 s ahead of ours
  const sent: { arrive: number; s: Snapshot }[] = [];
  let arrive = 0;
  for (let f = 0; f < 60 * 25 && b.phase !== 'lost'; f++) {
    autoDecide(b);
    b.update(1 / 60, autopilot(b));
    if (f % 2) continue;
    const s = wire(takeSnapshot(b));
    s.at = SENDER + (f + 1) / 60;
    arrive = Math.max(arrive, s.at - SENDER + 0.005 + net() * 0.04 + (net() < stalls ? 0.15 : 0));
    sent.push({ arrive, s });
  }
  const pb = new Playback();
  const frame = rand(9);
  let now = 0;
  let next = 0;
  let newest: Snapshot | null = null;
  const played: Snapshot[] = [];
  const shown: Snapshot[] = [];
  const lags: number[] = [];
  while (next < sent.length) {
    now += 1 / 60 + (frame() - 0.5) * 0.004;
    while (next < sent.length && sent[next].arrive <= now) {
      newest = sent[next].s;
      pb.push(sent[next++].s, now);
    }
    const s = pb.sample(now);
    if (!s || now < 2) continue;
    played.push(s);
    shown.push(newest!);
    // The battle runs every frame, so its clock tells which moment of the sender's run is on screen.
    lags.push(now - s.t);
  }
  const still = (xs: Snapshot[], k: 't' | 'floorY') => xs.slice(1).filter((s, i) => s[k] === xs[i][k]).length / (xs.length - 1);
  const steps = played.slice(1).map((s, i) => (s.t - played[i].t) * 60);
  lags.sort((p, q) => p - q);
  const r = {
    /** Frames where the field stood still, played back and drawing the newest snapshot (as before). */
    still: Math.max(still(played, 't'), still(played, 'floorY')),
    stillNewest: still(shown, 't'),
    /** Frames that moved the field on by 0.6–1.4 frames of the sender's run. */
    even: steps.filter((d) => d > 0.6 && d < 1.4).length / steps.length,
    spread: lags[Math.floor(lags.length * 0.95)] - lags[Math.floor(lags.length * 0.05)],
    delay: pb.delay,
  };
  return { ...r, report: JSON.stringify(r) };
}

test('a run played back through a jittery network moves every frame, at a steady delay', () => {
  const r = replay(0.005);
  assert.ok(r.stillNewest > 0.4, `drawing the newest snapshot stalls most frames: ${r.report}`);
  assert.ok(r.still < 0.01, r.report);
  assert.ok(r.even > 0.97, r.report);
  assert.ok(r.spread < 0.03, r.report);
  assert.ok(r.delay > 0.05 && r.delay < 0.15, r.report);
});

test('on a bad network playback stays smooth and waits longer', () => {
  const r = replay(0.02);
  assert.ok(r.still < 0.01, r.report);
  assert.ok(r.even > 0.97, r.report);
  assert.ok(r.delay < 0.4, r.report);
});

test('playback carries on briefly when snapshots stop, then holds still', () => {
  const b = arena();
  const e = dummy(b);
  const pb = new Playback();
  for (let i = 0; i < 30; i++) {
    e.x = 100 + i;
    const s = takeSnapshot(b);
    s.at = i / 30;
    pb.push(wire(s), i / 30 + 0.01);
  }
  const xAt = (now: number) => pb.sample(now)!.enemies[0][1];
  const last = 100 + 29;
  let x = 0;
  for (let now = 1; now < 3; now += 1 / 60) x = xAt(now);
  assert.ok(x > last && x <= last + 3.1 + 1e-9, `${x}`);
  assert.equal(xAt(3.5), x, 'holds');
});
