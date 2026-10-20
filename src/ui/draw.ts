import type { Input } from '../core/input.ts';
import type { Part, PassiveDef } from '../game/types.ts';

export const FONT =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Micro Hei",sans-serif';

export const C = {
  bg: '#0f0b0d',
  panel: '#1d1713',
  panelHi: '#2a2119',
  bronze: '#8a6a3a',
  bronzeHi: '#c9a25e',
  text: '#f2e6cc',
  dim: '#a8977a',
  gold: '#f0c040',
  red: '#e0404a',
  green: '#6dff8a',
  cyan: '#7ad8ff',
};

/** Lightens dark colours so they stay readable on the dark panels. */
export function readable(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum >= 0.5) return hex;
  const k = (0.5 - lum) / (1 - lum) + 0.25;
  r = Math.round(r + (255 - r) * k);
  g = Math.round(g + (255 - g) * k);
  b = Math.round(b + (255 - b) * k);
  return `rgb(${r},${g},${b})`;
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number;
  outline?: string | false;
  lw?: number;
  alpha?: number;
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}) {
  ctx.font = `${o.weight ?? 700} ${o.size ?? 16}px ${FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.outline !== false) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.outline ?? '#120c0a';
    ctx.lineWidth = o.lw ?? Math.max(3, (o.size ?? 16) / 4);
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? C.text;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}

/** Wraps text (CJK-aware: breaks between any characters, keeps ASCII words together). */
export function wrap(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number, weight = 500): string[] {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const tokens = s.match(/[A-Za-z0-9.%+\-–/×()]+|\s|./gu) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    const next = line + t;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line.trimEnd());
      line = t.trimStart();
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function paragraph(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  color = C.text,
  lineH = 1.45,
) {
  const lines = wrap(ctx, s, maxW, size);
  lines.forEach((l, i) => text(ctx, l, x, y + i * size * lineH, { size, color, weight: 500, outline: false }));
  return lines.length * size * lineH;
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hi = false, alpha = 0.94) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hi ? C.panelHi : C.panel;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = hi ? C.bronzeHi : C.bronze;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.fillStyle = hi ? C.bronzeHi : C.bronze;
  for (const [cx, cy] of [
    [x, y],
    [x + w - 8, y],
    [x, y + h - 8],
    [x + w - 8, y + h - 8],
  ])
    ctx.fillRect(cx, cy, 8, 8);
}

export const hover = (input: Input, x: number, y: number, w: number, h: number) =>
  input.mouseX >= x && input.mouseX <= x + w && input.mouseY >= y && input.mouseY <= y + h;

/** Immediate-mode button; returns true when clicked this frame. */
export function button(
  ctx: CanvasRenderingContext2D,
  input: Input,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  o: { size?: number; disabled?: boolean; accent?: string } = {},
) {
  const hv = !o.disabled && hover(input, x, y, w, h);
  panel(ctx, x, y, w, h, hv);
  text(ctx, label, x + w / 2, y + h / 2 + 1, {
    size: o.size ?? 20,
    align: 'center',
    baseline: 'middle',
    color: o.disabled ? '#6a5e4c' : hv ? '#fff4d8' : (o.accent ?? C.text),
  });
  return hv && input.clicked(0);
}

export function ballIcon(ctx: CanvasRenderingContext2D, parts: Part[], cx: number, cy: number, r: number, evolved = false) {
  const c1 = parts[0]?.def.color ?? '#f4f4f4';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(cx + 2, cy + 3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (parts.length > 1) {
    ctx.fillStyle = parts[1].def.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(cx - r * 0.5, cy - r * 0.55, r * 0.4, r * 0.4);
  ctx.strokeStyle = evolved ? C.gold : 'rgba(0,0,0,0.5)';
  ctx.lineWidth = evolved ? 3 : 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

export function passiveIcon(ctx: CanvasRenderingContext2D, def: PassiveDef, x: number, y: number, s: number) {
  ctx.fillStyle = def.evolved ? '#3a2a10' : '#2a2018';
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = def.evolved ? C.gold : C.bronzeHi;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
  text(ctx, [...def.zh][0], x + s / 2, y + s / 2 + 1, {
    size: s * 0.5,
    align: 'center',
    baseline: 'middle',
    color: def.evolved ? C.gold : '#e8d0a0',
  });
}

export function pips(ctx: CanvasRenderingContext2D, lv: number, x: number, y: number) {
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < lv ? C.gold : 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + i * 9, y, 7, 7);
  }
}
