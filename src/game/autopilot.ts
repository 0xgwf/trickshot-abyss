import type { Battle, Controls } from './battle.ts';
import { TILE, WORLD_H } from './config.ts';
import { applyOffer, autoReactor } from './upgrades.ts';

/** A simple bot used by the balance simulator and the screenshot tests (plays roughly like a casual human). */
export function autopilot(b: Battle): Controls {
  const p = b.player;
  const enemies = b.enemies.filter((e) => !e.dead && e.def.rank === 'normal');
  const lowestNear = (x: number) => Math.max(0, ...enemies.filter((e) => Math.abs(e.cx - x) < TILE * 1.6).map((e) => e.y + e.h));
  let tx = (b.left + b.right) / 2;
  let ty = Math.max(WORLD_H - TILE * 2.4, lowestNear(p.x) + TILE * 2);
  const drop = b.drops
    .filter((d) => !d.dead && d.y > WORLD_H * 0.3 && d.y > lowestNear(d.x) + TILE * 1.4)
    .sort((a, c) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2 - ((c.x - p.x) ** 2 + (c.y - p.y) ** 2))[0];
  if (drop && (drop.kind !== 'gem' || Math.abs(drop.y - p.y) < TILE * 5)) {
    tx = drop.x;
    ty = drop.y;
  } else {
    const ball = b.balls.find((x) => !x.temp && x.state === 'fly' && x.vy > 0 && Math.abs(x.y - p.y) < TILE * 3);
    if (ball) tx = ball.x;
  }
  let mx = tx - p.x;
  let my = ty - p.y;
  const len0 = Math.hypot(mx, my);
  if (len0 > 0) {
    mx /= len0;
    my /= len0;
  }
  // Back off from enemies winding up a melee attack.
  for (const e of enemies) {
    if (e.windup > 0 && e.distToPoint(p.x, p.y) < TILE * 1.5) {
      my += 1.5;
      mx += p.x < e.cx ? -0.8 : 0.8;
    }
  }
  // Dodge shots whose path passes close to us within the next second.
  for (const s of b.shots) {
    const rx = p.x - s.x;
    const ry = p.y - s.y;
    const vv = s.vx * s.vx + s.vy * s.vy || 1;
    const t = Math.max(0, Math.min(1, (rx * s.vx + ry * s.vy) / vv));
    const cx = s.x + s.vx * t - p.x;
    const cy = s.y + s.vy * t - p.y;
    if (cx * cx + cy * cy < (s.r + p.r + 14) ** 2) {
      // Move perpendicular to the shot, away from its line.
      const nx = -s.vy;
      const ny = s.vx;
      const side = nx * -cx + ny * -cy > 0 ? 1 : -1;
      const n = Math.hypot(nx, ny) || 1;
      mx += (side * nx * 2.5) / n;
      my += (side * ny * 2.5) / n;
    }
  }
  const len = Math.hypot(mx, my);
  const ctl: Controls = { moveX: 0, moveY: 0, aimX: p.x, aimY: 0, fire: true, recall: true };
  if (len > 0.05 && (len0 > 4 || len > 1.1)) {
    ctl.moveX = mx / Math.max(1, len);
    ctl.moveY = my / Math.max(1, len);
  }
  const boss = b.stage.boss;
  if (boss) {
    // Alternate between the chin and bank shots off the side walls (to reach the crown).
    if (Math.floor(b.t / 3) % 2 === 0) {
      ctl.aimX = boss.cx;
      ctl.aimY = boss.y + TILE * 2.9;
    } else {
      const left = p.x - b.left > b.right - p.x;
      ctl.aimX = left ? b.left : b.right;
      ctl.aimY = boss.y + TILE * 0.5;
    }
  } else if (b.stage.miniboss?.def.immuneSide === 'front' && Math.floor(b.t / 2) % 3 !== 0) {
    // Shielded front: bank shots off the walls to hit its sides and back.
    const mb = b.stage.miniboss;
    const left = p.x - b.left > b.right - p.x;
    ctl.aimX = left ? b.left : b.right;
    ctl.aimY = Math.max(TILE * 0.5, mb.y - TILE * 0.5);
  } else {
    // Prioritise the enemies closest to the bottom (shield fronts just bounce balls back).
    const targets = b
      .visibleEnemies()
      .filter((e) => e.def.immuneSide !== 'front' || e.def.rank !== 'normal')
      .sort((a, c) => c.y - a.y);
    const t = targets.length ? targets[Math.floor(b.t * 1.3) % Math.min(3, targets.length)] : null;
    if (t) {
      ctl.aimX = t.cx;
      ctl.aimY = t.cy;
    }
  }
  return ctl;
}

/** Auto-resolves level-up and reactor choices. */
export function autoDecide(b: Battle) {
  if (b.phase === 'levelup' && b.offers) {
    const o = b.offers.find((x) => x.kind === 'upBall') ?? b.offers.find((x) => x.kind === 'newBall') ?? b.rng.pick(b.offers);
    applyOffer(b, o);
    b.resume();
  } else if (b.phase === 'reactor' && b.reactor) {
    autoReactor(b);
    b.resume();
  }
}

/** Advances a battle by `seconds` of game time with the bot playing. */
export function simulate(b: Battle, seconds: number, decide = true) {
  const end = b.t + seconds;
  let guard = 0;
  while (b.t < end && b.phase !== 'won' && b.phase !== 'lost' && guard++ < seconds * 200) {
    if (decide) autoDecide(b);
    else if (b.phase !== 'play') return;
    b.update(1 / 60, autopilot(b));
  }
}
