// Functional smoke test of game flows: every mission and tutorial, a career job
// with ATC requests, crash handling and debriefs. The simulation is stepped
// directly in the page (no rendering) so it runs quickly even without a GPU.
// Usage: node tools/flows.mjs [url] [filter]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const [url = 'http://localhost:5173/', filter = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// One context so local-mode multiplayer (BroadcastChannel) can link two pages
const context = await browser.newContext({ viewport: { width: 1024, height: 640 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.state === 'menu', null, { timeout: 120000, polling: 500 });

// Stop the render loop and expose helpers that step the simulation manually
await page.evaluate(async () => {
  const g = window.__sim;
  g.running = false;
  window.__step = (sec, dt = 1 / 30) => {
    for (let t = 0; t < sec; t += dt) {
      g.input.update(dt);
      for (const a of g.input.consume()) g.handleAction(a);
      if (g.state === 'flying' || g.state === 'debrief') g.updateFlight(dt);
    }
  };
  window.__mods = {
    missions: await import('/src/missions/missions.js'),
    career: await import('/src/missions/Career.js'),
  };
  window.__start = async (cfg, seconds) => {
    await g.startFlight({ ...cfg, waitForScenery: false });
    window.__step(seconds);
    const fd = g.player.flightData;
    const obj = g.missions.kind === 'tutorial' ? `step ${g.missions.stepIndex + 1}` : g.missions.currentObjectiveText() || '';
    return `${g.state}, alt ${Math.round(fd.alt)} ft, ias ${Math.round(fd.ias)} kt${obj ? ', ' + obj : ''}`;
  };
});

const report = [];
const run = async (label, fn) => {
  if (filter && !label.includes(filter)) return;
  const before = errors.length;
  let line;
  try {
    const r = await fn();
    line = `${errors.length > before ? 'FAIL' : 'ok  '} ${label}${r ? ' — ' + r : ''}`;
  } catch (e) {
    line = `FAIL ${label} — ${e.message.split('\n')[0]}`;
  }
  report.push(line);
  console.log(line);
  if (errors.length > before) {
    const e = '     ' + errors.slice(before).join('\n     ').slice(0, 700);
    report.push(e);
    console.log(e);
  }
};

const missionIds = await page.evaluate(() => window.__mods.missions.MISSIONS.map((m) => m.id));
for (const id of missionIds) {
  await run(`mission ${id}`, () =>
    page.evaluate((id) => {
      const M = window.__mods.missions.MISSIONS.find((m) => m.id === id);
      return window.__start({ aircraftId: M.aircraft[0], mission: M, airport: M.start.airport, time: M.time, weather: M.weather, wind: M.wind, fuel: M.fuel }, 6);
    }, id)
  );
}
const tutIds = await page.evaluate(() => window.__mods.missions.TUTORIALS.map((m) => m.id));
for (const id of tutIds) {
  await run(`tutorial ${id}`, () =>
    page.evaluate((id) => {
      const T = window.__mods.missions.TUTORIALS.find((m) => m.id === id);
      return window.__start({ aircraftId: T.aircraft, mission: T, tutorial: true, airport: T.start.airport, time: T.time, weather: T.weather, wind: T.wind, fuel: 0.55 }, 8);
    }, id)
  );
}

await run('career job + ATC pushback/taxi/ready', () =>
  page.evaluate(async () => {
    const g = window.__sim;
    const jobs = window.__mods.career.generateJobs(g.profile, 6);
    if (!jobs.length) return 'no jobs generated';
    const j = jobs[0];
    const mission = window.__mods.career.jobToMission(j);
    await g.startFlight({ aircraftId: j.aircraft, mission, job: j, airport: j.from, time: j.time, weather: j.weather, wind: j.wind, fuel: mission.fuel, waitForScenery: false });
    const sim = g.player.sim;
    const out = [`${j.title} in ${j.aircraft}`];
    const opts = () => g.atc.menuOptions().map((o) => o.id);
    out.push(`atc opts: ${opts().join(',')}`);
    const first = g.atc.menuOptions().find((o) => o.id === 'pushback' || o.id === 'taxi');
    g.atc.request(first.id, first);
    window.__step(4);
    out.push(`state ${g.atc.state}, taxi line ${g.atc.line ? 'shown' : 'none'}`);
    // Drive along the taxi path quickly by teleporting to the hold point
    const path = g.atc.taxiPath;
    if (path && path.length) {
      const last = path[path.length - 1];
      sim.fm.placeOnGround(last.x, last.z, sim.fm.getAttitude({}).heading, g.world.heightAt(last.x, last.z));
      window.__step(2);
    }
    const ready = g.atc.menuOptions().find((o) => o.id === 'ready');
    if (ready) {
      g.atc.request('ready', ready);
      window.__step(10);
    }
    out.push(`after ready: ${g.atc.state}`);
    out.push(`log: ${g.atc.log.slice(-2).map((m) => m.text).join(' | ').slice(0, 220)}`);
    return out.join('; ');
  })
);

await run('airborne ATC requests', () =>
  page.evaluate(async () => {
    const g = window.__sim;
    await g.startFlight({ aircraftId: 'mj320', airport: 'AXMI', spawn: 'air', altitudeFt: 6000, destination: 'AXNG', waitForScenery: false });
    window.__step(2);
    const res = [];
    for (const o of g.atc.menuOptions()) {
      if (o.id === 'mayday') continue;
      g.atc.request(o.id, o);
      window.__step(3);
      res.push(o.id);
    }
    g.ui.toggleATC();
    g.ui.hud.update(0.1);
    g.ui.toggleATC();
    return `${res.join(',')}; approach ${g.player.sim.nav.approach ? g.player.sim.nav.approach.id : '-'}; state ${g.atc.state}`;
  })
);

await run('map open/draw/close + approach select', () =>
  page.evaluate(async () => {
    const g = window.__sim;
    g.ui.toggleMap();
    window.__step(0.5);
    g.ui.map.draw();
    const end = g.airports && window.__sim.player.sim.nav.destination ? window.__sim.player.sim.nav.destination.runwayObjs[0].ends[0] : null;
    if (end) {
      g.player.sim.nav.setApproach(end);
      g.missions.setApproachGuidance(end);
    }
    g.ui.map.renderSide();
    g.ui.toggleMap();
    return `map ${g.ui.map.open ? 'still open' : 'closed'}, approach ${end ? end.id : '-'}`;
  })
);

await run('autopilot NAV + APPR arm', () =>
  page.evaluate(() => {
    const g = window.__sim;
    const p = g.player;
    p.toggleAP();
    p.sim.ap.modeNAV();
    p.armApproach();
    window.__step(20);
    const ap = p.sim.ap;
    return `AP ${ap.engaged ? 'on' : 'off'} ${ap.lat}/${ap.latArmed || '-'} ${ap.vert}/${ap.vertArmed || '-'}, hdg ${Math.round(p.flightData.heading)}`;
  })
);

await run('sim rate, cameras, HUD cycle, pause/settings/help', () =>
  page.evaluate(() => {
    const g = window.__sim;
    for (const a of ['simRateUp', 'simRateUp', 'simRateDown', 'camera', 'cameraCockpit', 'cameraCabin', 'cameraWing', 'cameraCinematic', 'cameraTower', 'cameraFree', 'cameraChase', 'hud', 'hud', 'hud', 'gear', 'flapsDown', 'spoilers', 'landingLights', 'smoke']) {
      g.handleAction(a);
      window.__step(0.3);
    }
    g.handleAction('pause');
    const paused = g.paused && g.ui.modal && g.ui.modal.kind;
    g.ui.openSettings();
    g.ui.closeModal();
    g.ui.toggleHelp();
    g.ui.closeModal();
    g.ui.conditionsPanel();
    g.ui.closeModal();
    const stillPaused = g.paused;
    g.handleAction('pause');
    return `pause modal ${paused}, after closes paused=${stillPaused}, finally paused=${g.paused}, rate ${g.player.sim.simRate}`;
  })
);

await run('free flight crash → crash overlay → debrief', () =>
  page.evaluate(() => {
    const g = window.__sim;
    g.player.sim.fm.crash('Test impact');
    window.__step(1);
    const crash = g.ui.modal && g.ui.modal.kind;
    g.endFlight(true);
    window.__step(1);
    return `crash modal ${crash}, state ${g.state}, screen ${g.ui.screen}, logbook ${g.profile.data.logbook.length}`;
  })
);

await run('mission crash → crash overlay then debrief', () =>
  page.evaluate(async () => {
    const g = window.__sim;
    const M = window.__mods.missions.MISSIONS.find((m) => m.id === 'emg-engine');
    await g.startFlight({ aircraftId: M.aircraft[0], mission: M, airport: M.start.airport, time: M.time, weather: M.weather, wind: M.wind, fuel: M.fuel, waitForScenery: false });
    window.__step(1);
    g.player.sim.fm.crash('Test impact');
    window.__step(1);
    const first = g.ui.modal && g.ui.modal.kind;
    g.ui.flushDebrief();
    return `first ${first}, then screen ${g.ui.screen}, state ${g.state}`;
  })
);

await run('free flight end → debrief → menu screens', () =>
  page.evaluate(async () => {
    const g = window.__sim;
    await g.startFlight({ aircraftId: 'k172', airport: 'AXPV', spawn: 'runway', waitForScenery: false });
    window.__step(3);
    g.endFlight(true);
    const s1 = g.ui.screen;
    g.toMenu();
    for (const s of ['freeflight', 'hangar', 'career', 'missions', 'school', 'multiplayer', 'settings', 'main']) g.ui.showScreen(s);
    return `debrief screen ${s1}, menu ${g.ui.screen}, state ${g.state}`;
  })
);

await run('multiplayer local mode two clients', async () => {
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => errors.push('[p2] ' + e.message));
  await p2.goto(url, { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__sim && window.__sim.state === 'menu', null, { timeout: 120000, polling: 500 });
  await p2.evaluate(async () => {
    const g = window.__sim;
    await g.multiplayer.connect({ url: 'local', room: 'test', name: 'Bob', callsign: 'BOB1', aircraft: 'k172', livery: 'trainer' });
    await g.startFlight({ aircraftId: 'k172', airport: 'AXMI', spawn: 'air', waitForScenery: false });
  });
  const r = await page.evaluate(async () => {
    const g = window.__sim;
    await g.multiplayer.connect({ url: 'local', room: 'test', name: 'Alice', callsign: 'ALI1', aircraft: 'mj320', livery: 'aurelia' });
    await g.startFlight({ aircraft: 'mj320', aircraftId: 'mj320', airport: 'AXMI', spawn: 'air', waitForScenery: false });
    for (let i = 0; i < 20; i++) {
      window.__step(0.25);
      await new Promise((res) => setTimeout(res, 120));
    }
    g.multiplayer.chat('hello from Alice');
    await new Promise((res) => setTimeout(res, 300));
    return `players ${g.multiplayer.players.map((p) => p.callsign).join(',')}, traffic ${g.multiplayer.trafficFor(g.player.position).length}`;
  });
  const chat = await p2.evaluate(() => window.__sim.ui.chatHistory.map((c) => c.text).join(' | '));
  await p2.close();
  return `${r}; p2 chat: ${chat}`;
});

console.log('\n==== summary ====');
console.log(report.filter((l) => l.startsWith('FAIL')).length + ' failures of ' + report.filter((l) => /^(ok|FAIL)/.test(l)).length);
await browser.close();
