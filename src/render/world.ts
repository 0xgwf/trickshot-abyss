import type { Battle, Player } from '../game/battle.ts';
import type { Ball } from '../game/ball.ts';
import { TILE, WORLD_H, WORLD_W } from '../game/config.ts';
import type { Enemy } from '../game/enemy.ts';
import type { Palette } from '../game/data/levels.ts';
import { hasSprite, sprite } from './pixel.ts';

// The world is drawn at half resolution and scaled up 2× without smoothing, for a chunky
// low-res look (the original uses low-res textures on low-poly 3D).
export const LOW = 0.5;

/** lowbias32 integer hash → [0, 1). */
const hash = (n: number) => {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export class WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD_W * LOW;
    this.canvas.height = WORLD_H * LOW;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  private pal!: Palette;

  draw(b: Battle) {
    const ctx = this.ctx;
    this.pal = b.level.palette;
    ctx.setTransform(LOW, 0, 0, LOW, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawGround(b);
    this.drawZones(b);
    this.drawDrops(b);
    for (const e of b.enemies) if (!e.dead && e.def.rank === 'normal') this.drawEnemy(b, e);
    for (const e of b.enemies) if (!e.dead && e.def.rank === 'miniboss') this.drawMiniboss(b, e);
    if (b.stage.boss?.def.ai === 'king') this.drawKing(b, b.stage.boss);
    if (b.stage.boss?.def.ai === 'queen') this.drawQueen(b, b.stage.boss);
    this.drawAllies(b);
    this.drawWarnings(b);
    this.drawPlayer(b);
    this.drawBalls(b);
    this.drawMinions(b);
    this.drawShots(b);
    this.drawFx(b);
    // Fog at the top where enemies come from.
    const g = ctx.createLinearGradient(0, 0, 0, TILE * 1.2);
    g.addColorStop(0, `rgba(${this.pal.fog},0.85)`);
    g.addColorStop(1, `rgba(${this.pal.fog},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, TILE * 1.2);
    // Soft vignette towards the bottom corners.
    const v = ctx.createRadialGradient(WORLD_W / 2, WORLD_H * 0.45, WORLD_H * 0.35, WORLD_W / 2, WORLD_H * 0.45, WORLD_H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  // ---------------------------------------------------------------- ground

  private drawGround(b: Battle) {
    const ctx = this.ctx;
    const P = this.pal;
    const off = b.stage.floorY % TILE;
    const baseRow = Math.floor(b.stage.floorY / TILE);
    // Cliffs on both sides.
    ctx.fillStyle = P.cliff;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let r = -1; r <= WORLD_H / TILE + 1; r++) {
      const y = r * TILE + off;
      const rowId = baseRow - r;
      for (let c = 0; c < WORLD_W / TILE; c++) {
        const h = hash(Math.imul(rowId, 83492791) ^ Math.imul(c + 7, 2971215073));
        const x = c * TILE + (rowId % 2 ? TILE / 2 : 0);
        ctx.fillStyle = h < 0.33 ? P.cliffLight : h < 0.66 ? P.cliff : P.cliffDark;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        // Occasional decoration on the cliffs (only where the corridor isn't).
        if (x + TILE < b.left - 6 || x > b.right + 6)
          this.cliffDeco(b, x, y, hash(Math.imul(rowId, 19349663) ^ Math.imul(c + 3, 83492791)));
      }
    }
    // Floor.
    ctx.fillStyle = P.floor;
    ctx.fillRect(b.left, 0, b.right - b.left, WORLD_H);
    for (let r = -1; r <= WORLD_H / TILE + 1; r++) {
      const y = Math.round(r * TILE + off);
      const rowId = baseRow - r;
      ctx.fillStyle = P.floorDark;
      ctx.fillRect(b.left, y, b.right - b.left, 2);
      for (let c = 0; c < 14; c++) {
        const x = b.left + c * TILE;
        if (x >= b.right) break;
        ctx.fillStyle = P.floorDark;
        ctx.fillRect(x, y, 2, TILE);
        const h = hash(Math.imul(rowId, 73856093) ^ Math.imul(c + 1, 19349663));
        if (h < 0.35) {
          ctx.fillStyle = P.speck;
          ctx.fillRect(x + 6 + h * 60, y + 10 + h * 40, 6, 4);
          ctx.fillRect(x + 20 - h * 20, y + 28, 4, 4);
        } else if (h > 0.93 && P.deco === 'snow') {
          // A snow drift.
          ctx.fillStyle = '#e8eeff';
          ctx.fillRect(x + 10, y + 24, 24, 8);
          ctx.fillRect(x + 16, y + 18, 12, 6);
        } else if (h > 0.93) {
          // A stray bone.
          ctx.fillStyle = '#a89870';
          ctx.fillRect(x + 12, y + 22, 18, 4);
          ctx.fillRect(x + 10, y + 20, 4, 8);
          ctx.fillRect(x + 28, y + 20, 4, 8);
        }
      }
    }
    // Wall edges.
    for (const [x, dir] of [
      [b.left, -1],
      [b.right, 1],
    ] as const) {
      ctx.fillStyle = '#0c1210';
      ctx.fillRect(dir < 0 ? x - 8 : x, 0, 8, WORLD_H);
      ctx.fillStyle = P.wallEdge;
      ctx.fillRect(dir < 0 ? x - 4 : x + 2, 0, 2, WORLD_H);
    }
  }

  private cliffDeco(b: Battle, x: number, y: number, h: number) {
    const ctx = this.ctx;
    if (this.pal.deco === 'bone') {
      if (h < 0.05) {
        // Skull
        ctx.fillStyle = '#c8bc94';
        ctx.fillRect(x + 14, y + 14, 20, 16);
        ctx.fillRect(x + 18, y + 30, 12, 6);
        ctx.fillStyle = '#121a17';
        ctx.fillRect(x + 17, y + 19, 5, 5);
        ctx.fillRect(x + 26, y + 19, 5, 5);
      } else if (h < 0.08) {
        // Torch with a flickering flame and glow
        ctx.fillStyle = '#5a3a20';
        ctx.fillRect(x + 21, y + 18, 6, 22);
        const f = Math.sin(b.t * 13 + x) * 2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,150,60,0.18)';
        ctx.beginPath();
        ctx.arc(x + 24, y + 14, 26 + f, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ff9a3a';
        ctx.fillRect(x + 19, y + 6 + f, 10, 12);
        ctx.fillStyle = '#ffe070';
        ctx.fillRect(x + 22, y + 10 + f, 4, 6);
      }
    } else if (h < 0.08) {
      // Icicles hanging from a snow cap
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(x + 4, y + 4, TILE - 8, 6);
      ctx.fillStyle = '#a8d8ff';
      for (let i = 0; i < 4; i++) {
        const ix = x + 8 + i * 9;
        const len = 8 + ((i * 7 + Math.floor(h * 100)) % 12);
        ctx.beginPath();
        ctx.moveTo(ix, y + 10);
        ctx.lineTo(ix + 3, y + 10 + len);
        ctx.lineTo(ix + 6, y + 10);
        ctx.fill();
      }
    }
  }

  private drawZones(b: Battle) {
    const ctx = this.ctx;
    for (const z of b.zones) {
      const a = Math.min(1, z.life / 0.5, (z.maxLife - z.life) / 0.2 + 0.3);
      ctx.globalAlpha = Math.max(0, a) * 0.75;
      switch (z.kind) {
        case 'lava':
          ctx.fillStyle = '#ff6a00';
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffd040';
          ctx.fillRect(z.x - 4, z.y - 4, 8, 8);
          break;
        case 'tar':
          ctx.fillStyle = '#1e2a14';
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#57774a';
          ctx.fillRect(z.x - 6, z.y - 3, 6, 6);
          break;
        case 'spike':
          ctx.fillStyle = '#c8f4ff';
          ctx.beginPath();
          ctx.moveTo(z.x, z.y - z.r);
          ctx.lineTo(z.x + z.r * 0.7, z.y + z.r * 0.6);
          ctx.lineTo(z.x - z.r * 0.7, z.y + z.r * 0.6);
          ctx.fill();
          break;
        case 'meteor': {
          ctx.globalAlpha *= 0.4;
          ctx.fillStyle = '#ff3a12';
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          const t = (b.t * 7) % 1;
          for (let i = 0; i < 3; i++) {
            const h = hash(Math.floor(b.t * 7) * 3 + i + Math.floor(z.x));
            const mx = z.x + (h - 0.5) * z.r * 1.6;
            const my = z.y + (hash(i * 17 + Math.floor(b.t * 7)) - 0.5) * z.r * 1.6;
            ctx.fillStyle = '#ffb040';
            ctx.fillRect(mx - 6, my - 40 * (1 - t) - 6, 12, 12);
          }
          break;
        }
        case 'landslide':
          ctx.fillStyle = '#7a5a3a';
          for (let i = 0; i < 6; i++) {
            const h1 = hash(i * 13 + Math.floor(z.x));
            const h2 = hash(i * 31 + Math.floor(z.y));
            const ox = (h1 - 0.5) * z.r * 1.6;
            const oy = (h2 - 0.5) * z.r * 1.6 + Math.sin(b.t * 10 + i) * 3;
            ctx.fillRect(z.x + ox - 8, z.y + oy - 8, 16, 16);
          }
          ctx.globalAlpha *= 0.3;
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'snare':
          ctx.strokeStyle = '#c0a0ff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawDrops(b: Battle) {
    const ctx = this.ctx;
    for (const d of b.drops) {
      const bob = Math.sin((b.t + d.x) * 5) * 2;
      switch (d.kind) {
        case 'gem': {
          const s = d.value >= 5 ? 14 : d.value >= 3 ? 12 : 10;
          ctx.fillStyle = '#2aa8c0';
          ctx.fillRect(d.x - s / 2, d.y - s / 2 + bob, s, s);
          ctx.fillStyle = '#9ff0ff';
          ctx.fillRect(d.x - s / 2, d.y - s / 2 + bob, s / 2, s / 2);
          break;
        }
        case 'gold':
          ctx.fillStyle = '#c08a20';
          ctx.fillRect(d.x - 6, d.y - 6 + bob, 12, 12);
          ctx.fillStyle = '#ffe070';
          ctx.fillRect(d.x - 4, d.y - 4 + bob, 6, 6);
          break;
        case 'potion':
          ctx.fillStyle = '#e0d8c8';
          ctx.fillRect(d.x - 3, d.y - 14 + bob, 6, 6);
          ctx.fillStyle = '#d02838';
          ctx.fillRect(d.x - 8, d.y - 8 + bob, 16, 16);
          ctx.fillStyle = '#ff7080';
          ctx.fillRect(d.x - 6, d.y - 6 + bob, 6, 6);
          break;
        case 'reactor': {
          const hue = (b.t * 200) % 360;
          ctx.fillStyle = `hsl(${hue},90%,60%)`;
          ctx.beginPath();
          ctx.arc(d.x, d.y + bob, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsl(${(hue + 120) % 360},90%,70%)`;
          ctx.beginPath();
          ctx.arc(d.x, d.y + bob, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(d.x, d.y + bob, 18 + Math.sin(b.t * 6) * 3, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- enemies

  private pedestal(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    const P = this.pal;
    ctx.fillStyle = P.pedestalDark;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = P.pedestal;
    ctx.fillRect(x + 4, y + 4, w - 8, h - 10);
    ctx.fillStyle = P.pedestalLight;
    ctx.fillRect(x + 4, y + 4, w - 8, 4);
    ctx.fillRect(x + 4, y + 4, 4, h - 10);
  }

  private drawEnemy(b: Battle, e: Enemy) {
    const ctx = this.ctx;
    const sx = e.shake > 0 ? Math.sin(b.t * 80) * 3 : 0;
    const x = Math.round(e.x + sx);
    const y = Math.round(e.y);
    this.pedestal(x, y, e.w, e.h);
    const want = e.def.sprite ?? e.def.id;
    const name = hasSprite(want) ? want : 'warrior';
    ctx.drawImage(sprite(name, e.flash > 0, e.def.tint), x + 8, y + 4, 32, 32);
    if (e.garbage) {
      // Rows sent by the opponent in versus: greyed out, like Tetris garbage.
      ctx.fillStyle = 'rgba(64,64,76,0.5)';
      ctx.fillRect(x + 2, y + 2, e.w - 4, e.h - 4);
      ctx.strokeStyle = '#9a9aa8';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, e.w - 6, e.h - 6);
    }
    if (e.def.immuneSide === 'front') {
      // Shield edge on the front (bottom) side.
      ctx.fillStyle = '#e0f4ff';
      ctx.fillRect(x + 4, y + e.h - 8, e.w - 8, 4);
    }
    this.statusOverlay(b, e, x, y);
    if (e.windup > 0) {
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(x + e.w / 2 - 3, y - 18, 6, 10);
      ctx.fillRect(x + e.w / 2 - 3, y - 6, 6, 4);
    }
    if (e.hp < e.maxHp) {
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(x + 4, y + e.h - 6, e.w - 8, 4);
      ctx.fillStyle = '#e04040';
      ctx.fillRect(x + 4, y + e.h - 6, Math.max(2, (e.w - 8) * (e.hp / e.maxHp)), 4);
    }
  }

  private statusOverlay(b: Battle, e: Enemy, x: number, y: number) {
    const ctx = this.ctx;
    if (e.freeze > 0) {
      ctx.fillStyle = 'rgba(140,220,255,0.45)';
      ctx.fillRect(x + 2, y + 2, e.w - 4, e.h - 4);
      ctx.strokeStyle = '#e8fbff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, e.w - 6, e.h - 6);
    }
    let ix = x + 2;
    const icon = (color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(ix, y - 4, 6, 6);
      ix += 8;
    };
    if (e.burn.stacks > 0 || e.darkflame.stacks > 0) {
      const flick = Math.sin(b.t * 20 + e.x) > 0 ? 2 : 0;
      ctx.fillStyle = e.darkflame.stacks > 0 ? '#b06cff' : '#ff8a3d';
      ctx.fillRect(x + 10, y + 6 - flick, 6, 8);
      ctx.fillRect(x + 30, y + 8 + flick, 6, 6);
      ctx.fillStyle = '#ffe070';
      ctx.fillRect(x + 12, y + 10 - flick, 2, 4);
    }
    if (e.poison.stacks > 0 || e.venom.stacks > 0 || e.disease.stacks > 0) icon(e.disease.stacks ? '#c7e05a' : '#8fdc4a');
    if (e.bleed > 0) icon('#e0334f');
    if (e.curse) icon('#b06cff');
    if (e.radiation > 0) icon('#a8ff4a');
    if (e.frostburn.stacks > 0) icon('#86c8ff');
    if (e.slowTimer > 0) icon('#a9f2d2');
    if (e.blind > 0) icon('#303030');
    if (e.leech) icon('#8a2446');
    if (e.rod) {
      ctx.fillStyle = '#f2e27a';
      ctx.fillRect(x + e.w - 10, y - 10, 4, 18);
    }
  }

  private cracks(e: Enemy, x: number, y: number) {
    const ctx = this.ctx;
    const frac = 1 - e.hp / e.maxHp;
    const n = Math.floor(frac * 10);
    ctx.strokeStyle = '#120c08';
    ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      const h1 = hash(i * 13 + 5);
      const h2 = hash(i * 29 + 11);
      let cx = x + h1 * e.w;
      let cy = y + h2 * e.h;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 3; s++) {
        cx += (hash(i * 7 + s) - 0.5) * 30;
        cy += (hash(i * 11 + s * 3) - 0.5) * 30;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }

  private drawMiniboss(b: Battle, e: Enemy) {
    const ctx = this.ctx;
    const sx = e.shake > 0 ? Math.sin(b.t * 80) * 3 : 0;
    const x = Math.round(e.x + sx);
    const y = Math.round(e.y);
    this.pedestal(x, y, e.w, e.h);
    // Bosses get hit constantly, so they get a soft overlay instead of a full white flash.
    const flash = false;
    if (e.def.id === 'brigade') {
      // A phalanx of three shield-bearing skeletons under a banner.
      ctx.fillStyle = flash ? '#fff' : '#7a1818';
      ctx.fillRect(x + e.w / 2 - 3, y - 20, 6, 50);
      ctx.fillStyle = flash ? '#fff' : '#c83030';
      ctx.fillRect(x + e.w / 2 + 3, y - 20, 28, 20);
      ctx.fillStyle = '#f0c040';
      ctx.fillRect(x + e.w / 2 + 12, y - 14, 8, 8);
      for (let i = 0; i < 3; i++) {
        ctx.drawImage(sprite('bastion', flash), x + 6 + i * 46, y + 18, 48, 48);
      }
    } else if (e.def.id === 'champion') {
      // A giant shield knight: immune from the front, hit it from the sides or behind.
      ctx.drawImage(sprite('bastion', flash, 'ice'), x + e.w / 2 - 44, y - 6, 88, 88);
      ctx.fillStyle = flash ? '#fff' : '#e0f4ff';
      ctx.fillRect(x + 6, y + e.h - 14, e.w - 12, 10);
      ctx.fillStyle = '#7a9cc8';
      for (let i = 0; i < 6; i++) ctx.fillRect(x + 12 + i * 22, y + e.h - 12, 8, 6);
    } else if (e.def.id === 'howler') {
      ctx.drawImage(sprite('beast', flash, 'ice'), x + e.w / 2 - 56, y - 14, 112, 112);
      if (e.shake > 0) {
        ctx.fillStyle = 'rgba(190,230,255,0.5)';
        ctx.beginPath();
        ctx.arc(x + 30, y + 30, 24 + Math.sin(b.t * 30) * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Bone Ballista: a huge crossbow.
      ctx.fillStyle = flash ? '#fff' : '#4a3020';
      ctx.fillRect(x + 20, y + 40, e.w - 40, 30);
      ctx.fillStyle = flash ? '#fff' : '#7a5232';
      ctx.fillRect(x + e.w / 2 - 10, y + 6, 20, e.h - 16);
      ctx.fillStyle = flash ? '#fff' : '#e8dcb0';
      ctx.fillRect(x + 8, y + 22, e.w - 16, 10);
      ctx.fillRect(x + 8, y + 22, 10, 30);
      ctx.fillRect(x + e.w - 18, y + 22, 10, 30);
      ctx.strokeStyle = '#d8d0c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 52);
      ctx.lineTo(x + e.w / 2, y + 70 + (e.windup > 0 ? 10 : 0));
      ctx.lineTo(x + e.w - 12, y + 52);
      ctx.stroke();
      ctx.fillStyle = '#c4ccd6';
      ctx.fillRect(x + e.w / 2 - 4, y + 60, 8, 30);
      ctx.drawImage(sprite('archer', flash), x + 4, y + 50, 40, 40);
      ctx.drawImage(sprite('archer', flash), x + e.w - 44, y + 50, 40, 40);
    }
    if (e.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + 2, y + 2, e.w - 4, e.h - 4);
    }
    this.cracks(e, x, y);
    this.statusOverlay(b, e, x, y);
  }

  private drawKing(b: Battle, e: Enemy) {
    const ctx = this.ctx;
    const k = b.stage.kingState;
    const flash = e.flash > 0;
    const sx = e.shake > 0 ? Math.sin(b.t * 80) * 4 : 0;
    const x = e.x + sx;
    const y = e.y;
    const T = TILE;
    const bone = flash ? '#f6eccc' : '#e8dcb0';
    const boneD = flash ? '#c4b48a' : '#a89870';
    // Arms
    const arm = (side: -1 | 1) => {
      const ax = side < 0 ? x : x + 4.1 * T;
      const away = k && k.attack === 'hand' && k.n > 0 && k.handSide === side;
      ctx.fillStyle = boneD;
      ctx.fillRect(ax + 10, y + 1.5 * T, 0.9 * T - 20, (away ? 1.6 : 2.2) * T);
      ctx.fillStyle = bone;
      ctx.fillRect(ax + 14, y + 1.5 * T, 0.9 * T - 28, (away ? 1.6 : 2.2) * T);
      if (!away) {
        ctx.fillStyle = bone;
        ctx.fillRect(ax + 2, y + 3.6 * T, 0.9 * T - 4, 0.45 * T);
        for (let i = 0; i < 4; i++) ctx.fillRect(ax + 4 + i * 10, y + 4.0 * T, 6, 12);
      }
      const telegraph = k && k.attack === 'hand' && k.n === 0 && k.handSide === side;
      if (telegraph) {
        ctx.fillStyle = 'rgba(20,0,30,0.6)';
        ctx.fillRect(ax - 6, y + 3.4 * T, 0.9 * T + 12, 0.9 * T);
      }
    };
    if (!k || k.hasLeft) arm(-1);
    if (!k || k.hasRight) arm(1);
    // Skull
    ctx.fillStyle = boneD;
    ctx.fillRect(x + 0.9 * T, y + 0.7 * T, 3.2 * T, 2.0 * T);
    ctx.fillStyle = bone;
    ctx.fillRect(x + 1.0 * T, y + 0.7 * T, 3.0 * T, 1.8 * T);
    // Jaw
    ctx.fillStyle = boneD;
    ctx.fillRect(x + 1.4 * T, y + 2.6 * T, 2.2 * T, 0.6 * T);
    ctx.fillStyle = '#1a1410';
    for (let i = 0; i < 6; i++) ctx.fillRect(x + 1.5 * T + i * 0.35 * T, y + 2.6 * T, 6, 14);
    // Eyes
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(x + 1.4 * T, y + 1.3 * T, 0.8 * T, 0.7 * T);
    ctx.fillRect(x + 2.8 * T, y + 1.3 * T, 0.8 * T, 0.7 * T);
    const glow = 0.6 + 0.4 * Math.sin(b.t * 6);
    ctx.fillStyle = `rgba(190,110,255,${glow})`;
    ctx.fillRect(x + 1.6 * T, y + 1.5 * T, 0.35 * T, 0.3 * T);
    ctx.fillRect(x + 3.0 * T, y + 1.5 * T, 0.35 * T, 0.3 * T);
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(x + 2.35 * T, y + 2.1 * T, 0.3 * T, 0.35 * T);
    // Crown (the weak spot)
    ctx.fillStyle = flash ? '#ffe680' : '#d4a020';
    ctx.fillRect(x + 1.4 * T, y + 0.25 * T, 2.2 * T, 0.5 * T);
    for (let i = 0; i < 5; i++) ctx.fillRect(x + 1.4 * T + i * 0.5 * T, y, 0.22 * T, 0.3 * T);
    ctx.fillStyle = '#ff3050';
    ctx.fillRect(x + 2.35 * T, y + 0.35 * T, 0.3 * T, 0.25 * T);
    ctx.fillStyle = '#50a0ff';
    ctx.fillRect(x + 1.65 * T, y + 0.38 * T, 0.2 * T, 0.2 * T);
    ctx.fillRect(x + 3.15 * T, y + 0.38 * T, 0.2 * T, 0.2 * T);
    if (e.invulnerable) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, y, e.w, e.h);
    }
    // Pulse the weak spots so players know where to aim.
    const pulse = 0.18 + 0.12 * Math.sin(b.t * 4);
    ctx.strokeStyle = `rgba(255,230,120,${pulse + (flash ? 0.4 : 0)})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.4 * T, y, 2.2 * T, 0.75 * T);
    ctx.strokeRect(x + 1.4 * T, y + 2.6 * T, 2.2 * T, 0.6 * T);
    this.statusOverlay(b, e, Math.round(x + 1.2 * T), Math.round(y + 0.8 * T));
  }

  private drawAllies(b: Battle) {
    const ctx = this.ctx;
    for (const a of b.allies) {
      const x = Math.round(a.x);
      const y = Math.round(a.y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 4, y + a.h - 4, a.w - 8, 6);
      const look: Record<string, [string, 'stone' | 'gold' | undefined]> = {
        soldier: ['ally_soldier', undefined],
        zombie: ['zombie', undefined],
        bull: ['beast', 'gold'],
        healer: ['bishop', 'stone'],
        archer: ['archer', 'stone'],
      };
      const [name, tint] = look[a.kind];
      ctx.drawImage(sprite(name, a.flash > 0, tint), x + (a.w - 32) / 2, y + a.h - 34, 32, 32);
      ctx.fillStyle = '#0a1a0a';
      ctx.fillRect(x + 2, y - 6, a.w - 4, 4);
      ctx.fillStyle = '#5ae06a';
      ctx.fillRect(x + 2, y - 6, Math.max(2, (a.w - 4) * (a.hp / a.maxHp)), 4);
    }
  }

  private iceBlock(x: number, y: number, s: number, flash = false) {
    const ctx = this.ctx;
    ctx.fillStyle = flash ? '#ffffff' : '#9fd8ff';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#e8f8ff';
    ctx.fillRect(x + 4, y + 4, s - 8, 8);
    ctx.fillRect(x + 4, y + 4, 8, s - 8);
    ctx.fillStyle = '#5a9ad0';
    ctx.fillRect(x + s - 8, y + 8, 4, s - 12);
    ctx.fillRect(x + 8, y + s - 8, s - 12, 4);
  }

  private drawQueen(b: Battle, e: Enemy) {
    const ctx = this.ctx;
    const flash = e.flash > 0;
    const sx = e.shake > 0 ? Math.sin(b.t * 80) * 4 : 0;
    const x = e.x + sx;
    const y = e.y;
    const T = TILE;
    // Gown
    ctx.fillStyle = flash ? '#f4fbff' : '#8ab4f0';
    ctx.beginPath();
    ctx.moveTo(x + 1.5 * T, y + 1.0 * T);
    ctx.lineTo(x + 2.9 * T, y + 3 * T);
    ctx.lineTo(x + 0.1 * T, y + 3 * T);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#c8e4ff';
    ctx.fillRect(x + 0.4 * T, y + 2.6 * T, 2.2 * T, 0.4 * T);
    // Arms
    ctx.fillStyle = '#d6ecff';
    ctx.fillRect(x + 0.6 * T, y + 1.2 * T, 0.3 * T, 1.0 * T);
    ctx.fillRect(x + 2.1 * T, y + 1.2 * T, 0.3 * T, 1.0 * T);
    // Head
    ctx.fillStyle = flash ? '#ffffff' : '#d6ecff';
    ctx.fillRect(x + 1.05 * T, y + 0.35 * T, 0.9 * T, 0.8 * T);
    ctx.fillStyle = '#16203a';
    ctx.fillRect(x + 1.2 * T, y + 0.6 * T, 0.2 * T, 0.2 * T);
    ctx.fillRect(x + 1.6 * T, y + 0.6 * T, 0.2 * T, 0.2 * T);
    ctx.fillStyle = '#3aa8ff';
    ctx.fillRect(x + 1.25 * T, y + 0.65 * T, 0.1 * T, 0.1 * T);
    ctx.fillRect(x + 1.65 * T, y + 0.65 * T, 0.1 * T, 0.1 * T);
    // Icicle crown
    ctx.fillStyle = '#bfe8ff';
    for (let i = 0; i < 5; i++) {
      const cx = x + 1.05 * T + i * 0.2 * T;
      const h = i % 2 ? 0.35 : 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, y + 0.38 * T);
      ctx.lineTo(cx + 0.1 * T, y + (0.38 - h) * T);
      ctx.lineTo(cx + 0.2 * T, y + 0.38 * T);
      ctx.fill();
    }
    if (e.invulnerable) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, y, e.w, e.h);
    }
    for (const sp of b.stage.queenShields(e)) this.iceBlock(Math.round(sp.x), Math.round(sp.y), Math.round(TILE * 0.9));
    this.statusOverlay(b, e, Math.round(x + 0.5 * T), Math.round(y + 1 * T));
  }

  private drawWarnings(b: Battle) {
    const ctx = this.ctx;
    for (const w of b.stage.warnings) {
      const a = 0.25 + 0.35 * (1 - w.t / w.max);
      ctx.strokeStyle = `rgba(255,40,40,${a})`;
      ctx.lineWidth = w.width;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- player & balls

  private drawPlayer(b: Battle) {
    for (const p of b.bodies) this.drawBody(b, p);
  }

  private drawBody(b: Battle, p: Player) {
    const ctx = this.ctx;
    // Aim guide
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.aim) * TILE * 2.2, p.y + Math.sin(p.aim) * TILE * 2.2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(p.x - 14, p.y + 12, 28, 6);
    if (p.invuln > 0 && Math.floor(b.t * 20) % 2 === 0) return;
    const name = `player_${b.char.id}`;
    ctx.drawImage(sprite(hasSprite(name) ? name : 'player_warrior', p.hurtFlash > 0.2), Math.round(p.x - 16), Math.round(p.y - 22), 32, 32);
    if (p.frozen > 0) {
      ctx.fillStyle = 'rgba(160,220,255,0.55)';
      ctx.fillRect(p.x - 18, p.y - 26, 36, 40);
      ctx.strokeStyle = '#e8f8ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 18, p.y - 26, 36, 40);
    }
    if (b.hasPassive('turret')) {
      const tx = p.x + Math.cos(b.t * 2) * TILE * 0.8;
      const ty = p.y - TILE * 0.6;
      ctx.fillStyle = '#6c7480';
      ctx.fillRect(tx - 6, ty - 6, 12, 12);
      ctx.fillStyle = '#c4ccd6';
      ctx.fillRect(tx - 2, ty - 10, 4, 6);
    }
  }

  private ballColor(ball: Ball) {
    if (!ball.parts.length) return ball.tag === 'iron' ? '#9aa0a8' : ball.tag === 'sniper' ? '#a0c0d0' : '#f4f4f4';
    return ball.parts[0].def.color;
  }

  private drawBalls(b: Battle) {
    const ctx = this.ctx;
    // Additive glow pass first, then the solid balls on top. Evolved and max-level balls glow more.
    ctx.globalCompositeOperation = 'lighter';
    for (const ball of b.balls) {
      if (!ball.parts.length || ball.state === 'return') continue;
      const evolved = ball.parts.some((p) => p.def.evolved);
      const maxed = ball.parts.every((p) => p.lv >= 3);
      ctx.globalAlpha = evolved ? 0.42 : maxed ? 0.34 : 0.24;
      ctx.fillStyle = this.ballColor(ball);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * (evolved ? 3.2 : 2.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const ball of b.balls) {
      const color = this.ballColor(ball);
      // Returning balls stay easy to follow on their way back, just a little dimmer.
      const alpha = ball.state === 'return' ? 0.8 : 1;
      ctx.globalAlpha = 0.35 * alpha;
      ctx.fillStyle = color;
      ball.trail.forEach((t, i) => {
        const s = ball.r * (0.5 + i / ball.trail.length / 2);
        ctx.fillRect(t.x - s, t.y - s, s * 2, s * 2);
      });
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      if (ball.parts.length > 1) {
        ctx.fillStyle = ball.parts[1].def.color;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
      }
      if (ball.parts.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(ball.x - ball.r * 0.5, ball.y - ball.r * 0.6, ball.r * 0.5, ball.r * 0.5);
      }
      // Evolved balls carry three spinning arcs.
      if (ball.state !== 'return' && ball.parts.some((p) => p.def.evolved)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const a = b.t * 7 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, ball.r * 1.75, a, a + 0.9);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawMinions(b: Battle) {
    const ctx = this.ctx;
    for (const m of b.minions) {
      switch (m.kind) {
        case 'mosquito':
          ctx.fillStyle = '#5a1020';
          ctx.fillRect(m.x - 5, m.y - 3, 10, 6);
          ctx.fillStyle = 'rgba(220,220,255,0.7)';
          ctx.fillRect(m.x - 8, m.y - 7 + (Math.floor(b.t * 30) % 2) * 2, 6, 4);
          ctx.fillRect(m.x + 2, m.y - 7 + (Math.floor(b.t * 30) % 2) * 2, 6, 4);
          break;
        case 'firework':
          ctx.fillStyle = `hsl(${(b.t * 400 + m.x) % 360},90%,65%)`;
          ctx.fillRect(m.x - 4, m.y - 4, 8, 8);
          break;
        case 'arrow': {
          const a = Math.atan2(m.vy, m.vx);
          ctx.strokeStyle = '#c0c0c0';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(m.x - Math.cos(a) * 12, m.y - Math.sin(a) * 12);
          ctx.lineTo(m.x + Math.cos(a) * 6, m.y + Math.sin(a) * 6);
          ctx.stroke();
          break;
        }
        case 'bug':
          ctx.fillStyle = '#d6ff66';
          ctx.fillRect(m.x - 5, m.y - 5, 10, 10);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
          break;
      }
    }
  }

  private drawShots(b: Battle) {
    const ctx = this.ctx;
    for (const s of b.shots) {
      const a = Math.atan2(s.vy, s.vx);
      switch (s.kind) {
        case 'arrow':
          ctx.strokeStyle = '#d8c8a0';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.cos(a) * 14, s.y - Math.sin(a) * 14);
          ctx.lineTo(s.x + Math.cos(a) * 6, s.y + Math.sin(a) * 6);
          ctx.stroke();
          ctx.fillStyle = '#c4ccd6';
          ctx.fillRect(s.x + Math.cos(a) * 6 - 3, s.y + Math.sin(a) * 6 - 3, 6, 6);
          break;
        case 'orb':
          ctx.fillStyle = 'rgba(160,90,220,0.5)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#d0a0ff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'bone':
        case 'bigbone': {
          const len = s.kind === 'bigbone' ? 22 : 12;
          ctx.strokeStyle = s.kind === 'bigbone' ? 'rgba(255,60,60,0.5)' : 'rgba(170,90,255,0.6)';
          ctx.lineWidth = s.kind === 'bigbone' ? 14 : 10;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.cos(a) * len, s.y - Math.sin(a) * len);
          ctx.lineTo(s.x + Math.cos(a) * len, s.y + Math.sin(a) * len);
          ctx.stroke();
          ctx.strokeStyle = '#f0e6c8';
          ctx.lineWidth = s.kind === 'bigbone' ? 6 : 4;
          ctx.stroke();
          break;
        }
        case 'icicle':
          ctx.fillStyle = 'rgba(160,220,255,0.45)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#e8f8ff';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.cos(a) * 12, s.y - Math.sin(a) * 12);
          ctx.lineTo(s.x + Math.cos(a) * 8, s.y + Math.sin(a) * 8);
          ctx.stroke();
          break;
        case 'shield':
          this.iceBlock(Math.round(s.x - 22), Math.round(s.y - 22), 44);
          break;
        case 'hand':
          ctx.fillStyle = '#e8dcb0';
          ctx.fillRect(s.x - 18, s.y - 14, 36, 22);
          for (let i = 0; i < 4; i++) ctx.fillRect(s.x - 18 + i * 10, s.y + 6, 6, 14);
          ctx.fillStyle = 'rgba(170,90,255,0.4)';
          ctx.fillRect(s.x - 22, s.y - 18, 44, 40);
          break;
      }
    }
  }

  private drawFx(b: Battle) {
    const ctx = this.ctx;
    for (const r of b.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const bm of b.beams) {
      ctx.globalAlpha = bm.life / bm.max;
      ctx.strokeStyle = bm.color;
      ctx.lineWidth = bm.width * 2;
      ctx.beginPath();
      if (bm.zigzag) {
        const n = 6;
        ctx.moveTo(bm.x1, bm.y1);
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const jitter = (hash(i * 31 + Math.floor(bm.life * 60)) - 0.5) * 20;
          ctx.lineTo(bm.x1 + (bm.x2 - bm.x1) * t + jitter, bm.y1 + (bm.y2 - bm.y1) * t + jitter);
        }
        ctx.lineTo(bm.x2, bm.y2);
      } else {
        ctx.moveTo(bm.x1, bm.y1);
        ctx.lineTo(bm.x2, bm.y2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of b.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;
  }
}
