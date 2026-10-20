// Screenshots of the end screen + leaderboard submission (use a throwaway server).
import { chromium } from 'playwright-core';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:8091/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  w.__debug.simulate(b, 200);
  b.player.hp = 0;
  b.update(1 / 60, w.__debug.autopilot(b));
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/30-end-input.png` });
await page.click('.name-input');
await page.keyboard.type('测试员');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/31-end-ranked.png` });
await page.evaluate(() => {
  const w = window as any;
  w.__app.screen = 'title';
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/32-title-board.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
