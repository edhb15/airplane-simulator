// Wind field: mean wind with altitude profile, gusts, mechanical and convective
// turbulence, and thunderstorm cells (updrafts/downdrafts and severe turbulence).

import { Vector3 } from 'three';
import { Simplex2D } from '../world/noise.js';

const DEG = Math.PI / 180;

export class WindModel {
  constructor(seed = 4242) {
    this.n = new Simplex2D(seed);
    this.time = 0;
    this.intensity = 0;
    this.mean = new Vector3();
  }

  update(dt) {
    this.time += dt;
  }

  // weather: { windDir (from, deg), windSpeed (m/s @10m), gust (m/s), turbulence 0..1, storms: [] }
  sample(pos, agl, weather, out, outMoment) {
    const t = this.time;
    const n = this.n;
    const h = Math.max(1, agl);
    // Surface boundary layer (power law) and stronger winds aloft
    let spd = weather.windSpeed * Math.min(1.45, Math.pow(h / 10, 0.14)) * (1 + Math.max(0, pos.y) / 7000);
    if (weather.gust > 0) {
      const g = Math.max(0, n.noise(t * 0.12, 3.7));
      spd += weather.gust * g * g * 1.6;
    }
    const dir = (weather.windDir + Math.min(30, Math.max(0, pos.y) / 350)) * DEG;
    out.set(-Math.sin(dir) * spd, 0, Math.cos(dir) * spd);
    this.mean.copy(out);

    let I = weather.turbulence || 0;
    // Mechanical turbulence close to the ground in strong wind
    I = Math.max(I, Math.min(0.55, weather.windSpeed / 28) * (1 - Math.min(1, agl / 600)));
    // Thunderstorm cells
    if (weather.storms) {
      for (const s of weather.storms) {
        const dx = pos.x - s.x,
          dz = pos.z - s.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < s.r * 2.5) {
          const k = 1 - d / (s.r * 2.5);
          I = Math.max(I, s.intensity * k);
          // Downdraft in the core, outflow near the ground (microburst)
          if (d < s.r) {
            out.y -= 6 * s.intensity * (1 - d / s.r) * Math.min(1, pos.y / 400 + 0.2);
            if (agl < 400 && d > 1) {
              const outflow = 8 * s.intensity * (1 - agl / 400) * (d / s.r);
              out.x += (dx / d) * outflow;
              out.z += (dz / d) * outflow;
            }
          } else if (d < s.r * 1.6) {
            out.y += 3 * s.intensity * (1 - (d - s.r) / (s.r * 0.6));
          }
        }
      }
    }
    this.intensity = I;
    if (I > 0.001) {
      const sigma = I * 5.5;
      const sx = pos.x * 0.004,
        sz = pos.z * 0.004;
      out.x += sigma * n.noise(sx + t * 0.6, sz + 11.3);
      out.z += sigma * n.noise(sx - 7.1, sz + t * 0.6);
      out.y += sigma * 0.8 * (n.noise(sx * 1.7 + 3.3, sz * 1.7 - t * 0.9) + 0.4 * n.noise(t * 2.3, 5.5));
      if (outMoment) {
        const m = I * I * 0.012;
        outMoment.set(
          m * n.noise(t * 1.9, sx + 1.1),
          m * 0.5 * n.noise(t * 1.3 + 4.4, sz),
          m * 1.6 * n.noise(t * 2.2 - 9.1, sx - sz)
        );
      }
    } else if (outMoment) outMoment.set(0, 0, 0);
    return out;
  }
}
