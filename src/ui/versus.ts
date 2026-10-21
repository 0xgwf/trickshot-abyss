// LAN versus: two players race through the same level (same seed, same enemy rows) on their own
// computers. The screen is split: your field on the left, the opponent's on the right, drawn from the
// snapshots their browser sends 20 times a second. Kills send rows of enemies to the opponent.
import type { Input } from '../core/input.ts';
import { VIEW_H, VIEW_W } from '../core/view.ts';
import { Battle, type Controls } from '../game/battle.ts';
import { WORLD_H, WORLD_W } from '../game/config.ts';
import { CHARACTERS } from '../game/data/characters.ts';
import type { CharacterDef } from '../game/types.ts';
import { applySnapshot, takeSnapshot } from '../net/snapshot.ts';
import { Socket } from '../net/socket.ts';
import { WorldRenderer } from '../render/world.ts';
import { C, ballIcon, button, text } from './draw.ts';
import { drawCrosshair } from './hud.ts';

const TOP = 40;
/** Each field is scaled to fill its half of the screen below the status bar. */
export const SPLIT_SCALE = (VIEW_H - TOP) / WORLD_H;
const FIELD_W = WORLD_W * SPLIT_SCALE;
const FIELD_H = WORLD_H * SPLIT_SCALE;
const LEFT_X = (VIEW_W / 2 - FIELD_W) / 2;
const RIGHT_X = VIEW_W / 2 + LEFT_X;
const SNAP_RATE = 20;
/** Both players get every ball and passive unlock, so the level-up pools match. */
const ALL_UNLOCKS = new Set(['boneyard', 'snowy']);
/** Kills that send one row to the opponent; beating a miniboss sends two. */
const KILLS_PER_ROW = 25;

interface Result {
  won: boolean;
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
  private oppName = '';
  private oppSeen = false;
  private oppOver: Result | null = null;
  private oppLeft = false;
  private sentOver = false;
  private snapT = 0;
  private rowsSent = 0;
  private lastSegment = 0;
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
        this.ghost = new Battle(oppChar, m.seed as number, ALL_UNLOCKS, m.level as string);
        this.oppName = opp.name;
        this.state = 'playing';
      } else if (m.t === 'opp' && this.ghost) {
        applySnapshot(this.ghost, m.s as Parameters<typeof applySnapshot>[1]);
        this.oppSeen = true;
      } else if (m.t === 'garbage') this.battle?.stage.addGarbage(m.n as number);
      else if (m.t === 'oppOver') this.oppOver = { won: !!m.won, progress: m.progress as number, time: m.time as number };
      else if (m.t === 'oppLeft') this.oppLeft = true;
    }
    if (this.socket.state === 'closed' && this.state !== 'playing') this.state = 'closed';
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
    this.snapT += dt;
    if (this.snapT >= 1 / SNAP_RATE) {
      this.snapT = 0;
      this.socket.send({ t: 'snap', s: takeSnapshot(b) });
    }
    const byKills = Math.floor(b.kills / KILLS_PER_ROW);
    if (byKills > this.rowsSent) {
      this.socket.send({ t: 'attack', n: byKills - this.rowsSent });
      this.rowsSent = byKills;
    }
    if (b.stage.segment > this.lastSegment) {
      this.lastSegment = b.stage.segment;
      this.socket.send({ t: 'attack', n: 2 });
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
    this.field(ctx, this.world, b, LEFT_X);
    if (this.ghost && this.oppSeen) this.field(ctx, this.oppWorld, this.ghost, RIGHT_X);
    else text(ctx, '等待对手的画面…', VIEW_W * 0.75, VIEW_H / 2, { size: 22, align: 'center', color: C.dim });
    ctx.fillStyle = '#3a3028';
    ctx.fillRect(VIEW_W / 2 - 1, 0, 2, VIEW_H);

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
    const oppMsg = this.oppLeft ? '对手离开了' : this.oppOver ? (this.oppOver.won ? '对手通关了！' : '对手倒下了') : '';
    if (oppMsg) {
      ctx.fillStyle = 'rgba(6,4,6,0.6)';
      ctx.fillRect(VIEW_W / 2 + 1, TOP, VIEW_W / 2, FIELD_H);
      text(ctx, oppMsg, VIEW_W * 0.75, VIEW_H / 2, { size: 34, align: 'center', color: this.oppOver?.won ? C.gold : C.text, lw: 8 });
    }
    if (b.phase === 'play' && input.mouseX < VIEW_W / 2) drawCrosshair(ctx, b, input);
  }

  /** One field, scaled into its half, with damage numbers, the banner and the boss bar on top. */
  private field(ctx: CanvasRenderingContext2D, world: WorldRenderer, b: Battle, x: number) {
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
    if (ban) text(ctx, ban.text, x + FIELD_W / 2, TOP + FIELD_H * 0.3, { size: 30, align: 'center', color: C.gold, lw: 8 });
    const boss = b.stage.bossBar;
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 40, TOP + 10, FIELD_W - 80, 12);
      ctx.fillStyle = C.red;
      ctx.fillRect(x + 40, TOP + 10, (FIELD_W - 80) * boss.frac, 12);
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

  /** The verdict once the local run is over; returns true when the player wants to leave. */
  drawResult(ctx: CanvasRenderingContext2D, input: Input) {
    const b = this.battle!;
    const me: Result = { won: b.phase === 'won', progress: progressOf(b), time: b.t };
    const opp = this.oppOver;
    let title: string;
    let win: boolean | null = null;
    if (this.oppLeft && !opp) [title, win] = ['对手离开了', true];
    else if (me.won && !(opp?.won && opp.time < me.time)) [title, win] = ['你先通关，获胜！', true];
    else if (opp?.won) [title, win] = ['对手先通关了', false];
    else if (!opp) title = '你倒下了，等待对手结束…';
    else [title, win] = me.progress >= opp.progress ? ['你坚持得更远，获胜！', true] : ['对手坚持得更远', false];
    ctx.fillStyle = 'rgba(6,4,6,0.7)';
    ctx.fillRect(0, TOP, VIEW_W / 2 - 1, FIELD_H);
    const cx = VIEW_W / 4;
    text(ctx, title, cx, 260, { size: 30, align: 'center', color: win === null ? C.text : win ? C.gold : C.red, lw: 8 });
    text(ctx, `进度 ${Math.round(me.progress * 100)}%${opp ? ` · 对手 ${Math.round(opp.progress * 100)}%` : ''}`, cx, 300, {
      size: 18,
      align: 'center',
      color: C.dim,
    });
    return button(ctx, input, cx - 110, 360, 220, 56, '返回标题', { size: 20 });
  }
}
