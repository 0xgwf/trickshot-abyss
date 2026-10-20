// Multiplayer plumbing: field snapshots survive a round trip, and the WebSocket frame code handles
// split, merged, large and masked frames.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { applySnapshot, takeSnapshot } from '../src/net/snapshot.ts';
// @ts-expect-error plain JS module without types
import { encodeFrame, frameParser } from '../server/ws.mjs';

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

test('the frame parser reassembles split and merged frames, large payloads and masks', () => {
  const mask = (frame: Buffer) => {
    // Turn a server frame into a client frame: set the mask bit and XOR the payload.
    const len7 = frame[1] & 0x7f;
    const off = len7 === 126 ? 4 : len7 === 127 ? 10 : 2;
    const key = Buffer.from([1, 2, 3, 4]);
    const payload = Buffer.from(frame.subarray(off));
    for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
    const head = Buffer.from(frame.subarray(0, off));
    head[1] |= 0x80;
    return Buffer.concat([head, key, payload]);
  };
  const got: string[] = [];
  const feed = frameParser((_fin: boolean, op: number, payload: Buffer) => op === 1 && got.push(payload.toString()));
  const msgs = ['hi', 'x'.repeat(300), 'y'.repeat(70_000)];
  const stream = Buffer.concat(msgs.map((m) => mask(encodeFrame(1, Buffer.from(m)))));
  for (let i = 0; i < stream.length; i += 777) feed(stream.subarray(i, i + 777));
  assert.deepEqual(got, msgs);
  assert.throws(() => frameParser(() => {})(encodeFrame(1, Buffer.from('no mask'))), /masked/);
});
