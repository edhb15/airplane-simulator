// Runway and airport geometry derived from worldData (pure, no rendering).

import { AIRPORTS } from './worldData.js';

const DEG = Math.PI / 180;

export function airportToWorld(ap, along, right) {
  const s = Math.sin(ap.heading * DEG);
  const c = Math.cos(ap.heading * DEG);
  return { x: ap.x + along * s + right * c, z: ap.z - along * c + right * s };
}

export function worldToAirport(ap, x, z) {
  const s = Math.sin(ap.heading * DEG);
  const c = Math.cos(ap.heading * DEG);
  const dx = x - ap.x,
    dz = z - ap.z;
  return { along: dx * s - dz * c, right: dx * c + dz * s };
}

function normHdg(h) {
  return ((h % 360) + 360) % 360;
}

// Builds runway objects with both ends.
function buildRunways(ap) {
  return ap.runways.map((rw, idx) => {
    const hdg = rw.heading !== undefined ? rw.heading : ap.heading;
    const center = airportToWorld(ap, rw.along, rw.right);
    const s = Math.sin(hdg * DEG),
      c = Math.cos(hdg * DEG);
    const half = rw.length / 2;
    const endA = {
      id: rw.ids[0],
      heading: normHdg(hdg),
      x: center.x - s * half,
      z: center.z + c * half,
      ils: !!(rw.ils && rw.ils[0]),
    };
    const endB = {
      id: rw.ids[1],
      heading: normHdg(hdg + 180),
      x: center.x + s * half,
      z: center.z - c * half,
      ils: !!(rw.ils && rw.ils[1]),
    };
    const runway = {
      airport: ap,
      index: idx,
      name: `${rw.ids[0]}/${rw.ids[1]}`,
      cx: center.x,
      cz: center.z,
      heading: normHdg(hdg),
      length: rw.length,
      width: rw.width,
      elevation: ap.elevation,
      ends: [endA, endB],
    };
    for (const e of runway.ends) {
      e.runway = runway;
      e.airport = ap;
      e.elevation = ap.elevation;
      e.length = rw.length;
      e.width = rw.width;
      e.dirX = Math.sin(e.heading * DEG);
      e.dirZ = -Math.cos(e.heading * DEG);
    }
    endA.opposite = endB;
    endB.opposite = endA;
    return runway;
  });
}

export const AIRPORT_INFO = AIRPORTS.map((ap) => ({ ...ap, runwayObjs: buildRunways(ap) }));
for (const info of AIRPORT_INFO) {
  for (const r of info.runwayObjs) {
    r.airport = info;
    for (const e of r.ends) e.airport = info;
  }
}

export const ALL_RUNWAYS = AIRPORT_INFO.flatMap((a) => a.runwayObjs);
export const ALL_RUNWAY_ENDS = ALL_RUNWAYS.flatMap((r) => r.ends);

export function getAirport(icao) {
  return AIRPORT_INFO.find((a) => a.icao === icao) || null;
}

export function getRunwayEnd(icao, id) {
  const ap = getAirport(icao);
  if (!ap) return null;
  for (const r of ap.runwayObjs) for (const e of r.ends) if (e.id === id) return e;
  return null;
}

// Position relative to a runway end: along = distance past the threshold along
// the landing direction, lateral = right of centreline.
export function runwayRelative(end, x, z) {
  const dx = x - end.x,
    dz = z - end.z;
  return { along: dx * end.dirX + dz * end.dirZ, lateral: dx * -end.dirZ + dz * end.dirX };
}

// Is a point on a runway surface? Returns the runway or null.
export function runwayAt(x, z, margin = 0) {
  for (const r of ALL_RUNWAYS) {
    const e = r.ends[0];
    const rel = runwayRelative(e, x, z);
    if (rel.along >= -margin - 60 && rel.along <= r.length + margin + 60 && Math.abs(rel.lateral) <= r.width / 2 + margin) return r;
  }
  return null;
}

export function nearestAirport(x, z, filter = null) {
  let best = null,
    bd = Infinity;
  for (const a of AIRPORT_INFO) {
    if (filter && !filter(a)) continue;
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return { airport: best, distance: bd };
}

// Picks the runway end best aligned with the wind (wind direction = from).
export function bestRunwayEnd(airport, windDir, windSpeed, minLength = 0) {
  let best = null,
    bestScore = -Infinity;
  for (const r of airport.runwayObjs) {
    if (r.length < minLength) continue;
    for (const e of r.ends) {
      const head = Math.cos((windDir - e.heading) * DEG) * windSpeed;
      const score = head * 2 + (e.ils ? 3 : 0) + r.length / 1000;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
  }
  return best;
}

export function bearingDeg(x0, z0, x1, z1) {
  return normHdg(Math.atan2(x1 - x0, -(z1 - z0)) / DEG);
}
