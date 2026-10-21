// LAN co-op client: the battle runs on the server (server/coop.mjs); this sends the player's controls
// and draws the snapshots it gets back with the normal world renderer and HUD.
import type { Input } from '../core/input.ts';
import { VIEW_H, VIEW_W } from '../core/view.ts';
import { Battle, type Controls } from '../game/battle.ts';
import { BALLS } from '../game/data/balls.ts';
import { CHARACTERS } from '../game/data/characters.ts';
import { PASSIVES } from '../game/data/passives.ts';
import type { CharacterDef } from '../game/types.ts';
import type { Offer } from '../game/upgrades.ts';
import { applySnapshot, type Snapshot } from '../net/snapshot.ts';
import { Socket } from '../net/socket.ts';
import { C, button, text } from './draw.ts';
import { FX } from './hud.ts';

type OfferMsg = { k: Offer['kind']; id?: string; i?: number };

/** Body colours, so everyone can tell the players apart. */
export const BODY_COLORS = ['#7ad8ff', '#ffb04a', '#9dff7a', '#ff7ad8'];

export class Coop {
  readonly socket: Socket;
  state: 'connecting' | 'lobby' | 'playing' | 'ended' | 'busy' | 'closed' = 'connecting';
  /** Stand-in battle, rewritten from every snapshot and only drawn. */
  ghost: Battle | null = null;
  names: string[] = [];
  host = false;
  you = 0;
  chooser = 0;
  pending = 0;
  /** Sound cues that arrived with the snapshots, played by the app. */
  readonly sounds: string[] = [];
  private inT = 0;
  private readonly unlocks: Set<string>;

  constructor(name: string, char: CharacterDef, level: string, unlocks: Set<string>) {
    this.unlocks = unlocks;
    this.socket = new Socket({ t: 'join', mode: 'coop', name, char: char.id, level });
  }

  poll() {
    for (const m of this.socket.drain()) {
      if (m.t === 'lobby') {
        this.state = 'lobby';
        this.names = m.names as string[];
        this.host = !!m.host;
      } else if (m.t === 'busy') this.state = 'busy';
      else if (m.t === 'start') {
        const char = CHARACTERS.find((c) => c.id === m.char) ?? CHARACTERS[0];
        this.ghost = new Battle(char, 0, this.unlocks, m.level as string);
        this.you = m.you as number;
        this.names = m.names as string[];
        this.state = 'playing';
      } else if (m.t === 'snap' && this.ghost) this.apply(m.s as Snapshot, m.offers as OfferMsg[] | null, m);
      else if (m.t === 'end') this.state = 'ended';
    }
    if (this.socket.state === 'closed' && this.state !== 'ended') this.state = this.state === 'busy' ? 'busy' : 'closed';
  }

  private apply(s: Snapshot, offers: OfferMsg[] | null, m: Record<string, unknown>) {
    const g = this.ghost!;
    applySnapshot(g, s);
    g.recomputeStats();
    g.player.hp = s.hp;
    g.player.maxHp = s.maxHp;
    g.pendingLevelUps = m.pending as number;
    this.chooser = m.chooser as number;
    this.names = m.names as string[];
    this.sounds.push(...((m.events as string[] | undefined) ?? []));
    g.offers = offers
      ? offers.map((o): Offer => {
          if (o.k === 'newBall') return { kind: 'newBall', def: BALLS[o.id!] };
          if (o.k === 'upBall') return { kind: 'upBall', ob: g.owned[o.i!] };
          if (o.k === 'newPassive') return { kind: 'newPassive', def: PASSIVES[o.id!] };
          if (o.k === 'upPassive') return { kind: 'upPassive', p: g.passives[o.i!] };
          return { kind: 'heal' };
        })
      : null;
  }

  /** Sends this player's controls (at most 60 times a second). */
  send(dt: number, i: Input) {
    this.inT += dt;
    if (this.inT < 1 / 60 || this.state !== 'playing') return;
    this.inT = 0;
    const joy = i.joyVector();
    const c: Controls = {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0) + (joy?.x ?? 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) + (joy?.y ?? 0),
      aimX: i.mouseX - FX,
      aimY: i.mouseY,
      fire: i.button(0) || i.isDown('Space'),
      recall: i.clicked(2) || i.wasPressed('KeyR'),
    };
    this.socket.send({ t: 'in', c });
  }

  pick(index: number) {
    this.socket.send({ t: 'pick', i: index });
  }

  /** Name tags over every body; yours says 你. */
  drawTags(ctx: CanvasRenderingContext2D) {
    const g = this.ghost!;
    g.bodies.forEach((p, i) => {
      const color = BODY_COLORS[i % BODY_COLORS.length];
      ctx.fillStyle = color;
      ctx.fillRect(FX + p.x - 14, p.y + 14, 28, 3);
      text(ctx, i === this.you ? '你' : (this.names[i] ?? `P${i + 1}`), FX + p.x, p.y - 30, { size: 13, align: 'center', color });
    });
  }

  /** Shown to everyone but the chooser while a level-up is being picked. */
  drawWaiting(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(6,4,6,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const who = this.names[this.chooser] ?? `P${this.chooser + 1}`;
    text(ctx, `${who} 正在选择升级…`, VIEW_W / 2, VIEW_H / 2, { size: 30, align: 'center', color: C.gold, lw: 8 });
    text(ctx, '升级由队员轮流挑选', VIEW_W / 2, VIEW_H / 2 + 36, { size: 16, align: 'center', color: C.dim });
  }

  /** Lobby; returns 'start' when the host starts, 'leave' to go back. */
  drawLobby(ctx: CanvasRenderingContext2D, input: Input): 'start' | 'leave' | null {
    ctx.fillStyle = '#0c0a0a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    text(ctx, '局域网合作', VIEW_W / 2, 170, { size: 48, align: 'center', color: C.gold, lw: 10 });
    const msg =
      this.state === 'busy'
        ? '已经有一局合作在进行，请等它结束'
        : this.state === 'closed'
          ? '连不上服务器（合作需要通过局域网服务器打开游戏）'
          : this.state === 'connecting'
            ? '正在连接…'
            : this.host
              ? '你是房主：人到齐后点「开始」'
              : '等待房主开始…';
    text(ctx, msg, VIEW_W / 2, 230, { size: 20, align: 'center', color: C.text });
    this.names.forEach((n, i) =>
      text(ctx, `${i + 1}. ${n}${i === 0 ? '（房主）' : ''}`, VIEW_W / 2, 290 + i * 34, {
        size: 20,
        align: 'center',
        color: BODY_COLORS[i % BODY_COLORS.length],
      }),
    );
    text(ctx, '其他人打开同一个网址，选择「局域网合作」就会进入这个房间。', VIEW_W / 2, 470, { size: 15, align: 'center', color: C.dim });
    if (
      this.state === 'lobby' &&
      this.host &&
      button(ctx, input, VIEW_W / 2 - 230, 520, 220, 56, `开始（${this.names.length} 人）`, { size: 20 })
    )
      return 'start';
    if (button(ctx, input, VIEW_W / 2 + 10, 520, 220, 56, '返回', { size: 20 }) || input.wasPressed('Escape')) return 'leave';
    return null;
  }

  /** The Esc menu: the run goes on (it's on the server); leaving hands your body to the autopilot. */
  menu = false;

  drawMenu(ctx: CanvasRenderingContext2D, input: Input): 'leave' | null {
    ctx.fillStyle = 'rgba(6,4,6,0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    text(ctx, '菜单', VIEW_W / 2, 220, { size: 40, align: 'center', color: C.gold, lw: 8 });
    text(ctx, '合作不会暂停；离开后你的角色由自动驾驶接管', VIEW_W / 2, 258, { size: 15, align: 'center', color: C.dim });
    if (button(ctx, input, VIEW_W / 2 - 130, 300, 260, 56, '继续', { size: 20 })) this.menu = false;
    return button(ctx, input, VIEW_W / 2 - 130, 372, 260, 56, '离开房间', { size: 20 }) ? 'leave' : null;
  }

  /** The end of the run; returns true when the player wants to leave. */
  drawEnd(ctx: CanvasRenderingContext2D, input: Input) {
    const g = this.ghost;
    const won = g?.phase === 'won';
    ctx.fillStyle = 'rgba(6,4,6,0.72)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    text(ctx, won ? '一起通关了！' : '队伍倒下了', VIEW_W / 2, 250, { size: 52, align: 'center', color: won ? C.gold : C.red, lw: 10 });
    if (g)
      text(ctx, `${this.names.join('、')} · Lv${g.lvl} · 击杀 ${g.kills}`, VIEW_W / 2, 300, { size: 20, align: 'center', color: C.dim });
    text(ctx, 'Esc 返回标题', VIEW_W / 2, 440, { size: 14, align: 'center', color: C.dim });
    return button(ctx, input, VIEW_W / 2 - 110, 360, 220, 56, '返回标题', { size: 20 }) || input.wasPressed('Escape');
  }
}
