// Passenger cabin interior seen from the cabin camera: curved sidewalls that
// follow the fuselage cross-section with window cut-outs aligned to the exterior
// livery windows (so you can look out at the wing and engines), half-drawn
// shades, overhead bins, seat rows and cabin lighting.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function hasCabin(spec) {
  return !!(spec.model.paxWindows && spec.category !== 'fighter');
}

// Curved sidewall (one side) on a circle of radius R around (0, cy): a grid in
// (z, theta) whose lines include every window edge, with window cells removed.
// theta is measured from the top of the circle; x = side * R sin(theta).
function sidewall(side, R, cy, z0, z1, thCeil, thFloor, windows, win) {
  const zs = new Set([z0, z1]);
  for (const wz of windows) {
    zs.add(wz - win.w / 2);
    zs.add(wz + win.w / 2);
  }
  const zl = [...zs].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
  const thTop = Math.acos(THREE.MathUtils.clamp((win.y + win.h / 2 - cy) / R, -1, 1));
  const thBot = Math.acos(THREE.MathUtils.clamp((win.y - win.h / 2 - cy) / R, -1, 1));
  const thShade = thTop + (thBot - thTop) * 0.32;
  const ths = new Set([thCeil, thFloor, thTop, thBot, thShade]);
  const n = 14;
  for (let i = 1; i < n; i++) ths.add(thCeil + ((thFloor - thCeil) * i) / n);
  const tl = [...ths].sort((a, b) => a - b);
  const wall = [],
    shade = [];
  const inWindowZ = (z) => windows.some((wz) => Math.abs(z - wz) < win.w / 2 - 1e-4);
  const P = (z, th) => [side * R * Math.sin(th), cy + R * Math.cos(th), z];
  const N = (th) => [-side * Math.sin(th), -Math.cos(th), 0];
  for (let i = 0; i < zl.length - 1; i++) {
    const za = zl[i],
      zb = zl[i + 1];
    const zw = inWindowZ((za + zb) / 2);
    for (let j = 0; j < tl.length - 1; j++) {
      const ta = tl[j],
        tb = tl[j + 1];
      const tc = (ta + tb) / 2;
      let target = wall;
      if (zw && tc > thTop && tc < thBot) {
        if (tc < thShade) target = shade;
        else continue; // open window
      }
      const a = P(za, ta),
        b = P(zb, ta),
        c = P(za, tb),
        d = P(zb, tb);
      const na = N(ta),
        nb = N(tb);
      target.push([a, na], [c, nb], [b, na], [b, na], [c, nb], [d, nb]);
    }
  }
  const build = (list) => {
    if (!list.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((v) => v[0]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(list.flatMap((v) => v[1]), 3));
    return g;
  };
  return { wall: build(wall), shade: build(shade) };
}

export class CabinInterior {
  constructor(spec) {
    this.group = new THREE.Group();
    this.group.name = 'cabin';
    const f = spec.model.fuselage;
    const pw = spec.model.paxWindows;
    const r = f.radius || 1;
    const cy = f.centerY || 0;
    const R = r * 0.93;
    const floorY = cy - r * 0.45;
    const ceilY = cy + r * 0.78;
    const xAt = (y) => Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
    const z0 = pw.from - 1.5,
      z1 = pw.to + 1.5;
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    // Interior materials are darker than the exterior: the camera exposure is set
    // for daylight outside, the cabin is in the shade of the hull
    const std = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, envMapIntensity: 0.3, ...extra });
    const mats = {
      wall: std(0xa8a297, 0.85, { side: THREE.DoubleSide }),
      shade: std(0xc9c4b8, 0.9, { side: THREE.DoubleSide }),
      seat: std(spec.category === 'cargo' ? 0x3f474d : 0x1f365e, 0.95),
      cover: std(0xbdbab2, 0.9),
      trim: std(0x4f5660, 0.7),
      bin: std(0xb3ada2, 0.6),
      carpet: std(0x262a33, 1),
      ceiling: std(0xb9b4aa, 0.8),
    };
    const geoms = { seat: [], cover: [], trim: [], bin: [], carpet: [], ceiling: [] };
    const add = (k, g, x, y, z) => {
      g.translate(x, y, z);
      geoms[k].push(g);
    };
    const floorHalf = xAt(floorY);
    const ceilHalf = xAt(ceilY);
    add('carpet', new THREE.BoxGeometry(floorHalf * 2, 0.04, len), 0, floorY, zc);
    add('ceiling', new THREE.BoxGeometry(ceilHalf * 2, 0.04, len), 0, ceilY, zc);
    // Curved sidewalls with window openings
    const windows = [];
    for (let z = pw.from; z <= pw.to + 1e-6; z += pw.spacing) windows.push(z);
    const win = { w: pw.size * 1.1, h: pw.size * 1.45, y: pw.y };
    const thCeil = Math.acos((ceilY - cy) / R);
    const thFloor = Math.acos((floorY - cy) / R);
    const wallGeoms = [],
      shadeGeoms = [];
    for (const sx of [-1, 1]) {
      const sw = sidewall(sx, R, cy, z0, z1, thCeil, thFloor, windows, win);
      if (sw.wall) wallGeoms.push(sw.wall);
      if (sw.shade) shadeGeoms.push(sw.shade);
      // Overhead bins, inboard of the curved wall
      const binY = ceilY - 0.26;
      const binX = xAt(binY) - 0.27;
      add('bin', new THREE.BoxGeometry(0.52, 0.36, len), sx * binX, binY, zc);
      add('trim', new THREE.BoxGeometry(0.03, 0.03, len), sx * (binX - 0.27), binY - 0.18, zc);
    }
    // Seat rows (3+3 / 2+2 / 1+1)
    const cabinW = xAt(floorY + 0.6) - 0.06;
    const across = r > 1.6 ? 3 : r > 1.2 ? 2 : 1;
    const pitch = spec.category === 'cargo' ? 1.0 : r > 1 ? 0.82 : 1.1;
    const seatW = 0.47;
    for (let z = pw.from; z <= pw.to; z += pitch) {
      for (const sx of [-1, 1]) {
        for (let k = 0; k < across; k++) {
          const x = sx * (cabinW - 0.3 - k * (seatW + 0.02));
          add('seat', new THREE.BoxGeometry(seatW, 0.12, 0.45), x, floorY + 0.42, z + 0.05);
          add('seat', new THREE.BoxGeometry(seatW, 0.7, 0.1), x, floorY + 0.8, z + 0.3);
          add('cover', new THREE.BoxGeometry(seatW * 0.92, 0.2, 0.12), x, floorY + 1.18, z + 0.3);
          add('trim', new THREE.BoxGeometry(0.05, 0.05, 0.42), x - seatW / 2, floorY + 0.62, z + 0.08);
        }
      }
    }
    const addMesh = (geo, m) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    if (wallGeoms.length) addMesh(mergeGeometries(wallGeoms), mats.wall);
    if (shadeGeoms.length) addMesh(mergeGeometries(shadeGeoms), mats.shade);
    for (const [k, list] of Object.entries(geoms)) if (list.length) addMesh(mergeGeometries(list), mats[k]);
    // Cabin light strips under the bins
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    for (const sx of [-1, 1]) {
      const binY = ceilY - 0.26;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, len), this.lightMat);
      strip.position.set(sx * (xAt(binY) - 0.56), binY - 0.19, zc);
      this.group.add(strip);
    }
    // Seated passenger eye: window seat on the cabinEye side, head inboard of the
    // wall and level with the upper half of a window, slightly aft of it
    const side = Math.sign(spec.cabinEye[0]) || 1;
    const wz = pw.from + Math.round((spec.cabinEye[2] - pw.from) / pw.spacing) * pw.spacing;
    this.eye = [side * Math.max(0.3, xAt(win.y) - 0.5), win.y + Math.min(0.1, win.h * 0.25), Math.min(pw.to, Math.max(pw.from, wz)) + pw.spacing * 0.45];
    this.light = new THREE.PointLight(0xfff1d6, 0, 7, 1.2);
    this.light.position.set(0, ceilY - 0.3, this.eye[2]);
    this.group.add(this.light);
  }

  update(on, night) {
    this.light.intensity = on ? 0.8 + night * 1.6 : 0;
    this.lightMat.color.setHex(on ? 0xfff1d6 : 0x333333);
  }
}
