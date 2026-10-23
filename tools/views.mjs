// Screenshots of the cockpit / cabin / external views for a list of aircraft.
// Usage: node tools/views.mjs [url] [outDir] [ids] [modes] [spawn]
//   e.g. node tools/views.mjs http://localhost:5173/ screenshots mj320,k172 cockpit,cabin runway
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
const [url = 'http://localhost:5173/', outDir = 'screenshots', ids = 'mj320', modes = 'cockpit,cabin,chase', spawn = 'runway'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
await page.goto(url, { waitUntil: 'load' });
await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; transition: none !important; }' });
await page.waitForFunction(() => window.__sim && window.__sim.state === 'menu', null, { timeout: 120000, polling: 500 });
for (const id of ids.split(',')) {
  await page.evaluate(
    ([id, spawn]) => window.__sim.startFlight({ aircraftId: id, airport: 'AXMI', spawn, time: 11, weather: 'fewClouds', wind: { dir: 270, speed: 4 } }),
    [id, spawn]
  );
  await page.waitForFunction(() => window.__sim.state === 'flying', null, { timeout: 120000, polling: 500 });
  for (const mode of modes.split(',')) {
    await page.evaluate((m) => {
      window.__sim.cameras.setMode(m);
      window.__sim.settings.set('hud', 'cockpitHud', 'off');
    }, mode);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/view-${id}-${mode}.png` });
    console.log('shot', id, mode);
  }
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
