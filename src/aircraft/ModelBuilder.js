// Procedural 3D aircraft model builder.
// Generates a fuselage loft, airfoil wings and tail surfaces with movable control
// surfaces, engine nacelles with fans/props, landing gear, canopies and lights
// from the parameters in aircraftData.js.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintFuselageTexture, paintTailTexture, wingTexture, resolveLivery } from './Livery.js';
import { createGlowMaterial, createGlowPoints } from '../render/GlowPoints.js';

const DEG = Math.PI / 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Fuselage profiles
// ---------------------------------------------------------------------------

// Tabulated profiles [z, top, bottom, halfWidth] for non-cylindrical fuselages.
const TABLE_PROFILES = {
  k172: [
    [-2.99, 0.06, 0.04, 0.03],
    [-2.9, 0.2, -0.12, 0.2],
    [-2.7, 0.33, -0.3, 0.36],
    [-2.3, 0.44, -0.46, 0.47],
    [-1.8, 0.49, -0.54, 0.51],
    [-1.4, 0.52, -0.57, 0.54],
    [-1.0, 0.76, -0.58, 0.56],
    [-0.6, 0.86, -0.58, 0.56],
    [0.4, 0.86, -0.58, 0.56],
    [1.2, 0.8, -0.5, 0.5],
    [2.2, 0.66, -0.32, 0.38],
    [3.2, 0.52, -0.14, 0.27],
    [4.2, 0.4, 0.0, 0.17],
    [5.0, 0.33, 0.08, 0.11],
    [5.3, 0.3, 0.12, 0.06],
  ],
  fx16: [
    [-8.5, 0.0, 0.0, 0.0],
    [-8.0, 0.1, -0.08, 0.1],
    [-7.0, 0.27, -0.23, 0.27],
    [-6.0, 0.4, -0.36, 0.4],
    [-5.0, 0.48, -0.44, 0.47],
    [-4.0, 0.52, -0.5, 0.55],
    [-3.0, 0.54, -0.55, 0.64],
    [-1.5, 0.5, -0.6, 0.78],
    [0.5, 0.48, -0.62, 0.86],
    [2.5, 0.5, -0.58, 0.82],
    [4.5, 0.46, -0.52, 0.68],
    [5.8, 0.42, -0.48, 0.58],
    [6.5, 0.4, -0.44, 0.5],
  ],
  ef2: [
    [-9.0, 0.0, 0.0, 0.0],
    [-8.4, 0.12, -0.1, 0.12],
    [-7.4, 0.3, -0.26, 0.3],
    [-6.2, 0.45, -0.4, 0.44],
    [-5.0, 0.55, -0.5, 0.52],
    [-3.8, 0.6, -0.6, 0.62],
    [-2.0, 0.6, -0.7, 0.85],
    [0.5, 0.58, -0.72, 1.0],
    [3.0, 0.6, -0.68, 1.0],
    [5.5, 0.55, -0.6, 0.95],
    [7.0, 0.5, -0.5, 0.9],
  ],
};

function tableSection(table, z) {
  if (z <= table[0][0]) return table[0];
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i],
      b = table[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
      return [z, lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)];
    }
  }
  return table[table.length - 1];
}

// Returns cross-section {cy, w, hTop, hBot, nTop, nBot}
function crossSection(spec, z) {
  const f = spec.model.fuselage;
  const table = TABLE_PROFILES[spec.id];
  if (table) {
    const [, top, bot, hw] = tableSection(table, z);
    const boxy = spec.model.style === 'ga' ? 3.2 : 2.3;
    return { cy: (top + bot) / 2 + (f.centerY || 0) * 0, w: hw, hTop: (top - bot) / 2, hBot: (top - bot) / 2, nTop: boxy, nBot: boxy };
  }
  const r = f.radius;
  const noseL = f.noseLength;
  const tailL = f.tailLength;
  let cy = f.centerY || 0,
    w = r,
    hTop = r,
    hBot = r;
  if (z <= f.noseZ + noseL) {
    const t = Math.max(0, (z - f.noseZ) / noseL);
    const k = Math.pow(Math.max(0, 1 - Math.pow(1 - t, 2.3)), 0.5);
    const kt = Math.pow(Math.max(0, 1 - Math.pow(1 - t, 1.7)), 0.6);
    w = r * k;
    hBot = r * k;
    hTop = r * kt;
    cy = cy - r * 0.32 * Math.pow(1 - t, 1.6);
    if (spec.category === 'fighter') {
      w = r * t;
      hTop = hBot = r * t;
      cy = f.centerY || 0;
    }
  } else if (z >= f.tailZ - tailL) {
    const t = Math.min(1, (z - (f.tailZ - tailL)) / tailL);
    const tipR = r * (spec.model.style === 'cargo' ? 0.12 : 0.07);
    const up = f.tailUp || 0;
    const top = r + (up + tipR - r) * Math.pow(t, 1.7);
    const bot = -r + (up - tipR + r) * Math.pow(t, 1.05);
    cy = (f.centerY || 0) + (top + bot) / 2;
    hTop = hBot = (top - bot) / 2;
    w = r + (tipR * 1.3 - r) * Math.pow(t, 1.25);
  }
  // Upper deck hump (heavy freighter)
  if (f.hump && z >= f.hump.fromZ && z <= f.hump.toZ) {
    const s = (z - f.hump.fromZ) / (f.hump.toZ - f.hump.fromZ);
    const bump = Math.sqrt(smoothstep(0, 0.42, s)) * (1 - smoothstep(0.7, 1, s));
    hTop += f.hump.height * bump;
  }
  // Wing-body fairing
  const wg = spec.model.wing;
  if (wg.mount === 'low' && spec.category !== 'fighter') {
    const a = wg.rootLE - wg.rootChord * 0.1,
      b = wg.rootLE + wg.rootChord * 1.15;
    if (z > a && z < b) {
      const s = (z - a) / (b - a);
      hBot += r * 0.1 * Math.sin(s * Math.PI);
      w += r * 0.04 * Math.sin(s * Math.PI);
    }
  }
  const nb = f.flatBottom ? 3.0 : 2;
  return { cy, w, hTop, hBot, nTop: 2, nBot: nb };
}

function sectionPoint(cs, theta, out) {
  const s = Math.sin(theta),
    c = Math.cos(theta);
  const n = c >= 0 ? cs.nTop : cs.nBot;
  const e = 2 / n;
  const sx = Math.sign(s) * Math.pow(Math.abs(s), e);
  const sy = Math.sign(c) * Math.pow(Math.abs(c), e);
  out.x = cs.w * sx;
  out.y = cs.cy + (c >= 0 ? cs.hTop : cs.hBot) * sy;
  return out;
}

function fuselageStations(spec, count) {
  const f = spec.model.fuselage;
  const z0 = f.noseZ,
    z1 = f.tailZ;
  const zs = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    // Denser sampling at both ends
    const s = 0.5 - 0.5 * Math.cos(t * Math.PI);
    zs.push(z0 + (z1 - z0) * (0.55 * s + 0.45 * t));
  }
  return zs;
}

function buildFuselageGeometry(spec, segAround, stationCount) {
  const f = spec.model.fuselage;
  const L = f.tailZ - f.noseZ;
  const zs = fuselageStations(spec, stationCount);
  const ring = segAround + 1;
  const pos = new Float32Array(zs.length * ring * 3);
  const uv = new Float32Array(zs.length * ring * 2);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const cs = crossSection(spec, z);
    for (let j = 0; j <= segAround; j++) {
      const th = (j / segAround) * Math.PI * 2;
      sectionPoint(cs, th, p);
      const k = i * ring + j;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = (z - f.noseZ) / L;
      uv[k * 2 + 1] = j / segAround;
    }
  }
  const idx = [];
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < segAround; j++) {
      const a = i * ring + j,
        b = a + 1,
        c = a + ring,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Average normals across the UV seam
  const nrm = geo.attributes.normal;
  for (let i = 0; i < zs.length; i++) {
    const a = i * ring,
      b = i * ring + segAround;
    const nx = nrm.getX(a) + nrm.getX(b),
      ny = nrm.getY(a) + nrm.getY(b),
      nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return geo;
}

// ---------------------------------------------------------------------------
// Lifting surfaces
// ---------------------------------------------------------------------------

// Airfoil half-thickness and camber at chord fraction x
function airfoil(x, t, camber) {
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  let yc = 0;
  if (camber > 0) {
    const p = 0.4;
    yc = x < p ? (camber / (p * p)) * (2 * p * x - x * x) : (camber / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x);
  }
  return { yu: yc + yt, yl: yc - yt };
}

// Surface planform: { rootLE, rootChord, tipChord, semi, sweep, dihedral, y, thickness, camber, tipThickness }
function station(pf, x) {
  const eta = Math.min(1, Math.max(0, x / pf.semi));
  return {
    le: pf.rootLE + Math.tan(pf.sweep * DEG) * x,
    chord: lerp(pf.rootChord, pf.tipChord, eta),
    y: pf.y + Math.tan((pf.dihedral || 0) * DEG) * x,
    t: lerp(pf.thickness, pf.tipThickness ?? pf.thickness * 0.75, eta),
  };
}

// Builds a closed section of a lifting surface between spanwise x0..x1 (metres)
// and chord fractions c0..c1. Built in canonical orientation (span +X).
function buildSurfacePatch(pf, x0, x1, c0, c1, opts = {}) {
  const nSpan = opts.nSpan || Math.max(2, Math.ceil(((x1 - x0) / pf.semi) * 8));
  const nChord = opts.nChord || 9;
  const camber = pf.camber || 0;
  // Loop of chord points: upper c1 -> c0, lower c0 -> c1
  const loop = [];
  for (let k = 0; k <= nChord; k++) {
    const s = 1 - k / nChord;
    const xc = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(s * Math.PI));
    loop.push({ xc, upper: true });
  }
  for (let k = 0; k <= nChord; k++) {
    const s = k / nChord;
    const xc = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(s * Math.PI));
    loop.push({ xc, upper: false });
  }
  const m = loop.length;
  const pos = [];
  const uv = [];
  for (let i = 0; i <= nSpan; i++) {
    const x = x0 + ((x1 - x0) * i) / nSpan;
    const st = station(pf, x);
    for (let k = 0; k < m; k++) {
      const L = loop[k];
      const af = airfoil(L.xc, st.t, camber);
      const yy = (L.upper ? af.yu : af.yl) * st.chord;
      pos.push(x, st.y + yy, st.le + L.xc * st.chord);
      uv.push(x / pf.semi, L.xc * 0.5 + (L.upper ? 0 : 0.5));
    }
  }
  const idx = [];
  for (let i = 0; i < nSpan; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k,
        b = a + 1,
        c = a + m,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // close the loop (lower TE back to upper TE)
    const a = i * m + (m - 1),
      b = i * m,
      c = a + m,
      d = b + m;
    idx.push(a, c, b, b, c, d);
  }
  // End caps (fan from loop centroid)
  const capAt = (i, flip) => {
    const base = i * m;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let k = 0; k < m; k++) {
      cx += pos[(base + k) * 3];
      cy += pos[(base + k) * 3 + 1];
      cz += pos[(base + k) * 3 + 2];
    }
    const ci = pos.length / 3;
    pos.push(cx / m, cy / m, cz / m);
    uv.push(0.5, 0.5);
    for (let k = 0; k < m; k++) {
      const a = base + k,
        b = base + ((k + 1) % m);
      if (flip) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  };
  if (opts.capStart !== false) capAt(0, false);
  if (opts.capEnd !== false) capAt(nSpan, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Mirror a canonical (right side) geometry to the left side (x -> -x), fixing winding.
function mirrorX(geo) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const index = g.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Creates a hinged control surface: returns { pivot, mesh } with hinge axis = local X
function hingedSurface(geo, hingeA, hingeB, material, sign) {
  const pivot = new THREE.Object3D();
  pivot.position.copy(hingeA);
  const dir = _v.copy(hingeB).sub(hingeA).normalize();
  pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  pivot.updateMatrix();
  const inv = new THREE.Matrix4().copy(pivot.matrix).invert();
  geo.applyMatrix4(inv);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  pivot.add(mesh);
  pivot.userData.sign = sign;
  return { pivot, mesh };
}

// Build a full lifting surface (both sides unless vertical) with control surface layout.
// layout: [{ from, to, hinge, name }]
function buildLiftingSurface(pf, layout, material, ctrlMaterial, opts = {}) {
  const group = new THREE.Group();
  const surfaces = [];
  const staticGeos = [];
  const breaks = new Set([0, pf.semi]);
  for (const c of layout) {
    breaks.add(c.from * pf.semi);
    breaks.add(c.to * pf.semi);
  }
  const xs = [...breaks].sort((a, b) => a - b);
  const sides = opts.vertical ? [1] : [1, -1];
  for (let s = 0; s < xs.length - 1; s++) {
    const xa = xs[s],
      xb = xs[s + 1];
    if (xb - xa < 1e-3) continue;
    const mid = (xa + xb) / 2 / pf.semi;
    const ctrl = layout.find((c) => mid >= c.from && mid <= c.to);
    const capStart = s === 0 ? true : !!ctrl || !!layout.find((c) => Math.abs(c.to * pf.semi - xa) < 1e-6);
    const capEnd = s === xs.length - 2 ? true : !!ctrl || !!layout.find((c) => Math.abs(c.from * pf.semi - xb) < 1e-6);
    const box = buildSurfacePatch(pf, xa, xb, 0, ctrl ? ctrl.hinge : 1, { capStart, capEnd, nChord: opts.nChord });
    staticGeos.push(box);
    if (ctrl) {
      const surf = buildSurfacePatch(pf, xa, xb, ctrl.hinge, 1, { capStart: true, capEnd: true, nChord: 4 });
      const sa = station(pf, xa),
        sb = station(pf, xb);
      const ha = new THREE.Vector3(xa, sa.y + airfoil(ctrl.hinge, sa.t, pf.camber || 0).yu * 0 * sa.chord, sa.le + ctrl.hinge * sa.chord);
      const hb = new THREE.Vector3(xb, sb.y, sb.le + ctrl.hinge * sb.chord);
      for (const side of sides) {
        let g = surf.clone();
        let A = ha.clone(),
          B = hb.clone();
        if (side < 0) {
          g = mirrorX(g);
          A.x = -A.x;
          B.x = -B.x;
        }
        const h = hingedSurface(g, A, B, ctrlMaterial || material, side);
        h.pivot.userData.name = ctrl.name;
        h.pivot.userData.side = side;
        surfaces.push(h.pivot);
        group.add(h.pivot);
      }
    }
  }
  let merged = mergeGeometries(staticGeos, false);
  const parts = [merged];
  if (!opts.vertical) parts.push(mirrorX(merged));
  for (const g of parts) {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, surfaces };
}

// ---------------------------------------------------------------------------
// Engines, props, gear
// ---------------------------------------------------------------------------

function fanTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c20';
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  for (let i = 0; i < 22; i++) {
    g.rotate((Math.PI * 2) / 22);
    const grd = g.createLinearGradient(0, 0, S / 2, 0);
    grd.addColorStop(0, '#6d737c');
    grd.addColorStop(1, '#a8afb8');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(S * 0.08, -2);
    g.quadraticCurveTo(S * 0.3, -S * 0.06, S * 0.5, -S * 0.07);
    g.lineTo(S * 0.5, S * 0.02);
    g.quadraticCurveTo(S * 0.3, 0, S * 0.08, 6);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function propDiscTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(40,40,40,0.0)');
  grd.addColorStop(0.2, 'rgba(40,40,40,0.25)');
  grd.addColorStop(0.85, 'rgba(60,60,60,0.18)');
  grd.addColorStop(0.95, 'rgba(230,200,40,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

let _sharedTex = null;
function sharedTextures() {
  if (!_sharedTex) _sharedTex = { fan: fanTexture(), disc: propDiscTexture() };
  return _sharedTex;
}

function nacelleGeometry(R, Lg, seg) {
  const pts = [
    [R * 0.8, 0.05 * Lg],
    [R * 0.84, 0.012 * Lg],
    [R * 0.9, 0.0],
    [R * 0.97, 0.025 * Lg],
    [R * 1.0, 0.18 * Lg],
    [R * 0.99, 0.45 * Lg],
    [R * 0.9, 0.72 * Lg],
    [R * 0.78, 0.8 * Lg],
    [R * 0.66, 0.82 * Lg],
    [R * 0.62, 0.9 * Lg],
    [R * 0.48, 1.0 * Lg],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -Lg / 2);
  return g;
}

function buildTurbofan(e, mats, detail) {
  const grp = new THREE.Group();
  grp.position.set(e.pos[0], e.pos[1], e.pos[2]);
  const R = e.radius,
    Lg = e.length;
  const seg = detail === 'high' ? 32 : 14;
  const shell = new THREE.Mesh(nacelleGeometry(R, Lg, seg), mats.engine);
  shell.castShadow = true;
  grp.add(shell);
  // Inlet lip (polished)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.87, R * 0.05, 8, seg), mats.chrome);
  lip.position.z = -Lg / 2 + 0.01 * Lg;
  grp.add(lip);
  let fan = null;
  if (detail === 'high') {
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.81, R * 0.81, Lg * 0.25, seg, 1, true), mats.darkInterior);
    duct.rotation.x = Math.PI / 2;
    duct.position.z = -Lg / 2 + Lg * 0.13;
    grp.add(duct);
    fan = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.8, seg), new THREE.MeshStandardMaterial({ map: sharedTextures().fan, metalness: 0.6, roughness: 0.4 }));
    disc.rotation.y = Math.PI; // face forward (-Z)
    fan.add(disc);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(R * 0.24, R * 0.5, 16), mats.spinner);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -R * 0.25;
    fan.add(spinner);
    fan.position.z = -Lg / 2 + Lg * 0.2;
    grp.add(fan);
  } else {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.82, seg), mats.darkInterior);
    cap.rotation.y = Math.PI;
    cap.position.z = -Lg / 2 + 0.06 * Lg;
    grp.add(cap);
  }
  // Exhaust plug
  const plug = new THREE.Mesh(new THREE.ConeGeometry(R * 0.36, Lg * 0.28, 16), mats.exhaust);
  plug.rotation.x = Math.PI / 2;
  plug.position.z = Lg / 2 + Lg * 0.08;
  grp.add(plug);
  return { group: grp, fan };
}

function buildPylonUnderWing(e, wingY, mats) {
  const R = e.radius,
    Lg = e.length;
  const top = wingY - 0.05;
  const bottom = e.pos[1] + R * 0.85;
  const h = Math.max(0.2, top - bottom);
  const geo = new THREE.BoxGeometry(R * 0.28, h, Lg * 0.85);
  const pos = geo.attributes.position;
  // Taper the front-top for a swept pylon look
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i),
      z = pos.getZ(i);
    if (y > 0) pos.setZ(i, z + Lg * 0.18);
    if (z < 0 && y > 0) pos.setZ(i, pos.getZ(i) + Lg * 0.1);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mats.engine);
  m.position.set(e.pos[0], bottom + h / 2, e.pos[2] + Lg * 0.05);
  m.castShadow = true;
  return m;
}

function buildPod(e, mats, detail, fuselageR) {
  const res = buildTurbofan(e, mats, detail);
  // Horizontal pylon to fuselage
  const span = Math.abs(e.pos[0]) - fuselageR * 0.8;
  const py = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, span), e.radius * 0.25, e.length * 0.5), mats.engine);
  py.position.set(Math.sign(e.pos[0]) * (fuselageR * 0.8 + span / 2), e.pos[1], e.pos[2] + e.length * 0.05);
  py.castShadow = true;
  return { group: res.group, fan: res.fan, pylon: py };
}

function buildTurbopropNacelle(e, mats, detail) {
  const grp = new THREE.Group();
  grp.position.set(e.pos[0], e.pos[1], e.pos[2]);
  const R = e.radius,
    Lg = e.length;
  const pts = [
    [0.0, 0],
    [R * 0.55, 0.02 * Lg],
    [R * 0.85, 0.12 * Lg],
    [R * 1.0, 0.35 * Lg],
    [R * 0.95, 0.75 * Lg],
    [R * 0.6, 0.95 * Lg],
    [R * 0.2, Lg],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(pts, detail === 'high' ? 24 : 12);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -Lg / 2);
  const mesh = new THREE.Mesh(g, mats.engine);
  mesh.scale.set(1, 1.15, 1);
  mesh.castShadow = true;
  grp.add(mesh);
  // Exhaust stub
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.18, R * 0.2, R * 0.6, 10), mats.exhaust);
  ex.rotation.z = Math.PI / 2;
  ex.position.set(R * 0.75 * Math.sign(e.pos[0] || 1), R * 0.1, Lg * 0.05);
  grp.add(ex);
  return grp;
}

function buildPropeller(p, mats, detail) {
  const grp = new THREE.Group();
  grp.position.set(p.pos[0], p.pos[1], p.pos[2]);
  const R = p.diameter / 2;
  const blades = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(R * 0.13, R, R * 0.025);
  const bp = bladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i) + R / 2; // 0 .. R
    const t = y / R;
    const taper = 1 - 0.55 * t + 0.4 * Math.sin(t * Math.PI) * 0.5;
    bp.setX(i, bp.getX(i) * taper);
    bp.setY(i, y);
    // twist
    const tw = (0.6 - 0.45 * t) * 0.9;
    const x = bp.getX(i),
      z = bp.getZ(i);
    bp.setX(i, x * Math.cos(tw) - z * Math.sin(tw));
    bp.setZ(i, x * Math.sin(tw) + z * Math.cos(tw));
  }
  bladeGeo.computeVertexNormals();
  for (let i = 0; i < p.blades; i++) {
    const b = new THREE.Mesh(bladeGeo, mats.prop);
    b.rotation.z = (i / p.blades) * Math.PI * 2;
    b.castShadow = true;
    blades.add(b);
  }
  grp.add(blades);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(R * 0.16, R * 0.45, 16), mats.spinnerPaint || mats.spinner);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -R * 0.18;
  grp.add(spinner);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(R, 32),
    new THREE.MeshBasicMaterial({ map: sharedTextures().disc, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 })
  );
  disc.visible = false;
  grp.add(disc);
  return { group: grp, blades, disc, dir: p.dir || 1 };
}

function tireRadius(spec, nose) {
  const r = Math.min(0.62, 0.17 + 0.0014 * Math.sqrt(spec.mass.maxTakeoff));
  return nose ? r * 0.72 : r;
}

function wheelCount(spec, nose) {
  const m = spec.mass.maxTakeoff;
  if (spec.model.style === 'ga' || spec.category === 'fighter') return { across: 1, along: 1 };
  if (nose) return { across: 2, along: 1 };
  if (spec.model.style === 'cargo') return { across: 1, along: 2 };
  if (m > 150000) return { across: 2, along: 2 };
  return { across: 2, along: 1 };
}

function buildWheel(r, width, mats, detail) {
  const g = new THREE.Group();
  const seg = detail === 'high' ? 20 : 10;
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, seg), mats.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, width * 1.04, seg), mats.hub);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

function buildGearLeg(spec, gp, attachY, mats, detail) {
  const nose = gp.name === 'nose';
  const r = tireRadius(spec, nose);
  const wc = wheelCount(spec, nose);
  const contactY = gp.pos[1];
  const wheelY = contactY + r;
  const pivot = new THREE.Group();
  pivot.position.set(gp.pos[0], attachY, gp.pos[2]);
  const legLen = Math.max(0.3, attachY - wheelY);
  const strutR = Math.max(0.04, r * 0.22);
  // Upper cylinder
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(strutR, strutR, legLen * 0.6, 10), mats.gear);
  upper.position.y = -legLen * 0.3;
  upper.castShadow = true;
  pivot.add(upper);
  // Lower assembly moves with compression
  const lower = new THREE.Group();
  lower.position.y = -legLen;
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(strutR * 0.7, strutR * 0.7, legLen * 0.55, 10), mats.chrome);
  piston.position.y = legLen * 0.27;
  lower.add(piston);
  const width = r * 0.7;
  const spacingX = width * 1.25;
  const spacingZ = r * 2.25;
  const wheels = [];
  for (let a = 0; a < wc.along; a++) {
    for (let b = 0; b < wc.across; b++) {
      const w = buildWheel(r, width, mats, detail);
      const ox = wc.across === 1 ? 0 : (b - 0.5) * spacingX * 1.1;
      const oz = wc.along === 1 ? 0 : (a - (wc.along - 1) / 2) * spacingZ;
      w.position.set(ox, 0, oz);
      lower.add(w);
      wheels.push(w);
    }
  }
  if (wc.along > 1) {
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(strutR * 1.2, strutR * 1.2, spacingZ * (wc.along - 1) + strutR * 2), mats.gear);
    lower.add(bogie);
  }
  if (spec.model.gearFixed && !nose) {
    // Wheel fairing (spat)
    const spat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.paintPlain);
    spat.scale.set(width * 0.85, r * 1.05, r * 1.7);
    lower.add(spat);
  }
  pivot.add(lower);
  return { pivot, lower, wheels, legLen, nose, side: Math.sign(gp.pos[0]), radius: r, gp };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildAircraftModel(spec, liveryIn, opts = {}) {
  const detail = opts.detail || 'high';
  const livery = resolveLivery(liveryIn);
  const m = spec.model;
  const f = m.fuselage;
  const root = new THREE.Group();
  root.name = spec.id;

  const fusTex = paintFuselageTexture(spec, livery, { width: detail === 'high' ? undefined : 1024, height: detail === 'high' ? 512 : 256 });
  const tailTex = paintTailTexture(spec, livery);
  const matte = !!livery.matte;
  const metallic = !!livery.metallic;
  const mats = {
    paint: new THREE.MeshStandardMaterial({ map: fusTex, roughness: matte ? 0.75 : 0.32, metalness: metallic ? 0.55 : 0.12 }),
    paintPlain: new THREE.MeshStandardMaterial({ color: livery.base, roughness: matte ? 0.75 : 0.35, metalness: metallic ? 0.5 : 0.1 }),
    tail: new THREE.MeshStandardMaterial({ map: tailTex, roughness: matte ? 0.75 : 0.32, metalness: metallic ? 0.5 : 0.12 }),
    wing: new THREE.MeshStandardMaterial({ map: wingTexture(livery.wing || '#c9ced6'), roughness: matte ? 0.75 : 0.45, metalness: matte ? 0.1 : 0.35 }),
    engine: new THREE.MeshStandardMaterial({ color: livery.engine || livery.base, roughness: matte ? 0.7 : 0.35, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.18, metalness: 1.0 }),
    darkInterior: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.6, metalness: 0.7 }),
    spinner: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }),
    gear: new THREE.MeshStandardMaterial({ color: 0xbfc4c9, roughness: 0.45, metalness: 0.6 }),
    prop: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.42, side: THREE.FrontSide }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide }),
  };
  mats.spinnerPaint = spec.model.style === 'ga' ? mats.paintPlain : mats.spinner;
  if (spec.category === 'fighter') {
    mats.wing = new THREE.MeshStandardMaterial({ color: livery.wing || livery.base, roughness: 0.7, metalness: 0.15 });
    // Fighter wings share the fuselage camo colour; use a tiled crop of the fuselage texture
    mats.wing.map = fusTex;
  }

  const parts = {
    elevators: [],
    ailerons: [],
    flaps: [],
    spoilers: [],
    rudders: [],
    canards: [],
    stabilators: [],
    gear: [],
    fans: [],
    props: [],
    nozzles: [],
    afterburners: [],
    lightGroups: {},
    reversers: [],
  };

  // ---- Fuselage
  const fusGeo = buildFuselageGeometry(spec, detail === 'high' ? 40 : 18, detail === 'high' ? 90 : 36);
  const fus = new THREE.Mesh(fusGeo, mats.paint);
  fus.castShadow = true;
  fus.receiveShadow = true;
  root.add(fus);
  const fusR = f.radius || Math.max(f.width || 1, f.height || 1) / 2;

  // ---- Wing
  const w = m.wing;
  const semi = w.span / 2;
  const wingPf = {
    rootLE: w.rootLE,
    rootChord: w.rootChord,
    tipChord: w.tipChord,
    semi,
    sweep: w.sweep,
    dihedral: w.dihedral,
    y: w.y,
    thickness: w.thickness || 0.12,
    tipThickness: (w.thickness || 0.12) * 0.7,
    camber: spec.category === 'fighter' ? 0 : 0.02,
  };
  let wingLayout;
  if (spec.category === 'fighter') {
    wingLayout = w.delta
      ? [
          { from: 0.18, to: 0.52, hinge: 0.84, name: 'elevonIn' },
          { from: 0.52, to: 0.9, hinge: 0.84, name: 'elevonOut' },
        ]
      : [{ from: 0.2, to: 0.78, hinge: 0.78, name: 'flaperon' }];
  } else if (m.style === 'ga') {
    wingLayout = [
      { from: 0.06, to: 0.5, hinge: 0.74, name: 'flap' },
      { from: 0.55, to: 0.95, hinge: 0.76, name: 'aileron' },
    ];
  } else {
    wingLayout = [
      { from: 0.1, to: 0.64, hinge: 0.74, name: 'flap' },
      { from: 0.67, to: 0.93, hinge: 0.77, name: 'aileron' },
    ];
  }
  const wingRes = buildLiftingSurface(wingPf, wingLayout, mats.wing, mats.wing, { nChord: detail === 'high' ? 10 : 5 });
  root.add(wingRes.group);
  for (const s of wingRes.surfaces) {
    const n = s.userData.name;
    if (n === 'flap') parts.flaps.push(s);
    else if (n === 'aileron') parts.ailerons.push(s);
    else if (n === 'flaperon') {
      parts.ailerons.push(s);
      parts.flaps.push(s);
    } else if (n.startsWith('elevon')) {
      parts.ailerons.push(s);
      parts.elevators.push(s);
      s.userData.elevon = true;
    }
  }

  // Fighter LEX
  if (w.lex) {
    const lexPf = { rootLE: w.lex.fromZ, rootChord: w.rootLE - w.lex.fromZ + w.rootChord * 0.4, tipChord: 0.4, semi: fusR + 0.55, sweep: 76, dihedral: 0, y: w.y + 0.05, thickness: 0.03, camber: 0 };
    const lex = buildSurfacePatch(lexPf, 0, lexPf.semi, 0, 1, {});
    const lm = new THREE.Mesh(mergeGeometries([lex, mirrorX(lex)]), mats.wing);
    lm.castShadow = true;
    root.add(lm);
  }

  // Spoilers (airliners)
  if (spec.aero.spoilerCL < -0.1 && spec.category !== 'fighter') {
    for (const side of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const e0 = 0.18 + k * 0.11,
          e1 = e0 + 0.1;
        const xa = e0 * semi,
          xb = e1 * semi;
        const sa = station(wingPf, xa),
          sb = station(wingPf, xb);
        const ca = 0.6,
          cb = 0.73;
        const geo = new THREE.BufferGeometry();
        const ya = sa.y + airfoil(ca, sa.t, 0.02).yu * sa.chord + 0.02;
        const yb = sb.y + airfoil(ca, sb.t, 0.02).yu * sb.chord + 0.02;
        const ya2 = sa.y + airfoil(cb, sa.t, 0.02).yu * sa.chord + 0.02;
        const yb2 = sb.y + airfoil(cb, sb.t, 0.02).yu * sb.chord + 0.02;
        const v = [xa, ya, sa.le + ca * sa.chord, xb, yb, sb.le + ca * sb.chord, xb, yb2, sb.le + cb * sb.chord, xa, ya2, sa.le + cb * sa.chord];
        geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        geo.computeVertexNormals();
        let g = geo;
        const A = new THREE.Vector3(xa, ya, sa.le + ca * sa.chord);
        const B = new THREE.Vector3(xb, yb, sb.le + ca * sb.chord);
        if (side < 0) {
          g = mirrorX(geo);
          A.x = -A.x;
          B.x = -B.x;
        }
        const h = hingedSurface(g, A, B, mats.wing, side);
        h.mesh.material = mats.wing;
        parts.spoilers.push(h.pivot);
        root.add(h.pivot);
      }
    }
  }

  // Wing struts (high wing GA)
  if (w.strut) {
    for (const side of [1, -1]) {
      const a = new THREE.Vector3(side * fusR * 0.95, -0.35, w.rootLE + w.rootChord * 0.35);
      const b = new THREE.Vector3(side * semi * 0.45, w.y - 0.05, w.rootLE + w.rootChord * 0.3);
      const len = a.distanceTo(b);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), mats.paintPlain);
      strut.position.copy(a).add(b).multiplyScalar(0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      strut.scale.z = 2.2;
      root.add(strut);
    }
  }

  // Winglets
  const tip = station(wingPf, semi);
  if (w.winglet) {
    const wlH = { sharklet: semi * 0.13, blended: semi * 0.13, small: semi * 0.09 }[w.winglet];
    if (wlH) {
      const pf = { rootLE: 0, rootChord: tip.chord * 0.95, tipChord: tip.chord * 0.32, semi: wlH, sweep: 38, dihedral: 0, y: 0, thickness: 0.08, camber: 0 };
      const g = buildSurfacePatch(pf, 0, wlH, 0, 1, {});
      const cant = w.winglet === 'blended' ? 68 : 80;
      for (const side of [1, -1]) {
        let gg = g.clone();
        gg.rotateZ(side * cant * DEG);
        if (side < 0) gg = mirrorX(g.clone().rotateZ(cant * DEG));
        const mesh = new THREE.Mesh(gg, mats.tail);
        mesh.position.set(side * semi * 0.995, tip.y, tip.le);
        mesh.castShadow = true;
        root.add(mesh);
      }
    }
    if (w.winglet === 'raked' || w.winglet === 'curved') {
      const ext = semi * 0.07;
      const pf = { rootLE: 0, rootChord: tip.chord, tipChord: tip.chord * 0.25, semi: ext, sweep: 58, dihedral: w.winglet === 'curved' ? 18 : 3, y: 0, thickness: 0.08, camber: 0 };
      const g = buildSurfacePatch(pf, 0, ext, 0, 1, {});
      for (const side of [1, -1]) {
        const gg = side > 0 ? g.clone() : mirrorX(g);
        const mesh = new THREE.Mesh(gg, mats.wing);
        mesh.position.set(side * semi * 0.995, tip.y, tip.le);
        root.add(mesh);
      }
    }
  }

  // ---- Horizontal tail
  if (m.htail) {
    const h = m.htail;
    const hpf = {
      rootLE: h.rootLE,
      rootChord: h.rootChord,
      tipChord: h.tipChord,
      semi: h.span / 2,
      sweep: h.sweep,
      dihedral: h.dihedral,
      y: h.y,
      thickness: 0.1,
      camber: 0,
    };
    if (h.allMoving) {
      const g = buildSurfacePatch(hpf, 0, hpf.semi, 0, 1, {});
      for (const side of [1, -1]) {
        const gg = side > 0 ? g.clone() : mirrorX(g);
        const piv = new THREE.Vector3(side * fusR * 0.9, h.y, h.rootLE + h.rootChord * 0.35);
        const hs = hingedSurface(gg, piv, piv.clone().add(new THREE.Vector3(side, 0, 0)), mats.wing, side);
        parts.stabilators.push(hs.pivot);
        root.add(hs.pivot);
      }
    } else {
      const res = buildLiftingSurface(hpf, [{ from: 0.04, to: 0.97, hinge: 0.68, name: 'elevator' }], h.tTail ? mats.tail : mats.wing, h.tTail ? mats.tail : mats.wing, {});
      root.add(res.group);
      parts.elevators.push(...res.surfaces);
    }
  }
  // ---- Canard
  if (m.canard) {
    const c = m.canard;
    const cpf = { rootLE: c.rootLE, rootChord: c.rootChord, tipChord: c.tipChord, semi: c.span / 2, sweep: c.sweep, dihedral: 0, y: c.y, thickness: 0.06, camber: 0 };
    const g = buildSurfacePatch(cpf, fusR * 0.8, cpf.semi, 0, 1, {});
    for (const side of [1, -1]) {
      const gg = side > 0 ? g.clone() : mirrorX(g);
      const piv = new THREE.Vector3(side * fusR * 0.8, c.y, c.rootLE + c.rootChord * 0.45);
      const hs = hingedSurface(gg, piv, piv.clone().add(new THREE.Vector3(side, 0, 0)), mats.wing, side);
      parts.canards.push(hs.pivot);
      root.add(hs.pivot);
    }
  }
  // ---- Vertical tail
  if (m.vtail) {
    const v = m.vtail;
    const vpf = { rootLE: v.rootLE, rootChord: v.rootChord, tipChord: v.tipChord, semi: v.height, sweep: v.sweep, dihedral: 0, y: 0, thickness: 0.1, camber: 0 };
    const res = buildLiftingSurface(vpf, [{ from: 0.06, to: m.htail && m.htail.tTail ? 0.9 : 0.96, hinge: 0.68, name: 'rudder' }], mats.tail, mats.tail, { vertical: true });
    // rotate canonical span X -> +Y
    res.group.rotation.z = Math.PI / 2;
    res.group.position.y = v.y;
    // Planar UVs for the tail texture
    res.group.updateMatrixWorld(true);
    res.group.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry;
        const p = g.attributes.position;
        const uv = g.attributes.uv;
        o.updateMatrixWorld(true);
        for (let i = 0; i < p.count; i++) {
          _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          const hh = Math.min(1, Math.max(0, (_v.y - v.y) / v.height));
          const le = v.rootLE + Math.tan(v.sweep * DEG) * hh * v.height;
          const ch = lerp(v.rootChord, v.tipChord, hh);
          uv.setXY(i, (_v.z - le) / ch, hh);
        }
        uv.needsUpdate = true;
      }
    });
    root.add(res.group);
    parts.rudders.push(...res.surfaces);
    if (spec.model.ventralFins) {
      const vf = buildSurfacePatch({ rootLE: 0, rootChord: 1.2, tipChord: 0.6, semi: 0.55, sweep: 30, dihedral: 0, y: 0, thickness: 0.05 }, 0, 0.55, 0, 1, {});
      for (const side of [1, -1]) {
        const g = vf.clone();
        g.rotateZ(-Math.PI / 2 + side * 0.3);
        const mm = new THREE.Mesh(g, mats.wing);
        mm.position.set(side * 0.45, -0.45, 3.4);
        root.add(mm);
      }
    }
  }

  // ---- Engines
  for (const e of m.engines || []) {
    if (e.type === 'turbofan') {
      const res = buildTurbofan(e, mats, detail);
      root.add(res.group);
      if (res.fan) parts.fans.push(res.fan);
      const ws = station(wingPf, Math.abs(e.pos[0]));
      root.add(buildPylonUnderWing(e, ws.y - ws.t * ws.chord * 0.4, mats));
    } else if (e.type === 'pod') {
      const res = buildPod(e, mats, detail, fusR);
      root.add(res.group);
      root.add(res.pylon);
      if (res.fan) parts.fans.push(res.fan);
    } else if (e.type === 'turboprop') {
      root.add(buildTurbopropNacelle(e, mats, detail));
    } else if (e.type === 'internal') {
      // Nozzle
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(e.radius * 0.92, e.radius * 1.05, 1.3, detail === 'high' ? 20 : 10, 1, true), mats.nozzle);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(e.pos[0], e.pos[1], e.pos[2]);
      root.add(noz);
      const back = new THREE.Mesh(new THREE.CircleGeometry(e.radius * 0.85, 16), new THREE.MeshBasicMaterial({ color: 0x0a0806 }));
      back.position.set(e.pos[0], e.pos[1], e.pos[2] - 0.3);
      root.add(back);
      parts.nozzles.push(noz);
      // Afterburner flame
      const flameMat = new THREE.ShaderMaterial({
        uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `uniform float uIntensity; uniform float uTime; varying vec2 vUv;
          #include <logdepthbuf_pars_fragment>
          void main(){
            #include <logdepthbuf_fragment>
            float t = vUv.y; // 0 at tip, 1 at nozzle
            float rings = 0.55 + 0.45 * sin(t * 40.0 - uTime * 30.0);
            vec3 core = mix(vec3(1.0,0.45,0.1), vec3(0.6,0.75,1.0), smoothstep(0.55,1.0,t));
            float a = uIntensity * pow(t, 1.4) * (0.6 + 0.4 * rings);
            gl_FragColor = vec4(core * a * 1.6, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(e.radius * 0.8, 4.5, 16, 1, true), flameMat);
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(e.pos[0], e.pos[1], e.pos[2] + 0.6 + 2.25);
      flame.visible = false;
      root.add(flame);
      parts.afterburners.push(flame);
      if (e.intake) {
        const it = e.intake;
        const ig = new THREE.BoxGeometry(it.width, it.height, 5.0);
        const ip = ig.attributes.position;
        for (let i = 0; i < ip.count; i++) {
          if (ip.getZ(i) > 0) {
            ip.setX(i, ip.getX(i) * 0.8);
            ip.setY(i, ip.getY(i) * 0.6 + it.height * 0.25);
          }
        }
        ig.computeVertexNormals();
        const intake = new THREE.Mesh(ig, mats.paint);
        intake.material = mats.wing;
        intake.position.set(0, it.y, it.z + 2.5);
        intake.castShadow = true;
        root.add(intake);
        const mouth = new THREE.Mesh(new THREE.PlaneGeometry(it.width * 0.88, it.height * 0.82), mats.darkInterior);
        mouth.position.set(0, it.y, it.z - 0.01);
        mouth.rotation.y = Math.PI;
        root.add(mouth);
      }
    } else if (e.type === 'cowl') {
      // GA cowling is part of the fuselage; add an air intake and exhaust
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.05), mats.darkInterior);
      intake.position.set(0, -0.1, -2.85);
      root.add(intake);
    }
  }
  // Propellers
  for (const p of m.props || []) {
    const pr = buildPropeller(p, mats, detail);
    root.add(pr.group);
    parts.props.push(pr);
  }

  // ---- Canopy
  if (m.canopy) {
    const c = m.canopy;
    const len = c.toZ - c.fromZ;
    const geo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const can = new THREE.Mesh(geo, mats.glass);
    can.scale.set(c.width / 2, c.height, len / 2);
    can.position.set(0, c.y, (c.fromZ + c.toZ) / 2);
    can.renderOrder = 2;
    root.add(can);
    parts.canopy = can;
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 24, Math.PI), mats.spinner);
    frame.scale.set(c.width / 2, c.height, 1);
    frame.rotation.y = Math.PI / 2;
    frame.position.set(0, c.y, c.fromZ + len * 0.62);
    frame.scale.set(len * 0.18, c.height * 0.93, 1);
    frame.rotation.set(0, Math.PI / 2, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 20, Math.PI), mats.spinner);
    ring.scale.set(c.width / 2, c.height * 0.9, 1);
    ring.position.set(0, c.y, c.fromZ + len * 0.62);
    root.add(ring);
    // Ejection seat headrest (seen through canopy)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.25), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
    seat.position.set(0, c.y + 0.25, spec.eye[2] + 0.55);
    root.add(seat);
  }

  // ---- Landing gear
  const wingYAt = (x) => {
    const st = station(wingPf, Math.abs(x));
    return st.y - st.t * st.chord * 0.3;
  };
  for (const gp of spec.gear.points) {
    const nose = gp.name === 'nose';
    let attachY;
    const zAt = gp.pos[2];
    const cs = crossSection(spec, zAt);
    const bottom = cs.cy - cs.hBot * 0.85;
    if (nose || m.wing.mount !== 'low' || Math.abs(gp.pos[0]) < fusR * 1.05) attachY = bottom;
    else attachY = Math.min(wingYAt(gp.pos[0]), bottom + fusR * 0.4);
    if (spec.model.sponsons && !nose) attachY = bottom + 0.3;
    if (spec.category === 'fighter' && !nose) attachY = bottom + 0.15;
    const leg = buildGearLeg(spec, gp, attachY, mats, detail);
    root.add(leg.pivot);
    parts.gear.push(leg);
  }
  // Extra visual body gear for the heavy freighter
  if (spec.id === 't74f') {
    for (const side of [1, -1]) {
      const gp = { name: 'body', pos: [side * 2.0, spec.gear.points[1].pos[1], 4.2] };
      const leg = buildGearLeg(spec, gp, -fusR * 0.85, mats, detail);
      leg.extra = true;
      root.add(leg.pivot);
      parts.gear.push(leg);
    }
  }
  // Sponsons for the tactical transport
  if (spec.model.sponsons) {
    for (const side of [1, -1]) {
      const sp = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 4.2, 6, 12), mats.paintPlain);
      sp.rotation.x = Math.PI / 2;
      sp.position.set(side * (fusR * 0.92), -fusR * 0.62, 0.3);
      sp.scale.set(1, 1, 0.9);
      sp.castShadow = true;
      root.add(sp);
    }
  }

  // ---- Lights
  const glowMat = createGlowMaterial({ scale: 260, minSize: 1.5, maxSize: 60 });
  const tailY = (f.centerY || 0) + (f.tailUp || 0);
  const tipLE = tip.le;
  const lightDefs = [];
  const add = (group, pos, color, size) => {
    lightDefs.push({ group, pos, color, size, intensity: 0 });
  };
  add('navRed', [-semi * 1.0, tip.y + 0.05, tipLE + tip.chord * 0.25], [1, 0.08, 0.05], 1.2);
  add('navGreen', [semi * 1.0, tip.y + 0.05, tipLE + tip.chord * 0.25], [0.1, 1, 0.25], 1.2);
  add('navWhite', [0, tailY, f.tailZ + 0.05], [1, 1, 1], 1.0);
  add('strobe', [-semi * 1.0, tip.y + 0.05, tipLE + tip.chord * 0.55], [1, 1, 1], 2.2);
  add('strobe', [semi * 1.0, tip.y + 0.05, tipLE + tip.chord * 0.55], [1, 1, 1], 2.2);
  add('strobe', [0, tailY + 0.1, f.tailZ + 0.1], [1, 1, 1], 1.8);
  const topY = crossSection(spec, 0).cy + crossSection(spec, 0).hTop;
  const botY = crossSection(spec, 0).cy - crossSection(spec, 0).hBot;
  if (spec.category !== 'fighter' || true) {
    add('beacon', [0, topY + 0.05, 0.5], [1, 0.1, 0.05], 1.6);
    add('beacon', [0, botY - 0.05, 1.5], [1, 0.1, 0.05], 1.6);
  }
  const llX = m.style === 'ga' ? semi * 0.35 : Math.min(semi * 0.25, fusR * 1.7);
  const llS = station(wingPf, llX);
  add('landing', [llX, llS.y, llS.le + 0.1], [1, 0.97, 0.9], 3.0);
  add('landing', [-llX, llS.y, llS.le + 0.1], [1, 0.97, 0.9], 3.0);
  const noseGear = spec.gear.points.find((g) => g.name === 'nose');
  if (noseGear) add('taxi', [0, noseGear.pos[1] + 0.9, noseGear.pos[2] - 0.2], [1, 0.97, 0.9], 2.0);
  const glow = createGlowPoints(
    lightDefs.map((l) => ({ pos: l.pos, color: l.color, size: l.size, intensity: 0 })),
    glowMat
  );
  root.add(glow);
  lightDefs.forEach((l, i) => {
    (parts.lightGroups[l.group] = parts.lightGroups[l.group] || []).push(i);
  });
  parts.glow = glow;
  parts.glowMat = glowMat;

  // Merge static meshes into fewer draw calls for low detail models
  if (opts.merge) mergeStaticMeshes(root, parts);

  const dispose = () => {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const k of Object.keys(mats)) {
      if (mats[k].map && mats[k].map !== sharedTextures().fan && !mats[k].map.userData?.shared) {
        if (mats[k].map === fusTex || mats[k].map === tailTex) mats[k].map.dispose();
      }
      mats[k].dispose();
    }
    glowMat.dispose();
  };

  return { root, parts, mats, livery, dispose, spec };
}

// Merges every mesh that is a direct static child (not animated) into one mesh per material.
function mergeStaticMeshes(root, parts) {
  const animated = new Set();
  const markTree = (o) => o.traverse((c) => animated.add(c));
  for (const k of ['elevators', 'ailerons', 'flaps', 'spoilers', 'rudders', 'canards', 'stabilators']) for (const p of parts[k]) markTree(p);
  for (const g of parts.gear) markTree(g.pivot);
  for (const p of parts.props) markTree(p.group);
  for (const f of parts.fans) markTree(f);
  for (const a of parts.afterburners) markTree(a);
  if (parts.glow) animated.add(parts.glow);
  const byMat = new Map();
  root.updateMatrixWorld(true);
  const toRemove = [];
  root.traverse((o) => {
    if (!o.isMesh || animated.has(o)) return;
    if (o.material.transparent) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // Normalise attribute sets
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
    toRemove.push(o);
  });
  for (const o of toRemove) o.parent.remove(o);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    root.add(mesh);
  }
}

export { crossSection, station };
