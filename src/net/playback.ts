// Smooth playback of a field simulated somewhere else. Snapshots arrive about 30 times a second and
// unevenly (Wi-Fi jitter), while the screen draws 60+ times a second, so drawing the newest one makes the
// field jump and stall. Instead the receiver plays the field back a little in the past, on the sender's
// clock, and blends the two snapshots around the playback time, matching entities by id. The delay
// follows how late snapshots have been arriving; when the next one is late, motion carries on briefly.
import type { EntityList, Snapshot } from './snapshot.ts';

const clock = () => performance.now() / 1000;
/** Recent snapshots used for the delay estimate (about 10 s), and the most kept for playback. */
const WINDOW = 300;
const KEEP = 90;
const MIN_DELAY = 0.05;
const MAX_DELAY = 0.4;
/** Lateness covered by the delay: a rare stall isn't worth a long delay, steady jitter is. */
const COVER = 0.95;
const MARGIN = 0.01;
/** The playback clock runs at 0.9–1.1× to catch up with its target, and jumps when far off. */
const EASE = 2;
const MAX_SKEW = 0.1;
const SNAP = 0.5;
/** The fastest-arrival estimate slowly forgets, so it follows a slower route (seconds per second). */
const FORGET = 0.005;
/** Keep moving this long past the newest snapshot before holding still. */
const MAX_EXTRAPOLATE = 0.1;
/** Nothing moves faster than this (world px/s); a bigger step between snapshots is a jump, not motion. */
const MAX_SPEED = 2500;

type Row = (number | string | number[])[];

/** Which tuple fields blend, per list (layouts in snapshot.ts): `xy` is x (y follows), `flat` a flat x,y trail. */
const SMOOTH: Record<EntityList, { xy?: number; more?: number[]; flat?: number }> = {
  enemies: { xy: 1 },
  balls: { xy: 0, flat: 6 },
  shots: { xy: 1 },
  zones: { more: [4] },
  drops: { xy: 1 },
  minions: { xy: 1 },
  allies: { xy: 1 },
  particles: { xy: 0, more: [4] },
  texts: { xy: 0, more: [4] },
  beams: { xy: 0, more: [2, 3, 6] },
  rings: { xy: 0, more: [2, 4] },
};
const LISTS = Object.keys(SMOOTH) as EntityList[];

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;
const lerpAngle = (a: number, b: number, w: number) => {
  const d = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * w;
};

const indexes = new WeakMap<number[], Map<number, number>>();
const indexOf = (ids: number[]) => {
  let m = indexes.get(ids);
  if (!m) indexes.set(ids, (m = new Map(ids.map((id, i) => [id, i]))));
  return m;
};

function blendRows(base: Row[], baseIds: number[], other: Row[], otherIds: number[], w: number, list: EntityList, reach: number) {
  const { xy, more = [], flat } = SMOOTH[list];
  const at = indexOf(otherIds);
  return base.map((row, i) => {
    const j = at.get(baseIds[i]);
    if (j === undefined) return row;
    const o = other[j];
    const out = row.slice();
    if (xy !== undefined) {
      const [x0, y0, x1, y1] = [row[xy], row[xy + 1], o[xy], o[xy + 1]] as number[];
      if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > reach) return row;
      out[xy] = lerp(x0, x1, w);
      out[xy + 1] = lerp(y0, y1, w);
    }
    for (const k of more) out[k] = lerp(row[k] as number, o[k] as number, w);
    if (flat !== undefined) {
      const [p, q] = [row[flat], o[flat]] as number[][];
      if (p.length === q.length) out[flat] = p.map((v, k) => lerp(v, q[k], w));
    }
    return out;
  });
}

/** A body: x, y, aim, then timers that don't need blending. */
const blendBody = (q: Snapshot['player'], o: Snapshot['player'], w: number): Snapshot['player'] => [
  lerp(q[0], o[0], w),
  lerp(q[1], o[1], w),
  lerpAngle(q[2], o[2], w),
  q[3],
  q[4],
  q[5],
];

/**
 * The field `w` of the way from `base` towards `other` (w < 0 extrapolates away from it). Entities are
 * the ones in `base`; the rest of the state (HUD, phase, banner) is `base`'s too.
 */
export function blend(base: Snapshot, other: Snapshot, w: number): Snapshot {
  const reach = MAX_SPEED * Math.abs(other.at - base.at) + 48;
  const out: Snapshot = {
    ...base,
    t: lerp(base.t, other.t, w),
    left: lerp(base.left, other.left, w),
    right: lerp(base.right, other.right, w),
    floorY: lerp(base.floorY, other.floorY, w),
    player: blendBody(base.player, other.player, w),
  };
  const rows = out as unknown as Record<EntityList, Row[]>;
  for (const list of LISTS)
    rows[list] = blendRows(
      base[list] as unknown as Row[],
      base.ids[list],
      other[list] as unknown as Row[],
      other.ids[list],
      w,
      list,
      reach,
    );
  return out;
}

/** The p-th fraction of a list of numbers (0 = smallest, 1 = largest). */
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};

export class Playback {
  private readonly buf: Snapshot[] = [];
  /** Sender clock minus local clock for the fastest-arriving snapshot lately. */
  private offset: number | null = null;
  /** How much later than that each recent snapshot arrived, and the gaps between them. */
  private readonly late: number[] = [];
  private readonly gaps: number[] = [];
  /** How far behind the newest snapshots playback aims to run. */
  delay = MIN_DELAY;
  /** Playback time on the sender's clock. */
  private play: number | null = null;
  private last: number | null = null;

  push(s: Snapshot, now = clock()) {
    const prev = this.buf.at(-1);
    if (prev && s.at <= prev.at) return;
    const lag = s.at - now;
    if (this.offset === null || lag > this.offset) this.offset = lag;
    const keep = (xs: number[], x: number) => xs.push(x) > WINDOW && xs.shift();
    keep(this.late, this.offset - lag);
    if (prev) keep(this.gaps, s.at - prev.at);
    // A snapshot can only be blended once the next one is in, so wait one gap plus the lateness.
    const gap = this.gaps.length ? quantile(this.gaps, 0.5) : 1 / 30;
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, gap + quantile(this.late, COVER) + MARGIN));
    this.buf.push(s);
    // A hidden tab stops drawing but keeps receiving.
    if (this.buf.length > KEEP) this.buf.shift();
  }

  /** The field to draw now, or null until the first snapshot. Call once per frame. */
  sample(now = clock()): Snapshot | null {
    const buf = this.buf;
    if (this.offset === null || !buf.length) return null;
    const dt = this.last === null ? 0 : Math.min(0.25, Math.max(0, now - this.last));
    this.last = now;
    this.offset -= FORGET * dt;
    const target = now + this.offset - this.delay;
    if (this.play === null || Math.abs(target - this.play) > SNAP) this.play = target;
    else this.play += dt * (1 + Math.max(-MAX_SKEW, Math.min(MAX_SKEW, (target - this.play) * EASE)));
    const t = this.play;
    while (buf.length > 2 && buf[1].at <= t) buf.shift();
    const [a, b] = buf;
    if (!b || t <= a.at) return a;
    const f = (t - a.at) / (b.at - a.at);
    if (f <= 1) return blend(a, b, f);
    // Ran past the newest snapshot: carry on along the last motion for a moment, then hold.
    return blend(b, a, 1 - Math.min(f, 1 + MAX_EXTRAPOLATE / (b.at - a.at)));
  }
}
