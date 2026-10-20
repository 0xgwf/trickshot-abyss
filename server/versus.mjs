// SPDX-License-Identifier: AGPL-3.0-or-later
// Versus matchmaking: pairs the first two players who join, gives them the same seed and level, and
// relays each one's field snapshots, attacks and result to the other. The game itself runs in the browsers.

let waiting = null;

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);

/** Handles a connection whose first message was `{ t: 'join', mode: 'versus', name, char, level }`. */
export function joinVersus(conn, msg) {
  const me = { conn, name: clean(msg.name, 12) || '无名氏', char: clean(msg.char, 16), level: clean(msg.level, 16), peer: null };
  if (!waiting || waiting.conn === conn) {
    waiting = me;
    conn.send({ t: 'wait' });
  } else {
    const other = waiting;
    waiting = null;
    me.peer = other;
    other.peer = me;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const level = other.level || 'boneyard';
    for (const [p, q] of [
      [me, other],
      [other, me],
    ])
      p.conn.send({ t: 'start', seed, level, opp: { name: q.name, char: q.char } });
  }
  conn.onMessage = (m) => {
    const peer = me.peer;
    if (!peer) return;
    if (m.t === 'snap') peer.conn.send({ t: 'opp', s: m.s });
    else if (m.t === 'attack') peer.conn.send({ t: 'garbage', n: Math.max(1, Math.min(4, Math.floor(Number(m.n) || 1))) });
    else if (m.t === 'over') peer.conn.send({ t: 'oppOver', won: !!m.won, progress: Number(m.progress) || 0, time: Number(m.time) || 0 });
  };
  conn.onClose = () => {
    if (waiting === me) waiting = null;
    me.peer?.conn.send({ t: 'oppLeft' });
    if (me.peer) me.peer.peer = null;
  };
}
