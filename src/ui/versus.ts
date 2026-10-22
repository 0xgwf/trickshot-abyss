// LAN versus: two players race through the same level (same seed, same enemy rows) on their own
// computers. The screen is split: your field on the left, the opponent's on the right, played back
// smoothly from the snapshots their browser sends 30 times a second. Kills send rows of enemies to the opponent.
import type { Input } from '../core/input.ts';
import { VIEW_H, VIEW_W } from '../core/view.ts';
import { Battle, type Controls } from '../game/battle.ts';
import { CFG, WORLD_H, WORLD_W } from '../game/config.ts';
import { CHARACTERS } from '../game/data/characters.ts';
import { DUEL, Duel } from '../game/duel.ts';
import type { CharacterDef } from '../game/types.ts';
import { offerTitle, type Offer } from '../game/upgrades.ts';
import { Playback } from '../net/playback.ts';
import { applySnapshot, takeSnapshot, type Snapshot } from '../net/snapshot.ts';
import { Socket } from '../net/socket.ts';
import { WorldRenderer } from '../render/world.ts';
import { C, KIND, ballIcon, button, hover, panel, passiveIcon, readable, text } from './draw.ts';
import { drawCrosshair } from './hud.ts';

const TOP = 40;
/** Each field is scaled to fill its half of the screen below the status bar. */
export const SPLIT_SCALE = (VIEW_H - TOP) / WORLD_H;
const FIELD_W = WORLD_W * SPLIT_SCALE;
const FIELD_H = WORLD_H * SPLIT_SCALE;
const LEFT_X = (VIEW_W / 2 - FIELD_W) / 2;
const RIGHT_X = VIEW_W / 2 + LEFT_X;
const SNAP_RATE = 30;
/** Both players get every ball and passive unlock, so the level-up pools match. */
const ALL_UNLOCKS = new Set(['boneyard', 'snowy']);

interface Result {
  won: boolean;
  /** Gave up from the menu. */
  quit?: boolean;
  progress: number;
  time: number;
}

/** 0..1 through the level, counting the boss fight as the last 10% (same as the leaderboard). */
const progressOf = (b: Battle) => {
  if (b.phase === 'won') return 1;
  const boss = b.stage.bossBar;
  return b.stage.progress * 0.9 + (boss ? 0.1 * (1 - boss.frac) : 0);
};

export class Versus {
  readonly socket: Socket;
  state: 'connecting' | 'waiting' | 'playing' | 'closed' = 'connecting';
  battle: Battle | null = null;
  private ghost: Battle | null = null;
  private readonly oppPlay = new Playback();
  private oppName = '';
  private oppSeen = false;
  private oppOver: Result | null = null;
  private oppLeft = false;
  private sentOver = false;
  private snapT = 0;
  /** Versus rules for your run: attacks out, the opponent's rows in. */
  duel: Duel | null = null;
  private readonly world = new WorldRenderer();
  private readonly oppWorld = new WorldRenderer();
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
      if (m.t === 'wait') this.state = 'waiting';
      else if (m.t === 'start') {
        const opp = m.opp as { name: string; char: string };
        const oppChar = CHARACTERS.find((c) => c.id === opp.char) ?? CHARACTERS[0];
        this.battle = new Battle(this.char, m.seed as number, ALL_UNLOCKS, m.level as string);
        this.battle.live = true;
        this.duel = new Duel(this.battle);
        this.ghost = new Battle(oppChar, m.seed as number, ALL_UNLOCKS, m.level as string);
        new Duel(this.ghost); // only drawn: shows the opponent's incoming meter and streak
        this.oppName = opp.name;
        this.state = 'playing';
      } else if (m.t === 'opp' && this.ghost) {
        this.oppPlay.push(m.s as Snapshot);
        this.oppSeen = true;
      } else if (m.t === 'garbage') this.duel?.receive(m.n as number, m.r as number);
      else if (m.t === 'oppOver') this.oppOver = { won: !!m.won, quit: !!m.quit, progress: m.progress as number, time: m.time as number };
      else if (m.t === 'oppLeft') this.oppLeft = true;
    }
    if (this.socket.state === 'closed' && this.state !== 'playing') this.state = 'closed';
    const s = this.ghost && this.oppPlay.sample();
    if (s) applySnapshot(this.ghost!, s);
  }

  /** Maps mouse and keys to the left field. */
  controls(i: Input, b: Battle): Controls {
    const joy = i.joyVector();
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0) + (joy?.x ?? 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) + (joy?.y ?? 0),
      aimX: (i.mouseX - LEFT_X) / SPLIT_SCALE,
      aimY: (i.mouseY - TOP) / SPLIT_SCALE,
      fire: i.button(0) || i.isDown('Space'),
      recall: i.clicked(2) || (b.recallReady && i.wasPressed('KeyR')),
    };
  }

  /** Sends snapshots, attacks and the result after the local battle stepped. */
  afterUpdate(dt: number) {
    const b = this.battle;
    if (!b) return;
    // Carry the remainder over so the rate holds at any frame rate; each snapshot is stamped with its time.
    this.snapT += dt;
    if (this.snapT >= 1 / SNAP_RATE) {
      this.snapT = Math.min(this.snapT - 1 / SNAP_RATE, 1 / SNAP_RATE);
      this.socket.send({ t: 'snap', s: takeSnapshot(b) });
    }
    const n = this.duel!.take();
    if (n) {
      this.socket.send({ t: 'attack', n, r: this.duel!.hpRow });
      b.text(b.player.x, b.player.y - 44, `送出 ${n} 行！`, C.gold, 18);
    }
    if ((b.phase === 'won' || b.phase === 'lost') && !this.sentOver) {
      this.sentOver = true;
      this.socket.send({ t: 'over', won: b.phase === 'won', progress: progressOf(b), time: b.t });
    }
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D, input: Input) {
    const b = this.battle!;
    ctx.fillStyle = '#0c0a0a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.field(ctx, this.world, b, LEFT_X, !this.blocking);
    if (this.ghost && this.oppSeen) this.field(ctx, this.oppWorld, this.ghost, RIGHT_X);
    else text(ctx, '等待对手的画面…', VIEW_W * 0.75, VIEW_H / 2, { size: 22, align: 'center', color: C.dim });
    ctx.fillStyle = '#3a3028';
    ctx.fillRect(VIEW_W / 2 - 1, 0, 2, VIEW_H);
    // Margin time: the pressure step both runs share.
    const k = this.duel?.margin ?? 0;
    if (k > 0) {
      panel(ctx, VIEW_W / 2 - 40, TOP + 4, 80, 24, false, 0.9);
      text(ctx, `加压 ×${k}`, VIEW_W / 2, TOP + 21, { size: 14, align: 'center', color: '#ff9a3a' });
    }

    this.status(ctx, b, `你 · ${this.name}`, 12);
    if (this.ghost && this.oppSeen) this.status(ctx, this.ghost, `对手 · ${this.oppName}`, VIEW_W / 2 + 12);
    else text(ctx, `对手 · ${this.oppName}`, VIEW_W / 2 + 12, 27, { size: 16, color: C.dim });
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

    // The opponent's end, drawn over their half.
    const oppMsg = this.oppLeft
      ? '对手离开了'
      : this.oppOver
        ? this.oppOver.won
          ? '对手通关了！'
          : this.oppOver.quit
            ? '对手认输了'
            : '对手倒下了'
        : '';
    if (oppMsg) {
      ctx.fillStyle = 'rgba(6,4,6,0.6)';
      ctx.fillRect(VIEW_W / 2 + 1, TOP, VIEW_W / 2, FIELD_H);
      text(ctx, oppMsg, VIEW_W * 0.75, VIEW_H / 2, { size: 34, align: 'center', color: this.oppOver?.won ? C.gold : C.text, lw: 8 });
    }
    if (!this.blocking) this.drawChoices(ctx, input, b);
    if (b.phase === 'play' && input.mouseX < VIEW_W / 2) drawCrosshair(ctx, b, input);
  }

  /** One field, scaled into its half, with damage numbers, the banner and the boss bar on top. */
  private field(ctx: CanvasRenderingContext2D, world: WorldRenderer, b: Battle, x: number, banner = true) {
    const s = SPLIT_SCALE;
    world.draw(b);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(world.canvas, x, TOP, FIELD_W, FIELD_H);
    ctx.imageSmoothingEnabled = true;
    for (const t of b.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 3);
      text(ctx, t.text, x + t.x * s, TOP + t.y * s, { size: Math.round(t.size * s), align: 'center', color: t.color });
    }
    ctx.globalAlpha = 1;
    const ban = b.stage.banner;
    if (ban && banner) text(ctx, ban.text, x + FIELD_W / 2, TOP + FIELD_H * 0.3, { size: 30, align: 'center', color: C.gold, lw: 8 });
    const boss = b.stage.bossBar;
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 40, TOP + 10, FIELD_W - 80, 12);
      ctx.fillStyle = C.red;
      ctx.fillRect(x + 40, TOP + 10, (FIELD_W - 80) * boss.frac, 12);
    }
    if (b.duel) this.duelInfo(ctx, b, x);
  }

  /** The incoming meter on the left cliff (one block per row, oldest at the bottom) and the kill streak. */
  private duelInfo(ctx: CanvasRenderingContext2D, b: Battle, x: number) {
    const d = b.duel!;
    const flash = Math.floor(performance.now() / 120) % 2 === 0;
    let y = TOP + FIELD_H - 70;
    for (const p of d.incoming) {
      const stage = d.stage(p);
      ctx.fillStyle = stage === 0 ? '#ffd23a' : stage === 1 || flash ? '#ff4a3a' : '#ffffff';
      for (let i = 0; i < p.rows; i++) {
        y -= 20;
        ctx.fillRect(x + 10, y, 14, 18);
      }
    }
    if (d.incoming.length) text(ctx, `来袭 ${d.pending}`, x + 8, y - 8, { size: 13, color: '#ff8a7a' });
    if (d.streak) {
      const rows = Math.floor(d.streak / DUEL.killsPerRow);
      const p = b.player;
      const label = rows ? `连杀 ${d.streak} · ${rows} 行` : `连杀 ${d.streak}`;
      text(ctx, label, x + p.x * SPLIT_SCALE, TOP + (p.y + 40) * SPLIT_SCALE, { size: 14, align: 'center', color: rows ? C.gold : C.dim });
    }
  }

  private status(ctx: CanvasRenderingContext2D, b: Battle, who: string, x: number) {
    const w = VIEW_W / 2 - 24;
    text(ctx, `${who} · ${b.char.zh}`, x, 18, { size: 15, color: C.text });
    const info = `Lv${b.lvl}  击杀 ${b.kills}  进度 ${Math.round(progressOf(b) * 100)}%`;
    text(ctx, info, x + w, 18, { size: 14, align: 'right', color: C.dim });
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

  /** Lobby and result screens; returns true when the player wants to leave. */
  drawLobby(ctx: CanvasRenderingContext2D, input: Input) {
    ctx.fillStyle = '#0c0a0a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const msg =
      this.state === 'closed'
        ? '连不上服务器（对战需要通过局域网服务器打开游戏）'
        : this.state === 'waiting'
          ? '等待另一位玩家加入…'
          : '正在连接…';
    text(ctx, '局域网对战', VIEW_W / 2, 220, { size: 48, align: 'center', color: C.gold, lw: 10 });
    text(ctx, msg, VIEW_W / 2, 300, { size: 22, align: 'center', color: C.text });
    text(ctx, '另一台电脑打开同一个网址，选择「局域网对战」就会自动配对。关卡以先进来的人选的为准。', VIEW_W / 2, 340, {
      size: 16,
      align: 'center',
      color: C.dim,
    });
    return button(ctx, input, VIEW_W / 2 - 110, 420, 220, 56, '返回', { size: 20 }) || input.wasPressed('Escape');
  }

  /** The match result, decided the moment either run ends or the opponent leaves; the first call stands. */
  verdict: { title: string; win: boolean } | null = null;
  /** The player chose to finish their run after the verdict. */
  private playingOn = false;
  /** The Esc menu during a match. */
  private menu = false;

  private decide() {
    const b = this.battle;
    if (this.verdict || !b) return;
    const opp = this.oppOver;
    if (b.phase === 'won') this.verdict = opp?.won ? { title: '对手先通关了', win: false } : { title: '你先通关，获胜！', win: true };
    else if (opp?.won) this.verdict = { title: '对手先通关了', win: false };
    else if (opp) this.verdict = { title: opp.quit ? '对手认输了，你获胜！' : '对手倒下了，你获胜！', win: true };
    else if (this.oppLeft) this.verdict = { title: '对手离开了，你获胜！', win: true };
    else if (b.phase === 'lost') this.verdict = { title: '你倒下了，对手获胜', win: false };
  }

  /** An overlay covers your field: the verdict (until you choose to play on) or the Esc menu. */
  get blocking() {
    const b = this.battle;
    if (!b) return false;
    const over = b.phase === 'won' || b.phase === 'lost';
    return this.menu || (this.verdict !== null && (over || !this.playingOn));
  }

  /** Nothing pauses a running match (not choices, not the menu); only a decided one waits for you. */
  get paused() {
    return this.battle?.phase === 'play' && this.verdict !== null && !this.playingOn;
  }

  /** The verdict, the Esc menu or the "decided" hint. Returns 'leave' to go back to the title. */
  drawOverlay(ctx: CanvasRenderingContext2D, input: Input): 'leave' | null {
    this.decide();
    const b = this.battle!;
    const over = b.phase === 'won' || b.phase === 'lost';
    const esc = input.wasPressed('Escape');
    const cx = VIEW_W / 4;
    const shade = () => {
      ctx.fillStyle = 'rgba(6,4,6,0.72)';
      ctx.fillRect(0, TOP, VIEW_W / 2 - 1, FIELD_H);
    };
    if (this.verdict && (over || !this.playingOn)) {
      shade();
      const v = this.verdict;
      text(ctx, v.title, cx, 250, { size: 32, align: 'center', color: v.win ? C.gold : C.red, lw: 8 });
      const opp = this.oppOver;
      text(ctx, `进度 ${Math.round(progressOf(b) * 100)}%${opp ? ` · 对手 ${Math.round(opp.progress * 100)}%` : ''}`, cx, 290, {
        size: 18,
        align: 'center',
        color: C.dim,
      });
      let y = 340;
      if (!over) {
        if (button(ctx, input, cx - 130, y, 260, 56, '继续打完这一局', { size: 20 })) this.playingOn = true;
        y += 72;
      }
      text(ctx, 'Esc 返回标题', cx, y + 92, { size: 14, align: 'center', color: C.dim });
      return button(ctx, input, cx - 130, y, 260, 56, '返回标题', { size: 20 }) || esc ? 'leave' : null;
    }
    if (this.verdict) {
      text(ctx, `${this.verdict.win ? '你赢了' : '你输了'} · Esc 返回标题`, cx, TOP + 40, { size: 16, align: 'center', color: C.dim });
      return esc ? 'leave' : null;
    }
    if (esc && b.phase === 'play') this.menu = !this.menu;
    if (!this.menu) return null;
    ctx.fillStyle = 'rgba(6,4,6,0.45)';
    ctx.fillRect(0, TOP, VIEW_W / 2 - 1, FIELD_H);
    text(ctx, '菜单', cx, 220, { size: 40, align: 'center', color: C.gold, lw: 8 });
    text(ctx, '对战不会暂停，你的这一局还在继续', cx, 258, { size: 15, align: 'center', color: C.text });
    if (button(ctx, input, cx - 130, 300, 260, 56, '继续', { size: 20 })) this.menu = false;
    if (button(ctx, input, cx - 130, 372, 260, 56, '认输并返回标题', { size: 20 })) {
      // The opponent wins: tell them the run is over.
      this.sentOver = true;
      this.socket.send({ t: 'over', won: false, quit: true, progress: progressOf(b), time: b.t });
      return 'leave';
    }
    return null;
  }
}
