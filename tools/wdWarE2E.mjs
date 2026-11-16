// Browser scenario: play Russia, invade Georgia, dictate peace. node tools/wdWarE2E.mjs [url] [outDir]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { const req = createRequire(execSync('npm root -g').toString().trim() + '/'); ({ chromium } = req('playwright')); }
const url = process.argv[2] || 'http://localhost:4173/world-domination/';
const out = process.argv[3] || 'screenshots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const click = (sel) => page.evaluate((x) => { const b = document.querySelector(x); if (!b) throw new Error('missing ' + x); b.click(); }, sel);
const act = (attrs) => page.evaluate((a) => { const el = document.createElement('button'); Object.assign(el.dataset, a); document.body.appendChild(el); el.click(); el.remove(); }, attrs);
await page.goto(url);
await page.waitForTimeout(1200);
await click('[data-act="menu-new"]');
await page.waitForTimeout(500);
await click('[data-act="setup-pick"][data-n="RUS"]');
await page.waitForTimeout(300);
await click('[data-act="setup-start"]');
await page.waitForTimeout(800);
await click('#modal [data-act="close-modal"]');
await page.evaluate(() => { window.WD.settings.pauseOnEvents = false; });
await act({ act: 'select', t: 'GEO' });
await page.waitForTimeout(800);
await act({ act: 'ctab', t: 'war' });
await page.waitForTimeout(200);
await shot('10-declare');
await click('#country [data-act="declare"]');
await page.waitForTimeout(400);
// drain any decisions
const drain = async () => { for (let i = 0; i < 6; i++) { const has = await page.evaluate(() => !document.querySelector('#modal').hidden); if (!has) break; await page.evaluate(() => { const b = document.querySelector('#modal [data-act="answer"]') || document.querySelector('#modal [data-act="close-modal"]'); b && b.click(); }); await page.waitForTimeout(200); } };
await drain();
await act({ act: 'ctab', t: 'war' });
await page.waitForTimeout(300);
await shot('11-attack');
await click('#country [data-act="attack"]');
await page.waitForTimeout(300);
await act({ act: 'tab', tab: 'wars' });
await page.keyboard.press('5');
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000);
  await drain();
  const st = await page.evaluate(() => ({ ctrl: window.WD.s.terr.GEO.ctrl, owner: window.WD.s.terr.GEO.owner, day: window.WD.s.day, wars: window.WD.s.wars.filter((w) => w.att.includes('RUS') || w.def.includes('RUS')).length, peace: !!document.querySelector('#modal .peace') }));
  if (st.peace) { console.log('peace dialog at', JSON.stringify(st)); break; }
  if (st.owner !== 'GEO' || !st.wars) { console.log('resolved', JSON.stringify(st)); break; }
  if (i % 5 === 0) console.log(JSON.stringify(st));
}
await shot('12-war-progress');
const hasPeace = await page.evaluate(() => !!document.querySelector('#modal .peace'));
if (hasPeace) {
  await page.evaluate(() => { const c = document.querySelector('#modal [data-act="pd-annex"]'); c && c.click(); });
  await page.waitForTimeout(200);
  await shot('13-peace');
  await click('#modal [data-act="pd-send"]');
  await page.waitForTimeout(500);
}
const fin = await page.evaluate(() => ({ owner: window.WD.s.terr.GEO.owner, infamy: window.WD.s.nations.RUS.infamy, geoAlive: window.WD.s.nations.GEO.alive, overlord: window.WD.s.nations.GEO.overlord }));
console.log('final', JSON.stringify(fin));
await act({ act: 'mapmode', mode: 'diplomacy' });
await page.waitForTimeout(400);
await shot('14-relations');
console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');
await browser.close();
