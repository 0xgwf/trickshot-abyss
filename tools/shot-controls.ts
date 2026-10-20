// Drives the game with real keyboard/mouse events and checks the state changes.
import { chromium } from 'playwright-core';

const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const state = () =>
  page.evaluate(() => {
    const b = (window as any).__app.battle;
    const a = (window as any).__app;
    return {
      autofire: b.autofire,
      speed: b.speed,
      paused: a.paused,
      px: Math.round(b.player.x),
      py: Math.round(b.player.y),
      queue: b.queue.length,
      flying: b.balls.length,
      phase: b.phase,
    };
  });
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8080/');
await page.mouse.click(640, 400); // "开始游戏"
await page.waitForTimeout(200);
await page.mouse.click(640, 620); // "出发"
await page.waitForTimeout(300);
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
console.log('after F (autofire off):', JSON.stringify(await state()));
await page.mouse.move(700, 150);
await page.mouse.down();
await page.waitForTimeout(600);
console.log('holding fire:', JSON.stringify(await state()));
await page.mouse.up();
await page.keyboard.down('KeyA');
await page.keyboard.down('KeyW');
await page.waitForTimeout(500);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
console.log('after moving up-left:', JSON.stringify(await state()));
await page.keyboard.press('Digit3');
console.log('after 3:', JSON.stringify(await state()));
await page.mouse.click(1229, 34); // ">>" button? (speed 1.5 is the middle one)
await page.mouse.click(1129, 34);
console.log('after clicking >>:', JSON.stringify(await state()));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
console.log('after Esc:', JSON.stringify(await state()));
await page.screenshot({ path: `${out}/40-pause.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
console.log('after Enter:', JSON.stringify(await state()));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
