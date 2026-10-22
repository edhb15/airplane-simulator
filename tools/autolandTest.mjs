// Headless autopilot test: FLCH climb, HDG turn, ILS approach and autoland.
import { getAircraft } from '../src/aircraft/aircraftData.js';
import { AircraftSim } from '../src/aircraft/AircraftSim.js';
import { getRunwayEnd, runwayRelative } from '../src/world/airportGeometry.js';
import { terrainHeight } from '../src/world/terrainGen.js';
import { KT, FT, DEG, FPM } from '../src/physics/atmosphere.js';

const id = process.argv[2] || 'mj320';
const spec = getAircraft(id);
const g = { h: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', water: false };
const groundFn = (x, z) => { g.h = terrainHeight(x, z); g.water = g.h < 0; if (g.water) g.h = 0; return g; };
const sim = new AircraftSim(spec, { groundFn });
const end = getRunwayEnd('AXMI', '27R');
// Start 25 km out on extended centreline offset 3 km, 3000 ft, heading toward
const sx = end.x - end.dirX * 25000 + end.dirZ * -3000, sz = end.z - end.dirZ * 25000 + end.dirX * 3000;
sim.spawn({ mode: 'air', x: sx, z: sz, heading: (end.heading - 30) * DEG, altitude: 3500 * FT, speed: 200 * KT * 1.06 });
sim.setAssist('intermediate');
sim.nav.setApproach(end);
sim.ap.alt = 3000; sim.ap.spd = 180;
sim.ap.engage(); sim.ap.modeHDG(); sim.ap.hdg = end.heading - 30; sim.ap.modeFLCH();
if (spec.autopilot.athr) sim.ap.setAthr(true);
sim.ap.modeAPP();
sim.spoilersArmed = true; sim.autobrake = 'MED';
let t = 0; const dt = 1/60; let lastLog = -10; let flapsSet = 0; let gearSet = false;
while (t < 900) {
  sim.update(dt); t += dt;
  const s = sim.snapshot();
  const ils = sim.nav.ils;
  // Configure for landing progressively
  if (ils.dist < 16000 && flapsSet < 1) { sim.setFlaps(1); flapsSet = 1; sim.ap.spd = 170; }
  if (ils.dist < 12000 && flapsSet < 2) { sim.setFlaps(2); flapsSet = 2; sim.ap.spd = 160; }
  if (ils.dist < 9000 && !gearSet) { sim.setGear(true); gearSet = true; }
  if (ils.dist < 8000 && flapsSet < 3) { sim.setFlaps(3); flapsSet = 3; sim.ap.spd = 150; }
  if (ils.dist < 6500 && flapsSet < 4) { sim.setFlaps(spec.flaps.length - 1); flapsSet = 4; sim.ap.spd = spec.speeds.vref + 5; }
  for (const ev of sim.consumeEvents()) if (ev.type !== 'callout') console.log(t.toFixed(1), 'EVENT', JSON.stringify(ev));
  if (t - lastLog > 10 || (s.radioAlt < 60 && t - lastLog > 1)) {
    lastLog = t;
    console.log(`${t.toFixed(0)}s alt ${s.alt.toFixed(0)} ra ${s.radioAlt.toFixed(0)} ias ${s.ias.toFixed(0)} vs ${s.vs.toFixed(0)} hdg ${s.heading.toFixed(0)} pitch ${s.pitch.toFixed(1)} bank ${s.bank.toFixed(1)} thr ${s.throttle.toFixed(2)} | ${sim.ap.lat}/${sim.ap.latArmed||''} ${sim.ap.vert}/${sim.ap.vertArmed||''} ${sim.ap.athrMode} | loc ${ils.locDev.toFixed(2)} gs ${ils.gsDev.toFixed(2)} dist ${(ils.dist/1000).toFixed(1)}km lat ${ils.lateral.toFixed(0)}`);
  }
  if (sim.crashed) { console.log('CRASH', sim.fm.crashReason); break; }
  if (sim.fm.wow && s.gs < 5) { const rel = runwayRelative(end, sim.position.x, sim.position.z); console.log('STOPPED', 'along', rel.along.toFixed(0), 'lateral', rel.lateral.toFixed(1), 'td', JSON.stringify(sim.stats.touchdowns.map(t => (t.vs / FPM).toFixed(0)))); break; }
}
