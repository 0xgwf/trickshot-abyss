import { Rng } from '../core/rng.ts';
import { Ball, newOwnedBall, type BallTag, type OwnedBall } from './ball.ts';
import { CFG, RULES, SEGMENT_COLS, TILE, WORLD_H, WORLD_W } from './config.ts';
import { BALLS } from './data/balls.ts';
import { levelById, type LevelDef } from './data/levels.ts';
import { Enemy, type Dot } from './enemy.ts';
import type { Duel } from './duel.ts';
import { Stage } from './stage.ts';
import type { BallDef, CharacterDef, DamageKind, DerivedStats, HitSide, Part, PassiveDef, Range } from './types.ts';
import {
  applyOffer,
  autoOffer,
  autoReactor,
  makeOffers,
  makeReactorOptions,
  offerTitle,
  type Offer,
  type ReactorOption,
} from './upgrades.ts';

export interface Controls {
  moveX: number;
  moveY: number;
  /** Aim target in world px. */
  aimX: number;
  aimY: number;
  fire: boolean;
  recall: boolean;
}

export interface OwnedPassive {
  def: PassiveDef;
  lv: number;
}

export type QueueItem = OwnedBall | 'baby';

export interface Player {
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  invuln: number;
  aim: number;
  shooting: boolean;
  fireCd: number;
  hurtFlash: number;
  /** Frozen by icicles: can't move. */
  frozen: number;
  vx: number;
  vy: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  cancelable: boolean;
  kind: 'arrow' | 'orb' | 'bone' | 'bigbone' | 'hand' | 'icicle' | 'shield';
  life: number;
  homing: number;
  /** Seconds the player is frozen in place on hit. */
  freeze?: number;
  /** Boomerangs (the Skeleton King's hand) reverse after this many seconds. */
  turnAt?: number;
  dead?: boolean;
}

export interface Minion {
  kind: 'mosquito' | 'firework' | 'bug' | 'arrow';
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: Enemy | null;
  dmg: Range;
  life: number;
  steal: number;
  burn?: Range;
  chain?: { n: number; dmg: Range };
  dead?: boolean;
}

export interface Zone {
  kind: 'lava' | 'tar' | 'landslide' | 'meteor' | 'spike' | 'snare';
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  interval: number;
  tick: number;
  /** Touch-once zones (lava, tar, spikes) remember who they already hit. */
  once: Set<Enemy> | null;
  /** Damage per second to enemies within a tile (lava, tar and ice spikes). */
  aura?: Range;
  auraTick?: number;
  apply(b: Battle, e: Enemy): void;
  dead?: boolean;
}

/** Friendly units that walk up the board and fight (Stone Effigy, Cursed Elixir zombies). */
export interface Ally {
  kind: 'soldier' | 'zombie' | 'bull' | 'healer' | 'archer';
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  atkCd: number;
  dmg: Range;
  flash: number;
  /** Bull gold / healer heal / archer shot timer. */
  perk: number;
  dead?: boolean;
}

export interface Drop {
  kind: 'gem' | 'potion' | 'gold' | 'reactor';
  x: number;
  y: number;
  value: number;
  t: number;
  pull: boolean;
  dead?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  life: number;
  max: number;
  zigzag: boolean;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  max: number;
}

export type GameEvent = {
  type:
    | 'hit'
    | 'kill'
    | 'shoot'
    | 'catch'
    | 'hurt'
    | 'levelup'
    | 'pickup'
    | 'explode'
    | 'zap'
    | 'ting'
    | 'boss'
    | 'reactor'
    | 'win'
    | 'lose'
    | 'widen'
    | 'heal';
};

export type Phase = 'play' | 'levelup' | 'reactor' | 'won' | 'lost';

const DOT_COLORS: Record<string, string> = {
  burn: '#ff8a3d',
  poison: '#8fdc4a',
  frostburn: '#7fd8ff',
  venom: '#5fe0a0',
  disease: '#c7e05a',
  darkflame: '#b06cff',
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Mirror/extra copies (Cohabitants, Empty Nester) fade after this many seconds. */
const COPY_LIFE = 2.5;
/** Cap on temporary balls on the field; the oldest vanish first. */
const MAX_TEMP_BALLS = 70;

export class Battle {
  readonly rng: Rng;
  readonly seed: number;
  readonly char: CharacterDef;
  t = 0;
  phase: Phase = 'play';
  speed = 1;

  left: number;
  right: number;
  targetLeft: number;
  targetRight: number;

  player: Player;
  stats!: DerivedStats;
  owned: OwnedBall[] = [];
  passives: OwnedPassive[] = [];
  queue: QueueItem[] = [];
  babies = 0;
  balls: Ball[] = [];
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  minions: Minion[] = [];
  zones: Zone[] = [];
  allies: Ally[] = [];
  drops: Drop[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  beams: Beam[] = [];
  rings: Ring[] = [];
  events: GameEvent[] = [];

  xp = 0;
  lvl = 1;
  xpNeeded: number = CFG.xpFirst;
  pendingLevelUps = 0;
  pendingReactors = 0;
  offers: Offer[] | null = null;
  reactor: ReactorOption[] | null = null;
  /**
   * Versus: choices never stop the run. Level-up offers wait beside the field (pick with `choose`) and pick
   * themselves after CFG.liveChoiceTime; the Fusion Reactor resolves itself.
   */
  live = false;
  /** How long the current live offers have been waiting. */
  offersT = 0;
  /** Versus rules for this player's run (attacks out, rows in), if any. */
  duel: Duel | null = null;

  gold = 0;
  kills = 0;
  damageDealt = 0;
  autofire = true;
  recallReady = false;
  shake = 0;
  stage: Stage;
  turretT = 1;
  /** Row countdowns for "every N rows" passives, keyed by passive id. */
  rowTimers: Record<string, number> = {};
  readonly unlocks: Set<string>;
  readonly level: LevelDef;

  constructor(char: CharacterDef, seed: number, unlocks: Set<string>, levelId = 'boneyard') {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.char = char;
    this.unlocks = unlocks;
    this.level = levelById(levelId);
    const cols = SEGMENT_COLS[0];
    this.left = this.targetLeft = (WORLD_W - cols * TILE) / 2;
    this.right = this.targetRight = this.left + cols * TILE;
    this.player = {
      x: WORLD_W / 2,
      y: WORLD_H - TILE * 2.5,
      r: CFG.playerRadius * TILE,
      hp: 100,
      maxHp: 100,
      invuln: 0,
      aim: -Math.PI / 2,
      shooting: false,
      fireCd: 0,
      hurtFlash: 0,
      frozen: 0,
      vx: 0,
      vy: 0,
    };
    this.recomputeStats();
    this.player.hp = this.player.maxHp;
    const start = BALLS[char.startBall];
    if (start) this.addBall(start);
    this.syncBabies();
    this.stage = new Stage(this);
  }

  // ---------------------------------------------------------------- stats

  recomputeStats() {
    const s = this.char.stats;
    const st: DerivedStats = {
      maxHp: s.end * CFG.hpPerEnd + CFG.hpFlat,
      moveSpeed: CFG.moveSpeedBase * (1 + CFG.moveSpeedPerSpd * (s.spd - 3)),
      ballSpeed: CFG.ballSpeedBase * (1 + CFG.ballSpeedPerSpd * (s.spd - 3)),
      fireInterval: 1 / (CFG.fireRateBase * (1 + CFG.fireRatePerDex * (s.dex - 4))),
      baseDamage: s.str,
      babyCount: Math.floor(s.lea * CFG.babyCountPerLea),
      babyDamage: [s.lea * CFG.babyDamagePerLea[0], s.lea * CFG.babyDamagePerLea[1]],
      critChance: CFG.critChanceBase + CFG.critPerDex * s.dex,
      statusPower: 1 + CFG.intPowerPerPoint * (s.int - 3),
      aoePower: 1 + CFG.intPowerPerPoint * (s.int - 3),
      passivePower: 1 + CFG.intPowerPerPoint * (s.int - 3),
      damageTaken: 1,
      dodge: 0,
      catchRadius: CFG.catchRadius,
      pickupRadius: CFG.pickupRadius,
      ballSpeedMul: 1,
      moveFullWhileShooting: false,
      babyDamageMul: 1,
      scatterAim: 0,
      babyCountMul: 1,
    };
    // Character quirks
    if (this.char.id === 'itchy') {
      st.fireInterval /= 2;
      st.scatterAim = 0.26;
      st.moveFullWhileShooting = true;
    }
    for (const p of this.passives) p.def.stats?.(st, p.lv);
    st.babyCount = Math.floor(st.babyCount * st.babyCountMul);
    const hpGain = st.maxHp - this.player.maxHp;
    this.player.maxHp = st.maxHp;
    if (hpGain > 0) this.player.hp += hpGain;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp * (this.hasPassive('everflowing') ? RULES.overhealCap : 1));
    this.stats = st;
  }

  hasPassive(id: string) {
    return this.passives.some((p) => p.def.id === id);
  }

  passiveLv(id: string) {
    return this.passives.find((p) => p.def.id === id)?.lv ?? 0;
  }

  /** Babies still in flight that should disappear when they come back (stat went down). */
  private babyExcess = 0;

  /** Keeps the number of baby balls (queued + flying) equal to the stat. */
  syncBabies() {
    const want = this.char.id === 'emptynester' ? 0 : this.stats.babyCount;
    while (this.babies < want) {
      this.babies++;
      this.queue.push('baby');
    }
    this.babyExcess = 0;
    while (this.babies > want) {
      const i = this.queue.lastIndexOf('baby');
      if (i < 0) {
        this.babyExcess = this.babies - want;
        break;
      }
      this.queue.splice(i, 1);
      this.babies--;
    }
  }

  // ---------------------------------------------------------------- inventory

  addBall(def: BallDef, lv = 1) {
    const ob = newOwnedBall([{ def, lv }]);
    this.owned.push(ob);
    // New special balls go to the front of the queue so they show up right away.
    this.queue.unshift(ob);
    return ob;
  }

  /** Removes an owned ball from the slots, the queue and the field. */
  removeOwned(ob: OwnedBall) {
    this.owned = this.owned.filter((o) => o !== ob);
    this.queue = this.queue.filter((q) => q !== ob);
    for (const b of this.balls) if (b.owned === ob) b.dead = true;
  }

  // ---------------------------------------------------------------- main loop

  update(dt: number, ctl: Controls) {
    this.events.length = 0;
    if (this.phase !== 'play') {
      this.updateFx(dt);
      return;
    }
    dt *= this.speed;
    // Sub-step large frames so collisions stay stable at 2x speed.
    const steps = Math.ceil(dt / (1 / 60));
    const sdt = dt / steps;
    for (let i = 0; i < steps && this.phase === 'play'; i++) this.step(sdt, ctl);
  }

  private step(dt: number, ctl: Controls) {
    this.t += dt;
    this.left += (this.targetLeft - this.left) * Math.min(1, dt * 2.5);
    this.right += (this.targetRight - this.right) * Math.min(1, dt * 2.5);
    if (Math.abs(this.targetLeft - this.left) < 0.5) this.left = this.targetLeft;
    if (Math.abs(this.targetRight - this.right) < 0.5) this.right = this.targetRight;

    this.stage.update(dt);
    this.updatePlayer(dt, ctl);
    this.updateFiring(dt, ctl);
    this.updateOwnedCooldowns(dt);
    for (const b of this.balls) this.updateBall(b, dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateMinions(dt);
    this.updateAllies(dt);
    this.updateZones(dt);
    this.updateDrops(dt);
    for (const p of this.passives) p.def.onTick?.(this, p.lv, dt);
    this.updateFx(dt);
    this.cleanup();

    if (this.player.hp <= 0) {
      this.phase = 'lost';
      this.events.push({ type: 'lose' });
      return;
    }
    this.checkPending();
    this.duel?.update(dt);
    if (this.live && this.offers && (this.offersT += dt) >= CFG.liveChoiceTime) {
      const o = autoOffer(this.offers);
      this.text(this.player.x, this.player.y - 40, `自动选择 · ${offerTitle(o).name}`, '#7ad8ff', 15);
      this.choose(o);
    }
  }

  checkPending() {
    if (this.phase !== 'play') return;
    if (this.pendingLevelUps > 0 && this.char.id === 'cogitator') {
      // The Cogitator chooses upgrades by himself.
      while (this.pendingLevelUps > 0) {
        const offers = makeOffers(this);
        const pick = autoOffer(offers);
        const t = offerTitle(pick);
        applyOffer(this, pick);
        this.text(this.player.x, this.player.y - 40, `${t.tag} ${t.name}`, '#7ad8ff', 16);
        this.events.push({ type: 'levelup' });
      }
      this.recomputeStats();
      this.syncBabies();
    }
    if (this.pendingLevelUps > 0 && !(this.live && this.offers)) {
      this.offers = makeOffers(this);
      this.offersT = 0;
      if (this.offers.length) {
        this.events.push({ type: 'levelup' });
        if (this.live) return;
        this.phase = 'levelup';
        return;
      }
      this.offers = null;
      this.pendingLevelUps = 0;
    }
    if (this.pendingReactors > 0 && this.live) {
      while (this.pendingReactors > 0) this.text(this.player.x, this.player.y - 40, autoReactor(this), '#ffd76a', 15);
      this.events.push({ type: 'reactor' });
      this.recomputeStats();
      this.syncBabies();
    } else if (this.pendingReactors > 0) {
      this.reactor = makeReactorOptions(this);
      this.phase = 'reactor';
      this.events.push({ type: 'reactor' });
    }
  }

  /** Applies a level-up choice and carries on (live offers, or the UI after a paused choice). */
  choose(o: Offer) {
    applyOffer(this, o);
    this.resume();
  }

  /** Called by the UI after a choice was applied. */
  resume() {
    this.offers = null;
    this.reactor = null;
    this.phase = 'play';
    this.recomputeStats();
    this.syncBabies();
    this.checkPending();
  }

  private cleanup() {
    if (this.balls.some((b) => b.dead)) this.balls = this.balls.filter((b) => !b.dead);
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.shots.some((s) => s.dead)) this.shots = this.shots.filter((s) => !s.dead);
    if (this.minions.some((m) => m.dead)) this.minions = this.minions.filter((m) => !m.dead);
    if (this.zones.some((z) => z.dead)) this.zones = this.zones.filter((z) => !z.dead);
    if (this.allies.some((a) => a.dead)) this.allies = this.allies.filter((a) => !a.dead);
    if (this.drops.some((d) => d.dead)) this.drops = this.drops.filter((d) => !d.dead);
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(dt: number, ctl: Controls) {
    const p = this.player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    p.frozen = Math.max(0, p.frozen - dt);
    let mx = p.frozen > 0 ? 0 : ctl.moveX;
    let my = p.frozen > 0 ? 0 : ctl.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    let speed = this.stats.moveSpeed * TILE;
    if (p.shooting && !this.stats.moveFullWhileShooting) speed *= CFG.shootingMoveMul;
    p.vx = mx * speed;
    p.vy = my * speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // Push out of enemies
    for (const e of this.enemies) {
      if (e.dead || e.def.rank === 'boss') continue;
      const cx = clamp(p.x, e.x, e.x + e.w);
      const cy = clamp(p.y, e.y, e.y + e.h);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= p.r * p.r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * p.r;
        p.y = cy + (dy / d) * p.r;
      } else {
        p.y = e.y + e.h + p.r;
      }
    }
    p.x = clamp(p.x, this.left + p.r, this.right - p.r);
    p.y = clamp(p.y, p.r, WORLD_H - p.r);

    // Aim: only upward, at least 20° above horizontal.
    let a = Math.atan2(ctl.aimY - p.y, ctl.aimX - p.x);
    const min = CFG.minAimAngle;
    if (a > -min && a <= Math.PI / 2) a = -min;
    else if (a > Math.PI / 2 || a < -Math.PI + min) a = -Math.PI + min;
    p.aim = a;

    if (ctl.recall && this.recallReady) this.recall();
  }

  recall() {
    for (const b of this.balls) {
      if (b.state === 'fly' && !b.temp && b.age > 1) b.state = 'return';
    }
    this.recallReady = false;
  }

  private updateFiring(dt: number, ctl: Controls) {
    const p = this.player;
    p.fireCd -= dt;
    const wantFire = ctl.fire || this.autofire || this.char.id === 'itchy';
    p.shooting = wantFire && this.queue.length > 0;
    // Recall becomes available once a ball has been out for a while.
    this.recallReady = this.balls.some((b) => b.state === 'fly' && !b.temp && b.age > CFG.recallAfter);
    // Keep the sub-frame remainder while firing continuously, but never bank time while idle.
    if (!wantFire || !this.queue.length) {
      p.fireCd = Math.max(0, p.fireCd);
      return;
    }
    while (p.fireCd <= 0 && this.queue.length) {
      const item = this.queue.shift()!;
      let a = p.aim;
      if (this.stats.scatterAim > 0) a += this.rng.range(-this.stats.scatterAim, this.stats.scatterAim);
      a = Math.min(-CFG.minAimAngle, Math.max(-Math.PI + CFG.minAimAngle, a));
      this.launch(item, a);
      p.fireCd += this.stats.fireInterval;
      this.events.push({ type: 'shoot' });
    }
    if (p.fireCd < 0) p.fireCd = 0;
  }

  private updateOwnedCooldowns(dt: number) {
    for (const ob of this.owned) {
      if (ob.state !== 'cooldown') continue;
      ob.cooldown -= dt;
      if (ob.cooldown <= 0) {
        ob.state = 'queued';
        this.queue.push(ob);
      }
    }
  }

  /** Launches a queued item from the player. */
  launch(item: QueueItem, angle: number) {
    const p = this.player;
    const mirror = this.char.id === 'cohabitants';
    // Every ball the player shoots (babies and copies included) gets the launch hooks.
    const shot = (ball: Ball) => {
      for (const part of ball.parts) part.def.onLaunch?.(this, ball, part.lv);
      for (const ps of this.passives) ps.def.onLaunch?.(this, ball, ps.lv);
      return ball;
    };
    if (item === 'baby') {
      shot(this.spawnBall({ baby: true, x: p.x, y: p.y - p.r, angle, temp: false, power: mirror ? 0.5 : 1 }));
      if (mirror)
        shot(this.spawnBall({ baby: true, x: p.x, y: p.y - p.r, angle: -Math.PI - angle, temp: true, power: 0.5 })).life = COPY_LIFE;
      return;
    }
    item.state = 'flying';
    shot(
      this.spawnBall({ parts: item.parts, owned: item, baby: false, x: p.x, y: p.y - p.r, angle, temp: false, power: mirror ? 0.5 : 1 }),
    );
    if (this.char.id === 'emptynester') {
      // Each shot fires an extra instance of the special ball.
      shot(
        this.spawnBall({ parts: item.parts, owned: null, baby: false, x: p.x, y: p.y - p.r, angle: angle + 0.12, temp: true, power: 0.5 }),
      ).life = COPY_LIFE;
    }
    if (mirror) {
      shot(
        this.spawnBall({
          parts: item.parts,
          owned: null,
          baby: false,
          x: p.x,
          y: p.y - p.r,
          angle: -Math.PI - angle,
          temp: true,
          power: 0.5,
        }),
      ).life = COPY_LIFE;
    }
    if (this.hasPassive('feather')) {
      // Radiant Feather knockback
      p.y += 6;
    }
  }

  spawnBall(o: {
    parts?: Part[];
    owned?: OwnedBall | null;
    baby: boolean;
    x: number;
    y: number;
    angle: number;
    temp: boolean;
    speedMul?: number;
    tag?: BallTag;
    power?: number;
  }) {
    const parts = o.parts ?? [];
    let speed = this.stats.ballSpeed * TILE * this.stats.ballSpeedMul;
    for (const part of parts) speed *= part.def.speedMul?.(part.lv) ?? 1;
    if (o.speedMul) speed *= o.speedMul;
    const rubber = this.passiveLv('rubber');
    if (rubber) speed *= 0.7;
    const r = (o.baby && !parts.length ? CFG.babyRadius : CFG.ballRadius) * TILE;
    const ball = new Ball(parts, o.owned ?? null, o.x, o.y, r, speed, o.baby, o.temp);
    ball.tag = o.tag ?? 'normal';
    ball.power = o.power ?? 1;
    if (this.char.id === 'embedded') ball.pierceUntilWall = true;
    ball.setAngle(o.angle);
    this.balls.push(ball);
    if (o.temp) {
      let temps = 0;
      for (const x of this.balls) if (x.temp && !x.dead) temps++;
      for (const x of this.balls) {
        if (temps <= MAX_TEMP_BALLS) break;
        if (x.temp && !x.dead) {
          x.dead = true;
          temps--;
        }
      }
    }
    return ball;
  }

  /** Spawns a temporary baby ball (from Egg Sac, Brood Mother, maggots…). */
  spawnBaby(x: number, y: number, angle?: number, inherit?: Part[], tag?: BallTag, speedMul?: number) {
    const a = angle ?? this.rng.range(-Math.PI + 0.3, -0.3);
    const ball = this.spawnBall({ parts: inherit ?? [], baby: true, x, y, angle: a, temp: true, tag, speedMul });
    const horn = this.passiveLv('cornucopia');
    if (tag === undefined && horn) {
      const [lo, hi] = [
        [0, 1],
        [0, 2],
        [1, 2],
      ][horn - 1];
      const extra = this.rng.int(lo, hi);
      for (let i = 0; i < extra; i++)
        this.spawnBall({ parts: inherit ?? [], baby: true, x, y, angle: a + this.rng.range(-0.4, 0.4), temp: true });
    }
    return ball;
  }

  // ---------------------------------------------------------------- balls

  private updateBall(ball: Ball, dt: number) {
    if (ball.dead) return;
    ball.age += dt;
    if (ball.life !== Infinity) {
      ball.life -= dt;
      if (ball.life <= 0) {
        ball.dead = true;
        this.spark(ball.x, ball.y, '#ffffff', 3);
        return;
      }
    }
    for (const [e, cd] of ball.hitCd) {
      if (cd - dt <= 0) ball.hitCd.delete(e);
      else ball.hitCd.set(e, cd - dt);
    }
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 7) ball.trail.shift();

    const p = this.player;
    if (ball.state === 'return' || ball.repentReturn) {
      const dx = p.x - ball.x;
      const dy = p.y - ball.y;
      const d = Math.hypot(dx, dy);
      const sp = ball.repentReturn ? ball.speed : CFG.returnSpeed * TILE;
      if (d < Math.max(p.r, sp * dt)) {
        this.catchBall(ball, false);
        return;
      }
      ball.vx = (dx / d) * sp;
      ball.vy = (dy / d) * sp;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.repentReturn) {
        // The Repentant: damages every enemy on the way back.
        for (const e of this.enemies) {
          if (e.dead || ball.hitCd.has(e)) continue;
          if (e.distToPoint(ball.x, ball.y) < ball.r) {
            ball.hitCd.set(e, 1);
            this.hitEnemy(ball, e, 'back');
            if (ball.destroysOnHit) {
              this.destroyBall(ball);
              return;
            }
          }
        }
      }
      return;
    }

    for (const part of ball.parts) part.def.onTick?.(this, ball, part.lv, dt);
    if (ball.dead) return;

    const dist = ball.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / (ball.r * 0.9)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;
      this.collideWalls(ball);
      if (ball.dead || ball.state !== 'fly' || ball.repentReturn) return;
      this.collideEnemies(ball);
      if (ball.dead) return;
    }
    this.collideShots(ball);

    // Catch: the ball is coming down and touches the player.
    if (ball.vy > 0 && ball.age > 0.25) {
      const cr = p.r + ball.r + this.stats.catchRadius * TILE;
      if ((ball.x - p.x) ** 2 + (ball.y - p.y) ** 2 < cr * cr) this.catchBall(ball, true);
    }
  }

  /** A returning baby beyond the current baby count just disappears. */
  private dropExcessBaby() {
    if (this.babyExcess <= 0) return false;
    this.babyExcess--;
    this.babies--;
    return true;
  }

  private catchBall(ball: Ball, caught: boolean) {
    ball.dead = true;
    if (ball.temp) return;
    if (ball.baby) {
      if (!this.dropExcessBaby()) this.queue.unshift('baby');
    } else if (ball.owned && this.owned.includes(ball.owned)) {
      ball.owned.state = 'queued';
      if (caught) this.queue.unshift(ball.owned);
      else this.queue.push(ball.owned);
    }
    if (caught) {
      this.events.push({ type: 'catch' });
      for (const ps of this.passives) ps.def.onCatch?.(this, ball, ps.lv);
      this.ring(ball.x, ball.y, TILE * 0.5, '#ffffff', 0.2);
    }
  }

  /** Ball destroyed itself (Dark, Egg Sac, Bomb…): owned balls wait out their cooldown. */
  destroyBall(ball: Ball) {
    if (ball.dead) return;
    ball.dead = true;
    if (ball.temp) return;
    if (ball.baby) {
      if (!this.dropExcessBaby()) this.queue.push('baby');
      return;
    }
    const ob = ball.owned;
    if (!ob || !this.owned.includes(ob)) return;
    let cd = 0;
    for (const part of ob.parts) cd = Math.max(cd, part.def.cooldown?.(part.lv) ?? 0);
    ob.state = 'cooldown';
    ob.cooldown = cd;
    if (cd <= 0) {
      ob.state = 'queued';
      this.queue.push(ob);
    }
  }

  private minVertical(ball: Ball) {
    const minVy = ball.speed * 0.2;
    if (Math.abs(ball.vy) < minVy) {
      ball.vy = (ball.vy < 0 ? -1 : 1) * minVy;
      ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(0, ball.speed * ball.speed - minVy * minVy));
    }
  }

  private collideWalls(ball: Ball) {
    const r = ball.r;
    if (ball.x - r < this.left) {
      ball.x = this.left + r;
      ball.vx = Math.abs(ball.vx);
      this.onWall(ball, false);
    } else if (ball.x + r > this.right) {
      ball.x = this.right - r;
      ball.vx = -Math.abs(ball.vx);
      this.onWall(ball, false);
    }
    if (ball.dead) return;
    if (ball.y - r < 0) {
      ball.y = r;
      ball.vy = Math.abs(ball.vy);
      this.onWall(ball, true);
      if (this.char.id === 'repentant' && !ball.temp && !ball.dead) ball.repentReturn = true;
    } else if (RULES.returnAtBottomEdge ? ball.y + r >= WORLD_H && ball.vy >= 0 : ball.y - r > WORLD_H) {
      if (ball.temp) {
        ball.dead = true;
      } else {
        if (RULES.returnAtBottomEdge) ball.y = WORLD_H - r;
        ball.state = 'return';
      }
    }
  }

  private onWall(ball: Ball, back: boolean) {
    ball.bounces++;
    ball.hitWall = true;
    ball.pierceUntilWall = false;
    if (back) {
      ball.hitBack = true;
      ball.pierceUntilBack = false;
    }
    this.minVertical(ball);
    for (const part of ball.parts) {
      part.def.onWall?.(this, ball, part.lv, back);
      part.def.onBounce?.(this, ball, part.lv);
    }
    for (const ps of this.passives) {
      ps.def.onWall?.(this, ball, ps.lv, back);
      ps.def.onBounce?.(this, ball, ps.lv);
    }
    if (ball.dieOnWall) ball.dead = true;
  }

  private collideEnemies(ball: Ball) {
    const r = ball.r;
    for (const e of this.enemies) {
      if (e.dead) continue;
      // Bosses' colliders (orbiting shields) can lie outside their box, so test those individually.
      if (!e.colliders && (ball.x + r < e.x || ball.x - r > e.x + e.w || ball.y + r < e.y || ball.y - r > e.y + e.h)) continue;
      const colliders = e.colliders ?? [{ x: e.x, y: e.y, w: e.w, h: e.h, weak: true }];
      for (const c of colliders) {
        if (ball.x + r < c.x || ball.x - r > c.x + c.w || ball.y + r < c.y || ball.y - r > c.y + c.h) continue;
        const cx = clamp(ball.x, c.x, c.x + c.w);
        const cy = clamp(ball.y, c.y, c.y + c.h);
        let nx = ball.x - cx;
        let ny = ball.y - cy;
        const d2 = nx * nx + ny * ny;
        if (d2 > r * r) continue;
        // Still on its way through this enemy's body: no new contact until it is out (shields stay solid).
        if (c.weak && ball.hitCd.has(e)) {
          ball.hitCd.set(e, 0.35);
          continue;
        }
        ball.inVx = ball.vx;
        ball.inVy = ball.vy;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx /= d;
          ny /= d;
        } else {
          // Centre inside the box: leave through the nearest side.
          const pl = ball.x - c.x;
          const pr = c.x + c.w - ball.x;
          const pt = ball.y - c.y;
          const pb = c.y + c.h - ball.y;
          const m = Math.min(pl, pr, pt, pb);
          nx = m === pl ? -1 : m === pr ? 1 : 0;
          ny = m === pt ? -1 : m === pb ? 1 : 0;
          if (nx && ny) ny = 0;
        }
        const side = ny > 0.6 ? 'front' : ny < -0.6 ? 'back' : nx > 0 ? 'right' : 'left';
        const weak = c.weak && e.def.immuneSide !== side;
        if (weak && (ball.passThrough || ball.parts.some((pt) => pt.def.pierceSides?.includes(side)))) {
          ball.hitCd.set(e, 0.35);
          this.hitEnemy(ball, e, side);
          if (ball.destroysOnHit) {
            this.destroyBall(ball);
            return;
          }
          continue;
        }
        // Solid: push out and reflect.
        ball.x = cx + nx * (r + 0.5);
        ball.y = cy + ny * (r + 0.5);
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) {
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
        }
        this.minVertical(ball);
        ball.normalize();
        if (weak) {
          this.hitEnemy(ball, e, side);
          if (ball.destroysOnHit) {
            this.destroyBall(ball);
            return;
          }
        } else {
          this.events.push({ type: 'ting' });
          this.spark(ball.x, ball.y, '#d8d0b0', 3);
        }
        ball.bounces++;
        for (const part of ball.parts) part.def.onBounce?.(this, ball, part.lv);
        for (const ps of this.passives) ps.def.onBounce?.(this, ball, ps.lv);
        return;
      }
    }
  }

  private collideShots(ball: Ball) {
    for (const s of this.shots) {
      if (s.dead || !s.cancelable) continue;
      if ((s.x - ball.x) ** 2 + (s.y - ball.y) ** 2 < (s.r + ball.r) ** 2) {
        s.dead = true;
        this.spark(s.x, s.y, '#c9a0ff', 5);
      }
    }
  }

  // ---------------------------------------------------------------- damage

  /** Direct hit of a ball on an enemy. */
  hitEnemy(ball: Ball, e: Enemy, side: HitSide) {
    const st = this.stats;
    // Positional crit passives read this, so set it before anything else.
    this.lastHitSide = side;
    let dmg: number;
    if (ball.baby || !ball.parts.length) {
      dmg = this.roll(st.babyDamage) * st.babyDamageMul;
    } else {
      dmg = 0;
      for (const part of ball.parts) {
        const d = st.baseDamage * this.roll(part.def.hit) * CFG.levelDamage[part.lv - 1] * (part.def.dmgMul?.(part.lv) ?? 1);
        dmg = Math.max(dmg, d);
      }
    }
    for (const part of ball.parts) if (part.def.ballMul) dmg *= part.def.ballMul(this, ball, e, part.lv, side);
    dmg *= ball.dmgMul * ball.power;
    let crit = st.critChance;
    for (const ps of this.passives) {
      if (ps.def.hitMul) dmg *= ps.def.hitMul(this, ball, e, ps.lv);
      if (ps.def.critChance) crit = Math.max(crit, ps.def.critChance(this, ball, e, ps.lv));
    }
    if (this.char.id === 'repentant') dmg *= 1 + 0.05 * ball.bounces;
    const isCrit = this.rng.chance(crit);
    if (isCrit) {
      dmg *= CFG.critMul;
    }
    dmg += ball.nextHitBonus;
    ball.nextHitBonus = 0;
    dmg += e.bleed;
    if (dmg > 0) this.damage(e, dmg, ball.baby ? 'baby' : 'hit', isCrit);
    this.events.push({ type: 'hit' });
    if (e.curse) {
      e.curse.hits++;
      if (e.curse.hits >= e.curse.needed) {
        const c = e.curse;
        e.curse = null;
        this.ring(e.cx, e.cy, TILE * 0.8, '#b06cff', 0.35);
        if (this.hasPassive('voodoo') && !e.isBoss && this.rng.chance(0.1 + 0.05 * (this.passiveLv('voodoo') - 1))) {
          this.execute(e, '巫毒');
        } else this.damage(e, this.roll(c.dmg), 'status');
      }
    }
    if (e.dead && !ball.parts.length) return;
    for (const part of ball.parts) {
      part.def.onHit?.(this, ball, e, part.lv);
      if (ball.dead) break;
    }
    for (const ps of this.passives) ps.def.onHit?.(this, ball, e, ps.lv);
  }

  lastHitSide: HitSide = 'front';

  roll(r: Range) {
    return this.rng.range(r[0], r[1]);
  }

  /** Deals damage with all modifiers; returns the amount dealt. */
  damage(e: Enemy, amount: number, kind: DamageKind, crit = false, dot: 'frostburn' | 'other' = 'other') {
    if (e.dead || amount <= 0) return 0;
    let m = e.damageTakenMul(dot);
    if (kind === 'aoe') m *= this.stats.aoePower;
    else if (kind === 'status') m *= this.stats.statusPower;
    else if (kind === 'passive') m *= this.stats.passivePower;
    if (e.invulnerable) return 0;
    const dmg = Math.min(RULES.maxHitDamage, Math.max(1, Math.round(amount * m)));
    e.hp -= dmg;
    e.flash = 0.08;
    this.damageDealt += dmg;
    const color = crit
      ? '#ffe14a'
      : kind === 'status'
        ? '#ffb070'
        : kind === 'aoe'
          ? '#9fd8ff'
          : kind === 'baby'
            ? '#e8e8e8'
            : kind === 'minion'
              ? '#ff9ad0'
              : '#ffffff';
    this.text(e.cx + this.rng.range(-8, 8), e.y + 4, crit ? `${dmg}!` : `${dmg}`, color, crit ? 20 : kind === 'status' ? 13 : 16);
    if (e.hp <= 0) this.kill(e);
    return dmg;
  }

  /** Instant kill (Crown of Thorns, Reaper, Voodoo Doll): bypasses damage multipliers. */
  execute(e: Enemy, label = '') {
    if (e.dead || e.invulnerable) return;
    this.damageDealt += Math.max(0, e.hp);
    if (label) this.text(e.cx, e.cy - 10, label, '#e0e0e0', 16);
    e.hp = 0;
    this.kill(e);
  }

  kill(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.events.push({ type: 'kill' });
    this.duel?.onKill(e);
    this.burst(e.cx, e.cy, '#e8dcb0', e.isBoss ? 40 : 10);
    if (e.maggots) {
      const n = Math.round(this.roll(e.maggots));
      for (let i = 0; i < n; i++) this.spawnBaby(e.cx, e.cy);
    }
    if (e.dropsLoot) {
      this.drop('gem', e.cx, e.cy, e.def.xp);
      if (this.rng.chance(0.3)) this.drop('gold', e.cx + this.rng.range(-10, 10), e.cy, 1 + Math.floor(e.def.hpMul));
      if (this.rng.chance(0.025)) this.drop('potion', e.cx, e.cy + 8, 20);
      if (e.def.rank === 'miniboss' || this.rng.chance(0.004)) this.drop('reactor', e.cx, e.cy, 1);
    }
    for (const ps of this.passives) ps.def.onKill?.(this, e, ps.lv);
    this.stage.onKill(e);
  }

  /** Damage taken by source, for balancing (tools/sim.ts). */
  hurtBy: Record<string, number> = {};

  hurtPlayer(dmg: number, ranged: boolean, src = 'other') {
    const p = this.player;
    if (p.invuln > 0 || this.phase !== 'play') return;
    if (this.stats.dodge > 0 && this.rng.chance(this.stats.dodge)) {
      this.text(p.x, p.y - 20, '闪避', '#9fe8ff', 14);
      return;
    }
    for (const ps of this.passives) if (ps.def.onPlayerHit) dmg = ps.def.onPlayerHit(this, ps.lv, ranged, dmg);
    dmg *= this.stats.damageTaken;
    if (dmg <= 0) return;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    this.hurtBy[src] = (this.hurtBy[src] ?? 0) + dmg;
    p.invuln = CFG.invulnAfterHit;
    p.hurtFlash = 0.3;
    this.shake = Math.min(12, this.shake + 6);
    this.text(p.x, p.y - 24, `-${dmg}`, '#ff5050', 18);
    this.events.push({ type: 'hurt' });
  }

  heal(n: number) {
    const p = this.player;
    const goblet = this.passiveLv('everflowing');
    const over = goblet ? [0.2, 0.3, 0.4][goblet - 1] : 0;
    const room = Math.max(0, p.maxHp - p.hp);
    const cap = p.maxHp * RULES.overhealCap - p.hp;
    const healed = Math.min(Math.min(n, room) + Math.max(0, n - room) * over, Math.max(0, cap));
    if (healed <= 0) return;
    p.hp += healed;
    this.text(p.x, p.y - 24, `+${Math.round(healed)}`, '#6dff8a', 16);
    this.events.push({ type: 'heal' });
    for (const ps of this.passives) ps.def.onHeal?.(this, ps.lv);
  }

  gainXp(n: number) {
    this.xp += n;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.lvl++;
      this.xpNeeded = Math.round(CFG.xpFirst + CFG.xpStep * (this.lvl - 1));
      this.pendingLevelUps++;
    }
  }

  // ---------------------------------------------------------------- status helpers

  applyDot(
    e: Enemy,
    which: 'burn' | 'poison' | 'frostburn' | 'venom' | 'disease' | 'darkflame',
    stacks: number,
    max: number,
    dur: number,
    dmg: Range,
  ) {
    if (e.dead) return;
    const d: Dot = e[which];
    if (d.stacks <= 0) {
      d.tick = 1;
      d.max = 0;
      d.dmg = [0, 0];
    }
    d.max = Math.max(d.max, max);
    d.stacks = Math.min(d.max, d.stacks + stacks);
    d.timer = Math.max(d.timer, dur);
    if (dmg[0] + dmg[1] >= d.dmg[0] + d.dmg[1]) d.dmg = dmg;
  }

  applyBleed(e: Enemy, stacks: number, max: number) {
    e.bleedMax = Math.max(e.bleedMax, max);
    e.bleed = Math.min(e.bleedMax, e.bleed + stacks);
  }

  applyFreeze(e: Enemy, dur: number) {
    if (e.dead) return;
    const wasFrozen = e.freeze > 0;
    e.freeze = Math.max(e.freeze, e.isBoss ? dur * RULES.bossFreezeMul : dur);
    if (!wasFrozen) {
      const lv = this.passiveLv('frozenspike');
      if (lv)
        for (const o of this.enemiesInRadius(e.cx, e.cy, 1.5))
          if (o !== e) this.damage(o, this.roll([10, 20]) * (1 + 0.5 * (lv - 1)), 'passive');
    }
  }

  applySlow(e: Enemy, pct: number, dur: number) {
    e.slow = Math.max(e.slowTimer > 0 ? e.slow : 0, pct);
    e.slowTimer = Math.max(e.slowTimer, dur);
  }

  applyBlind(e: Enemy, dur: number) {
    e.blind = Math.max(e.blind, dur);
  }

  applyCurse(e: Enemy, needed: number, dmg: Range) {
    if (!e.curse) e.curse = { hits: 0, needed, dmg };
    else if (dmg[1] > e.curse.dmg[1]) e.curse.dmg = dmg;
  }

  applyRadiation(e: Enemy, max: number, dur: number, per: number) {
    e.radiationMax = Math.max(e.radiationMax, max);
    e.radiation = Math.min(e.radiationMax, e.radiation + 1);
    e.radiationTimer = Math.max(e.radiationTimer, dur);
    e.radiationPer = Math.max(e.radiationPer, per);
  }

  // ---------------------------------------------------------------- queries

  enemiesInRadius(x: number, y: number, tiles: number) {
    const r = tiles * TILE;
    return this.enemies.filter((e) => !e.dead && e.distToPoint(x, y) <= r);
  }

  /** Enemies in the n×n tiles around (x, y); an even-sized square extends half a tile further right and down. */
  enemiesInSquare(x: number, y: number, n: number) {
    const half = (n * TILE) / 2;
    const off = n % 2 === 0 ? TILE / 2 : 0;
    return this.enemies.filter(
      (e) => !e.dead && Math.abs(e.cx - x - off) <= half + e.w / 2 - TILE / 2 && Math.abs(e.cy - y - off) <= half + e.h / 2 - TILE / 2,
    );
  }

  enemiesInRow(y: number) {
    return this.enemies.filter((e) => !e.dead && y >= e.y - 2 && y <= e.y + e.h + 2 && e.y + e.h > 0);
  }

  enemiesInCol(x: number) {
    return this.enemies.filter((e) => !e.dead && x >= e.x - 2 && x <= e.x + e.w + 2 && e.y + e.h > 0);
  }

  nearestEnemies(x: number, y: number, n: number, exclude?: Set<Enemy>) {
    return this.enemies
      .filter((e) => !e.dead && e.y + e.h > 0 && !exclude?.has(e))
      .map((e) => ({ e, d: (e.cx - x) ** 2 + (e.cy - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((o) => o.e);
  }

  /** Enemies within halfWidth px of a ray starting at (x, y). */
  enemiesOnRay(x: number, y: number, angle: number, halfWidth: number) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    return this.enemies.filter((e) => {
      if (e.dead || e.y + e.h < 0) return false;
      const ex = e.cx - x;
      const ey = e.cy - y;
      const along = ex * dx + ey * dy;
      if (along < -e.w / 2) return false;
      const perp = Math.abs(ex * dy - ey * dx);
      return perp <= halfWidth + Math.max(e.w, e.h) / 2;
    });
  }

  /** Parts a spawned baby inherits from its parent (no spawners or self-destructors). */
  inheritParts(ball: Ball, selfId: string): Part[] {
    return ball.parts.filter((p) => p.def.id !== selfId && !p.def.spawner && !p.def.destroyOnHit);
  }

  randomEnemy() {
    const list = this.enemies.filter((e) => !e.dead && e.y + e.h > 0);
    return list.length ? this.rng.pick(list) : null;
  }

  visibleEnemies() {
    return this.enemies.filter((e) => !e.dead && e.y + e.h > 0);
  }

  // ---------------------------------------------------------------- area effects

  aoe(list: Enemy[], dmg: Range, kind: DamageKind = 'aoe', each?: (e: Enemy) => void) {
    for (const e of list) {
      this.damage(e, this.roll(dmg), kind);
      each?.(e);
    }
  }

  chainLightning(x: number, y: number, n: number, dmg: Range, from?: Enemy) {
    const targets = this.nearestEnemies(x, y, n, from ? undefined : undefined);
    let px = x;
    let py = y;
    for (const t of targets) {
      this.beam(px, py, t.cx, t.cy, '#bfe6ff', 2, 0.15, true);
      this.damage(t, this.roll(dmg), 'aoe');
      px = t.cx;
      py = t.cy;
    }
    this.events.push({ type: 'zap' });
  }

  explode(x: number, y: number, tiles: number, dmg: Range, color = '#ffb347') {
    this.ring(x, y, tiles * TILE, color, 0.35);
    this.burst(x, y, color, 16);
    this.shake = Math.min(10, this.shake + 3);
    this.events.push({ type: 'explode' });
    this.aoe(this.enemiesInRadius(x, y, tiles), dmg);
  }

  addZone(z: Omit<Zone, 'tick' | 'maxLife'> & { tick?: number }) {
    this.zones.push({ ...z, tick: z.tick ?? 0, maxLife: z.life });
  }

  addMinion(m: Omit<Minion, 'vx' | 'vy'>) {
    const a = this.rng.range(-Math.PI, 0);
    this.minions.push({ ...m, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 });
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemies(dt: number) {
    const scroll = this.stage.scrollPx;
    // Bottom-most first so blockers move before the enemies behind them.
    const list = this.enemies.filter((e) => !e.dead).sort((a, b) => b.y - a.y);
    for (const e of list) {
      e.flash = Math.max(0, e.flash - dt);
      this.tickStatuses(e, dt);
      if (e.dead) continue;
      this.shooter = e;
      if (e.def.rank !== 'normal') {
        this.stage.updateBoss(e, dt);
        this.shooter = null;
        continue;
      }
      // Movement with the scrolling floor, blocked by whoever is directly below.
      let vy = scroll * e.speedMul;
      if (e.def.ai === 'beast' && e.aiState === 1) vy += TILE * 3 * e.speedMul;
      let ny = e.y + vy * dt;
      for (const o of list) {
        if (o === e || o.dead || o.y <= e.y) continue;
        if (o.x + o.w <= e.x + 2 || o.x >= e.x + e.w - 2) continue;
        if (ny + e.h > o.y) ny = Math.max(e.y, o.y - e.h);
      }
      for (const a of this.allies) {
        if (a.dead || a.y <= e.y || a.x + a.w <= e.x + 2 || a.x >= e.x + e.w - 2) continue;
        if (ny + e.h > a.y) ny = Math.max(e.y, a.y - e.h);
      }
      e.y = ny;
      this.enemyAi(e, dt);
      this.shooter = null;
      if (e.y + e.h >= WORLD_H - 4) {
        // Reached the bottom: one last attack, then it's gone.
        e.dead = true;
        this.hurtPlayer(e.def.dmg * this.level.dmgMul * (1 - e.attackDown), false, 'bottom');
        this.burst(e.cx, WORLD_H - 8, '#c0b090', 8);
      }
    }
  }

  private enemyAi(e: Enemy, dt: number) {
    const p = this.player;
    if (e.frozen) {
      e.windup = 0;
      e.aiState = 0; // a frozen Beast stops its lunge
      return;
    }
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.shootCd -= dt;
    e.shake = Math.max(0, e.shake - dt);
    if (e.y + e.h < TILE * 0.5) return;
    const dist = e.distToPoint(p.x, p.y) - p.r;
    // Melee: telegraph, then strike if the player is still close.
    if (e.windup > 0) {
      e.windup -= dt;
      e.shake = 0.1;
      if (e.windup <= 0) {
        e.attackCd = CFG.meleeCooldown;
        if (dist < CFG.meleeRange * TILE * 1.4 && !(e.blind > 0 && this.rng.chance(0.5))) {
          this.lunge(e);
          this.hurtPlayer(e.def.dmg * this.level.dmgMul * (1 - e.attackDown), false, 'melee');
        }
      }
    } else if (e.attackCd <= 0 && dist < CFG.meleeRange * TILE) {
      e.windup = CFG.meleeWindup;
    }
    if (e.dead) return;
    switch (e.def.ai) {
      case 'archer':
        if (e.shootCd <= 0 && e.y > 0) {
          e.shootCd = this.rng.range(3.8, 5.5);
          const blindMiss = e.blind > 0 && this.rng.chance(0.5);
          const a = blindMiss ? this.rng.range(0.4, Math.PI - 0.4) : Math.atan2(p.y - e.cy, p.x - e.cx);
          this.fireShot(e.cx, e.cy + 6, a, 4.6, 6, 'arrow', true);
        }
        break;
      case 'bishop':
        // Support: periodically mends nearby skeletons (the only ranged regular here is the archer).
        if (e.shootCd <= 0 && e.y > 0) {
          e.shootCd = this.rng.range(4.5, 6);
          const near = this.enemiesInRadius(e.cx, e.cy, 1.6).filter((o) => o !== e && o.hp < o.maxHp && o.def.rank === 'normal');
          if (near.length) {
            this.ring(e.cx, e.cy, TILE * 1.6, '#c79aff', 0.45);
            for (const o of near) {
              const amt = Math.round(o.maxHp * 0.15);
              o.hp = Math.min(o.maxHp, o.hp + amt);
              this.text(o.cx, o.y, `+${amt}`, '#c79aff', 13);
            }
          }
        }
        break;
      case 'hurler':
        if (e.shootCd <= 0 && e.y > 0) {
          e.shootCd = this.rng.range(4, 6);
          const blindMiss = e.blind > 0 && this.rng.chance(0.5);
          const a = blindMiss ? this.rng.range(0.4, Math.PI - 0.4) : Math.atan2(p.y - e.cy, p.x - e.cx);
          const s = this.fireShot(e.cx, e.cy + 6, a, 4.2, 5, 'icicle', true);
          s.freeze = 0.8;
        }
        break;
      case 'beast':
        e.aiTimer -= dt;
        if (e.aiState === 1 && e.aiTimer <= 0) e.aiState = 0;
        if (e.aiState === 0 && e.aiTimer <= -this.rng.range(2.5, 4.5)) {
          e.aiState = 1;
          e.aiTimer = 0.3;
        }
        break;
      default:
        break;
    }
  }

  private lunge(e: Enemy) {
    this.burst(e.cx, e.y + e.h, '#ffd0a0', 6);
  }

  /** The enemy whose AI is running; its attack-down debuff applies to the shots it fires. */
  shooter: Enemy | null = null;

  fireShot(x: number, y: number, a: number, tilesPerSec: number, dmg: number, kind: Shot['kind'], cancelable: boolean) {
    const s: Shot = {
      x,
      y,
      vx: Math.cos(a) * tilesPerSec * TILE,
      vy: Math.sin(a) * tilesPerSec * TILE,
      r: kind === 'bigbone' ? 10 : kind === 'hand' || kind === 'shield' ? 22 : kind === 'orb' ? 8 : 6,
      dmg: dmg * this.level.dmgMul * (1 - (this.shooter?.attackDown ?? 0)),
      cancelable,
      kind,
      life: 12,
      homing: 0,
    };
    this.shots.push(s);
    return s;
  }

  private tickStatuses(e: Enemy, dt: number) {
    if (e.freeze > 0) e.freeze = Math.max(0, e.freeze - dt);
    if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);
    if (e.blind > 0) e.blind = Math.max(0, e.blind - dt);
    if (e.radiation > 0 && e.radiationTimer !== Infinity) {
      e.radiationTimer -= dt;
      if (e.radiationTimer <= 0) e.radiation = 0;
    }
    for (const k of ['burn', 'poison', 'frostburn', 'venom', 'disease', 'darkflame'] as const) {
      const d = e[k];
      if (d.stacks <= 0) continue;
      d.timer -= dt;
      d.tick -= dt;
      // Both timers count down together; the epsilon keeps rounding drift from dropping the last tick.
      if (d.tick <= 1e-6) {
        d.tick += 1;
        const amount = this.roll(d.dmg) * d.stacks;
        this.damage(e, amount, 'status', false, k === 'frostburn' ? 'frostburn' : 'other');
        this.spark(e.cx, e.cy, DOT_COLORS[k], 3);
        if (e.dead) return;
        if (k === 'disease') {
          for (const o of this.enemiesInRadius(e.cx, e.cy, 1.2)) {
            if (o !== e && o.disease.stacks === 0 && this.rng.chance(d.spread ?? 0.15)) {
              this.applyDot(o, 'disease', 1, d.max, 6, d.dmg);
              o.disease.spread = d.spread;
            }
          }
        }
      }
      if (d.timer <= 0) {
        if (k === 'darkflame') this.damage(e, this.roll([1, 100]), 'status');
        d.stacks = 0;
        if (e.dead) return;
      }
    }
    if (e.leech) {
      e.leech.tick -= dt;
      if (e.leech.tick <= 0) {
        e.leech.tick += 1;
        this.applyBleed(e, e.leech.rate, e.leech.max);
      }
    }
    if (e.rod) {
      e.rod.timer -= dt;
      if (e.rod.timer <= 0) {
        e.rod.timer += e.rod.interval;
        this.beam(e.cx, e.y - TILE * 3, e.cx, e.cy, '#fff6a0', 3, 0.15, true);
        this.chainLightning(e.cx, e.cy, e.rod.targets, e.rod.dmg);
      }
    }
  }

  // ---------------------------------------------------------------- shots, minions, zones, drops

  private updateShots(dt: number) {
    const p = this.player;
    for (const s of this.shots) {
      if (s.dead) continue;
      s.life -= dt;
      if (s.homing > 0) {
        s.homing -= dt;
        const a = Math.atan2(p.y - s.y, p.x - s.x);
        const sp = Math.hypot(s.vx, s.vy);
        const cur = Math.atan2(s.vy, s.vx);
        let da = a - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const na = cur + Math.max(-2 * dt, Math.min(2 * dt, da));
        s.vx = Math.cos(na) * sp;
        s.vy = Math.sin(na) * sp;
      }
      if (s.turnAt !== undefined) {
        s.turnAt -= dt;
        if (s.turnAt <= 0) {
          s.vx = -s.vx;
          s.vy = -s.vy;
          s.turnAt = undefined;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0 || s.y > WORLD_H + 30 || s.y < -60 || s.x < this.left - 60 || s.x > this.right + 60) {
        s.dead = true;
        continue;
      }
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < (s.r + p.r * 0.8) ** 2) {
        if (s.kind !== 'hand' && s.kind !== 'shield') s.dead = true;
        if (p.invuln <= 0 && s.freeze) {
          p.frozen = Math.max(p.frozen, s.freeze);
          this.ring(p.x, p.y, TILE * 0.6, '#bfe8ff', 0.3);
        }
        this.hurtPlayer(s.dmg, true, `shot:${s.kind}`);
      }
    }
  }

  private updateMinions(dt: number) {
    for (const m of this.minions) {
      if (m.dead) continue;
      m.life -= dt;
      if (m.life <= 0) {
        m.dead = true;
        continue;
      }
      if (!m.target || m.target.dead) m.target = this.randomEnemy();
      if (!m.target) {
        m.vy -= 300 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        continue;
      }
      const t = m.target;
      const dx = t.cx - m.x;
      const dy = t.cy - m.y;
      const d = Math.hypot(dx, dy);
      const sp = m.kind === 'firework' ? 560 : m.kind === 'arrow' ? 700 : 420;
      const steer = 8 * dt;
      m.vx += ((dx / d) * sp - m.vx) * steer;
      m.vy += ((dy / d) * sp - m.vy) * steer;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (d < Math.max(14, t.w * 0.4)) {
        m.dead = true;
        if (m.chain) {
          this.chainLightning(t.cx, t.cy, m.chain.n, m.chain.dmg);
        } else {
          this.damage(t, this.roll(m.dmg), 'minion');
          if (m.burn && !t.dead) this.applyDot(t, 'burn', 1, 3, 3, m.burn);
          if (t.dead && m.steal) this.heal(m.steal);
        }
        this.spark(t.cx, t.cy, m.kind === 'firework' ? '#ffcf5a' : m.kind === 'arrow' ? '#d8c8a0' : '#ff6a8a', 6);
      }
    }
  }

  private updateZones(dt: number) {
    const scroll = this.stage.floorScrollPx;
    for (const z of this.zones) {
      if (z.dead) continue;
      z.life -= dt;
      if (z.kind === 'lava' || z.kind === 'tar' || z.kind === 'spike') z.y += scroll * dt;
      if (z.life <= 0 || z.y - z.r > WORLD_H) {
        z.dead = true;
        continue;
      }
      if (z.aura) {
        z.auraTick = (z.auraTick ?? 0.5) - dt;
        if (z.auraTick <= 0) {
          z.auraTick += 1;
          for (const e of this.enemiesInRadius(z.x, z.y, 1)) this.damage(e, this.roll(z.aura), 'aoe');
        }
      }
      z.tick -= dt;
      if (z.tick > 0) continue;
      z.tick += z.interval;
      for (const e of this.enemiesInRadius(z.x, z.y, z.r / TILE)) {
        if (z.once) {
          if (z.once.has(e)) continue;
          z.once.add(e);
        }
        z.apply(this, e);
      }
    }
  }

  addAlly(kind: Ally['kind'], x: number, y: number, hp: number) {
    const heart = this.passiveLv('artificialheart');
    if (heart) hp *= 1 + [1, 1.5, 2][heart - 1];
    const w = TILE * 0.8;
    const dmg: Range =
      kind === 'bull' ? [24, 36] : kind === 'zombie' ? [14, 22] : kind === 'archer' || kind === 'healer' ? [8, 12] : [18, 28];
    this.allies.push({ kind, x: x - w / 2, y, w, h: w, hp, maxHp: hp, atkCd: 0.5, dmg, flash: 0, perk: 0 });
    this.ring(x, y + w / 2, TILE * 0.7, kind === 'zombie' ? '#7ad86a' : kind === 'bull' ? '#f0c040' : '#c4ccd6', 0.3);
  }

  private updateAllies(dt: number) {
    const scroll = this.stage.floorScrollPx;
    for (const a of this.allies) {
      if (a.dead) continue;
      a.flash = Math.max(0, a.flash - dt);
      a.atkCd -= dt;
      a.perk -= dt;
      if (a.perk <= 0) {
        if (a.kind === 'bull') {
          a.perk = 6; // 10 gold per minute
          this.gold++;
          this.text(a.x + a.w / 2, a.y - 4, '+1', '#f0c040', 12);
        } else if (a.kind === 'healer') {
          a.perk = 6; // 10 health per minute
          this.heal(1);
        } else if (a.kind === 'archer') {
          a.perk = 1.5;
          const t = this.randomEnemy();
          if (t)
            this.minions.push({ kind: 'arrow', x: a.x + a.w / 2, y: a.y, vx: 0, vy: -500, target: t, dmg: [10, 20], life: 3, steal: 0 });
        } else a.perk = 99;
      }
      // The first enemy directly above, if it is touching us.
      let blocker: Enemy | null = null;
      for (const e of this.enemies) {
        if (e.dead || e.x + e.w <= a.x + 2 || e.x >= a.x + a.w - 2) continue;
        if (e.y + e.h <= a.y + 2 && e.y + e.h >= a.y - 4 && (!blocker || e.y > blocker.y)) blocker = e;
      }
      if (blocker) {
        a.y += scroll * dt; // pushed back with the floor while fighting
        if (a.atkCd <= 0) {
          a.atkCd = 1;
          this.damage(blocker, this.roll(a.dmg), 'minion');
          if (!blocker.dead && !blocker.frozen) {
            a.hp -= blocker.def.dmg * (1 - blocker.attackDown);
            a.flash = 0.15;
          }
        }
      } else {
        a.y -= TILE * 1.1 * dt;
      }
      if (a.hp <= 0) {
        a.dead = true;
        this.burst(a.x + a.w / 2, a.y + a.h / 2, a.kind === 'soldier' ? '#9aa0a8' : '#6ab85a', 10);
      } else if (a.y + a.h < 0 || a.y > WORLD_H) a.dead = true;
    }
  }

  drop(kind: Drop['kind'], x: number, y: number, value: number) {
    this.drops.push({ kind, x, y, value, t: 0, pull: false });
  }

  private updateDrops(dt: number) {
    const p = this.player;
    const scroll = this.stage.floorScrollPx;
    const pr = (this.stats.pickupRadius * TILE + p.r) ** 2;
    for (const d of this.drops) {
      if (d.dead) continue;
      d.t += dt;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < pr) d.pull = true;
      if (d.pull) {
        const dist = Math.sqrt(d2) || 1;
        const sp = 520 * dt;
        if (dist < sp + p.r * 0.5) {
          this.collect(d);
          continue;
        }
        d.x += (dx / dist) * sp;
        d.y += (dy / dist) * sp;
      } else {
        d.y += scroll * dt;
        if (d.y > WORLD_H + 12) d.dead = true;
      }
    }
  }

  private collect(d: Drop) {
    d.dead = true;
    this.events.push({ type: 'pickup' });
    switch (d.kind) {
      case 'gem':
        this.gainXp(d.value);
        for (const ps of this.passives) ps.def.onGem?.(this, ps.lv);
        break;
      case 'gold':
        this.gold += d.value;
        break;
      case 'potion':
        this.heal(d.value);
        break;
      case 'reactor':
        this.pendingReactors++;
        break;
    }
  }

  // ---------------------------------------------------------------- fx

  text(x: number, y: number, text: string, color: string, size: number) {
    if (this.texts.length > 160) this.texts.shift();
    this.texts.push({ x, y, text, color, life: 0.7, size });
  }

  spark(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(40, 160);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3, max: 0.3, color, size: 3 });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(60, 260);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, color, size: 4 });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  beam(x1: number, y1: number, x2: number, y2: number, color: string, width: number, life: number, zigzag = false) {
    this.beams.push({ x1, y1, x2, y2, color, width, life, max: life, zigzag });
  }

  ring(x: number, y: number, r: number, color: string, life: number) {
    this.rings.push({ x, y, r, color, life, max: life });
  }

  private updateFx(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    this.shake = Math.max(0, this.shake - dt * 30);
  }
}
