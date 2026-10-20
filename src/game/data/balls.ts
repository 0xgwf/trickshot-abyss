// SPDX-License-Identifier: CC-BY-SA-4.0
// Game data adapted from the BALL x PIT Wiki (ballxpit.wiki.gg, CC BY-SA 4.0) and the sources listed
// in ATTRIBUTION.md; translated, condensed and partly estimated (see docs/NOTES.md).
import type { Battle } from '../battle.ts';
import type { Ball } from '../ball.ts';
import { TILE } from '../config.ts';
import type { Enemy } from '../enemy.ts';
import type { BallDef, Range } from '../types.ts';

// Numbers are the wiki's L1/L2/L3 values (Balls page and each ball's page). Where the wiki has no number
// (durations of some evolved statuses, cooldowns of self-destructing spawners) the value is
// marked "est." and picked to match the nearest documented ball.

const v = <T>(lv: number, arr: readonly T[]): T => arr[Math.min(arr.length, lv) - 1];
const r = (x: Range) => `${x[0]}-${x[1]}`;

/** Runs `fn` once every `interval` seconds of the ball's flight. */
const every = (ball: Ball, key: string, interval: number, dt: number, fn: () => void) => {
  ball.timers[key] = (ball.timers[key] ?? interval * 0.5) - dt;
  if (ball.timers[key] <= 0) {
    ball.timers[key] += interval;
    fn();
  }
};

const aura = (b: Battle, ball: Ball, dt: number, dmg: Range = [6, 12]) =>
  every(ball, 'aura', 1, dt, () => {
    for (const e of b.enemiesInRadius(ball.x, ball.y, 1)) b.damage(e, b.roll(dmg), 'aoe');
  });

const spawnMosquitos = (b: Battle, x: number, y: number, n: number, dmg: Range, steal: number) => {
  for (let i = 0; i < n; i++) b.addMinion({ kind: 'mosquito', x, y, target: b.randomEnemy(), dmg, life: 6, steal });
};

const beamFx = (b: Battle, x: number, y: number, a: number, color: string, width: number) => {
  const len = 2000;
  b.beam(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, color, width, 0.18);
};

const outAngle = (ball: Ball) => Math.atan2(ball.vy, ball.vx);

const sacExplode = (b: Battle, ball: Ball, e: Enemy, n: number, self: string) => {
  b.ring(e.cx, e.cy, TILE * 0.7, '#f0e0b0', 0.25);
  const inherit = b.inheritParts(ball, self);
  for (let i = 0; i < n; i++) b.spawnBaby(e.cx, e.y + e.h + 4, b.rng.range(-Math.PI + 0.25, -0.25), inherit);
};

// ------------------------------------------------------------------ base balls

const base: BallDef[] = [
  {
    id: 'bleed',
    zh: '放血',
    en: 'Bleed',
    evolved: false,
    pool: 'default',
    color: '#e0334f',
    hit: [3.5, 6.5],
    desc: (lv) => `命中施加 ${v(lv, [2, 4, 4])} 层流血。流血的敌人每被弹珠击中一次，每层额外受到 1 点伤害（上限 ${v(lv, [8, 11, 14])} 层）`,
    onHit: (b, _ball, e, lv) => b.applyBleed(e, v(lv, [2, 4, 4]), v(lv, [8, 11, 14])),
  },
  {
    id: 'broodmother',
    zh: '育母',
    en: 'Brood Mother',
    evolved: false,
    pool: 'default',
    spawner: true,
    color: '#d58cff',
    hit: [3.5, 6.5],
    desc: (lv) => `每次命中敌人有 ${v(lv, [25, 35, 45])}% 几率生出一颗迷你弹珠`,
    onHit: (b, ball, e, lv) => {
      if (b.rng.chance(v(lv, [0.25, 0.35, 0.45]))) b.spawnBaby(e.cx, e.y + e.h + 4, undefined, b.inheritParts(ball, 'broodmother'));
    },
  },
  {
    id: 'burn',
    zh: '燃烧',
    en: 'Burn',
    evolved: false,
    pool: 'default',
    color: '#ff7b29',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `命中添加 1 层燃烧，持续 ${v(lv, [3, 3, 5])} 秒（上限 ${v(lv, [3, 3, 5])} 层）。燃烧的敌人每层每秒受到 ${r(
        v(lv, [
          [4, 8],
          [7, 11],
          [7, 11],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.applyDot(
        e,
        'burn',
        1,
        v(lv, [3, 3, 5]),
        v(lv, [3, 3, 5]),
        v(lv, [
          [4, 8],
          [7, 11],
          [7, 11],
        ] as Range[]),
      ),
  },
  {
    id: 'earthquake',
    zh: '地震',
    en: 'Earthquake',
    evolved: false,
    pool: 'default',
    color: '#c39a5a',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `对周围 ${v(lv, [3, 3, 4])}x${v(lv, [3, 3, 4])} 格内的敌人造成 ${r(
        v(lv, [
          [5, 13],
          [9, 17],
          [9, 17],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      const n = v(lv, [3, 3, 4]);
      b.ring(e.cx, e.cy, (n * TILE) / 2, '#c39a5a', 0.25);
      b.shake = Math.min(8, b.shake + 1.5);
      b.aoe(
        b.enemiesInSquare(e.cx, e.cy, n),
        v(lv, [
          [5, 13],
          [9, 17],
          [9, 17],
        ] as Range[]),
      );
    },
  },
  {
    id: 'eggsac',
    zh: '巢囊',
    en: 'Egg Sac',
    evolved: false,
    pool: 'default',
    spawner: true,
    destroyOnHit: true,
    color: '#efe0b8',
    hit: [3.5, 6.5],
    cooldown: () => 3,
    desc: (lv) =>
      `命中敌人时炸成 ${r(
        v(lv, [
          [2, 4],
          [2, 5],
          [3, 5],
        ] as Range[]),
      )} 颗迷你弹珠。发射后需冷却 3 秒`,
    onHit: (b, ball, e, lv) =>
      sacExplode(
        b,
        ball,
        e,
        b.rng.int(
          ...v(lv, [
            [2, 4],
            [2, 5],
            [3, 5],
          ] as [number, number][]),
        ),
        'eggsac',
      ),
  },
  {
    id: 'freeze',
    zh: '冰冻',
    en: 'Freeze',
    evolved: false,
    pool: 'default',
    color: '#7fdcff',
    hit: [3.5, 6.5],
    desc: (lv) => `${v(lv, [4, 7, 7])}% 几率冰冻敌人 ${v(lv, [5, 5, 8])} 秒。冰冻的敌人受到的伤害提高 25%`,
    onHit: (b, _ball, e, lv) => {
      if (b.rng.chance(v(lv, [0.04, 0.07, 0.07]))) b.applyFreeze(e, v(lv, [5, 5, 8]));
    },
  },
  {
    id: 'ghost',
    zh: '幽灵',
    en: 'Ghost',
    evolved: false,
    pool: 'default',
    passThrough: true,
    color: '#d6dcff',
    hit: [3.5, 6.5],
    desc: () => '穿过敌人',
  },
  {
    id: 'iron',
    zh: '黑铁',
    en: 'Iron',
    evolved: false,
    pool: 'default',
    color: '#8d94a0',
    hit: [3.5, 6.5],
    dmgMul: () => 2,
    speedMul: (lv) => 1 - v(lv, [0.4, 0.4, 0.3]),
    desc: (lv) => `造成双倍伤害，但移动速度慢 ${v(lv, [40, 40, 30])}%`,
  },
  {
    id: 'laserh',
    zh: '横向激光',
    en: 'Laser (Horizontal)',
    evolved: false,
    pool: 'default',
    color: '#ff5ad8',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `对同一行的所有敌人造成 ${r(
        v(lv, [
          [9, 18],
          [11, 26],
          [13, 34],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.beam(b.left, e.cy, b.right, e.cy, '#ff5ad8', 6, 0.18);
      b.aoe(
        b.enemiesInRow(e.cy),
        v(lv, [
          [9, 18],
          [11, 26],
          [13, 34],
        ] as Range[]),
      );
    },
  },
  {
    id: 'laserv',
    zh: '纵向激光',
    en: 'Laser (Vertical)',
    evolved: false,
    pool: 'default',
    color: '#5aa2ff',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `对同一列的所有敌人造成 ${r(
        v(lv, [
          [9, 18],
          [11, 26],
          [13, 34],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.beam(e.cx, 0, e.cx, 2000, '#5aa2ff', 6, 0.18);
      b.aoe(
        b.enemiesInCol(e.cx),
        v(lv, [
          [9, 18],
          [11, 26],
          [13, 34],
        ] as Range[]),
      );
    },
  },
  {
    id: 'lightning',
    zh: '闪电',
    en: 'Lightning',
    evolved: false,
    pool: 'default',
    color: '#ffe95a',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `对附近最多 ${v(lv, [3, 3, 5])} 个敌人造成 ${r(
        v(lv, [
          [1, 20],
          [1, 30],
          [1, 30],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.chainLightning(
        e.cx,
        e.cy,
        v(lv, [3, 3, 5]),
        v(lv, [
          [1, 20],
          [1, 30],
          [1, 30],
        ] as Range[]),
      ),
  },
  {
    id: 'poison',
    zh: '中毒',
    en: 'Poison',
    evolved: false,
    pool: 'default',
    color: '#86d64e',
    hit: [3.5, 6.5],
    desc: (lv) =>
      `命中施加 1 层中毒（上限 ${v(lv, [5, 5, 8])} 层）。中毒持续 ${v(lv, [6, 6, 9])} 秒，每层每秒造成 ${r(
        v(lv, [
          [1, 4],
          [2, 5],
          [2, 5],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.applyDot(
        e,
        'poison',
        1,
        v(lv, [5, 5, 8]),
        v(lv, [6, 6, 9]),
        v(lv, [
          [1, 4],
          [2, 5],
          [2, 5],
        ] as Range[]),
      ),
  },
  {
    id: 'vampire',
    zh: '吸血鬼',
    en: 'Vampire',
    evolved: false,
    pool: 'default',
    color: '#b3122f',
    hit: [3.5, 6.5],
    desc: (lv) => `每次命中有 ${v(lv, [4.5, 6, 6])}% 几率回复 ${v(lv, [1, 1, 2])} 点生命`,
    onHit: (b, _ball, _e, lv) => {
      if (b.rng.chance(v(lv, [0.045, 0.06, 0.06]))) b.heal(v(lv, [1, 1, 2]));
    },
  },
  {
    id: 'wind',
    zh: '疾风',
    en: 'Wind',
    evolved: false,
    pool: 'default',
    passThrough: true,
    color: '#a9f2d2',
    hit: [3.5, 6.5],
    dmgMul: () => 0.75,
    desc: (lv) => `穿过敌人并使其减速 ${v(lv, [30, 30, 45])}%，持续 ${v(lv, [5, 8, 8])} 秒，但伤害降低 25%`,
    onHit: (b, _ball, e, lv) => b.applySlow(e, v(lv, [0.3, 0.3, 0.45]), v(lv, [5, 8, 8])),
  },
  {
    id: 'stone',
    zh: '岩石',
    en: 'Stone',
    evolved: false,
    pool: 'snowy-clear',
    color: '#a3988a',
    hit: [3.5, 6.5],
    desc: (lv) => `初始造成 ${v(lv, [300, 350, 400])}% 伤害。每次命中敌人伤害降低 ${v(lv, [40, 35, 30])}%（最低 50%）`,
    onLaunch: (_b, ball, lv) => {
      ball.timers.stone = v(lv, [3, 3.5, 4]);
    },
    ballMul: (_b, ball, _e, lv) => ball.timers.stone ?? v(lv, [3, 3.5, 4]),
    onHit: (_b, ball, _e, lv) => {
      ball.timers.stone = Math.max(0.5, (ball.timers.stone ?? v(lv, [3, 3.5, 4])) - v(lv, [0.4, 0.35, 0.3]));
    },
  },
  {
    id: 'dark',
    zh: '黑暗',
    en: 'Dark',
    evolved: false,
    pool: 'boneyard-clear',
    destroyOnHit: true,
    color: '#6a2fa0',
    hit: [3.5, 6.5],
    dmgMul: (lv) => v(lv, [3, 4, 5]),
    cooldown: () => 3,
    desc: (lv) => `造成 ${v(lv, [3, 4, 5])} 倍伤害，但命中敌人后自毁。发射后需冷却 3 秒`,
  },
];

// ------------------------------------------------------------------ evolved balls

const evolved: BallDef[] = [
  {
    id: 'assassin',
    zh: '刺客',
    en: 'Assassin',
    evolved: true,
    color: '#5b5b80',
    hit: [4.2, 8.0],
    recipes: [[['iron'], ['ghost', 'dark']]],
    pierceSides: ['front', 'left', 'right'],
    desc: (lv) => `从正面穿过敌人，但不会穿过背面。背刺额外造成 ${v(lv, [30, 40, 50])}% 伤害`,
    ballMul: (_b, _ball, _e, lv, side) => (side === 'back' ? 1 + v(lv, [0.3, 0.4, 0.5]) : 1),
  },
  {
    id: 'banishedflame',
    zh: '禁忌之焰',
    en: 'Banished Flame',
    evolved: true,
    color: '#9b46ff',
    hit: [3.6, 6.8],
    recipes: [[['dark'], ['burn']]],
    desc: (lv) =>
      `命中添加 1 层暗焰，持续 2 秒（上限 ${v(lv, [6, 6, 8])} 层）。暗焰每层每秒造成 ${r(
        v(lv, [
          [1, 30],
          [1, 35],
          [1, 35],
        ] as Range[]),
      )} 伤害，熄灭时再造成 1-100 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.applyDot(
        e,
        'darkflame',
        1,
        v(lv, [6, 6, 8]),
        2,
        v(lv, [
          [1, 30],
          [1, 35],
          [1, 35],
        ] as Range[]),
      ),
  },
  {
    id: 'blizzard',
    zh: '暴风雪',
    en: 'Blizzard',
    evolved: true,
    color: '#c8f4ff',
    hit: [4.2, 8.0],
    recipes: [[['freeze'], ['wind', 'lightning']]],
    desc: (lv) =>
      `冰冻 2 格范围内的所有敌人 ${v(lv, [0.8, 1.3, 1.3])} 秒，并造成 ${r(
        v(lv, [
          [1, 50],
          [1, 50],
          [1, 70],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.ring(e.cx, e.cy, TILE * 2, '#c8f4ff', 0.3);
      b.aoe(
        b.enemiesInRadius(e.cx, e.cy, 2),
        v(lv, [
          [1, 50],
          [1, 50],
          [1, 70],
        ] as Range[]),
        'aoe',
        (o) => b.applyFreeze(o, v(lv, [0.8, 1.3, 1.3])),
      );
    },
  },
  {
    id: 'bomb',
    zh: '炸弹',
    en: 'Bomb',
    evolved: true,
    destroyOnHit: true,
    color: '#3b3b3b',
    hit: [3.6, 6.8],
    recipes: [[['burn'], ['iron']]],
    cooldown: () => 3,
    desc: (lv) =>
      `命中敌人时爆炸，对附近敌人造成 ${r(
        v(lv, [
          [150, 300],
          [200, 400],
          [200, 400],
        ] as Range[]),
      )} 伤害。发射后需冷却 3 秒`,
    onHit: (b, _ball, e, lv) =>
      b.explode(
        e.cx,
        e.cy,
        1.6,
        v(lv, [
          [150, 300],
          [200, 400],
          [200, 400],
        ] as Range[]),
      ),
  },
  {
    id: 'brimstone',
    zh: '硫磺',
    en: 'Brimstone',
    evolved: true,
    color: '#e3c641',
    hit: [4.2, 8.0],
    recipes: [[['stone', 'poison'], ['burn']]],
    desc: (lv) =>
      `每秒对 2 格范围内的所有敌人施加 1 层燃烧和 1 层中毒（上限 4 层）。燃烧每层每秒 ${r(
        v(lv, [
          [1, 4],
          [1, 7],
          [1, 7],
        ] as Range[]),
      )}，中毒每层每秒 ${r(
        v(lv, [
          [2, 3],
          [2, 3],
          [3, 5],
        ] as Range[]),
      )}`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'brim', 1, dt, () => {
        b.ring(ball.x, ball.y, TILE * 2, '#e3c64155', 0.25);
        for (const e of b.enemiesInRadius(ball.x, ball.y, 2)) {
          b.applyDot(
            e,
            'burn',
            1,
            4,
            3,
            v(lv, [
              [1, 4],
              [1, 7],
              [1, 7],
            ] as Range[]),
          );
          b.applyDot(
            e,
            'poison',
            1,
            4,
            4,
            v(lv, [
              [2, 3],
              [2, 3],
              [3, 5],
            ] as Range[]),
          );
        }
      }),
  },
  {
    id: 'drill',
    zh: '钻头',
    en: 'Drill',
    evolved: true,
    color: '#c9a961',
    hit: [3.6, 6.8],
    recipes: [[['earthquake'], ['iron']]],
    desc: (lv) => `穿透敌人，在碰到坑道顶端之前额外造成 ${v(lv, [50, 75, 100])}% 伤害`,
    onLaunch: (_b, ball) => {
      ball.pierceUntilBack = true;
    },
    ballMul: (_b, ball, _e, lv) => (ball.hitBack ? 1 : 1 + v(lv, [0.5, 0.75, 1])),
  },
  {
    id: 'elemental',
    zh: '元素',
    en: 'Elemental',
    evolved: true,
    color: '#ffffff',
    hit: [3.6, 6.8],
    recipes: [[['burn'], ['wind'], ['freeze'], ['earthquake']]],
    desc: () => '命中时对附近敌人施加随机状态：燃烧、减速或冰冻',
    onHit: (b, _ball, e) => {
      for (const o of b.enemiesInRadius(e.cx, e.cy, 1.5)) {
        const k = b.rng.int(0, 2);
        if (k === 0) b.applyDot(o, 'burn', 1, 3, 3, [4, 8]);
        else if (k === 1) b.applySlow(o, 0.3, 5);
        else b.applyFreeze(o, 1.5);
      }
    },
  },
  {
    id: 'fireworks',
    zh: '烟花',
    en: 'Fireworks',
    evolved: true,
    spawner: true,
    destroyOnHit: true,
    color: '#ff5a86',
    hit: [3.6, 6.8],
    recipes: [[['burn'], ['eggsac']]],
    cooldown: () => 3, // est. (inherits Egg Sac's cooldown)
    desc: (lv) =>
      `炸成 ${r(
        v(lv, [
          [3, 6],
          [3, 6],
          [4, 8],
        ] as Range[]),
      )} 发烟花。烟花追踪随机敌人，造成 20-30 伤害并施加 1 层燃烧（每层每秒 ${r(
        v(lv, [
          [7, 11],
          [10, 14],
          [10, 14],
        ] as Range[]),
      )}）`,
    onHit: (b, _ball, e, lv) => {
      const n = b.rng.int(
        ...v(lv, [
          [3, 6],
          [3, 6],
          [4, 8],
        ] as [number, number][]),
      );
      for (let i = 0; i < n; i++)
        b.addMinion({
          kind: 'firework',
          x: e.cx,
          y: e.cy,
          target: b.randomEnemy(),
          dmg: [20, 30],
          life: 4,
          steal: 0,
          burn: v(lv, [
            [7, 11],
            [10, 14],
            [10, 14],
          ] as Range[]),
        });
    },
  },
  {
    id: 'freezeray',
    zh: '冰冻射线',
    en: 'Freeze Ray',
    evolved: true,
    color: '#a6f2ff',
    hit: [4.2, 8.0],
    recipes: [[['freeze'], ['laserh', 'laserv']]],
    desc: (lv) =>
      `命中时发射冰冻射线，对路径上所有敌人造成 ${r(
        v(lv, [
          [20, 50],
          [25, 65],
          [25, 65],
        ] as Range[]),
      )} 伤害，并有 10% 几率冰冻 ${v(lv, [10, 10, 13])} 秒`,
    onHit: (b, ball, e, lv) => {
      const a = outAngle(ball);
      beamFx(b, e.cx, e.cy, a, '#a6f2ff', 8);
      b.aoe(
        b.enemiesOnRay(e.cx, e.cy, a, TILE * 0.3),
        v(lv, [
          [20, 50],
          [25, 65],
          [25, 65],
        ] as Range[]),
        'aoe',
        (o) => {
          if (b.rng.chance(0.1)) b.applyFreeze(o, v(lv, [10, 10, 13]));
        },
      );
    },
  },
  {
    id: 'frozenflame',
    zh: '冰冻之炎',
    en: 'Frozen Flame',
    evolved: true,
    color: '#86c8ff',
    hit: [3.6, 6.8],
    recipes: [[['burn'], ['freeze']]],
    desc: (lv) =>
      `命中添加 1 层霜火，持续 ${v(lv, [20, 20, 30])} 秒（上限 ${v(lv, [4, 4, 5])} 层）。霜火每层每秒造成 ${r(
        v(lv, [
          [8, 12],
          [10, 16],
          [10, 16],
        ] as Range[]),
      )} 伤害，且敌人受到的其他伤害提高 25%`,
    onHit: (b, _ball, e, lv) =>
      b.applyDot(
        e,
        'frostburn',
        1,
        v(lv, [4, 4, 5]),
        v(lv, [20, 20, 30]),
        v(lv, [
          [8, 12],
          [10, 16],
          [10, 16],
        ] as Range[]),
      ),
  },
  {
    id: 'glacier',
    zh: '冰川',
    en: 'Glacier',
    evolved: true,
    color: '#aee6ff',
    hit: [4.2, 8.0],
    recipes: [[['freeze'], ['earthquake', 'stone']]],
    desc: (lv) =>
      `持续释放冰刺，碰到的敌人受到 ${r(
        v(lv, [
          [15, 30],
          [25, 40],
          [25, 40],
        ] as Range[]),
      )} 伤害并被冰冻 ${v(lv, [2, 2, 3])} 秒。弹珠和冰刺也会对附近敌人造成 6-12 伤害`,
    onTick: (b, ball, lv, dt) => {
      aura(b, ball, dt);
      every(ball, 'spike', 1.2, dt, () =>
        b.addZone({
          kind: 'spike',
          x: ball.x,
          y: ball.y,
          r: TILE * 0.45,
          life: 6,
          interval: 0.2,
          once: new Set(),
          apply: (bb, e) => {
            bb.damage(
              e,
              bb.roll(
                v(lv, [
                  [15, 30],
                  [25, 40],
                  [25, 40],
                ] as Range[]),
              ),
              'aoe',
            );
            bb.applyFreeze(e, v(lv, [2, 2, 3]));
          },
        }),
      );
    },
  },
  {
    id: 'heartswallower',
    zh: '噬心者',
    en: 'Heart Swallower',
    evolved: true,
    color: '#c8325f',
    hit: [3.6, 6.8],
    recipes: [[['bleed'], ['ghost']]],
    desc: (lv) =>
      `命中时汲取敌人：${v(lv, [40, 55, 70])}% 几率偷取 1 点生命，并使其攻击力降低 ${v(lv, [20, 30, 40])}%。每个敌人只判定一次偷取`,
    onHit: (b, _ball, e, lv) => {
      e.attackDown = Math.max(e.attackDown, v(lv, [0.2, 0.3, 0.4]));
      if (!e.sapped) {
        e.sapped = true;
        if (b.rng.chance(v(lv, [0.4, 0.55, 0.7]))) b.heal(1);
      }
    },
  },
  {
    id: 'hemorrhage',
    zh: '血流如注',
    en: 'Hemorrhage',
    evolved: true,
    color: '#ff2242',
    hit: [4.2, 8.0],
    recipes: [[['bleed'], ['iron', 'flesh']]],
    desc: (lv) =>
      `命中施加 ${v(lv, [3, 4, 4])} 层流血。命中流血达到 12 层以上的敌人时，消耗全部流血，造成其当前生命 ${v(lv, [20, 20, 30])}% 的伤害`,
    onHit: (b, _ball, e, lv) => {
      if (e.bleed >= 12) {
        const pct = v(lv, [0.2, 0.2, 0.3]);
        e.bleed = 0;
        b.ring(e.cx, e.cy, TILE * 0.8, '#ff2242', 0.3);
        b.damage(e, Math.max(1, e.hp * pct * (e.isBoss ? 0.25 : 1)), 'status');
      }
      if (!e.dead) b.applyBleed(e, v(lv, [3, 4, 4]), 15);
    },
  },
  {
    id: 'holylaser',
    zh: '神圣激光',
    en: 'Holy Laser',
    evolved: true,
    color: '#fff1a6',
    hit: [3.6, 6.8],
    recipes: [[['laserh'], ['laserv']]],
    desc: (lv) =>
      `对同一行和同一列的所有敌人造成 ${r(
        v(lv, [
          [24, 36],
          [27, 48],
          [30, 60],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.beam(b.left, e.cy, b.right, e.cy, '#fff1a6', 7, 0.2);
      b.beam(e.cx, 0, e.cx, 2000, '#fff1a6', 7, 0.2);
      const set = new Set([...b.enemiesInRow(e.cy), ...b.enemiesInCol(e.cx)]);
      b.aoe(
        [...set],
        v(lv, [
          [24, 36],
          [27, 48],
          [30, 60],
        ] as Range[]),
      );
    },
  },
  {
    id: 'inferno',
    zh: '炼狱',
    en: 'Inferno',
    evolved: true,
    color: '#ff4f1f',
    hit: [4.2, 8.0],
    recipes: [[['burn'], ['wind', 'time']]],
    desc: (lv) =>
      `每秒对 2 格范围内的所有敌人施加 1 层燃烧。燃烧持续 ${v(lv, [6, 10, 10])} 秒，每层每秒造成 ${r(
        v(lv, [
          [3, 7],
          [3, 7],
          [6, 10],
        ] as Range[]),
      )} 伤害`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'inferno', 1, dt, () => {
        b.ring(ball.x, ball.y, TILE * 2, '#ff4f1f55', 0.25);
        for (const e of b.enemiesInRadius(ball.x, ball.y, 2))
          b.applyDot(
            e,
            'burn',
            1,
            5,
            v(lv, [6, 10, 10]),
            v(lv, [
              [3, 7],
              [3, 7],
              [6, 10],
            ] as Range[]),
          );
      }),
  },
  {
    id: 'leech',
    zh: '吸血水蛭',
    en: 'Leech',
    evolved: true,
    color: '#8a2446',
    hit: [3.6, 6.8],
    recipes: [[['broodmother'], ['bleed']]],
    desc: (lv) => `在命中的敌人身上附着 1 只水蛭，每秒施加 ${v(lv, [2, 3, 3])} 层流血（上限 ${v(lv, [24, 36, 48])} 层）`,
    onHit: (_b, _ball, e, lv) => {
      if (!e.leech) e.leech = { rate: v(lv, [2, 3, 3]), max: v(lv, [24, 36, 48]), tick: 1 };
    },
  },
  {
    id: 'lightningbug',
    zh: '闪电虫',
    en: 'Lightning Bug',
    evolved: true,
    spawner: true,
    color: '#d6ff66',
    hit: [3.6, 6.8],
    recipes: [[['lightning'], ['broodmother']]],
    desc: (lv) =>
      `每次命中敌人生成一只闪电虫。闪电虫攻击随机敌人，对附近最多 ${v(lv, [3, 4, 4])} 个敌人造成 ${r(
        v(lv, [
          [1, 80],
          [1, 80],
          [1, 100],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.addMinion({
        kind: 'bug',
        x: e.cx,
        y: e.cy,
        target: b.randomEnemy(),
        dmg: [0, 0],
        life: 5,
        steal: 0,
        chain: {
          n: v(lv, [3, 4, 4]),
          dmg: v(lv, [
            [1, 80],
            [1, 80],
            [1, 100],
          ] as Range[]),
        },
      }),
  },
  {
    id: 'lightningrod',
    zh: '避雷针',
    en: 'Lightning Rod',
    evolved: true,
    color: '#f2e27a',
    hit: [3.6, 6.8],
    recipes: [[['lightning'], ['iron']]],
    desc: (lv) =>
      `在命中的敌人身上插一根避雷针。每 ${v(lv, [3, 3, 2.5])} 秒落雷一次，对附近最多 8 个敌人造成 ${r(
        v(lv, [
          [1, 30],
          [1, 40],
          [1, 40],
        ] as Range[]),
      )} 伤害`,
    onHit: (_b, _ball, e, lv) => {
      if (!e.rod)
        e.rod = {
          interval: v(lv, [3, 3, 2.5]),
          timer: v(lv, [3, 3, 2.5]),
          dmg: v(lv, [
            [1, 30],
            [1, 40],
            [1, 40],
          ] as Range[]),
          targets: 8,
        };
    },
  },
  {
    id: 'magma',
    zh: '熔岩',
    en: 'Magma',
    evolved: true,
    color: '#ff6a00',
    hit: [3.6, 6.8],
    recipes: [[['burn'], ['earthquake']]],
    desc: (lv) =>
      `持续洒下熔岩。走进熔岩的敌人受到 ${r(
        v(lv, [
          [15, 30],
          [15, 30],
          [20, 35],
        ] as Range[]),
      )} 伤害并获得 1 层燃烧（上限 3 层，3 秒，每层每秒 ${r(
        v(lv, [
          [3, 8],
          [5, 10],
          [5, 10],
        ] as Range[]),
      )}）。弹珠和熔岩也会对附近敌人造成 6-12 伤害`,
    onTick: (b, ball, lv, dt) => {
      aura(b, ball, dt);
      every(ball, 'lava', 1, dt, () =>
        b.addZone({
          kind: 'lava',
          x: ball.x,
          y: ball.y,
          r: TILE * 0.5,
          life: 6,
          interval: 0.2,
          once: new Set(),
          apply: (bb, e) => {
            bb.damage(
              e,
              bb.roll(
                v(lv, [
                  [15, 30],
                  [15, 30],
                  [20, 35],
                ] as Range[]),
              ),
              'aoe',
            );
            bb.applyDot(
              e,
              'burn',
              1,
              3,
              3,
              v(lv, [
                [3, 8],
                [5, 10],
                [5, 10],
              ] as Range[]),
            );
          },
        }),
      );
    },
  },
  {
    id: 'mosquitoking',
    zh: '蚊王',
    en: 'Mosquito King',
    evolved: true,
    spawner: true,
    color: '#b82248',
    hit: [3.6, 6.8],
    recipes: [[['vampire'], ['broodmother']]],
    desc: (lv) =>
      `每次命中敌人生成一只蚊子。蚊子攻击随机敌人，造成 ${r(
        v(lv, [
          [80, 120],
          [100, 150],
          [100, 150],
        ] as Range[]),
      )} 伤害；蚊子击杀敌人时偷取 ${v(lv, [1, 1, 2])} 点生命`,
    onHit: (b, _ball, e, lv) =>
      spawnMosquitos(
        b,
        e.cx,
        e.cy,
        1,
        v(lv, [
          [80, 120],
          [100, 150],
          [100, 150],
        ] as Range[]),
        v(lv, [1, 1, 2]),
      ),
  },
  {
    id: 'mosquitoswarm',
    zh: '蚊群',
    en: 'Mosquito Swarm',
    evolved: true,
    spawner: true,
    destroyOnHit: true,
    color: '#d84a6a',
    hit: [3.6, 6.8],
    recipes: [[['vampire'], ['eggsac']]],
    cooldown: () => 3, // est. (inherits Egg Sac's cooldown)
    desc: (lv) =>
      `炸成 ${r(
        v(lv, [
          [3, 6],
          [3, 6],
          [4, 8],
        ] as Range[]),
      )} 只蚊子。蚊子攻击随机敌人，造成 ${r(
        v(lv, [
          [80, 120],
          [100, 150],
          [100, 150],
        ] as Range[]),
      )} 伤害；击杀时偷取 1 点生命`,
    onHit: (b, _ball, e, lv) =>
      spawnMosquitos(
        b,
        e.cx,
        e.cy,
        b.rng.int(
          ...v(lv, [
            [3, 6],
            [3, 6],
            [4, 8],
          ] as [number, number][]),
        ),
        v(lv, [
          [80, 120],
          [100, 150],
          [100, 150],
        ] as Range[]),
        1,
      ),
  },
  {
    id: 'noxious',
    zh: '毒云',
    en: 'Noxious',
    evolved: true,
    passThrough: true,
    color: '#97e27a',
    hit: [4.2, 8.0],
    recipes: [[['wind'], ['poison', 'dark']]],
    desc: (lv) =>
      `穿过敌人，并对 2 格范围内的敌人施加 3 层中毒。中毒持续 ${v(lv, [4, 4, 6])} 秒，每层每秒造成 ${r(
        v(lv, [
          [1, 3],
          [2, 5],
          [2, 5],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.ring(e.cx, e.cy, TILE * 2, '#97e27a66', 0.3);
      for (const o of b.enemiesInRadius(e.cx, e.cy, 2))
        b.applyDot(
          o,
          'poison',
          3,
          8,
          v(lv, [4, 4, 6]),
          v(lv, [
            [1, 3],
            [2, 5],
            [2, 5],
          ] as Range[]),
        );
    },
  },
  {
    id: 'phantom',
    zh: '恶灵',
    en: 'Phantom',
    evolved: true,
    color: '#9a78ff',
    hit: [3.6, 6.8],
    recipes: [[['dark'], ['ghost']]],
    desc: (lv) =>
      `命中时诅咒敌人。被诅咒的敌人再被击中 5 次后受到 ${r(
        v(lv, [
          [100, 200],
          [150, 250],
          [200, 300],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) =>
      b.applyCurse(
        e,
        5,
        v(lv, [
          [100, 200],
          [150, 250],
          [200, 300],
        ] as Range[]),
      ),
  },
  {
    id: 'radiationbeam',
    zh: '辐射光束',
    en: 'Radiation Beam',
    evolved: true,
    color: '#a8ff4a',
    hit: [5.4, 10.4],
    recipes: [
      [
        ['laserh', 'laserv'],
        ['poison', 'cell'],
      ],
    ],
    desc: (lv) =>
      `命中时发射辐射光束，造成 ${r(
        v(lv, [
          [24, 48],
          [30, 60],
          [36, 72],
        ] as Range[]),
      )} 伤害并施加 1 层辐射（上限 5 层）。辐射持续 15 秒，每层使敌人受到的所有伤害提高 10%`,
    onHit: (b, ball, e, lv) => {
      const a = outAngle(ball);
      beamFx(b, e.cx, e.cy, a, '#a8ff4a', 7);
      b.aoe(
        b.enemiesOnRay(e.cx, e.cy, a, TILE * 0.3),
        v(lv, [
          [24, 48],
          [30, 60],
          [36, 72],
        ] as Range[]),
        'aoe',
        (o) => b.applyRadiation(o, 5, 15, 0.1),
      );
    },
  },
  {
    id: 'sacrifice',
    zh: '活祭',
    en: 'Sacrifice',
    evolved: true,
    color: '#a51424',
    hit: [3.6, 6.8],
    recipes: [[['bleed'], ['dark']]],
    desc: (lv) =>
      `命中施加 ${v(lv, [4, 6, 6])} 层流血（上限 ${v(lv, [15, 15, 20])} 层）并诅咒敌人。被诅咒的敌人再被击中 5 次后受到 ${r(
        v(lv, [
          [50, 100],
          [75, 125],
          [75, 125],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      b.applyBleed(e, v(lv, [4, 6, 6]), v(lv, [15, 15, 20]));
      b.applyCurse(
        e,
        5,
        v(lv, [
          [50, 100],
          [75, 125],
          [75, 125],
        ] as Range[]),
      );
    },
  },
  {
    id: 'sandstorm',
    zh: '沙尘暴',
    en: 'Sandstorm',
    evolved: true,
    passThrough: true,
    color: '#dcb575',
    hit: [4.2, 8.0],
    recipes: [[['earthquake', 'stone'], ['wind']]],
    desc: (lv) =>
      `穿过敌人，周身环绕狂暴风沙，每秒造成 ${r(
        v(lv, [
          [10, 20],
          [15, 30],
          [15, 30],
        ] as Range[]),
      )} 伤害，并致盲附近敌人 ${v(lv, [3, 3, 4])} 秒`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'sand', 1, dt, () => {
        b.ring(ball.x, ball.y, TILE * 1.5, '#dcb57566', 0.3);
        for (const e of b.enemiesInRadius(ball.x, ball.y, 1.5)) {
          b.damage(
            e,
            b.roll(
              v(lv, [
                [10, 20],
                [15, 30],
                [15, 30],
              ] as Range[]),
            ),
            'aoe',
          );
          b.applyBlind(e, v(lv, [3, 3, 4]));
        }
      }),
  },
  {
    id: 'shotgun',
    zh: '霰弹枪',
    en: 'Shotgun',
    evolved: true,
    spawner: true,
    color: '#737c86',
    hit: [3.6, 6.8],
    recipes: [[['iron'], ['eggsac']]],
    desc: (lv) =>
      `碰到墙壁后射出 ${r(
        v(lv, [
          [3, 7],
          [4, 8],
          [5, 9],
        ] as Range[]),
      )} 颗黑铁迷你弹珠。它们速度 200%，但碰到任何东西就会碎掉`,
    onWall: (b, ball, lv) => {
      const n = b.rng.int(
        ...v(lv, [
          [3, 7],
          [4, 8],
          [5, 9],
        ] as [number, number][]),
      );
      const a0 = outAngle(ball);
      for (let i = 0; i < n; i++) {
        const s = b.spawnBaby(ball.x, ball.y, a0 + b.rng.range(-0.5, 0.5), undefined, 'iron', 2);
        s.dieOnHit = true;
        s.dieOnWall = true;
        s.age = 0.3;
      }
    },
  },
  {
    id: 'soulsucker',
    zh: '吸魂妖',
    en: 'Soul Sucker',
    evolved: true,
    passThrough: true,
    color: '#7656aa',
    hit: [3.6, 6.8],
    recipes: [[['vampire'], ['ghost']]],
    desc: (lv) =>
      `穿过敌人并汲取它们：${v(lv, [30, 40, 50])}% 几率偷取 1 点生命，并使其攻击力降低 ${v(lv, [20, 30, 40])}%。每个敌人只判定一次偷取`,
    onHit: (b, _ball, e, lv) => {
      e.attackDown = Math.max(e.attackDown, v(lv, [0.2, 0.3, 0.4]));
      if (!e.sapped) {
        e.sapped = true;
        if (b.rng.chance(v(lv, [0.3, 0.4, 0.5]))) b.heal(1);
      }
    },
  },
  {
    id: 'spiderqueen',
    zh: '蜘蛛女王',
    en: 'Spider Queen',
    evolved: true,
    spawner: true,
    color: '#6b4590',
    hit: [3.6, 6.8],
    recipes: [[['broodmother'], ['eggsac']]],
    desc: (lv) => `每次命中敌人有 ${v(lv, [25, 35, 45])}% 几率生出一颗巢囊`,
    onHit: (b, _ball, e, lv) => {
      if (!b.rng.chance(v(lv, [0.25, 0.35, 0.45]))) return;
      const sac = BALLS.eggsac;
      b.spawnBall({
        parts: [{ def: sac, lv: 1 }],
        baby: false,
        x: e.cx,
        y: e.y + e.h + 6,
        angle: b.rng.range(-Math.PI + 0.3, -0.3),
        temp: true,
      });
    },
  },
  {
    id: 'storm',
    zh: '风暴',
    en: 'Storm',
    evolved: true,
    color: '#a8c6ff',
    hit: [3.6, 6.8],
    recipes: [[['lightning'], ['wind']]],
    desc: (lv) =>
      `每秒放出闪电打击附近敌人，造成 ${r(
        v(lv, [
          [1, 40],
          [1, 60],
          [1, 80],
        ] as Range[]),
      )} 伤害`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'storm', 1, dt, () => {
        const targets = b.nearestEnemies(ball.x, ball.y, 3).filter((e) => e.distToPoint(ball.x, ball.y) < TILE * 3);
        for (const e of targets) {
          b.beam(ball.x, ball.y, e.cx, e.cy, '#d8e6ff', 2, 0.15, true);
          b.damage(
            e,
            b.roll(
              v(lv, [
                [1, 40],
                [1, 60],
                [1, 80],
              ] as Range[]),
            ),
            'aoe',
          );
        }
      }),
  },
  {
    id: 'swamp',
    zh: '沼泽',
    en: 'Swamp',
    evolved: true,
    color: '#57774a',
    hit: [3.6, 6.8],
    recipes: [[['poison'], ['earthquake']]],
    desc: (lv) =>
      `持续留下焦油。走进焦油的敌人受到 ${r(
        v(lv, [
          [15, 30],
          [15, 30],
          [25, 40],
        ] as Range[]),
      )} 伤害，减速 50% 持续 7 秒，并获得 1 层中毒（上限 8 层，每层每秒 ${r(
        v(lv, [
          [1, 3],
          [2, 4],
          [2, 4],
        ] as Range[]),
      )}）。弹珠和焦油也会对附近敌人造成 6-12 伤害`,
    onTick: (b, ball, lv, dt) => {
      aura(b, ball, dt);
      every(ball, 'tar', 1, dt, () =>
        b.addZone({
          kind: 'tar',
          x: ball.x,
          y: ball.y,
          r: TILE * 0.5,
          life: 6,
          interval: 0.2,
          once: new Set(),
          apply: (bb, e) => {
            bb.damage(
              e,
              bb.roll(
                v(lv, [
                  [15, 30],
                  [15, 30],
                  [25, 40],
                ] as Range[]),
              ),
              'aoe',
            );
            bb.applySlow(e, 0.5, 7);
            bb.applyDot(
              e,
              'poison',
              1,
              8,
              6,
              v(lv, [
                [1, 3],
                [2, 4],
                [2, 4],
              ] as Range[]),
            );
          },
        }),
      );
    },
  },
  {
    id: 'vampirelord',
    zh: '吸血鬼领主',
    en: 'Vampire Lord',
    evolved: true,
    color: '#8a0a28',
    hit: [4.2, 8.0],
    recipes: [[['vampire'], ['bleed', 'dark']]],
    desc: (lv) => `每次命中施加 3 层流血。命中流血达到 ${v(lv, [10, 10, 9])} 层的敌人时，回复 1 点生命并消耗全部流血`,
    onHit: (b, _ball, e, lv) => {
      if (e.bleed >= v(lv, [10, 10, 9])) {
        e.bleed = 0;
        b.heal(1);
      } else b.applyBleed(e, 3, 15);
    },
  },
  {
    id: 'venom',
    zh: '剧毒',
    en: 'Venom',
    evolved: true,
    color: '#33d688',
    hit: [3.6, 6.8],
    recipes: [[['poison'], ['freeze']]],
    desc: (lv) =>
      `命中施加 1 层毒液（上限 ${v(lv, [8, 8, 12])} 层）。每层每秒造成 ${r(
        v(lv, [
          [3, 6],
          [4, 7],
          [4, 7],
        ] as Range[]),
      )} 伤害并使敌人减速`,
    onHit: (b, _ball, e, lv) =>
      b.applyDot(
        e,
        'venom',
        1,
        v(lv, [8, 8, 12]),
        6,
        v(lv, [
          [3, 6],
          [4, 7],
          [4, 7],
        ] as Range[]),
      ),
  },
  {
    id: 'virus',
    zh: '病毒',
    en: 'Virus',
    evolved: true,
    color: '#c6e64a',
    hit: [4.2, 8.0],
    recipes: [[['poison'], ['ghost', 'cell']]],
    desc: (lv) =>
      `命中施加 1 层疾病（上限 8 层），持续 6 秒。每层每秒造成 ${r(
        v(lv, [
          [3, 6],
          [5, 9],
          [5, 9],
        ] as Range[]),
      )} 伤害，患病的敌人每秒有 ${v(lv, [15, 15, 25])}% 几率传染给附近未患病的敌人`,
    onHit: (b, _ball, e, lv) => {
      b.applyDot(
        e,
        'disease',
        1,
        8,
        6,
        v(lv, [
          [3, 6],
          [5, 9],
          [5, 9],
        ] as Range[]),
      );
      e.disease.spread = v(lv, [0.15, 0.15, 0.25]);
    },
  },
  {
    id: 'wraith',
    zh: '怨灵',
    en: 'Wraith',
    evolved: true,
    passThrough: true,
    color: '#b8f2ff',
    hit: [3.6, 6.8],
    recipes: [[['freeze'], ['ghost']]],
    desc: (lv) => `冰冻穿过的每个敌人 ${v(lv, [0.8, 1.3, 1.8])} 秒`,
    onHit: (b, _ball, e, lv) => b.applyFreeze(e, v(lv, [0.8, 1.3, 1.8])),
  },
  {
    id: 'steel',
    zh: '钢铁',
    en: 'Steel',
    evolved: true,
    color: '#b0b8c4',
    hit: [3.6, 6.8],
    recipes: [[['iron'], ['stone']]],
    speedMul: () => 0.5,
    desc: (lv) => `初始造成双倍伤害，但移动速度慢 50%。每次命中敌人伤害提高 ${v(lv, [10, 15, 15])}%（上限 ${v(lv, [300, 300, 400])}%）`,
    onLaunch: (_b, ball) => {
      ball.timers.steel = 2;
    },
    ballMul: (_b, ball) => ball.timers.steel ?? 2,
    onHit: (_b, ball, _e, lv) => {
      ball.timers.steel = Math.min(v(lv, [3, 3, 4]), (ball.timers.steel ?? 2) + v(lv, [0.1, 0.15, 0.15]));
    },
  },
  {
    id: 'landslide',
    zh: '地裂',
    en: 'Landslide',
    evolved: true,
    destroyOnHit: true,
    color: '#8a6a44',
    hit: [3.6, 6.8],
    recipes: [[['stone'], ['earthquake']]],
    cooldown: () => 3, // est.
    desc: (lv) =>
      `命中敌人时引发山崩并自毁。山崩持续 5 秒，每秒对 2 格范围内的敌人造成 ${r(
        v(lv, [
          [20, 30],
          [25, 35],
          [30, 40],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      const dmg = v(lv, [
        [20, 30],
        [25, 35],
        [30, 40],
      ] as Range[]);
      b.shake = Math.min(10, b.shake + 3);
      b.addZone({
        kind: 'landslide',
        x: e.cx,
        y: e.cy,
        r: TILE * 2,
        life: 5,
        interval: 0.5,
        once: null,
        apply: (bb, o) => bb.damage(o, bb.roll(dmg) / 2, 'aoe'),
      });
    },
  },
  {
    id: 'catapult',
    zh: '投石车',
    en: 'Catapult',
    evolved: true,
    spawner: true,
    color: '#9c8466',
    hit: [3.6, 6.8],
    recipes: [[['stone'], ['eggsac']]],
    desc: (lv) =>
      `每 1.5 秒射出 ${r(
        v(lv, [
          [3, 5],
          [3, 6],
          [4, 6],
        ] as Range[]),
      )} 颗石头迷你弹珠，它们碰到任何东西就会碎掉`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'catapult', 1.5, dt, () => {
        const n = b.rng.int(
          ...v(lv, [
            [3, 5],
            [3, 6],
            [4, 6],
          ] as [number, number][]),
        );
        for (let i = 0; i < n; i++) {
          const s = b.spawnBaby(ball.x, ball.y, b.rng.range(-Math.PI + 0.3, -0.3), undefined, 'stone', 1.2);
          s.dieOnHit = true;
          s.dieOnWall = true;
          s.power = 2;
        }
      }),
  },
  {
    id: 'lasercutter',
    zh: '激光切割器',
    en: 'Laser Cutter',
    evolved: true,
    color: '#ff7a5a',
    hit: [5.4, 10.4],
    recipes: [[['laserh', 'laserv'], ['steel']]],
    desc: (lv) =>
      `持续向前方发射激光，每秒造成 ${r(
        v(lv, [
          [100, 150],
          [120, 180],
          [140, 210],
        ] as Range[]),
      )} 伤害`,
    onTick: (b, ball, lv, dt) =>
      every(ball, 'cutter', 0.25, dt, () => {
        const a = outAngle(ball);
        const len = TILE * 2.5;
        b.beam(ball.x, ball.y, ball.x + Math.cos(a) * len, ball.y + Math.sin(a) * len, '#ff7a5a', 4, 0.26);
        const dmg = v(lv, [
          [100, 150],
          [120, 180],
          [140, 210],
        ] as Range[]);
        for (const e of b.enemiesOnRay(ball.x, ball.y, a, TILE * 0.25)) {
          if (Math.hypot(e.cx - ball.x, e.cy - ball.y) > len + e.w / 2) continue;
          b.damage(e, b.roll(dmg) / 4, 'aoe');
        }
      }),
  },
  // --- evolved + base / evolved + evolved
  {
    id: 'nuclearbomb',
    zh: '核弹',
    en: 'Nuclear Bomb',
    evolved: true,
    destroyOnHit: true,
    color: '#5cff5c',
    hit: [4.2, 8.0],
    recipes: [[['bomb'], ['poison']]],
    cooldown: () => 3,
    desc: (lv) =>
      `命中敌人时爆炸，对附近敌人造成 ${r(
        v(lv, [
          [300, 500],
          [400, 700],
          [400, 700],
        ] as Range[]),
      )} 伤害，并给场上所有敌人施加 1 层永久辐射（上限 5 层，每层受到伤害 +${v(lv, [10, 10, 15])}%）。冷却 3 秒`,
    onHit: (b, _ball, e, lv) => {
      b.explode(
        e.cx,
        e.cy,
        2,
        v(lv, [
          [300, 500],
          [400, 700],
          [400, 700],
        ] as Range[]),
        '#5cff5c',
      );
      for (const o of b.visibleEnemies()) b.applyRadiation(o, 5, Infinity, v(lv, [0.1, 0.1, 0.15]));
    },
  },
  {
    id: 'sniper',
    zh: '狙击手',
    en: 'Sniper',
    evolved: true,
    spawner: true,
    passThrough: true,
    color: '#425466',
    hit: [4.8, 9.2],
    recipes: [[['shotgun'], ['assassin']]],
    desc: (lv) =>
      `穿透敌人，碰到墙壁后射出 ${r(
        v(lv, [
          [3, 7],
          [4, 8],
          [5, 9],
        ] as Range[]),
      )} 颗狙击迷你弹珠。它们能穿透敌人，但碰到墙壁就会碎掉`,
    onWall: (b, ball, lv) => {
      const n = b.rng.int(
        ...v(lv, [
          [3, 7],
          [4, 8],
          [5, 9],
        ] as [number, number][]),
      );
      const a0 = outAngle(ball);
      for (let i = 0; i < n; i++) {
        const s = b.spawnBaby(ball.x, ball.y, a0 + b.rng.range(-0.45, 0.45), undefined, 'sniper', 1.6);
        s.pierce = true;
        s.dieOnWall = true;
        s.age = 0.3;
      }
    },
  },
  {
    id: 'mosquitokingdom',
    zh: '蚊之国',
    en: 'Mosquito Kingdom',
    evolved: true,
    spawner: true,
    color: '#e0305a',
    hit: [4.8, 9.2],
    recipes: [[['mosquitoking'], ['mosquitoswarm']]],
    desc: (lv) =>
      `每次命中敌人生成 ${r(
        v(lv, [
          [1, 2],
          [1, 3],
          [2, 3],
        ] as Range[]),
      )} 只蚊子。蚊子攻击随机敌人，造成 100-150 伤害；击杀时偷取 2 点生命`,
    onHit: (b, _ball, e, lv) =>
      spawnMosquitos(
        b,
        e.cx,
        e.cy,
        b.rng.int(
          ...v(lv, [
            [1, 2],
            [1, 3],
            [2, 3],
          ] as [number, number][]),
        ),
        [100, 150],
        2,
      ),
  },
  {
    id: 'reaper',
    zh: '死神',
    en: 'Reaper',
    evolved: true,
    color: '#262626',
    hit: [3.6, 6.8],
    recipes: [[['soulsucker'], ['heartswallower']]],
    desc: (lv) => `撞击时有 ${v(lv, [10, 15, 15])}% 几率直接杀死敌人（首领除外），并为你回复 ${v(lv, [5, 5, 7])} 点生命`,
    onHit: (b, _ball, e, lv) => {
      if (e.dead || e.isBoss || !b.rng.chance(v(lv, [0.1, 0.15, 0.15]))) return;
      b.execute(e, '收割');
      b.heal(v(lv, [5, 5, 7]));
    },
  },
  {
    id: 'banshee',
    zh: '尖啸女妖',
    en: 'Banshee',
    evolved: true,
    color: '#dccaff',
    hit: [4.8, 9.2],
    recipes: [[['phantom'], ['wraith']]],
    desc: (lv) =>
      `发射时诅咒场上所有敌人。被诅咒的敌人再被击中 6 次后受到 ${r(
        v(lv, [
          [150, 300],
          [200, 350],
          [250, 400],
        ] as Range[]),
      )} 伤害`,
    onLaunch: (b, _ball, lv) => {
      for (const e of b.visibleEnemies())
        b.applyCurse(
          e,
          6,
          v(lv, [
            [150, 300],
            [200, 350],
            [250, 400],
          ] as Range[]),
        );
    },
    onHit: (b, _ball, e, lv) =>
      b.applyCurse(
        e,
        6,
        v(lv, [
          [150, 300],
          [200, 350],
          [250, 400],
        ] as Range[]),
      ),
  },
  {
    id: 'armageddon',
    zh: '天劫',
    en: 'Armageddon',
    evolved: true,
    destroyOnHit: true,
    color: '#ff3a12',
    hit: [4.8, 9.2],
    recipes: [[['inferno'], ['storm']]],
    cooldown: () => 4, // est.
    desc: (lv) =>
      `命中敌人时召来流星雨，持续 5 秒，每秒对 3 格范围内的敌人造成 ${r(
        v(lv, [
          [30, 50],
          [40, 60],
          [50, 70],
        ] as Range[]),
      )} 伤害`,
    onHit: (b, _ball, e, lv) => {
      const dmg = v(lv, [
        [30, 50],
        [40, 60],
        [50, 70],
      ] as Range[]);
      b.addZone({
        kind: 'meteor',
        x: e.cx,
        y: e.cy,
        r: TILE * 3,
        life: 5,
        interval: 0.5,
        once: null,
        apply: (bb, o) => bb.damage(o, bb.roll(dmg) / 2, 'aoe'),
      });
    },
  },
];

export const BALLS: Record<string, BallDef> = Object.fromEntries([...base, ...evolved].map((d) => [d.id, d]));

/** Ball ids that can be offered on level-up (unlocked base balls). */
export const basePool = (unlocks: Set<string>) =>
  base
    .filter(
      (d) =>
        d.pool === 'default' ||
        (d.pool === 'boneyard-clear' && unlocks.has('boneyard')) ||
        (d.pool === 'snowy-clear' && unlocks.has('snowy')),
    )
    .map((d) => d.id);

export const EVOLVED_BALLS = evolved;
