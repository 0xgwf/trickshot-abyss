import { Input } from './core/input.ts';
import { View } from './core/view.ts';
import { autoDecide, autopilot, simulate } from './game/autopilot.ts';
import { BALLS } from './game/data/balls.ts';
import { App } from './ui/app.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const view = new View(canvas);
const input = new Input(view);
const app = new App(view, input);
// Test hook for the screenshot script (tools/shot.ts).
Object.assign(window, { __app: app, __balls: BALLS, __debug: { simulate, autopilot, autoDecide } });

let last = performance.now();
const loop = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  app.frame(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
