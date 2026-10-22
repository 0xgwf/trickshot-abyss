// Versus rules on top of one player's battle: which kills attack the opponent, and how their attacks land.
// Pure game logic (no network), so tests and tools/versus-sim.ts run it headless.
import type { Battle } from './battle.ts';
import type { Enemy } from './enemy.ts';

/** Kills (not counting the opponent's rows) that send one row; beating a miniboss sends two. */
const KILLS_PER_ROW = 25;

export class Duel {
  readonly b: Battle;
  private kills = 0;
  private out = 0;

  constructor(b: Battle) {
    this.b = b;
    b.duel = this;
  }

  onKill(e: Enemy) {
    if (e.garbage) return;
    if (e.def.rank === 'miniboss') this.out += 2;
    else if (++this.kills % KILLS_PER_ROW === 0) this.out++;
  }

  update(_dt: number) {}

  /** Rows to send to the opponent now (and clears them). */
  take() {
    const n = this.out;
    this.out = 0;
    return n;
  }

  /** The opponent's attack arrives. */
  receive(n: number) {
    this.b.stage.landGarbage(n);
  }
}
