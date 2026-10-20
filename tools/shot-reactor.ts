// Screenshots of the fusion reactor screens (forced state).
import { chromium } from 'playwright-core';

const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8080/');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  // Give the player four level-3 balls (two evolvable pairs) and fire a reactor.
  b.addBall(b.owned[0].parts[0].def); // dummy to read defs
  b.owned.length = 0;
  b.queue.length = 0;
  const defs = (w.__debug as any).defs;
  void defs;
});
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  for (const id of ['burn', 'iron', 'freeze', 'ghost']) {
    const ob = b.addBall(w.__balls[id]);
    ob.parts[0].lv = 3;
  }
  b.pendingReactors = 1;
  b.checkPending();
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/20-reactor.png` });
await page.mouse.click(640 + 0, 330); // middle card = fusion
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/21-reactor-fusion.png` });
await page.mouse.click(640, 624); // back
await page.waitForTimeout(500);
await page.mouse.click(640 + 308, 330); // right card = evolution
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/22-reactor-evolve.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
