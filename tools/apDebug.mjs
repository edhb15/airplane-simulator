import { getAircraft } from '../src/aircraft/aircraftData.js';
import { AircraftSim } from '../src/aircraft/AircraftSim.js';
import { KT, FT, DEG, FPM } from '../src/physics/atmosphere.js';
const spec = getAircraft(process.argv[2] || 'mj320');
const athr = process.argv[3] === 'athr';
const sim = new AircraftSim(spec, {});
sim.spawn({ mode: 'air', x: 0, z: 0, heading: 0, altitude: 3000 * FT, speed: 200 * KT * 1.05 });
sim.throttleLever = 0.55;
sim.ap.alt = 3000; sim.ap.spd = 200;
sim.ap.engage(); sim.ap.modeALT(); sim.ap.alt = 3000;
if (athr) sim.ap.setAthr(true);
let t = 0, last = -5;
while (t < 150) {
  sim.update(1/60); t += 1/60;
  if (t > 60 && t < 61) { sim.ap.alt = 5000; sim.ap.modeFLCH(); }
  if (t - last >= 3) { last = t; const s = sim.snapshot(); console.log(`${t.toFixed(0)} alt ${s.alt.toFixed(0)} vs ${s.vs.toFixed(0)} ias ${s.ias.toFixed(1)} pitch ${s.pitch.toFixed(2)} cmd ${(sim.ap.pitchCmd/DEG).toFixed(2)} a ${s.alpha.toFixed(2)} I ${(sim.ap.vsIntegral/DEG).toFixed(2)} thr ${s.throttle.toFixed(2)} elev ${sim.fm.controls.elevator.toFixed(3)} ${sim.ap.vert}`); }
}
