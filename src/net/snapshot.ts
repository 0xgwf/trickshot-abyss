// Field snapshots for multiplayer: everything the world renderer and the HUD read, as compact JSON.
// `takeSnapshot` runs where the battle is simulated; `applySnapshot` writes it into a stand-in Battle
// that is only ever drawn, never updated. Pure logic, so it also runs in Node.
import { Ball, newOwnedBall } from '../game/ball.ts';
import type { Ally, Battle, Beam, Drop, FloatText, Minion, Particle, Phase, Ring, Shot, Zone } from '../game/battle.ts';
import { BALLS } from '../game/data/balls.ts';
import { ENEMIES } from '../game/data/enemies.ts';
import { PASSIVES } from '../game/data/passives.ts';
import { Enemy } from '../game/enemy.ts';
import type { Warning } from '../game/stage.ts';

const DOTS = ['burn', 'poison', 'frostburn', 'venom', 'disease', 'darkflame'] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Ball parts as "burn3+iron3". */
const partsKey = (parts: { def: { id: string }; lv: number }[]) => parts.map((p) => `${p.def.id}${p.lv}`).join('+');
const parseParts = (key: string) =>
  key
    ? key.split('+').map((s) => {
        const m = /^(.*?)(\d)$/.exec(s)!;
        return { def: BALLS[m[1]], lv: Number(m[2]) };
      })
    : [];

// [id, x, y, hp, maxHp, flash, freeze, windup, shake, bleed, blind, slowTimer, radiation, flags, ...dot stacks]
type EnemySnap = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  ...number[],
];
// [x, y, r, parts, state, tag, trail (flat x,y list)]
type BallSnap = [number, number, number, string, number, string, number[]];

export interface Snapshot {
  t: number;
  phase: Phase;
  left: number;
  right: number;
  floorY: number;
  segment: number;
  segRows: number;
  hp: number;
  maxHp: number;
  lvl: number;
  xp: number;
  xpNeeded: number;
  kills: number;
  gold: number;
  autofire: boolean;
  player: [number, number, number, number, number, number];
  enemies: EnemySnap[];
  /** Index of the stage boss in `enemies`, or -1. */
  boss: number;
  king: unknown;
  queen: unknown;
  balls: BallSnap[];
  shots: [string, number, number, number, number, number][];
  zones: [string, number, number, number, number, number][];
  drops: [string, number, number, number][];
  minions: [string, number, number, number, number][];
  allies: [string, number, number, number, number, number, number, number][];
  particles: [number, number, string, number, number, number][];
  texts: [number, number, string, string, number, number][];
  beams: [number, number, number, number, string, number, number, number, number][];
  rings: [number, number, number, string, number, number][];
  warnings: Warning[];
  banner: { text: string; sub: string; t: number } | null;
  owned: [string, number, string, number][];
  passives: [string, number][];
}

/** Captures the parts of a battle that are drawn. Particles are capped to keep messages small. */
export function takeSnapshot(b: Battle, maxParticles = 160): Snapshot {
  const st = b.stage;
  const live = b.enemies.filter((e) => !e.dead);
  const p = b.player;
  return {
    t: r1(b.t),
    phase: b.phase,
    left: r1(b.left),
    right: r1(b.right),
    floorY: r1(st.floorY),
    segment: st.segment,
    segRows: st.segRows,
    hp: Math.round(p.hp),
    maxHp: p.maxHp,
    lvl: b.lvl,
    xp: b.xp,
    xpNeeded: b.xpNeeded,
    kills: b.kills,
    gold: b.gold,
    autofire: b.autofire,
    player: [r1(p.x), r1(p.y), r1(p.aim * 100) / 100, r1(p.frozen), r1(p.hurtFlash), r1(p.invuln)],
    enemies: live.map(
      (e) =>
        [
          e.def.id,
          r1(e.x),
          r1(e.y),
          Math.round(e.hp),
          Math.round(e.maxHp),
          r1(e.flash * 100) / 100,
          r1(e.freeze),
          r1(e.windup),
          r1(e.shake * 100) / 100,
          e.bleed,
          r1(e.blind),
          r1(e.slowTimer),
          e.radiation,
          (e.curse ? 1 : 0) | (e.leech ? 2 : 0) | (e.rod ? 4 : 0) | (e.invulnerable ? 8 : 0),
          ...DOTS.map((k) => e[k].stacks),
        ] as EnemySnap,
    ),
    boss: st.boss && !st.boss.dead ? live.indexOf(st.boss) : -1,
    king: st.kingState,
    queen: (st as unknown as { queen: unknown }).queen,
    balls: b.balls
      .filter((x) => !x.dead)
      .map((x) => [
        r1(x.x),
        r1(x.y),
        r1(x.r),
        partsKey(x.parts),
        x.state === 'fly' ? 0 : 1,
        x.tag,
        x.trail.flatMap((q) => [r1(q.x), r1(q.y)]),
      ]),
    shots: b.shots.filter((s) => !s.dead).map((s) => [s.kind, r1(s.x), r1(s.y), r1(s.vx), r1(s.vy), s.r]),
    zones: b.zones.filter((z) => !z.dead).map((z) => [z.kind, r1(z.x), r1(z.y), z.r, r1(z.life), z.maxLife]),
    drops: b.drops.filter((d) => !d.dead).map((d) => [d.kind, r1(d.x), r1(d.y), d.value]),
    minions: b.minions.filter((m) => !m.dead).map((m) => [m.kind, r1(m.x), r1(m.y), r1(m.vx), r1(m.vy)]),
    allies: b.allies.filter((a) => !a.dead).map((a) => [a.kind, r1(a.x), r1(a.y), a.w, a.h, Math.round(a.hp), a.maxHp, r1(a.flash)]),
    particles: b.particles.slice(-maxParticles).map((q) => [r1(q.x), r1(q.y), q.color, q.size, r1(q.life * 100) / 100, q.max]),
    texts: b.texts.map((q) => [r1(q.x), r1(q.y), q.text, q.color, r1(q.life * 100) / 100, q.size]),
    beams: b.beams.map((q) => [r1(q.x1), r1(q.y1), r1(q.x2), r1(q.y2), q.color, q.width, r1(q.life * 100) / 100, q.max, q.zigzag ? 1 : 0]),
    rings: b.rings.map((q) => [r1(q.x), r1(q.y), r1(q.r), q.color, r1(q.life * 100) / 100, q.max]),
    warnings: st.warnings,
    banner: st.banner,
    owned: b.owned.map((o) => [partsKey(o.parts), o.fused ? 1 : 0, o.state, r1(o.cooldown)]),
    passives: b.passives.map((q) => [q.def.id, q.lv]),
  };
}

/** Writes a snapshot into a Battle that is only used for drawing. */
export function applySnapshot(g: Battle, s: Snapshot) {
  const st = g.stage;
  g.t = s.t;
  g.phase = s.phase;
  g.left = g.targetLeft = s.left;
  g.right = g.targetRight = s.right;
  st.floorY = s.floorY;
  st.segment = s.segment;
  st.segRows = s.segRows;
  const p = g.player;
  [p.x, p.y, p.aim, p.frozen, p.hurtFlash, p.invuln] = s.player;
  p.hp = s.hp;
  p.maxHp = s.maxHp;
  g.lvl = s.lvl;
  g.xp = s.xp;
  g.xpNeeded = s.xpNeeded;
  g.kills = s.kills;
  g.gold = s.gold;
  g.autofire = s.autofire;

  g.enemies = s.enemies.map(([id, x, y, hp, maxHp, flash, freeze, windup, shake, bleed, blind, slowTimer, radiation, flags, ...dots]) => {
    const e = new Enemy(ENEMIES[id], x, y, maxHp, 0);
    e.hp = hp;
    e.flash = flash;
    e.freeze = freeze;
    e.windup = windup;
    e.shake = shake;
    e.bleed = e.bleedMax = bleed;
    e.blind = blind;
    e.slowTimer = slowTimer;
    e.radiation = e.radiationMax = radiation;
    if (flags & 1) e.curse = { hits: 0, needed: 1, dmg: [0, 0] };
    if (flags & 2) e.leech = { rate: 0, max: 0, tick: 1 };
    if (flags & 4) e.rod = { interval: 1, timer: 1, dmg: [0, 0], targets: 0 };
    e.invulnerable = (flags & 8) !== 0;
    DOTS.forEach((k, i) => (e[k].stacks = dots[i] ?? 0));
    return e;
  });
  st.boss = s.boss >= 0 ? g.enemies[s.boss] : null;
  Object.assign(st as unknown as { king: unknown; queen: unknown }, { king: s.king, queen: s.queen });

  g.balls = s.balls.map(([x, y, r, key, state, tag, trail]) => {
    const parts = parseParts(key);
    const ball = new Ball(parts, null, x, y, r, 0, !parts.length, true);
    ball.state = state ? 'return' : 'fly';
    ball.tag = tag as Ball['tag'];
    for (let i = 0; i + 1 < trail.length; i += 2) ball.trail.push({ x: trail[i], y: trail[i + 1] });
    return ball;
  });
  g.shots = s.shots.map(([kind, x, y, vx, vy, r]): Shot => ({
    kind: kind as Shot['kind'],
    x,
    y,
    vx,
    vy,
    r,
    dmg: 0,
    cancelable: false,
    life: 1,
    homing: 0,
  }));
  g.zones = s.zones.map(([kind, x, y, r, life, maxLife]): Zone => ({
    kind: kind as Zone['kind'],
    x,
    y,
    r,
    life,
    maxLife,
    interval: 1,
    tick: 1,
    once: null,
    apply: () => {},
  }));
  g.drops = s.drops.map(([kind, x, y, value]): Drop => ({ kind: kind as Drop['kind'], x, y, value, t: 0, pull: false }));
  g.minions = s.minions.map(([kind, x, y, vx, vy]): Minion => ({
    kind: kind as Minion['kind'],
    x,
    y,
    vx,
    vy,
    target: null,
    dmg: [0, 0],
    life: 1,
    steal: 0,
  }));
  g.allies = s.allies.map(([kind, x, y, w, h, hp, maxHp, flash]): Ally => ({
    kind: kind as Ally['kind'],
    x,
    y,
    w,
    h,
    hp,
    maxHp,
    flash,
    atkCd: 1,
    dmg: [0, 0],
    perk: 1,
  }));
  g.particles = s.particles.map(([x, y, color, size, life, max]): Particle => ({ x, y, vx: 0, vy: 0, color, size, life, max }));
  g.texts = s.texts.map(([x, y, text, color, life, size]): FloatText => ({ x, y, text, color, life, size }));
  g.beams = s.beams.map(([x1, y1, x2, y2, color, width, life, max, zigzag]): Beam => ({
    x1,
    y1,
    x2,
    y2,
    color,
    width,
    life,
    max,
    zigzag: !!zigzag,
  }));
  g.rings = s.rings.map(([x, y, r, color, life, max]): Ring => ({ x, y, r, color, life, max }));
  st.warnings = s.warnings;
  st.banner = s.banner;
  g.owned = s.owned.map(([key, fused, state, cooldown]) => {
    const ob = newOwnedBall(parseParts(key), !!fused);
    ob.state = state as typeof ob.state;
    ob.cooldown = cooldown;
    return ob;
  });
  g.passives = s.passives.map(([id, lv]) => ({ def: PASSIVES[id], lv }));
}
