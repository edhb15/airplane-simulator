// Forest rendering: instanced low-poly conifers and broadleaf trees in tiles
// streamed around the camera. Placement is computed in the terrain workers.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight } from './terrainGen.js';

const TILE = 1024;

function coloured(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function treeGeometries() {
  // Unit-height trees (scaled per instance)
  const trunkC = coloured(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5).translate(0, 0.15, 0), 0x5b4532);
  const c1 = coloured(new THREE.ConeGeometry(0.26, 0.55, 7).translate(0, 0.45, 0), 0x2f4a2a);
  const c2 = coloured(new THREE.ConeGeometry(0.19, 0.45, 7).translate(0, 0.72, 0), 0x355730);
  const conifer = mergeGeometries([trunkC.toNonIndexed(), c1.toNonIndexed(), c2.toNonIndexed()]);
  const trunkD = coloured(new THREE.CylinderGeometry(0.035, 0.05, 0.45, 5).translate(0, 0.22, 0), 0x5e4a36);
  const crown = coloured(new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.85, 1).translate(0, 0.66, 0), 0x46632f);
  const crown2 = coloured(new THREE.IcosahedronGeometry(0.22, 0).translate(0.12, 0.8, 0.05), 0x52713a);
  const broad = mergeGeometries([trunkD.toNonIndexed(), crown.toNonIndexed(), crown2.toNonIndexed()]);
  conifer.computeVertexNormals();
  broad.computeVertexNormals();
  return [broad, conifer];
}

export class Vegetation {
  constructor(scene, terrain, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    scene.add(this.group);
    this.geos = treeGeometries();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    this.tiles = new Map();
    this.pending = new Set();
    this.setQuality(opts.quality || 'high');
    for (const w of terrain.workers) w.addEventListener('message', (e) => e.data.type === 'trees' && this.onTrees(e.data));
    this.nextWorker = 0;
  }

  setQuality(q) {
    const cfg = { off: [0, 1], low: [1500, 0.5], medium: [2400, 0.75], high: [3400, 1], ultra: [5000, 1.15] }[q] || [3400, 1];
    this.radius = cfg[0];
    this.density = cfg[1];
    this.spacing = 15;
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.pending.clear();
  }

  onTrees(msg) {
    this.pending.delete(msg.key);
    const t = this.tiles.get(msg.key);
    if (!t || t.mesh) return;
    const d = msg.data;
    const count = d.length / 6;
    const byType = [[], []];
    for (let i = 0; i < count; i++) byType[d[i * 6 + 4]].push(i);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    t.mesh = [];
    for (let type = 0; type < 2; type++) {
      const list = byType[type];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.geos[type], this.material, list.length);
      list.forEach((i, k) => {
        const sc = d[i * 6 + 3];
        p.set(d[i * 6] - t.cx, d[i * 6 + 1], d[i * 6 + 2] - t.cz);
        q.setFromAxisAngle(_up, d[i * 6 + 5] * 3.1);
        s.set(sc * (0.85 + 0.3 * Math.abs(d[i * 6 + 5])), sc, sc * (0.85 + 0.3 * Math.abs(d[i * 6 + 5])));
        m4.compose(p, q, s);
        im.setMatrixAt(k, m4);
        const v = d[i * 6 + 5];
        col.setRGB(0.85 + v * 0.15, 0.9 + v * 0.1, 0.8 - v * 0.1);
        im.setColorAt(k, col);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      t.group.add(im);
      t.mesh.push(im);
    }
  }

  disposeTile(t) {
    this.group.remove(t.group);
    if (t.mesh) for (const m of t.mesh) m.dispose();
  }

  update(dt, camera) {
    if (this.radius <= 0) return;
    const cp = camera.position;
    // Trees are only worth drawing when reasonably low
    const agl = cp.y - this.terrainHeightCache(cp);
    const R = agl > this.radius * 1.2 ? 0 : this.radius;
    const i0 = Math.floor((cp.x - R) / TILE),
      i1 = Math.floor((cp.x + R) / TILE);
    const j0 = Math.floor((cp.z - R) / TILE),
      j1 = Math.floor((cp.z + R) / TILE);
    const want = [];
    if (R > 0) {
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const cx = (i + 0.5) * TILE,
            cz = (j + 0.5) * TILE;
          const d = Math.hypot(cx - cp.x, cz - cp.z);
          if (d > R + TILE * 0.7) continue;
          const key = i * 100000 + j;
          if (!this.tiles.has(key)) {
            const group = new THREE.Group();
            group.position.set(cx, 0, cz);
            this.group.add(group);
            this.tiles.set(key, { key, i, j, cx, cz, group, mesh: null, requested: false, d });
          }
          const t = this.tiles.get(key);
          t.d = d;
          t.used = true;
          if (!t.requested) want.push(t);
        }
    }
    want.sort((a, b) => a.d - b.d);
    for (const t of want) {
      if (this.pending.size >= 3) break;
      t.requested = true;
      this.pending.add(t.key);
      const w = this.terrain.workers[this.nextWorker++ % this.terrain.workers.length];
      w.postMessage({ type: 'trees', key: t.key, x0: t.i * TILE, z0: t.j * TILE, size: TILE, spacing: this.spacing, density: this.density });
    }
    for (const [key, t] of this.tiles) {
      if (!t.used && Math.hypot(t.cx - cp.x, t.cz - cp.z) > R + TILE * 1.6) {
        this.disposeTile(t);
        this.tiles.delete(key);
        this.pending.delete(key);
      }
      t.used = false;
    }
  }

  terrainHeightCache(cp) {
    if (!this._hc || Math.abs(this._hc.x - cp.x) > 200 || Math.abs(this._hc.z - cp.z) > 200) {
      this._hc = { x: cp.x, z: cp.z, h: terrainHeight(cp.x, cp.z) };
    }
    return this._hc.h;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
