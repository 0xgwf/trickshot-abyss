// Versus smoke test: two headless Chrome windows join the LAN versus room, the first one starts the match,
// the bot plays both sides at 2× speed, and screenshots show each player's split screen.
// Usage: node tools/shot-versus.ts <outDir> [url]
import { chromium, type Page } from 'playwright-core';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const errors: string[] = [];

async function player(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((n) => localStorage.setItem('tsa.name', n), name);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}\n${e.stack}`));
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.mouse.click(640, 473); // 局域网对战
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // start with the default character and level
  return page;
}

const state = (p: Page) =>
  p.evaluate(() => {
    const v = (window as any).__app.versus;
    const b = v?.battle;
    return b
      ? {
          state: v.state,
          phase: b.phase,
          t: Math.round(b.t),
          kills: b.kills,
          seen: v.rivals.some((r: any) => r?.seen),
          pending: v.duel.pending,
        }
      : { state: v?.state };
  });

/** Lets the bot play: autopilot for movement and aim, auto-picks for level-ups and the reactor. */
const autoplay = (p: Page) =>
  p.evaluate(() => {
    const w = window as any;
    const v = w.__app.versus;
    v.controls = (_i: unknown, b: unknown) => w.__debug.autopilot(b);
    v.battle.speed = 2;
    setInterval(() => {
      const b = v.battle;
      w.__debug.autoDecide(b);
    }, 50);
  });

const a = await player('甲');
await a.waitForTimeout(300);
const b = await player('乙');
await a.waitForTimeout(300);
await a.keyboard.press('Enter'); // the host starts
for (let i = 0; i < 50 && (await state(a)).state !== 'playing'; i++) await a.waitForTimeout(100);
console.log('A', await state(a), 'B', await state(b));
await autoplay(a);
await autoplay(b);
for (const t of [6, 20, 40]) {
  await a.waitForTimeout(t === 6 ? 6000 : 14000);
  await a.screenshot({ path: `${out}/versus-a-${t}s.png` });
  await b.screenshot({ path: `${out}/versus-b-${t}s.png` });
  console.log(`${t}s`, 'A', await state(a), 'B', await state(b));
}
// A gives up: B should see it and A should get a verdict.
await a.evaluate(() => ((window as any).__app.versus.battle.player.hp = 0));
await a.waitForTimeout(1500);
await a.screenshot({ path: `${out}/versus-a-end.png` });
await b.screenshot({ path: `${out}/versus-b-oppdown.png` });
console.log('end', 'A', await state(a), 'B', await state(b));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
