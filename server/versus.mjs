// SPDX-License-Identifier: AGPL-3.0-or-later
// Versus room: a battle royale for 2–8 players, after Tetris 99. Players gather in a lobby; the first one in
// is the host, who can add computer players and starts the match. Everyone gets the same seed and level and
// plays in their own browser; the server relays the field snapshots, sends each attack to the attacker's
// target and keeps score (KOs, badges, places) with src/game/royale.ts. Computer players run here, on the
// same game code (like the co-op battle). Players who come in while a match is on start a new lobby.
import { autoDecide, autopilot } from '../src/game/autopilot.ts';
import { Battle } from '../src/game/battle.ts';
import { CHARACTERS } from '../src/game/data/characters.ts';
import { DUEL, Duel } from '../src/game/duel.ts';
import { ROYALE, Royale, STRATEGIES, badgeBoost, counterRows } from '../src/game/royale.ts';
import { takeSnapshot } from '../src/net/snapshot.ts';

const TICK = 1 / 60;
/** Seconds between score updates to the players. */
const STATUS_EVERY = 0.25;
/** Computer players: how much of the time they fire. */
export const BOT_SKILLS = [
  { zh: '简单', fire: 0.45 },
  { zh: '普通', fire: 0.7 },
  { zh: '困难', fire: 1 },
];
/** Both players get every ball and passive unlock, so the level-up pools match. */
const ALL_UNLOCKS = new Set(['boneyard', 'snowy']);

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
const int = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(x) || 0)));

let lobby = [];
/** Matches being played, for the lobby's "n playing" line. */
const matches = new Set();

const humans = (list) => list.filter((p) => p.conn);
const roster = (list) => list.map((p) => ({ name: p.name, char: p.char, bot: p.bot ? p.bot.zh : null }));

function sendLobby() {
  const playing = [...matches].reduce((n, m) => n + m.royale.alive.length, 0);
  humans(lobby).forEach((p, i) => p.conn.send({ t: 'lobby', players: roster(lobby), host: i === 0, max: ROYALE.maxPlayers, playing }));
}

/** Handles a connection whose first message was `{ t: 'join', mode: 'versus', name, char, level }`. */
export function joinVersus(conn, msg) {
  const me = {
    conn,
    name: clean(msg.name, 12) || '无名氏',
    char: clean(msg.char, 16),
    level: clean(msg.level, 16),
    bot: null,
    match: null,
    id: -1,
  };
  if (lobby.length >= ROYALE.maxPlayers) {
    // A full lobby: drop a computer player to make room, or start over in a new one.
    const bot = lobby.findLast((p) => p.bot);
    if (bot) lobby.splice(lobby.indexOf(bot), 1);
    else return conn.send({ t: 'full' });
  }
  lobby.push(me);
  sendLobby();
  conn.onMessage = (m) => {
    if (me.match) return me.match.onMessage(me, m);
    const host = humans(lobby)[0] === me;
    if (!host) return;
    if (m.t === 'bot' && m.add) {
      // One more, or as many as fit.
      const skill = BOT_SKILLS[int(m.skill, 0, BOT_SKILLS.length - 1)];
      do {
        if (lobby.length >= ROYALE.maxPlayers) break;
        const n = lobby.filter((p) => p.bot).length + 1;
        const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
        lobby.push({ conn: null, name: `电脑 ${n}`, char, level: '', bot: skill, match: null, id: -1 });
      } while (m.fill);
      sendLobby();
    } else if (m.t === 'bot' && !m.add) {
      const bot = lobby.findLast((p) => p.bot);
      if (bot) lobby.splice(lobby.indexOf(bot), 1);
      sendLobby();
    } else if (m.t === 'start' && lobby.length >= 2) {
      const players = lobby;
      lobby = [];
      new Match(players);
      sendLobby();
    }
  };
  conn.onClose = () => {
    if (me.match) return me.match.leave(me);
    lobby = lobby.filter((p) => p !== me);
    // Computer players don't wait in an empty lobby.
    if (!humans(lobby).length) lobby = [];
    sendLobby();
  };
}

class Match {
  constructor(players) {
    this.players = players;
    this.royale = new Royale(players.length);
    this.ticks = 0;
    this.statusT = 0;
    this.over = false;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const level = players.find((p) => p.conn)?.level || 'boneyard';
    // Small views of the field for royales: fewer, lighter snapshots.
    this.snapEvery = players.length > 2 ? 4 : 2;
    this.lite = players.length > 2;
    players.forEach((p, id) => {
      p.id = id;
      p.match = this;
      if (p.bot) {
        const char = CHARACTERS.find((c) => c.id === p.char) ?? CHARACTERS[0];
        const b = new Battle(char, seed, ALL_UNLOCKS, level);
        b.live = true;
        p.battle = b;
        p.duel = new Duel(b);
        this.royale.setStrategy(id, STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)].id);
      }
    });
    for (const p of humans(players))
      p.conn.send({ t: 'start', seed, level, you: p.id, players: roster(players), snapRate: 60 / this.snapEvery, lite: this.lite });
    matches.add(this);
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc = Math.min(acc + (now - last) / 1000, 0.25);
      last = now;
      while (acc >= TICK && !this.over) {
        acc -= TICK;
        this.tick();
      }
    }, 1000 / 60);
  }

  broadcast(msg, except = null) {
    for (const p of this.players) if (p.conn && p !== except) p.conn.send(msg);
  }

  onMessage(me, m) {
    if (this.over) return;
    const r = this.royale;
    const alive = r.members[me.id].alive;
    if (m.t === 'snap' && m.s && typeof m.s === 'object') {
      this.broadcast({ t: 'opp', id: me.id, s: m.s }, me);
      const s = m.s;
      const pending = Array.isArray(s.inc) ? s.inc.reduce((n, q) => n + (Number(q?.[0]) || 0), 0) : 0;
      r.report(me.id, Math.max(0, Number(s.hp) || 0) / Math.max(1, Number(s.maxHp) || 1), pending, Number(s.rows) || 0);
    } else if (m.t === 'attack' && alive) this.attack(me.id, int(m.n, 1, DUEL.maxAttack), int(m.r, 0, 100000));
    else if (m.t === 'target' && alive) {
      const s = STRATEGIES.find((x) => x.id === m.s);
      if (s) r.setStrategy(me.id, s.id);
      else if (m.id !== undefined) r.lockOn(me.id, int(m.id, 0, this.players.length - 1));
      this.status();
    } else if (m.t === 'over') this.out(me.id);
  }

  /** Sends an attack to the attacker's target; everyone sees it fly. */
  attack(from, n, row) {
    const to = this.royale.attack(from);
    if (to === null) return;
    const p = this.players[to];
    if (p.bot) p.duel.receive(n, row);
    this.broadcast({ t: 'hit', from, to, n, r: row });
  }

  out(id) {
    const ko = this.royale.out(id);
    if (!ko) return;
    this.broadcast({ t: 'ko', id, by: ko.by, place: ko.place });
    this.status();
    const w = this.royale.winner;
    if (w) {
      this.broadcast({ t: 'end', winner: w.id });
      this.stop();
    }
  }

  /** A player left: they are out, and the match ends when no person is left in it. */
  leave(me) {
    me.conn = null;
    if (this.over) return;
    this.out(me.id);
    if (!humans(this.players).length) this.stop();
  }

  stop() {
    this.over = true;
    clearInterval(this.timer);
    matches.delete(this);
    sendLobby();
  }

  /** Everyone's standing: [alive, place, badges, target, strategy, locked, knocked out by]. */
  status() {
    const p = this.royale.members.map((m) => [
      m.alive ? 1 : 0,
      m.place,
      m.badges,
      m.target ?? -1,
      STRATEGIES.findIndex((s) => s.id === m.strategy),
      m.lock !== null ? 1 : 0,
      m.by ?? -1,
    ]);
    this.broadcast({ t: 'status', p });
  }

  tick() {
    const r = this.royale;
    this.ticks++;
    r.update(TICK);
    for (const p of this.players) {
      if (!p.bot || !r.members[p.id].alive) continue;
      const b = p.battle;
      p.duel.boost = badgeBoost(r.members[p.id].badges);
      p.duel.counter = counterRows(r.attackers(p.id));
      autoDecide(b);
      const c = autopilot(b);
      if (p.bot.fire < 1) {
        b.autofire = false;
        c.fire = (this.ticks % 120) / 120 < p.bot.fire;
      }
      b.update(TICK, c);
      b.events.length = 0;
      r.report(p.id, b.player.hp / b.player.maxHp, p.duel.pending, b.stage.rows);
      const n = p.duel.take();
      if (n) this.attack(p.id, n, p.duel.hpRow);
      if (this.ticks % this.snapEvery === p.id % this.snapEvery || b.phase === 'lost') {
        const s = this.lite ? takeSnapshot(b, 40, false) : takeSnapshot(b);
        // Stamped with the tick clock: ticks can run in catch-up bursts, but the field moves with them.
        s.at = this.ticks * TICK;
        this.broadcast({ t: 'opp', id: p.id, s });
      }
      if (b.phase === 'lost') this.out(p.id);
      if (this.over) return;
    }
    this.statusT += TICK;
    if (this.statusT >= STATUS_EVERY) {
      this.statusT = 0;
      this.status();
    }
  }
}
