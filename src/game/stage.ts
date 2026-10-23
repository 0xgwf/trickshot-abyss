import type { Battle } from './battle.ts';
import { CFG, SEGMENT_COLS, TILE, WORLD_H, WORLD_W } from './config.ts';
import { ENEMIES } from './data/enemies.ts';
import type { LevelDef } from './data/levels.ts';
import { Enemy, type EnemyDef } from './enemy.ts';
import { Rng } from '../core/rng.ts';

type Cell = string | null;

export type StageState = 'rows' | 'miniboss' | 'bossIntro' | 'boss' | 'done';

export interface Warning {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  max: number;
  width: number;
}

interface KingState {
  attack: string;
  t: number;
  n: number;
  cd: number;
  sway: number;
  hasLeft: boolean;
  hasRight: boolean;
  phase2: boolean;
  handSide: -1 | 1 | 0;
  handTarget: { x: number; y: number } | null;
}

interface QueenState {
  attack: string;
  t: number;
  n: number;
  cd: number;
  sway: number;
  spin: number;
  phase2: boolean;
  /** Seconds left while the shields are out on a Shield Dash. */
  dashT: number;
  /** Seconds left while the shields form a wall below her. */
  wallT: number;
}

/** Enemies that balls can't hurt from the front (Icebound Shieldbearers). */
const shielded = (id: string) => ENEMIES[id].immuneSide === 'front';

const BOSS_Y = TILE * 1.6;
const QUEEN_Y = TILE * 2.2;
const ORBIT = TILE * 2.3;
const SHIELD = TILE * 0.9;
/** How fast landing garbage shoves the enemy rows down (px/s). */
const PUSH_SPEED = TILE * 12;

/** Drives one level: scrolling, row spawns, the two checkpoints and the boss fight. */
export class Stage {
  readonly b: Battle;
  segment = 0;
  rows = 0;
  segRows = 0;
  acc = 0;
  state: StageState = 'rows';
  boss: Enemy | null = null;
  miniboss: Enemy | null = null;
  pending: Cell[][] = [];
  scrollPx = CFG.scrollSpeed * TILE;
  floorScrollPx = CFG.scrollSpeed * TILE;
  /** Total floor distance scrolled (px), for the scrolling background. */
  floorY = 0;
  /** Versus: how much further landing garbage still shoves every enemy row down (px). */
  pushPx = 0;
  /** Rows between checkpoints (versus plays shorter levels). */
  segmentRows: number = CFG.segmentRows;
  /** Floor speed multiplier (versus speeds it up over the match). */
  scrollMul = 1;
  /**
   * Versus: the level never ends. After the boss the widest segment goes on, with the same checkpoints
   * again (two minibosses, then the boss), and the rows keep getting tougher.
   */
  endless = false;
  /** Times the boss was beaten in an endless level. */
  lap = 0;
  /** Checkpoints reached so far (0–2 per lap: two minibosses, then the boss). */
  private passed = 0;
  banner: { text: string; sub: string; t: number } | null;
  readonly level: LevelDef;
  warnings: Warning[] = [];
  private introT = 0;
  private winT = 0;
  private king: KingState | null = null;
  /**
   * The enemy rows come from their own random stream, so two runs with the same seed (versus) face the
   * same rows however differently they play.
   */
  private readonly rowRng: Rng;
  private queen: QueenState | null = null;

  constructor(b: Battle) {
    this.b = b;
    this.level = b.level;
    this.rowRng = new Rng((b.seed ^ 0x5bd1e995) >>> 0);
    this.banner = { text: this.level.zh, sub: this.level.en, t: 3 };
  }

  get cols() {
    return SEGMENT_COLS[this.segment];
  }

  /** 0..1 through the level (rows), for the progress bar. */
  get progress() {
    const total = this.segmentRows * 3;
    return Math.min(1, (this.segment * this.segmentRows + Math.min(this.segRows, this.segmentRows)) / total);
  }

  update(dt: number) {
    const b = this.b;
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
    for (const w of this.warnings) w.t -= dt;
    this.warnings = this.warnings.filter((w) => w.t > 0);

    const busy = b.enemies.some((e) => !e.dead && e.def.rank === 'normal' && e.y + e.h > TILE * 2.5);
    const speed = (this.state === 'rows' && !busy ? CFG.scrollSpeedEmpty : CFG.scrollSpeed) * this.scrollMul;
    this.scrollPx = speed * TILE;
    this.floorScrollPx = this.scrollPx;
    this.floorY += this.floorScrollPx * dt;
    if (this.pushPx > 0) {
      const move = Math.min(this.pushPx, PUSH_SPEED * dt);
      this.pushPx -= move;
      this.floorY += move;
      for (const e of b.enemies) if (!e.dead && e.def.rank === 'normal') e.y += move;
    }

    // New rows wait while garbage is being pushed in above the newest one.
    if (this.state === 'rows' && this.pushPx <= 0) {
      this.acc += this.scrollPx * dt;
      while (this.acc >= TILE) {
        this.acc -= TILE;
        this.spawnRow();
      }
      if (this.segRows >= this.segmentRows) this.checkpoint();
    } else if (this.state === 'bossIntro') {
      this.introT += dt;
      const cleared = !b.enemies.some((e) => !e.dead && e.y + e.h > 0);
      if (this.introT > 7 || (cleared && this.introT > 2.5)) this.spawnBoss();
    } else if (this.state === 'done') {
      this.winT -= dt;
      if (this.winT <= 0 && b.phase === 'play') {
        b.phase = 'won';
        b.events.push({ type: 'win' });
      }
    }
  }

  /** Debug/test helper: clears the field and jumps to the final checkpoint. */
  debugSkipToBoss() {
    for (const e of this.b.enemies) e.dead = true;
    this.segment = 2;
    this.rows = this.segmentRows * 3;
    this.segRows = this.segmentRows;
    this.passed = 2;
    const w = this.cols * TILE;
    this.b.targetLeft = this.b.left = (WORLD_W - w) / 2;
    this.b.targetRight = this.b.right = this.b.left + w;
    this.state = 'rows';
  }

  // ---------------------------------------------------------------- spawning

  /** HP for an enemy at a row of the level (by default the current one). */
  enemyHp(def: EnemyDef, row = this.rows) {
    return CFG.enemyBaseHp * this.level.hpMul * def.hpMul * (1 + CFG.enemyHpGrowthPerRow * row) * this.b.enemyHpMul;
  }

  spawn(def: EnemyDef, x: number, y: number, row = this.rows) {
    const e = new Enemy(def, x, y, Math.round(this.enemyHp(def, row)), row);
    e.shootCd = this.b.rng.range(1, 4);
    this.b.enemies.push(e);
    return e;
  }

  private occupied(x: number, y: number, w: number, h: number) {
    return this.b.enemies.some((e) => !e.dead && e.x < x + w - 2 && e.x + e.w > x + 2 && e.y < y + h - 2 && e.y + e.h > y + 2);
  }

  private spawnRow() {
    if (!this.pending.length) this.pending.push(...this.makeChunk());
    const row = this.pending.shift()!;
    const left = this.b.targetLeft;
    const y = -TILE + this.acc;
    row.forEach((id, i) => {
      if (!id) return;
      const x = left + i * TILE;
      if (this.occupied(x, y, TILE, TILE)) return;
      this.spawn(ENEMIES[id], x, y);
    });
    this.rows++;
    this.segRows++;
    for (const ps of this.b.passives) ps.def.onRow?.(this.b, ps.lv);
  }

  private pickType(noShields = false): string {
    const rng = this.rowRng;
    const w = { ...this.level.weights[this.segment] };
    // Ease in: no tough or shielded enemies in the first rows.
    const easeIn = this.segment === 0 && this.segRows < 10;
    for (const id of Object.keys(w))
      if (Object.keys(w).length > 1 && ((easeIn && ENEMIES[id].hpMul >= 2) || ((easeIn || noShields) && shielded(id)))) delete w[id];
    const ids = Object.keys(w);
    return rng.pickWeighted(ids, (id) => w[id], 1)[0];
  }

  /** Builds a formation chunk: clusters and blocks with gaps, like the original's rows. */
  private makeChunk(): Cell[][] {
    const rng = this.rowRng;
    const cols = this.cols;
    const t = this.segRows / this.segmentRows;
    const density = Math.min(0.8, 0.32 + 0.07 * this.segment + 0.14 * t);
    const empty = (): Cell[] => Array(cols).fill(null);
    const out: Cell[][] = [];
    const kinds = ['scatter', 'line', 'block', 'wall', 'pillars', 'checker', 'diagonal', 'gap'] as const;
    const weights: Record<(typeof kinds)[number], number> = {
      scatter: 30,
      line: 20,
      block: 14 + 6 * this.segment,
      wall: 2 + 4 * this.segment + 4 * t,
      pillars: 8,
      checker: 6,
      diagonal: 6,
      gap: 14 - 4 * this.segment,
    };
    const kind = rng.pickWeighted([...kinds], (k) => Math.max(0, weights[k]), 1)[0];
    switch (kind) {
      case 'gap':
        out.push(empty());
        break;
      case 'scatter': {
        const n = rng.int(2, 3);
        for (let r = 0; r < n; r++) out.push(empty().map(() => (rng.chance(density * 0.75) ? this.pickType() : null)));
        break;
      }
      case 'line': {
        const type = rng.chance(0.5) ? this.pickType() : null;
        // Long single-type lines of tough enemies are walls of HP; keep those short.
        const maxLen = type && ENEMIES[type].hpMul >= 3 ? 3 : cols - 1;
        const len = rng.int(2, maxLen);
        const start = rng.int(0, cols - len);
        out.push(empty().map((_, i) => (i >= start && i < start + len ? (type ?? this.pickType()) : null)));
        break;
      }
      case 'block': {
        const type = this.pickType();
        const tough = ENEMIES[type].hpMul >= 3;
        const w = rng.int(2, Math.min(tough ? 2 : 4, cols - 2));
        const h = rng.int(2, tough ? 2 : 3);
        const x0 = rng.int(0, cols - w);
        for (let r = 0; r < h; r++) out.push(empty().map((_, i) => (i >= x0 && i < x0 + w ? type : null)));
        break;
      }
      case 'wall': {
        const holes = new Set([rng.int(0, cols - 1), rng.int(0, cols - 1)]);
        out.push(empty().map((_, i) => (holes.has(i) ? null : this.pickType())));
        break;
      }
      case 'pillars': {
        const h = rng.int(2, 4);
        const n = rng.int(2, 3);
        const xs = new Set<number>();
        while (xs.size < n) xs.add(rng.int(0, cols - 1));
        const types = new Map([...xs].map((x) => [x, this.pickType()]));
        for (let r = 0; r < h; r++) out.push(empty().map((_, i) => types.get(i) ?? null));
        break;
      }
      case 'checker': {
        const h = rng.int(2, 3);
        for (let r = 0; r < h; r++) out.push(empty().map((_, i) => ((i + r) % 2 === 0 && rng.chance(0.85) ? this.pickType() : null)));
        break;
      }
      case 'diagonal': {
        const n = Math.min(cols, rng.int(3, 5));
        const dir = rng.chance(0.5) ? 1 : -1;
        const x0 = dir > 0 ? rng.int(0, cols - n) : rng.int(n - 1, cols - 1);
        const type = this.pickType();
        for (let r = 0; r < n; r++) out.push(empty().map((_, i) => (i === x0 + dir * r ? type : null)));
        break;
      }
    }
    // Balls bounce off shields, so a row of them walls off the corridor: at most a quarter of a row is shielded.
    const maxShields = Math.floor(cols / 4);
    for (const row of out) {
      let n = 0;
      row.forEach((id, i) => {
        if (id && shielded(id) && ++n > maxShields) row[i] = this.pickType(true);
      });
    }
    if (rng.chance(0.55 - 0.15 * this.segment)) out.push(empty());
    return out;
  }

  /**
   * Versus: `n` rows of this segment's basic enemy from the opponent land like Tetris garbage: they slot in
   * above the newest row and shove every enemy row `n` tiles closer to the player. One gap per row, in the
   * same column through the whole packet. They are extra (they don't count towards the checkpoint), they
   * land during miniboss and boss fights too, and they drop nothing. Their HP is that of row `row` (the
   * sender's progress: the further ahead the attacker, the tougher the garbage).
   */
  landGarbage(n: number, row = this.rows) {
    const b = this.b;
    const cols = this.cols;
    const def = ENEMIES[Object.keys(this.level.weights[this.segment])[0]];
    const hole = b.rng.int(0, cols - 1);
    // Above the newest row, or above garbage that is still being pushed in.
    const top = -TILE + this.acc - this.pushPx;
    const push = this.pushPx + n * TILE;
    const big = b.enemies.filter((e) => !e.dead && e.def.rank !== 'normal');
    for (let j = 0; j < n; j++) {
      const y = top - (j + 1) * TILE;
      for (let c = 0; c < cols; c++) {
        const x = b.targetLeft + c * TILE;
        // Skip the gap, and cells that would end up inside a miniboss or boss.
        if (c === hole || big.some((e) => e.x < x + TILE && e.x + e.w > x && e.y < y + push + TILE && e.y + e.h > y + push)) continue;
        const e = this.spawn(def, x, y, row);
        e.garbage = true;
        e.dropsLoot = false;
      }
    }
    this.pushPx = push;
    b.shake = Math.min(12, b.shake + 3 + n);
    b.text((b.left + b.right) / 2, TILE * 1.2, `对手送来 ${n} 行`, '#ff6a5a', 22);
    b.events.push({ type: 'explode' });
  }

  // ---------------------------------------------------------------- checkpoints

  private checkpoint() {
    this.pending = [];
    const step = this.passed++ % 3;
    if (step < 2) {
      const def = ENEMIES[this.level.minibosses[step]];
      const x = this.b.targetLeft + ((this.cols - def.w) / 2) * TILE;
      this.miniboss = this.spawn(def, Math.round(x / TILE) * TILE, -def.h * TILE);
      this.miniboss.aiTimer = 2;
      this.state = 'miniboss';
      this.banner = { text: def.zh, sub: def.en, t: 2.5 };
      this.b.events.push({ type: 'boss' });
    } else {
      this.state = 'bossIntro';
      this.introT = 0;
      const boss = ENEMIES[this.level.boss];
      this.banner = { text: `${boss.zh} 来袭`, sub: `${boss.en} approaches`, t: 3 };
      this.b.events.push({ type: 'boss' });
    }
  }

  private spawnBoss() {
    const def = ENEMIES[this.level.boss];
    const x = WORLD_W / 2 - (def.w * TILE) / 2;
    const e = this.spawn(def, x, -def.h * TILE);
    e.hp = e.maxHp = Math.round(this.enemyHp(def));
    e.invulnerable = true;
    e.dropsLoot = false;
    this.boss = e;
    this.state = 'boss';
    if (def.ai === 'queen') {
      this.queen = { attack: 'enter', t: 0, n: 0, cd: 1.5, sway: 0, spin: 0, phase2: false, dashT: 0, wallT: 0 };
      return;
    }
    this.king = {
      attack: 'enter',
      t: 0,
      n: 0,
      cd: 1.5,
      sway: 0,
      hasLeft: true,
      hasRight: true,
      phase2: false,
      handSide: 0,
      handTarget: null,
    };
  }

  onKill(e: Enemy) {
    const b = this.b;
    if (e === this.miniboss) {
      this.miniboss = null;
      this.segRows = 0;
      this.acc = 0;
      this.state = 'rows';
      if (this.segment === 2) {
        this.banner = { text: '继续下潜', sub: `深度 ${this.rows}`, t: 2.2 };
        return;
      }
      this.segment++;
      const w = this.cols * TILE;
      b.targetLeft = (WORLD_W - w) / 2;
      b.targetRight = b.targetLeft + w;
      this.banner = { text: '坑道拓宽了', sub: `第 ${this.segment + 1} 段`, t: 2.2 };
      b.events.push({ type: 'widen' });
    } else if (e === this.boss) {
      this.boss = null;
      if (this.endless) {
        this.lap++;
        this.segRows = 0;
        this.acc = 0;
        this.state = 'rows';
        this.banner = { text: '无尽深渊', sub: `第 ${this.lap + 1} 轮`, t: 2.5 };
      } else {
        this.state = 'done';
        this.winT = 2.5;
      }
      for (const o of b.enemies) if (!o.dead) o.dead = true;
      b.shots.length = 0;
      b.burst(e.cx, e.cy, '#ffe9a0', 80);
      b.shake = 14;
    }
  }

  // ---------------------------------------------------------------- bosses

  updateBoss(e: Enemy, dt: number) {
    if (e.def.ai === 'king') this.updateKing(e, dt);
    else if (e.def.ai === 'queen') this.updateQueen(e, dt);
    else this.updateMiniboss(e, dt);
  }

  /** Fan of freezing icicles (cancelable by balls). */
  private icicles(x: number, y: number, center: number, n: number, spread: number, speed: number, dmg: number, freeze: number) {
    for (let i = 0; i < n; i++) {
      const a = center + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
      const s = this.b.fireShot(x, y, a, speed, dmg, 'icicle', true);
      s.freeze = freeze;
    }
  }

  private warn(x1: number, y1: number, x2: number, y2: number, t: number, width = 8) {
    this.warnings.push({ x1, y1, x2, y2, t, max: t, width });
  }

  private aimAtPlayer(x: number, y: number) {
    const p = this.b.nearestBody(x, y);
    return Math.atan2(p.y - y, p.x - x);
  }

  private updateMiniboss(e: Enemy, dt: number) {
    const b = this.b;
    const hold = TILE * 2.2;
    if (e.y < hold) e.y = Math.min(hold, e.y + this.scrollPx * 2 * dt * e.speedMul);
    if (e.frozen) return;
    e.attackCd -= dt;
    e.aiTimer -= dt;
    if (e.y < 0) return;
    const p = b.player;
    // Big bodies also swat at a player who walks up to them.
    if (e.attackCd <= 0 && e.distToPoint(p.x, p.y) < CFG.meleeRange * TILE + p.r) {
      e.attackCd = 1.4;
      b.hurtPlayer(e.def.dmg * this.level.dmgMul * (1 - e.attackDown), false, 'boss-melee');
    }
    if (e.def.ai === 'brigade') {
      if (e.aiTimer <= 0) {
        e.aiTimer = 2.6;
        e.aiState = (e.aiState + 1) % 3;
        if (e.aiState === 2) {
          // Calls reinforcements into the row in front of it.
          for (let i = 0; i < 3; i++) {
            const x = e.x + i * TILE;
            const y = e.y + e.h + 2;
            if (!this.occupied(x, y, TILE, TILE)) this.spawn(ENEMIES[b.rng.chance(0.7) ? 'warrior' : 'archer'], x, y);
          }
        } else {
          const a = this.aimAtPlayer(e.cx, e.y + e.h);
          for (let i = -1; i <= 1; i++) b.fireShot(e.cx + i * 20, e.y + e.h, a + i * 0.22, 4.4, 8, 'arrow', true);
        }
      }
    } else if (e.def.ai === 'champion') {
      if (e.aiTimer <= 0) {
        e.aiTimer = 2.8;
        e.aiState = (e.aiState + 1) % 3;
        if (e.aiState === 2) {
          for (let i = 0; i < 3; i += 2) {
            const x = e.x + i * TILE;
            const y = e.y + e.h + 2;
            if (!this.occupied(x, y, TILE, TILE)) this.spawn(ENEMIES.shieldbearer, x, y);
          }
        } else this.icicles(e.cx, e.y + e.h, this.aimAtPlayer(e.cx, e.y + e.h), 5, 0.9, 4, 7, 0.5);
      }
    } else if (e.def.ai === 'howler') {
      if (e.aiTimer <= 0) {
        e.aiTimer = 2.2;
        e.aiState = (e.aiState + 1) % 3;
        if (e.aiState === 2) {
          e.shake = 0.5;
          this.icicles(e.cx, e.y + e.h, Math.PI / 2, 12, Math.PI - 0.5, 3.2, 7, 0.6);
        } else this.icicles(e.cx, e.y + e.h, this.aimAtPlayer(e.cx, e.y + e.h), 3, 0.3, 4.6, 7, 0.7);
      }
    } else {
      if (e.aiTimer <= 0) {
        e.aiState = (e.aiState + 1) % 3;
        if (e.aiState < 2) {
          e.aiTimer = 2.8;
          const a = this.aimAtPlayer(e.cx, e.y + e.h);
          const n = 7;
          for (let i = 0; i < n; i++) b.fireShot(e.cx, e.y + e.h, a + (i - (n - 1) / 2) * 0.17, 4.2, 7, 'arrow', true);
        } else {
          // Heavy bolt with a telegraph line.
          e.aiTimer = 3.2;
          const tx = p.x;
          const ty = p.y;
          const a = Math.atan2(ty - (e.y + e.h), tx - e.cx);
          const len = WORLD_H * 1.5;
          this.warn(e.cx, e.y + e.h, e.cx + Math.cos(a) * len, e.y + e.h + Math.sin(a) * len, 0.9, 14);
          e.windup = 0.9;
          e.aiAngle = a;
        }
      }
      if (e.windup > 0) {
        e.windup -= dt;
        e.shake = 0.1;
        if (e.windup <= 0) b.fireShot(e.cx, e.y + e.h, e.aiAngle, 11, 15, 'bigbone', false);
      }
    }
  }

  private kingColliders(e: Enemy, k: KingState) {
    const T = TILE;
    // Weak spots: the crown (from above) and the chin (from below, between the arms).
    const c = [
      { x: e.x + 1.4 * T, y: e.y, w: 2.2 * T, h: 0.7 * T, weak: true },
      { x: e.x + 0.9 * T, y: e.y + 0.7 * T, w: 3.2 * T, h: 1.9 * T, weak: false },
      { x: e.x + 1.4 * T, y: e.y + 2.6 * T, w: 2.2 * T, h: 0.6 * T, weak: true },
      { x: e.x + 0.9 * T, y: e.y + 2.6 * T, w: 0.5 * T, h: 0.6 * T, weak: false },
      { x: e.x + 3.6 * T, y: e.y + 2.6 * T, w: 0.5 * T, h: 0.6 * T, weak: false },
    ];
    const handAway = (side: number) => k.handSide === side && k.attack === 'hand' && k.n > 0;
    if (k.hasLeft) c.push({ x: e.x, y: e.y + 1.5 * T, w: 0.9 * T, h: (handAway(-1) ? 1.6 : 2.5) * T, weak: false });
    if (k.hasRight) c.push({ x: e.x + 4.1 * T, y: e.y + 1.5 * T, w: 0.9 * T, h: (handAway(1) ? 1.6 : 2.5) * T, weak: false });
    e.colliders = c;
  }

  private updateKing(e: Enemy, dt: number) {
    const b = this.b;
    const k = this.king!;
    this.kingColliders(e, k);
    if (k.attack === 'enter') {
      e.y = Math.min(BOSS_Y, e.y + TILE * 1.6 * dt);
      if (e.y >= BOSS_Y) {
        e.invulnerable = false;
        k.attack = 'idle';
        this.banner = { text: '骷髅王', sub: '弱点是王冠和下巴：打下巴，或把球弹到它头顶！', t: 3.5 };
      }
      return;
    }
    // Sway left and right.
    k.sway += dt * (e.frozen ? 0.2 : 1);
    const span = b.right - b.left - e.w - TILE * 1.4;
    e.x = b.left + TILE * 0.7 + (span * (1 + Math.sin(k.sway * 0.55))) / 2;

    if (!k.phase2 && e.hp < e.maxHp * 0.5) {
      k.phase2 = true;
      k.hasRight = false;
      b.burst(e.x + 4.5 * TILE, e.y + 3 * TILE, '#e8dcb0', 40);
      b.shake = 12;
      this.banner = { text: '骷髅王失去了一只手臂', sub: 'Phase 2', t: 2 };
    }
    if (e.frozen) return;

    k.cd -= dt;
    k.t -= dt;
    const mouthX = e.cx;
    const mouthY = e.y + 3.2 * TILE;
    const p = b.player;
    switch (k.attack) {
      case 'idle':
        if (k.cd <= 0) this.nextKingAttack(e, k);
        break;
      case 'spray':
        if (k.t <= 0) {
          const n = 6;
          const off = k.n % 2 ? 0.5 : 0;
          for (let i = 0; i < n; i++) {
            const a = Math.PI / 2 + ((i + off - (n - 1) / 2) / (n - 1)) * 1.8;
            b.fireShot(mouthX, mouthY, a, 3.4, 8, 'bone', true);
          }
          k.n--;
          k.t = 0.75;
          if (k.n <= 0) this.endKingAttack(k);
        }
        break;
      case 'burst':
        if (k.t <= 0) {
          const a = Math.atan2(p.y - mouthY, p.x - mouthX);
          for (let i = -1; i <= 1; i++) b.fireShot(mouthX, mouthY, a + i * 0.14, 5, 8, 'bone', true);
          k.n--;
          k.t = 0.4;
          if (k.n <= 0) this.endKingAttack(k);
        }
        break;
      case 'sweep':
        if (k.t <= 0) {
          const total = 22;
          const i = total - k.n;
          const ph = i / (total - 1);
          const a = Math.PI / 2 + Math.cos(ph * Math.PI * 2) * 1.0 * (i % 2 ? 1 : -1) * (ph < 0.5 ? 1 : -1);
          b.fireShot(mouthX, mouthY, a, 3.8, 8, 'bone', true);
          k.n--;
          k.t = 0.11;
          if (k.n <= 0) this.endKingAttack(k);
        }
        break;
      case 'hand': {
        if (k.n === 0) {
          // Telegraph, then throw.
          if (k.t <= 0) {
            const hx = e.x + (k.handSide < 0 ? 0.45 : 4.55) * TILE;
            const hy = e.y + 3.8 * TILE;
            const a = Math.atan2(k.handTarget!.y - hy, k.handTarget!.x - hx);
            const s = b.fireShot(hx, hy, a, 7, 12, 'hand', false);
            s.turnAt = 1.1;
            s.life = 2.3;
            k.n = 1;
            k.t = 2.3;
          }
        } else if (k.t <= 0) this.endKingAttack(k);
        break;
      }
      case 'summon':
        if (k.t <= 0) {
          const types = ['archer', 'warrior', 'archer', 'warrior'];
          for (let i = 0; i < 4; i++) {
            const x = b.left + TILE * (1 + b.rng.int(0, Math.floor((b.right - b.left) / TILE) - 3));
            const y = e.y + e.h + TILE * 0.2;
            if (!this.occupied(x, y, TILE, TILE)) {
              const m = this.spawn(ENEMIES[types[i]], x, y);
              m.dropsLoot = true;
            }
          }
          this.endKingAttack(k, 1.2);
        }
        break;
    }
  }

  /** Where the four ice shields are right now (orbit, wall, or away on a dash). */
  queenShields(e: Enemy) {
    const q = this.queen;
    if (!q || q.dashT > 0) return [];
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      if (q.wallT > 0) out.push({ x: e.cx + (i - 1.5) * SHIELD * 1.15 - SHIELD / 2, y: e.y + e.h + TILE * 0.35 });
      else {
        const a = q.spin + (i * Math.PI) / 2;
        out.push({ x: e.cx + Math.cos(a) * ORBIT - SHIELD / 2, y: e.cy + Math.sin(a) * ORBIT - SHIELD / 2 });
      }
    }
    return out;
  }

  private updateQueen(e: Enemy, dt: number) {
    const b = this.b;
    const q = this.queen!;
    q.spin += dt * (q.wallT > 0 ? 0 : q.phase2 ? 1.25 : 0.75) * (e.frozen ? 0.2 : 1);
    e.colliders = [
      { x: e.x, y: e.y, w: e.w, h: e.h, weak: true },
      ...this.queenShields(e).map((p) => ({ ...p, w: SHIELD, h: SHIELD, weak: false })),
    ];
    if (q.attack === 'enter') {
      e.y = Math.min(QUEEN_Y, e.y + TILE * 1.6 * dt);
      if (e.y >= QUEEN_Y) {
        e.invulnerable = false;
        q.attack = 'idle';
        this.banner = { text: '冰缚女王', sub: '冰盾挡在她四周：把球从顶端弹到她身后！', t: 3.5 };
      }
      return;
    }
    q.sway += dt * (e.frozen ? 0.2 : 1);
    const span = b.right - b.left - e.w - ORBIT * 2;
    e.x = b.left + ORBIT + (span * (1 + Math.sin(q.sway * 0.35))) / 2;
    q.dashT = Math.max(0, q.dashT - dt);
    q.wallT = Math.max(0, q.wallT - dt);
    if (!q.phase2 && e.hp < e.maxHp * 0.5) {
      q.phase2 = true;
      b.shake = 10;
      this.banner = { text: '冰缚女王发怒了', sub: 'Phase 2', t: 2 };
    }
    if (e.frozen) return;
    q.cd -= dt;
    q.t -= dt;
    const mx = e.cx;
    const my = e.y + e.h;
    switch (q.attack) {
      case 'idle':
        if (q.cd <= 0 && q.dashT <= 0) this.nextQueenAttack(e, q);
        else if (q.wallT > 0 && q.t <= 0) {
          q.t = 1.3;
          this.icicles(mx, my + SHIELD, this.aimAtPlayer(mx, my), 5, 0.8, 3.8, 6, 0.4);
        }
        break;
      case 'spray':
        if (q.t <= 0) {
          this.icicles(mx, my, Math.PI / 2 + (q.n % 2 ? 0.12 : -0.12), q.phase2 ? 9 : 7, 1.7, 3.6, 7, 0.5);
          q.n--;
          q.t = 0.7;
          if (q.n <= 0) this.endQueenAttack(q);
        }
        break;
      case 'dash':
        if (q.t <= 0) {
          const p = b.player;
          for (const sp of this.queenShields(e)) {
            const sx = sp.x + SHIELD / 2;
            const sy = sp.y + SHIELD / 2;
            const d = Math.hypot(p.x - sx, p.y - sy);
            const speed = 8.5;
            const s = b.fireShot(sx, sy, Math.atan2(p.y - sy, p.x - sx), speed, 10, 'shield', false);
            s.turnAt = Math.min(1.4, d / (speed * TILE));
            s.life = s.turnAt * 2 + 0.05;
            s.freeze = 1;
            q.dashT = Math.max(q.dashT, s.life);
          }
          this.endQueenAttack(q);
        }
        break;
      case 'summon':
        if (q.t <= 0) {
          for (let i = 0; i < 2; i++) {
            const x = b.left + TILE * (1 + b.rng.int(0, Math.floor((b.right - b.left) / TILE) - 3));
            const y = e.y + e.h + ORBIT;
            if (!this.occupied(x, y, TILE, TILE)) this.spawn(ENEMIES.hurler, x, y);
          }
          this.endQueenAttack(q, 0.8);
        }
        break;
    }
  }

  private nextQueenAttack(e: Enemy, q: QueenState) {
    const b = this.b;
    const minions = b.enemies.filter((o) => !o.dead && o.def.rank === 'normal').length;
    const opts: [string, number][] = [
      ['spray', 3],
      ['dash', q.phase2 ? 2.4 : 1.6],
      ['wall', q.wallT > 0 ? 0 : 1.2],
      ['summon', minions < 5 ? 1 : 0],
    ];
    const attack = b.rng.pickWeighted(opts, (o) => o[1], 1)[0][0];
    if (attack === 'wall') {
      q.wallT = 5;
      q.t = 0.6;
      q.cd = 5.5;
      return;
    }
    q.attack = attack;
    if (attack === 'spray') {
      q.n = q.phase2 ? 4 : 3;
      q.t = 0.4;
    } else if (attack === 'dash') {
      q.t = 0.9;
      const p = b.player;
      for (const sp of this.queenShields(e)) this.warn(sp.x + SHIELD / 2, sp.y + SHIELD / 2, p.x, p.y, 0.9, 30);
    } else {
      q.t = 0.6;
      e.shake = 0.6;
    }
  }

  private endQueenAttack(q: QueenState, extra = 0) {
    q.attack = 'idle';
    q.cd = (q.phase2 ? 1.3 : 1.9) + extra;
  }

  get queenState() {
    return this.queen;
  }

  private nextKingAttack(e: Enemy, k: KingState) {
    const b = this.b;
    const opts: [string, number][] = [
      ['spray', 3],
      ['burst', 2],
      ['sweep', 2],
      ['summon', b.enemies.filter((o) => !o.dead && o.def.rank === 'normal').length < 6 ? 1.2 : 0],
    ];
    if (k.hasLeft || k.hasRight) opts.push(['hand', 1.6]);
    const attack = b.rng.pickWeighted(opts, (o) => o[1], 1)[0][0];
    k.attack = attack;
    switch (attack) {
      case 'spray':
        k.n = k.phase2 ? 4 : 3;
        k.t = 0.4;
        break;
      case 'burst':
        k.n = k.phase2 ? 6 : 4;
        k.t = 0.3;
        break;
      case 'sweep':
        k.n = 22;
        k.t = 0.3;
        break;
      case 'hand': {
        const sides: (-1 | 1)[] = [];
        if (k.hasLeft) sides.push(-1);
        if (k.hasRight) sides.push(1);
        k.handSide = b.rng.pick(sides);
        k.n = 0;
        k.t = 0.85;
        const p = b.player;
        k.handTarget = { x: p.x, y: p.y };
        const hx = e.x + (k.handSide < 0 ? 0.45 : 4.55) * TILE;
        const hy = e.y + 3.8 * TILE;
        const a = Math.atan2(p.y - hy, p.x - hx);
        this.warn(hx, hy, hx + Math.cos(a) * WORLD_H, hy + Math.sin(a) * WORLD_H, 0.85, 40);
        break;
      }
      case 'summon':
        k.t = 0.6;
        e.shake = 0.6;
        break;
    }
  }

  private endKingAttack(k: KingState, extra = 0) {
    k.attack = 'idle';
    k.cd = (k.phase2 ? 1.4 : 2.0) + extra;
    k.handSide = 0;
  }

  /** Boss HP for the HUD (null outside the boss fight). */
  get bossBar() {
    const e = this.boss;
    if (!e || e.dead) return null;
    return { name: e.def.zh, en: e.def.en, frac: Math.max(0, e.hp / e.maxHp) };
  }

  get kingState() {
    return this.king;
  }
}
