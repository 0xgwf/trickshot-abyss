import { load, store } from './storage.ts';

// Synthesised sound effects (no audio files needed).
export type Sfx =
  | 'hit'
  | 'kill'
  | 'shoot'
  | 'catch'
  | 'hurt'
  | 'levelup'
  | 'pickup'
  | 'explode'
  | 'zap'
  | 'ting'
  | 'boss'
  | 'win'
  | 'lose'
  | 'click'
  | 'heal'
  | 'widen'
  | 'reactor';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last = new Map<Sfx, number>();
  muted = false;

  constructor() {
    this.muted = load('muted') === '1';
  }

  /** Must be called from a user gesture before sounds can play. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    store('muted', this.muted ? '1' : '0');
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, hp = 400) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  play(s: Sfx) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const gap: Partial<Record<Sfx, number>> = { hit: 0.035, pickup: 0.05, kill: 0.04, shoot: 0.05, zap: 0.08, ting: 0.08, explode: 0.08 };
    if ((gap[s] ?? 0) > 0 && now - (this.last.get(s) ?? -1) < gap[s]!) return;
    this.last.set(s, now);
    switch (s) {
      case 'hit':
        this.tone(520 + Math.random() * 200, 0.05, 'square', 0.12, -200);
        break;
      case 'kill':
        this.tone(300, 0.09, 'square', 0.15, -180);
        break;
      case 'shoot':
        this.tone(180, 0.06, 'triangle', 0.18, 120);
        break;
      case 'catch':
        this.tone(880, 0.08, 'square', 0.12, 400);
        break;
      case 'hurt':
        this.tone(140, 0.25, 'sawtooth', 0.3, -80);
        break;
      case 'levelup':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'square', 0.16, 0, i * 0.07));
        break;
      case 'pickup':
        this.tone(1200 + Math.random() * 300, 0.04, 'sine', 0.12);
        break;
      case 'explode':
        this.noise(0.35, 0.5, 80);
        this.tone(90, 0.3, 'sine', 0.4, -50);
        break;
      case 'zap':
        this.noise(0.08, 0.2, 2500);
        break;
      case 'ting':
        this.tone(1600, 0.08, 'triangle', 0.1, -300);
        break;
      case 'boss':
        this.tone(110, 0.8, 'sawtooth', 0.25, -40);
        this.tone(82, 0.9, 'square', 0.15, 0, 0.1);
        break;
      case 'win':
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'square', 0.16, 0, i * 0.11));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, 0, i * 0.16));
        break;
      case 'click':
        this.tone(660, 0.05, 'square', 0.1);
        break;
      case 'heal':
        this.tone(700, 0.12, 'sine', 0.15, 300);
        break;
      case 'widen':
        [262, 392, 523].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18, 0, i * 0.1));
        break;
      case 'reactor':
        [400, 600, 900, 1350].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.16, 0, i * 0.06));
        break;
    }
  }
}
