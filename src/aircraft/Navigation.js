// Flight management / GPS navigation: flight plan, leg guidance and ILS deviations.

import { runwayRelative, getAirport, bearingDeg } from '../world/airportGeometry.js';
import { NM } from '../physics/atmosphere.js';

const DEG = Math.PI / 180;

function wrap180(a) {
  a = ((a % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

export class NavSystem {
  constructor() {
    this.plan = [];
    this.active = 0;
    this.approach = null; // runway end object
    this.origin = null;
    this.destination = null;
    this.guidance = {
      valid: false,
      wpt: null,
      distance: 0,
      bearing: 0,
      desiredTrack: 0,
      xte: 0,
      ete: 0,
      totalRemaining: 0,
    };
    this.ils = { valid: false, locDev: 0, gsDev: 0, locDots: 0, gsDots: 0, dist: 0, gsValid: false, along: 0, lateral: 0, gsAlt: 0, end: null };
  }

  clear() {
    this.plan = [];
    this.active = 0;
    this.approach = null;
  }

  setRoute(originIcao, destIcao, extra = []) {
    this.plan = [];
    const o = getAirport(originIcao);
    const d = getAirport(destIcao);
    this.origin = o;
    this.destination = d;
    if (o) this.plan.push({ id: o.icao, name: o.name, type: 'airport', x: o.x, z: o.z });
    for (const w of extra) this.plan.push(w);
    if (d) this.plan.push({ id: d.icao, name: d.name, type: 'airport', x: d.x, z: d.z });
    this.active = Math.min(1, this.plan.length - 1);
  }

  addWaypoint(wp, index = null) {
    if (index === null || index >= this.plan.length) {
      // Insert before destination airport if there is one
      const last = this.plan[this.plan.length - 1];
      if (last && last.type === 'airport' && this.plan.length > 1) this.plan.splice(this.plan.length - 1, 0, wp);
      else this.plan.push(wp);
    } else this.plan.splice(index, 0, wp);
    if (this.plan.length === 1) this.active = 0;
  }

  removeWaypoint(i) {
    if (i < 0 || i >= this.plan.length) return;
    this.plan.splice(i, 1);
    if (this.active >= this.plan.length) this.active = this.plan.length - 1;
    if (this.active < 0) this.active = 0;
  }

  directTo(i) {
    if (i >= 0 && i < this.plan.length) {
      this.active = i;
      this._directFrom = null;
    }
  }

  setApproach(end) {
    this.approach = end;
  }

  update(x, z, alt, groundSpeed, track) {
    const g = this.guidance;
    const plan = this.plan;
    g.valid = plan.length > 0 && this.active < plan.length;
    if (g.valid) {
      const to = plan[this.active];
      const from = this.active > 0 ? plan[this.active - 1] : null;
      const dx = to.x - x,
        dz = to.z - z;
      g.wpt = to;
      g.distance = Math.hypot(dx, dz);
      g.bearing = bearingDeg(x, z, to.x, to.z);
      if (from) {
        const legX = to.x - from.x,
          legZ = to.z - from.z;
        const legLen = Math.hypot(legX, legZ) || 1;
        const ux = legX / legLen,
          uz = legZ / legLen;
        // Cross-track: positive when right of course
        const rx = x - from.x,
          rz = z - from.z;
        g.xte = rx * -uz + rz * ux;
        g.desiredTrack = bearingDeg(from.x, from.z, to.x, to.z);
        // Along-track check for sequencing
        const alongToGo = dx * ux + dz * uz;
        const turnRadius = (groundSpeed * groundSpeed) / (9.81 * Math.tan(25 * DEG));
        const next = plan[this.active + 1];
        let lead = 0;
        if (next) {
          const nTrack = bearingDeg(to.x, to.z, next.x, next.z);
          const turn = Math.abs(wrap180(nTrack - g.desiredTrack)) * DEG;
          lead = Math.min(turnRadius * Math.tan(turn / 2), 15000);
        }
        if (this.active < plan.length - 1 && (alongToGo < Math.max(lead, 150) || g.distance < 300)) this.active++;
      } else {
        g.xte = 0;
        g.desiredTrack = g.bearing;
        if (g.distance < 1000 && this.active < plan.length - 1) this.active++;
      }
      g.ete = groundSpeed > 5 ? g.distance / groundSpeed : 0;
      let rem = g.distance;
      for (let i = this.active; i < plan.length - 1; i++) rem += Math.hypot(plan[i + 1].x - plan[i].x, plan[i + 1].z - plan[i].z);
      g.totalRemaining = rem;
    }

    // ILS
    const ils = this.ils;
    const end = this.approach;
    ils.end = end;
    if (end) {
      const rel = runwayRelative(end, x, z);
      // Localizer antenna beyond the far end, glide slope antenna 300 m past threshold
      const locDist = end.length + 300 - rel.along;
      const gsDist = 300 - rel.along;
      ils.along = rel.along;
      ils.lateral = rel.lateral;
      ils.dist = Math.max(0, -rel.along);
      ils.locDev = Math.atan2(rel.lateral, Math.max(1, locDist)) / DEG;
      const height = alt - end.elevation;
      const elevAngle = Math.atan2(height, Math.max(1, gsDist)) / DEG;
      ils.gsDev = elevAngle - 3.0;
      ils.gsAlt = end.elevation + Math.max(0, gsDist) * Math.tan(3 * DEG);
      const inCone = Math.abs(ils.locDev) < 35 && locDist < 34 * NM && locDist > 0;
      ils.valid = inCone;
      ils.gsValid = inCone && Math.abs(ils.locDev) < 8 && gsDist > 0 && gsDist < 20 * NM && Math.abs(ils.gsDev) < 4;
      ils.locDots = Math.max(-2.5, Math.min(2.5, ils.locDev / 1.0));
      ils.gsDots = Math.max(-2.5, Math.min(2.5, ils.gsDev / 0.35));
      ils.course = end.heading;
      ils.dme = Math.hypot(end.x - x, end.z - z);
    } else {
      ils.valid = false;
      ils.gsValid = false;
    }
  }
}

export { wrap180 };
