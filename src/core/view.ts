// Fits a fixed logical resolution into the window (letterboxed, crisp on HiDPI).
export const VIEW_W = 1280;
export const VIEW_H = 720;

export class View {
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.scale = Math.min(cw / VIEW_W, ch / VIEW_H) * dpr;
    this.offsetX = (this.canvas.width - VIEW_W * this.scale) / 2;
    this.offsetY = (this.canvas.height - VIEW_H * this.scale) / 2;
  }

  /** Clears the whole canvas and sets the logical-space transform. */
  begin() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07050b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
  }

  /** Converts a client (CSS pixel) position into logical coordinates. */
  toLogical(clientX: number, clientY: number) {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (clientX * dpr - this.offsetX) / this.scale,
      y: (clientY * dpr - this.offsetY) / this.scale,
    };
  }
}
