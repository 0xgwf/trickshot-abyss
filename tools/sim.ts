// Headless balance/crash test: plays whole runs with the autopilot, with the per-frame checks of
// tools/invariants.ts on. Exits non-zero on a crash or a failed check.
// Usage: node tools/sim.ts [runs=6] [character=warrior] [unlocks=boneyard|snowy|none] [scenario=full|boss] [level=boneyard|snowy] [firstSeed=1000]
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { newOwnedBall } from '../src/game/ball.ts';
import { CFG } from '../src/game/config.ts';
import { BALLS } from '../src/game/data/balls.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { PASSIVES } from '../src/game/data/passives.ts';
import { formatIssue, Invariants } from './invariants.ts';

const runs = Number(process.argv[2] ?? 6);
const charId = process.argv[3] ?? 'warrior';
const unlocks = new Set(process.argv[4] === 'snowy' ? ['boneyard', 'snowy'] : process.argv[4] === 'boneyard' ? ['boneyard'] : []);
const scenario = process.argv[5] ?? 'full';
const levelId = process.argv[6] ?? 'boneyard';
const firstSeed = Number(process.argv[7] ?? 1000);
const char = CHARACTERS.find((c) => c.id === charId)!;

const BOSS_BUILDS = [
  {
    balls: [
      ['bomb', 2],
      ['wraith', 2],
      ['bleed', 3],
      ['laserv', 3],
    ],
    passives: [
      ['shortbow', 3],
      ['staff', 2],
      ['dumbbell', 3],
      ['breastplate', 2],
    ],
  },
  {
    balls: [
      ['frozenflame', 2],
      ['holylaser', 2],
      ['earthquake', 3],
      ['ghost', 3],
    ],
    passives: [
      ['cloak', 3],
      ['magnet', 2],
      ['warhorn', 3],
      ['beholder', 1],
    ],
  },
  {
    balls: [
      ['mosquitoking', 2],
      ['virus', 1],
      ['iron', 3],
      ['lightning', 3],
    ],
    passives: [
      ['silverbullet', 3],
      ['rubber', 2],
      ['onesie', 3],
      ['fleetfeet', 2],
    ],
  },
];

/** Jumps straight to the boss fight with a plausible late-run build. */
function setupBoss(b: Battle, i: number) {
  const build = BOSS_BUILDS[i % BOSS_BUILDS.length];
  for (const ob of [...b.owned]) b.removeOwned(ob);
  for (const [id, lv] of build.balls) {
    const ob = newOwnedBall([{ def: BALLS[id as string], lv: lv as number }]);
    b.owned.push(ob);
    b.queue.push(ob);
  }
  b.passives = build.passives.map(([id, lv]) => ({ def: PASSIVES[id as string], lv: lv as number }));
  b.lvl = 28;
  b.recomputeStats();
  b.syncBabies();
  const st = b.stage;
  st.segment = 2;
  st.rows = CFG.segmentRows * 3;
  st.segRows = CFG.segmentRows;
  b.targetLeft = b.left = 0;
  b.targetRight = b.right = 14 * 48;
}

for (let i = 0; i < runs; i++) {
  const seed = firstSeed + i;
  const b = new Battle(char, seed, unlocks, levelId);
  const inv = new Invariants();
  if (scenario === 'boss') setupBoss(b, i);
  const started = Date.now();
  const segTimes: number[] = [];
  let lastSeg = b.stage.segment;
  let bossStart = -1;
  try {
    while (b.phase !== 'won' && b.phase !== 'lost' && b.t < 40 * 60) {
      autoDecide(b);
      b.update(1 / 60, autopilot(b));
      inv.check(b);
      if (b.stage.segment !== lastSeg) {
        segTimes.push(Math.round(b.t));
        lastSeg = b.stage.segment;
      }
      if (bossStart < 0 && b.stage.boss) bossStart = b.t;
    }
  } catch (err) {
    console.error(`seed ${seed} crashed at t=${b.t.toFixed(1)}:`, err);
    process.exitCode = 1;
    continue;
  }
  const balls = b.owned.map((o) => o.parts.map((p) => `${p.def.id}${p.lv}`).join('x')).join(' ');
  const pas = b.passives.map((p) => `${p.def.id}${p.lv}`).join(' ');
  const boss = b.stage.bossBar;
  const hurt = Object.fromEntries(Object.entries(b.hurtBy).map(([k, v]) => [k, Math.round(v)]));
  console.log(
    `seed ${seed}: ${b.phase.padEnd(4)} t=${(b.t / 60).toFixed(1)}m seg=${b.stage.segment} rows=${b.stage.rows} segAt=${segTimes.join('/')}s ` +
      `boss@${bossStart < 0 ? '-' : Math.round(bossStart) + 's'} bossLeft=${boss ? Math.round(boss.frac * 100) + '%' : '-'} ` +
      `lv=${b.lvl} kills=${b.kills} hp=${Math.round(b.player.hp)}/${b.player.maxHp} dmg=${Math.round(b.damageDealt)} ` +
      `balls=[${balls}] passives=[${pas}] hurt=${JSON.stringify(hurt)} (${Date.now() - started}ms)`,
  );
  for (const issue of inv.issues) console.log(`  ${formatIssue(issue)}`);
  if (inv.errors.length) process.exitCode = 1;
}
