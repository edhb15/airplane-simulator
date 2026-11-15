// Plays the quick-start tutorial end to end with real key presses: the welcome
// prompt on a fresh profile, every lesson step, and the debrief. The
// simulation is stepped manually in the page so it runs without a GPU.
// Usage: node tools/quickstartTest.mjs [url]   (needs the dev server running)
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const [url = 'http://localhost:5173/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_TUNNEL|net::/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.state === 'menu', null, { timeout: 120000, polling: 500 });

const fail = async (msg) => {
  console.log(`FAIL ${msg}`);
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
  process.exit(1);
};

// Fresh profile: the welcome prompt offers the tutorial
if (!(await page.$('.modal.welcome'))) await fail('no welcome prompt on a fresh profile');
await page.click('.modal.welcome button.primary');
await page.waitForFunction(() => window.__sim.state === 'flying', null, { timeout: 60000, polling: 250 });
await page.evaluate(() => {
  const g = window.__sim;
  g.running = false;
  window.__step = (sec, dt = 1 / 30) => {
    for (let t = 0; t < sec; t += dt) {
      g.input.update(dt);
      for (const a of g.input.consume()) g.handleAction(a);
      if (g.state === 'flying' || g.state === 'debrief') g.updateFlight(dt);
    }
  };
});
await page.focus('#scene');

const state = () =>
  page.evaluate(() => {
    const g = window.__sim;
    const fd = g.player ? g.player.flightData : {};
    return { gstate: g.state, step: g.missions.stepIndex, kind: g.missions.kind, id: g.missions.mission && g.missions.mission.id, alt: fd.radioAlt, ias: fd.ias, vs: fd.vs, bank: fd.bank, pitch: fd.pitch, onGround: fd.onGround };
  });
const step = (sec) => page.evaluate((s) => window.__step(s), sec);
const hold = async (key, sec) => {
  await page.keyboard.down(key);
  await step(sec);
  await page.keyboard.up(key);
};

let s = await state();
if (s.id !== 'tut-quickstart') await fail(`wrong lesson ${s.id}`);
const panel = async () => (await page.textContent('.tutorial .txt')) || '';
const log = async () => {
  s = await state();
  console.log(`step ${s.step + 1}: alt ${Math.round(s.alt)} ft, ias ${Math.round(s.ias)} kt, vs ${Math.round(s.vs)}, bank ${Math.round(s.bank)}, pitch ${Math.round(s.pitch)} — ${(await panel()).slice(0, 60)}`);
};

// Fly the lesson: each action is repeated until the step advances
const until = async (target, action, maxTries = 80) => {
  for (let i = 0; i < maxTries; i++) {
    s = await state();
    if (s.step >= target) return;
    if (s.gstate !== 'flying') await fail(`flight ended at step ${s.step + 1} (${s.gstate})`);
    await action(s);
  }
  await log();
  await fail(`stuck before step ${target + 1}`);
};

await log();
await until(1, () => step(1)); // welcome text
await log();
await until(2, async () => (await page.keyboard.press('KeyK'), step(0.5)));
await log();
await until(3, async () => (await page.keyboard.press('F4'), step(0.5)));
await log();
await until(4, async (st) => (st.ias > 55 ? hold('KeyS', 0.4) : step(0.5)), 200);
await log();
// Hold about 8° nose-up: the climb attitude for the trainer
const pitchTo = (st, target) => (st.pitch < target - 2 ? hold('KeyS', 0.12) : st.pitch > target + 2 ? hold('KeyW', 0.12) : step(0.5));
await until(5, (st) => pitchTo(st, 8), 600);
await log();
// Small nudges, then watch the vertical speed settle
const nudge = async (key) => (await hold(key, 0.05), step(0.8));
await until(6, (st) => (st.vs > 250 ? nudge('KeyW') : st.vs < -250 ? nudge('KeyS') : step(0.5)), 300);
await log();
await until(7, () => hold('KeyA', 0.4));
await log();
await until(8, async (st) => {
  const k = st.bank < -5 ? 'KeyD' : st.bank > 5 ? 'KeyA' : null;
  return k ? (await hold(k, Math.abs(st.bank) > 12 ? 0.25 : 0.1), step(0.6)) : step(0.5);
});
await log();
await until(9, async () => (await page.keyboard.press('Digit1'), step(0.3)));
await log();
await until(10, async () => {
  await page.keyboard.press('KeyM');
  await step(0.3);
  await page.keyboard.press('KeyM');
  await step(0.3);
});
await log();
await until(11, async () => {
  await page.keyboard.press('Escape');
  await step(0.3);
  await page.keyboard.press('Escape');
  await step(0.3);
});
await log();
// Final message, then the debrief
for (let i = 0; i < 30 && (await state()).gstate === 'flying'; i++) await step(0.5);
s = await state();
if (s.gstate !== 'debrief') await fail(`no debrief (state ${s.gstate})`);
const result = await page.textContent('.debrief .result');
const passed = await page.evaluate(() => !!window.__sim.profile.data.tutorials['tut-quickstart']);
if (!passed) await fail('lesson not recorded as passed');
// Back in the menu the Tutorial entry is gone and no welcome prompt returns
await page.evaluate(() => window.__sim.toMenu());
const featured = await page.$('.main .menu button.featured');
const welcome = await page.$('.modal.welcome');
if (featured || welcome) await fail('tutorial prompt still shown after passing');
if (errors.length) await fail('page errors');
console.log(`ok   quick-start tutorial passed (${result})`);
await browser.close();
