// Weapons and destructible buildings, end to end in the page: cannon fire
// brings down a building, a bomb flattens part of a block, a missile locks on
// and kills a drone, a missile flies to a building under the nose, then the
// city is rebuilt on the next flight. Optional screenshots of a collapse.
// Usage: node tools/weaponsTest.mjs [url] [screenshot dir]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const [url = 'http://localhost:5173/', shots = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.state === 'menu', null, { timeout: 120000, polling: 500 });

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
};

await page.evaluate(async () => {
  const g = window.__sim;
  g.ui.closeModal(true);
  g.profile.data.onboarded = true;
  g.running = false;
  window.__step = (sec, dt = 1 / 30) => {
    for (let t = 0; t < sec; t += dt) {
      g.input.update(dt);
      for (const a of g.input.consume()) g.handleAction(a);
      if (g.state === 'flying' || g.state === 'debrief') g.updateFlight(dt);
    }
  };
  await g.startFlight({ aircraftId: 'fx16', airport: 'AXMI', spawn: 'air', altitudeFt: 3000, heading: 90, waitForScenery: false, time: 12, weather: 'clear' });
  g.settings.data.gameplay.crashes = false;
  const fm = g.player.sim.fm;
  fm.crashEnabled = false;
  fm.infiniteFuel = true;
  // Hold the aircraft still in the air: tests aim it by hand each step
  window.__place = (x, y, z, headingRad, pitchRad = 0, speed = 220) => {
    fm.placeInAir(x, y, z, headingRad, speed, pitchRad);
    g.player.sim.fcs.reset();
    g.player.sim.throttleLever = 0.8;
  };
  // A standing building in Port Meridian with a clear line of fire from the south-west
  window.__pickBuilding = (minH, maxH, dist) => {
    const c = g.cities;
    const seen = new Set();
    for (const list of c.grid.values())
      for (const b of list) {
        if (seen.has(b) || !b.mesh || b.destroyed || b.h < minH || b.h > maxH || Math.hypot(b.x - 2000, b.z - 82000) > 6000) continue;
        seen.add(b);
        for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const ang = (a / 8) * Math.PI * 2;
          const x = b.x - Math.sin(ang) * dist,
            z = b.z + Math.cos(ang) * dist;
          const y = b.y + b.h * 0.5;
          const hit = c.raycast(x, y, z, b.x, y, b.z, {});
          if (hit && hit.building === b && y > window.__terrain(x, z) + 20) return { b, x, y, z, heading: ang };
        }
      }
    return null;
  };
});
await page.evaluate(async () => {
  const { terrainHeight } = await import('/src/world/terrainGen.js');
  window.__terrain = terrainHeight;
});

// 1. Cannon: hold the trigger at a mid-rise building until it collapses
const gun = await page.evaluate(() => {
  const g = window.__sim;
  const pick = window.__pickBuilding(18, 60, 420);
  if (!pick) return { err: 'no building found' };
  const b = pick.b;
  const before = g.combat.buildingsDestroyed;
  g.input.down.add('Space');
  for (let i = 0; i < 90 && !b.destroyed; i++) {
    window.__place(pick.x, pick.y, pick.z, pick.heading, -0.5 * Math.PI / 180);
    window.__step(1 / 15);
  }
  g.input.down.delete('Space');
  window.__step(0.1);
  return { destroyed: b.destroyed, hp: Math.round(b.hp), maxHp: Math.round(b.maxHp || 0), h: Math.round(b.h), count: g.combat.buildingsDestroyed - before, pieces: g.combat.destruction.pieces.length, fired: g.player.gun.fired, pick: [pick.x, pick.y, pick.z, pick.heading] };
});
check(gun.destroyed && gun.pieces > 0, 'cannon brings a building down', JSON.stringify(gun));

if (shots) {
  // Watch the collapse from behind the jet, held still 700 m back and above
  let t = 0;
  for (const [i, until] of [[1, 0.5], [2, 2.5], [3, 5], [4, 9]]) {
    await page.evaluate(([dt, pick]) => {
      const g = window.__sim;
      g.cameras.setMode('chase');
      const back = 700;
      const x = pick[0] - Math.sin(pick[3]) * back,
        z = pick[2] + Math.cos(pick[3]) * back;
      for (let k = 0; k < dt * 30; k++) {
        window.__place(x, pick[1] + 160, z, pick[3], -0.16);
        window.__step(1 / 30);
      }
      window.__place(x, pick[1] + 160, z, pick[3], -0.16);
      g.cameras.update(1 / 60);
      g.render();
    }, [until - t, gun.pick]);
    t = until;
    await page.screenshot({ path: `${shots}/collapse-${i}.png`, timeout: 90000 });
  }
}

// 2. Bomb: level release over the city, wait for the impact
const bomb = await page.evaluate(() => {
  const g = window.__sim;
  const w = g.player.weapons;
  const pick = window.__pickBuilding(8, 80, 1);
  const b = pick.b;
  const before = g.combat.buildingsDestroyed;
  // Fly toward the building at 600 m; release when the impact point is on it
  let released = false,
    best = 1e9;
  const alt = b.y + 600;
  for (let x = b.x - 3500; x < b.x + 500 && !released; x += 220 / 30) {
    window.__place(x, alt, b.z, Math.PI / 2, 0, 220);
    w.update(1 / 30, []);
    if (w.hasCcip) {
      const d = Math.hypot(w.ccip.x - b.x, w.ccip.z - b.z);
      best = Math.min(best, d);
      if (d < 15) {
        g.handleAction('releaseBomb');
        released = true;
      }
    }
  }
  // Keep the jet out of the way while the bomb falls
  for (let i = 0; i < 25 * 15; i++) {
    window.__place(b.x + 3000, alt + 500, b.z, Math.PI / 2);
    window.__step(1 / 15);
    if (!g.combat.ordnance.length) break;
  }
  window.__step(1);
  return { released, best: Math.round(best), destroyed: b.destroyed, count: g.combat.buildingsDestroyed - before, bombsLeft: w.bombs, scorches: g.combat.destruction.scorches.filter((m) => m.visible).length };
});
check(bomb.released && bomb.count > 0 && bomb.bombsLeft === 3, 'bomb released on the CCIP brings buildings down', JSON.stringify(bomb));

// 3. Missile against a drone: lock, fire, kill
const msl = await page.evaluate(() => {
  const g = window.__sim;
  const w = g.player.weapons;
  const [d] = g.combat.spawnDrones({ x: 30000, z: 40000, alt: 1500, count: 1, spread: 0, speed: [100, 100], radius: [1500, 1500] });
  const behind = () => {
    const p = d.group.position;
    const v = d.vel.clone().normalize();
    const pos = p.clone().addScaledVector(v, -2500);
    const heading = Math.atan2(p.x - pos.x, -(p.z - pos.z));
    const pitch = Math.atan2(p.y - pos.y, Math.hypot(p.x - pos.x, p.z - pos.z));
    window.__place(pos.x, pos.y, pos.z, heading, pitch);
  };
  for (let i = 0; i < 40 && !w.locked; i++) {
    behind();
    window.__step(1 / 30);
  }
  const locked = w.locked;
  g.handleAction('fireMissile');
  const kills0 = g.combat.kills;
  for (let i = 0; i < 20 * 15 && d.alive; i++) {
    behind();
    window.__step(1 / 15);
  }
  return { locked, killed: !d.alive, kills: g.combat.kills - kills0, missilesLeft: w.missiles };
});
check(msl.locked && msl.killed, 'missile locks on and shoots down a drone', JSON.stringify(msl));

// 4. Missile at the building under the nose
const ground = await page.evaluate(() => {
  const g = window.__sim;
  const w = g.player.weapons;
  g.combat.clearDrones();
  const pick = window.__pickBuilding(10, 120, 1800);
  const b = pick.b;
  const hp0 = b.hp ?? null;
  window.__place(pick.x, pick.y + 300, pick.z, pick.heading, -Math.atan2(300, 1800));
  window.__step(1 / 30);
  w.update(1 / 30, []);
  const aimed = w.hasGround && w.groundBuilding === b;
  g.handleAction('fireMissile');
  for (let i = 0; i < 10 * 15 && g.combat.ordnance.length; i++) {
    window.__place(pick.x, pick.y + 300, pick.z, pick.heading + 1.5, 0);
    window.__step(1 / 15);
  }
  return { aimed, aimedAt: w.groundBuilding === b ? 'target' : w.groundBuilding ? 'other building' : w.hasGround ? 'ground' : 'none', hit: b.destroyed || (b.hp !== undefined && b.hp !== hp0), destroyed: b.destroyed, missilesLeft: w.missiles };
});
check(ground.aimed && ground.hit, 'missile flies to the building under the nose', JSON.stringify(ground));

// 5. Controls: R and J are weapons in a fighter, reverse / supply drop otherwise
const keys = await page.evaluate(() => {
  const g = window.__sim;
  const b = g.settings.get('controls').bindings;
  return { r: b.fireMissile, j: b.releaseBomb, idx: [...g.input.bindingIndex.get('KeyR')] };
});
check(keys.r.includes('KeyR') && keys.j.includes('KeyJ') && keys.idx.includes('reverse'), 'R / J bound to missile / bomb alongside reverse / supplies', JSON.stringify(keys));

// 6. A new flight rebuilds the city
const reset = await page.evaluate(async () => {
  const g = window.__sim;
  const destroyedBefore = g.combat.destruction.destroyed.length;
  const sample = g.combat.destruction.destroyed[0];
  await g.startFlight({ aircraftId: 'fx16', airport: 'AXMI', spawn: 'runway', waitForScenery: false });
  window.__step(0.5);
  return { destroyedBefore, after: g.combat.destruction.destroyed.length, standing: sample ? !sample.destroyed && g.cities.collide({ x: sample.x, y: sample.y + 1, z: sample.z }, 1) === sample : null, rubble: g.combat.destruction.rubbleMesh.count, missiles: g.player.weapons.missiles, bombs: g.player.weapons.bombs };
});
check(reset.destroyedBefore > 0 && reset.after === 0 && reset.standing && reset.rubble === 0 && reset.missiles === 4 && reset.bombs === 4, 'new flight rebuilds the city and reloads the stores', JSON.stringify(reset));

check(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
console.log(`\n${failures} failure(s)`);
await browser.close();
process.exit(failures ? 1 : 0);
