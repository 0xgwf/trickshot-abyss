// LAN versus: a battle royale for 2–8 players (rules: src/game/duel.ts and src/game/royale.ts; referee and
// computer players: server/versus.mjs). Everyone plays the same level (same seed, same enemy rows) on their
// own computer. Your field is on the left; the opponents' fields fill the right, played back smoothly from
// the snapshots their browsers (or the server) send. Kill streaks attack the opponent you target: pick a
// strategy (random, counter, chase, badges) or click a field. The last player standing wins.
import type { Input } from '../core/input.ts';
import { VIEW_H, VIEW_W } from '../core/view.ts';
import { Battle, type Controls } from '../game/battle.ts';
import { CFG, WORLD_H, WORLD_W } from '../game/config.ts';
import { CHARACTERS } from '../game/data/characters.ts';
import { DUEL, Duel } from '../game/duel.ts';
import { STRATEGIES, badgeBoost, counterRows } from '../game/royale.ts';
import type { CharacterDef } from '../game/types.ts';
import { offerTitle, type Offer } from '../game/upgrades.ts';
import { Playback } from '../net/playback.ts';
import { applySnapshot, takeSnapshot, type Snapshot } from '../net/snapshot.ts';
import { Socket } from '../net/socket.ts';
import { WorldRenderer } from '../render/world.ts';
import { C, FONT, KIND, ballIcon, button, hover, panel, passiveIcon, readable, text } from './draw.ts';
import { drawCrosshair } from './hud.ts';

const TOP = 40;
/** Your field is scaled to fill the left half of the screen below the status bar. */
export const SPLIT_SCALE = (VIEW_H - TOP) / WORLD_H;
const FIELD_W = WORLD_W * SPLIT_SCALE;
const FIELD_H = WORLD_H * SPLIT_SCALE;
const LEFT_X = (VIEW_W / 2 - FIELD_W) / 2;
const RIGHT_X = VIEW_W / 2 + LEFT_X;
/** The targeting buttons under the opponents' fields (three players or more). */
const BAR_H = 50;
/** Both players get every ball and passive unlock, so the level-up pools match. */
const ALL_UNLOCKS = new Set(['boneyard', 'snowy']);
/** Computer player levels, as server/versus.mjs has them. */
const BOT_SKILLS = ['简单', '普通', '困难'];
const HIT_TIME = 0.5;

interface Entry {
  name: string;
  char: string;
  /** A computer player's level, or null for a person. */
  bot: string | null;
}

/** An opponent's field, played back from their snapshots. */
interface Rival {
  id: number;
  name: string;
  ghost: Battle;
  play: Playback;
  world: WorldRenderer;
  seen: boolean;
}

/** Everyone's standing, from the server. */
interface Seat {
  alive: boolean;
  place: number;
  badges: number;
  target: number;
  strategy: number;
  locked: boolean;
  by: number;
}

interface Cell {
  x: number;
  y: number;
  s: number;
}

export class Versus {
  readonly socket: Socket;
  state: 'connecting' | 'lobby' | 'full' | 'playing' | 'closed' = 'connecting';
  battle: Battle | null = null;
  /** Versus rules for your run: attacks out, the opponents' rows in. */
  duel: Duel | null = null;
  private lobby: { players: Entry[]; host: boolean; max: number; playing: number } = { players: [], host: false, max: 8, playing: 0 };
  private botSkill = 1;
  /** Your number in the match, everyone in it, and the opponents' fields (null at your own number). */
  you = -1;
  private players: Entry[] = [];
  private rivals: (Rival | null)[] = [];
  private seats: Seat[] = [];
  private snapRate = 30;
  private lite = false;
  private snapT = 0;
  private sentOver = false;
  /** Attacks flying between fields, and knockout news. */
  private hits: { from: number; to: number; n: number; t: number }[] = [];
  private news: { text: string; color: string; size: number; t: number }[] = [];
  private winner = -1;
  /** Lost the connection to the server mid-match. */
  private dropped = false;
  /** After going down: the field shown big instead of yours, and whether the result covers it. */
  private watch = -1;
  private spectating = false;
  /** The Esc menu during a match. */
  private menu = false;
  private readonly world = new WorldRenderer();
  private readonly char: CharacterDef;
  readonly name: string;

  constructor(name: string, char: CharacterDef, level: string) {
    this.name = name;
    this.char = char;
    this.socket = new Socket({ t: 'join', mode: 'versus', name, char: char.id, level });
  }

  /** Handles the messages that arrived since the last frame. */
  poll() {
    for (const m of this.socket.drain()) {
      if (m.t === 'lobby' && this.state !== 'playing') {
        this.state = 'lobby';
        this.lobby = m as unknown as Versus['lobby'];
      } else if (m.t === 'full') this.state = 'full';
      else if (m.t === 'start') this.start(m);
      else if (m.t === 'opp') {
        const r = this.rivals[m.id as number];
        if (r) {
          r.play.push(m.s as Snapshot);
          r.seen = true;
        }
      } else if (m.t === 'hit') this.hit(m.from as number, m.to as number, m.n as number, m.r as number);
      else if (m.t === 'status')
        this.seats = (m.p as number[][]).map(([alive, place, badges, target, strategy, locked, by]) => ({
          alive: !!alive,
          place,
          badges,
          target,
          strategy,
          locked: !!locked,
          by,
        }));
      else if (m.t === 'ko') this.ko(m.id as number, m.by as number, m.place as number);
      else if (m.t === 'end') this.winner = m.winner as number;
    }
    if (this.socket.state === 'closed') {
      if (this.state !== 'playing') this.state = 'closed';
      else if (this.winner < 0) this.dropped = true;
    }
    for (const r of this.rivals) {
      const s = r?.play.sample();
      if (s) applySnapshot(r!.ghost, s);
    }
  }

  private start(m: Record<string, unknown>) {
    const seed = m.seed as number;
    const level = m.level as string;
    this.you = m.you as number;
    this.players = m.players as Entry[];
    this.snapRate = m.snapRate as number;
    this.lite = !!m.lite;
    this.battle = new Battle(this.char, seed, ALL_UNLOCKS, level);
    this.battle.live = true;
    this.duel = new Duel(this.battle);
    this.rivals = this.players.map((p, id) => {
      if (id === this.you) return null;
      const ghost = new Battle(CHARACTERS.find((c) => c.id === p.char) ?? CHARACTERS[0], seed, ALL_UNLOCKS, level);
      new Duel(ghost); // only drawn: shows their incoming meter and streak
      return { id, name: p.name, ghost, play: new Playback(), world: new WorldRenderer(), seen: false };
    });
    this.seats = this.players.map(() => ({ alive: true, place: 0, badges: 0, target: -1, strategy: 0, locked: false, by: -1 }));
    this.state = 'playing';
  }

  private nameOf(id: number) {
    return id === this.you ? '你' : (this.players[id]?.name ?? '?');
  }

  private hit(from: number, to: number, n: number, row: number) {
    this.hits.push({ from, to, n, t: 0 });
    const b = this.battle;
    if (!b) return;
    if (to === this.you) this.duel!.receive(n, row);
    if (from === this.you) b.text(b.player.x, b.player.y - 44, `送出 ${n} 行 → ${this.nameOf(to)}`, C.gold, 18);
  }

  private ko(id: number, by: number, place: number) {
    const seat = this.seats[id];
    if (seat) Object.assign(seat, { alive: false, place, by });
    if (id === this.you) return;
    const left = place - 1;
    if (by === this.you)
      this.news.push({ text: `你击倒了 ${this.nameOf(id)}！徽章 +${1 + (seat?.badges ?? 0)}`, color: C.gold, size: 22, t: 0 });
    else
      this.news.push({
        text: `${by >= 0 ? `${this.nameOf(by)} 击倒了 ${this.nameOf(id)}` : `${this.nameOf(id)} 倒下了`} · 剩 ${left} 人`,
        color: C.text,
        size: 16,
        t: 0,
      });
  }

  /** Players targeting this one. */
  private attackers(id: number) {
    return this.seats.filter((s, i) => i !== id && s.alive && s.target === id).length;
  }

  private get alive() {
    return this.seats.filter((s) => s.alive).length;
  }

  /** Maps mouse and keys to your field. */
  controls(i: Input, b: Battle): Controls {
    const joy = i.joyVector();
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0) + (joy?.x ?? 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) + (joy?.y ?? 0),
      aimX: (i.mouseX - LEFT_X) / SPLIT_SCALE,
      aimY: (i.mouseY - TOP) / SPLIT_SCALE,
      fire: (i.button(0) && i.mouseX < VIEW_W / 2) || i.isDown('Space'),
      recall: i.clicked(2) || (b.recallReady && i.wasPressed('KeyR')),
    };
  }

  /** Sends snapshots, attacks and your end after the local battle stepped. */
  afterUpdate(dt: number) {
    const b = this.battle;
    if (!b) return;
    const d = this.duel!;
    const me = this.seats[this.you];
    d.boost = badgeBoost(me?.badges ?? 0);
    d.counter = counterRows(this.attackers(this.you));
    for (const h of this.hits) h.t += dt;
    this.hits = this.hits.filter((h) => h.t < HIT_TIME + 0.25);
    for (const n of this.news) n.t += dt;
    this.news = this.news.filter((n) => n.t < 4);
    // Carry the remainder over so the rate holds at any frame rate; each snapshot is stamped with its time.
    this.snapT += dt;
    if (this.snapT >= 1 / this.snapRate && !this.sentOver) {
      this.snapT = Math.min(this.snapT - 1 / this.snapRate, 1 / this.snapRate);
      this.socket.send({ t: 'snap', s: this.lite ? takeSnapshot(b, 40, false) : takeSnapshot(b) });
    }
    const n = d.take();
    if (n) this.socket.send({ t: 'attack', n, r: d.hpRow });
    if (b.phase === 'lost' && !this.sentOver) {
      this.sentOver = true;
      this.socket.send({ t: 'snap', s: takeSnapshot(b, 40, false) });
      this.socket.send({ t: 'over' });
    }
  }

  // ---------------------------------------------------------------- layout

  /** Where each opponent's field goes: one beside yours, or a grid as big as fits above the targeting bar. */
  private cells(): Map<number, Cell> {
    const ids = this.rivals.flatMap((r) => (r ? [r.id] : []));
    const out = new Map<number, Cell>();
    if (ids.length === 1) {
      out.set(ids[0], { x: RIGHT_X, y: TOP, s: SPLIT_SCALE });
      return out;
    }
    const gap = 6;
    const W = VIEW_W / 2 - 8;
    const H = FIELD_H - BAR_H - 4;
    let best = { cols: 1, rows: 1, s: 0 };
    for (let cols = 1; cols <= ids.length; cols++) {
      const rows = Math.ceil(ids.length / cols);
      const s = Math.min((W - gap * (cols - 1)) / cols / WORLD_W, (H - gap * (rows - 1)) / rows / WORLD_H);
      if (s > best.s) best = { cols, rows, s };
    }
    const cw = WORLD_W * best.s;
    const ch = WORLD_H * best.s;
    const x0 = VIEW_W / 2 + 4 + (W - best.cols * cw - (best.cols - 1) * gap) / 2;
    const y0 = TOP + (H - best.rows * ch - (best.rows - 1) * gap) / 2;
    ids.forEach((id, i) =>
      out.set(id, { x: x0 + (i % best.cols) * (cw + gap), y: y0 + Math.floor(i / best.cols) * (ch + gap), s: best.s }),
    );
    return out;
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D, input: Input) {
    const b = this.battle!;
    ctx.fillStyle = '#0c0a0a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cells = this.cells();
    const many = cells.size > 1;
    const me = this.seats[this.you];
    /** Still in the match: you have a target and can pick another. */
    const live = !!me?.alive && b.phase === 'play' && this.winner < 0;

    // The opponents first (their canvases are reused if one of them is shown big).
    for (const [id, c] of cells) {
      const r = this.rivals[id]!;
      const seat = this.seats[id];
      const w = WORLD_W * c.s;
      const h = WORLD_H * c.s;
      if (r.seen) this.field(ctx, r.world, r.ghost, c.x, c.y, c.s, { texts: !many, banner: !many });
      else {
        ctx.fillStyle = '#151012';
        ctx.fillRect(c.x, c.y, w, h);
        text(ctx, '等待画面…', c.x + w / 2, c.y + h / 2, { size: many ? 14 : 22, align: 'center', color: C.dim });
      }
      if (many) this.label(ctx, r, c);
      // Who you target (orange), who targets you (red).
      const mine = live && me.target === id;
      const theirs = live && seat?.alive && seat.target === this.you;
      if (mine || theirs) {
        ctx.strokeStyle = mine ? '#ff9a3a' : '#ff4a3a';
        ctx.lineWidth = mine ? 4 : 2;
        ctx.strokeRect(c.x - 1, c.y - 1, w + 2, h + 2);
        if (mine && theirs) {
          ctx.strokeStyle = '#ff4a3a';
          ctx.lineWidth = 2;
          ctx.strokeRect(c.x + 4, c.y + 4, w - 8, h - 8);
        }
      }
      if (many && (mine || theirs)) {
        const tag = mine ? (me.locked ? '锁定' : '目标') : '';
        if (tag) text(ctx, tag, c.x + w - 6, c.y + h - 8, { size: 13, align: 'right', color: '#ff9a3a' });
        if (theirs) text(ctx, '在打你', c.x + 6, c.y + h - 8, { size: 13, color: '#ff6a5a' });
      }
      if (seat && !seat.alive) this.outShade(ctx, id, c.x, c.y, w, h, many);
      // Click a field to target that player (or, after going down, to watch them).
      if (many && hover(input, c.x, c.y, w, h) && input.clicked(0) && seat?.alive) {
        if (live) this.target({ id });
        else if (this.winner < 0) {
          this.watch = id;
          this.spectating = true;
        }
      }
    }

    // Your field, or the one you watch after going down.
    const watched = this.spectating ? this.rivals[this.watch] : null;
    if (watched?.seen) {
      this.field(ctx, watched.world, watched.ghost, LEFT_X, TOP, SPLIT_SCALE, { render: false, texts: false });
      text(ctx, `观战 · ${watched.name}`, LEFT_X + FIELD_W / 2, TOP + 26, { size: 18, align: 'center', color: C.gold });
      text(ctx, many ? '点右边的画面换人 · Esc 看结果' : 'Esc 看结果', LEFT_X + FIELD_W / 2, TOP + 48, {
        size: 14,
        align: 'center',
        color: C.dim,
      });
    } else this.field(ctx, this.world, b, LEFT_X, TOP, SPLIT_SCALE, { banner: !this.blocking });
    ctx.fillStyle = '#3a3028';
    ctx.fillRect(VIEW_W / 2 - 1, 0, 2, VIEW_H);

    // Status bars: yours, then the opponent's (one) or the match (several).
    this.status(ctx, b, `你 · ${this.name}`, me?.badges ?? 0, 12);
    const k = this.duel?.margin ?? 0;
    if (!many) {
      const [id] = cells.keys();
      const r = this.rivals[id]!;
      if (r.seen) this.status(ctx, r.ghost, `对手 · ${r.name}`, this.seats[id]?.badges ?? 0, VIEW_W / 2 + 12);
      else text(ctx, `对手 · ${r.name}`, VIEW_W / 2 + 12, 27, { size: 16, color: C.dim });
      if (k > 0) {
        panel(ctx, VIEW_W / 2 - 40, TOP + 4, 80, 24, false, 0.9);
        text(ctx, `加速 ×${k}`, VIEW_W / 2, TOP + 21, { size: 14, align: 'center', color: '#ff9a3a' });
      }
    } else {
      text(ctx, `剩 ${this.alive} / ${this.players.length} 人`, VIEW_W / 2 + 12, 26, { size: 18, color: C.text });
      if (k > 0) text(ctx, `加速 ×${k}`, VIEW_W / 2 + 150, 26, { size: 16, color: '#ff9a3a' });
      if (live && me.target >= 0)
        text(ctx, `目标 → ${this.nameOf(me.target)}${me.locked ? '（锁定）' : ''}`, VIEW_W - 12, 26, {
          size: 16,
          align: 'right',
          color: '#ff9a3a',
        });
      if (live) this.targeting(ctx, input);
      else if (this.winner < 0)
        text(ctx, '点画面观战', VIEW_W * 0.75, TOP + FIELD_H - BAR_H / 2 + 2, { size: 16, align: 'center', color: C.dim });
    }
    b.owned.forEach((ob, i) =>
      ballIcon(
        ctx,
        ob.parts,
        LEFT_X + 22 + i * 30,
        VIEW_H - 22,
        11,
        ob.parts.some((p) => p.def.evolved),
      ),
    );
    this.drawHits(ctx, cells);
    if (!this.blocking) this.drawNews(ctx);
    if (!this.blocking && !this.spectating) this.drawChoices(ctx, input, b);
    if (b.phase === 'play' && input.mouseX < VIEW_W / 2) drawCrosshair(ctx, b, input);
  }

  /** A field scaled to `s` at (x, y), with damage numbers, the banner, the boss bar and the versus meter. */
  private field(
    ctx: CanvasRenderingContext2D,
    world: WorldRenderer,
    b: Battle,
    x: number,
    y: number,
    s: number,
    o: { render?: boolean; texts?: boolean; banner?: boolean } = {},
  ) {
    const w = WORLD_W * s;
    const h = WORLD_H * s;
    /** Relative to the big view, for the overlays. */
    const k = s / SPLIT_SCALE;
    if (o.render !== false) world.draw(b);
    ctx.imageSmoothingEnabled = k < 0.6;
    ctx.drawImage(world.canvas, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
    if (o.texts !== false) {
      // Damage numbers stay inside the field (not over the status bar or the other half).
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      for (const t of b.texts) {
        ctx.globalAlpha = Math.min(1, t.life * 3);
        text(ctx, t.text, x + t.x * s, y + t.y * s, { size: Math.round(t.size * s), align: 'center', color: t.color });
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    const ban = b.stage.banner;
    if (ban && o.banner) text(ctx, ban.text, x + w / 2, y + h * 0.3, { size: 30, align: 'center', color: C.gold, lw: 8 });
    const boss = b.stage.bossBar;
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 40 * k, y + 10 * k + (k < 0.6 ? 20 : 0), w - 80 * k, Math.max(3, 12 * k));
      ctx.fillStyle = C.red;
      ctx.fillRect(x + 40 * k, y + 10 * k + (k < 0.6 ? 20 : 0), (w - 80 * k) * boss.frac, Math.max(3, 12 * k));
    }
    if (b.duel) this.duelInfo(ctx, b, x, y, s);
  }

  /** The incoming meter on the left cliff (one block per row, oldest at the bottom) and the kill streak. */
  private duelInfo(ctx: CanvasRenderingContext2D, b: Battle, x: number, y0: number, s: number) {
    const d = b.duel!;
    const k = s / SPLIT_SCALE;
    const flash = Math.floor(performance.now() / 120) % 2 === 0;
    let y = y0 + (FIELD_H - 70) * k;
    for (const p of d.incoming) {
      const stage = d.stage(p);
      ctx.fillStyle = stage === 0 ? '#ffd23a' : stage === 1 || flash ? '#ff4a3a' : '#ffffff';
      for (let i = 0; i < p.rows; i++) {
        y -= 20 * k;
        ctx.fillRect(x + 10 * k, y, Math.max(3, 14 * k), Math.max(2, 18 * k));
      }
    }
    if (k < 0.6) return;
    if (d.incoming.length) text(ctx, `来袭 ${d.pending}`, x + 8, y - 8, { size: 13, color: '#ff8a7a' });
    if (d.streak) {
      const rows = Math.floor(d.streak / DUEL.killsPerRow);
      const p = b.player;
      const label = rows ? `连杀 ${d.streak} · ${rows} 行` : `连杀 ${d.streak}`;
      text(ctx, label, x + p.x * s, y0 + (p.y + 40) * s, { size: 14, align: 'center', color: rows ? C.gold : C.dim });
    }
  }

  /** Name, badges and HP over a small field. */
  private label(ctx: CanvasRenderingContext2D, r: Rival, c: Cell) {
    const w = WORLD_W * c.s;
    const g = r.ghost;
    const seat = this.seats[r.id];
    ctx.fillStyle = 'rgba(8,6,8,0.72)';
    ctx.fillRect(c.x, c.y, w, 22);
    const bot = this.players[r.id]?.bot;
    text(ctx, `${r.name}${bot ? ` · ${bot}` : ''}`, c.x + 5, c.y + 15, { size: 13, color: C.text, lw: 3 });
    const info = `${seat?.badges ? `★${seat.badges} ` : ''}Lv${g.lvl}`;
    text(ctx, info, c.x + w - 5, c.y + 15, { size: 13, align: 'right', color: seat?.badges ? C.gold : C.dim, lw: 3 });
    const p = g.player;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(c.x, c.y + 20, w, 3);
    ctx.fillStyle = p.hp / p.maxHp > 0.3 ? C.green : C.red;
    ctx.fillRect(c.x, c.y + 20, w * Math.max(0, Math.min(1, p.hp / p.maxHp)), 3);
  }

  /** A knocked-out player's field: dimmed, with their place. */
  private outShade(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, w: number, h: number, many: boolean) {
    const seat = this.seats[id];
    ctx.fillStyle = 'rgba(6,4,6,0.66)';
    ctx.fillRect(x, y, w, h);
    const size = many ? 20 : 34;
    text(ctx, `第 ${seat.place} 名`, x + w / 2, y + h / 2, { size, align: 'center', color: C.text, lw: 6 });
    const by = seat.by >= 0 ? `被 ${this.nameOf(seat.by)} 击倒` : '倒下了';
    text(ctx, by, x + w / 2, y + h / 2 + size, { size: many ? 13 : 18, align: 'center', color: C.dim });
  }

  private status(ctx: CanvasRenderingContext2D, b: Battle, who: string, badges: number, x: number) {
    const w = VIEW_W / 2 - 24;
    text(ctx, `${who} · ${b.char.zh}`, x, 18, { size: 15, color: C.text });
    const info = `${badges ? `★${badges}  ` : ''}Lv${b.lvl}  击杀 ${b.kills}  深度 ${b.stage.rows}`;
    text(ctx, info, x + w, 18, { size: 14, align: 'right', color: badges ? C.gold : C.dim });
    const p = b.player;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, 26, w, 8);
    ctx.fillStyle = p.hp / p.maxHp > 0.3 ? C.green : C.red;
    ctx.fillRect(x, 26, w * Math.max(0, Math.min(1, p.hp / p.maxHp)), 8);
    // Experience towards the next level.
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, 35, w, 3);
    ctx.fillStyle = C.cyan;
    ctx.fillRect(x, 35, w * Math.max(0, Math.min(1, b.xp / b.xpNeeded)), 3);
  }

  /** Picks a strategy or a player to attack, and shows it right away (the server confirms). */
  private target(t: { s: number } | { id: number }) {
    const me = this.seats[this.you];
    if ('s' in t) {
      this.socket.send({ t: 'target', s: STRATEGIES[t.s].id });
      if (me) Object.assign(me, { strategy: t.s, locked: false });
    } else {
      this.socket.send({ t: 'target', id: t.id });
      if (me) Object.assign(me, { target: t.id, locked: true });
    }
  }

  /** The targeting buttons (keys H J K L) under the opponents, and your bonuses. */
  private targeting(ctx: CanvasRenderingContext2D, input: Input) {
    const me = this.seats[this.you];
    const y = TOP + FIELD_H - BAR_H + 4;
    const x0 = VIEW_W / 2 + 8;
    const gap = 6;
    const w = (VIEW_W / 2 - 16 - gap * (STRATEGIES.length - 1)) / STRATEGIES.length;
    const h = BAR_H - 8;
    STRATEGIES.forEach((st, i) => {
      const x = x0 + i * (w + gap);
      const on = me && me.strategy === i && !me.locked;
      const hv = hover(input, x, y, w, h);
      panel(ctx, x, y, w, h, hv || !!on, on ? 0.95 : 0.75);
      if (on) {
        ctx.fillStyle = '#ff9a3a';
        ctx.fillRect(x + 4, y + h - 6, w - 8, 3);
      }
      text(ctx, `${st.zh} ${st.key.slice(3)}`, x + w / 2, y + 19, { size: 16, align: 'center', color: on ? '#ffcf8a' : C.text });
      text(ctx, st.hint, x + w / 2, y + 34, { size: 11, align: 'center', color: C.dim, outline: false });
      if ((hv && input.clicked(0)) || input.wasPressed(st.key)) this.target({ s: i });
    });
    // Bonuses: badges multiply attacks; being targeted by several players adds rows to each.
    const at = this.attackers(this.you);
    const parts = [];
    if (me?.badges) parts.push(`徽章 ×${badgeBoost(me.badges).toFixed(2).replace(/0$/, '')}`);
    if (at) parts.push(`${at} 人在打你${counterRows(at) ? ` · 反击 +${counterRows(at)} 行` : ''}`);
    if (parts.length) {
      const s = parts.join('  ');
      ctx.font = `700 15px ${FONT}`;
      panel(ctx, LEFT_X + FIELD_W - 16 - ctx.measureText(s).width - 20, TOP + FIELD_H - 72, ctx.measureText(s).width + 28, 30, false, 0.85);
      text(ctx, s, LEFT_X + FIELD_W - 16, TOP + FIELD_H - 51, { size: 15, align: 'right', color: at >= 2 ? '#ff8a7a' : C.gold });
    }
  }

  /** Attacks flying from one field to another: gold from you, red at you. */
  private drawHits(ctx: CanvasRenderingContext2D, cells: Map<number, Cell>) {
    const centre = (id: number) => {
      if (id === this.you) return { x: LEFT_X + FIELD_W / 2, y: TOP + FIELD_H * 0.35 };
      const c = cells.get(id);
      return c ? { x: c.x + (WORLD_W * c.s) / 2, y: c.y + WORLD_H * c.s * 0.35 } : null;
    };
    for (const h of this.hits) {
      const a = centre(h.from);
      const z = centre(h.to);
      if (!a || !z) continue;
      const color = h.to === this.you ? '#ff4a3a' : h.from === this.you ? C.gold : 'rgba(255,240,220,0.8)';
      const f = Math.min(1, h.t / HIT_TIME);
      const e = f * f * (3 - 2 * f);
      const x = a.x + (z.x - a.x) * e;
      const y = a.y + (z.y - a.y) * e - Math.sin(f * Math.PI) * 60;
      const r = 5 + h.n * 1.6;
      ctx.fillStyle = color;
      if (f < 1) {
        for (let i = 1; i <= 4; i++) {
          const g = Math.max(0, f - i * 0.04);
          const ge = g * g * (3 - 2 * g);
          ctx.globalAlpha = 0.5 - i * 0.1;
          ctx.beginPath();
          ctx.arc(a.x + (z.x - a.x) * ge, a.y + (z.y - a.y) * ge - Math.sin(g * Math.PI) * 60, r * (1 - i * 0.15), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A burst where it lands.
        const g = (h.t - HIT_TIME) / 0.25;
        ctx.globalAlpha = 1 - g;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(z.x, z.y, r + g * 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawNews(ctx: CanvasRenderingContext2D) {
    let y = TOP + 130;
    for (const n of this.news) {
      const a = Math.min(1, (4 - n.t) * 1.5);
      text(ctx, n.text, LEFT_X + FIELD_W / 2, y, { size: n.size, align: 'center', color: n.color, alpha: a, lw: 6 });
      y += n.size + 10;
    }
  }

  /** Level-up offers wait in a strip at the top of your field while the run goes on: 1/2/3 or a click picks. */
  private drawChoices(ctx: CanvasRenderingContext2D, input: Input, b: Battle) {
    const offers = b.offers;
    if (!offers || b.phase !== 'play') return;
    const gap = 6;
    const w = (FIELD_W - 8 - gap * (offers.length - 1)) / offers.length;
    const h = 64;
    const y = TOP + 6;
    let chosen: Offer | null = null;
    offers.forEach((o, i) => {
      const x = LEFT_X + 4 + i * (w + gap);
      const info = offerTitle(o);
      const kind = o.kind === 'newBall' || o.kind === 'upBall' ? 'ball' : o.kind === 'heal' ? 'heal' : 'passive';
      const hv = hover(input, x, y, w, h);
      panel(ctx, x, y, w, h, hv, 0.88);
      ctx.fillStyle = KIND[kind];
      ctx.fillRect(x, y, 4, h);
      const cx = x + 30;
      const cy = y + h / 2;
      if (o.kind === 'newBall' || o.kind === 'upBall') {
        const def = o.kind === 'newBall' ? o.def : o.ob.parts[0].def;
        ballIcon(ctx, [{ def, lv: info.lv }], cx, cy, 14, def.evolved);
      } else if (o.kind === 'newPassive' || o.kind === 'upPassive')
        passiveIcon(ctx, o.kind === 'newPassive' ? o.def : o.p.def, cx - 15, cy - 15, 30);
      else {
        ctx.fillStyle = C.green;
        ctx.fillRect(cx - 4, cy - 12, 8, 24);
        ctx.fillRect(cx - 12, cy - 4, 24, 8);
      }
      text(ctx, info.name, x + 52, y + 26, { size: 16, color: readable(info.color) });
      const step =
        o.kind === 'heal' ? '回复 20' : o.kind === 'newBall' || o.kind === 'newPassive' ? '新' : `Lv${info.lv - 1} → Lv${info.lv}`;
      text(ctx, step, x + 52, y + 48, { size: 13, color: info.lv >= 3 ? C.gold : C.dim });
      text(ctx, `${i + 1}`, x + w - 12, y + 20, { size: 15, align: 'right', color: C.dim });
      if (input.wasPressed(`Digit${i + 1}`) || (hv && input.clicked(0))) chosen = o;
    });
    // Time left before it picks itself.
    const left = Math.max(0, 1 - b.offersT / CFG.liveChoiceTime);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(LEFT_X + 4, y + h + 4, FIELD_W - 8, 4);
    ctx.fillStyle = left > 0.3 ? C.cyan : C.red;
    ctx.fillRect(LEFT_X + 4, y + h + 4, (FIELD_W - 8) * left, 4);
    text(ctx, `升级（不会暂停）· 按 1–${offers.length} 选择`, LEFT_X + FIELD_W / 2, y + h + 24, {
      size: 13,
      align: 'center',
      color: C.text,
    });
    if (chosen) b.choose(chosen);
  }

  /** The lobby; returns true when the player wants to leave. */
  drawLobby(ctx: CanvasRenderingContext2D, input: Input) {
    ctx.fillStyle = '#0c0a0a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cx = VIEW_W / 2;
    text(ctx, '局域网对战', cx, 110, { size: 48, align: 'center', color: C.gold, lw: 10 });
    const L = this.lobby;
    if (this.state !== 'lobby') {
      const msg =
        this.state === 'closed'
          ? '连不上服务器（对战需要通过局域网服务器打开游戏）'
          : this.state === 'full'
            ? '房间满了（最多 8 人）'
            : '正在连接…';
      text(ctx, msg, cx, 300, { size: 22, align: 'center', color: C.text });
    } else {
      text(ctx, `大逃杀 · ${L.players.length} / ${L.max} 人 · 活到最后的人获胜`, cx, 160, { size: 18, align: 'center', color: C.text });
      const w = 520;
      L.players.forEach((p, i) => {
        const y = 180 + i * 36;
        panel(ctx, cx - w / 2, y, w, 32, false, 0.8);
        const char = CHARACTERS.find((c) => c.id === p.char);
        text(ctx, `${i + 1}. ${p.name}`, cx - w / 2 + 16, y + 22, { size: 17, color: p.bot ? C.dim : C.text });
        const tag = `${p.bot ? `电脑 · ${p.bot}` : (char?.zh ?? '')}${i === 0 ? ' · 房主' : ''}`;
        text(ctx, tag, cx + w / 2 - 16, y + 22, { size: 15, align: 'right', color: i === 0 ? C.gold : C.dim });
      });
      const y = 180 + L.max * 36 + 14;
      if (L.host) {
        const full = L.players.length >= L.max;
        const bots = L.players.some((p) => p.bot);
        const skill = this.botSkill;
        if (button(ctx, input, cx - 330, y, 190, 46, `加电脑（${BOT_SKILLS[skill]}）`, { size: 17, disabled: full }) && !full)
          this.socket.send({ t: 'bot', add: true, skill });
        if (button(ctx, input, cx - 130, y, 150, 46, '补满 8 人', { size: 17, disabled: full }) && !full)
          this.socket.send({ t: 'bot', add: true, fill: true, skill });
        if (button(ctx, input, cx + 30, y, 130, 46, '减电脑', { size: 17, disabled: !bots }) && bots)
          this.socket.send({ t: 'bot', add: false });
        if (button(ctx, input, cx + 170, y, 160, 46, `难度：${BOT_SKILLS[skill]}`, { size: 17 }))
          this.botSkill = (skill + 1) % BOT_SKILLS.length;
      } else text(ctx, '等房主开始…', cx, y + 30, { size: 20, align: 'center', color: C.text });
      const hint = L.playing ? `另有一局正在进行（${L.playing} 人还活着）。` : '';
      text(ctx, `${hint}其他电脑打开同一个网址，选「局域网对战」就进到这个房间。人不够可以加电脑。`, cx, VIEW_H - 92, {
        size: 15,
        align: 'center',
        color: C.dim,
      });
      const ready = L.players.length >= 2;
      if (
        L.host &&
        (button(ctx, input, cx + 10, VIEW_H - 74, 220, 50, `开始（${L.players.length} 人）`, { size: 19, disabled: !ready }) ||
          input.wasPressed('Enter')) &&
        ready
      )
        this.socket.send({ t: 'start' });
    }
    const x = this.state === 'lobby' && this.lobby.host ? cx - 190 : cx - 90;
    return button(ctx, input, x, VIEW_H - 74, 180, 50, '返回', { size: 18 }) || input.wasPressed('Escape');
  }

  // ---------------------------------------------------------------- the end

  /** Your result covers your field (until you choose to watch), or the Esc menu does. */
  get blocking() {
    const b = this.battle;
    if (!b) return false;
    return this.menu || ((this.ended || b.phase !== 'play') && !this.spectating);
  }

  /** Over for you: you went down, or the match has a winner, or the connection dropped. */
  private get ended() {
    return this.winner >= 0 || this.dropped || this.battle?.phase === 'lost' || this.sentOver;
  }

  /** Nothing pauses a running match (not choices, not the menu); your run stops once the match is over. */
  get paused() {
    return this.battle?.phase === 'play' && (this.winner >= 0 || this.dropped);
  }

  /** The result, the Esc menu or the watching hint. Returns 'leave' (title) or 'again' (back to the lobby). */
  drawOverlay(ctx: CanvasRenderingContext2D, input: Input): 'leave' | 'again' | null {
    const b = this.battle!;
    const esc = input.wasPressed('Escape');
    const cx = VIEW_W / 4;
    if (this.ended) {
      if (this.spectating) {
        if (esc) this.spectating = false;
        // Whoever you watch went down: move on to someone still in.
        if (!this.seats[this.watch]?.alive && this.winner < 0) this.watch = this.pickWatch();
        return null;
      }
      ctx.fillStyle = 'rgba(6,4,6,0.78)';
      ctx.fillRect(0, TOP, VIEW_W / 2 - 1, FIELD_H);
      const me = this.seats[this.you];
      const won = this.winner === this.you;
      const title = this.dropped
        ? '和服务器的连接断开了'
        : won
          ? '你获胜了！'
          : me?.place
            ? `第 ${me.place} 名`
            : this.sentOver && this.winner < 0
              ? '你倒下了'
              : '本局结束';
      text(ctx, title, cx, 150, { size: 40, align: 'center', color: won ? C.gold : C.text, lw: 8 });
      const sub = won
        ? `${this.players.length} 人里活到了最后`
        : me && me.by >= 0
          ? `被 ${this.nameOf(me.by)} 击倒`
          : this.winner >= 0
            ? `${this.nameOf(this.winner)} 获胜`
            : '';
      if (sub) text(ctx, sub, cx, 190, { size: 20, align: 'center', color: C.dim });
      // The standings so far: still in first, then by place.
      const order = this.seats
        .map((s, id) => ({ s, id }))
        .sort((a, z) => (a.s.place || 0) - (z.s.place || 0))
        .sort((a, z) => Number(z.s.alive) - Number(a.s.alive));
      let y = 236;
      for (const { s, id } of order) {
        if (y > 470) break;
        const place = s.alive ? (this.winner === id ? '1' : '—') : `${s.place}`;
        const color = id === this.you ? C.gold : s.alive ? C.text : C.dim;
        text(ctx, place, cx - 150, y, { size: 16, align: 'right', color });
        text(ctx, this.nameOf(id), cx - 130, y, { size: 16, color });
        if (s.badges) text(ctx, `★${s.badges}`, cx + 150, y, { size: 16, align: 'right', color: C.gold });
        y += 24;
      }
      y = 500;
      if (this.winner < 0 && !this.dropped && this.rivals.some((r, id) => r && this.seats[id]?.alive)) {
        if (button(ctx, input, cx - 130, y, 260, 48, '观战', { size: 19 })) {
          this.spectating = true;
          this.watch = this.seats[me?.by ?? -1]?.alive ? me!.by : this.pickWatch();
        }
        y += 58;
      }
      if (button(ctx, input, cx - 130, y, 260, 48, '再来一局', { size: 19 })) return 'again';
      if (button(ctx, input, cx - 130, y + 58, 260, 48, '返回标题', { size: 19 }) || esc) return 'leave';
      return null;
    }
    if (esc && b.phase === 'play') this.menu = !this.menu;
    if (!this.menu) return null;
    ctx.fillStyle = 'rgba(6,4,6,0.45)';
    ctx.fillRect(0, TOP, VIEW_W / 2 - 1, FIELD_H);
    text(ctx, '菜单', cx, 220, { size: 40, align: 'center', color: C.gold, lw: 8 });
    text(ctx, '对战不会暂停，你的这一局还在继续', cx, 258, { size: 15, align: 'center', color: C.text });
    if (button(ctx, input, cx - 130, 300, 260, 56, '继续', { size: 20 })) this.menu = false;
    if (button(ctx, input, cx - 130, 372, 260, 56, '认输并返回标题', { size: 20 })) {
      this.sentOver = true;
      this.socket.send({ t: 'over' });
      return 'leave';
    }
    return null;
  }

  /** Someone still in to watch: the one with the most badges, then the deepest. */
  private pickWatch() {
    let best = -1;
    for (const r of this.rivals) {
      if (!r || !this.seats[r.id]?.alive) continue;
      const score = (this.seats[r.id].badges ?? 0) * 1000 + r.ghost.stage.rows;
      const bestScore = best < 0 ? -1 : this.seats[best].badges * 1000 + this.rivals[best]!.ghost.stage.rows;
      if (score > bestScore) best = r.id;
    }
    return best;
  }
}
