// SPDX-License-Identifier: AGPL-3.0-or-later
// Co-op room: the server runs one shared battle (the same TypeScript game code the browsers use) at
// 60 Hz. Players send their controls and get field snapshots 30 times a second. The team shares HP,
// balls, XP and level-ups; level-up choices go round-robin, the Fusion Reactor resolves itself, and a
// player who drops out is taken over by the autopilot.
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { applyOffer } from '../src/game/upgrades.ts';
import { takeSnapshot } from '../src/net/snapshot.ts';

const TICK = 1 / 60;
const PICK_TIMEOUT = 20;
/** Enemy HP grows by this much per extra player. */
const HP_PER_PLAYER = 0.5;

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
const num = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));

let room = newRoom();

function newRoom() {
  return { players: [], battle: null, timer: null, chooser: 0, pickT: 0, ticks: 0, endT: 0, events: [] };
}

const names = () => room.players.map((p) => p.name);
const broadcast = (msg) => room.players.forEach((p) => p.conn.send(msg));

function lobby() {
  room.players.forEach((p, i) => p.conn.send({ t: 'lobby', names: names(), host: i === 0 }));
}

/** Handles a connection whose first message was `{ t: 'join', mode: 'coop', name, char, level }`. */
export function joinCoop(conn, msg) {
  if (room.battle) return conn.send({ t: 'busy' });
  const me = {
    conn,
    name: clean(msg.name, 12) || '无名氏',
    char: clean(msg.char, 16),
    level: clean(msg.level, 16),
    body: -1,
    ctl: null,
    left: false,
  };
  room.players.push(me);
  lobby();
  conn.onMessage = (m) => {
    const b = room.battle;
    if (m.t === 'start' && !b && room.players[0] === me) start();
    else if (m.t === 'in' && m.c)
      me.ctl = {
        moveX: num(m.c.moveX, -1.5, 1.5),
        moveY: num(m.c.moveY, -1.5, 1.5),
        aimX: num(m.c.aimX, -2000, 2000),
        aimY: num(m.c.aimY, -2000, 2000),
        fire: !!m.c.fire,
        recall: !!m.c.recall,
      };
    else if (m.t === 'pick' && b?.phase === 'levelup' && b.offers && me.body === room.chooser) pick(b, Number(m.i));
  };
  conn.onClose = () => {
    me.left = true;
    if (!room.battle) {
      room.players = room.players.filter((p) => p !== me);
      lobby();
    } else if (room.players.every((p) => p.left)) stop();
  };
}

function start() {
  const host = room.players[0];
  const char = CHARACTERS.find((c) => c.id === host.char) ?? CHARACTERS[0];
  const b = new Battle(char, Math.floor(Math.random() * 2 ** 31), new Set(['boneyard', 'snowy']), host.level || 'boneyard');
  room.players.forEach((p, i) => {
    if (i > 0) b.addBody();
    p.body = i;
  });
  b.enemyHpMul = 1 + HP_PER_PLAYER * (room.players.length - 1);
  room.battle = b;
  room.players.forEach((p) => p.conn.send({ t: 'start', you: p.body, names: names(), char: char.id, level: b.level.id }));
  let last = performance.now();
  let acc = 0;
  room.timer = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    while (acc >= TICK) {
      acc -= TICK;
      tick(b);
    }
  }, 1000 / 60);
}

function pick(b, i) {
  const offer = b.offers?.[i];
  if (!offer) return;
  applyOffer(b, offer);
  b.resume();
  room.chooser = (room.chooser + 1) % b.bodies.length;
  room.pickT = 0;
}

function tick(b) {
  room.ticks++;
  if (b.phase === 'levelup') {
    // A chooser who left, or takes too long, gets the autopilot's pick.
    room.pickT += TICK;
    const chooser = room.players.find((p) => p.body === room.chooser);
    if (!chooser || chooser.left || room.pickT > PICK_TIMEOUT) {
      autoDecide(b);
      room.chooser = (room.chooser + 1) % b.bodies.length;
      room.pickT = 0;
    }
  } else if (b.phase === 'reactor') autoDecide(b);
  const ctls = b.bodies.map((body, i) => {
    const p = room.players.find((q) => q.body === i);
    return p && !p.left && p.ctl ? p.ctl : autopilot(b, body);
  });
  b.update(TICK, ctls);
  // Sound cues since the last snapshot (at most a few of each kind).
  for (const e of b.events) if (room.events.filter((x) => x === e.type).length < 3) room.events.push(e.type);
  if (room.ticks % 2 === 0) {
    const offers =
      b.phase === 'levelup' && b.offers
        ? b.offers.map((o) =>
            o.kind === 'newBall' || o.kind === 'newPassive'
              ? { k: o.kind, id: o.def.id }
              : o.kind === 'upBall'
                ? { k: o.kind, i: b.owned.indexOf(o.ob) }
                : o.kind === 'upPassive'
                  ? { k: o.kind, i: b.passives.indexOf(o.p) }
                  : { k: 'heal' },
          )
        : null;
    broadcast({
      t: 'snap',
      s: takeSnapshot(b),
      offers,
      pending: b.pendingLevelUps,
      chooser: room.chooser,
      names: names(),
      events: room.events,
    });
    room.events = [];
  }
  if (b.phase === 'won' || b.phase === 'lost') {
    room.endT += TICK;
    if (room.endT > 1) stop();
  }
}

function stop() {
  clearInterval(room.timer);
  broadcast({ t: 'end' });
  room = newRoom();
}
