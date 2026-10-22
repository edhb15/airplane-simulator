// Passenger cabin interior seen from the cabin camera: seat rows, overhead
// bins, ceiling and side walls with real window openings aligned to the
// exterior livery windows (so you can look out at the wing and engines).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function hasCabin(spec) {
  return !!(spec.model.paxWindows && spec.category !== 'fighter');
}

export class CabinInterior {
  constructor(spec) {
    this.group = new THREE.Group();
    this.group.name = 'cabin';
    const f = spec.model.fuselage;
    const pw = spec.model.paxWindows;
    const r = f.radius || 1;
    const cabinW = r * 0.92;
    const floorY = f.centerY - r * 0.45;
    const ceilY = f.centerY + r * 0.78;
    const z0 = pw.from - 1.5,
      z1 = pw.to + 1.5;
    const len = z1 - z0;
    const wall = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.85 });
    const seatMat = new THREE.MeshStandardMaterial({ color: spec.category === 'cargo' ? 0x50595f : 0x2c4a7a, roughness: 0.95 });
    const binMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6 });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 1 });
    const geoms = { wall: [], seat: [], bin: [], carpet: [] };
    const add = (k, g, x, y, z) => {
      g.translate(x, y, z);
      geoms[k].push(g);
    };
    add('carpet', new THREE.BoxGeometry(cabinW * 2, 0.04, len), 0, floorY, (z0 + z1) / 2);
    add('wall', new THREE.BoxGeometry(cabinW * 2, 0.04, len), 0, ceilY, (z0 + z1) / 2);
    // Side walls with window holes
    const winY = pw.y;
    const wh = pw.size * 1.5,
      ww = pw.size * 1.1;
    for (const sx of [-1, 1]) {
      const x = sx * cabinW;
      let z = pw.from;
      // below and above window band along the whole cabin
      add('wall', new THREE.BoxGeometry(0.04, winY - wh / 2 - floorY, len), x, (floorY + winY - wh / 2) / 2, (z0 + z1) / 2);
      add('wall', new THREE.BoxGeometry(0.04, ceilY - (winY + wh / 2), len), x, (ceilY + winY + wh / 2) / 2, (z0 + z1) / 2);
      // posts between windows
      for (z = pw.from - pw.spacing / 2; z <= pw.to + pw.spacing / 2; z += pw.spacing) {
        add('wall', new THREE.BoxGeometry(0.06, wh, pw.spacing - ww), x, winY, z);
      }
      // window bezels
      for (z = pw.from; z <= pw.to; z += pw.spacing) {
        add('bin', new THREE.BoxGeometry(0.08, wh + 0.04, 0.03), x - sx * 0.02, winY, z - ww / 2 - 0.015);
        add('bin', new THREE.BoxGeometry(0.08, wh + 0.04, 0.03), x - sx * 0.02, winY, z + ww / 2 + 0.015);
      }
      // overhead bins
      add('bin', new THREE.BoxGeometry(0.45, 0.32, len), x - sx * 0.24, ceilY - 0.25, (z0 + z1) / 2);
    }
    // Seat rows (3+3 / 2+2 / 1+1)
    const across = r > 2.5 ? 3 : r > 1.6 ? 3 : r > 1.2 ? 2 : 1;
    const pitch = spec.category === 'cargo' ? 1.0 : r > 1 ? 0.82 : 1.1;
    const seatW = 0.47;
    for (let z = pw.from; z <= pw.to; z += pitch) {
      for (const sx of [-1, 1]) {
        for (let k = 0; k < across; k++) {
          const x = sx * (cabinW - 0.32 - k * (seatW + 0.02));
          add('seat', new THREE.BoxGeometry(seatW, 0.12, 0.45), x, floorY + 0.42, z + 0.05);
          add('seat', new THREE.BoxGeometry(seatW, 0.7, 0.1), x, floorY + 0.8, z + 0.3);
          add('seat', new THREE.BoxGeometry(seatW * 0.6, 0.18, 0.12), x, floorY + 1.22, z + 0.3);
        }
      }
    }
    for (const [k, list] of Object.entries(geoms)) {
      if (!list.length) continue;
      const m = new THREE.Mesh(mergeGeometries(list), k === 'wall' ? wall : k === 'seat' ? seatMat : k === 'bin' ? binMat : carpet);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // Cabin lights (strips)
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, len), this.lightMat);
      strip.position.set(sx * (cabinW - 0.5), ceilY - 0.42, (z0 + z1) / 2);
      this.group.add(strip);
    }
    this.light = new THREE.PointLight(0xfff1d6, 0, 6, 1.2);
    this.light.position.set(0, ceilY - 0.3, spec.cabinEye[2]);
    this.group.add(this.light);
  }

  update(on, night) {
    this.light.intensity = on ? 0.8 + night * 1.2 : 0;
    this.lightMat.color.setHex(on ? 0xfff1d6 : 0x333333);
  }
}
