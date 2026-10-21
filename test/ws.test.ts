// The hand-rolled WebSocket server (server/ws.mjs): frames that arrive split, merged, large or
// unmasked, and peers that disappear without saying goodbye.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { test } from 'node:test';
// @ts-expect-error plain JS module without types
import { acceptWebSocket, encodeFrame, frameParser } from '../server/ws.mjs';

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

test('a peer that disappears without a close frame is noticed', async () => {
  const server = createServer();
  let closed = false;
  server.on('upgrade', (req, socket) => {
    const conn = acceptWebSocket(req, socket);
    if (conn) conn.onClose = () => (closed = true);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as { port: number };
  const s = connect(port, '127.0.0.1');
  s.write(
    'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
  );
  await new Promise((ok) => s.once('data', ok));
  s.end(); // FIN only, the way a crashed browser's socket goes away
  for (let i = 0; i < 50 && !closed; i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(closed, true);
  s.destroy();
  await new Promise((ok) => server.close(ok));
});
