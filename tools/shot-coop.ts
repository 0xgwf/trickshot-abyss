// Co-op smoke test: three headless Chrome windows join the LAN co-op room and the host starts. Each
// window first walks with held-down keys, then sends the autopilot's controls for its own body (like a
// player who chases gems and aims at enemies); whoever's turn it is picks level-ups with the number keys.
// Screenshots show the shared field from each player's window.
// Usage: node tools/shot-coop.ts <outDir> [url]
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
  await page.mouse.click(640, 539); // 局域网合作
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  return page;
}

const state = (p: Page) =>
  p.evaluate(() => {
    const c = (window as any).__app.coop;
    const g = c?.ghost;
    return {
      state: c?.state,
      you: c?.you,
      names: c?.names,
      ...(g && {
        phase: g.phase,
        t: Math.round(g.t),
        hp: g.player.hp,
        maxHp: g.player.maxHp,
        lvl: g.lvl,
        bodies: g.bodies.length,
        kills: g.kills,
      }),
    };
  });

const pages = [await player('甲'), await player('乙'), await player('丙')];
await pages[0].waitForTimeout(500);
console.log('lobby', await state(pages[0]), await state(pages[2]));
await pages[0].mouse.click(530, 548); // the host's 开始 button
await pages[0].waitForTimeout(1000);
// Each player holds a different direction for a while, then aims somewhere else.
const keys = ['KeyA', 'KeyD', 'KeyW'];
await Promise.all(pages.map((p, i) => p.keyboard.down(keys[i])));
await pages[0].waitForTimeout(700);
await Promise.all(pages.map((p, i) => p.keyboard.up(keys[i])));
await Promise.all(pages.map((p, i) => p.mouse.move(400 + i * 240, 200)));
for (const p of pages)
  await p.evaluate(() => {
    const w = window as any;
    const c = w.__app.coop;
    c.send = function () {
      const g = this.ghost;
      if (this.state === 'playing') this.socket.send({ t: 'in', c: w.__debug.autopilot(g, g.bodies[this.you]) });
    };
  });
let shotLevelUp = false;
for (let s = 0; s < 60; s++) {
  await pages[0].waitForTimeout(500);
  for (const [i, p] of pages.entries()) {
    const picking = await p.evaluate(() => {
      const c = (window as any).__app.coop;
      return c?.ghost?.phase === 'levelup' && c.chooser === c.you;
    });
    if (!picking) continue;
    if (!shotLevelUp) {
      shotLevelUp = true;
      for (const [j, q] of pages.entries()) await q.screenshot({ path: `${out}/coop-levelup-p${j + 1}.png` });
      console.log(`level-up picked by player ${i + 1}`);
    }
    await p.waitForTimeout(400);
    await p.keyboard.press('Digit1');
  }
  if (s === 12) for (const [j, q] of pages.entries()) await q.screenshot({ path: `${out}/coop-6s-p${j + 1}.png` });
}
for (const [j, q] of pages.entries()) await q.screenshot({ path: `${out}/coop-30s-p${j + 1}.png` });
console.log('after 30s', await state(pages[0]), await state(pages[1]));
// Player 3 leaves: the autopilot takes over their body.
await pages[2].close();
await pages[0].waitForTimeout(3000);
console.log('after leave', await state(pages[0]));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
