// Headless versus: two autopilots race through the same level on the same seed with the versus rules of
// src/game/duel.ts, attacks delivered after a short network delay, with the per-frame checks of
// tools/invariants.ts on. Prints each match and a summary, for tuning DUEL. Player B can be handicapped
// (autofire off, firing only part of the time) to check that the weaker player loses.
// Usage: node tools/versus-sim.ts [matches=8] [level=boneyard|snowy] [handicap=1 (B's share of firing time)] [firstSeed=1]
// Try other tuning with DUEL=key=value,key=value (e.g. DUEL=marginStart=120,killsPerRow=6).
import { Rng } from '../src/core/rng.ts';
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { DUEL, Duel } from '../src/game/duel.ts';
import { formatIssue, Invariants } from './invariants.ts';

const matches = Number(process.argv[2] ?? 8);
const level = process.argv[3] ?? 'boneyard';
const handicap = Number(process.argv[4] ?? 1);
const firstSeed = Number(process.argv[5] ?? 1);
/** Seconds an attack takes to reach the other browser. */
const LAG = 0.05;
const LIMIT = 20 * 60;
for (const kv of (process.env.DUEL ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in DUEL)) throw new Error(`unknown DUEL key ${k}`);
  (DUEL as Record<string, number>)[k] = Number(v);
}

interface Side {
  b: Battle;
  duel: Duel;
  fire: number;
  sent: number;
  landed: number;
  inv: Invariants;
  end: number | null;
}

function side(seed: number, fire: number, own: number): Side {
  const b = new Battle(CHARACTERS[0], seed, new Set(['boneyard', 'snowy']), level);
  // Same enemy rows, but crits, drops and offers of their own, like two different players.
  (b as { rng: Rng }).rng = new Rng(own);
  b.live = true;
  const duel = new Duel(b);
  const s: Side = { b, duel, fire, sent: 0, landed: 0, inv: new Invariants(), end: null };
  const land = b.stage.landGarbage.bind(b.stage);
  b.stage.landGarbage = (n) => {
    s.landed += n;
    land(n);
  };
  return s;
}

const over = (s: Side) => s.b.phase === 'won' || s.b.phase === 'lost';

function play(seed: number) {
  const sides = [side(seed, 1, seed * 2), side(seed, handicap, seed * 2 + 1)];
  const mail: { at: number; to: Side; n: number; row: number }[] = [];
  let t = 0;
  let winner = -1;
  let how = 'time';
  for (let f = 0; t < LIMIT && winner < 0; f++) {
    t = f / 60;
    for (const m of mail.filter((x) => x.at <= t)) m.to.duel.receive(m.n, m.row);
    mail.splice(0, mail.length, ...mail.filter((x) => x.at > t));
    for (const [i, s] of sides.entries()) {
      if (over(s)) continue;
      autoDecide(s.b);
      const c = autopilot(s.b);
      if (s.fire < 1) {
        s.b.autofire = false;
        c.fire = (f % 120) / 120 < s.fire;
      }
      s.b.update(1 / 60, c);
      s.inv.check(s.b);
      const n = s.duel.take();
      if (n) {
        s.sent += n;
        mail.push({ at: t + LAG, to: sides[1 - i], n, row: s.duel.hpRow });
      }
      if (over(s)) s.end = t;
    }
    // Same verdict as src/ui/versus.ts: first to clear wins, otherwise whoever is still standing.
    const [a, b] = sides;
    if (a.b.phase === 'won' || b.b.phase === 'won') [winner, how] = [a.b.phase === 'won' ? 0 : 1, 'clear'];
    else if (a.b.phase === 'lost' || b.b.phase === 'lost') [winner, how] = [a.b.phase === 'lost' ? 1 : 0, 'down'];
  }
  return { sides, winner, how, t };
}

const results: ReturnType<typeof play>[] = [];
for (let i = 0; i < matches; i++) {
  const seed = firstSeed + i;
  const r = play(seed);
  results.push(r);
  const who = (s: Side) =>
    `Lv${s.b.lvl} ${Math.round(s.b.stage.progress * 100)}% hp=${Math.round(s.b.player.hp)} sent=${s.sent} landed=${s.landed} bottom=${s.b.hurtBy.bottom ?? 0}`;
  console.log(
    `seed ${seed}: ${r.winner < 0 ? 'no result' : `${'AB'[r.winner]} wins (${r.how})`} at ${(r.t / 60).toFixed(1)}m | A ${who(r.sides[0])} | B ${who(r.sides[1])}`,
  );
  for (const s of r.sides) for (const issue of s.inv.issues) console.log(`  ${formatIssue(issue)}`);
  if (r.sides.some((s) => s.inv.errors.length)) process.exitCode = 1;
}
const mins = results.map((r) => r.t / 60).sort((a, b) => a - b);
const wins = [0, 1].map((w) => results.filter((r) => r.winner === w).length);
const downs = results.filter((r) => r.how === 'down').length;
const perMin = (k: 'sent' | 'landed') =>
  (results.reduce((s, r) => s + r.sides[0][k] + r.sides[1][k], 0) / 2 / mins.reduce((s, m) => s + m, 0)).toFixed(1);
console.log(
  `\n${matches} matches (B fires ${Math.round(handicap * 100)}%): A won ${wins[0]}, B won ${wins[1]}; ${downs} decided by a player going down; ` +
    `length median ${mins[Math.floor(mins.length / 2)].toFixed(1)}m (${mins[0].toFixed(1)}–${mins.at(-1)!.toFixed(1)}); ` +
    `rows per player per minute: sent ${perMin('sent')}, landed ${perMin('landed')}`,
);
