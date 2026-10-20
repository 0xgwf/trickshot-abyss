// Touch test: drags the virtual joystick and holds an aim touch via CDP touch events.
import { chromium } from 'playwright-core';

const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, isMobile: false });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8080/');
await page.touchscreen.tap(640, 400);
await page.waitForTimeout(200);
await page.touchscreen.tap(640, 620);
await page.waitForTimeout(400);
const cdp = await ctx.newCDPSession(page);
const before = await page.evaluate(() => {
  const b = (window as any).__app.battle;
  return { x: Math.round(b.player.x), y: Math.round(b.player.y), screen: (window as any).__app.screen };
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 560, id: 1 }] });
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 + i * 6, y: 560 - i * 6, id: 1 }] });
  await page.waitForTimeout(30);
}
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [
    { x: 210, y: 500, id: 1 },
    { x: 800, y: 200, id: 2 },
  ],
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/50-touch.png` });
const after = await page.evaluate(() => {
  const b = (window as any).__app.battle;
  const i = (window as any).__app.input;
  return { x: Math.round(b.player.x), y: Math.round(b.player.y), aimX: Math.round(i.mouseX), aimY: Math.round(i.mouseY), joy: !!i.joy };
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
