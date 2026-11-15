// Procedural cities: street grids with skyscraper cores, mid-rise districts and
// suburbs. Buildings are instanced boxes with a world-space window facade that
// lights up at night, street lights are glow points. Provides collision and
// ray queries, and lets buildings be hidden when they are destroyed.

import * as THREE from 'three';
import { CITIES } from './worldData.js';
import { terrainHeight, cityInfluence, airportInfluence, waterLevelAt } from './terrainGen.js';
import { mulberry32 } from './noise.js';
import { facadeTextures } from '../render/textures.js';
import { createGlowMaterial, createGlowPoints } from '../render/GlowPoints.js';
import { ALL_RUNWAYS, runwayRelative } from './airportGeometry.js';

const TILE = 1600;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function nearRunway(x, z, margin) {
  for (const r of ALL_RUNWAYS) {
    const rel = runwayRelative(r.ends[0], x, z);
    if (rel.along > -margin * 3 && rel.along < r.length + margin * 3 && Math.abs(rel.lateral) < margin) return true;
  }
  return false;
}

function createFacadeMaterial() {
  const { map, emissive } = facadeTextures();
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.55, metalness: 0.2 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFUv;\nvarying float vRoof;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          mat4 im = modelMatrix * instanceMatrix;
          vec4 wp = im * vec4(position, 1.0);
          vec3 wn = normalize(mat3(im) * normal);
          vec3 base = (im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vRoof = step(0.6, wn.y);
          float horiz = dot(wp.xz, vec2(-wn.z, wn.x));
          float rnd = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
          vFUv = vec2(horiz / 32.0 + rnd * 7.0, (wp.y - base.y) / 112.0 + floor(rnd * 4.0) * 0.25);
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFUv;\nvarying float vRoof;')
      .replace(
        '#include <map_fragment>',
        `vec4 fcol = texture2D(map, vFUv);
         fcol.rgb = mix(fcol.rgb, vec3(0.42, 0.42, 0.43), vRoof);
         diffuseColor *= fcol;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `vec4 emc = texture2D(emissiveMap, vFUv);
         totalEmissiveRadiance *= emc.rgb * (1.0 - vRoof);`
      );
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return mat;
}

export class Cities {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.density = opts.density ?? 1;
    this.group = new THREE.Group();
    this.group.name = 'cities';
    scene.add(this.group);
    this.material = createFacadeMaterial();
    this.glowMat = createGlowMaterial({ scale: 300, minSize: 1.2, maxSize: 18 });
    this.tiles = [];
    this.grid = new Map(); // collision hash 100m -> boxes
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.box.translate(0, 0.5, 0);
    this.buildingCount = 0;
    for (const c of CITIES) this.buildCity(c);
    this.buildLandmarks();
  }

  buildCity(city) {
    const r = mulberry32(hashStr(city.name));
    const angle = r() * Math.PI * 0.5;
    const ca = Math.cos(angle),
      sa = Math.sin(angle);
    const block = city.core > 1000 ? 120 : 90;
    const street = city.core > 1000 ? 26 : 18;
    const R = city.r * 1.05;
    const n = Math.ceil(R / block);
    const buildings = [];
    const lights = [];
    const dens = this.density;
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const lx = i * block,
          lz = j * block;
        const x = city.x + lx * ca - lz * sa;
        const z = city.z + lx * sa + lz * ca;
        const d = Math.hypot(x - city.x, z - city.z);
        if (d > R) continue;
        const ci = cityInfluence(x, z);
        if (ci.w < 0.12) continue;
        const h0 = terrainHeight(x, z);
        if (h0 < waterLevelAt(x, z) + 1.5) continue;
        if (airportInfluence(x, z) > 0.02 || nearRunway(x, z, 400)) continue;
        // Street light at block corner
        if (r() < 0.8) lights.push({ pos: [x - (block / 2) * ca + (block / 2) * sa, h0 + 7, z - (block / 2) * sa - (block / 2) * ca], color: r() < 0.7 ? [1, 0.68, 0.32] : [0.9, 0.95, 1], size: 2.0, intensity: 1 });
        const core = d < city.core;
        const mid = d < city.r * 0.5;
        const pBlock = core ? 0.95 : mid ? 0.85 : 0.62 * ci.w + 0.15;
        if (r() > pBlock * Math.min(1.3, dens)) continue;
        const inner = block - street;
        let count, minF, maxF, minH, maxH;
        if (core) {
          count = r() < 0.5 ? 1 : 2;
          minF = 26;
          maxF = 52;
          const k = 1 - (d / city.core) * 0.55;
          minH = 30 * k;
          maxH = city.maxHeight * k;
        } else if (mid) {
          count = 2 + Math.floor(r() * 3);
          minF = 16;
          maxF = 32;
          minH = 10;
          maxH = Math.max(18, city.maxHeight * 0.3);
        } else {
          count = 3 + Math.floor(r() * 5 * dens);
          minF = 9;
          maxF = 15;
          minH = 5;
          maxH = 9;
        }
        const sub = Math.ceil(Math.sqrt(count));
        const cell = inner / sub;
        for (let k = 0; k < count; k++) {
          const ox = -inner / 2 + cell * (k % sub) + cell / 2 + (r() - 0.5) * cell * 0.2;
          const oz = -inner / 2 + cell * Math.floor(k / sub) + cell / 2 + (r() - 0.5) * cell * 0.2;
          const fw = Math.min(cell * 0.92, minF + r() * (maxF - minF));
          const fd = Math.min(cell * 0.92, minF + r() * (maxF - minF));
          let hgt = minH + Math.pow(r(), core ? 1.6 : 1.2) * (maxH - minH);
          const bx = x + ox * ca - oz * sa;
          const bz = z + ox * sa + oz * ca;
          const by = terrainHeight(bx, bz);
          if (by < waterLevelAt(bx, bz) + 1) continue;
          const tint = core ? [0.55 + r() * 0.35, 0.6 + r() * 0.3, 0.68 + r() * 0.3] : mid ? [0.75 + r() * 0.25, 0.7 + r() * 0.25, 0.62 + r() * 0.25] : [0.85 + r() * 0.15, 0.78 + r() * 0.15, 0.66 + r() * 0.2];
          buildings.push({ x: bx, y: by - 2, z: bz, w: fw, d: fd, h: hgt + 2, rot: angle, tint });
        }
      }
    }
    this.addBuildings(buildings, lights);
  }

  addBuildings(buildings, lights) {
    // Split into tiles for culling
    const tiles = new Map();
    for (const b of buildings) {
      const key = `${Math.floor(b.x / TILE)}:${Math.floor(b.z / TILE)}`;
      if (!tiles.has(key)) tiles.set(key, { buildings: [], lights: [] });
      tiles.get(key).buildings.push(b);
      this.addCollider(b);
    }
    for (const l of lights) {
      const key = `${Math.floor(l.pos[0] / TILE)}:${Math.floor(l.pos[2] / TILE)}`;
      if (!tiles.has(key)) tiles.set(key, { buildings: [], lights: [] });
      tiles.get(key).lights.push(l);
    }
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const [key, t] of tiles) {
      const [tx, tz] = key.split(':').map(Number);
      const cx = (tx + 0.5) * TILE,
        cz = (tz + 0.5) * TILE;
      const group = new THREE.Group();
      group.position.set(cx, 0, cz);
      if (t.buildings.length) {
        const im = new THREE.InstancedMesh(this.box, this.material, t.buildings.length);
        let maxH = 0;
        t.buildings.forEach((b, i) => {
          b.mesh = im;
          b.index = i;
          b.tx = cx;
          b.tz = cz;
          this.buildingMatrix(b, m4);
          im.setMatrixAt(i, m4);
          im.setColorAt(i, col.setRGB(b.tint[0], b.tint[1], b.tint[2]));
          maxH = Math.max(maxH, b.y + b.h);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
        this.buildingCount += t.buildings.length;
      }
      if (t.lights.length) {
        const pts = createGlowPoints(
          t.lights.map((l) => ({ ...l, pos: [l.pos[0] - cx, l.pos[1], l.pos[2] - cz] })),
          this.glowMat
        );
        group.add(pts);
      }
      this.group.add(group);
      this.tiles.push({ group, cx, cz });
    }
  }

  // Instance matrix of a building inside its tile group
  buildingMatrix(b, out) {
    _q.setFromAxisAngle(_up, -b.rot);
    _p.set(b.x - b.tx, b.y, b.z - b.tz);
    _s.set(b.w, b.h, b.d);
    return out.compose(_p, _q, _s);
  }

  // Destroyed buildings: hide the instance and stop colliding with it
  hideBuilding(b) {
    if (!b.mesh || b.destroyed) return;
    b.destroyed = true;
    b.mesh.setMatrixAt(b.index, _m4.makeScale(0, 0, 0));
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  showBuilding(b) {
    if (!b.mesh) return;
    b.destroyed = false;
    b.mesh.setMatrixAt(b.index, this.buildingMatrix(b, _m4));
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  // Buildings whose collision cells touch the box around (x, z) +- r
  *candidates(x0, z0, x1, z1) {
    const k0 = Math.floor(Math.min(x0, x1) / 100),
      k1 = Math.floor(Math.max(x0, x1) / 100);
    const l0 = Math.floor(Math.min(z0, z1) / 100),
      l1 = Math.floor(Math.max(z0, z1) / 100);
    if ((k1 - k0 + 1) * (l1 - l0 + 1) > 400) return;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let i = k0; i <= k1; i++)
      for (let j = l0; j <= l1; j++) {
        const list = this.grid.get(i * 100000 + j);
        if (!list) continue;
        for (const b of list) {
          if (b.destroyed || seen.has(b)) continue;
          seen.add(b);
          yield b;
        }
      }
  }

  // First building hit by the segment a -> b, or null. Returns
  // { building, t (0..1 along the segment), point }.
  raycast(ax, ay, az, bx, by, bz, out = {}) {
    if (Math.min(ay, by) > this.maxTop) return null;
    let best = null,
      bestT = 2;
    for (const bd of this.candidates(ax, az, bx, bz)) {
      if (Math.min(ay, by) > bd.y + bd.h) continue;
      // Slab test in the building's local frame (x along width, z along depth)
      const c = Math.cos(bd.rot),
        s = Math.sin(bd.rot);
      const ox = ax - bd.x,
        oz = az - bd.z;
      const dx = bx - ax,
        dy = by - ay,
        dz = bz - az;
      const lox = ox * c + oz * s,
        loz = -ox * s + oz * c;
      const ldx = dx * c + dz * s,
        ldz = -dx * s + dz * c;
      let t0 = 0,
        t1 = 1;
      const slab = (o, d, lo, hi) => {
        if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
        let ta = (lo - o) / d,
          tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        return t0 <= t1;
      };
      if (!slab(lox, ldx, -bd.w / 2, bd.w / 2)) continue;
      if (!slab(loz, ldz, -bd.d / 2, bd.d / 2)) continue;
      if (!slab(ay, dy, bd.y, bd.y + bd.h)) continue;
      if (t0 < bestT) {
        bestT = t0;
        best = bd;
      }
    }
    if (!best) return null;
    out.building = best;
    out.t = bestT;
    out.point = (out.point || new THREE.Vector3()).set(ax + (bx - ax) * bestT, ay + (by - ay) * bestT, az + (bz - az) * bestT);
    return out;
  }

  // Distance from a point to the outside of a building (0 when inside)
  distanceTo(bd, p) {
    const c = Math.cos(bd.rot),
      s = Math.sin(bd.rot);
    const dx = p.x - bd.x,
      dz = p.z - bd.z;
    const lx = Math.max(0, Math.abs(dx * c + dz * s) - bd.w / 2);
    const lz = Math.max(0, Math.abs(-dx * s + dz * c) - bd.d / 2);
    const ly = p.y < bd.y ? bd.y - p.y : p.y > bd.y + bd.h ? p.y - bd.y - bd.h : 0;
    return Math.hypot(lx, ly, lz);
  }

  // Standing buildings within r metres of p: [{ building, dist }]
  buildingsNear(p, r) {
    const out = [];
    for (const bd of this.candidates(p.x - r - 60, p.z - r - 60, p.x + r + 60, p.z + r + 60)) {
      const d = this.distanceTo(bd, p);
      if (d <= r) out.push({ building: bd, dist: d });
    }
    return out;
  }

  addCollider(b) {
    this.maxTop = Math.max(this.maxTop || 0, b.y + b.h);
    const r = Math.hypot(b.w, b.d) / 2;
    const k0 = Math.floor((b.x - r) / 100),
      k1 = Math.floor((b.x + r) / 100);
    const l0 = Math.floor((b.z - r) / 100),
      l1 = Math.floor((b.z + r) / 100);
    for (let i = k0; i <= k1; i++)
      for (let j = l0; j <= l1; j++) {
        const key = i * 100000 + j;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(b);
      }
  }

  // Returns the building hit by a sphere at p (radius r) or null
  collide(p, r = 2) {
    const key = Math.floor(p.x / 100) * 100000 + Math.floor(p.z / 100);
    const list = this.grid.get(key);
    if (!list) return null;
    for (const b of list) {
      if (b.destroyed || p.y > b.y + b.h + r) continue;
      const dx = p.x - b.x,
        dz = p.z - b.z;
      const c = Math.cos(b.rot),
        s = Math.sin(b.rot);
      const lx = dx * c + dz * s,
        lz = -dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + r && Math.abs(lz) < b.d / 2 + r) return b;
    }
    return null;
  }

  buildLandmarks() {
    // Meridian Tower: a 310 m observation/TV tower in Port Meridian, and a stadium
    const pm = CITIES[0];
    const tx = pm.x + 600,
      tz = pm.z - 900;
    const ty = terrainHeight(tx, tz);
    const g = new THREE.Group();
    g.position.set(tx, ty, tz);
    const conc = new THREE.MeshStandardMaterial({ color: 0xd7d7d2, roughness: 0.7 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 9, 240, 16), conc);
    shaft.position.y = 120;
    g.add(shaft);
    const pod = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshStandardMaterial({ color: 0x8fb3d9, roughness: 0.2, metalness: 0.7 }));
    pod.position.y = 215;
    pod.scale.y = 0.7;
    g.add(pod);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, 75, 8), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }));
    ant.position.y = 277;
    g.add(ant);
    shaft.castShadow = pod.castShadow = true;
    const obstr = createGlowPoints(
      [
        { pos: [0, 316, 0], color: [1, 0.1, 0.05], size: 4, flash: 1.0, intensity: 1 },
        { pos: [0, 230, 0], color: [1, 0.1, 0.05], size: 3, intensity: 1 },
      ],
      this.glowMat
    );
    g.add(obstr);
    this.group.add(g);
    this.addCollider({ x: tx, y: ty, z: tz, w: 20, d: 20, h: 315, rot: 0 });
    // Stadium
    const sx = pm.x - 2600,
      sz = pm.z + 400;
    const sy = terrainHeight(sx, sz);
    const st = new THREE.Mesh(new THREE.TorusGeometry(110, 28, 8, 40), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
    st.rotation.x = -Math.PI / 2;
    st.scale.set(1.3, 1, 0.55);
    st.position.set(sx, sy + 12, sz);
    st.castShadow = true;
    this.group.add(st);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(sx, sy + 0.6, sz);
    this.group.add(pitch);
    this.addCollider({ x: sx, y: sy, z: sz, w: 340, d: 220, h: 28, rot: 0 });
  }

  update(dt, camera, world) {
    const night = world.night;
    this.material.emissiveIntensity = 1.1 * night;
    this.glowMat.uniforms.uGlobal.value = night * 1.2;
    this.glowMat.uniforms.uTime.value += dt;
    const cp = camera.position;
    const maxD = 26000 + Math.max(0, cp.y) * 3;
    for (const t of this.tiles) t.group.visible = Math.hypot(t.cx - cp.x, t.cz - cp.z) < maxD;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
