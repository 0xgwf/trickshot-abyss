import { Audio, type Sfx } from '../core/audio.ts';
import { load, store } from '../core/storage.ts';
import type { Input } from '../core/input.ts';
import { VIEW_H, VIEW_W, type View } from '../core/view.ts';
import { Battle, type Controls } from '../game/battle.ts';
import { WORLD_H, WORLD_W } from '../game/config.ts';
import { BALLS } from '../game/data/balls.ts';
import { CHARACTERS } from '../game/data/characters.ts';
import { LEVELS, type LevelDef } from '../game/data/levels.ts';
import { sprite } from '../render/pixel.ts';
import { applyEvolution, applyFission, applyFusion, applyOffer, offerTitle, type Evolution } from '../game/upgrades.ts';
import type { CharacterDef } from '../game/types.ts';
import { fetchBoard, submitScore, type Board } from '../net/leaderboard.ts';
import { GAME } from '../meta.ts';
import { WorldRenderer } from '../render/world.ts';
import { C, KIND, accent, ballIcon, button, hover, panel, paragraph, passiveIcon, pips, readable, text } from './draw.ts';
import { FX, drawCrosshair, drawHud, drawTooltip } from './hud.ts';

interface Save {
  unlocks: string[];
  clears: number;
  runs: number;
  best: number | null;
}

type Screen = 'title' | 'select' | 'help' | 'battle';

const loadSave = (): Save => {
  const fresh: Save = { unlocks: [], clears: 0, runs: 0, best: null };
  try {
    const raw = load('save');
    if (raw) return { ...fresh, ...JSON.parse(raw) };
  } catch {
    // corrupt save: start over
  }
  return fresh;
};

function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 10, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.fillRect(cx - 15, cy - 4, 30, 22);
  ctx.fillStyle = '#1d1713';
  ctx.fillRect(cx - 2, cy + 2, 4, 9);
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

interface TitleBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  r: number;
}

export class App {
  readonly view: View;
  readonly input: Input;
  readonly audio = new Audio();
  readonly world = new WorldRenderer();
  screen: Screen = 'title';
  battle: Battle | null = null;
  paused = false;
  charIdx = 0;
  levelIdx = 0;
  save: Save = loadSave();
  reactorView: 'main' | 'fusion' | 'evolve' | 'result' = 'main';
  fissionLog: string[] = [];
  newUnlocks: string[] = [];
  private titleBalls: TitleBall[] = [];
  private t = 0;
  private endHandled = false;
  board: Board | null = null;
  private boardAt = -999;
  private submitState: 'idle' | 'sending' | 'done' | 'failed' = 'idle';
  private myRank = 0;
  private readonly nameInput: HTMLInputElement;
  /** When the current overlay (level-up / reactor) appeared; input is ignored briefly after. */
  private overlaySince = 0;
  private lastPhase = '';
  private showName = false;

  constructor(view: View, input: Input) {
    this.view = view;
    this.input = input;
    input.onGesture = () => this.audio.unlock();
    const colors = Object.values(BALLS).map((b) => b.color);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      this.titleBalls.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
        vx: Math.cos(a) * 160,
        vy: Math.sin(a) * 160,
        c: colors[i % colors.length],
        r: 6 + Math.random() * 8,
      });
    }
    window.addEventListener('blur', () => {
      if (this.screen === 'battle' && this.battle?.phase === 'play') this.paused = true;
    });
    this.nameInput = document.createElement('input');
    this.nameInput.maxLength = 12;
    this.nameInput.placeholder = '输入名字上榜';
    this.nameInput.className = 'name-input';
    this.nameInput.value = load('name') ?? '';
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    document.body.appendChild(this.nameInput);
  }

  private submit() {
    const b = this.battle;
    if (!b || this.submitState === 'sending' || this.submitState === 'done') return;
    const name = this.nameInput.value.trim().slice(0, 12);
    if (!name) {
      this.nameInput.focus();
      return;
    }
    store('name', name);
    this.submitState = 'sending';
    const boss = b.stage.bossBar;
    const progress = b.phase === 'won' ? 1 : b.stage.progress * 0.9 + (boss ? 0.1 * (1 - boss.frac) : 0);
    void submitScore({
      name,
      char: b.char.zh,
      won: b.phase === 'won',
      time: Math.round(b.t),
      kills: b.kills,
      level: b.lvl,
      progress,
      stage: b.level.zh,
      layer: b.level.layer,
    }).then((res) => {
      if (res) {
        this.board = res;
        this.myRank = res.rank ?? 0;
        this.submitState = 'done';
      } else this.submitState = 'failed';
      this.nameInput.blur();
    });
  }

  /** Places the DOM name box over a logical-coordinate rectangle. */
  private placeInput(x: number, y: number, w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    const v = this.view;
    const st = this.nameInput.style;
    st.left = `${(v.offsetX + x * v.scale) / dpr}px`;
    st.top = `${(v.offsetY + y * v.scale) / dpr}px`;
    st.width = `${(w * v.scale) / dpr}px`;
    st.height = `${(h * v.scale) / dpr}px`;
    st.fontSize = `${(18 * v.scale) / dpr}px`;
    this.showName = true;
  }

  private writeSave() {
    store('save', JSON.stringify(this.save));
  }

  private sfx(s: Sfx) {
    this.audio.play(s);
  }

  get unlocks() {
    return new Set(this.save.unlocks);
  }

  isUnlocked(c: CharacterDef) {
    return c.unlock === 'default' || this.unlocks.has(c.unlock);
  }

  levelOpen(l: LevelDef) {
    return !l.requires || this.unlocks.has(l.requires);
  }

  startRun() {
    const char = CHARACTERS[this.charIdx];
    const level = LEVELS[this.levelIdx];
    this.battle = new Battle(char, (Date.now() ^ (Math.random() * 1e9)) >>> 0, this.unlocks, level.id);
    this.screen = 'battle';
    this.paused = false;
    this.endHandled = false;
    this.submitState = 'idle';
    this.myRank = 0;
    this.reactorView = 'main';
    this.save.runs++;
    this.writeSave();
  }

  frame(dt: number) {
    this.t += dt;
    const { ctx } = this.view;
    const input = this.input;
    if (input.wasPressed('KeyM')) this.audio.toggleMute();
    this.showName = false;
    this.view.begin();
    switch (this.screen) {
      case 'title':
        this.drawTitle(ctx, dt);
        break;
      case 'select':
        this.drawSelect(ctx);
        break;
      case 'help':
        this.drawHelp(ctx);
        break;
      case 'battle':
        this.battleFrame(ctx, dt);
        break;
    }
    if (this.audio.muted) text(ctx, '静音', VIEW_W - 60, VIEW_H - 14, { size: 13, color: C.dim });
    if (window.innerHeight > window.innerWidth * 1.1) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, VIEW_H / 2 - 60, VIEW_W, 120);
      text(ctx, '请把手机横过来玩 ↻', VIEW_W / 2, VIEW_H / 2 + 12, { size: 44, align: 'center', color: C.gold });
    }
    this.nameInput.style.display = this.showName ? 'block' : 'none';
    input.endFrame();
  }

  // ---------------------------------------------------------------- battle

  private controls(b: Battle): Controls {
    const i = this.input;
    const joy = i.joyVector();
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0) + (joy?.x ?? 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) + (joy?.y ?? 0),
      aimX: i.mouseX - FX,
      aimY: i.mouseY,
      fire: i.button(0) || i.isDown('Space'),
      recall: i.clicked(2) || (b.recallReady && i.wasPressed('KeyR')),
    };
  }

  private battleFrame(ctx: CanvasRenderingContext2D, dt: number) {
    const b = this.battle!;
    const input = this.input;
    input.joystickEnabled = b.phase === 'play' && !this.paused;
    input.joystickMaxX = FX + b.left - 4;
    if (b.phase === 'play') {
      if (input.wasPressed('Escape', 'KeyP')) this.paused = !this.paused;
      if (!this.paused) {
        if (input.wasPressed('KeyF') || input.clicked(1)) b.autofire = !b.autofire;
        if (input.wasPressed('Digit1')) b.speed = 1;
        if (input.wasPressed('Digit2')) b.speed = 1.5;
        if (input.wasPressed('Digit3')) b.speed = 2;
        b.update(dt, this.controls(b));
      }
    } else b.update(dt, this.controls(b));
    for (const ev of b.events) this.sfx(ev.type as Sfx);
    b.events.length = 0;
    if (b.phase !== this.lastPhase) {
      this.lastPhase = b.phase;
      this.overlaySince = this.t;
    }

    // World
    this.world.draw(b);
    const shake = b.shake > 0 ? b.shake : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world.canvas, FX + sx, sy, WORLD_W, WORLD_H);
    ctx.imageSmoothingEnabled = true;
    // Side shading so the HUD reads on top of the cliffs.
    const gl = ctx.createLinearGradient(0, 0, FX + b.left, 0);
    gl.addColorStop(0, 'rgba(10,8,8,0.92)');
    gl.addColorStop(0.75, 'rgba(10,8,8,0.6)');
    gl.addColorStop(1, 'rgba(10,8,8,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, FX + b.left, VIEW_H);
    const gr = ctx.createLinearGradient(FX + b.right, 0, VIEW_W, 0);
    gr.addColorStop(0, 'rgba(10,8,8,0)');
    gr.addColorStop(0.25, 'rgba(10,8,8,0.6)');
    gr.addColorStop(1, 'rgba(10,8,8,0.92)');
    ctx.fillStyle = gr;
    ctx.fillRect(FX + b.right, 0, VIEW_W - FX - b.right, VIEW_H);
    this.scanlines(ctx);

    const tip = drawHud(ctx, b, input, this.paused || b.phase !== 'play');
    if (b.phase === 'play' && !this.paused) {
      drawCrosshair(ctx, b, input);
      this.drawTouchUi(ctx, b);
    }

    if (this.paused && b.phase === 'play') this.drawPause(ctx);
    else if (b.phase === 'levelup') this.drawLevelUp(ctx, b);
    else if (b.phase === 'reactor') this.drawReactor(ctx, b);
    else if (b.phase === 'won' || b.phase === 'lost') this.drawEnd(ctx, b);
    else if (tip) drawTooltip(ctx, tip, input);
  }

  private drawTouchUi(ctx: CanvasRenderingContext2D, b: Battle) {
    const input = this.input;
    if (!input.touchUsed) return;
    const j = input.joy;
    const cx = j ? j.sx : 150;
    const cy = j ? j.sy : 560;
    ctx.globalAlpha = j ? 0.5 : 0.25;
    ctx.strokeStyle = '#f2e6cc';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.stroke();
    const v = input.joyVector() ?? { x: 0, y: 0 };
    ctx.fillStyle = '#f2e6cc';
    ctx.beginPath();
    ctx.arc(cx + v.x * 50, cy + v.y * 50, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Touch shortcuts: pause and recall.
    if (button(ctx, input, VIEW_W - 222, 104, 100, 40, '暂停', { size: 16 })) this.paused = true;
    if (b.recallReady && button(ctx, input, VIEW_W - 112, 104, 100, 40, '召回', { size: 16 })) b.recall();
  }

  private scanlines(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);
  }

  private dim(ctx: CanvasRenderingContext2D, a = 0.7) {
    ctx.fillStyle = `rgba(6,4,6,${a})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Overlays ignore input for a moment so a shot or a speed key doesn't pick something by accident. */
  private get overlayReady() {
    return this.t - this.overlaySince > 0.35;
  }

  private drawLevelUp(ctx: CanvasRenderingContext2D, b: Battle) {
    const offers = b.offers;
    if (!offers) return;
    let chosen: (typeof offers)[number] | null = null;
    this.dim(ctx, 0.62);
    text(ctx, `升级！  Lv ${b.lvl - b.pendingLevelUps + 1}`, VIEW_W / 2, 120, { size: 40, align: 'center', color: C.gold, lw: 8 });
    text(ctx, b.pendingLevelUps > 1 ? `还有 ${b.pendingLevelUps - 1} 次升级待选` : '选择一项', VIEW_W / 2, 156, {
      size: 16,
      align: 'center',
      color: C.dim,
    });
    const w = 300;
    const h = 360;
    const gap = 28;
    const x0 = VIEW_W / 2 - (offers.length * w + (offers.length - 1) * gap) / 2;
    offers.forEach((o, i) => {
      const x = x0 + i * (w + gap);
      const y = 190;
      const info = offerTitle(o);
      const hv = hover(this.input, x, y, w, h);
      panel(ctx, x, y - (hv ? 6 : 0), w, h, hv);
      const yy = y - (hv ? 6 : 0);
      // Kind ribbon: what this is (ball / passive) on the left, new or the level step on the right.
      const kind = o.kind === 'newBall' || o.kind === 'upBall' ? 'ball' : o.kind === 'heal' ? 'heal' : 'passive';
      const color = KIND[kind];
      const def =
        o.kind === 'newBall' || o.kind === 'newPassive'
          ? o.def
          : o.kind === 'upBall'
            ? o.ob.parts[0].def
            : o.kind === 'upPassive'
              ? o.p.def
              : null;
      const evolved = !!def?.evolved;
      accent(ctx, x, yy, w, h, color, { lv: kind === 'heal' ? 0 : info.lv, evolved });
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(x + 9, yy + 9, w - 18, 40);
      ctx.globalAlpha = 1;
      text(ctx, kind === 'ball' ? '弹珠 · 主动' : kind === 'passive' ? '被动 · 常驻' : '回复', x + 22, yy + 36, { size: 15, color });
      const step =
        o.kind === 'newBall' || o.kind === 'newPassive'
          ? '新'
          : o.kind === 'heal'
            ? ''
            : info.lv >= 3
              ? '升到满级'
              : `Lv${info.lv - 1} → Lv${info.lv}`;
      text(ctx, `${evolved ? '进化 · ' : ''}${step}`, x + w - 22, yy + 36, {
        size: 15,
        align: 'right',
        color: info.lv >= 3 || evolved ? C.gold : step === '新' ? C.green : C.text,
      });
      if (kind !== 'heal') pips(ctx, info.lv, x + w / 2 - 17, yy + 128, color, 10);
      if (o.kind === 'newBall' || o.kind === 'upBall')
        ballIcon(
          ctx,
          [{ def: o.kind === 'newBall' ? o.def : o.ob.parts[0].def, lv: info.lv }],
          x + w / 2,
          yy + 88,
          30,
          info.color !== '' && (o.kind === 'upBall' ? o.ob.parts[0].def.evolved : o.def.evolved),
        );
      else if (o.kind === 'newPassive' || o.kind === 'upPassive')
        passiveIcon(ctx, o.kind === 'newPassive' ? o.def : o.p.def, x + w / 2 - 30, yy + 58, 60);
      else {
        ctx.fillStyle = C.green;
        ctx.fillRect(x + w / 2 - 8, yy + 66, 16, 44);
        ctx.fillRect(x + w / 2 - 22, yy + 80, 44, 16);
      }
      text(ctx, info.name, x + w / 2, yy + 168, { size: 26, align: 'center', color: readable(info.color) });
      text(ctx, info.en, x + w / 2, yy + 190, { size: 13, align: 'center', color: C.dim, weight: 500, outline: false });
      paragraph(ctx, info.desc, x + 22, yy + 222, w - 44, 15, C.text);
      text(ctx, `[${i + 1}]`, x + w / 2, yy + h - 18, { size: 14, align: 'center', color: C.dim });
      if (this.overlayReady && !chosen && ((hv && this.input.clicked(0)) || this.input.wasPressed(`Digit${i + 1}`))) chosen = o;
    });
    if (chosen && b.offers === offers) {
      applyOffer(b, chosen);
      this.sfx('click');
      this.overlaySince = this.t;
      b.resume();
    }
  }

  private drawReactor(ctx: CanvasRenderingContext2D, b: Battle) {
    const opts = b.reactor;
    if (!opts) return;
    this.dim(ctx, 0.7);
    const hue = (this.t * 120) % 360;
    text(ctx, '融合炉', VIEW_W / 2, 110, { size: 42, align: 'center', color: `hsl(${hue},90%,70%)`, lw: 8 });
    const input = this.input;
    const ready = this.overlayReady;
    const done = () => {
      this.reactorView = 'main';
      this.sfx('reactor');
      this.overlaySince = this.t;
      b.resume();
    };
    const view = (v: typeof this.reactorView) => {
      this.reactorView = v;
      this.overlaySince = this.t;
    };
    if (this.reactorView === 'result') {
      text(ctx, '裂变结果', VIEW_W / 2, 170, { size: 22, align: 'center', color: C.gold });
      this.fissionLog.forEach((l, i) => text(ctx, l, VIEW_W / 2, 220 + i * 34, { size: 20, align: 'center' }));
      if ((button(ctx, input, VIEW_W / 2 - 100, 480, 200, 54, '继续') || input.wasPressed('Enter', 'Space')) && ready) done();
      return;
    }
    if (this.reactorView === 'fusion') {
      const fus = opts.find((o) => o.kind === 'fusion');
      text(ctx, '选择要融合的两颗弹珠（保留双方能力，取较高伤害）', VIEW_W / 2, 160, { size: 18, align: 'center', color: C.text });
      if (fus && fus.kind === 'fusion') {
        fus.pairs.slice(0, 8).forEach(([a, c], i) => {
          const x = VIEW_W / 2 - 300 + (i % 2) * 310;
          const y = 190 + Math.floor(i / 2) * 92;
          const hv = hover(input, x, y, 290, 80);
          panel(ctx, x, y, 290, 80, hv);
          ballIcon(ctx, a.parts, x + 40, y + 40, 20);
          text(ctx, '+', x + 72, y + 47, { size: 24, color: C.gold });
          ballIcon(ctx, c.parts, x + 104, y + 40, 20);
          text(ctx, `${a.parts[0].def.zh} × ${c.parts[0].def.zh}`, x + 136, y + 47, { size: 18 });
          if (hv && input.clicked(0) && ready && b.reactor === opts) {
            applyFusion(b, a, c);
            done();
          }
        });
      }
      if (button(ctx, input, VIEW_W / 2 - 80, 600, 160, 48, '返回', { size: 18 }) && ready) view('main');
      return;
    }
    if (this.reactorView === 'evolve') {
      const evo = opts.find((o) => o.kind === 'evolve');
      text(ctx, '选择一种进化', VIEW_W / 2, 160, { size: 18, align: 'center' });
      if (evo && evo.kind === 'evolve') {
        evo.list.slice(0, 9).forEach((e: Evolution, i) => {
          const x = VIEW_W / 2 - 390 + (i % 3) * 270;
          const y = 176 + Math.floor(i / 3) * 154;
          const hv = hover(input, x, y, 250, 148);
          panel(ctx, x, y, 250, 148, hv);
          if (e.type === 'ball') ballIcon(ctx, [{ def: e.result as never, lv: 1 }], x + 40, y + 42, 22, true);
          else passiveIcon(ctx, e.result as never, x + 18, y + 20, 44);
          text(ctx, e.result.zh, x + 76, y + 40, {
            size: 22,
            color: e.type === 'ball' ? readable((e.result as { color: string }).color) : C.gold,
          });
          text(ctx, e.result.en, x + 76, y + 60, { size: 12, color: C.dim, outline: false, weight: 500 });
          const ing = e.type === 'ball' ? e.balls.map((o) => o.parts[0].def.zh) : e.passives.map((p) => p.def.zh);
          text(ctx, ing.join(' + '), x + 18, y + 88, { size: 13, color: C.cyan, outline: false });
          paragraph(ctx, e.result.desc(1), x + 18, y + 108, 214, 11, C.text, 1.3);
          if (hv && input.clicked(0) && ready && b.reactor === opts) {
            applyEvolution(b, e);
            done();
          }
        });
      }
      if (button(ctx, input, VIEW_W / 2 - 80, 640, 160, 48, '返回', { size: 18 }) && ready) view('main');
      return;
    }
    const cards: { title: string; desc: string; enabled: boolean; go: () => void; color: string }[] = [
      {
        title: '裂变',
        desc: '随机获得 1-5 次升级，分配给你的弹珠和被动。全部满级时改为获得金币。',
        enabled: true,
        color: C.cyan,
        go: () => {
          this.fissionLog = applyFission(b);
          view('result');
          this.sfx('levelup');
        },
      },
      {
        title: '融合',
        desc: '把两颗 3 级弹珠合成一颗，同时拥有双方的能力，并空出一个弹珠栏位。',
        enabled: opts.some((o) => o.kind === 'fusion'),
        color: '#ff9ad0',
        go: () => view('fusion'),
      },
      {
        title: '进化',
        desc: '满足配方的 3 级弹珠（或被动）进化成更强的形态，并空出栏位。',
        enabled: opts.some((o) => o.kind === 'evolve'),
        color: C.gold,
        go: () => view('evolve'),
      },
    ];
    let acted = false;
    cards.forEach((c, i) => {
      const w = 280;
      const x = VIEW_W / 2 - (3 * w + 2 * 28) / 2 + i * (w + 28);
      const y = 190;
      const hv = c.enabled && hover(input, x, y, w, 300);
      panel(ctx, x, y - (hv ? 6 : 0), w, 300, hv);
      ctx.globalAlpha = c.enabled ? 1 : 0.4;
      text(ctx, c.title, x + w / 2, y + 70, { size: 36, align: 'center', color: c.color });
      paragraph(ctx, c.desc, x + 24, y + 130, w - 48, 16, C.text);
      if (!c.enabled) text(ctx, '需要两颗以上 3 级弹珠', x + w / 2, y + 260, { size: 14, align: 'center', color: C.dim });
      ctx.globalAlpha = 1;
      if (!acted && ready && ((hv && input.clicked(0)) || (c.enabled && input.wasPressed(`Digit${i + 1}`)))) {
        acted = true;
        this.sfx('click');
        c.go();
      }
    });
  }

  private drawPause(ctx: CanvasRenderingContext2D) {
    this.dim(ctx, 0.65);
    text(ctx, '暂停', VIEW_W / 2, 200, { size: 48, align: 'center', color: C.gold, lw: 8 });
    const x = VIEW_W / 2 - 130;
    if (button(ctx, this.input, x, 260, 260, 56, '继续游戏') || this.input.wasPressed('Enter')) this.paused = false;
    if (button(ctx, this.input, x, 330, 260, 56, '重新开始')) this.startRun();
    if (button(ctx, this.input, x, 400, 260, 56, '返回标题')) {
      this.screen = 'title';
      this.battle = null;
    }
    text(ctx, `音效：${this.audio.muted ? '关' : '开'}（M 切换）`, VIEW_W / 2, 500, { size: 16, align: 'center', color: C.dim });
  }

  private drawEnd(ctx: CanvasRenderingContext2D, b: Battle) {
    if (!this.endHandled) {
      this.endHandled = true;
      this.newUnlocks = [];
      if (b.phase === 'won') {
        this.save.clears++;
        if (b.level.id === 'boneyard' && (this.save.best === null || b.t < this.save.best)) this.save.best = b.t;
        if (!this.save.unlocks.includes(b.level.grants)) {
          this.save.unlocks.push(b.level.grants);
          this.newUnlocks = b.level.rewards;
        }
        this.writeSave();
      }
    }
    this.dim(ctx, 0.75);
    const won = b.phase === 'won';
    text(ctx, won ? '胜利！' : '你倒下了', VIEW_W / 2, 150, { size: 56, align: 'center', color: won ? C.gold : C.red, lw: 10 });
    text(ctx, won ? `${b.level.zh}通关！` : `倒在了${b.level.zh}的第 ${b.stage.segment + 1} 段`, VIEW_W / 2, 192, {
      size: 20,
      align: 'center',
    });
    const rows: [string, string][] = [
      ['角色', b.char.zh],
      ['用时', fmtTime(b.t)],
      ['等级', `${b.lvl}`],
      ['击杀', `${b.kills}`],
      ['总伤害', `${Math.round(b.damageDealt).toLocaleString()}`],
      ['金币', `${b.gold}`],
    ];
    rows.forEach(([k, v], i) => {
      text(ctx, k, VIEW_W / 2 - 120, 246 + i * 28, { size: 18, color: C.dim });
      text(ctx, v, VIEW_W / 2 + 20, 246 + i * 28, { size: 18 });
    });
    const by = 246 + rows.length * 28 + 6;
    b.owned.forEach((ob, i) =>
      ballIcon(
        ctx,
        ob.parts,
        VIEW_W / 2 - 100 + i * 44,
        by + 10,
        15,
        ob.parts.some((p) => p.def.evolved),
      ),
    );
    b.passives.forEach((p, i) => passiveIcon(ctx, p.def, VIEW_W / 2 - 116 + i * 44, by + 34, 32));
    // Two columns, so a first clear's long unlock list stays clear of the leaderboard box.
    this.newUnlocks.forEach((u, i) =>
      text(ctx, `解锁 · ${u}`, VIEW_W / 2 + (i % 2 ? 190 : -190), by + 80 + Math.floor(i / 2) * 22, {
        size: 15,
        align: 'center',
        color: C.green,
      }),
    );
    // Leaderboard submission (only when served by server.mjs; a static host like GitHub Pages has no board).
    const ly = 556;
    if (!this.board) {
      // no leaderboard server
    } else if (this.submitState === 'done') {
      text(ctx, `已上榜：第 ${this.myRank} 名（共 ${this.board?.total ?? 0} 条成绩）`, VIEW_W / 2, ly + 30, {
        size: 18,
        align: 'center',
        color: C.gold,
      });
    } else if (this.submitState === 'sending') {
      text(ctx, '提交中…', VIEW_W / 2, ly + 30, { size: 18, align: 'center', color: C.dim });
    } else {
      this.placeInput(VIEW_W / 2 - 200, ly + 6, 240, 40);
      if (button(ctx, this.input, VIEW_W / 2 + 50, ly + 4, 150, 44, this.submitState === 'failed' ? '重试上榜' : '上榜', { size: 18 }))
        this.submit();
    }
    const y = 620;
    const typing = document.activeElement === this.nameInput;
    if (button(ctx, this.input, VIEW_W / 2 - 410, y, 260, 56, '再来一局') || (!typing && this.input.wasPressed('Enter'))) this.startRun();
    if (button(ctx, this.input, VIEW_W / 2 - 130, y, 260, 56, '选择角色')) {
      this.screen = 'select';
      this.battle = null;
    }
    if (button(ctx, this.input, VIEW_W / 2 + 150, y, 260, 56, '返回标题') || (!typing && this.input.wasPressed('Escape'))) {
      this.screen = 'title';
      this.battle = null;
    }
    text(ctx, 'Enter 再来一局 · Esc 返回标题', VIEW_W / 2, y + 80, { size: 14, align: 'center', color: C.dim });
  }

  // ---------------------------------------------------------------- menus

  private drawBackdrop(ctx: CanvasRenderingContext2D, dt: number) {
    ctx.fillStyle = '#120e10';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const bl of this.titleBalls) {
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      if (bl.x < bl.r || bl.x > VIEW_W - bl.r) bl.vx *= -1;
      if (bl.y < bl.r || bl.y > VIEW_H - bl.r) bl.vy *= -1;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = bl.c;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, bl.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.scanlines(ctx);
  }

  private drawTitle(ctx: CanvasRenderingContext2D, dt: number) {
    this.drawBackdrop(ctx, dt);
    const bob = Math.sin(this.t * 2) * 4;
    text(ctx, GAME.zh, VIEW_W / 2, 200 + bob, { size: 92, align: 'center', color: C.gold, lw: 14, weight: 900 });
    text(ctx, GAME.en.toUpperCase(), VIEW_W / 2, 262, { size: 28, align: 'center', color: C.text, lw: 6, weight: 900 });
    text(ctx, '打砖块 × 肉鸽 · 一层层往坑底打下去', VIEW_W / 2, 306, { size: 18, align: 'center', color: C.dim });
    const x = VIEW_W / 2 - 140;
    if (button(ctx, this.input, x, 370, 280, 62, '开始游戏', { size: 24 }) || this.input.wasPressed('Enter', 'Space')) {
      this.sfx('click');
      this.screen = 'select';
    }
    if (button(ctx, this.input, x, 448, 280, 54, '玩法说明')) {
      this.sfx('click');
      this.screen = 'help';
    }
    this.drawBoard(ctx);
    const s = this.save;
    text(ctx, `已游玩 ${s.runs} 局 · 通关 ${s.clears} 次${s.best !== null ? ` · 最快 ${fmtTime(s.best)}` : ''}`, VIEW_W / 2, 560, {
      size: 15,
      align: 'center',
      color: C.dim,
    });
    const footer = `v${GAME.version} · 开源项目（${GAME.license}）${GAME.repo ? ` · ${GAME.repo}` : ''} · 非官方作品，玩法致敬 Kenny Sun / Devolver Digital 的《BALL x PIT》`;
    text(ctx, footer, VIEW_W / 2, VIEW_H - 24, {
      size: 13,
      align: 'center',
      color: '#6a5e4c',
      outline: false,
      weight: 500,
    });
  }

  private drawBoard(ctx: CanvasRenderingContext2D) {
    if (this.t - this.boardAt > 15) {
      this.boardAt = this.t;
      void fetchBoard().then((b) => {
        if (b) this.board = b;
      });
    }
    const b = this.board;
    if (!b) return;
    const x = VIEW_W - 330;
    const y = 330;
    const rows = b.top.slice(0, 8);
    panel(ctx, x, y, 300, 70 + Math.max(1, rows.length) * 30, false, 0.9);
    text(ctx, '局域网排行榜', x + 150, y + 36, { size: 20, align: 'center', color: C.gold });
    if (!rows.length)
      text(ctx, '还没有人上榜，快来当第一个！', x + 150, y + 76, { size: 14, align: 'center', color: C.dim, outline: false });
    rows.forEach((r, i) => {
      const yy = y + 72 + i * 30;
      text(ctx, `${i + 1}`, x + 26, yy, { size: 15, align: 'center', color: i < 3 ? C.gold : C.dim });
      text(ctx, r.name, x + 46, yy, { size: 15, color: C.text, outline: false });
      text(ctx, `${r.stage ?? ''} ${r.char}`, x + 150, yy, { size: 12, color: C.dim, outline: false, weight: 500 });
      text(ctx, r.won ? fmtTime(r.time) : `${Math.round(r.progress * 100)}%`, x + 280, yy, {
        size: 15,
        align: 'right',
        color: r.won ? C.green : C.dim,
        outline: false,
      });
    });
  }

  private drawHelp(ctx: CanvasRenderingContext2D) {
    this.drawBackdrop(ctx, 0);
    panel(ctx, 140, 50, VIEW_W - 280, VIEW_H - 100, false, 0.96);
    text(ctx, '玩法说明', VIEW_W / 2, 104, { size: 34, align: 'center', color: C.gold });
    const lines = [
      '· WASD 移动，鼠标瞄准（只能朝上方发射），按住左键或空格发射；F 切换自动射击（默认开）。',
      '· 弹珠会在墙壁、坑道顶端和敌人之间反弹；从底边飞出的弹珠过 2-3 秒才会回到你手里。',
      '· 用身体接住落下的弹珠会立刻重新发射，这是提高输出的关键。',
      '· 骷髅们会随地面一起向下推进：靠近会被近战攻击，冲到底部也会伤到你。',
      '· 击杀掉落经验宝石，要走过去捡；升级时三选一：新弹珠、升级弹珠、新被动或升级被动。',
      '· 弹珠和被动最高 3 级，各 4 个栏位。彩虹色的「融合炉」由精英掉落：裂变、融合或进化。',
      '· 进化需要配方里的弹珠全部 3 级，例如：燃烧 + 黑铁 = 炸弹，冰冻 + 幽灵 = 怨灵。',
      '· 关卡分三段，前两段末尾各有一个精英首领，击败后坑道会拓宽；最后是关底首领。',
      '· 骷髅王只有王冠和下巴是弱点；冰缚女王被冰盾环绕，要把球弹到她身后。带盾的敌人正面免伤。',
      '· 通关白骨坟场会解锁第二层「雪漫湾岸」和新角色；冰锥会把你冻住片刻。',
      '· 1/2/3 切换游戏速度，右键召回卡在后面的弹珠，Esc 暂停，M 静音。手机横屏：左侧拖动移动，右侧按住瞄准射击。',
    ];
    lines.forEach((l, i) => paragraph(ctx, l, 190, 150 + i * 40, VIEW_W - 380, 17, C.text));
    if (button(ctx, this.input, VIEW_W / 2 - 110, VIEW_H - 130, 220, 52, '返回') || this.input.wasPressed('Escape', 'Enter'))
      this.screen = 'title';
  }

  private drawSelect(ctx: CanvasRenderingContext2D) {
    this.drawBackdrop(ctx, 0.016);
    const input = this.input;
    text(ctx, '选择角色与关卡', VIEW_W / 2, 56, { size: 34, align: 'center', color: C.gold, lw: 8 });
    if (input.wasPressed('ArrowLeft', 'KeyA')) this.charIdx = (this.charIdx + CHARACTERS.length - 1) % CHARACTERS.length;
    if (input.wasPressed('ArrowRight', 'KeyD')) this.charIdx = (this.charIdx + 1) % CHARACTERS.length;
    if (input.wasPressed('ArrowUp', 'KeyW')) this.levelIdx = Math.max(0, this.levelIdx - 1);
    if (input.wasPressed('ArrowDown', 'KeyS')) this.levelIdx = Math.min(LEVELS.length - 1, this.levelIdx + 1);

    // Character strip
    const cw = 146;
    const gap = 12;
    const x0 = VIEW_W / 2 - (CHARACTERS.length * cw + (CHARACTERS.length - 1) * gap) / 2;
    CHARACTERS.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      const y = 82;
      const sel = this.charIdx === i;
      const hv = hover(input, x, y, cw, 150);
      panel(ctx, x, y, cw, 150, sel || hv);
      const ok = this.isUnlocked(c);
      ctx.globalAlpha = ok ? 1 : 0.3;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite(`player_${c.id}`), x + cw / 2 - 32, y + 16, 64, 64);
      ctx.imageSmoothingEnabled = true;
      text(ctx, c.zh, x + cw / 2, y + 108, { size: 20, align: 'center', color: sel ? C.gold : C.text });
      text(ctx, c.en.replace('The ', ''), x + cw / 2, y + 130, { size: 11, align: 'center', color: C.dim, outline: false, weight: 500 });
      ctx.globalAlpha = 1;
      if (!ok) drawLock(ctx, x + cw - 24, y + 26);
      if (hv && input.clicked(0)) {
        this.charIdx = i;
        this.sfx('click');
      }
    });

    // Character details
    const c = CHARACTERS[this.charIdx];
    const unlocked = this.isUnlocked(c);
    const dx = x0;
    const dy = 252;
    panel(ctx, dx, dy, 600, 336, false);
    text(ctx, c.zh, dx + 28, dy + 48, { size: 30, color: C.gold });
    text(ctx, c.en, dx + 28 + ctx.measureText(c.zh).width + 24, dy + 46, { size: 14, color: C.dim, outline: false, weight: 500 });
    ballIcon(ctx, [{ def: BALLS[c.startBall], lv: 1 }], dx + 44, dy + 84, 14);
    text(ctx, `初始弹珠：${BALLS[c.startBall].zh}`, dx + 66, dy + 90, { size: 16, outline: false });
    const stats: [string, number][] = [
      ['耐力', c.stats.end],
      ['力量', c.stats.str],
      ['统率', c.stats.lea],
      ['速度', c.stats.spd],
      ['敏捷', c.stats.dex],
      ['智力', c.stats.int],
    ];
    stats.forEach(([k, v], j) => {
      const yy = dy + 116 + j * 24;
      text(ctx, k, dx + 28, yy + 13, { size: 14, color: C.dim, outline: false, weight: 500 });
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(dx + 74, yy + 2, 200, 13);
      ctx.fillStyle = c.color;
      ctx.fillRect(dx + 74, yy + 2, (200 * v) / 12, 13);
      text(ctx, `${v}`, dx + 286, yy + 13, { size: 13, color: C.text, outline: false });
    });
    text(ctx, '特性', dx + 320, dy + 128, { size: 15, color: C.dim });
    paragraph(ctx, c.ability, dx + 320, dy + 156, 250, 16, C.text);
    paragraph(ctx, c.flavor, dx + 320, dy + 270, 250, 13, C.dim);
    if (!unlocked) {
      const need = c.unlock === 'boneyard' ? '白骨坟场' : '雪漫湾岸';
      ctx.fillStyle = 'rgba(10,8,8,0.8)';
      ctx.fillRect(dx + 10, dy + 104, 580, 70);
      drawLock(ctx, dx + 160, dy + 130);
      text(ctx, `通关「${need}」后解锁`, dx + 190, dy + 146, { size: 20, color: C.gold });
    }

    // Levels
    const lx = dx + 620;
    const lw = x0 + CHARACTERS.length * (cw + gap) - gap - lx;
    LEVELS.forEach((l, i) => {
      const y = dy + i * 172;
      const open = this.levelOpen(l);
      const sel = this.levelIdx === i;
      const hv = open && hover(input, lx, y, lw, 160);
      panel(ctx, lx, y, lw, 160, sel || hv);
      ctx.fillStyle = l.palette.floor;
      ctx.fillRect(lx + 12, y + 12, 100, 136);
      ctx.fillStyle = l.palette.pedestal;
      for (let k = 0; k < 6; k++) ctx.fillRect(lx + 20 + (k % 3) * 30, y + 24 + Math.floor(k / 3) * 34, 24, 24);
      ctx.globalAlpha = open ? 1 : 0.35;
      text(ctx, `第 ${l.layer} 层`, lx + 128, y + 40, { size: 14, color: C.dim });
      text(ctx, l.zh, lx + 128, y + 76, { size: 28, color: sel ? C.gold : C.text });
      text(ctx, l.en, lx + 128, y + 102, { size: 13, color: C.dim, outline: false, weight: 500 });
      const cleared = this.unlocks.has(l.grants);
      text(ctx, cleared ? '已通关' : `首领：${l.boss === 'king' ? '骷髅王' : '冰缚女王'}`, lx + 128, y + 134, {
        size: 14,
        color: cleared ? C.green : C.dim,
        outline: false,
      });
      ctx.globalAlpha = 1;
      if (!open) {
        drawLock(ctx, lx + lw - 40, y + 40);
        text(ctx, '通关上一层后解锁', lx + lw - 20, y + 134, { size: 13, align: 'right', color: C.gold, outline: false });
      }
      if (hv && input.clicked(0)) {
        this.levelIdx = i;
        this.sfx('click');
      }
    });

    const ok = unlocked && this.levelOpen(LEVELS[this.levelIdx]);
    const label = ok ? `出发！（${c.zh} · ${LEVELS[this.levelIdx].zh}）` : '尚未解锁';
    if (
      button(ctx, input, VIEW_W / 2 - 190, 612, 380, 62, label, { size: 22, disabled: !ok }) ||
      (ok && input.wasPressed('Enter', 'Space'))
    ) {
      this.sfx('click');
      this.startRun();
    }
    if (button(ctx, input, 40, VIEW_H - 76, 140, 48, '返回', { size: 18 }) || input.wasPressed('Escape')) this.screen = 'title';
  }
}
