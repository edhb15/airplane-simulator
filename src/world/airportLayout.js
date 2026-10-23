// Procedural airport layout: taxiways, aprons, buildings, gates, lighting and a
// taxi route graph, generated from the runway definitions in worldData.
// Coordinates are in the airport frame (u = along primary heading, v = right of it)
// unless noted; helpers convert to world positions.

import { AIRPORT_INFO } from './airportGeometry.js';

const DEG = Math.PI / 180;

const PROFILE = {
  international: { taxiOffset: 190, taxiWidth: 23, apronDepth: 330, terminalDepth: 70, gateSpacing: 72, towerH: 72, hangars: 4, piers: 3 },
  regional: { taxiOffset: 150, taxiWidth: 18, apronDepth: 170, terminalDepth: 40, gateSpacing: 60, towerH: 34, hangars: 2, piers: 0 },
  ga: { taxiOffset: 85, taxiWidth: 10, apronDepth: 90, terminalDepth: 16, gateSpacing: 22, towerH: 14, hangars: 4, piers: 0 },
  military: { taxiOffset: 170, taxiWidth: 20, apronDepth: 200, terminalDepth: 30, gateSpacing: 48, towerH: 30, hangars: 3, piers: 0 },
  cargo: { taxiOffset: 190, taxiWidth: 23, apronDepth: 260, terminalDepth: 80, gateSpacing: 85, towerH: 46, hangars: 2, piers: 0 },
};

export function toWorld(ap, u, v) {
  const s = Math.sin(ap.heading * DEG),
    c = Math.cos(ap.heading * DEG);
  return { x: ap.x + u * s + v * c, z: ap.z - u * c + v * s };
}

export function toLocal(ap, x, z) {
  const s = Math.sin(ap.heading * DEG),
    c = Math.cos(ap.heading * DEG);
  const dx = x - ap.x,
    dz = z - ap.z;
  return { u: dx * s - dz * c, v: dx * c + dz * s };
}

function buildLayout(ap) {
  const P = PROFILE[ap.type] || PROFILE.regional;
  const rws = ap.runways;
  const L = {
    airport: ap,
    profile: P,
    rects: [], // paved rectangles: {u0,u1,v0,v1, kind}
    taxiways: [], // {a:{u,v}, b:{u,v}, width}
    buildings: [], // {kind, u, v, w (along u), d (along v), h, rot}
    gates: [], // {u, v, heading (deg, world), size, bridge}
    lights: [], // {u, v, color, size, papi?, flash?, kind}
    hangars: [],
    vehicles: [], // loop paths
    nodes: [], // taxi graph nodes {id, u, v, kind, runway?}
    edges: [],
    holdPoints: {}, // runwayEndId -> node id
    parking: [],
    windsocks: [],
  };

  // ---- Runways in the airport frame
  const runwayRects = rws.map((r) => ({ u0: r.along - r.length / 2, u1: r.along + r.length / 2, vc: r.right, w: r.width, r }));

  // Terminal zone
  let termV0, termV1, side;
  if (rws.length > 1) {
    const vs = runwayRects.map((r) => r.vc).sort((a, b) => a - b);
    side = 0;
    termV0 = vs[0] + P.taxiOffset + P.taxiWidth;
    termV1 = vs[vs.length - 1] - P.taxiOffset - P.taxiWidth;
  } else {
    side = ap.terminalSide || 1;
    const edge = runwayRects[0].vc + side * (P.taxiOffset + P.taxiWidth / 2);
    termV0 = side > 0 ? edge + P.taxiWidth / 2 + 5 : edge - P.taxiWidth / 2 - 5 - P.apronDepth - P.terminalDepth - 120;
    termV1 = side > 0 ? edge + P.taxiWidth / 2 + 5 + P.apronDepth + P.terminalDepth + 120 : edge - P.taxiWidth / 2 - 5;
  }

  // ---- Parallel taxiways and connectors
  let nodeId = 0;
  const addNode = (u, v, kind, extra = {}) => {
    const n = { id: nodeId++, u, v, kind, ...extra };
    L.nodes.push(n);
    return n;
  };
  const link = (a, b) => {
    L.edges.push([a.id, b.id]);
  };
  const parallelV = [];
  for (const rr of runwayRects) {
    const dir = rws.length > 1 ? (rr.vc < 0 ? 1 : -1) : side;
    const tv = rr.vc + dir * P.taxiOffset;
    parallelV.push(tv);
    L.taxiways.push({ a: { u: rr.u0, v: tv }, b: { u: rr.u1, v: tv }, width: P.taxiWidth, kind: 'parallel' });
    // Connectors: ends + every ~750 m
    const count = Math.max(2, Math.round((rr.u1 - rr.u0) / 750) + 1);
    let prevPar = null;
    for (let i = 0; i < count; i++) {
      const u = rr.u0 + 30 + ((rr.u1 - rr.u0 - 60) * i) / (count - 1);
      L.taxiways.push({ a: { u, v: rr.vc }, b: { u, v: tv }, width: P.taxiWidth, kind: 'connector' });
      const rn = addNode(u, rr.vc, 'runway', { runway: rr.r });
      const hn = addNode(u, rr.vc + dir * (rr.w / 2 + 45), 'hold', { runway: rr.r });
      const pn = addNode(u, tv, 'parallel');
      link(rn, hn);
      link(hn, pn);
      if (prevPar) link(prevPar, pn);
      prevPar = pn;
      if (i === 0) {
        L.holdPoints[rr.r.ids[0]] = hn.id;
        hn.end = rr.r.ids[0];
        rn.end = rr.r.ids[0];
      }
      if (i === count - 1) {
        L.holdPoints[rr.r.ids[1]] = hn.id;
        hn.end = rr.r.ids[1];
        rn.end = rr.r.ids[1];
      }
    }
  }

  // ---- Apron and terminal
  const apronLen = Math.min(2400, Math.max(260, (runwayRects[0].u1 - runwayRects[0].u0) * (ap.type === 'ga' ? 0.35 : 0.55)));
  const apronU0 = -apronLen / 2,
    apronU1 = apronLen / 2;
  let apronV0, apronV1, termV, termFacing;
  if (side === 0) {
    // between parallel runways (centre field)
    const mid = (termV0 + termV1) / 2;
    apronV0 = termV0;
    apronV1 = termV1;
    termV = mid;
    termFacing = 0;
  } else if (side > 0) {
    apronV0 = parallelV[0] + P.taxiWidth / 2 + 2;
    apronV1 = apronV0 + P.apronDepth;
    termV = apronV1 + P.terminalDepth / 2;
    termFacing = -1;
  } else {
    apronV1 = parallelV[0] - P.taxiWidth / 2 - 2;
    apronV0 = apronV1 - P.apronDepth;
    termV = apronV0 - P.terminalDepth / 2;
    termFacing = 1;
  }
  L.rects.push({ u0: apronU0, u1: apronU1, v0: Math.min(apronV0, apronV1), v1: Math.max(apronV0, apronV1), kind: 'apron' });
  L.apron = { u0: apronU0, u1: apronU1, v0: Math.min(apronV0, apronV1), v1: Math.max(apronV0, apronV1) };

  // Apron taxi lane nodes connecting to the parallel taxiway(s)
  const laneV = side === 0 ? null : side > 0 ? apronV0 + 40 : apronV1 - 40;

  // ---- Gates & buildings by airport type
  const gateHeadingToward = (fromU, fromV, toU, toV) => {
    // world heading of a vector in airport frame
    const du = toU - fromU,
      dv = toV - fromV;
    const ang = Math.atan2(dv, du) / DEG; // angle from +u toward +v
    return (ap.heading + ang + 360) % 360;
  };

  if (ap.type === 'international') {
    // Central terminal with piers extending toward both runways
    const tW = apronLen * 0.7;
    L.buildings.push({ kind: 'terminal', u: 0, v: termV, w: tW, d: 90, h: 26 });
    const piers = P.piers;
    for (let i = 0; i < piers; i++) {
      const pu = -tW / 2 + 120 + (i * (tW - 240)) / Math.max(1, piers - 1);
      for (const dir of [-1, 1]) {
        const v0 = termV + dir * 45;
        const pierLen = (apronV1 - apronV0) / 2 - 140;
        L.buildings.push({ kind: 'pier', u: pu, v: v0 + (dir * pierLen) / 2, w: 32, d: pierLen, h: 14 });
        // gates on both sides of the pier
        const n = Math.max(2, Math.floor(pierLen / P.gateSpacing));
        for (let g = 0; g < n; g++) {
          const gv = v0 + dir * (40 + g * P.gateSpacing);
          for (const s2 of [-1, 1]) {
            const gu = pu + s2 * (16 + 34);
            L.gates.push({ u: gu, v: gv, headingTo: { u: pu, v: gv }, size: 'large', bridge: true, bridgeFrom: { u: pu + s2 * 16, v: gv } });
          }
        }
      }
    }
    // Apron lanes on both sides
    for (const dir of [-1, 1]) {
      const lv = termV + dir * ((apronV1 - apronV0) / 2 - 70);
      L.taxiways.push({ a: { u: apronU0, v: lv }, b: { u: apronU1, v: lv }, width: P.taxiWidth, kind: 'lane' });
    }
  } else if (ap.type === 'regional' || ap.type === 'cargo') {
    const tW = Math.min(apronLen * 0.75, ap.type === 'cargo' ? 900 : 520);
    L.buildings.push({ kind: ap.type === 'cargo' ? 'cargoTerminal' : 'terminal', u: 0, v: termV, w: tW, d: P.terminalDepth, h: ap.type === 'cargo' ? 24 : 16 });
    const n = Math.max(3, Math.floor(tW / P.gateSpacing));
    const gv = termV + termFacing * (P.terminalDepth / 2 + 38);
    for (let g = 0; g < n; g++) {
      const gu = -tW / 2 + P.gateSpacing / 2 + g * P.gateSpacing;
      L.gates.push({ u: gu, v: gv, headingTo: { u: gu, v: termV }, size: ap.type === 'cargo' ? 'heavy' : 'medium', bridge: ap.type === 'regional' && g % 2 === 0, bridgeFrom: { u: gu, v: termV + termFacing * (P.terminalDepth / 2) } });
    }
    L.taxiways.push({ a: { u: apronU0, v: laneV }, b: { u: apronU1, v: laneV }, width: P.taxiWidth, kind: 'lane' });
    if (ap.type === 'cargo') {
      for (let i = 0; i < 3; i++) L.buildings.push({ kind: 'warehouse', u: -tW / 2 + 150 + i * 300, v: termV - termFacing * 120, w: 220, d: 90, h: 18 });
    }
  } else if (ap.type === 'military') {
    // Hardened shelters along the apron
    const n = 8;
    for (let i = 0; i < n; i++) {
      const su = apronU0 + 80 + (i * (apronLen - 160)) / (n - 1);
      const sv = termV + termFacing * -10;
      L.buildings.push({ kind: 'shelter', u: su, v: sv, w: 34, d: 40, h: 11, facing: termFacing });
      L.gates.push({ u: su, v: sv + termFacing * -48, headingTo: { u: su, v: sv }, size: 'fighter', bridge: false });
    }
    L.buildings.push({ kind: 'office', u: apronU1 + 120, v: termV, w: 90, d: 40, h: 12 });
    L.taxiways.push({ a: { u: apronU0, v: laneV }, b: { u: apronU1, v: laneV }, width: P.taxiWidth, kind: 'lane' });
  } else {
    // GA field: FBO building and tie-downs
    L.buildings.push({ kind: 'fbo', u: apronU1 - 40, v: termV, w: 36, d: 16, h: 7 });
    const n = 6;
    const gv = termV + termFacing * (P.terminalDepth / 2 + 22);
    for (let g = 0; g < n; g++) {
      const gu = apronU0 + 25 + g * P.gateSpacing;
      L.gates.push({ u: gu, v: gv, headingTo: { u: gu, v: termV }, size: 'small', bridge: false });
    }
    L.taxiways.push({ a: { u: apronU0, v: laneV }, b: { u: apronU1, v: laneV }, width: P.taxiWidth, kind: 'lane' });
  }

  // Gate headings and nodes (gate -> pushback point)
  if (side === 0) {
    // Pier gates push back into the alley between piers, alleys lead to the apron lanes
    const laneOff = (apronV1 - apronV0) / 2 - 70;
    const alleys = new Map();
    for (const g of L.gates) {
      g.heading = gateHeadingToward(g.u, g.v, g.headingTo.u, g.headingTo.v);
      const s2 = Math.sign(g.u - g.headingTo.u);
      const dir = g.v > termV ? 1 : -1;
      const alleyU = g.headingTo.u + s2 * Math.min(300, (apronLen * 0.7 - 240) / 4 + 16);
      g.node = addNode(g.u, g.v, 'gate', { gate: g });
      g.push = addNode(alleyU, g.v, 'alley');
      link(g.node, g.push);
      const key = `${Math.round(alleyU)}|${dir}`;
      if (!alleys.has(key)) alleys.set(key, { u: alleyU, dir, nodes: [] });
      alleys.get(key).nodes.push(g.push);
    }
    for (const al of alleys.values()) {
      al.nodes.sort((a, b) => Math.abs(a.v - termV) - Math.abs(b.v - termV));
      const end = addNode(al.u, termV + al.dir * laneOff, 'lane');
      const seq = [...al.nodes, end];
      for (let i = 0; i < seq.length - 1; i++) link(seq[i], seq[i + 1]);
    }
  } else {
    for (const g of L.gates) {
      g.heading = gateHeadingToward(g.u, g.v, g.headingTo.u, g.headingTo.v);
      g.node = addNode(g.u, g.v, 'gate', { gate: g });
      g.push = addNode(g.u, laneV, 'lane');
      link(g.node, g.push);
    }
  }
  // Link lane nodes in order and to the parallel taxiway(s)
  const laneGroups = new Map();
  for (const n of L.nodes) if (n.kind === 'lane') {
    const key = Math.round(n.v);
    if (!laneGroups.has(key)) laneGroups.set(key, []);
    laneGroups.get(key).push(n);
  }
  const laneEnds = [];
  for (const [lv, list] of laneGroups) {
    list.sort((a, b) => a.u - b.u);
    // lane ends connect to the nearest parallel taxiway through apron entries
    const left = addNode(apronU0 + 15, lv, 'lane');
    const right = addNode(apronU1 - 15, lv, 'lane');
    laneEnds.push({ left, right });
    const seq = [left, ...list, right];
    for (let i = 0; i < seq.length - 1; i++) link(seq[i], seq[i + 1]);
    const parV = parallelV.reduce((best, pv) => (Math.abs(pv - lv) < Math.abs(best - lv) ? pv : best), parallelV[0]);
    for (const e of [left, right]) {
      const pn = addNode(e.u, parV, 'parallel');
      L.taxiways.push({ a: { u: e.u, v: lv }, b: { u: e.u, v: parV }, width: P.taxiWidth, kind: 'entry' });
      link(e, pn);
      // connect this parallel node to its neighbours on the same parallel taxiway
      const same = L.nodes.filter((n) => n.kind === 'parallel' && Math.abs(n.v - parV) < 1 && n !== pn);
      let lo = null,
        hi = null;
      for (const n of same) {
        if (n.u <= pn.u && (!lo || n.u > lo.u)) lo = n;
        if (n.u >= pn.u && (!hi || n.u < hi.u)) hi = n;
      }
      if (lo) link(lo, pn);
      if (hi) link(pn, hi);
    }
  }

  // Centre-field terminals: cross taxiways around both ends of the terminal
  if (side === 0 && laneEnds.length > 1) {
    for (let i = 0; i < laneEnds.length - 1; i++) {
      for (const k of ['left', 'right']) {
        const a = laneEnds[i][k],
          b = laneEnds[i + 1][k];
        link(a, b);
        L.taxiways.push({ a: { u: a.u, v: a.v }, b: { u: b.u, v: b.v }, width: P.taxiWidth, kind: 'cross' });
      }
    }
  }

  // ---- Control tower, hangars, support buildings
  const towerU = apronU1 + 60,
    towerV = termV + (side === 0 ? 0 : termFacing * -30);
  L.buildings.push({ kind: 'tower', u: towerU, v: towerV, w: 14, d: 14, h: P.towerH });
  L.tower = { u: towerU, v: towerV, h: P.towerH };
  for (let i = 0; i < P.hangars; i++) {
    const hu = apronU0 - 70 - i * (ap.type === 'ga' ? 34 : 95);
    const hv = side === 0 ? termV : termV;
    const big = ap.type !== 'ga';
    L.buildings.push({ kind: 'hangar', u: hu, v: hv, w: big ? 80 : 26, d: big ? 70 : 22, h: big ? 24 : 8, facing: termFacing || 1 });
    const out = termFacing || 1;
    L.hangars.push({ u: hu, v: hv, out, w: big ? 80 : 26, d: big ? 70 : 22 });
    L.rects.push({ u0: hu - (big ? 45 : 15), u1: hu + (big ? 45 : 15), v0: Math.min(hv, laneV ?? hv) - 40, v1: Math.max(hv, laneV ?? hv) + 40, kind: 'apron' });
    // Paved forecourt in front of the hangar doors
    if (big) L.rects.push({ u0: hu - 45, u1: hu + 45, v0: Math.min(hv, hv + out * 150), v1: Math.max(hv, hv + out * 150), kind: 'apron' });
  }
  if (ap.type !== 'ga') {
    // Fuel farm & fire station & radar
    L.buildings.push({ kind: 'fuel', u: apronU1 + 160, v: termV - (termFacing || 1) * 90, w: 60, d: 40, h: 12 });
    L.buildings.push({ kind: 'fire', u: apronU0 - 40, v: parallelV[0] + (side === 0 ? 60 : side * 60), w: 40, d: 24, h: 9 });
    L.buildings.push({ kind: 'radar', u: apronU1 + 300, v: termV + (termFacing || 1) * 150, w: 10, d: 10, h: 16 });
    // Parking lot
    const pv = side === 0 ? termV : termV - termFacing * (P.terminalDepth / 2 + 70);
    if (side !== 0) L.parking.push({ u0: -apronLen * 0.25, u1: apronLen * 0.25, v0: pv - 35, v1: pv + 35 });
  }

  // ---- Windsocks
  for (const rr of runwayRects) {
    const dir = rws.length > 1 ? (rr.vc < 0 ? -1 : 1) : -side || -1;
    L.windsocks.push({ u: rr.u0 + 300, v: rr.vc + dir * (rr.w / 2 + 70) });
    L.windsocks.push({ u: rr.u1 - 300, v: rr.vc + dir * (rr.w / 2 + 70) });
  }

  // ---- Lighting (in airport frame)
  for (const rr of runwayRects) {
    const len = rr.u1 - rr.u0;
    const hw = rr.w / 2 + 1.5;
    const hasIls = rr.r.ils && (rr.r.ils[0] || rr.r.ils[1]);
    // Edge lights
    for (let u = rr.u0; u <= rr.u1 + 0.1; u += 60) {
      const remainA = rr.u1 - u; // landing toward +u
      const yellowA = remainA < 600;
      for (const s2 of [-1, 1]) L.lights.push({ u, v: rr.vc + s2 * hw, color: yellowA ? [1, 0.85, 0.35] : [1, 0.95, 0.85], size: 1.6, kind: 'edge' });
    }
    // Centreline lights
    if (hasIls && ap.type !== 'ga') {
      for (let u = rr.u0 + 15; u <= rr.u1 - 15; u += 30) {
        const toEnd = Math.min(rr.u1 - u, u - rr.u0);
        const c = toEnd < 300 ? [1, 0.15, 0.1] : toEnd < 900 && Math.round(u / 30) % 2 ? [1, 0.15, 0.1] : [1, 0.98, 0.95];
        L.lights.push({ u, v: rr.vc, color: c, size: 1.1, kind: 'center' });
      }
    }
    // Threshold (green) / end (red) bars
    for (let k = -rr.w / 2; k <= rr.w / 2; k += 3) {
      L.lights.push({ u: rr.u0 - 1, v: rr.vc + k, color: [0.2, 1, 0.35], size: 1.4, kind: 'thr' });
      L.lights.push({ u: rr.u1 + 1, v: rr.vc + k, color: [0.2, 1, 0.35], size: 1.4, kind: 'thr' });
      L.lights.push({ u: rr.u0 + 2, v: rr.vc + k, color: [1, 0.1, 0.05], size: 1.2, kind: 'end' });
      L.lights.push({ u: rr.u1 - 2, v: rr.vc + k, color: [1, 0.1, 0.05], size: 1.2, kind: 'end' });
    }
    // Approach lights + PAPI for each end
    for (let e = 0; e < 2; e++) {
      const dirU = e === 0 ? -1 : 1; // outward from threshold
      const thrU = e === 0 ? rr.u0 : rr.u1;
      const ils = rr.r.ils && rr.r.ils[e];
      if (ils) {
        for (let d = 30; d <= 900; d += 30) {
          const bar = d % 150 === 0 ? 7 : 2;
          for (let k = -bar; k <= bar; k++) L.lights.push({ u: thrU + dirU * d, v: rr.vc + k * 1.5, color: [1, 0.96, 0.85], size: 1.5, kind: 'als' });
          // Sequenced flashers ("rabbit")
          if (d >= 300) L.lights.push({ u: thrU + dirU * d, v: rr.vc, color: [1, 1, 1], size: 3.2, flash: 1 + (900 - d) / 900, kind: 'flash' });
        }
        // Crossbar at 300 m
        for (let k = -15; k <= 15; k++) L.lights.push({ u: thrU + dirU * 300, v: rr.vc + k * 1.5, color: [1, 0.96, 0.85], size: 1.5, kind: 'als' });
      }
      // PAPI on the left side of the landing direction, 300 m past threshold
      const papiU = thrU - dirU * 300;
      const leftV = e === 0 ? -1 : 1; // landing toward +u: left is -v
      const angles = [3.5, 3.17, 2.83, 2.5];
      for (let k = 0; k < 4; k++) L.lights.push({ u: papiU, v: rr.vc + leftV * (rr.w / 2 + 15 + k * 9), color: [1, 1, 1], size: 2.4, papi: angles[k], kind: 'papi' });
    }
  }
  // Taxiway edge lights (blue)
  for (const t of L.taxiways) {
    const du = t.b.u - t.a.u,
      dv = t.b.v - t.a.v;
    const len = Math.hypot(du, dv);
    if (len < 1) continue;
    const nu = -dv / len,
      nv = du / len;
    const n = Math.max(1, Math.floor(len / 45));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      for (const s2 of [-1, 1]) L.lights.push({ u: t.a.u + du * f + nu * s2 * (t.width / 2 + 1), v: t.a.v + dv * f + nv * s2 * (t.width / 2 + 1), color: [0.15, 0.35, 1], size: 1.0, kind: 'taxi' });
    }
  }
  // Apron floodlight positions
  L.floods = [];
  if (ap.type !== 'ga') {
    const a = L.apron;
    for (let u = a.u0 + 60; u < a.u1; u += 180) {
      L.floods.push({ u, v: side === 0 ? (a.v0 + a.v1) / 2 : side > 0 ? a.v0 + 10 : a.v1 - 10 });
    }
  }

  // ---- Ground vehicle service loop around the apron
  const a = L.apron;
  const sv = side === 0 ? null : side > 0 ? a.v1 - 15 : a.v0 + 15;
  if (sv !== null || side === 0) {
    const vline = sv ?? termV + 60;
    L.vehicles.push([
      { u: a.u0 + 20, v: vline },
      { u: a.u1 - 20, v: vline },
      { u: a.u1 - 20, v: laneV ?? vline - 100 },
      { u: a.u0 + 20, v: laneV ?? vline - 100 },
    ]);
  }

  // World-space conversion helpers
  L.world = (u, v) => toWorld(ap, u, v);
  for (const n of L.nodes) {
    const w = toWorld(ap, n.u, n.v);
    n.x = w.x;
    n.z = w.z;
  }
  for (const g of L.gates) {
    const w = toWorld(ap, g.u, g.v);
    g.x = w.x;
    g.z = w.z;
  }
  // Adjacency
  L.adj = new Map();
  for (const [a2, b2] of L.edges) {
    if (!L.adj.has(a2)) L.adj.set(a2, []);
    if (!L.adj.has(b2)) L.adj.set(b2, []);
    L.adj.get(a2).push(b2);
    L.adj.get(b2).push(a2);
  }
  // Paved rectangles for ground friction
  for (const t of L.taxiways) {
    L.rects.push({
      u0: Math.min(t.a.u, t.b.u) - t.width / 2,
      u1: Math.max(t.a.u, t.b.u) + t.width / 2,
      v0: Math.min(t.a.v, t.b.v) - t.width / 2,
      v1: Math.max(t.a.v, t.b.v) + t.width / 2,
      kind: 'taxi',
    });
  }
  return L;
}

export const LAYOUTS = new Map(AIRPORT_INFO.map((ap) => [ap.icao, buildLayout(ap)]));

export function layoutFor(icao) {
  return LAYOUTS.get(icao);
}

// Is the world position on a paved airport surface (apron or taxiway)?
export function isPaved(x, z) {
  for (const L of LAYOUTS.values()) {
    const ap = L.airport;
    const dx = x - ap.x,
      dz = z - ap.z;
    if (dx * dx + dz * dz > 6000 * 6000) continue;
    const p = toLocal(ap, x, z);
    for (const r of L.rects) if (p.u >= r.u0 && p.u <= r.u1 && p.v >= r.v0 && p.v <= r.v1) return true;
  }
  return false;
}

// Shortest taxi route (Dijkstra) between two node ids in an airport layout.
export function taxiRoute(L, fromId, toId) {
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const open = new Set([fromId]);
  const nodes = L.nodes;
  while (open.size) {
    let best = null,
      bd = Infinity;
    for (const id of open) {
      const d = dist.get(id);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    open.delete(best);
    if (best === toId) break;
    for (const nb of L.adj.get(best) || []) {
      const a = nodes[best],
        b = nodes[nb];
      // Don't route across runways except at the start/end
      if (b.kind === 'runway' && nb !== toId) continue;
      const nd = bd + Math.hypot(a.u - b.u, a.v - b.v);
      if (nd < (dist.has(nb) ? dist.get(nb) : Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, best);
        open.add(nb);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const path = [];
  let c = toId;
  while (c !== undefined) {
    path.unshift(nodes[c]);
    c = prev.get(c);
  }
  return path;
}

// Find the nearest graph node of a kind to a world position
export function nearestNode(L, x, z, kinds) {
  let best = null,
    bd = Infinity;
  for (const n of L.nodes) {
    if (kinds && !kinds.includes(n.kind)) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
