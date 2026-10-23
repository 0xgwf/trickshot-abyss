// Coverage stress test: puts every ball (each level, alone and fused), every passive and every character
// on the field with a fixed loadout and plays against enemy rows, both minibosses and the boss with the
// per-frame checks of tools/invariants.ts on. Reports crashes, failed checks and damage outliers, and
// exits non-zero if any case crashed or failed a check. The bot plays; the player can't die.
// Usage: node tools/stress.ts [quick|full] [filter]
//   quick (CI): every ball and passive at L3 and every character, about a minute
//   full: every level of every ball and passive on both layers, fusions, every character with every ball
//   filter: only run cases whose name contains this text, and print each of them (e.g. "ball/bomb")
import { autopilot } from '../src/game/autopilot.ts';
import { newOwnedBall } from '../src/game/ball.ts';
import { Battle } from '../src/game/battle.ts';
import { CFG, SEGMENT_COLS, TILE, WORLD_W } from '../src/game/config.ts';
import { BALLS, EVOLVED_BALLS, basePool } from '../src/game/data/balls.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { EVOLVED_PASSIVES, PASSIVES, passivePool } from '../src/game/data/passives.ts';
import { formatIssue, Invariants, type Issue } from './invariants.ts';

type Scene = 'rows' | 'mini1' | 'mini2' | 'boss';
type Parts = [string, number][];

interface Case {
  name: string;
  group: 'ball' | 'passive' | 'fusion' | 'character';
  char: string;
  level: string;
  scene: Scene;
  /** Each entry is one owned ball; two parts make a fused ball. */
  balls: Parts[];
  passives: [string, number][];
  /** Ball cases measure the ball on its own, without baby balls. */
  babies: boolean;
  seconds: number;
}

interface Result {
  c: Case;
  dps: number;
  crash?: string;
  issues: Issue[];
}

const mode = process.argv[2] ?? 'quick';
const filter = process.argv[3] ?? '';
const full = mode === 'full';
const UNLOCKS = new Set(['boneyard', 'snowy']);
const LEVELS = ['boneyard', 'snowy'];
const BASE = basePool(UNLOCKS);
const EVOLVED = EVOLVED_BALLS.map((d) => d.id);
const BASE_PASSIVES = passivePool(UNLOCKS);
const ALL_PASSIVES = [...BASE_PASSIVES, ...EVOLVED_PASSIVES.map((d) => d.id)];
/** Covers the Freeze/Burn/Poison requirements; Phantom curses, for Voodoo Doll. */
const LOADOUT: Parts[] = [[['burn', 3]], [['freeze', 3]], [['poison', 3]], [['phantom', 3]]];
const SCENES: Scene[] = ['rows', 'mini1', 'mini2', 'boss'];

const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
const label = (parts: Parts) => parts.map(([id, lv]) => `${id}${lv}`).join('x');

// ------------------------------------------------------------------ cases

function makeCases(): Case[] {
  const cases: Case[] = [];
  const add = (c: Omit<Case, 'name'>, name: string) => cases.push({ ...c, name: `${c.group}/${name}/${c.scene}/${c.level}` });
  const levels = (i: number) => (full ? LEVELS : [LEVELS[i % 2]]);
  const scenes = (i: number) => (full ? SCENES : (['rows', SCENES[1 + (i % 3)]] as Scene[]));

  // Every ball on its own.
  [...BASE, ...EVOLVED].forEach((id, i) => {
    for (const lv of full ? [1, 2, 3] : [3])
      for (const level of levels(i))
        for (const scene of scenes(i + lv))
          add(
            { group: 'ball', char: 'warrior', level, scene, balls: [[[id, lv]]], passives: [], babies: false, seconds: 45 },
            `${id}${lv}`,
          );
  });

  // Every passive with the standard loadout (and the baseline without one).
  ['none', ...ALL_PASSIVES].forEach((id, i) => {
    for (const lv of full && id !== 'none' ? [1, 2, 3] : [3])
      for (const level of full ? LEVELS : [LEVELS[i % 2]])
        for (const scene of ['rows', 'boss'] as Scene[]) {
          const passives: [string, number][] = id === 'none' ? [] : [[id, lv]];
          // Artificial Heart only works with summoned allies.
          if (id === 'artificialheart') passives.push(['stoneeffigy', 3]);
          add(
            { group: 'passive', char: 'warrior', level, scene, balls: LOADOUT, passives, babies: true, seconds: 45 },
            id === 'none' ? 'none' : `${id}${lv}`,
          );
        }
  });

  // Every character with the standard loadout, plus (full) every ball.
  CHARACTERS.forEach((ch, i) => {
    for (const level of full ? LEVELS : [LEVELS[i % 2]])
      for (const scene of full ? SCENES : (['rows', 'boss'] as Scene[]))
        add({ group: 'character', char: ch.id, level, scene, balls: LOADOUT, passives: [], babies: true, seconds: 45 }, ch.id);
    if (full)
      [...BASE, ...EVOLVED].forEach((id, j) =>
        add(
          {
            group: 'character',
            char: ch.id,
            level: LEVELS[j % 2],
            scene: 'rows',
            balls: [[[id, 3]]],
            passives: [],
            babies: true,
            seconds: 30,
          },
          `${ch.id}+${id}3`,
        ),
      );
  });

  // Fused balls: every base pair (full), or a sample; plus a sample of pairs that include evolved balls.
  const pairs: [string, string][] = [];
  const all = [...BASE, ...EVOLVED];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) pairs.push([all[i], all[j]]);
  const picked = pairs.filter(([a, c]) =>
    BALLS[a].evolved || BALLS[c].evolved ? hash(a + c) % (full ? 8 : 60) === 0 : full || hash(a + c) % 6 === 0,
  );
  picked.forEach(([a, c], i) =>
    add(
      {
        group: 'fusion',
        char: 'warrior',
        level: LEVELS[i % 2],
        scene: i % 3 === 0 ? 'boss' : 'rows',
        balls: [
          [
            [a, 3],
            [c, 3],
          ],
        ],
        passives: [],
        babies: false,
        seconds: 30,
      },
      `${a}3x${c}3`,
    ),
  );
  return cases.filter((c) => c.name.includes(filter));
}

// ------------------------------------------------------------------ running

function setup(c: Case) {
  const char = CHARACTERS.find((x) => x.id === c.char)!;
  // Same seed for every case of a scene, so comparisons start from the same enemy rows.
  const b = new Battle(char, hash(`${c.scene}/${c.level}`), UNLOCKS, c.level);
  for (const ob of [...b.owned]) b.removeOwned(ob);
  for (const parts of c.balls) {
    const ob = newOwnedBall(
      parts.map(([id, lv]) => ({ def: BALLS[id], lv })),
      parts.length > 1,
    );
    b.owned.push(ob);
    b.queue.push(ob);
  }
  b.passives = c.passives.map(([id, lv]) => ({ def: PASSIVES[id], lv }));
  b.recomputeStats();
  if (!c.babies) b.stats.babyCount = 0;
  b.syncBabies();

  const st = b.stage;
  if (c.scene === 'boss') st.debugSkipToBoss();
  else {
    // Deep into the level so every enemy type shows up; the minibosses arrive at once.
    st.segment = c.scene === 'mini1' ? 0 : c.scene === 'mini2' ? 1 : 2;
    st.rows = CFG.segmentRows * (st.segment + 1);
    st.segRows = c.scene === 'rows' ? 0 : CFG.segmentRows;
    const w = SEGMENT_COLS[st.segment] * TILE;
    b.targetLeft = b.left = (WORLD_W - w) / 2;
    b.targetRight = b.right = b.left + w;
  }
  return b;
}

function run(c: Case): Result {
  const b = setup(c);
  const inv = new Invariants();
  const start = b.t;
  try {
    while (b.t - start < c.seconds && b.phase !== 'won') {
      if (b.phase === 'levelup' || b.phase === 'reactor') {
        // Keep the loadout fixed: skip level-ups and reactors without recomputing stats.
        b.pendingLevelUps = 0;
        b.pendingReactors = 0;
        b.offers = null;
        b.reactor = null;
        b.phase = 'play';
      }
      if (b.phase === 'lost' || b.player.hp < b.player.maxHp * 0.3) {
        b.player.hp = b.player.maxHp;
        b.phase = 'play';
      }
      b.update(1 / 60, autopilot(b));
      inv.check(b);
    }
  } catch (err) {
    const e = err as Error;
    const where =
      e.stack
        ?.split('\n')
        .find((l) => l.includes('/src/'))
        ?.trim() ?? '';
    return { c, dps: 0, crash: `t=${(b.t - start).toFixed(1)}s ${e.message} ${where}`, issues: inv.issues };
  }
  return { c, dps: b.damageDealt / Math.max(1, b.t - start), issues: inv.issues };
}

// ------------------------------------------------------------------ report

const cases = makeCases();
const verbose = filter !== '';
console.log(`stress ${mode}: ${cases.length} cases${filter ? ` matching "${filter}"` : ''}`);
const started = Date.now();
const results: Result[] = [];
for (const c of cases) {
  const r = run(c);
  results.push(r);
  const failed = r.crash || r.issues.some((i) => i.level === 'error');
  if (verbose || failed || r.issues.length) {
    console.log(`${failed ? 'FAIL' : r.issues.length ? 'warn' : 'ok  '} ${c.name}  dps=${Math.round(r.dps)}`);
    if (r.crash) console.log(`     crashed at ${r.crash}`);
    for (const i of r.issues) console.log(`     ${formatIssue(i)}`);
    if (failed && !verbose) console.log(`     repro: node tools/stress.ts ${mode} ${c.name}`);
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Damage outliers among single balls: same scene, layer, tier and level.
const outliers: string[] = [];
const buckets = new Map<string, Result[]>();
for (const r of results) {
  if (r.c.group !== 'ball' || r.crash) continue;
  const [id, lv] = r.c.balls[0][0];
  const key = `${r.c.scene}/${r.c.level}/${BALLS[id].evolved ? 'evolved' : 'base'}/L${lv}`;
  buckets.set(key, [...(buckets.get(key) ?? []), r]);
}
for (const [key, list] of buckets) {
  const m = median(list.map((r) => r.dps));
  for (const r of list)
    if (r.dps > m * 5 || r.dps < m / 5)
      outliers.push(`${label(r.c.balls[0])} ${key}: ${Math.round(r.dps)} dps (median ${Math.round(m)}, ×${(r.dps / (m || 1)).toFixed(2)})`);
}

// Passive impact: damage relative to the same loadout without passives.
const impact: string[] = [];
for (const r of results) {
  if (r.c.group !== 'passive' || !r.c.passives.length || r.crash) continue;
  const base = results.find((x) => x.c.name === `passive/none/${r.c.scene}/${r.c.level}`);
  if (!base?.dps) continue;
  const ratio = r.dps / base.dps;
  if (ratio > 3 || ratio < 0.6) impact.push(`${label(r.c.passives)} ${r.c.scene}/${r.c.level}: ×${ratio.toFixed(2)} damage`);
}

if (!verbose) {
  const top = results
    .filter((r) => r.c.group === 'ball' && r.c.scene === 'rows' && r.c.balls[0][0][1] === 3 && !r.crash)
    .sort((a, b) => b.dps - a.dps);
  const row = (r: Result) => `${label(r.c.balls[0])} ${Math.round(r.dps)}`;
  console.log(`\nBall damage per second on rows (L3, alone): top ${top.slice(0, 8).map(row).join(', ')}`);
  console.log(`  bottom ${top.slice(-8).map(row).join(', ')}`);
}
console.log(`\nDamage outliers (×5 off the median of their group): ${outliers.length ? '' : 'none'}`);
for (const o of outliers) console.log(`  ${o}`);
console.log(`Passives that change damage by more than ×3 or less than ×0.6: ${impact.length ? '' : 'none'}`);
for (const o of impact) console.log(`  ${o}`);

const failed = results.filter((r) => r.crash || r.issues.some((i) => i.level === 'error'));
const warned = results.filter((r) => !failed.includes(r) && r.issues.length);
console.log(
  `\n${results.length} cases in ${((Date.now() - started) / 1000).toFixed(0)}s: ${failed.length} failed, ${warned.length} with warnings`,
);
if (failed.length) process.exitCode = 1;
