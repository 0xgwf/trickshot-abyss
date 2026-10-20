import type { View } from './view.ts';

// Keyboard + mouse state, polled once per frame.
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  /** Buttons currently held (0 = left, 2 = right). */
  private buttons = new Set<number>();
  private clicks = new Set<number>();
  wheel = 0;
  onGesture: (() => void) | null = null;
  /** In battle, touches that start left of this x drive a virtual joystick. */
  joystickMaxX = 0;
  joystickEnabled = false;
  joy: { id: number; sx: number; sy: number; x: number; y: number } | null = null;
  /** True once any touch has been seen (switches hints to touch wording). */
  touchUsed = false;

  constructor(view: View) {
    window.addEventListener('keydown', (e) => {
      // Let text boxes (the leaderboard name) receive their keys untouched.
      if (e.target instanceof HTMLInputElement) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.onGesture?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttons.clear();
    });

    const canvas = view.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const move = (e: PointerEvent) => {
      const p = view.toLogical(e.clientX, e.clientY);
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy.x = p.x;
        this.joy.y = p.y;
        return;
      }
      this.mouseX = p.x;
      this.mouseY = p.y;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', (e) => {
      this.onGesture?.();
      const p = view.toLogical(e.clientX, e.clientY);
      if (e.pointerType === 'touch') {
        this.touchUsed = true;
        canvas.setPointerCapture?.(e.pointerId);
        if (this.joystickEnabled && !this.joy && p.x < this.joystickMaxX) {
          this.joy = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
          return;
        }
      }
      move(e);
      this.buttons.add(e.button);
      this.clicks.add(e.button);
    });
    const up = (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        return;
      }
      this.buttons.delete(e.button);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  /** Virtual joystick direction, each axis in -1..1 (null when not touching). */
  joyVector() {
    const j = this.joy;
    if (!j) return null;
    const dx = j.x - j.sx;
    const dy = j.y - j.sy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return { x: 0, y: 0 };
    const k = Math.min(1, len / 50) / len;
    return { x: dx * k, y: dy * k };
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  button(b: number) {
    return this.buttons.has(b);
  }

  clicked(b = 0) {
    return this.clicks.has(b);
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.clicks.clear();
    this.wheel = 0;
  }
}
