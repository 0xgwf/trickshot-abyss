// SPDX-License-Identifier: CC-BY-SA-4.0
// Game data adapted from the BALL x PIT Wiki (ballxpit.wiki.gg, CC BY-SA 4.0) and the sources listed
// in ATTRIBUTION.md; translated, condensed and partly estimated (see docs/NOTES.md).
import type { Battle } from '../battle.ts';
import { TILE, WORLD_H } from '../config.ts';
import type { PassiveDef, Range } from '../types.ts';
import { BALLS } from './balls.ts';

// Level-1 numbers are the wiki's. Most passives have no published L2/L3 values; those are
// scaled by roughly +50% per level and marked "est." in their descriptions.

const v = <T>(lv: number, arr: readonly T[]): T => arr[Math.min(arr.length, lv) - 1];
const ownsAny = (b: Battle, ids: string[]) => b.owned.some((o) => o.parts.some((p) => ids.includes(p.def.id)));

const FREEZERS = ['freeze', 'blizzard', 'freezeray', 'glacier', 'wraith', 'elemental'];
const BURNERS = ['burn', 'inferno', 'magma', 'brimstone', 'fireworks', 'elemental'];
const CURSERS = ['phantom', 'sacrifice', 'banshee'];
const POISONERS = ['poison', 'venom', 'virus', 'noxious', 'swamp', 'brimstone'];
const ALLY_PASSIVES = ['stoneeffigy', 'cursedelixir', 'goldenbull', 'healereffigy', 'archereffigy'];
const hasAllies = (b: Battle) => ALLY_PASSIVES.some((id) => b.hasPassive(id));

/** Counts rows down for "every N rows" passives; returns true when it fires. */
const everyRows = (b: Battle, id: string, lo: number, hi: number) => {
  b.rowTimers[id] = (b.rowTimers[id] ?? b.rng.int(lo, hi)) - 1;
  if (b.rowTimers[id] > 0) return false;
  b.rowTimers[id] = b.rng.int(lo, hi);
  return true;
};

const allyColumn = (b: Battle) => {
  const cols = Math.round((b.right - b.left) / TILE);
  return b.left + (b.rng.int(0, cols - 1) + 0.5) * TILE;
};

const shootBaby = (b: Battle, angle?: number) => {
  const p = b.player;
  return b.spawnBaby(p.x, p.y - p.r, angle ?? b.rng.range(-Math.PI + 0.35, -0.35));
};

const base: PassiveDef[] = [
  {
    id: 'rattle',
    zh: '拨浪鼓',
    en: 'Baby Rattle',
    evolved: false,
    desc: (lv) => `迷你弹珠数量 ×${v(lv, [1.5, 1.75, 2])}，但瞄准会变得散乱`,
    stats: (s, lv) => {
      s.babyCountMul *= v(lv, [1.5, 1.75, 2]);
      s.scatterAim += 0.2;
    },
  },
  {
    id: 'bandage',
    zh: '绷带卷',
    en: 'Bandage Roll',
    evolved: false,
    desc: (lv) => `每次回复生命时射出 ${v(lv, ['1-2', '1-3', '2-3'])} 颗迷你弹珠`,
    onHeal: (b, lv) => {
      const n = b.rng.int(
        ...v(lv, [
          [1, 2],
          [1, 3],
          [2, 3],
        ] as [number, number][]),
      );
      for (let i = 0; i < n; i++) shootBaby(b);
    },
  },
  {
    id: 'tornado',
    zh: '瓶中龙卷风',
    en: 'Bottled Tornado',
    evolved: false,
    desc: (lv) => `接住特殊弹珠时，自动向随机方向射出 ${v(lv, ['1-3', '2-3', '2-4'])} 颗新的迷你弹珠`,
    onCatch: (b, ball, lv) => {
      if (ball.baby) return;
      const n = b.rng.int(
        ...v(lv, [
          [1, 3],
          [2, 3],
          [2, 4],
        ] as [number, number][]),
      );
      for (let i = 0; i < n; i++) shootBaby(b);
    },
  },
  {
    id: 'breastplate',
    zh: '胸甲',
    en: 'Breastplate',
    evolved: false,
    desc: (lv) => `受到的伤害降低 ${v(lv, [10, 20, 30])}%`,
    stats: (s, lv) => {
      s.damageTaken *= 1 - v(lv, [0.1, 0.2, 0.3]);
    },
  },
  {
    id: 'thorns',
    zh: '荆棘之冠',
    en: 'Crown of Thorns',
    evolved: false,
    desc: (lv) => `被近身攻击命中时，消灭最近的 ${v(lv, [2, 3, 4])} 个敌人`,
    onPlayerHit: (b, lv, ranged, dmg) => {
      if (ranged) return dmg;
      const p = b.player;
      const bosses = new Set(b.enemies.filter((e) => e.isBoss));
      for (const e of b.nearestEnemies(p.x, p.y, v(lv, [2, 3, 4]), bosses)) {
        b.beam(p.x, p.y, e.cx, e.cy, '#7cff7c', 3, 0.2);
        b.execute(e);
      }
      return dmg;
    },
  },
  {
    id: 'diamond',
    zh: '钻石匕首',
    en: 'Diamond Hilted Dagger',
    evolved: false,
    desc: (lv) => `命中敌人正面时，暴击率提高到 ${v(lv, [20, 30, 40])}%`,
    critChance: (b, _ball, _e, lv) => (b.lastHitSide === 'front' ? v(lv, [0.2, 0.3, 0.4]) : 0),
  },
  {
    id: 'emerald',
    zh: '绿宝石匕首',
    en: 'Emerald Hilted Dagger',
    evolved: false,
    desc: (lv) => `命中敌人右侧时，暴击率提高到 ${v(lv, [20, 30, 40])}%`,
    critChance: (b, _ball, _e, lv) => (b.lastHitSide === 'right' ? v(lv, [0.2, 0.3, 0.4]) : 0),
  },
  {
    id: 'ruby',
    zh: '红宝石匕首',
    en: 'Ruby Hilted Dagger',
    evolved: false,
    desc: (lv) => `命中敌人背面时，暴击率提高到 ${v(lv, [15, 25, 35])}%`,
    critChance: (b, _ball, _e, lv) => (b.lastHitSide === 'back' ? v(lv, [0.15, 0.25, 0.35]) : 0),
  },
  {
    id: 'sapphire',
    zh: '蓝宝石匕首',
    en: 'Sapphire Hilted Dagger',
    evolved: false,
    desc: (lv) => `命中敌人左侧时，暴击率提高到 ${v(lv, [30, 40, 50])}%`,
    critChance: (b, _ball, _e, lv) => (b.lastHitSide === 'left' ? v(lv, [0.3, 0.4, 0.5]) : 0),
  },
  {
    id: 'cloak',
    zh: '幻影斗篷',
    en: 'Ethereal Cloak',
    evolved: false,
    desc: (lv) => `弹珠在碰到坑道顶端之前会穿过敌人，并额外造成 ${v(lv, [25, 35, 50])}% 伤害`,
    onLaunch: (_b, ball) => {
      ball.pierceUntilBack = true;
      ball.timers.cloak = 1;
    },
    hitMul: (_b, ball, _e, lv) => (ball.hitBack || !ball.timers.cloak ? 1 : 1 + v(lv, [0.25, 0.35, 0.5])),
  },
  {
    id: 'everflowing',
    zh: '不竭圣杯',
    en: 'Everflowing Goblet',
    evolved: false,
    desc: (lv) => `可以以 ${v(lv, [20, 30, 40])}% 的效率超过生命上限回复生命`,
  },
  {
    id: 'beholder',
    zh: '魔眼',
    en: 'Eye of the Beholder',
    evolved: false,
    desc: (lv) => `${v(lv, [10, 15, 20])}% 几率闪避攻击`,
    stats: (s, lv) => {
      s.dodge = Math.max(s.dodge, v(lv, [0.1, 0.15, 0.2]));
    },
  },
  {
    id: 'fleetfeet',
    zh: '迅捷之靴',
    en: 'Fleet Feet',
    evolved: false,
    desc: (lv) => `移动速度提高 ${v(lv, [10, 15, 20])}%，射击时也能全速移动`,
    stats: (s, lv) => {
      s.moveSpeed *= 1 + v(lv, [0.1, 0.15, 0.2]);
      s.moveFullWhileShooting = true;
    },
  },
  {
    id: 'frozenspike',
    zh: '冰刺',
    en: 'Frozen Spike',
    evolved: false,
    desc: (lv) => `敌人被冰冻时，向附近敌人散发寒气，造成 ${v(lv, ['10-20', '15-30', '20-40'])} 伤害（需要冰冻类弹珠）`,
    requires: (b) => ownsAny(b, FREEZERS),
  },
  {
    id: 'hourglass',
    zh: '沙漏',
    en: 'Hourglass',
    evolved: false,
    desc: (lv) => `弹珠造成 ${v(lv, [150, 175, 200])}% 伤害，但每次反弹降低 30%（最低 50%）`,
    onLaunch: (_b, ball, lv) => {
      ball.dmgMul *= v(lv, [1.5, 1.75, 2]);
      ball.timers.hourglass = 1;
    },
    onBounce: (_b, ball) => {
      if (ball.timers.hourglass) ball.dmgMul = Math.max(0.5, ball.dmgMul - 0.3);
    },
  },
  {
    id: 'onesie',
    zh: '黑色连体服',
    en: 'Iron Onesie',
    evolved: false,
    desc: (lv) => `场上每有一颗迷你弹珠，弹珠伤害提高 ${v(lv, [0.5, 0.75, 1])}%`,
    hitMul: (b, _ball, _e, lv) => 1 + v(lv, [0.005, 0.0075, 0.01]) * b.balls.filter((x) => x.baby && !x.dead).length,
  },
  {
    id: 'staff',
    zh: '魔法杖',
    en: 'Magic Staff',
    evolved: false,
    desc: (lv) => `范围伤害（地震、激光、闪电等）提高 ${v(lv, [20, 30, 40])}%`,
    stats: (s, lv) => {
      s.aoePower *= 1 + v(lv, [0.2, 0.3, 0.4]);
    },
  },
  {
    id: 'magnet',
    zh: '磁铁',
    en: 'Magnet',
    evolved: false,
    desc: (lv) => `拾取道具和接球的范围增加 ${v(lv, [1, 1.5, 2])} 格`,
    stats: (s, lv) => {
      s.pickupRadius += v(lv, [1, 1.5, 2]);
      s.catchRadius += v(lv, [1, 1.5, 2]);
    },
  },
  {
    id: 'midnightoil',
    zh: '午夜灯油',
    en: 'Midnight Oil',
    evolved: false,
    desc: (lv) => `命中燃烧中的敌人的弹珠会着火，下一次命中额外造成 ${v(lv, ['10-20', '15-30', '20-40'])} 火焰伤害（需要燃烧类弹珠）`,
    requires: (b) => ownsAny(b, BURNERS),
    onHit: (b, ball, e, lv) => {
      if (e.burn.stacks > 0)
        ball.nextHitBonus = b.roll(
          v(lv, [
            [10, 20],
            [15, 30],
            [20, 40],
          ] as Range[]),
        );
    },
  },
  {
    id: 'dumbbell',
    zh: '铂金哑铃',
    en: 'Platinum Dumbbell',
    evolved: false,
    desc: (lv) => `弹珠在碰到坑道顶端之前额外造成 ${v(lv, [12, 18, 24])}% 伤害`,
    hitMul: (_b, ball, _e, lv) => (ball.hitBack ? 1 : 1 + v(lv, [0.12, 0.18, 0.24])),
  },
  {
    id: 'feather',
    zh: '辉光之羽',
    en: 'Radiant Feather',
    evolved: false,
    desc: (lv) => `弹珠发射速度提高 ${v(lv, [20, 30, 40])}%，但每次射击都会被轻微击退`,
    stats: (s, lv) => {
      s.ballSpeedMul *= 1 + v(lv, [0.2, 0.3, 0.4]);
    },
  },
  {
    id: 'spear',
    zh: '突刺之矛',
    en: "Reacher's Spear",
    evolved: false,
    desc: (lv) => `命中与你同一列的敌人时，暴击率提高到 ${v(lv, [20, 30, 40])}%`,
    critChance: (b, _ball, e, lv) => (Math.abs(e.cx - b.player.x) < e.w / 2 + TILE * 0.2 ? v(lv, [0.2, 0.3, 0.4]) : 0),
  },
  {
    id: 'rubber',
    zh: '弹力头带',
    en: 'Rubber Headband',
    evolved: false,
    desc: (lv) => `弹珠初始速度为 70%，但每次反弹提速 ${v(lv, [20, 25, 30])}%（上限 200%）`,
    onBounce: (_b, ball, lv) => {
      ball.timers.base ??= ball.speed / 0.7;
      ball.speed = Math.min(ball.timers.base * 2, ball.speed * (1 + v(lv, [0.2, 0.25, 0.3])));
      ball.normalize();
    },
  },
  {
    id: 'shortbow',
    zh: '短弓',
    en: 'Shortbow',
    evolved: false,
    desc: (lv) => `射速提高 ${v(lv, [15, 20, 25])}%`,
    stats: (s, lv) => {
      s.fireInterval /= 1 + v(lv, [0.15, 0.2, 0.25]);
    },
  },
  {
    id: 'silverbullet',
    zh: '白银子弹',
    en: 'Silver Bullet',
    evolved: false,
    desc: (lv) => `弹珠在碰到墙壁之前额外造成 ${v(lv, [20, 30, 40])}% 伤害`,
    hitMul: (_b, ball, _e, lv) => (ball.hitWall ? 1 : 1 + v(lv, [0.2, 0.3, 0.4])),
  },
  {
    id: 'slingshot',
    zh: '弹弓',
    en: 'Slingshot',
    evolved: false,
    desc: (lv) => `拾取经验宝石时有 ${v(lv, [25, 35, 45])}% 几率射出一颗迷你弹珠`,
    onGem: (b, lv) => {
      if (b.rng.chance(v(lv, [0.25, 0.35, 0.45]))) shootBaby(b, b.player.aim);
    },
  },
  {
    id: 'swordbreaker',
    zh: '断剑者',
    en: 'Sword Breaker',
    evolved: false,
    desc: (lv) => `弹珠伤害降低 ${v(lv, [40, 30, 20])}%，但场上每有一个敌人，伤害提高 1%`,
    hitMul: (b, _ball, _e, lv) => (1 - v(lv, [0.4, 0.3, 0.2])) * (1 + 0.01 * b.visibleEnemies().length),
  },
  {
    id: 'turret',
    zh: '炮塔',
    en: 'Turret',
    evolved: false,
    desc: (lv) => `在你身边漂浮，每 ${v(lv, [2, 1.7, 1.4])} 秒向敌人射出一颗迷你弹珠`,
    onTick: (b, lv, dt) => {
      b.turretT = (b.turretT ?? 1) - dt;
      if (b.turretT > 0) return;
      b.turretT = v(lv, [2, 1.7, 1.4]);
      const p = b.player;
      const tx = p.x + Math.cos(b.t * 2) * TILE * 0.8;
      const ty = p.y - TILE * 0.6;
      const target = b.nearestEnemies(tx, ty, 1)[0];
      const a = target ? Math.atan2(target.cy - ty, target.cx - tx) : -Math.PI / 2;
      b.spawnBaby(tx, ty, Math.min(-0.2, Math.max(-Math.PI + 0.2, a)));
    },
  },
  {
    id: 'hatchet',
    zh: '逆转手斧',
    en: 'Upturned Hatchet',
    evolved: false,
    desc: (lv) => `弹珠碰到坑道顶端后伤害提高 ${v(lv, [80, 100, 120])}%，否则伤害降低 20%`,
    hitMul: (_b, ball, _e, lv) => (ball.hitBack ? 1 + v(lv, [0.8, 1, 1.2]) : 0.8),
  },
  {
    id: 'stoneeffigy',
    zh: '石像',
    en: 'Stone Effigy',
    evolved: false,
    desc: (lv) =>
      `每 7-12 行，在你这一侧生成一名 ${v(lv, [200, 250, 300])} 生命的石像士兵。石像士兵不会被弹珠伤害，会向上推进，阻挡并攻击路上的敌人`,
    onRow: (b, lv) => {
      if (everyRows(b, 'stoneeffigy', 7, 12)) b.addAlly('soldier', allyColumn(b), WORLD_H - TILE * 1.2, v(lv, [200, 250, 300]));
    },
  },
  {
    id: 'artificialheart',
    zh: '人造心脏',
    en: 'Artificial Heart',
    evolved: false,
    desc: (lv) => `友方单位的生命提高 ${v(lv, [100, 150, 200])}%（需要能召唤友军的被动）`,
    requires: hasAllies,
  },
  {
    id: 'warhorn',
    zh: '战争号角',
    en: 'War Horn',
    evolved: false,
    desc: (lv) => `所有迷你弹珠伤害提高 ${v(lv, [20, 30, 40])}%`,
    stats: (s, lv) => {
      s.babyDamageMul *= 1 + v(lv, [0.2, 0.3, 0.4]);
    },
  },
  // --- unlocked by clearing the BONExYARD
  {
    id: 'pressurevalve',
    zh: '压力阀',
    en: 'Pressure Valve',
    evolved: false,
    desc: (lv) => `敌人死亡时爆炸，对相邻敌人造成 ${v(lv, ['20-30', '30-45', '40-60'])} 伤害`,
    onKill: (b, e, lv) => {
      b.ring(e.cx, e.cy, TILE * 0.9, '#ffb347', 0.2);
      for (const o of b.enemiesInRadius(e.cx, e.cy, 0.6))
        b.damage(
          o,
          b.roll(
            v(lv, [
              [20, 30],
              [30, 45],
              [40, 60],
            ] as Range[]),
          ),
          'passive',
        );
    },
  },
  {
    id: 'cursedelixir',
    zh: '诅咒灵药',
    en: 'Cursed Elixir',
    evolved: false,
    desc: (lv) => `中毒的敌人死亡时，有 ${v(lv, [10, 15, 20])}% 几率化为 240 生命的丧尸，向上推进并与敌人战斗（需要中毒类弹珠）`,
    requires: (b) => ownsAny(b, POISONERS),
    onKill: (b, e, lv) => {
      if (e.poison.stacks <= 0 && e.venom.stacks <= 0 && e.disease.stacks <= 0) return;
      if (e.isBoss || !b.rng.chance(v(lv, [0.1, 0.15, 0.2]))) return;
      b.addAlly('zombie', e.cx, e.y, 240);
    },
  },
  // --- unlocked by clearing the SNOWYxSHORES
  {
    id: 'goldenbull',
    zh: '金牛',
    en: 'Golden Bull',
    evolved: false,
    desc: (lv) =>
      `每 7-11 行，在你这一侧生成一头 ${v(lv, [400, 500, 600])} 生命的金牛。金牛每分钟积攒 10 金币，并向上推进，阻挡并攻击路上的敌人`,
    onRow: (b, lv) => {
      if (everyRows(b, 'goldenbull', 7, 11)) b.addAlly('bull', allyColumn(b), WORLD_H - TILE * 1.2, v(lv, [400, 500, 600]));
    },
  },
  {
    id: 'healereffigy',
    zh: '治疗石像',
    en: "Healer's Effigy",
    evolved: false,
    desc: (lv) =>
      `每 7-12 行，在你这一侧生成一名 ${v(lv, [100, 130, 160])} 生命的石像医者，在场时每分钟为你回复 10 点生命。它不会被弹珠伤害，会向上推进并阻挡敌人`,
    onRow: (b, lv) => {
      if (everyRows(b, 'healereffigy', 7, 12)) b.addAlly('healer', allyColumn(b), WORLD_H - TILE * 1.2, v(lv, [100, 130, 160]));
    },
  },
  {
    id: 'archereffigy',
    zh: '弓手石像',
    en: "Archer's Effigy",
    evolved: false,
    desc: (lv) =>
      `每 7-12 行，在你这一侧生成一名 ${v(lv, [160, 200, 240])} 生命的石像弓手。它不会被弹珠伤害，会向敌人射箭，每箭造成 10-20 伤害`,
    onRow: (b, lv) => {
      if (everyRows(b, 'archereffigy', 7, 12)) b.addAlly('archer', allyColumn(b), WORLD_H - TILE * 1.2, v(lv, [160, 200, 240]));
    },
  },
  {
    id: 'voodoo',
    zh: '巫毒娃娃',
    en: 'Voodoo Doll',
    evolved: false,
    desc: (lv) => `诅咒有 ${v(lv, [10, 15, 20])}% 几率直接杀死敌人（需要诅咒类弹珠）`,
    requires: (b) => ownsAny(b, CURSERS),
  },
];

const evolved: PassiveDef[] = [
  {
    id: 'stopwatch',
    zh: '白银怀表',
    en: 'Argent Stopwatch',
    evolved: true,
    recipes: [[['hourglass'], ['silverbullet']]],
    desc: (lv) => `弹珠造成 ${v(lv, [200, 250, 250])}% 伤害，但每次反弹降低 ${v(lv, [20, 20, 15])}%（最低 100%）`,
    onLaunch: (_b, ball, lv) => {
      ball.dmgMul *= v(lv, [2, 2.5, 2.5]);
      ball.timers.stopwatch = 1;
    },
    onBounce: (_b, ball, lv) => {
      if (ball.timers.stopwatch) ball.dmgMul = Math.max(1, ball.dmgMul - v(lv, [0.2, 0.2, 0.15]));
    },
  },
  {
    id: 'cornucopia',
    zh: '丰饶之角',
    en: 'Cornucopia',
    evolved: true,
    recipes: [[['rattle'], ['warhorn']]],
    desc: (lv) => `每次产生迷你弹珠时，额外产生 ${v(lv, ['0-1', '0-2', '1-2'])} 颗`,
  },
  {
    id: 'deadeyecross',
    zh: '靶眼十字架',
    en: "Deadeye's Cross",
    evolved: true,
    recipes: [[['diamond'], ['sapphire'], ['ruby'], ['emerald']]],
    desc: (lv) => `暴击率提高到 ${v(lv, [60, 80, 100])}%`,
    critChance: (_b, _ball, _e, lv) => v(lv, [0.6, 0.8, 1]),
  },
  {
    id: 'rapier',
    zh: '全金属刺剑',
    en: 'Full Metal Rapier',
    evolved: true,
    recipes: [[['onesie'], ['swordbreaker']]],
    desc: (lv) => `场上每有一颗迷你弹珠或一个敌人，弹珠伤害提高 ${v(lv, [1, 1.3, 1.5])}%`,
    hitMul: (b, _ball, _e, lv) =>
      1 + (v(lv, [1, 1.3, 1.5]) / 100) * (b.balls.filter((x) => x.baby && !x.dead).length + b.visibleEnemies().length),
  },
  {
    id: 'hammer',
    zh: '可耻之锤',
    en: 'Inglorious Hammer',
    evolved: true,
    recipes: [[['dumbbell'], ['hatchet']]],
    desc: (lv) => `弹珠碰到墙壁或坑道顶端时，以额外 ${v(lv, [50, 75, 100])}% 伤害打击一个随机敌人`,
    onWall: (b, ball, lv) => {
      const e = b.randomEnemy();
      if (!e) return;
      b.beam(ball.x, ball.y, e.cx, e.cy, '#ffe9a0', 3, 0.15);
      b.damage(e, b.stats.baseDamage * b.roll([3.5, 6.5]) * (1 + v(lv, [0.5, 0.75, 1])) * (ball.baby ? 0.35 : 1), 'passive');
    },
  },
  {
    id: 'detonator',
    zh: '遥控引爆器',
    en: 'Remote Detonator',
    evolved: true,
    recipes: [[['pressurevalve'], ['magnet']]],
    desc: (lv) => `敌人死亡时生成一颗 ${lv} 级炸弹弹珠`,
    onKill: (b, e, lv) => {
      if (b.balls.filter((x) => x.temp && x.parts.some((p) => p.def.id === 'bomb')).length >= 6) return;
      b.spawnBall({
        parts: [{ def: BALLS.bomb, lv }],
        baby: false,
        x: e.cx,
        y: e.cy,
        angle: b.rng.range(-Math.PI + 0.4, -0.4),
        temp: true,
      });
    },
  },
  {
    id: 'windweaver',
    zh: '织风者',
    en: 'Windweaver',
    evolved: true,
    recipes: [[['tornado'], ['slingshot']]],
    desc: (lv) => `每次拾取经验宝石时射出一颗 ${lv} 级疾风弹珠`,
    onGem: (b, lv) => {
      const p = b.player;
      b.spawnBall({ parts: [{ def: BALLS.wind, lv }], baby: false, x: p.x, y: p.y - p.r, angle: p.aim, temp: true });
    },
  },
  {
    id: 'wings',
    zh: '圣礼者之翼',
    en: 'Wings of the Anointed',
    evolved: true,
    recipes: [[['feather'], ['fleetfeet']]],
    desc: (lv) => `弹珠速度提高 ${v(lv, [40, 60, 80])}%，你的移动速度提高 ${v(lv, [20, 30, 40])}%`,
    stats: (s, lv) => {
      s.ballSpeedMul *= 1 + v(lv, [0.4, 0.6, 0.8]);
      s.moveSpeed *= 1 + v(lv, [0.2, 0.3, 0.4]);
      s.moveFullWhileShooting = true;
    },
  },
];

export const PASSIVES: Record<string, PassiveDef> = Object.fromEntries([...base, ...evolved].map((d) => [d.id, d]));

const REWARDS: Record<string, string[]> = {
  boneyard: ['pressurevalve', 'voodoo', 'cursedelixir'],
  snowy: ['goldenbull', 'healereffigy', 'archereffigy'],
};

export const passivePool = (unlocks: Set<string>) =>
  base.filter((d) => Object.entries(REWARDS).every(([key, ids]) => !ids.includes(d.id) || unlocks.has(key))).map((d) => d.id);

export const EVOLVED_PASSIVES = evolved;
