// Inventory and progression: starting loadout, ball cooldowns, XP, level-up offers, fusion and
// evolution recipes, and that a seed always plays out the same way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate } from '../src/game/autopilot.ts';
import { newOwnedBall } from '../src/game/ball.ts';
import { Battle } from '../src/game/battle.ts';
import { CFG } from '../src/game/config.ts';
import { BALLS, EVOLVED_BALLS, basePool } from '../src/game/data/balls.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { EVOLVED_PASSIVES, PASSIVES, passivePool } from '../src/game/data/passives.ts';
import { applyEvolution, findEvolutions, findFusions, makeOffers } from '../src/game/upgrades.ts';
import { arena, dummy, hit, wait } from './helpers.ts';

const UNLOCKS = new Set(['boneyard', 'snowy']);

/** Every way to fill a recipe's slots with balls/passives that exist. */
function fillings(recipe: string[][], exists: (id: string) => boolean): string[][] {
  return recipe.reduce<string[][]>((acc, slot) => acc.flatMap((ids) => slot.filter(exists).map((id) => [...ids, id])), [[]]);
}

test('a run starts with the character’s ball and LEA × 0.75 baby balls (none for the Empty Nester)', () => {
  for (const char of CHARACTERS) {
    const b = new Battle(char, 1, UNLOCKS);
    assert.deepEqual(
      b.owned.map((o) => o.parts[0].def.id),
      [char.startBall],
      char.id,
    );
    const babies = char.id === 'emptynester' ? 0 : Math.floor(char.stats.lea * CFG.babyCountPerLea);
    assert.equal(b.babies, babies, char.id);
    assert.equal(b.queue.filter((q) => q === 'baby').length, babies, char.id);
    assert.equal(b.player.hp, char.stats.end * CFG.hpPerEnd + CFG.hpFlat, char.id);
  }
});

test('a self-destructing ball comes back to the queue after its 3 s cooldown', () => {
  const b = arena();
  const ob = b.addBall(BALLS.dark);
  b.queue.length = 0;
  dummy(b, 1e9, 3.5); // straight above the player
  b.launch(ob, -Math.PI / 2);
  let t = 0;
  while (ob.state === 'flying' && t < 3) {
    wait(b, 0.05);
    t += 0.05;
  }
  assert.equal(ob.state, 'cooldown', 'destroyed on hit');
  assert.equal(b.balls.length, 0);
  wait(b, 2.9);
  assert.ok(!b.queue.includes(ob), 'still cooling down');
  wait(b, 0.15);
  assert.equal(ob.state, 'queued');
  assert.ok(b.queue.includes(ob));
});

test('XP: 6 for the first level-up, then 2.6 more per level', () => {
  const b = arena();
  b.gainXp(5);
  assert.equal(b.lvl, 1);
  b.gainXp(1);
  assert.deepEqual([b.lvl, b.xpNeeded, b.pendingLevelUps], [2, 9, 1]); // 6 + 2.6 = 8.6
  b.gainXp(9 + 11); // the next one needs 6 + 5.2 = 11.2
  assert.deepEqual([b.lvl, b.xp, b.pendingLevelUps], [4, 0, 3]);
});

test('level-ups offer up to 3 different choices, and only a heal once everything is full', () => {
  const b = arena();
  b.pendingLevelUps = 1;
  for (let i = 0; i < 50; i++) {
    const offers = makeOffers(b);
    assert.ok(offers.length >= 1 && offers.length <= 3);
    assert.equal(new Set(offers).size, offers.length);
  }
  for (const id of ['bleed', 'burn', 'freeze', 'iron']) b.addBall(BALLS[id], 3);
  b.passives = ['rattle', 'bandage', 'magnet', 'dumbbell'].map((id) => ({ def: PASSIVES[id], lv: 3 }));
  assert.deepEqual(makeOffers(b), [{ kind: 'heal' }]);
});

test('level-ups only offer unlocked balls and passives', () => {
  for (const unlocks of [new Set<string>(), new Set(['boneyard']), UNLOCKS]) {
    const balls = new Set(basePool(unlocks));
    const passives = new Set(passivePool(unlocks));
    const b = new Battle(CHARACTERS[0], 3, unlocks);
    b.pendingLevelUps = 1;
    for (let i = 0; i < 200; i++)
      for (const o of makeOffers(b)) {
        if (o.kind === 'newBall') assert.ok(balls.has(o.def.id), o.def.id);
        if (o.kind === 'newPassive') assert.ok(passives.has(o.def.id), o.def.id);
      }
  }
});

test('every evolved ball can be made from balls that exist, and the reactor offers it', () => {
  for (const def of EVOLVED_BALLS) {
    const ways = (def.recipes ?? []).flatMap((r) => fillings(r, (id) => id in BALLS));
    assert.ok(ways.length > 0, `${def.id} has no recipe made of existing balls`);
    for (const ids of ways) {
      const b = arena();
      for (const id of ids) b.addBall(BALLS[id], 3);
      const evo = findEvolutions(b).find((x) => x.result === def);
      assert.ok(evo, `${ids.join(' + ')} should offer ${def.id}`);
      b.pendingReactors = 1;
      applyEvolution(b, evo);
      assert.deepEqual(
        b.owned.map((o) => o.parts[0].def.id),
        [def.id],
        `${ids.join(' + ')} → ${def.id}`,
      );
      assert.equal(b.owned[0].parts[0].lv, 1);
      assert.ok(b.queue.includes(b.owned[0]));
    }
  }
});

test('ingredients below L3 do not evolve', () => {
  const b = arena();
  b.addBall(BALLS.burn, 3);
  b.addBall(BALLS.iron, 2);
  assert.ok(!findEvolutions(b).some((x) => x.result.id === 'bomb'));
});

test('two L3 balls that have an evolution are never offered as a plain fusion', () => {
  const pairs = new Set(
    EVOLVED_BALLS.flatMap((d) => (d.recipes ?? []).filter((r) => r.length === 2).flatMap((r) => fillings(r, (id) => id in BALLS))).flatMap(
      ([a, c]) => [`${a}+${c}`, `${c}+${a}`],
    ),
  );
  const base = basePool(UNLOCKS);
  for (let i = 0; i < base.length; i++)
    for (let j = i + 1; j < base.length; j++) {
      const b = arena();
      b.addBall(BALLS[base[i]], 3);
      b.addBall(BALLS[base[j]], 3);
      const fusable = findFusions(b).length > 0;
      assert.equal(fusable, !pairs.has(`${base[i]}+${base[j]}`), `${base[i]} + ${base[j]}`);
    }
});

test('every evolved passive is offered once its passives are at L3', () => {
  for (const def of EVOLVED_PASSIVES) {
    const ways = (def.recipes ?? []).flatMap((r) => fillings(r, (id) => id in PASSIVES));
    assert.ok(ways.length > 0, def.id);
    for (const ids of ways) {
      const b = arena();
      b.passives = ids.map((id) => ({ def: PASSIVES[id], lv: 3 }));
      const evo = findEvolutions(b).find((x) => x.result === def);
      assert.ok(evo, `${ids.join(' + ')} should offer ${def.id}`);
      b.pendingReactors = 1;
      applyEvolution(b, evo);
      assert.deepEqual(
        b.passives.map((p) => p.def.id),
        [def.id],
      );
    }
  }
});

test('a fused ball keeps both parts at their level and hits with both effects', () => {
  const b = arena();
  const ob = newOwnedBall(
    [
      { def: BALLS.burn, lv: 3 },
      { def: BALLS.poison, lv: 3 },
    ],
    true,
  );
  const flying = b.spawnBall({ parts: ob.parts, owned: null, baby: false, x: 300, y: 400, angle: -1, temp: true });
  const e = dummy(b);
  hit(b, flying, e);
  assert.equal(e.burn.stacks, 1);
  assert.equal(e.poison.stacks, 1);
  assert.equal(e.burn.max, 5);
  assert.equal(e.poison.max, 8);
});

test('the same seed plays out the same way', () => {
  const play = () => {
    const b = new Battle(CHARACTERS[0], 42, UNLOCKS, 'snowy');
    simulate(b, 120);
    return [b.t, b.kills, b.damageDealt, b.player.hp, b.lvl, b.owned.map((o) => o.parts.map((p) => p.def.id + p.lv).join('x')).join()];
  };
  assert.deepEqual(play(), play());
});
