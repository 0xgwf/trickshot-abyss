// Screenshot smoke test: drives the built game in headless Chrome through a whole run.
// Usage: node tools/shot.ts <outDir> [url]
import { chromium } from 'playwright-core';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));

const shot = async (name: string) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};
/** Runs the bot until `until` (a JS expression on b) is true or `max` game seconds pass. */
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

await page.goto(url);
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.mouse.move(640, 260);
await page.waitForTimeout(1200);
console.log(await simUntil("b.phase === 'levelup'", 120, false));
await shot('10-levelup');
console.log(await simUntil("b.stage.state === 'miniboss' && b.stage.miniboss && b.stage.miniboss.y > 60", 400));
await shot('11-miniboss');
console.log(await simUntil("b.phase === 'reactor'", 120, false));
await shot('12-reactor');
console.log(await simUntil('b.stage.segment === 1 && b.stage.segRows > 20', 200));
await shot('13-segment2');
console.log(await simUntil('b.stage.segment === 2 && b.stage.segRows > 30', 400));
await shot('14-segment3');
console.log(await simUntil('b.stage.boss && b.stage.boss.hp < b.stage.boss.maxHp * 0.8', 500));
await shot('15-boss');
console.log(await simUntil('b.stage.boss && b.stage.boss.hp < b.stage.boss.maxHp * 0.4', 300));
await shot('16-boss-phase2');
console.log(await simUntil('false', 400));
await page.waitForTimeout(400);
await shot('17-end');
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
