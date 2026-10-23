// Battle royale (src/game/royale.ts and server/versus.mjs): who each attack goes to, knockouts and badges,
// endless levels, and the room the server runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { DUEL, Duel } from '../src/game/duel.ts';
import { ROYALE, Royale, badgeBoost, counterRows } from '../src/game/royale.ts';
// @ts-expect-error plain JS module without types
import { joinVersus } from '../server/versus.mjs';
import { arena, dummy } from './helpers.ts';

/** A royale of `n` with a fixed random stream. */
const royale = (n: number) => {
  let x = 0.37;
  return new Royale(n, () => (x = (x * 9301 + 0.49297) % 1));
};

test('random targeting picks someone else and moves on after a while', () => {
  const r = royale(4);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) {
    r.update(0.5);
    const t = r.members[0].target!;
    assert.ok(t !== null && t !== 0);
    seen.add(t);
  }
  assert.equal(seen.size, 3, 'everyone gets a turn');
});

test('counter hits back at whoever is attacking you', () => {
  const r = royale(4);
  r.setStrategy(0, 'counter');
  r.lockOn(2, 0);
  r.lockOn(1, 3);
  r.lockOn(3, 1);
  r.update(ROYALE.retarget);
  assert.equal(r.members[0].target, 2);
  assert.equal(r.attackers(0), 1);
});

test('chase goes for the player closest to going down, counting the rows waiting to land', () => {
  const r = royale(4);
  r.setStrategy(0, 'ko');
  r.report(1, 0.5, 0, 10);
  r.report(2, 0.6, 5, 10); // 0.6 - 5 × 0.04 = 0.4
  r.report(3, 0.9, 0, 10);
  r.update(ROYALE.retarget);
  assert.equal(r.members[0].target, 2);
});

test('badges goes for the most badges, or with none about, whoever is deepest', () => {
  const r = royale(4);
  r.setStrategy(0, 'badges');
  r.report(1, 1, 0, 40);
  r.report(2, 1, 0, 90);
  r.update(ROYALE.retarget);
  assert.equal(r.members[0].target, 2);
  r.members[3].badges = 1;
  r.update(ROYALE.retarget);
  assert.equal(r.members[0].target, 3);
});

test('a target picked by hand sticks until they go down', () => {
  const r = royale(3);
  r.lockOn(0, 2);
  for (let i = 0; i < 40; i++) r.update(0.5);
  assert.equal(r.attack(0), 2);
  r.out(2);
  assert.equal(r.members[0].target, 1);
  assert.equal(r.members[0].lock, null);
});

test('the last attacker gets the KO and the badges; places count down to the last one standing', () => {
  const r = royale(4);
  r.lockOn(1, 2);
  r.lockOn(0, 1);
  assert.equal(r.attack(1), 2);
  assert.deepEqual(r.out(2), { place: 4, by: 1 });
  assert.equal(r.members[1].badges, 1);
  assert.equal(r.attack(0), 1);
  assert.deepEqual(r.out(1), { place: 3, by: 0 });
  assert.equal(r.members[0].badges, 2, 'one badge plus the one they had');
  assert.equal(r.winner, null);
  assert.deepEqual(r.out(3), { place: 2, by: null }, 'nobody attacked them');
  assert.deepEqual(
    r.alive.map((m) => m.id),
    [0],
  );
  assert.equal(r.members[0].place, 1, 'the winner');
  assert.equal(r.out(3), null, 'out only once');
  assert.equal(r.attack(0), null, 'nobody left to attack');
});

test('badges and being targeted by several players make attacks bigger', () => {
  assert.equal(badgeBoost(0), 1);
  assert.equal(badgeBoost(1), 1 + ROYALE.badgeBonus);
  assert.equal(badgeBoost(100), 1 + ROYALE.badgeBonus * ROYALE.badgeTiers.length);
  assert.equal(counterRows(1), 0);
  assert.ok(counterRows(2) > 0 && counterRows(9) >= counterRows(3));
  const b = arena();
  const duel = new Duel(b);
  duel.boost = 1.5;
  duel.counter = 1;
  for (let i = 0; i < DUEL.killsPerRow * 2; i++) b.kill(dummy(b, 1));
  duel.update(DUEL.streakGap);
  assert.equal(duel.take(), 2 * 1.5 + 1);
});

test('a versus level never ends: after the boss the last segment goes on, with its checkpoints again', () => {
  const b = new Battle(CHARACTERS[0], 4, new Set(['boneyard', 'snowy']), 'boneyard');
  new Duel(b);
  const st = b.stage;
  const seen: string[] = [];
  for (let guard = 0; seen.length < 6 && guard < 20000; guard++) {
    st.update(0.25);
    b.enemies = b.enemies.filter((e) => e.def.rank !== 'normal');
    if (st.miniboss) {
      seen.push('miniboss');
      b.kill(st.miniboss);
    } else if (st.boss) {
      seen.push('boss');
      b.kill(st.boss);
    }
  }
  assert.deepEqual(seen, ['miniboss', 'miniboss', 'boss', 'miniboss', 'miniboss', 'boss']);
  assert.equal(st.lap, 2);
  assert.equal(st.segment, 2, 'stays in the widest segment');
  assert.equal(st.state, 'rows');
  for (let i = 0; i < 20; i++) st.update(0.25);
  assert.equal(b.phase, 'play', 'never won');
  assert.ok(st.rows > DUEL.segmentRows * 6);
});

// ---------------------------------------------------------------- the room

type Msg = Record<string, unknown> & { t: string };

/** A connection as server/ws.mjs makes them, recording what the server sends. */
const conn = () => {
  const c = {
    got: [] as Msg[],
    send: (m: Msg) => c.got.push(m),
    onMessage: (_m: Msg) => {},
    onClose: () => {},
    last: (t: string) => [...c.got].reverse().find((m) => m.t === t),
  };
  return c;
};

test('the versus room: a lobby with a host and computer players, attacks to the target, knockouts', () => {
  const a = conn();
  const b = conn();
  joinVersus(a, { t: 'join', mode: 'versus', name: '甲', char: 'warrior', level: 'boneyard' });
  joinVersus(b, { t: 'join', mode: 'versus', name: '乙', char: 'itchy', level: 'snowy' });
  assert.equal(a.last('lobby')!.host, true);
  assert.equal(b.last('lobby')!.host, false);
  b.onMessage({ t: 'start' });
  assert.equal(a.last('start'), undefined, 'only the host starts');
  a.onMessage({ t: 'bot', add: true, skill: 0 });
  const lobby = a.last('lobby')!.players as { name: string; bot: string | null }[];
  assert.deepEqual(
    lobby.map((p) => p.bot),
    [null, null, '简单'],
  );
  a.onMessage({ t: 'start' });
  const start = a.last('start')!;
  assert.equal(start.level, 'boneyard', "the host's level");
  assert.equal(start.you, 0);
  assert.equal(b.last('start')!.you, 1);
  assert.equal(b.last('start')!.seed, start.seed);
  assert.equal((start.players as unknown[]).length, 3);

  a.onMessage({ t: 'target', id: 1 });
  a.onMessage({ t: 'attack', n: 99, r: 12 });
  const hit = b.last('hit')!;
  assert.deepEqual([hit.from, hit.to, hit.n, hit.r], [0, 1, DUEL.maxAttack, 12]);
  assert.deepEqual(a.last('hit'), hit, 'everyone sees it fly');

  b.onMessage({ t: 'over' });
  const ko = a.last('ko')!;
  assert.deepEqual([ko.id, ko.by, ko.place], [1, 0, 3]);
  const status = a.last('status')!.p as number[][];
  assert.equal(status[0][2], 1, 'a badge for the KO');
  assert.equal(a.last('end'), undefined, 'the computer player is still in');
  // The last person leaves: the match stops (no timers left behind).
  a.onClose();
  b.onClose();
});

test('the versus room: two players, the one left standing wins', () => {
  const a = conn();
  const b = conn();
  joinVersus(a, { t: 'join', mode: 'versus', name: '甲', char: 'warrior', level: 'boneyard' });
  joinVersus(b, { t: 'join', mode: 'versus', name: '乙', char: 'warrior', level: 'boneyard' });
  a.onMessage({ t: 'start' });
  b.onMessage({ t: 'snap', s: { hp: 10, maxHp: 100, inc: [[3, 0.5]], rows: 20 } });
  assert.equal(a.last('opp')!.id, 1);
  assert.equal(b.last('opp'), undefined, 'not echoed back');
  a.onClose();
  assert.equal(b.last('end')!.winner, 1);
  b.onClose();
});

test('the versus room: the host can fill it up with computer players', () => {
  const a = conn();
  joinVersus(a, { t: 'join', mode: 'versus', name: '甲', char: 'warrior', level: 'boneyard' });
  a.onMessage({ t: 'bot', add: true, fill: true, skill: 2 });
  const players = a.last('lobby')!.players as { bot: string | null }[];
  assert.equal(players.length, ROYALE.maxPlayers);
  assert.equal(players[7].bot, '困难');
  const b = conn();
  joinVersus(b, { t: 'join', mode: 'versus', name: '乙', char: 'warrior', level: 'boneyard' });
  assert.equal((b.last('lobby')!.players as unknown[]).length, ROYALE.maxPlayers, 'a person takes the place of a computer player');
  a.onClose();
  b.onClose();
});
