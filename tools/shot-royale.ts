// Battle royale smoke test: a host and a second player join the versus room in headless Chrome, the host
// adds computer players and starts, the autopilot plays both people, and screenshots show the grid of
// fields, targeting, attacks, a knockout and watching afterwards.
// Usage: node tools/shot-royale.ts <outDir> [url] [bots=5]
import { chromium, type Page } from 'playwright-core';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:8080/';
const bots = Number(process.argv[4] ?? 5);
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
  await page.keyboard.press('Enter'); // the default character and level
  await page.waitForTimeout(400);
  return page;
}

const state = (p: Page) =>
  p.evaluate(() => {
    const v = (window as any).__app.versus;
    const b = v?.battle;
    if (!b) return { state: v?.state, lobby: v?.lobby?.players?.length };
    const me = v.seats[v.you];
    return {
      state: v.state,
      phase: b.phase,
      t: Math.round(b.t),
      kills: b.kills,
      hp: Math.round(b.player.hp),
      seen: v.rivals.filter((r: any) => r?.seen).length,
      target: me?.target,
      strategy: me?.strategy,
      alive: v.seats.filter((s: any) => s.alive).length,
      pending: v.duel.pending,
    };
  });

/** Lets the autopilot play: movement and aim, and the level-up picks. */
const autoplay = (p: Page) =>
  p.evaluate(() => {
    const w = window as any;
    const v = w.__app.versus;
    v.controls = (_i: unknown, b: unknown) => w.__debug.autopilot(b);
    setInterval(() => w.__debug.autoDecide(v.battle), 50);
  });

/** Frames per second over a second. */
const fps = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(f)) : done(n));
        requestAnimationFrame(f);
      }),
  );

const a = await player('甲');
for (let i = 0; i < bots; i++) {
  await a.mouse.click(405, 505); // 加电脑
  await a.waitForTimeout(80);
}
const b = await player('乙');
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/royale-lobby-host.png` });
await b.screenshot({ path: `${out}/royale-lobby-guest.png` });
console.log('lobby', 'A', await state(a), 'B', await state(b));
await a.mouse.click(760, 671); // 开始
for (let i = 0; i < 50 && (await state(a)).state !== 'playing'; i++) await a.waitForTimeout(100);
await autoplay(a);
await autoplay(b);
await a.waitForTimeout(8000);
console.log('fps A', await fps(a), 'B', await fps(b));
await a.screenshot({ path: `${out}/royale-a-8s.png` });
// Targeting: A counters, B locks onto A by clicking its field.
await a.keyboard.press('KeyX');
const cellOfA = await b.evaluate(() => {
  const v = (window as any).__app.versus;
  const c = v.cells().get(0);
  return { x: c.x + 40, y: c.y + 80 };
});
await b.mouse.click(cellOfA.x, cellOfA.y);
await a.waitForTimeout(1500);
console.log('targeting', 'A', await state(a), 'B', await state(b));
await b.screenshot({ path: `${out}/royale-b-locked.png` });
await a.waitForTimeout(30000);
await a.screenshot({ path: `${out}/royale-a-40s.png` });
await b.screenshot({ path: `${out}/royale-b-40s.png` });
console.log('40s', 'A', await state(a), 'B', await state(b));
await a.waitForTimeout(50000);
await a.screenshot({ path: `${out}/royale-a-90s.png` });
console.log('90s', 'A', await state(a), 'B', await state(b));
// B goes down: B sees the result and then watches; A sees the knockout.
await b.evaluate(() => ((window as any).__app.versus.battle.player.hp = 0));
await b.waitForTimeout(1200);
await b.screenshot({ path: `${out}/royale-b-down.png` });
await a.screenshot({ path: `${out}/royale-a-ko.png` });
await b.mouse.click(320, 524); // 观战
await b.waitForTimeout(1500);
await b.screenshot({ path: `${out}/royale-b-watch.png` });
console.log('down', 'A', await state(a), 'B', await state(b));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
