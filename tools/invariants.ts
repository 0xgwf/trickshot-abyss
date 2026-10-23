// Per-frame sanity checks for headless runs (tools/sim.ts, tools/stress.ts). They catch what is wrong
// without throwing: NaN positions, balls that vanish from the inventory, statuses above their cap,
// runs that stop making progress, entity counts that run away.
import type { Ball } from '../src/game/ball.ts';
import type { Battle } from '../src/game/battle.ts';
import { CFG, WORLD_H } from '../src/game/config.ts';

export interface Issue {
  kind: string;
  /** Errors fail the run; warnings are only reported. */
  level: 'error' | 'warn';
  /** First occurrence. */
  t: number;
  detail: string;
  count: number;
}

const DOTS = ['burn', 'poison', 'frostburn', 'venom', 'disease', 'darkflame'] as const;

/** Above these counts the browser would start to stutter. */
const CAPS = { balls: 200, enemies: 200, shots: 200, minions: 200, zones: 150, allies: 50, drops: 400 } as const;

/** Seconds without any damage dealt (while playing) before a run counts as stalled. */
const STALL_AFTER = 45;
/** Seconds a flying ball may travel almost horizontally before it counts as stuck. */
const FLAT_AFTER = 3;

const fin = (...xs: number[]) => xs.every(Number.isFinite);
const ballDesc = (ball: Ball) =>
  ball.baby && !ball.parts.length ? 'baby' : ball.parts.map((p) => `${p.def.id}${p.lv}`).join('x') + (ball.temp ? '(temp)' : '');

export class Invariants {
  private readonly found = new Map<string, Issue>();
  private lastDamage = 0;
  private lastDamageAt = 0;
  private flatSince = new Map<number, number>();

  get issues() {
    return [...this.found.values()];
  }

  get errors() {
    return this.issues.filter((i) => i.level === 'error');
  }

  private report(b: Battle, kind: string, detail: () => string, level: Issue['level'] = 'error') {
    const old = this.found.get(kind);
    if (old) old.count++;
    else this.found.set(kind, { kind, level, t: b.t, detail: detail(), count: 1 });
  }

  /** Call after every `Battle.update`. */
  check(b: Battle) {
    const p = b.player;
    if (!fin(p.x, p.y, p.hp, p.maxHp)) this.report(b, 'nan:player', () => `x=${p.x} y=${p.y} hp=${p.hp}/${p.maxHp}`);
    if (p.x < b.left - 1 || p.x > b.right + 1 || p.y < 0 || p.y > WORLD_H)
      this.report(
        b,
        'player-out-of-bounds',
        () => `(${p.x.toFixed(0)},${p.y.toFixed(0)}) corridor ${b.left.toFixed(0)}..${b.right.toFixed(0)}`,
      );
    // Everflowing Goblet allows overhealing.
    if (!b.hasPassive('everflowing') && p.hp > p.maxHp + 1e-6) this.report(b, 'player-overheal', () => `hp=${p.hp}/${p.maxHp}`);
    if (!fin(b.damageDealt) || b.damageDealt < this.lastDamage) this.report(b, 'damage-total', () => `damageDealt=${b.damageDealt}`);

    for (const e of b.enemies) {
      const id = e.def.id;
      if (!fin(e.x, e.y, e.hp, e.maxHp)) this.report(b, `nan:enemy:${id}`, () => `x=${e.x} y=${e.y} hp=${e.hp}/${e.maxHp}`);
      if (e.dead) continue;
      if (e.hp <= 0) this.report(b, `enemy-alive-at-0hp:${id}`, () => `hp=${e.hp}`);
      if (e.hp > e.maxHp + 1e-6) this.report(b, `enemy-overheal:${id}`, () => `hp=${e.hp}/${e.maxHp}`);
      for (const k of DOTS) {
        const d = e[k];
        if (!fin(d.stacks, d.timer, d.tick, d.dmg[0], d.dmg[1])) this.report(b, `nan:status:${k}`, () => JSON.stringify(d));
        else if (d.stacks < 0 || d.stacks > d.max) this.report(b, `status-over-cap:${k}`, () => `${d.stacks}/${d.max} on ${id}`);
      }
      if (e.bleed < 0 || e.bleed > e.bleedMax) this.report(b, 'status-over-cap:bleed', () => `${e.bleed}/${e.bleedMax} on ${id}`);
      if (e.radiation < 0 || e.radiation > e.radiationMax)
        this.report(b, 'status-over-cap:radiation', () => `${e.radiation}/${e.radiationMax} on ${id}`);
      if (!fin(e.freeze, e.slow, e.blind)) this.report(b, 'nan:status:cc', () => `freeze=${e.freeze} slow=${e.slow} blind=${e.blind}`);
    }

    const live = b.balls.filter((x) => !x.dead);
    for (const ball of live) {
      if (!fin(ball.x, ball.y, ball.vx, ball.vy, ball.speed, ball.dmgMul, ball.power)) {
        this.report(b, 'nan:ball', () => `${ballDesc(ball)} x=${ball.x} y=${ball.y} v=(${ball.vx},${ball.vy}) dmgMul=${ball.dmgMul}`);
        continue;
      }
      if (ball.x < b.left - 50 || ball.x > b.right + 50 || ball.y < -50 || ball.y > WORLD_H + 100)
        this.report(b, `ball-out-of-bounds:${ball.state}`, () => `${ballDesc(ball)} at (${ball.x.toFixed(0)},${ball.y.toFixed(0)})`);
      if (ball.state !== 'fly' || ball.repentReturn) continue;
      if (ball.speed < 1 || Math.hypot(ball.vx, ball.vy) < 1)
        this.report(b, 'ball-stopped', () => `${ballDesc(ball)} speed=${ball.speed} v=(${ball.vx},${ball.vy})`);
      if (Math.abs(ball.vy) < ball.speed * 0.1) {
        const since = this.flatSince.get(ball.uid) ?? b.t;
        this.flatSince.set(ball.uid, since);
        if (b.t - since > FLAT_AFTER)
          this.report(b, 'ball-stuck-flat', () => `${ballDesc(ball)} vy=${ball.vy.toFixed(1)} for ${FLAT_AFTER}s`);
      } else this.flatSince.delete(ball.uid);
    }
    if (this.flatSince.size > 500) this.flatSince.clear();

    // Every owned ball is in exactly one place: the queue, the field or its cooldown.
    for (const ob of b.owned) {
      const queued = b.queue.filter((q) => q === ob).length;
      const flying = live.filter((x) => x.owned === ob && !x.temp).length;
      const places = queued + flying + (ob.state === 'cooldown' ? 1 : 0);
      if (places !== 1) {
        const name = ob.parts.map((x) => x.def.id).join('x');
        this.report(
          b,
          places === 0 ? 'ball-lost' : 'ball-duplicated',
          () => `${name}: queued=${queued} flying=${flying} state=${ob.state}`,
        );
      }
    }
    for (const q of b.queue)
      if (q !== 'baby' && !b.owned.includes(q)) this.report(b, 'queue-stale', () => q.parts.map((x) => x.def.id).join('x'));
    const babies = b.queue.filter((q) => q === 'baby').length + live.filter((x) => x.baby && !x.temp && !x.parts.length).length;
    if (babies !== b.babies) this.report(b, 'baby-count', () => `queued+flying=${babies} but babies=${b.babies}`);

    if (b.owned.length > CFG.ballSlots) this.report(b, 'too-many-balls', () => `${b.owned.length}`);
    if (b.passives.length > CFG.passiveSlots) this.report(b, 'too-many-passives', () => `${b.passives.length}`);
    if (new Set(b.passives.map((x) => x.def.id)).size !== b.passives.length)
      this.report(b, 'duplicate-passive', () => b.passives.map((x) => x.def.id).join(' '));
    for (const lv of [...b.owned.flatMap((o) => o.parts.map((x) => x.lv)), ...b.passives.map((x) => x.lv)])
      if (lv < 1 || lv > 3 || !Number.isInteger(lv)) this.report(b, 'bad-level', () => `lv=${lv}`);
    if (b.pendingLevelUps < 0 || b.pendingReactors < 0 || b.xp < 0 || !fin(b.xp))
      this.report(b, 'bad-counter', () => `pendingLevelUps=${b.pendingLevelUps} pendingReactors=${b.pendingReactors} xp=${b.xp}`);
    if (b.phase === 'levelup' && !b.offers?.length) this.report(b, 'levelup-without-offers', () => '');
    if (b.phase === 'reactor' && !b.reactor?.length) this.report(b, 'reactor-without-options', () => '');

    for (const [k, cap] of Object.entries(CAPS)) {
      const n = (b[k as keyof typeof CAPS] as unknown[]).length;
      if (n > cap) this.report(b, `too-many:${k}`, () => `${n} > ${cap}`, 'warn');
    }

    if (b.damageDealt > this.lastDamage || b.phase !== 'play') {
      this.lastDamage = b.damageDealt;
      this.lastDamageAt = b.t;
    } else if (b.t - this.lastDamageAt > STALL_AFTER) {
      this.report(b, 'stalled', () => `no damage dealt for ${STALL_AFTER}s (stage ${b.stage.state}, ${b.enemies.length} enemies)`);
      this.lastDamageAt = b.t;
    }
  }
}

export const formatIssue = (i: Issue) =>
  `${i.level === 'error' ? 'ERROR' : 'warn '} ${i.kind} ×${i.count}, first at t=${i.t.toFixed(1)}s: ${i.detail}`;
