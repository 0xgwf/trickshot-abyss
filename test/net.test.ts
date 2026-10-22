// Multiplayer plumbing: field snapshots survive a round trip (the WebSocket server is in ws.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { applySnapshot, takeSnapshot, type Snapshot } from '../src/net/snapshot.ts';

/** The drawn field, without the send time and entity ids (a stand-in battle's entities get new ids). */
const field = ({ at: _at, ids: _ids, ...rest }: Snapshot) => rest;

test('a snapshot applied to a stand-in battle captures the same field', () => {
  for (const level of ['boneyard', 'snowy']) {
    const b = new Battle(CHARACTERS[0], 7, new Set(['boneyard', 'snowy']), level);
    b.addBody();
    simulate(b, 150);
    const snap = takeSnapshot(b);
    const ghost = new Battle(CHARACTERS[0], 1, new Set(), level);
    applySnapshot(ghost, JSON.parse(JSON.stringify(snap)));
    assert.deepEqual(field(takeSnapshot(ghost)), field(snap), level);
    assert.ok(JSON.stringify(snap).length < 60_000, `snapshot is ${JSON.stringify(snap).length} bytes`);
  }
});
