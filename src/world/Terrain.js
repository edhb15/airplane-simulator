// Quadtree level-of-detail terrain. Tiles are generated in Web Workers and
// cached; a node is only refined once all four children are ready so there
// are never holes. Skirts hide cracks between neighbouring LOD levels.

import * as THREE from 'three';
import { detailTexture } from '../render/textures.js';

const ROOT_SIZE = 524288; // 2^19 m
const N = 32;

function buildIndex(n) {
  const idx = [];
  const row = n + 1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * row + i,
        b = a + 1,
        c = a + row,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const base = row * row;
  // skirt strips: edge vertex k (on top) and its skirt copy
  const strip = (edgeIdx, skirtStart, flip) => {
    for (let i = 0; i < n; i++) {
      const a = edgeIdx(i),
        b = edgeIdx(i + 1),
        c = skirtStart + i,
        d = skirtStart + i + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  };
  strip((i) => i, base, true); // north edge (j = 0), faces -Z
  strip((i) => n * row + i, base + row, false); // south edge, faces +Z
  strip((j) => j * row, base + 2 * row, false); // west edge, faces -X
  strip((j) => j * row + n, base + 3 * row, true); // east edge, faces +X
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const detail = detailTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D detailMap;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= diffuseColor.rgb;
        float tDist = length(vWPos - cameraPosition);
        float d1 = texture2D(detailMap, vWPos.xz * 0.047).r;
        float d2 = texture2D(detailMap, vWPos.xz * 0.0067).r;
        float d3 = texture2D(detailMap, vWPos.xz * 0.00093).r;
        float nearFade = 1.0 - smoothstep(250.0, 2200.0, tDist);
        float detail = mix(1.0, 0.72 + 0.56 * d1, nearFade * 0.85) * (0.82 + 0.36 * d2) * (0.86 + 0.28 * d3);
        diffuseColor.rgb *= detail;`
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

export class Terrain {
  constructor(scene, opts = {}) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.minSize = opts.minSize || 256;
    this.lodFactor = opts.lodFactor || 2.3;
    this.maxCache = opts.maxCache || 1100;
    this.material = createTerrainMaterial();
    this.index = buildIndex(N);
    this.nodes = new Map();
    this.requests = new Map();
    this.inFlight = new Set();
    this.selected = [];
    this.frame = 0;
    this.meshCount = 0;
    this.workers = [];
    this.nextWorker = 0;
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(e.data);
      this.workers.push(w);
    }
    this.mapCallbacks = new Map();
    this.root = this.getNode(0, 0, 0);
  }

  setQuality(minSize, lodFactor) {
    this.minSize = minSize;
    this.lodFactor = lodFactor;
  }

  getNode(level, ix, iz) {
    const key = level * 1e12 + ix * 1e6 + iz;
    let n = this.nodes.get(key);
    if (!n) {
      const size = ROOT_SIZE / Math.pow(2, level);
      n = {
        key,
        level,
        ix,
        iz,
        size,
        x0: -ROOT_SIZE / 2 + ix * size,
        z0: -ROOT_SIZE / 2 + iz * size,
        mesh: null,
        minH: -200,
        maxH: 4200,
        state: 'none',
        lastUsed: 0,
        parent: null,
      };
      this.nodes.set(key, n);
    }
    return n;
  }

  children(n) {
    if (!n.kids) {
      const l = n.level + 1;
      n.kids = [this.getNode(l, n.ix * 2, n.iz * 2), this.getNode(l, n.ix * 2 + 1, n.iz * 2), this.getNode(l, n.ix * 2, n.iz * 2 + 1), this.getNode(l, n.ix * 2 + 1, n.iz * 2 + 1)];
      for (const k of n.kids) {
        k.parent = n;
        if (k.state === 'none') {
          k.minH = n.minH;
          k.maxH = n.maxH;
        }
      }
    }
    return n.kids;
  }

  distance(n, cam) {
    const dx = Math.max(n.x0 - cam.x, 0, cam.x - (n.x0 + n.size));
    const dz = Math.max(n.z0 - cam.z, 0, cam.z - (n.z0 + n.size));
    const dy = cam.y < n.minH ? n.minH - cam.y : cam.y > n.maxH ? cam.y - n.maxH : 0;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  request(n, priority) {
    if (n.state !== 'none') return;
    const r = this.requests.get(n.key);
    if (!r || r.priority > priority) this.requests.set(n.key, { node: n, priority });
  }

  visit(n, cam, sel) {
    n.lastUsed = this.frame;
    const d = this.distance(n, cam);
    if (n.size > this.minSize && d < n.size * this.lodFactor) {
      const kids = this.children(n);
      let ready = true;
      for (const k of kids) {
        if (k.state !== 'ready') {
          ready = false;
          this.request(k, n.level + 1 + d / n.size);
        }
      }
      if (ready) {
        for (const k of kids) this.visit(k, cam, sel);
        return;
      }
    }
    if (n.state === 'ready') sel.push(n);
    else this.request(n, n.level + d / n.size);
  }

  update(cam) {
    this.frame++;
    const sel = [];
    this.visit(this.root, cam, sel);
    for (const n of this.selected) if (n.mesh) n.mesh.visible = false;
    for (const n of sel) {
      n.mesh.visible = true;
      n.mesh.receiveShadow = n.size <= 4096;
      // keep ancestors alive in the cache
      let p = n.parent;
      while (p && p.lastUsed !== this.frame) {
        p.lastUsed = this.frame;
        p = p.parent;
      }
    }
    this.selected = sel;
    this.dispatch();
    if (this.frame % 120 === 0) this.evict();
  }

  dispatch() {
    const maxInFlight = this.workers.length * 3;
    if (this.inFlight.size >= maxInFlight || this.requests.size === 0) return;
    const list = [...this.requests.values()].sort((a, b) => a.priority - b.priority);
    for (const r of list) {
      if (this.inFlight.size >= maxInFlight) break;
      const n = r.node;
      this.requests.delete(n.key);
      if (n.state !== 'none') continue;
      n.state = 'pending';
      this.inFlight.add(n.key);
      // Keep tiles off the worker that is busy rendering the map image
      const pool = this.mapBusy && this.workers.length > 1 ? this.workers.length - 1 : this.workers.length;
      const w = this.workers[this.nextWorker++ % pool];
      w.postMessage({ type: 'tile', key: n.key, x0: n.x0, z0: n.z0, size: n.size, n: N, skirtDepth: Math.max(4, (n.size / N) * 1.2) });
    }
    // Drop stale requests that were not refreshed this frame
    this.requests.clear();
  }

  onMessage(msg) {
    if (msg.type === 'tile') {
      this.inFlight.delete(msg.key);
      const n = this.nodes.get(msg.key);
      if (!n || n.state !== 'pending') return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(msg.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(msg.nor, 3, true));
      geo.setAttribute('color', new THREE.BufferAttribute(msg.col, 3, true));
      geo.setIndex(this.index);
      const rad = Math.SQRT2 * n.size * 0.5 + (msg.maxH - msg.minH) * 0.5 + 10;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (msg.minH + msg.maxH) / 2, 0), rad);
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(-n.size / 2, msg.minH - 50, -n.size / 2), new THREE.Vector3(n.size / 2, msg.maxH, n.size / 2));
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(msg.cx, 0, msg.cz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.visible = false;
      this.group.add(mesh);
      n.mesh = mesh;
      n.minH = msg.minH;
      n.maxH = msg.maxH;
      n.state = 'ready';
      this.meshCount++;
    } else if (msg.type === 'map' || msg.type === 'mapProgress') {
      const cb = this.mapCallbacks.get(msg.id);
      if (cb) {
        if (msg.type === 'map') {
          this.mapCallbacks.delete(msg.id);
          this.mapBusy = this.mapCallbacks.size > 0;
          cb.done(msg);
        } else if (cb.progress) cb.progress(msg.progress);
      }
    }
  }

  evict() {
    if (this.meshCount <= this.maxCache) return;
    const candidates = [];
    for (const n of this.nodes.values()) if (n.state === 'ready' && n.level > 4 && n.lastUsed < this.frame - 60) candidates.push(n);
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    let toFree = this.meshCount - this.maxCache * 0.85;
    for (const n of candidates) {
      if (toFree <= 0) break;
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
      n.state = 'none';
      this.meshCount--;
      toFree--;
    }
  }

  // True when every node wanted for the current view is generated.
  get idle() {
    return this.inFlight.size === 0 && this.requests.size === 0 && this._lastWanted === 0;
  }

  // Count of nodes still wanted (call after update) — used by the loading screen.
  pendingCount(cam) {
    let wanted = 0;
    const walk = (n) => {
      const d = this.distance(n, cam);
      if (n.state !== 'ready') {
        wanted++;
        return;
      }
      if (n.size > this.minSize && d < n.size * this.lodFactor) for (const k of this.children(n)) walk(k);
    };
    walk(this.root);
    this._lastWanted = wanted;
    return wanted;
  }

  // Ask a worker to render a map image of a square region.
  renderMap(x0, z0, size, w, h, onProgress) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      this.mapCallbacks.set(id, { done: resolve, progress: onProgress });
      this.mapBusy = true;
      this.workers[this.workers.length - 1].postMessage({ type: 'map', id, x0, z0, size, w, h });
    });
  }

  dispose() {
    for (const w of this.workers) w.terminate();
  }
}

export { ROOT_SIZE };
