// Screenshots of the level select and a SNOWYxSHORES run (save pre-seeded with the first clear).
import { chromium } from 'playwright-core';

const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
await page.addInitScript(() => localStorage.setItem('tsa.save', JSON.stringify({ unlocks: ['boneyard'], clears: 1, runs: 3, best: 600 })));
const shot = async (name: string) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};
const simUntil = (until: string, max: number, decide = true) =>
  page.evaluate(
    ([u, m, d]) => {
      const w = window as any;
      const b = w.__app.battle;
      const cond = new Function('b', `return ${u}`);
      const end = b.t + m;
      while (b.t < end && b.phase !== 'won' && b.phase !== 'lost' && !cond(b)) {
        if (d) w.__debug.autoDecide(b);
        else if (b.phase !== 'play') break;
        b.update(1 / 60, w.__debug.autopilot(b));
      }
      return { t: Math.round(b.t), phase: b.phase, state: b.stage.state };
    },
    [until, max, decide] as const,
  );
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8080/');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
await shot('60-select');
await page.keyboard.press('Enter');
await page.mouse.move(640, 260);
await page.waitForTimeout(1500);
console.log(await simUntil('b.t > 50', 60));
await shot('61-snowy');
console.log(await simUntil("b.stage.state === 'miniboss' && b.stage.miniboss && b.stage.miniboss.y > 60", 400));
await shot('62-champion');
console.log(await simUntil('b.stage.segment === 1 && b.stage.state === "miniboss" && b.stage.miniboss && b.stage.miniboss.y > 60', 500));
await shot('63-howler');
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  if (b.phase === 'lost') {
    b.phase = 'play';
    b.player.hp = b.player.maxHp;
  }
  b.player.hp = b.player.maxHp = 400;
  b.stage.debugSkipToBoss();
});
console.log(await simUntil('b.stage.boss && !b.stage.boss.invulnerable && b.t > 0', 600));
await simUntil('false', 6);
await shot('64-queen');
console.log(await simUntil('b.stage.queenState && b.stage.queenState.dashT > 0.5', 120));
await shot('65-queen-dash');
console.log(await simUntil('b.stage.queenState && b.stage.queenState.wallT > 2', 120));
await shot('66-queen-wall');
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
