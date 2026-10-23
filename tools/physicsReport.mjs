// Headless flight-model report: takeoff, climb, level cruise and stall for every aircraft.
// Usage: node tools/physicsReport.mjs [aircraftId]
import { AIRCRAFT } from '../src/aircraft/aircraftData.js';
import { FlightModel } from '../src/physics/FlightModel.js';
import { FlightControlSystem } from '../src/physics/FlightControls.js';
import { KT, FT, DEG } from '../src/physics/atmosphere.js';

const DT = 1 / 240;
const only = process.argv[2];

function makeSim(spec) {
  const fm = new FlightModel(spec);
  const fcs = new FlightControlSystem(fm);
  fm.fuel = spec.mass.maxFuel * 0.5;
  fm.payload = spec.mass.maxPayload * 0.5;
  for (const e of fm.engines) e.setRunning(true);
  return { fm, fcs };
}

function takeoff(spec) {
  const { fm, fcs } = makeSim(spec);
  fm.placeOnGround(0, 0, 0, 0);
  fm.controls.flaps = spec.flaps[Math.min(1, spec.flaps.length - 1)].deg;
  if (spec.category !== 'fighter') fm.controls.flaps = spec.flaps[Math.min(spec.category === 'private' && spec.id === 'k172' ? 1 : 2, spec.flaps.length - 1)].deg;
  fcs.reset();
  let t = 0, liftoff = null, dist0 = fm.position.clone(), rotate = false;
  for (const e of fm.engines) e.throttle = 1;
  const vr = spec.speeds.vr * KT;
  let maxPitch = 0, at300 = null;
  while (t < 120) {
    const att = fm.getAttitude();
    let pitchIn = 0;
    if (fm.ias > vr) rotate = true;
    let ap = null;
    if (rotate) ap = { pitch: Math.min(12 * DEG, att.pitch + 3 * DEG), bank: 0 };
    if (rotate && fm.wow) { pitchIn = 0.6; ap = null; }
    fcs.update(DT, { pitch: pitchIn, roll: 0, yaw: 0 }, ap);
    fm.step(DT);
    t += DT;
    maxPitch = Math.max(maxPitch, att.pitch);
    if (!liftoff && !fm.wow && fm.airborneTime > 0.5) liftoff = { t, d: fm.position.distanceTo(dist0), ias: fm.ias / KT };
    if (liftoff && !at300 && fm.position.y > 300) at300 = { t, d: Math.hypot(fm.position.x, fm.position.z) };
    if (fm.crashed) return { crash: fm.crashReason, t };
    if (at300) break;
  }
  return { liftoff, at300, vs: (fm.velocity.y / FT * 60).toFixed(0) + 'fpm', ias: (fm.ias / KT).toFixed(0) };
}

// Fly level with simple altitude/speed hold; returns throttle needed and alpha.
function cruise(spec, altFt, ktas, flapsIdx = 0, gear = 0) {
  const { fm, fcs } = makeSim(spec);
  fm.placeInAir(0, altFt * FT, 0, 0, ktas * KT, 2 * DEG);
  fm.controls.gear = gear;
  fm.controls.flaps = spec.flaps[flapsIdx].deg;
  fcs.reset();
  const alt0 = fm.position.y;
  let thr = 0.6, t = 0, iS = 0;
  const tgtTas = ktas * KT;
  let pitchT = 2 * DEG;
  let maxThr = 0;
  while (t < 90) {
    const att = fm.getAttitude();
    // altitude hold -> pitch target
    const altErr = alt0 - fm.position.y;
    const vsT = Math.max(-5, Math.min(5, altErr * 0.1));
    pitchT += (vsT - fm.velocity.y) * 0.004 * DT * 60;
    pitchT = Math.max(-10 * DEG, Math.min(20 * DEG, pitchT));
    const spdErr = tgtTas - fm.tas;
    iS += spdErr * DT;
    thr = Math.max(0, Math.min(1, 0.5 + spdErr * 0.08 + iS * 0.02));
    for (const e of fm.engines) e.throttle = thr;
    fcs.update(DT, { pitch: 0, roll: 0, yaw: 0 }, { pitch: pitchT, bank: 0 });
    fm.step(DT);
    t += DT;
    if (t > 60) maxThr = Math.max(maxThr, thr);
    if (fm.crashed) return { crash: fm.crashReason };
  }
  const att = fm.getAttitude();
  return {
    thr: thr.toFixed(2), alpha: (fm.alpha / DEG).toFixed(1), pitch: (att.pitch / DEG).toFixed(1), ias: (fm.ias / KT).toFixed(0), tas: (fm.tas / KT).toFixed(0), mach: fm.mach.toFixed(2),
    altErr: (fm.position.y - alt0).toFixed(0), elev: fm.controls.elevator.toFixed(2), ff: (fm.totalFuelFlow * 3600).toFixed(0) + 'kg/h', n1: fm.engines[0].n1 ? fm.engines[0].n1.toFixed(2) : fm.engines[0].rpm.toFixed(0),
  };
}

function stall(spec, flapsIdx) {
  const { fm, fcs } = makeSim(spec);
  fm.placeInAir(0, 2000, 0, 0, spec.speeds.vref * 1.4 * KT, 4 * DEG);
  fm.controls.flaps = spec.flaps[flapsIdx].deg;
  fm.controls.gear = flapsIdx ? 1 : 0;
  for (const e of fm.engines) e.throttle = 0;
  let t = 0, stallIas = null, elev = 0;
  // Direct elevator control: hold zero vertical speed until the wing stalls.
  while (t < 150) {
    elev = Math.max(-1, Math.min(1, elev + (0 - fm.velocity.y) * 0.02 * DT - fm.omega.x * 0.5 * DT));
    fm.controls.elevator = elev;
    fm.controls.aileron = 0; fm.controls.rudder = 0;
    fm.step(DT);
    t += DT;
    if (fm.stalled && !stallIas) stallIas = { ias: fm.ias / KT, nz: fm.nz };
    if (stallIas) break;
  }
  return { stallIas: stallIas ? stallIas.ias.toFixed(0) + ' nz ' + stallIas.nz.toFixed(2) : null, book: spec.speeds.vs };
}

function rollRate(spec) {
  const { fm, fcs } = makeSim(spec);
  const ias = spec.speeds.cruise * 0.6;
  fm.placeInAir(0, 3000, 0, 0, ias * KT, 2 * DEG);
  fm.controls.gear = 0;
  fcs.reset();
  for (const e of fm.engines) e.throttle = 0.7;
  let t = 0, maxP = 0;
  while (t < 3) {
    fcs.update(DT, { pitch: 0, roll: 1, yaw: 0 }, null);
    fm.step(DT);
    t += DT;
    maxP = Math.max(maxP, -fm.omega.z);
  }
  return (maxP / DEG).toFixed(0) + 'deg/s';
}

for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  console.log('==', spec.name);
  console.log(' takeoff', JSON.stringify(takeoff(spec)));
  console.log(' cruise ', JSON.stringify(cruise(spec, spec.speeds.cruiseAlt, spec.speeds.cruise)));
  const lowSpeed = spec.speeds.vref * 1.25;
  console.log(' approach clean 3000ft', JSON.stringify(cruise(spec, 3000, spec.speeds.vref * 1.5)));
  console.log(' approach full flaps', JSON.stringify(cruise(spec, 2000, spec.speeds.vref, spec.flaps.length - 1, 1)));
  console.log(' stall clean', JSON.stringify(stall(spec, 0)), ' full', JSON.stringify(stall(spec, spec.flaps.length - 1)));
  console.log(' roll rate', rollRate(spec));
}
