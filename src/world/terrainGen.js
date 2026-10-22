// Deterministic terrain generator for the Aurelia region.
// Pure functions shared by the terrain workers (mesh building), the main thread
// (physics ground contact, object placement) and the map renderer.

import { Simplex2D, smoothstep, clamp, lerp, hash2 } from './noise.js';
import { WORLD, CONTINENT, MOUNTAIN_RANGES, ISLANDS, BAYS, LAKES, CITIES, AIRPORTS } from './worldData.js';

const N = new Simplex2D(WORLD.seed);
const N2 = new Simplex2D(WORLD.seed + 77);

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Pre-computed airport frames and flatten zones
// ---------------------------------------------------------------------------

const APRON_DEPTH = { international: 1150, regional: 650, ga: 320, military: 850, cargo: 950 };

export const AIRPORT_ZONES = AIRPORTS.map((ap) => {
  const s = Math.sin(ap.heading * DEG);
  const c = Math.cos(ap.heading * DEG);
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity;
  for (const rw of ap.runways) {
    uMin = Math.min(uMin, rw.along - rw.length / 2);
    uMax = Math.max(uMax, rw.along + rw.length / 2);
    vMin = Math.min(vMin, rw.right - rw.width / 2);
    vMax = Math.max(vMax, rw.right + rw.width / 2);
  }
  const apron = APRON_DEPTH[ap.type] || 600;
  uMin -= 450;
  uMax += 450;
  vMin -= 160;
  vMax += 160;
  if (ap.terminalSide > 0) vMax += apron;
  else vMin -= apron;
  // Runway thresholds for approach corridors
  const corridors = [];
  for (const rw of ap.noCorridor ? [] : ap.runways) {
    const cx = ap.x + rw.along * s + rw.right * c;
    const cz = ap.z - rw.along * c + rw.right * s;
    for (let end = 0; end < 2; end++) {
      // Direction of landing for this end: end 0 lands along +heading
      const dir = end === 0 ? 1 : -1;
      const tx = cx - dir * (rw.length / 2) * s;
      const tz = cz + dir * (rw.length / 2) * c;
      // outward direction (away from runway, toward approach)
      corridors.push({ tx, tz, ox: -dir * s, oz: dir * c });
    }
  }
  return {
    ap,
    s,
    c,
    uMin,
    uMax,
    vMin,
    vMax,
    blend: ap.elevation > 1000 ? 1600 : 2200,
    corridors,
    radius: Math.max(uMax - uMin, vMax - vMin) * 0.75 + 3000,
  };
});

// ---------------------------------------------------------------------------
// Natural height (before human-made modifications)
// ---------------------------------------------------------------------------

function distToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax,
    abz = bz - az;
  const apx = px - ax,
    apz = pz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? (apx * abx + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t,
    dz = apz - abz * t;
  return Math.sqrt(dx * dx + dz * dz);
}

function rangeDistance(range, x, z) {
  let d = Infinity;
  const pts = range.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const di = distToSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (di < d) d = di;
  }
  return d;
}

// Continent field: > 0 on land, < 0 at sea.
export function continentField(x, z) {
  const kx = x * 0.001,
    kz = z * 0.001;
  const wx = x + 20000 * N.fbm(kx * 0.011, kz * 0.011, 3);
  const wz = z + 20000 * N.fbm(kx * 0.011 + 31.7, kz * 0.011 - 12.3, 3);
  const dx = (wx - CONTINENT.cx) / CONTINENT.rx;
  const dz = (wz - CONTINENT.cz) / CONTINENT.rz;
  let cont = 1 - Math.sqrt(dx * dx + dz * dz) + 0.22 * N.fbm(kx * 0.025, kz * 0.025, 4);

  for (let i = 0; i < ISLANDS.length; i++) {
    const is = ISLANDS[i];
    const ddx = wx - is.x,
      ddz = wz - is.z;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d < is.r * 2) {
      const v = (1 - d / is.r) * 0.35 + 0.05 * N.noise(kx * 0.3, kz * 0.3);
      if (v > cont) cont = v;
    }
  }
  for (let i = 0; i < BAYS.length; i++) {
    const b = BAYS[i];
    const ddx = wx - b.x,
      ddz = wz - b.z;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d < b.r * 2.2) {
      const v = (d / b.r - 1) * 0.25;
      if (v < cont) cont = v;
    }
  }
  return cont;
}

export function naturalHeight(x, z) {
  const kx = x * 0.001,
    kz = z * 0.001;
  const cont = continentField(x, z);

  // Sea floor
  const sea = -8 + cont * 1600;

  if (cont < -0.06) return sea;

  // Land relief
  const coastRamp = smoothstep(0.0, 0.16, cont);
  let land = 4 + coastRamp * (18 + 110 * (0.5 + 0.5 * N.fbm(kx * 0.028, kz * 0.028, 4)));

  // Rolling hills
  const hillMask = smoothstep(0.0, 0.5, N2.fbm(kx * 0.012 + 3.1, kz * 0.012 - 7.7, 3));
  land += coastRamp * hillMask * 380 * Math.max(0, N.fbm(kx * 0.06 + 7.0, kz * 0.06 + 3.0, 4) + 0.1);

  // Mountain ranges
  for (let i = 0; i < MOUNTAIN_RANGES.length; i++) {
    const r = MOUNTAIN_RANGES[i];
    const d = rangeDistance(r, x + 6000 * N2.noise(kx * 0.02, kz * 0.02), z + 6000 * N2.noise(kx * 0.02 + 9, kz * 0.02));
    if (d < r.width) {
      const m = 1 - d / r.width;
      const shape = m * m * (3 - 2 * m);
      const ridge = N.ridged(kx * 0.11 + i * 13.1, kz * 0.11, 6);
      const massif = 0.7 + 0.3 * N2.fbm(kx * 0.02 + i, kz * 0.02, 2);
      land += r.peak * Math.pow(shape, 1.15) * (0.32 + 0.85 * ridge) * massif * coastRamp;
    }
  }

  // Small scale detail (scaled by relief so plains stay smooth)
  const rough = 0.25 + Math.min(1.5, land / 900);
  land += rough * 9 * N2.fbm(kx * 0.6, kz * 0.6, 3);

  if (cont > 0.06) return land;
  // Smooth transition across the coastline
  const t = smoothstep(-0.06, 0.06, cont);
  return lerp(sea, land, t);
}

// ---------------------------------------------------------------------------
// Cities, lakes and airports
// ---------------------------------------------------------------------------

const CITY_BASE = CITIES.map((c) => Math.max(4, naturalHeight(c.x, c.z)));

const LAKE_DATA = LAKES.map((l) => ({ ...l }));

export function terrainHeight(x, z) {
  let h = naturalHeight(x, z);

  // Cities: soften relief
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i];
    const dx = x - c.x,
      dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    const R = c.r * 1.5;
    if (d2 < R * R) {
      const w = 1 - smoothstep(c.r * 0.7, R, Math.sqrt(d2));
      const base = CITY_BASE[i];
      if (h > base) h = lerp(h, base + (h - base) * 0.15, w * 0.9);
      else if (h > 0.5) h = lerp(h, Math.max(h, Math.min(base, 3 + (base - h) * 0.2 + h)), w * 0.5);
    }
  }

  // Lakes
  for (let i = 0; i < LAKE_DATA.length; i++) {
    const l = LAKE_DATA[i];
    const dx = x - l.x,
      dz = z - l.z;
    const d2 = dx * dx + dz * dz;
    const R = l.r * 2.2;
    if (d2 < R * R) {
      const d = Math.sqrt(d2) * (1 + 0.12 * N2.noise(x * 0.0006, z * 0.0006));
      const shore = l.level + 2 + (d - l.r) * 0.02;
      const bed = l.level - 3 - 22 * smoothstep(l.r, l.r * 0.3, d);
      const target = d < l.r ? bed : shore;
      const w = 1 - smoothstep(l.r * 1.1, R, d);
      h = lerp(h, Math.min(h, target), w);
      if (d < l.r) h = Math.min(h, bed);
    }
  }

  // Airports: approach corridors (keep terrain under the glide path) then flatten.
  for (let i = 0; i < AIRPORT_ZONES.length; i++) {
    const zn = AIRPORT_ZONES[i];
    const dx = x - zn.ap.x,
      dz = z - zn.ap.z;
    if (Math.abs(dx) > 26000 || Math.abs(dz) > 26000) continue;
    const elev = zn.ap.elevation;
    for (let k = 0; k < zn.corridors.length; k++) {
      const co = zn.corridors[k];
      const rx = x - co.tx,
        rz = z - co.tz;
      const along = rx * co.ox + rz * co.oz;
      if (along < 0 || along > 22000) continue;
      const lat = Math.abs(rx * -co.oz + rz * co.ox);
      const width = 900 + along * 0.08;
      if (lat > width * 2.2) continue;
      const cap = elev + along * Math.tan(2.0 * DEG) - 20;
      if (h > cap) {
        const w = 1 - smoothstep(width, width * 2.2, lat);
        h -= (h - cap) * w;
      }
    }
    // Flatten zone (rounded rectangle in airport frame)
    const u = dx * zn.s - dz * zn.c;
    const v = dx * zn.c + dz * zn.s;
    const du = u < zn.uMin ? zn.uMin - u : u > zn.uMax ? u - zn.uMax : 0;
    const dv = v < zn.vMin ? zn.vMin - v : v > zn.vMax ? v - zn.vMax : 0;
    const d = Math.sqrt(du * du + dv * dv);
    if (d < zn.blend) {
      const w = 1 - smoothstep(0, zn.blend, d);
      h = lerp(h, elev, w);
    }
  }
  return h;
}

// Returns 0..1 how strongly an airport flattening affects the position (1 = on airport).
export function airportInfluence(x, z) {
  let best = 0;
  for (let i = 0; i < AIRPORT_ZONES.length; i++) {
    const zn = AIRPORT_ZONES[i];
    const dx = x - zn.ap.x,
      dz = z - zn.ap.z;
    if (Math.abs(dx) > 9000 || Math.abs(dz) > 9000) continue;
    const u = dx * zn.s - dz * zn.c;
    const v = dx * zn.c + dz * zn.s;
    const du = u < zn.uMin ? zn.uMin - u : u > zn.uMax ? u - zn.uMax : 0;
    const dv = v < zn.vMin ? zn.vMin - v : v > zn.vMax ? v - zn.vMax : 0;
    const d = Math.sqrt(du * du + dv * dv);
    const w = 1 - smoothstep(0, 350, d);
    if (w > best) best = w;
  }
  return best;
}

export function cityInfluence(x, z) {
  let best = 0;
  let city = -1;
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i];
    const dx = x - c.x,
      dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.r * c.r * 1.3) continue;
    const d = Math.sqrt(d2) * (1 + 0.25 * N2.noise(x * 0.0009 + i, z * 0.0009));
    const w = 1 - smoothstep(c.r * 0.55, c.r, d);
    if (w > best) {
      best = w;
      city = i;
    }
  }
  return { w: best, city };
}

export function lakeAt(x, z) {
  for (let i = 0; i < LAKE_DATA.length; i++) {
    const l = LAKE_DATA[i];
    const dx = x - l.x,
      dz = z - l.z;
    if (dx * dx + dz * dz < l.r * l.r * 2.0) return l;
  }
  return null;
}

// Water surface height at a location (sea level or a lake level), or -Infinity if none.
export function waterLevelAt(x, z) {
  const l = lakeAt(x, z);
  if (l) return l.level;
  return 0;
}

// ---------------------------------------------------------------------------
// Surface appearance
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function col(r, g, b) {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

const C = {
  deep: col(0.05, 0.16, 0.2),
  shallow: col(0.62, 0.62, 0.46),
  sand: col(0.8, 0.74, 0.56),
  grass: col(0.33, 0.44, 0.19),
  grass2: col(0.43, 0.5, 0.24),
  dry: col(0.56, 0.53, 0.31),
  forest: col(0.11, 0.21, 0.08),
  forest2: col(0.16, 0.25, 0.1),
  alpine: col(0.42, 0.45, 0.3),
  rock: col(0.43, 0.4, 0.36),
  rock2: col(0.3, 0.28, 0.26),
  snow: col(0.93, 0.95, 0.98),
  city: col(0.45, 0.45, 0.44),
  city2: col(0.36, 0.36, 0.37),
  airportGrass: col(0.38, 0.5, 0.22),
};
const FIELDS = [
  col(0.76, 0.67, 0.38),
  col(0.38, 0.53, 0.17),
  col(0.47, 0.6, 0.25),
  col(0.47, 0.38, 0.25),
  col(0.58, 0.54, 0.33),
  col(0.32, 0.46, 0.16),
  col(0.69, 0.62, 0.36),
];

function mix3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function mixInto(out, b, t) {
  if (t <= 0) return;
  if (t >= 1) {
    out[0] = b[0];
    out[1] = b[1];
    out[2] = b[2];
    return;
  }
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
}

export function farmMask(x, z, h) {
  const m = N2.fbm(x * 0.00007 + 11.0, z * 0.00007 - 4.0, 3);
  return smoothstep(0.02, 0.22, m) * (1 - smoothstep(380, 620, h));
}

export function forestDensity(x, z, h, ny) {
  if (h < 3) return 0;
  const n = N.fbm(x * 0.00007 + 50, z * 0.00007 - 20, 5) + 0.3 * N2.noise(x * 0.0011, z * 0.0011);
  let d = smoothstep(0.02, 0.26, n);
  d *= 1 - smoothstep(1700, 2050, h);
  d *= smoothstep(0.62, 0.8, ny);
  d *= 1 - farmMask(x, z, h) * 0.95;
  return d;
}

// Writes linear RGB into out[0..2]. Returns forest density for convenience.
export function terrainColor(x, z, h, ny, out) {
  const wl = waterLevelAt(x, z);
  const n1 = N2.noise(x * 0.002, z * 0.002);
  const n2 = N.noise(x * 0.0004 + 3, z * 0.0004 - 8);

  if (h < wl + 0.6) {
    const depth = wl - h;
    mix3(out, C.shallow, C.deep, smoothstep(0, 35, depth));
    return 0;
  }

  // Base grass with large scale variation
  mix3(out, C.grass, C.grass2, 0.5 + 0.5 * n2);
  mixInto(out, C.dry, smoothstep(0.2, 0.8, N2.noise(x * 0.00015 - 30, z * 0.00015)) * 0.6);

  // Farmland patchwork
  const farm = farmMask(x, z, h);
  if (farm > 0.01 && ny > 0.96) {
    const a = 0.45;
    const fx = x * Math.cos(a) - z * Math.sin(a);
    const fz = x * Math.sin(a) + z * Math.cos(a);
    const cx = Math.floor(fx / 420),
      cz = Math.floor(fz / (260 + 140 * hash2(Math.floor(fx / 420), 7)));
    const r = hash2(cx, cz, 3);
    const fc = FIELDS[Math.floor(r * FIELDS.length)];
    mixInto(out, fc, farm * 0.9);
  }

  // Forest
  const forest = forestDensity(x, z, h, ny);
  if (forest > 0) {
    mixInto(out, n1 > 0 ? C.forest : C.forest2, Math.min(1, forest * 1.15));
  }

  // Beaches
  const beach = 1 - smoothstep(wl + 1.5, wl + 4.5 + 3 * n1, h);
  if (beach > 0 && ny > 0.9) mixInto(out, C.sand, beach);

  // Alpine meadows
  mixInto(out, C.alpine, smoothstep(1500, 2100, h + n1 * 150) * 0.8);

  // Rock on steep slopes and high altitudes
  const rockT = Math.max(1 - smoothstep(0.6, 0.78, ny), smoothstep(1750, 2350, h + n1 * 250));
  if (rockT > 0) {
    const rc = n2 > 0 ? C.rock : C.rock2;
    mixInto(out, rc, rockT);
  }

  // Snow
  const snowLine = 2450 + n1 * 260 + n2 * 150;
  const snowT = smoothstep(snowLine, snowLine + 220, h) * smoothstep(0.52, 0.7, ny);
  mixInto(out, C.snow, snowT);

  // Urban areas
  const ci = cityInfluence(x, z);
  if (ci.w > 0) mixInto(out, n1 > 0 ? C.city : C.city2, ci.w * 0.85);

  // Airport grass
  const ai = airportInfluence(x, z);
  if (ai > 0) mixInto(out, C.airportGrass, ai * 0.9);

  return forest;
}

// Approximate surface normal Y component via finite differences.
export function terrainNormalY(x, z, eps = 4) {
  const hx = terrainHeight(x + eps, z) - terrainHeight(x - eps, z);
  const hz = terrainHeight(x, z + eps) - terrainHeight(x, z - eps);
  const nx = -hx,
    nz = -hz,
    ny = 2 * eps;
  return ny / Math.sqrt(nx * nx + ny * ny + nz * nz);
}

export { clamp };
