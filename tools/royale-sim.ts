// Headless battle royale: up to 8 autopilots play the same level on the same seed with the versus rules of
// src/game/duel.ts and the targeting of src/game/royale.ts, attacks delivered after a short network delay,
// with the per-frame checks of tools/invariants.ts on. Players differ in skill (the share of time they
// fire) and cycle through the targeting strategies. Prints each match and a summary, for tuning DUEL and ROYALE.
// Usage: node tools/royale-sim.ts [matches=4] [players=8] [level=boneyard|snowy] [firstSeed=1] [weakest=0.4 (firing share of the weakest player)]
// Try other tuning with DUEL=key=value,… and ROYALE=key=value,… (numbers only). Everyone plays a different
// character (A the first, B the second, …) unless CHAR=<id> gives them all the same one.
import { Rng } from '../src/core/rng.ts';
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { DUEL, Duel } from '../src/game/duel.ts';
import { ROYALE, Royale, STRATEGIES, badgeBoost, counterRows } from '../src/game/royale.ts';
import { formatIssue, Invariants } from './invariants.ts';

const matches = Number(process.argv[2] ?? 4);
const players = Number(process.argv[3] ?? 8);
const level = process.argv[4] ?? 'boneyard';
const firstSeed = Number(process.argv[5] ?? 1);
const weakest = Number(process.argv[6] ?? 0.4);
/** Seconds an attack takes to reach the other browser. */
const LAG = 0.05;
const LIMIT = 20 * 60;
for (const [name, cfg] of [
  ['DUEL', DUEL],
  ['ROYALE', ROYALE],
] as const)
  for (const kv of (process.env[name] ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in cfg) || typeof (cfg as Record<string, unknown>)[k] !== 'number') throw new Error(`unknown ${name} key ${k}`);
    (cfg as Record<string, number>)[k] = Number(v);
  }

interface Side {
  b: Battle;
  duel: Duel;
  /** Share of the time this player fires (1 = autofire). */
  fire: number;
  sent: number;
  landed: number;
  inv: Invariants;
  end: number | null;
}

function side(seed: number, id: number, fire: number): Side {
  const char = CHARACTERS.find((c) => c.id === process.env.CHAR) ?? CHARACTERS[id % CHARACTERS.length];
  const b = new Battle(char, seed, new Set(['boneyard', 'snowy']), level);
  // Same enemy rows, but crits, drops and offers of their own, like different players.
  (b as { rng: Rng }).rng = new Rng(seed * 16 + id);
  b.live = true;
  const duel = new Duel(b);
  const s: Side = { b, duel, fire, sent: 0, landed: 0, inv: new Invariants(), end: null };
  const land = b.stage.landGarbage.bind(b.stage);
  b.stage.landGarbage = (n, row) => {
    s.landed += n;
    land(n, row);
  };
  return s;
}

function play(seed: number) {
  // Skill from 1 (fires all the time) down to `weakest`; strategies go round.
  const sides = Array.from({ length: players }, (_, i) => side(seed, i, players > 1 ? 1 - ((1 - weakest) * i) / (players - 1) : 1));
  const rng = new Rng(seed * 7 + 3);
  const royale = new Royale(players, () => rng.next());
  sides.forEach((_, i) => royale.setStrategy(i, STRATEGIES[(i + seed) % STRATEGIES.length].id));
  const mail: { at: number; to: number; n: number; row: number }[] = [];
  const kos: string[] = [];
  let t = 0;
  for (let f = 0; t < LIMIT && !royale.winner; f++) {
    t = f / 60;
    for (const m of mail.filter((x) => x.at <= t)) sides[m.to].duel.receive(m.n, m.row);
    mail.splice(0, mail.length, ...mail.filter((x) => x.at > t));
    royale.update(1 / 60);
    for (const [i, s] of sides.entries()) {
      const me = royale.members[i];
      if (!me.alive) continue;
      s.duel.boost = badgeBoost(me.badges);
      s.duel.counter = counterRows(royale.attackers(i));
      autoDecide(s.b);
      const c = autopilot(s.b);
      if (s.fire < 1) {
        s.b.autofire = false;
        c.fire = (f % 120) / 120 < s.fire;
      }
      s.b.update(1 / 60, c);
      s.inv.check(s.b);
      const p = s.b.player;
      royale.report(i, p.hp / p.maxHp, s.duel.pending, s.b.stage.rows);
      const n = s.duel.take();
      if (n) {
        const to = royale.attack(i);
        if (to !== null) {
          s.sent += n;
          mail.push({ at: t + LAG, to, n, row: s.duel.hpRow });
        }
      }
      if (s.b.phase === 'lost') {
        s.end = t;
        const r = royale.out(i)!;
        kos.push(`${'ABCDEFGH'[i]}#${r.place}${r.by !== null ? `<${'ABCDEFGH'[r.by]}` : ''}@${(t / 60).toFixed(1)}`);
      }
    }
  }
  return { sides, royale, kos, t };
}

const results: ReturnType<typeof play>[] = [];
for (let i = 0; i < matches; i++) {
  const seed = firstSeed + i;
  const r = play(seed);
  results.push(r);
  const w = r.royale.winner;
  console.log(
    `seed ${seed}: ${w ? `${'ABCDEFGH'[w.id]} wins` : 'no result'} at ${(r.t / 60).toFixed(1)}m | out: ${r.kos.join(' ')}` +
      ` | winner Lv${w ? r.sides[w.id].b.lvl : '-'} badges ${w?.badges ?? '-'} depth ${w ? r.sides[w.id].b.stage.rows : '-'}`,
  );
  for (const s of r.sides) for (const issue of s.inv.issues) console.log(`  ${formatIssue(issue)}`);
  if (r.sides.some((s) => s.inv.errors.length)) process.exitCode = 1;
}
const mins = results.map((r) => r.t / 60).sort((a, b) => a - b);
const place = (i: number) => results.reduce((s, r) => s + (r.royale.members[i].place || 1), 0) / results.length;
const byStrategy = STRATEGIES.map((st) => {
  const ps = results.flatMap((r) => r.royale.members.filter((m) => m.strategy === st.id).map((m) => m.place || 1));
  return `${st.id} ${(ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(1)}`;
});
const firstOut = results.map((r) => (r.sides.map((s) => s.end ?? r.t).sort((a, b) => a - b)[0] / 60).toFixed(1));
const perMin = (k: 'sent' | 'landed') =>
  (results.reduce((s, r) => s + r.sides.reduce((a, x) => a + x[k], 0), 0) / players / mins.reduce((s, m) => s + m, 0)).toFixed(1);
console.log(
  `\n${matches} matches of ${players}: length median ${mins[Math.floor(mins.length / 2)].toFixed(1)}m (${mins[0].toFixed(1)}–${mins.at(-1)!.toFixed(1)}); ` +
    `first out at ${firstOut.join(' ')}m\nmean place by skill (A strongest): ${sides(players)
      .map((i) => `${'ABCDEFGH'[i]} ${place(i).toFixed(1)}`)
      .join(
        ', ',
      )}\nmean place by strategy: ${byStrategy.join(', ')}; rows per player per minute: sent ${perMin('sent')}, landed ${perMin('landed')}`,
);

function sides(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}
