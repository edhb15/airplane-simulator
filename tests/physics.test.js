import { describe, it, expect } from 'vitest';
import { getAircraft, AIRCRAFT } from '../src/aircraft/aircraftData.js';
import { AircraftSim } from '../src/aircraft/AircraftSim.js';
import { getRunwayEnd, runwayRelative } from '../src/world/airportGeometry.js';
import { terrainHeight } from '../src/world/terrainGen.js';
import { AIRPORTS } from '../src/world/worldData.js';
import { KT, FT, DEG, FPM } from '../src/physics/atmosphere.js';

const flat = { h: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', water: false };
const flatGround = () => flat;

function run(sim, seconds, each) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    sim.update(dt);
    if (each && each(t) === false) break;
  }
}

describe('terrain', () => {
  it('flattens every airport to its published elevation', () => {
    for (const ap of AIRPORTS) {
      expect(Math.abs(terrainHeight(ap.x, ap.z) - ap.elevation)).toBeLessThan(0.5);
    }
  });
  it('is deterministic', () => {
    expect(terrainHeight(12345, -6789)).toBe(terrainHeight(12345, -6789));
  });
});

describe('flight model', () => {
  it('every aircraft can take off from a 3 km runway', () => {
    for (const spec of AIRCRAFT) {
      const sim = new AircraftSim(spec, { groundFn: flatGround });
      sim.spawn({ mode: 'runway', x: 0, z: 0, heading: 0, groundH: 0, fuelFrac: 0.5, payloadFrac: 0.5 });
      sim.throttleLever = 1;
      let liftoffDist = null;
      run(sim, 120, () => {
        sim.input.pitch = sim.fm.ias > spec.speeds.vr * KT && sim.snapshot().pitch < 9 ? 0.5 : 0;
        if (!sim.fm.wow && sim.fm.airborneTime > 1 && liftoffDist === null) liftoffDist = Math.hypot(sim.position.x, sim.position.z);
        if (liftoffDist !== null) return false;
      });
      expect(sim.crashed, spec.id).toBe(false);
      expect(liftoffDist, spec.id).not.toBeNull();
      expect(liftoffDist, spec.id).toBeLessThan(3000);
    }
  });

  it('autopilot holds altitude', () => {
    const sim = new AircraftSim(getAircraft('mj320'), { groundFn: flatGround });
    sim.spawn({ mode: 'air', x: 0, z: 0, heading: 0, altitude: 3000 * FT, speed: 220 * KT });
    sim.ap.engage();
    sim.ap.modeALT();
    sim.ap.setAthr(true);
    sim.ap.spd = 220;
    let maxDev = 0;
    run(sim, 90, (t) => {
      if (t > 20) maxDev = Math.max(maxDev, Math.abs(sim.position.y / FT - sim.ap.alt));
    });
    expect(maxDev).toBeLessThan(60);
  });

  it('a hard landing collapses the gear', () => {
    const sim = new AircraftSim(getAircraft('mj320'), { groundFn: flatGround });
    sim.spawn({ mode: 'air', x: 0, z: 0, heading: 0, altitude: 30, speed: 70 });
    sim.setGear(true);
    sim.gearPos = 1;
    sim.fm.velocity.y = -9;
    run(sim, 5, () => !sim.crashed);
    expect(sim.crashed).toBe(true);
  });

  it('autolands on the runway centreline', () => {
    const sim = new AircraftSim(getAircraft('mj320'), {
      groundFn: (x, z) => {
        flat.h = Math.max(0, terrainHeight(x, z));
        return flat;
      },
    });
    const end = getRunwayEnd('AXMI', '27R');
    const sx = end.x - end.dirX * 18000,
      sz = end.z - end.dirZ * 18000;
    sim.spawn({ mode: 'air', x: sx, z: sz, heading: end.heading * DEG, altitude: end.elevation + 3000 * FT, speed: 160 * KT });
    sim.setGear(true);
    sim.setFlaps(4);
    sim.nav.setApproach(end);
    sim.ap.alt = Math.round((end.elevation / FT + 2500) / 100) * 100;
    sim.ap.engage();
    sim.ap.modeVS(-800);
    sim.ap.setAthr(true);
    sim.ap.spd = 140;
    sim.ap.modeAPP();
    sim.spoilersArmed = true;
    sim.autobrake = 'MED';
    flat.h = 0;
    run(sim, 600, () => !(sim.fm.wow && sim.fm.groundSpeed < 3) && !sim.crashed);
    expect(sim.crashed).toBe(false);
    const td = sim.stats.touchdowns[0];
    expect(td).toBeTruthy();
    expect(td.vs / FPM).toBeGreaterThan(-300);
    const rel = runwayRelative(end, sim.position.x, sim.position.z);
    expect(Math.abs(rel.lateral)).toBeLessThan(10);
    expect(rel.along).toBeLessThan(end.length);
  });
});
