// Small seeded PRNG (mulberry32) so runs can be reproduced.
export class Rng {
  private s: number;

  constructor(seed = Date.now()) {
    this.s = seed >>> 0;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number) {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number) {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Picks up to n distinct items, weighted. */
  pickWeighted<T>(items: readonly T[], weight: (t: T) => number, n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((s, t) => s + weight(t), 0);
      let r = this.next() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        r -= weight(pool[i]);
        if (r <= 0) break;
      }
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }
}
