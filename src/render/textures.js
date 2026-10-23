// Procedurally generated textures (no external assets required).

import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Tileable value noise built from a random lattice with wrap-around.
function tileableNoise(size, cells, seed) {
  const rand = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells,
        fy = (y / size) * cells;
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy);
      const tx = fx - x0,
        ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx),
        sy = ty * ty * (3 - 2 * ty);
      const a = lattice[(y0 % cells) * cells + (x0 % cells)];
      const b = lattice[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lattice[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = lattice[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbmTile(size, seed, octaves = 5, base = 4) {
  const acc = new Float32Array(size * size);
  let amp = 1,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileableNoise(size, base << o, seed + o * 31);
    for (let i = 0; i < acc.length; i++) acc[i] += n[i] * amp;
    norm += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= norm;
  return acc;
}

const cache = {};

export function detailTexture() {
  if (cache.detail) return cache.detail;
  const S = 256;
  const n = fbmTile(S, 11, 6, 4);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.max(0, Math.min(255, (n[i] - 0.5) * 2.2 * 128 + 128));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.detail = t;
  return t;
}

// Tileable normal map from a sum of periodic waves.
export function waterNormalTexture() {
  if (cache.water) return cache.water;
  const S = 256;
  const h = new Float32Array(S * S);
  const rand = mulberry32(77);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rand() - 0.5) * 18),
      ky = Math.round((rand() - 0.5) * 18);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / Math.hypot(kx, ky), p: rand() * Math.PI * 2 });
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.p);
      h[y * S + x] = v;
    }
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const nx = -dx * 0.6,
        ny = -dy * 0.6,
        nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const k = (y * S + x) * 4;
      img.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  cache.water = t;
  return t;
}

// Atlas of 4 soft cloud puff variants (2x2), white with alpha.
export function cloudPuffTexture() {
  if (cache.puff) return cache.puff;
  const S = 256;
  const c = canvas(S * 2);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S * 2, S * 2);
  for (let v = 0; v < 4; v++) {
    const n = fbmTile(S, 100 + v * 7, 5, 3);
    const ox = (v % 2) * S,
      oy = Math.floor(v / 2) * S;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / (S / 2),
          dy = (y - S / 2) / (S / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const fall = Math.exp(-r * r * 3.2) - Math.exp(-3.2);
        let a = fall * (0.55 + 0.75 * n[y * S + x]);
        a = Math.max(0, Math.min(1, (a - 0.06) * 1.35));
        const k = ((oy + y) * S * 2 + ox + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
        // Store a fake "thickness" in the green channel for shading
        img.data[k + 1] = Math.min(255, 255 * (0.4 + 0.6 * n[y * S + x]));
        img.data[k + 3] = a * 255;
      }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.puff = t;
  return t;
}

// Large tileable cloud-layer texture (overcast / stratus decks)
export function cloudLayerTexture() {
  if (cache.layer) return cache.layer;
  const S = 512;
  const n = fbmTile(S, 300, 7, 4);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = n[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, (v - 0.25) * 2.2 * 255));
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  cache.layer = t;
  return t;
}

// Building facade texture: windows grid. Returns { map, emissive }
export function facadeTextures() {
  if (cache.facade) return cache.facade;
  const W = 256,
    H = 512;
  const cm = canvas(W, H);
  const ce = canvas(W, H);
  const a = cm.getContext('2d');
  const e = ce.getContext('2d');
  const rand = mulberry32(5);
  a.fillStyle = '#9a9a96';
  a.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const cols = 8,
    rows = 32;
  for (let r = 0; r < rows; r++)
    for (let cc = 0; cc < cols; cc++) {
      const x = cc * (W / cols) + 4,
        y = r * (H / rows) + 3;
      const w = W / cols - 8,
        h = H / rows - 6;
      const g = 40 + rand() * 40;
      a.fillStyle = `rgb(${g * 0.8},${g * 0.9},${g + 20})`;
      a.fillRect(x, y, w, h);
      if (rand() < 0.42) {
        const warm = rand();
        e.fillStyle = warm < 0.7 ? `rgba(255,${200 + rand() * 40},${120 + rand() * 60},1)` : `rgba(200,220,255,1)`;
        e.fillRect(x, y, w, h);
      }
    }
  const map = new THREE.CanvasTexture(cm);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissive = new THREE.CanvasTexture(ce);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  cache.facade = { map, emissive };
  return cache.facade;
}

// Generic asphalt/concrete noise texture
export function asphaltTexture(base = '#3b3d40', seed = 3) {
  const key = 'asphalt' + base + seed;
  if (cache[key]) return cache[key];
  const S = 256;
  const n = fbmTile(S, seed, 6, 8);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  const rand = mulberry32(seed);
  for (let i = 0; i < S * S; i++) {
    const v = (n[i] - 0.5) * 40 + (rand() - 0.5) * 18;
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache[key] = t;
  return t;
}

export { canvas as makeCanvas, fbmTile };
