// Browser smoke test for WORLD DOMINATION: node tools/wdE2E.mjs [url] [outDir]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const url = process.argv[2] || 'http://localhost:4173/world-domination/';
const out = process.argv[3] || 'screenshots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
await page.goto(url);
await page.waitForTimeout(1500);
await shot('01-menu');
await page.click('[data-act="menu-new"]');
await page.waitForTimeout(800);
await page.fill('[data-input="setup-filter"]', 'germ');
await page.waitForTimeout(300);
await page.click('[data-act="setup-pick"][data-n="DEU"]');
await page.waitForTimeout(1200);
await shot('02-setup');
await page.click('[data-act="setup-start"]');
await page.waitForTimeout(1500);
await shot('03-intro');
await page.click('#modal [data-act="close-modal"]');
await page.waitForTimeout(500);
await shot('04-game');
for (const tab of ['nation', 'economy', 'military', 'research', 'diplomacy', 'intel', 'territories', 'wars', 'world', 'stats', 'news', 'menu']) {
  await page.click(`#nav [data-tab="${tab}"]`);
  await page.waitForTimeout(250);
  await shot(`05-tab-${tab}`);
}
await page.click(`#nav [data-tab="menu"]`);
// Select France and look at its tabs
const hooksSelect = async (tid) => page.evaluate((t) => { const el = document.createElement('button'); el.dataset.act = 'select'; el.dataset.t = t; document.body.appendChild(el); el.click(); el.remove(); }, tid);
await hooksSelect('FRA');
await page.waitForTimeout(900);
for (const t of ['overview', 'diplo', 'spy', 'war']) {
  await page.evaluate((x) => { const b = document.querySelector(`#country [data-act="ctab"][data-t="${x}"]`); b && b.click(); }, t);
  await page.waitForTimeout(250);
  await shot(`06-fra-${t}`);
}
// run time forward fast
await page.keyboard.press('Escape');
await page.keyboard.press('5');
await page.waitForTimeout(12000);
await page.evaluate(() => { const m = document.querySelector('#modal'); return m && !m.hidden; });
await shot('07-after-time');
const info = await page.evaluate(() => ({ day: window.WD.s.day, pending: window.WD.s.pending.length, modal: !document.querySelector('#modal').hidden, modalText: document.querySelector('#modal').innerText.slice(0, 300) }));
console.log(JSON.stringify(info));
console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');
await browser.close();
