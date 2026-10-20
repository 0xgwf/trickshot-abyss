import type { Input } from '../core/input.ts';
import { VIEW_W } from '../core/view.ts';
import type { Battle } from '../game/battle.ts';
import { CFG, WORLD_H, WORLD_W } from '../game/config.ts';
import { C, ballIcon, hover, panel, paragraph, passiveIcon, pips, readable, text, wrap } from './draw.ts';

/** Screen x of the world's left edge. */
export const FX = (VIEW_W - WORLD_W) / 2;

export interface Tooltip {
  title: string;
  sub: string;
  body: string;
  color: string;
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function drawHud(ctx: CanvasRenderingContext2D, b: Battle, input: Input, overlay = false): Tooltip | null {
  let tip: Tooltip | null = null;
  const st = b.stats;

  // ---- left: resources
  ctx.fillStyle = '#c08a20';
  ctx.fillRect(18, 18, 16, 16);
  ctx.fillStyle = '#ffe070';
  ctx.fillRect(21, 21, 8, 8);
  text(ctx, `${b.gold}`, 42, 33, { size: 20, color: C.gold });
  text(ctx, `☠ ${b.kills}`, 112, 33, { size: 18, color: '#e8dcb0' });
  text(ctx, fmtTime(b.t), 196, 33, { size: 18, color: C.dim });

  // ---- ball slots
  text(ctx, '弹珠', 18, 64, { size: 15, color: C.dim });
  const slots = Math.max(CFG.ballSlots, b.owned.length);
  for (let i = 0; i < slots; i++) {
    const x = 16 + (i % 4) * 66;
    const y = 72 + Math.floor(i / 4) * 78;
    const ob = b.owned[i];
    panel(ctx, x, y, 58, 58, false, 0.85);
    if (!ob) continue;
    const evolved = ob.parts.some((p) => p.def.evolved);
    ballIcon(ctx, ob.parts, x + 29, y + 29, 16, evolved);
    if (ob.state === 'cooldown') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 4, y + 4, 50, 50);
      text(ctx, ob.cooldown.toFixed(1), x + 29, y + 34, { size: 16, align: 'center' });
    } else if (ob.state === 'flying') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + 4, y + 4, 50, 50);
    }
    if (ob.fused) text(ctx, '融合', x + 29, y + 54, { size: 11, align: 'center', color: C.gold });
    else pips(ctx, ob.parts[0].lv, x + 16, y + 62);
    if (hover(input, x, y, 58, 58)) {
      tip = {
        title: ob.parts.map((p) => p.def.zh).join(' × '),
        sub: ob.fused ? '融合弹珠' : `${ob.parts[0].def.en} · Lv${ob.parts[0].lv}${evolved ? ' · 进化' : ''}`,
        body: ob.parts.map((p) => p.def.desc(p.lv)).join('\n'),
        color: ob.parts[0].def.color,
      };
    }
  }

  // ---- passive slots
  const py0 = 72 + Math.ceil(slots / 4) * 78 + 14;
  text(ctx, '被动', 18, py0 - 6, { size: 15, color: C.dim });
  const pslots = Math.max(CFG.passiveSlots, b.passives.length);
  for (let i = 0; i < pslots; i++) {
    const x = 16 + (i % 4) * 66;
    const y = py0 + Math.floor(i / 4) * 66;
    panel(ctx, x, y, 50, 50, false, 0.85);
    const p = b.passives[i];
    if (!p) continue;
    passiveIcon(ctx, p.def, x + 7, y + 7, 36);
    pips(ctx, p.lv, x + 12, y + 53);
    if (hover(input, x, y, 50, 50)) tip = { title: p.def.zh, sub: `${p.def.en} · Lv${p.lv}`, body: p.def.desc(p.lv), color: '#e8c070' };
  }

  // ---- stats
  const sy = py0 + Math.ceil(pslots / 4) * 66 + 18;
  const dmgLo = Math.round(st.baseDamage * 3.5);
  const dmgHi = Math.round(st.baseDamage * 6.5);
  const rows: [string, string][] = [
    ['角色', b.char.zh],
    ['弹珠伤害', `${dmgLo}-${dmgHi}`],
    ['迷你弹珠', `${b.babies} × ${Math.round(st.babyDamage[0] * st.babyDamageMul)}-${Math.round(st.babyDamage[1] * st.babyDamageMul)}`],
    ['射速', `${(1 / st.fireInterval).toFixed(1)} /秒`],
    ['暴击率', `${Math.round(st.critChance * 100)}%`],
  ];
  rows.forEach(([k, v], i) => {
    text(ctx, k, 18, sy + i * 22, { size: 14, color: C.dim, outline: false, weight: 500 });
    text(ctx, v, 110, sy + i * 22, { size: 14, color: C.text, outline: false, weight: 600 });
  });

  // ---- HP orb + XP tube (bottom-left)
  const ox = 70;
  const oy = 646;
  const or = 48;
  const p = b.player;
  ctx.fillStyle = '#1a0d0d';
  ctx.beginPath();
  ctx.arc(ox, oy, or, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, or - 4, 0, Math.PI * 2);
  ctx.clip();
  const frac = Math.max(0, Math.min(1, p.hp / p.maxHp));
  const level = oy + or - 4 - frac * (or - 4) * 2;
  ctx.fillStyle = p.hurtFlash > 0 ? '#ff6060' : '#c01828';
  ctx.beginPath();
  ctx.moveTo(ox - or, level);
  for (let x = -or; x <= or; x += 4) ctx.lineTo(ox + x, level + Math.sin(x / 8 + b.t * 3) * 2.5);
  ctx.lineTo(ox + or, oy + or);
  ctx.lineTo(ox - or, oy + or);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(ox - 26, oy - 30, 14, 14);
  ctx.restore();
  ctx.strokeStyle = C.bronzeHi;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(ox, oy, or, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, `${Math.ceil(Math.max(0, p.hp))}`, ox, oy + 2, { size: 22, align: 'center', baseline: 'middle' });
  text(ctx, `/${p.maxHp}`, ox, oy + 24, { size: 12, align: 'center', baseline: 'middle', color: '#f0c0c0' });

  const tx = 134;
  const ty0 = 470;
  const th = 222;
  ctx.fillStyle = '#0a1418';
  ctx.fillRect(tx, ty0, 20, th);
  const xf = b.xp / b.xpNeeded;
  ctx.fillStyle = '#28a8d8';
  ctx.fillRect(tx + 3, ty0 + th - 3 - (th - 6) * xf, 14, (th - 6) * xf);
  ctx.strokeStyle = C.bronzeHi;
  ctx.lineWidth = 3;
  ctx.strokeRect(tx, ty0, 20, th);
  text(ctx, `Lv ${b.lvl}`, tx + 10, ty0 - 10, { size: 16, align: 'center', color: C.cyan });

  // ---- right: speed buttons
  const speeds = [1, 1.5, 2];
  speeds.forEach((s, i) => {
    const x = VIEW_W - 222 + i * 70;
    const y = 16;
    const on = b.speed === s;
    const hv = hover(input, x, y, 62, 36);
    panel(ctx, x, y, 62, 36, on || hv);
    text(ctx, '>'.repeat(i + 1), x + 31, y + 19, { size: 18, align: 'center', baseline: 'middle', color: on ? C.gold : C.dim });
    if (hv && input.clicked(0)) b.speed = s;
  });
  text(ctx, `自动射击 ${b.autofire ? '开' : '关'}（F）`, VIEW_W - 222, 76, { size: 14, color: b.autofire ? C.green : C.dim });

  // ---- right: progress / boss bar
  const bx = VIEW_W - 56;
  const by = 120;
  const bh = 520;
  const boss = b.stage.bossBar;
  ctx.fillStyle = '#100c0a';
  ctx.fillRect(bx, by, 26, bh);
  if (boss) {
    ctx.fillStyle = '#b01020';
    ctx.fillRect(bx + 3, by + 3 + (bh - 6) * (1 - boss.frac), 20, (bh - 6) * boss.frac);
    [...boss.name].forEach((ch, i) => text(ctx, ch, bx - 22, by + 60 + i * 30, { size: 22, align: 'center', color: '#ff8080' }));
  } else {
    const prog = b.stage.progress;
    ctx.fillStyle = '#c8962a';
    ctx.fillRect(bx + 3, by + 3 + (bh - 6) * (1 - prog), 20, (bh - 6) * prog);
    for (const f of [1 / 3, 2 / 3]) {
      const cy = by + bh * (1 - f);
      const passed = prog >= f;
      ctx.fillStyle = passed ? '#c02020' : '#3a2a20';
      ctx.beginPath();
      ctx.arc(bx + 13, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.bronzeHi;
      ctx.lineWidth = 2;
      ctx.stroke();
      text(ctx, '!', bx + 13, cy + 1, { size: 16, align: 'center', baseline: 'middle', color: passed ? '#fff' : C.dim });
    }
  }
  ctx.strokeStyle = C.bronzeHi;
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, 26, bh);
  // Skull emblem on top
  ctx.fillStyle = '#e8dcb0';
  ctx.fillRect(bx - 4, by - 44, 34, 28);
  ctx.fillRect(bx + 2, by - 18, 22, 10);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(bx + 1, by - 36, 9, 9);
  ctx.fillRect(bx + 16, by - 36, 9, 9);
  ctx.fillStyle = '#d4a020';
  ctx.fillRect(bx - 4, by - 54, 34, 8);
  for (let i = 0; i < 4; i++) ctx.fillRect(bx - 4 + i * 10, by - 60, 4, 8);

  // ---- right: controls cheat sheet
  const hints = ['WASD 移动', '鼠标 瞄准', '左键/空格 射击', 'F 自动射击', '右键 召回卡住的球', '1/2/3 游戏速度', 'Esc 暂停 · M 静音'];
  hints.forEach((h, i) => text(ctx, h, VIEW_W - 250, 470 + i * 22, { size: 13, color: '#8a7a62', outline: false, weight: 500 }));

  // ---- centre: banner, recall prompt
  const banner = overlay ? null : b.stage.banner;
  if (banner) {
    const a = Math.min(1, banner.t / 0.4);
    text(ctx, banner.text, FX + WORLD_W / 2, 200, { size: 40, align: 'center', color: C.gold, alpha: a, lw: 8 });
    text(ctx, banner.sub, FX + WORLD_W / 2, 236, { size: 18, align: 'center', color: C.text, alpha: a });
  }
  if (b.recallReady) {
    const a = 0.6 + 0.4 * Math.sin(b.t * 5);
    text(ctx, '右键：召回弹珠', FX + WORLD_W / 2, WORLD_H - 18, { size: 16, align: 'center', color: '#ffe9a0', alpha: a });
  }

  // ---- floating damage numbers
  for (const t of b.texts) {
    // Pop in slightly bigger, then settle.
    const pop = t.life > 0.6 ? 1 + (t.life - 0.6) * 4 : 1;
    text(ctx, t.text, FX + t.x, t.y, {
      size: Math.round(t.size * pop),
      align: 'center',
      color: t.color,
      alpha: Math.min(1, t.life / 0.3),
      lw: 4,
    });
  }
  return tip;
}

export function drawTooltip(ctx: CanvasRenderingContext2D, tip: Tooltip, input: Input) {
  const w = 320;
  const lines = tip.body.split('\n');
  let h = 78;
  for (const l of lines) h += wrap(ctx, l, w - 32, 14).length * 14 * 1.4;
  let x = input.mouseX + 18;
  let y = input.mouseY + 12;
  if (x + w > VIEW_W - 8) x = input.mouseX - w - 18;
  if (y + h > 712) y = 712 - h;
  panel(ctx, x, y, w, h, true, 0.97);
  text(ctx, tip.title, x + 16, y + 30, { size: 18, color: readable(tip.color) });
  text(ctx, tip.sub, x + 16, y + 52, { size: 12, color: C.dim, outline: false, weight: 500 });
  let yy = y + 76;
  for (const l of lines) yy += paragraph(ctx, l, x + 16, yy, w - 32, 14, C.text, 1.4);
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, b: Battle, input: Input) {
  const x = input.mouseX;
  const y = input.mouseY;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.moveTo(x - 16, y);
  ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x + 16, y);
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y + 16);
  ctx.stroke();
  // Queue ring: one dot per ball ready to fire.
  const q = b.queue.slice(0, 24);
  q.forEach((item, i) => {
    const a = -Math.PI / 2 + (i / Math.max(8, q.length)) * Math.PI * 2;
    ctx.fillStyle = item === 'baby' ? '#f4f4f4' : item.parts[0].def.color;
    const r = item === 'baby' ? 2.5 : 4;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 24, y + Math.sin(a) * 24, r, 0, Math.PI * 2);
    ctx.fill();
  });
}
