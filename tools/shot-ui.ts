// UI screenshots with a hand-picked late-run loadout: evolved, fused and max-level balls and passives in
// the HUD, a level-up with one card of each kind, and evolved balls on the field.
// Usage: node tools/shot-ui.ts <outDir> [url]
import { chromium } from 'playwright-core';

const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.mouse.move(640, 200);
await page.waitForTimeout(600);

await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  const B = w.__balls;
  const P = w.__passives;
  for (const ob of [...b.owned]) b.removeOwned(ob);
  b.addBall(B.bleed, 2);
  b.addBall(B.assassin, 3);
  b.addBall(B.ghost, 3);
  const fused = b.addBall(B.burn, 3);
  fused.parts.push({ def: B.poison, lv: 3 });
  fused.fused = true;
  b.passives = [
    { def: P.magnet, lv: 1 },
    { def: P.rattle, lv: 3 },
    { def: P.cornucopia, lv: 2 },
  ];
  b.recomputeStats();
  b.xpNeeded = 1e9; // no level-up overlay in the HUD shot
  w.__debug.simulate(b, 25, false);
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ui-hud.png` });

// A level-up offering one of each: new ball, ball to max level, new passive, evolved passive upgrade.
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  b.pendingLevelUps = 1;
  b.offers = [
    { kind: 'newBall', def: w.__balls.lightning },
    { kind: 'upBall', ob: b.owned[0] },
    { kind: 'upPassive', p: b.passives[2] },
  ];
  b.phase = 'levelup';
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/ui-levelup.png` });
await page.evaluate(() => {
  const w = window as any;
  const b = w.__app.battle;
  b.offers = [{ kind: 'newPassive', def: w.__passives.breastplate }, { kind: 'upPassive', p: b.passives[0] }, { kind: 'heal' }];
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/ui-levelup-2.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
