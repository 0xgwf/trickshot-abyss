// Versus rules on top of one player's battle, after Tetris 99 and Puyo Puyo: kill streaks attack in chunks,
// the opponent's rows wait in a meter before they land, and attacking cancels what is waiting first.
// Pure game logic (no network), so tests and tools/versus-sim.ts run it headless.
import type { Battle } from './battle.ts';
import type { Enemy } from './enemy.ts';

/**
 * Versus tuning: seconds and rows. Tuned with tools/versus-sim.ts (40 bot matches per setting, 2026-10-22):
 * matches last about 5 minutes, most end with a player going down and about a fifth by clearing the level,
 * and a player who fires half as often loses about three in four.
 */
export const DUEL = {
  /** Versus levels are shorter: rows between checkpoints (solo: CFG.segmentRows). */
  segmentRows: 28,
  /**
   * Margin time, after Puyo Puyo: from this point of the match on, every step makes attacks bigger
   * (fractions carry over) and lands incoming rows sooner, so stalling doesn't pay.
   */
  marginStart: 150,
  marginStep: 40,
  marginAttack: 1.2,
  marginDelay: 0.3,
  minDelay: 1,
  /**
   * Floor speed-up per margin step. Off: it hurts whoever is ahead most (they face the denser rows), so the
   * player behind won more often in the simulations.
   */
  marginScroll: 0,
  /** A kill streak ends after this long without a kill, and then attacks. */
  streakGap: 2,
  /** Kills in one streak per row sent: a streak of 5 sends nothing, 12 sends 2. */
  killsPerRow: 6,
  /** Most rows one attack carries (a longer streak attacks as soon as it gets there). */
  maxAttack: 6,
  /** Most rows that can wait to land; the rest of an attack is lost. */
  maxPending: 12,
  /** Beating a miniboss sends this many rows at once. */
  minibossRows: 4,
  /** Incoming rows wait this long before they land: yellow, then red, then flashing. */
  delay: 3,
};

export interface Incoming {
  rows: number;
  /** The sender's progress (level row), which sets the garbage's HP. */
  hpRow: number;
  /** Seconds it has waited. */
  t: number;
}

export class Duel {
  readonly b: Battle;
  /** Kills in the current streak, and seconds since the last one. */
  streak = 0;
  private quiet = 0;
  private out = 0;
  private announced = 0;
  /** Attack rows owed below one whole row (margin time multiplies attacks). */
  private carry = 0;
  /** The opponent's attacks waiting to land, oldest first. */
  incoming: Incoming[] = [];
  delay = DUEL.delay;

  constructor(b: Battle) {
    this.b = b;
    b.duel = this;
    b.stage.segmentRows = DUEL.segmentRows;
  }

  /** Margin time step reached on the match clock: 0 until DUEL.marginStart, then 1, 2, … */
  get margin() {
    const t = this.b.t - DUEL.marginStart;
    return t < 0 ? 0 : 1 + Math.floor(t / DUEL.marginStep);
  }

  /** Rows waiting to land. */
  get pending() {
    return this.incoming.reduce((s, p) => s + p.rows, 0);
  }

  onKill(e: Enemy) {
    if (e.garbage) return;
    if (e.def.rank === 'miniboss') this.attack(DUEL.minibossRows);
    if (e.def.rank !== 'normal') return;
    this.streak++;
    this.quiet = 0;
    if (this.streak >= DUEL.killsPerRow * DUEL.maxAttack) this.endStreak();
  }

  update(dt: number) {
    const k = this.margin;
    if (k > this.announced) {
      this.announced = k;
      const b = this.b;
      b.text((b.left + b.right) / 2, b.player.y - 120, k === 1 ? '加压开始！' : `加压 ×${k}`, '#ff9a3a', 22);
    }
    this.b.stage.scrollMul = 1 + DUEL.marginScroll * k;
    this.delay = Math.max(DUEL.minDelay, DUEL.delay - DUEL.marginDelay * k);
    if (this.streak) {
      this.quiet += dt;
      if (this.quiet >= DUEL.streakGap) this.endStreak();
    }
    for (const p of this.incoming) p.t += dt;
    while (this.incoming.length && this.incoming[0].t >= this.delay) {
      const p = this.incoming.shift()!;
      this.b.stage.landGarbage(p.rows, p.hpRow);
    }
  }

  private endStreak() {
    const rows = Math.floor(this.streak / DUEL.killsPerRow);
    this.streak = 0;
    if (rows) this.attack(rows);
  }

  /** An attack cancels the rows waiting to land first (most urgent first); what's left goes to the opponent. */
  private attack(rows: number) {
    const total = rows * DUEL.marginAttack ** this.margin + this.carry;
    rows = Math.floor(total);
    this.carry = total - rows;
    let cancelled = 0;
    while (rows > 0 && this.incoming.length) {
      const p = this.incoming[0];
      const k = Math.min(rows, p.rows);
      p.rows -= k;
      rows -= k;
      cancelled += k;
      if (!p.rows) this.incoming.shift();
    }
    const p = this.b.player;
    if (cancelled) this.b.text(p.x, p.y - 64, `抵消 ${cancelled} 行`, '#7ad8ff', 17);
    this.out += rows;
  }

  /** How tough the rows this player sends are: their progress through the level. */
  get hpRow() {
    return this.b.stage.rows;
  }

  /** Rows to send to the opponent now, at most one attack's worth (the rest comes next time). */
  take() {
    const n = Math.min(this.out, DUEL.maxAttack);
    this.out -= n;
    return n;
  }

  /** The opponent's attack arrives and starts waiting; `hpRow` is their progress (default: ours). */
  receive(rows: number, hpRow = this.b.stage.rows) {
    const n = Math.min(Math.floor(rows), DUEL.maxAttack, DUEL.maxPending - this.pending);
    if (n > 0) this.incoming.push({ rows: n, hpRow, t: 0 });
  }

  /** How close a waiting attack is to landing: 0 (yellow) … 2 (flashing). */
  stage(p: Incoming) {
    const f = p.t / this.delay;
    return f < 0.5 ? 0 : f < 0.83 ? 1 : 2;
  }
}
