// Level generation: what the enemy rows may contain.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle } from '../src/game/battle.ts';
import { SEGMENT_COLS } from '../src/game/config.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { LEVELS } from '../src/game/data/levels.ts';

interface Row {
  segment: number;
  /** Row index within its segment. */
  index: number;
  shields: number;
}

/** Generates a whole level (minibosses die on arrival) and counts the shielded enemies in each row. */
function rowsOf(levelId: string, seed: number): Row[] {
  const b = new Battle(CHARACTERS[0], seed, new Set(['boneyard', 'snowy']), levelId);
  const st = b.stage;
  const rows = new Map<number, Row>();
  let segStart = 0;
  for (let guard = 0; st.state !== 'bossIntro' && guard < 10000; guard++) {
    st.update(0.25);
    for (const e of b.enemies) {
      if (e.def.rank !== 'normal') continue;
      const row = rows.get(e.row) ?? { segment: st.segment, index: e.row - segStart, shields: 0 };
      if (e.def.immuneSide === 'front') row.shields++;
      rows.set(e.row, row);
    }
    if (st.miniboss) {
      b.kill(st.miniboss);
      segStart = st.rows;
    }
    b.enemies = [];
  }
  assert.equal(st.state, 'bossIntro', 'the level reaches its boss');
  return [...rows.values()];
}

test('shielded enemies never wall off the corridor and stay out of the first 10 rows', () => {
  for (const level of LEVELS)
    for (let seed = 1; seed <= 150; seed++)
      for (const r of rowsOf(level.id, seed)) {
        const where = `${level.id} seed ${seed}, segment ${r.segment + 1} row ${r.index + 1}`;
        assert.ok(r.shields <= Math.floor(SEGMENT_COLS[r.segment] / 4), `${where}: ${r.shields} shields in one row`);
        if (r.segment === 0 && r.index < 10) assert.equal(r.shields, 0, `${where}: shields in the opening`);
      }
});

test('the second layer still has shielded enemies', () => {
  const shields = rowsOf('snowy', 1).reduce((n, r) => n + r.shields, 0);
  assert.ok(shields > 10, `${shields} in a whole level`);
});
