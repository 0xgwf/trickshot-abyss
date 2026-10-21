// Multiplayer plumbing: field snapshots survive a round trip (the WebSocket server is in ws.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { applySnapshot, takeSnapshot } from '../src/net/snapshot.ts';

test('a snapshot applied to a stand-in battle captures the same field', () => {
  for (const level of ['boneyard', 'snowy']) {
    const b = new Battle(CHARACTERS[0], 7, new Set(['boneyard', 'snowy']), level);
    b.addBody();
    simulate(b, 150);
    const snap = takeSnapshot(b);
    const ghost = new Battle(CHARACTERS[0], 1, new Set(), level);
    applySnapshot(ghost, JSON.parse(JSON.stringify(snap)));
    assert.deepEqual(takeSnapshot(ghost), snap, level);
    assert.ok(JSON.stringify(snap).length < 60_000, `snapshot is ${JSON.stringify(snap).length} bytes`);
  }
});
