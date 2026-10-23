// Battle royale on top of the versus rules (duel.ts), after Tetris 99: up to 8 players, every attack goes to
// one opponent picked by the attacker's targeting strategy (or by hand), knocking a player out takes their
// badges and badges make attacks bigger, and being targeted by several players at once makes your attacks
// bigger too. The last player standing wins. Pure logic with no network: the server referees real matches
// with it, tools/royale-sim.ts bot matches.

export type Strategy = 'random' | 'counter' | 'ko' | 'badges';

/** The targeting strategies, in the order of the buttons (and the keys H J K L). */
export const STRATEGIES: { id: Strategy; zh: string; key: string; hint: string }[] = [
  { id: 'random', zh: '随机', key: 'KeyH', hint: '每隔几秒换一个对手' },
  { id: 'counter', zh: '反击', key: 'KeyJ', hint: '打正在打你的人' },
  { id: 'ko', zh: '追击', key: 'KeyK', hint: '打快要倒下的人' },
  { id: 'badges', zh: '夺徽', key: 'KeyL', hint: '打徽章最多的人' },
];

/** Battle royale tuning (tools/royale-sim.ts). */
export const ROYALE = {
  maxPlayers: 8,
  /** Seconds between target updates. */
  retarget: 0.5,
  /** The random strategy keeps a target this long. */
  randomHold: 5,
  /** Badge counts at which attacks grow by another `badgeBonus` (Tetris 99: +25% up to +100%). */
  badgeTiers: [1, 2, 4, 7],
  badgeBonus: 0.25,
  /** Extra rows per attack while targeted by 0, 1, 2, 3, 4+ players. */
  counterRows: [0, 0, 1, 2, 3],
  /** Chasing (追击) only switches to a player at least this much closer to going down. */
  koMargin: 0.05,
  /** Each row waiting to land counts as this much HP less when judging who is closest to going down. */
  pendingWeight: 0.04,
  /** Going for badges with none about switches only to a player at least this many rows deeper. */
  depthMargin: 5,
};

/** Attack multiplier for a badge count. */
export const badgeBoost = (badges: number) => 1 + ROYALE.badgeBonus * ROYALE.badgeTiers.filter((t) => badges >= t).length;

/** Extra rows per attack while targeted by this many players. */
export const counterRows = (attackers: number) => ROYALE.counterRows[Math.min(attackers, ROYALE.counterRows.length - 1)];

export interface Member {
  id: number;
  alive: boolean;
  /** Final place once out (1 = the winner), 0 while playing. */
  place: number;
  badges: number;
  strategy: Strategy;
  /** An opponent picked by hand; kept until they go down or a strategy is picked. */
  lock: number | null;
  target: number | null;
  /** From the latest snapshot: HP fraction, rows waiting to land and rows into the level. */
  hp: number;
  pending: number;
  depth: number;
  /** The last player who attacked them (they get the KO), and who did knock them out. */
  lastFrom: number | null;
  by: number | null;
  /** Seconds the random strategy keeps its target. */
  hold: number;
}

export class Royale {
  readonly members: Member[];
  private clock = 0;
  private readonly rand: () => number;

  constructor(players: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.members = Array.from({ length: players }, (_, id) => ({
      id,
      alive: true,
      place: 0,
      badges: 0,
      strategy: 'random' as Strategy,
      lock: null,
      target: null,
      hp: 1,
      pending: 0,
      depth: 0,
      lastFrom: null,
      by: null,
      hold: 0,
    }));
    for (const m of this.members) this.pick(m);
  }

  get alive() {
    return this.members.filter((m) => m.alive);
  }

  /** The winner, once only one player is left. */
  get winner() {
    const left = this.alive;
    return this.members.length > 1 && left.length === 1 ? left[0] : null;
  }

  setStrategy(id: number, s: Strategy) {
    const m = this.members[id];
    m.strategy = s;
    m.lock = null;
    m.hold = 0;
    this.pick(m);
  }

  /** Targets one opponent by hand. */
  lockOn(id: number, target: number) {
    const m = this.members[id];
    if (target === id || !this.members[target]?.alive) return;
    m.lock = m.target = target;
  }

  report(id: number, hp: number, pending: number, depth: number) {
    const m = this.members[id];
    m.hp = hp;
    m.pending = pending;
    m.depth = depth;
  }

  /** How many players target this one. */
  attackers(id: number) {
    return this.alive.filter((m) => m.id !== id && m.target === id).length;
  }

  update(dt: number) {
    for (const m of this.members) m.hold -= dt;
    this.clock += dt;
    if (this.clock < ROYALE.retarget) return;
    this.clock = 0;
    for (const m of this.alive) this.pick(m);
  }

  /** Routes an attack: returns who gets it (null if nobody is left to attack). */
  attack(from: number) {
    const m = this.members[from];
    if (!m.alive) return null;
    if (!this.valid(m, m.target)) this.pick(m);
    const to = m.target;
    if (to !== null) this.members[to].lastFrom = from;
    return to;
  }

  /**
   * A player is out (went down, gave up or left). The last player who attacked them gets the KO: one badge
   * plus all of theirs. Returns their place and who knocked them out, or null if they were already out.
   */
  out(id: number) {
    const m = this.members[id];
    if (!m.alive) return null;
    m.place = this.alive.length;
    m.alive = false;
    const k = m.lastFrom !== null && this.members[m.lastFrom].alive ? this.members[m.lastFrom] : null;
    if (k) {
      k.badges += 1 + m.badges;
      m.by = k.id;
    }
    for (const o of this.alive) if (o.target === id || o.lock === id) this.pick(o);
    const w = this.winner;
    if (w) w.place = 1;
    return { place: m.place, by: m.by };
  }

  private valid(m: Member, id: number | null): id is number {
    return id !== null && id !== m.id && this.members[id].alive;
  }

  /** How close a player is to going down (lower is closer). */
  private danger(m: Member) {
    return m.hp - ROYALE.pendingWeight * m.pending;
  }

  private pick(m: Member) {
    const others = this.alive.filter((o) => o !== m);
    if (!others.length) {
      m.target = null;
      return;
    }
    if (m.lock !== null) {
      if (this.valid(m, m.lock)) {
        m.target = m.lock;
        return;
      }
      m.lock = null;
    }
    const keep = this.valid(m, m.target) ? this.members[m.target] : null;
    const any = () => {
      const pool = others.length > 1 && keep ? others.filter((o) => o !== keep) : others;
      return pool[Math.floor(this.rand() * pool.length)];
    };
    const minBy = (list: Member[], f: (o: Member) => number) => list.reduce((a, o) => (f(o) < f(a) ? o : a));
    switch (m.strategy) {
      case 'random':
        if (!keep || m.hold <= 0) {
          m.target = any().id;
          m.hold = ROYALE.randomHold;
        }
        break;
      case 'counter': {
        // Hit back at whoever is attacking you (the one closest to going down first); otherwise keep the target.
        const at = others.filter((o) => o.target === m.id);
        if (at.length) {
          if (!keep || !at.includes(keep)) m.target = minBy(at, (o) => this.danger(o)).id;
        } else if (!keep) m.target = any().id;
        break;
      }
      case 'ko': {
        const best = minBy(others, (o) => this.danger(o));
        if (!keep || this.danger(best) < this.danger(keep) - ROYALE.koMargin) m.target = best.id;
        break;
      }
      case 'badges': {
        // The most badges; with no badges about, whoever is deepest into the level.
        const top = Math.max(...others.map((o) => o.badges));
        const pool = others.filter((o) => o.badges === top);
        const best = minBy(pool, (o) => -o.depth);
        if (!keep || !pool.includes(keep) || best.depth > keep.depth + ROYALE.depthMargin) m.target = best.id;
        break;
      }
    }
  }
}
