import { newOwnedBall, type OwnedBall } from './ball.ts';
import type { Battle, OwnedPassive } from './battle.ts';
import { CFG } from './config.ts';
import { BALLS, EVOLVED_BALLS, basePool } from './data/balls.ts';
import { EVOLVED_PASSIVES, PASSIVES, passivePool } from './data/passives.ts';
import type { BallDef, PassiveDef } from './types.ts';

export type Offer =
  | { kind: 'newBall'; def: BallDef }
  | { kind: 'upBall'; ob: OwnedBall }
  | { kind: 'newPassive'; def: PassiveDef }
  | { kind: 'upPassive'; p: OwnedPassive }
  | { kind: 'heal' };

export interface Evolution {
  type: 'ball' | 'passive';
  result: BallDef | PassiveDef;
  balls: OwnedBall[];
  passives: OwnedPassive[];
}

export type ReactorOption =
  { kind: 'fission' } | { kind: 'fusion'; pairs: [OwnedBall, OwnedBall][] } | { kind: 'evolve'; list: Evolution[] };

const single = (ob: OwnedBall) => (ob.fused ? null : ob.parts[0]);

// ------------------------------------------------------------------ level-ups

export function makeOffers(b: Battle): Offer[] {
  const cands: { o: Offer; w: number }[] = [];
  const ownedIds = new Set(b.owned.map((o) => single(o)?.def.id).filter(Boolean));
  if (b.owned.length < CFG.ballSlots) {
    for (const id of basePool(b.unlocks)) if (!ownedIds.has(id)) cands.push({ o: { kind: 'newBall', def: BALLS[id] }, w: 1 });
  }
  for (const ob of b.owned) {
    const p = single(ob);
    if (p && p.lv < 3) cands.push({ o: { kind: 'upBall', ob }, w: 2.2 });
  }
  if (b.passives.length < CFG.passiveSlots) {
    for (const id of passivePool(b.unlocks)) {
      const def = PASSIVES[id];
      if (b.hasPassive(id)) continue;
      if (def.requires && !def.requires(b)) continue;
      cands.push({ o: { kind: 'newPassive', def }, w: 0.75 });
    }
  }
  for (const p of b.passives) if (p.lv < 3) cands.push({ o: { kind: 'upPassive', p }, w: 1.6 });
  if (!cands.length) return [{ kind: 'heal' }];
  return b.rng.pickWeighted(cands, (c) => c.w, 3).map((c) => c.o);
}

export function applyOffer(b: Battle, o: Offer) {
  // Guard against a stale or double-applied choice.
  if (b.pendingLevelUps <= 0) return;
  switch (o.kind) {
    case 'newBall':
      b.addBall(o.def);
      break;
    case 'upBall':
      o.ob.parts[0].lv++;
      break;
    case 'newPassive':
      b.passives.push({ def: o.def, lv: 1 });
      break;
    case 'upPassive':
      o.p.lv++;
      break;
    case 'heal':
      b.heal(20);
      break;
  }
  b.pendingLevelUps--;
}

export function offerTitle(o: Offer) {
  switch (o.kind) {
    case 'newBall':
      return { name: o.def.zh, en: o.def.en, tag: '新弹珠', lv: 1, desc: o.def.desc(1), color: o.def.color, ball: true };
    case 'upBall': {
      const p = o.ob.parts[0];
      return {
        name: p.def.zh,
        en: p.def.en,
        tag: `升级 Lv${p.lv + 1}`,
        lv: p.lv + 1,
        desc: p.def.desc(p.lv + 1),
        color: p.def.color,
        ball: true,
      };
    }
    case 'newPassive':
      return { name: o.def.zh, en: o.def.en, tag: '新被动', lv: 1, desc: o.def.desc(1), color: '#e8c070', ball: false };
    case 'upPassive':
      return {
        name: o.p.def.zh,
        en: o.p.def.en,
        tag: `升级 Lv${o.p.lv + 1}`,
        lv: o.p.lv + 1,
        desc: o.p.def.desc(o.p.lv + 1),
        color: '#e8c070',
        ball: false,
      };
    case 'heal':
      return { name: '恢复', en: 'Heal', tag: '全部满级', lv: 0, desc: '回复 20 点生命', color: '#6dff8a', ball: false };
  }
}

// ------------------------------------------------------------------ fusion reactor

/** Assigns distinct owned items to every recipe slot (tiny backtracking search). */
function matchRecipe<T>(slots: string[][], items: T[], idOf: (t: T) => string | null): T[] | null {
  const used = new Set<T>();
  const out: T[] = [];
  const go = (i: number): boolean => {
    if (i === slots.length) return true;
    for (const it of items) {
      if (used.has(it)) continue;
      const id = idOf(it);
      if (!id || !slots[i].includes(id)) continue;
      used.add(it);
      out.push(it);
      if (go(i + 1)) return true;
      used.delete(it);
      out.pop();
    }
    return false;
  };
  return go(0) ? out : null;
}

export function findEvolutions(b: Battle): Evolution[] {
  const list: Evolution[] = [];
  const ready = b.owned.filter((o) => !o.fused && o.parts[0].lv >= 3);
  const ballId = (o: OwnedBall) => o.parts[0].def.id;
  for (const def of EVOLVED_BALLS) {
    for (const recipe of def.recipes ?? []) {
      const m = matchRecipe(recipe, ready, ballId);
      if (m) {
        list.push({ type: 'ball', result: def, balls: m, passives: [] });
        break;
      }
    }
  }
  const readyP = b.passives.filter((p) => p.lv >= 3);
  for (const def of EVOLVED_PASSIVES) {
    if (b.hasPassive(def.id)) continue;
    for (const recipe of def.recipes ?? []) {
      const m = matchRecipe(recipe, readyP, (p) => p.def.id);
      if (m) {
        list.push({ type: 'passive', result: def, balls: [], passives: m });
        break;
      }
    }
  }
  return list;
}

/** Two unfused L3 balls whose pair has no 2-ball evolution recipe. */
export function findFusions(b: Battle): [OwnedBall, OwnedBall][] {
  const ready = b.owned.filter((o) => !o.fused && o.parts[0].lv >= 3);
  const pairs: [OwnedBall, OwnedBall][] = [];
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      const a = ready[i].parts[0].def.id;
      const c = ready[j].parts[0].def.id;
      if (a === c) continue;
      const evolves = EVOLVED_BALLS.some((d) =>
        (d.recipes ?? []).some((r) => r.length === 2 && ((r[0].includes(a) && r[1].includes(c)) || (r[0].includes(c) && r[1].includes(a)))),
      );
      if (!evolves) pairs.push([ready[i], ready[j]]);
    }
  }
  return pairs;
}

export function makeReactorOptions(b: Battle): ReactorOption[] {
  const opts: ReactorOption[] = [{ kind: 'fission' }];
  const pairs = findFusions(b);
  if (pairs.length) opts.push({ kind: 'fusion', pairs });
  const evos = findEvolutions(b);
  if (evos.length) opts.push({ kind: 'evolve', list: evos });
  return opts;
}

/** Fission: a random number (1–5) of upgrade levels spread over balls and passives. */
export function applyFission(b: Battle): string[] {
  const n = b.rng.int(1, 5);
  const log: string[] = [];
  for (let i = 0; i < n; i++) {
    const ups: (() => string)[] = [];
    for (const ob of b.owned) {
      const p = single(ob);
      if (p && p.lv < 3) ups.push(() => (p.lv++, `${p.def.zh} → Lv${p.lv}`));
    }
    for (const p of b.passives) if (p.lv < 3) ups.push(() => (p.lv++, `${p.def.zh} → Lv${p.lv}`));
    if (!ups.length) {
      const g = 25 * (n - i);
      b.gold += g;
      log.push(`全部满级，获得 ${g} 金币`);
      break;
    }
    log.push(b.rng.pick(ups)());
  }
  b.pendingReactors--;
  return log;
}

export function applyFusion(b: Battle, a: OwnedBall, c: OwnedBall) {
  const idx = b.owned.indexOf(a);
  b.removeOwned(a);
  b.removeOwned(c);
  const fused = newOwnedBall([{ ...a.parts[0] }, { ...c.parts[0] }], true);
  b.owned.splice(Math.max(0, idx), 0, fused);
  b.queue.unshift(fused);
  b.pendingReactors--;
}

export function applyEvolution(b: Battle, evo: Evolution) {
  if (evo.type === 'ball') {
    const idx = Math.min(...evo.balls.map((o) => b.owned.indexOf(o)));
    for (const o of evo.balls) b.removeOwned(o);
    const ob = newOwnedBall([{ def: evo.result as BallDef, lv: 1 }]);
    b.owned.splice(Math.max(0, idx), 0, ob);
    b.queue.unshift(ob);
  } else {
    b.passives = b.passives.filter((p) => !evo.passives.includes(p));
    b.passives.push({ def: evo.result as PassiveDef, lv: 1 });
  }
  b.pendingReactors--;
}
