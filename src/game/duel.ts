// Versus rules on top of one player's battle, after Tetris 99 and Puyo Puyo: kill streaks attack in chunks,
// the opponent's rows wait in a meter before they land, and attacking cancels what is waiting first.
// Pure game logic (no network), so tests and tools/versus-sim.ts run it headless.
import type { Battle } from './battle.ts';
import type { Enemy } from './enemy.ts';

/** Versus tuning: seconds and rows. */
export const DUEL = {
  /** A kill streak ends after this long without a kill, and then attacks. */
  streakGap: 2,
  /** Kills in one streak per row sent: a streak of 4 sends nothing, 12 sends 2. */
  killsPerRow: 5,
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
  /** Seconds it has waited. */
  t: number;
}

export class Duel {
  readonly b: Battle;
  /** Kills in the current streak, and seconds since the last one. */
  streak = 0;
  private quiet = 0;
  private out = 0;
  /** The opponent's attacks waiting to land, oldest first. */
  incoming: Incoming[] = [];
  delay = DUEL.delay;

  constructor(b: Battle) {
    this.b = b;
    b.duel = this;
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
    if (this.streak) {
      this.quiet += dt;
      if (this.quiet >= DUEL.streakGap) this.endStreak();
    }
    for (const p of this.incoming) p.t += dt;
    while (this.incoming.length && this.incoming[0].t >= this.delay) this.b.stage.landGarbage(this.incoming.shift()!.rows);
  }

  private endStreak() {
    const rows = Math.floor(this.streak / DUEL.killsPerRow);
    this.streak = 0;
    if (rows) this.attack(rows);
  }

  /** An attack cancels the rows waiting to land first (most urgent first); what's left goes to the opponent. */
  private attack(rows: number) {
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

  /** Rows to send to the opponent now, at most one attack's worth (the rest comes next time). */
  take() {
    const n = Math.min(this.out, DUEL.maxAttack);
    this.out -= n;
    return n;
  }

  /** The opponent's attack arrives and starts waiting. */
  receive(rows: number) {
    const n = Math.min(Math.floor(rows), DUEL.maxAttack, DUEL.maxPending - this.pending);
    if (n > 0) this.incoming.push({ rows: n, t: 0 });
  }

  /** How close a waiting attack is to landing: 0 (yellow) … 2 (flashing). */
  stage(p: Incoming) {
    const f = p.t / this.delay;
    return f < 0.5 ? 0 : f < 0.83 ? 1 : 2;
  }
}
