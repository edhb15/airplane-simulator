// End-to-end smoke test: boots the game in headless Chromium, walks through
// the menus, starts a flight and captures screenshots + console errors.
// Usage: node tools/e2e.mjs [url] [outDir] [scenario]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}

const [url = 'http://localhost:5173/', outDir = 'screenshots', scenario = 'full'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
};
const waitState = async (st, timeout = 120000) => {
  await page.waitForFunction((s) => window.__sim && window.__sim.state === s, st, { timeout, polling: 500 });
};
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }' });
await waitState('menu');
console.log(`menu after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(1500);
await shot('01-main');

if (scenario === 'full' || scenario === 'menus') {
  for (const s of ['freeflight', 'hangar', 'career', 'missions', 'school', 'multiplayer', 'settings']) {
    await page.evaluate((n) => window.__sim.ui.showScreen(n), s);
    await page.waitForTimeout(s === 'hangar' ? 2500 : 900);
    await shot(`02-${s}`);
  }
  await page.evaluate(() => window.__sim.ui.showScreen('main'));
}

if (scenario === 'full' || scenario === 'flight') {
  await page.evaluate(() => window.__sim.ui.showScreen('freeflight'));
  await page.waitForTimeout(500);
  await page.click('text=Start flight');
  await waitState('flying', 120000);
  await page.waitForTimeout(2500);
  await shot('03-runway-chase');
  // Take off with keyboard: full thrust, release brakes, rotate
  await page.evaluate(() => {
    const g = window.__sim;
    g.player.sim.throttleLever = 1;
    g.player.sim.parkingBrake = false;
  });
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    const ias = await page.evaluate(() => window.__sim.player.flightData.ias);
    if (ias > 150) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(4000);
  const fd = await page.evaluate(() => {
    const d = window.__sim.player.flightData;
    return { ias: d.ias, alt: d.alt, ra: d.radioAlt, vs: d.vs, pitch: d.pitch, fps: window.__sim.fps };
  });
  console.log('after takeoff', JSON.stringify(fd));
  await shot('04-climb-chase');
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(2500);
  await shot('05-cockpit');
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(2000);
  await shot('06-cabin');
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(2000);
  await shot('07-wing');
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(3000);
  await shot('08-map');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  await shot('09-atc');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await shot('10-pause');
  await page.keyboard.press('Escape');
}

console.log(`--- ${logs.length} console errors/warnings ---`);
console.log(
  logs
    .filter((l) => !l.includes('GPU stall') && !l.includes('fonts.g'))
    .slice(0, 40)
    .join('\n')
);
await browser.close();
