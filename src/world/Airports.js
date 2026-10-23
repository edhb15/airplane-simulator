// Renders airports from their procedural layouts: runways with markings,
// taxiways, aprons, buildings, lighting systems, windsocks, radar and ground vehicles.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUTS } from './airportLayout.js';
import { asphaltTexture, makeCanvas, facadeTextures } from '../render/textures.js';
import { createGlowMaterial, createGlowPoints } from '../render/GlowPoints.js';
import { mulberry32 } from './noise.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function noiseFill(ctx, w, h, base, amount, seed) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const r = mulberry32(seed);
  for (let i = 0; i < w * h; i++) {
    const v = (r() - 0.5) * amount;
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
}

function runwayEndTexture(width, id, ils, seed) {
  const W = 256,
    H = 2048;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  noiseFill(g, W, H, '#3a3c3f', 22, seed);
  const px = W / width; // pixels per metre across
  const py = H / 600; // pixels per metre along
  // Tyre marks in the touchdown zone
  const r = mulberry32(seed + 1);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 60; i++) {
    const y = (150 + r() * 450) * py;
    const x = (W / 2) + (r() - 0.5) * width * 0.35 * px;
    g.fillStyle = '#111';
    g.fillRect(x - 3, y, 6 + r() * 5, (20 + r() * 80) * py);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#f2f2ee';
  // Edge lines
  g.fillRect(0.4 * px, 0, 0.9 * px, H);
  g.fillRect(W - 1.3 * px, 0, 0.9 * px, H);
  // Threshold bar & piano keys
  g.fillRect(0, 0, W, 1.2 * py);
  const stripes = width >= 60 ? 16 : width >= 45 ? 12 : width >= 30 ? 8 : 6;
  const keyW = 1.8 * px;
  const usable = width * px - 6 * px;
  const gap = (usable - stripes * keyW) / (stripes + 1);
  for (let i = 0; i < stripes; i++) {
    const half = i < stripes / 2;
    let x = 3 * px + gap + i * (keyW + gap);
    if (!half) x += gap * 0.5;
    g.fillRect(x, 6 * py, keyW, 30 * py);
  }
  // Designation (letter nearest the threshold, number beyond)
  const num = id.replace(/[LRC]/, '');
  const letter = id.replace(/[0-9]/g, '');
  const drawText = (txt, yM, hM) => {
    g.save();
    g.translate(W / 2, yM * py);
    g.scale(1, -1);
    g.font = `bold ${Math.round(hM * py)}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Glyphs are narrow on the runway (scaled across)
    g.scale((px / py) * 1.45, 1);
    g.fillText(txt, 0, 0);
    g.restore();
  };
  let y = 48;
  if (letter) {
    drawText(letter, y + 4, 9);
    y += 13;
  }
  drawText(num, y + 5, 9);
  // Centreline begins after the designation
  for (let a = y + 20; a < 600; a += 50) g.fillRect(W / 2 - 0.45 * px, a * py, 0.9 * px, 30 * py);
  // Touchdown zone markings and aiming point
  const tdz = (a, bars) => {
    for (const s of [-1, 1]) {
      for (let b = 0; b < bars; b++) {
        const x = W / 2 + s * (width * 0.18 + b * 2.4) * px;
        g.fillRect(x - 0.9 * px, a * py, 1.8 * px, 22 * py);
      }
    }
  };
  if (width >= 30) {
    tdz(150, 3);
    tdz(450, 2);
    tdz(540, 1);
    // Aiming point (big blocks at 300 m)
    for (const s of [-1, 1]) g.fillRect(W / 2 + s * width * 0.2 * px - (s > 0 ? 0 : 6 * px), 300 * py, 6 * px, 45 * py);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function runwayMidTexture(width, seed) {
  const W = 128,
    H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  noiseFill(g, W, H, '#3b3d40', 22, seed);
  const px = W / width,
    py = H / 100;
  g.fillStyle = '#f2f2ee';
  g.fillRect(0.4 * px, 0, 0.9 * px, H);
  g.fillRect(W - 1.3 * px, 0, 0.9 * px, H);
  g.fillRect(W / 2 - 0.45 * px, 0, 0.9 * px, 30 * py);
  g.fillRect(W / 2 - 0.45 * px, 50 * py, 0.9 * px, 30 * py);
  // faint rubber deposits
  g.globalAlpha = 0.06;
  g.fillStyle = '#000';
  g.fillRect(W / 2 - width * 0.12 * px, 0, width * 0.24 * px, H);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function taxiwayTexture() {
  const W = 128,
    H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  noiseFill(g, W, H, '#424446', 18, 9);
  g.fillStyle = '#d9a91e';
  g.fillRect(W / 2 - 2, 0, 4, H);
  g.fillRect(1, 0, 3, H);
  g.fillRect(W - 4, 0, 3, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function concreteTexture() {
  const S = 256;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  noiseFill(g, S, S, '#8d8d88', 16, 21);
  const r = mulberry32(4);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.06})`;
      g.fillRect(i * 64, j * 64, 64, 64);
    }
  g.strokeStyle = 'rgba(40,40,40,0.5)';
  g.lineWidth = 1.5;
  for (let i = 0; i <= S; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(S, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function glassFacadeTexture() {
  const W = 256,
    H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#6f8ea8');
  grd.addColorStop(1, '#3d566b');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c8cdd2';
  g.lineWidth = 2;
  for (let x = 0; x <= W; x += 16) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let y = 0; y <= H; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function corrugatedTexture(color) {
  const W = 128,
    H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 4) {
    g.fillStyle = x % 8 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
    g.fillRect(x, 0, 2, H);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Geometry helpers (all in airport-relative world axes, origin at airport ref point)
// ---------------------------------------------------------------------------

class Frame {
  constructor(ap) {
    this.s = Math.sin(ap.heading * DEG);
    this.c = Math.cos(ap.heading * DEG);
  }
  // airport frame (u,v) -> relative world (x,z)
  xz(u, v) {
    return [u * this.s + v * this.c, -u * this.c + v * this.s];
  }
  // Rotation that maps local +X to the u axis and local +Z to the v axis
  get yaw() {
    return Math.atan2(this.c, this.s);
  }
  // Rotate a geometry built in airport-aligned local axes and move it to (u, v)
  place(g, u, v) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(this.yaw));
    const [x, z] = this.xz(u, v);
    g.translate(x, 0, z);
    return g;
  }
}

// Flat quad between along-axis points with width, UV v = along/vScale
function stripGeometry(F, a, b, width, y, vScale, vOffset = 0, uFlip = false) {
  const du = b.u - a.u,
    dv = b.v - a.v;
  const len = Math.hypot(du, dv);
  const nu = (-dv / len) * (width / 2),
    nv = (du / len) * (width / 2);
  const p = [
    [a.u - nu, a.v - nv],
    [a.u + nu, a.v + nv],
    [b.u + nu, b.v + nv],
    [b.u - nu, b.v - nv],
  ].map(([u, v]) => F.xz(u, v));
  const pos = [p[0][0], y, p[0][1], p[1][0], y, p[1][1], p[2][0], y, p[2][1], p[3][0], y, p[3][1]];
  const v0 = vOffset,
    v1 = vOffset + len / vScale;
  const uv = uFlip ? [1, v0, 0, v0, 0, v1, 1, v1] : [0, v0, 1, v0, 1, v1, 0, v1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // orientation so the face points up
  const ax = p[1][0] - p[0][0],
    az = p[1][1] - p[0][1];
  const bx = p[3][0] - p[0][0],
    bz = p[3][1] - p[0][1];
  const cross = az * bx - ax * bz;
  g.setIndex(cross > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

function rectGeometry(F, u0, u1, v0, v1, y, tile) {
  const p = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ].map(([u, v]) => F.xz(u, v));
  const pos = [];
  const uv = [];
  for (const [x, z] of p) {
    pos.push(x, y, z);
    uv.push(x / tile, z / tile);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const ax = p[1][0] - p[0][0],
    az = p[1][1] - p[0][1];
  const bx = p[3][0] - p[0][0],
    bz = p[3][1] - p[0][1];
  g.setIndex(az * bx - ax * bz > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

// Box placed in the airport frame (w along u, d along v), base at y
function boxAt(F, u, v, w, d, h, y = 0, uvScale = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvScale) {
    // scale UVs per face so textures tile in metres
    const uv = g.attributes.uv;
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(n.getX(i)),
        ny = Math.abs(n.getY(i));
      const sx = ny > 0.5 ? w : nx > 0.5 ? d : w;
      const sy = ny > 0.5 ? d : h;
      uv.setXY(i, (uv.getX(i) * sx) / uvScale[0], (uv.getY(i) * sy) / uvScale[1]);
    }
  }
  g.translate(0, h / 2 + y, 0);
  F.place(g, u, v);
  return g;
}

// ---------------------------------------------------------------------------

export class Airports {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.items = [];
    this.windsocks = [];
    this.radars = [];
    this.vehicles = [];
    this.time = 0;
    this.wind = { dir: 270, speed: 5 };
    this.detail = opts.detail || 'high';
    const fac = facadeTextures();
    this.mats = {
      asphalt: new THREE.MeshStandardMaterial({ map: asphaltTexture('#3c3e41', 5), roughness: 0.9 }),
      shoulder: new THREE.MeshStandardMaterial({ map: asphaltTexture('#4a4a46', 7), roughness: 0.95 }),
      taxi: new THREE.MeshStandardMaterial({ map: taxiwayTexture(), roughness: 0.88 }),
      concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.85, emissive: new THREE.Color(0x000000) }),
      glass: new THREE.MeshStandardMaterial({ map: glassFacadeTexture(), roughness: 0.15, metalness: 0.6, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0 }),
      roof: new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.8, metalness: 0.2 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 }),
      hangar: new THREE.MeshStandardMaterial({ map: corrugatedTexture('#9aa3a9'), roughness: 0.6, metalness: 0.5 }),
      hangarDoor: new THREE.MeshStandardMaterial({ map: corrugatedTexture('#6f7c86'), roughness: 0.6, metalness: 0.5 }),
      warehouse: new THREE.MeshStandardMaterial({ map: corrugatedTexture('#c7c2b4'), roughness: 0.7, metalness: 0.3 }),
      shelter: new THREE.MeshStandardMaterial({ color: 0x8c8a80, roughness: 0.95 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }),
      office: new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissive, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9da4aa, roughness: 0.35, metalness: 0.8 }),
      bridge: new THREE.MeshStandardMaterial({ color: 0xd6d9dc, roughness: 0.5, metalness: 0.3 }),
      sock: new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.8, side: THREE.DoubleSide }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.7 }),
      parking: new THREE.MeshStandardMaterial({ map: asphaltTexture('#2f3133', 11), roughness: 0.95 }),
    };
    this.glowMat = createGlowMaterial({ scale: 420, minSize: 1.4, maxSize: 26 });
    for (const L of LAYOUTS.values()) this.build(L);
  }

  build(L) {
    const ap = L.airport;
    const F = new Frame(ap);
    const root = new THREE.Group();
    root.position.set(ap.x, ap.elevation, ap.z);
    root.name = ap.icao;
    const near = new THREE.Group(); // detailed content
    root.add(near);
    const geos = new Map();
    const add = (mat, g) => {
      if (!geos.has(mat)) geos.set(mat, []);
      geos.get(mat).push(g);
    };
    const runwayMeshes = [];
    const seed = ap.icao.charCodeAt(2) * 31 + ap.icao.charCodeAt(3);

    // ---- Runways
    for (const rw of ap.runways) {
      const hdgDelta = 0;
      void hdgDelta;
      const a = { u: rw.along - rw.length / 2, v: rw.right };
      const b = { u: rw.along + rw.length / 2, v: rw.right };
      const endLen = Math.min(600, rw.length / 3);
      const pA = { u: a.u + endLen, v: a.v };
      const pB = { u: b.u - endLen, v: b.v };
      const texA = runwayEndTexture(rw.width, rw.ids[0], rw.ils && rw.ils[0], seed);
      const texB = runwayEndTexture(rw.width, rw.ids[1], rw.ils && rw.ils[1], seed + 7);
      const mid = runwayMidTexture(rw.width, seed + 3);
      const mA = new THREE.MeshStandardMaterial({ map: texA, roughness: 0.88 });
      const mB = new THREE.MeshStandardMaterial({ map: texB, roughness: 0.88 });
      const mM = new THREE.MeshStandardMaterial({ map: mid, roughness: 0.88 });
      this.runwayMats = this.runwayMats || [];
      this.runwayMats.push(mA, mB, mM);
      // End A: along from threshold, u across left->right (pilot landing +u: right = +v)
      const gA = stripGeometry(F, a, pA, rw.width, 0.16, 600, 0, false);
      const gB = stripGeometry(F, b, pB, rw.width, 0.16, 600, 0, false);
      const gM = stripGeometry(F, pA, pB, rw.width, 0.16, 100, 0, false);
      for (const [g, m] of [
        [gA, mA],
        [gB, mB],
        [gM, mM],
      ]) {
        const mesh = new THREE.Mesh(g, m);
        mesh.receiveShadow = true;
        root.add(mesh);
        runwayMeshes.push(mesh);
      }
      // Shoulders and blast pads
      add(this.mats.shoulder, stripGeometry(F, { u: a.u - 70, v: a.v }, { u: b.u + 70, v: b.v }, rw.width + 16, 0.1, 50));
    }

    // ---- Taxiways (slightly different heights per kind to avoid z-fighting)
    const kindY = { parallel: 0.13, connector: 0.135, lane: 0.125, entry: 0.14, cross: 0.128 };
    for (const t of L.taxiways) {
      const ext = t.width / 2;
      const du = t.b.u - t.a.u,
        dv = t.b.v - t.a.v;
      const len = Math.hypot(du, dv);
      const a = { u: t.a.u - (du / len) * ext, v: t.a.v - (dv / len) * ext };
      const b = { u: t.b.u + (du / len) * ext, v: t.b.v + (dv / len) * ext };
      add(this.mats.taxi, stripGeometry(F, a, b, t.width, kindY[t.kind] || 0.13, 30));
      add(this.mats.shoulder, stripGeometry(F, a, b, t.width + 10, 0.09, 50));
    }
    // ---- Aprons
    for (const r of L.rects) if (r.kind === 'apron') add(this.mats.concrete, rectGeometry(F, r.u0, r.u1, r.v0, r.v1, 0.11, 40));
    for (const p of L.parking) add(this.mats.parking, rectGeometry(F, p.u0, p.u1, p.v0, p.v1, 0.08, 30));

    // Gate lead-in lines
    for (const g of L.gates) {
      const back = g.push;
      add(this.mats.yellow, stripGeometry(F, { u: back.u, v: back.v }, { u: g.u + (g.headingTo.u - g.u) * 0.35, v: g.v + (g.headingTo.v - g.v) * 0.35 }, 0.35, 0.14, 10));
    }

    // ---- Buildings
    const nearGeos = new Map();
    const addN = (mat, g) => {
      if (!nearGeos.has(mat)) nearGeos.set(mat, []);
      nearGeos.get(mat).push(g);
    };
    const M = this.mats;
    for (const b of L.buildings) {
      switch (b.kind) {
        case 'terminal':
        case 'pier': {
          addN(M.glass, boxAt(F, b.u, b.v, b.w, b.d, b.h, 0, [16, 8]));
          addN(M.roof, boxAt(F, b.u, b.v, b.w + 6, b.d + 6, 1.2, b.h));
          if (b.kind === 'terminal') {
            // Curved signature roof
            const arch = new THREE.CylinderGeometry(b.d * 0.62, b.d * 0.62, b.w * 0.92, 24, 1, false, -Math.PI / 2.6, (Math.PI * 2) / 2.6);
            arch.rotateX(-Math.PI / 2);
            arch.rotateY(Math.PI / 2);
            arch.translate(0, -b.d * 0.62 * Math.cos(Math.PI / 2.6), 0);
            arch.scale(1, 0.32, 1);
            arch.translate(0, b.h + 1, 0);
            addN(M.metal, F.place(arch, b.u, b.v));
          }
          break;
        }
        case 'cargoTerminal':
        case 'warehouse':
          addN(M.warehouse, boxAt(F, b.u, b.v, b.w, b.d, b.h, 0, [12, 12]));
          addN(M.roof, boxAt(F, b.u, b.v, b.w + 2, b.d + 2, 0.8, b.h));
          break;
        case 'tower': {
          const [x, z] = F.xz(b.u, b.v);
          const shaft = new THREE.CylinderGeometry(3.2, 4.2, b.h - 9, 12);
          shaft.translate(x, (b.h - 9) / 2, z);
          addN(M.white, shaft);
          const deck = new THREE.CylinderGeometry(8.5, 6, 2.5, 8);
          deck.translate(x, b.h - 9, z);
          addN(M.white, deck);
          const cab = new THREE.CylinderGeometry(8.2, 7.2, 5, 8, 1);
          cab.translate(x, b.h - 5.2, z);
          addN(M.glass, cab);
          const roof = new THREE.CylinderGeometry(4, 9, 2, 8);
          roof.translate(x, b.h - 1.6, z);
          addN(M.roof, roof);
          const mast = new THREE.CylinderGeometry(0.15, 0.15, 8, 6);
          mast.translate(x, b.h + 3.4, z);
          addN(M.metal, mast);
          L.towerTop = { x: ap.x + x, y: ap.elevation + b.h - 4, z: ap.z + z };
          break;
        }
        case 'hangar': {
          const arch = new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.d, 20, 1, true, 0, Math.PI);
          arch.rotateZ(Math.PI / 2);
          arch.rotateY(Math.PI / 2);
          arch.scale(1, (b.h * 0.55) / (b.w / 2), 1);
          arch.translate(0, b.h * 0.45, 0);
          addN(M.hangar, F.place(arch, b.u, b.v));
          addN(M.hangar, boxAt(F, b.u, b.v, b.w, b.d, b.h * 0.45, 0, [10, 10]));
          // Door on the apron side
          const dv = b.v + (b.facing || 1) * -(b.d / 2 + 0.1);
          addN(M.hangarDoor, boxAt(F, b.u, dv, b.w * 0.85, 0.4, b.h * 0.8, 0, [10, 10]));
          break;
        }
        case 'shelter': {
          const arch = new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.d, 16, 1, false, 0, Math.PI);
          arch.rotateZ(Math.PI / 2);
          arch.rotateY(Math.PI / 2);
          arch.scale(1, b.h / (b.w / 2), 1);
          addN(M.shelter, F.place(arch, b.u, b.v));
          // Dark door opening facing the taxi lane
          addN(M.dark, boxAt(F, b.u, b.v - (b.facing || 1) * (b.d / 2 + 0.05), b.w * 0.75, 0.2, b.h * 0.8, 0));
          break;
        }
        case 'fuel': {
          for (let i = 0; i < 4; i++) {
            const [x, z] = F.xz(b.u - b.w / 2 + 10 + (i % 2) * 28, b.v - b.d / 2 + 10 + Math.floor(i / 2) * 22);
            const tank = new THREE.CylinderGeometry(8, 8, b.h, 18);
            tank.translate(x, b.h / 2, z);
            addN(M.white, tank);
          }
          break;
        }
        case 'fire':
          addN(M.office, boxAt(F, b.u, b.v, b.w, b.d, b.h, 0, [20, 12]));
          addN(M.red, boxAt(F, b.u, b.v - b.d / 2, b.w * 0.8, 0.3, b.h * 0.6, 0));
          break;
        case 'radar': {
          const [x, z] = F.xz(b.u, b.v);
          const t = new THREE.CylinderGeometry(1.2, 2, b.h, 8);
          t.translate(x, b.h / 2, z);
          addN(M.metal, t);
          const ant = new THREE.Group();
          const dish = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 0.4), M.white);
          dish.position.y = 1.2;
          ant.add(dish);
          ant.position.set(x, b.h, z);
          near.add(ant);
          this.radars.push(ant);
          break;
        }
        case 'fbo':
        case 'office':
          addN(M.office, boxAt(F, b.u, b.v, b.w, b.d, b.h, 0, [20, 12]));
          addN(M.roof, boxAt(F, b.u, b.v, b.w + 1, b.d + 1, 0.5, b.h));
          break;
      }
    }

    // Jet bridges
    for (const g of L.gates) {
      if (!g.bridge || !g.bridgeFrom) continue;
      const from = g.bridgeFrom;
      // Door is on the aircraft's left, forward of the reference point
      const fu = g.headingTo.u - g.u,
        fv = g.headingTo.v - g.v;
      const fl = Math.hypot(fu, fv) || 1;
      const leftU = fv / fl,
        leftV = -fu / fl;
      const door = { u: g.u + (fu / fl) * 13 + leftU * 3.5, v: g.v + (fv / fl) * 13 + leftV * 3.5 };
      const du = door.u - from.u,
        dv = door.v - from.v;
      const len = Math.hypot(du, dv);
      const geo = new THREE.BoxGeometry(len, 3, 3);
      geo.translate(len / 2, 5, 0);
      geo.rotateY(-Math.atan2(dv, du)); // angle in the airport frame from +u toward +v
      addN(M.bridge, F.place(geo, from.u, from.v));
      const leg = new THREE.CylinderGeometry(0.3, 0.3, 4, 6);
      const [lx, lz] = F.xz(from.u + du * 0.75, from.v + dv * 0.75);
      leg.translate(lx, 2, lz);
      addN(M.metal, leg);
    }

    // Parking lot cars (instanced)
    if (L.parking.length && this.detail !== 'low') {
      const r = mulberry32(seed);
      const carGeo = new THREE.BoxGeometry(4.4, 1.5, 1.9);
      carGeo.translate(0, 0.75, 0);
      const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }), 400);
      let n = 0;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), F.yaw + Math.PI / 2);
      const col = new THREE.Color();
      for (const p of L.parking) {
        for (let u = p.u0 + 4; u < p.u1 - 4 && n < 400; u += 3) {
          for (const v of [p.v0 + 8, p.v0 + 14, p.v1 - 14, p.v1 - 8]) {
            if (r() < 0.35 || n >= 400) continue;
            const [x, z] = F.xz(u, v);
            m4.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(1, 1, 1));
            cars.setMatrixAt(n, m4);
            const pal = [0xffffff, 0x222222, 0x8a8f96, 0xa31d1d, 0x1d3f8a, 0xc9c9c9, 0x2b5d34];
            cars.setColorAt(n, col.setHex(pal[Math.floor(r() * pal.length)]));
            n++;
          }
        }
      }
      cars.count = n;
      cars.castShadow = true;
      near.add(cars);
    }

    // Merge flat surfaces (always visible) and near buildings
    for (const [mat, list] of geos) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.receiveShadow = true;
      root.add(m);
    }
    for (const [mat, list] of nearGeos) {
      const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      near.add(m);
    }

    // ---- Windsocks
    for (const w of L.windsocks) {
      const [x, z] = F.xz(w.u, w.v);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), M.metal);
      pole.position.set(x, 3.5, z);
      near.add(pole);
      const sock = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 3.6, 10, 1, true), M.sock);
      cone.rotation.z = Math.PI / 2;
      cone.position.x = 1.8;
      sock.add(cone);
      sock.position.set(x, 6.8, z);
      near.add(sock);
      this.windsocks.push(sock);
    }

    // ---- Lights
    const lights = L.lights.map((l) => {
      const [x, z] = F.xz(l.u, l.v);
      const y = l.kind === 'als' || l.kind === 'flash' ? 0.6 : l.kind === 'papi' ? 0.8 : 0.4;
      return { pos: [x, y, z], color: l.color, size: l.size, intensity: l.kind === 'papi' ? 3 : 1, papi: l.papi || 0, flash: l.flash || 0 };
    });
    // Apron flood lights on poles
    for (const f of L.floods) {
      const [x, z] = F.xz(f.u, f.v);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 24, 6), M.metal);
      pole.position.set(x, 12, z);
      near.add(pole);
      lights.push({ pos: [x, 24, z], color: [1, 0.85, 0.6], size: 4, intensity: 1.2 });
    }
    // Tower beacon / obstruction lights
    if (L.towerTop) lights.push({ pos: [L.towerTop.x - ap.x, L.towerTop.y - ap.elevation + 12, L.towerTop.z - ap.z], color: [1, 0.1, 0.05], size: 2.5, intensity: 1 });
    const pts = createGlowPoints(lights, this.glowMat);
    pts.position.set(0, 0, 0);
    root.add(pts);

    // ---- Ground vehicles
    if (this.detail !== 'low') {
      for (const path of L.vehicles) {
        const rr = mulberry32(seed + path.length);
        const count = ap.type === 'international' ? 7 : ap.type === 'ga' ? 1 : 3;
        for (let i = 0; i < count; i++) {
          const v = this.makeVehicle(rr);
          near.add(v.mesh);
          this.vehicles.push({ ...v, path: path.map((p) => F.xz(p.u, p.v)), t: rr(), speed: 5 + rr() * 5, airport: ap });
        }
      }
    }

    this.scene.add(root);
    this.items.push({ L, root, near, lights: pts, runwayMeshes, ap });
  }

  makeVehicle(r) {
    const type = Math.floor(r() * 4);
    const g = new THREE.Group();
    const body = (w, h, d, color, y = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      m.position.set(0, y + h / 2 + 0.4, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (type === 0) {
      // Baggage tug with carts
      body(1.6, 1.1, 2.4, 0xd8d8d0);
      for (let k = 1; k <= 3; k++) body(1.5, 1.4, 2.2, 0x5a6670, 0, k * 2.8);
    } else if (type === 1) {
      // Fuel truck
      body(2.4, 2.0, 2.4, 0xe8e8e8, 0, -3);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.6, roughness: 0.35 }));
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 1.8, 1.4);
      g.add(tank);
    } else if (type === 2) {
      // Apron bus
      body(2.5, 2.6, 12, 0x1f5fa8);
    } else {
      // Follow-me car
      body(1.8, 1.4, 4.2, 0xffcc00);
    }
    // Amber beacon
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
    lamp.position.set(0, 3, 0);
    g.add(lamp);
    return { mesh: g };
  }

  setWind(dirDeg, speedMs) {
    this.wind.dir = dirDeg;
    this.wind.speed = speedMs;
  }

  update(dt, camera, world) {
    this.time += dt;
    const night = world ? world.night : 0;
    this.glowMat.uniforms.uGlobal.value = 0.18 + 1.0 * night;
    this.glowMat.uniforms.uTime.value = this.time;
    this.glowMat.uniforms.uCamPos.value.copy(camera.position);
    this.mats.glass.emissiveIntensity = 0.35 * night;
    this.mats.office.emissiveIntensity = 0.9 * night;
    this.mats.concrete.emissive.setRGB(0.09, 0.075, 0.05).multiplyScalar(night);
    const cp = camera.position;
    for (const it of this.items) {
      const d = Math.hypot(it.ap.x - cp.x, it.ap.z - cp.z);
      it.root.visible = d < 90000;
      it.near.visible = d < 22000 + Math.max(0, cp.y - it.ap.elevation) * 2;
    }
    // Windsocks: point downwind, sag in light winds
    const wd = (this.wind.dir + 180) * DEG;
    const sag = Math.max(0, 1 - this.wind.speed / 8);
    for (const s of this.windsocks) {
      if (!s.parent.visible) continue;
      s.rotation.set(0, 0, 0);
      s.rotation.order = 'YZX';
      s.rotation.y = -(wd - Math.PI / 2) + Math.sin(this.time * 2.3 + s.position.x) * 0.06;
      s.rotation.z = -sag * 1.2;
    }
    for (const r of this.radars) if (r.parent.visible) r.rotation.y += dt * 2.2;
    // Ground vehicles along their loops
    for (const v of this.vehicles) {
      if (!v.mesh.parent.visible) continue;
      const path = v.path;
      let total = 0;
      const segs = [];
      for (let i = 0; i < path.length; i++) {
        const a = path[i],
          b = path[(i + 1) % path.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segs.push(len);
        total += len;
      }
      v.t = (v.t + (v.speed * dt) / total) % 1;
      let d = v.t * total;
      let i = 0;
      while (d > segs[i]) {
        d -= segs[i];
        i++;
      }
      const a = path[i],
        b = path[(i + 1) % path.length];
      const f = d / segs[i];
      v.mesh.position.set(a[0] + (b[0] - a[0]) * f, 0.12, a[1] + (b[1] - a[1]) * f);
      v.mesh.rotation.y = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
    }
  }

  // Tower camera position for an airport
  towerPosition(icao) {
    const it = this.items.find((i) => i.ap.icao === icao);
    return it && it.L.towerTop ? it.L.towerTop : null;
  }
}
