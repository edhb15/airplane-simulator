// Web Worker: builds terrain tile vertex data (positions, normals, colours, skirts).

import { terrainHeight, terrainColor, forestDensity, cityInfluence, airportInfluence, waterLevelAt } from './terrainGen.js';
import { hash2 } from './noise.js';

function build({ key, x0, z0, size, n, skirtDepth }) {
  const step = size / n;
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  const g = n + 3; // with one-sample border
  const H = new Float32Array(g * g);
  let minH = Infinity,
    maxH = -Infinity;
  for (let j = 0; j < g; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < g; i++) {
      const x = x0 + (i - 1) * step;
      const h = terrainHeight(x, z);
      H[j * g + i] = h;
      if (i > 0 && i < g - 1 && j > 0 && j < g - 1) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
  }
  const vn = (n + 1) * (n + 1);
  const skirtN = 4 * (n + 1);
  const total = vn + skirtN;
  const pos = new Float32Array(total * 3);
  const nor = new Int8Array(total * 3);
  const col = new Uint8Array(total * 3);
  const c = [0, 0, 0];
  const inv2s = 1 / (2 * step);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const gi = (j + 1) * g + (i + 1);
      const h = H[gi];
      const x = x0 + i * step;
      const z = z0 + j * step;
      const k = j * (n + 1) + i;
      pos[k * 3] = x - cx;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z - cz;
      const dhx = (H[gi + 1] - H[gi - 1]) * inv2s;
      const dhz = (H[gi + g] - H[gi - g]) * inv2s;
      const l = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      const nx = -dhx / l,
        ny = 1 / l,
        nz = -dhz / l;
      nor[k * 3] = Math.round(nx * 127);
      nor[k * 3 + 1] = Math.round(ny * 127);
      nor[k * 3 + 2] = Math.round(nz * 127);
      terrainColor(x, z, h, ny, c);
      col[k * 3] = Math.min(255, Math.round(Math.sqrt(c[0]) * 255));
      col[k * 3 + 1] = Math.min(255, Math.round(Math.sqrt(c[1]) * 255));
      col[k * 3 + 2] = Math.min(255, Math.round(Math.sqrt(c[2]) * 255));
    }
  }
  // Skirts: duplicate edge vertices pushed down
  let s = vn;
  const edge = (i, j) => {
    const k = j * (n + 1) + i;
    pos[s * 3] = pos[k * 3];
    pos[s * 3 + 1] = pos[k * 3 + 1] - skirtDepth;
    pos[s * 3 + 2] = pos[k * 3 + 2];
    nor[s * 3] = nor[k * 3];
    nor[s * 3 + 1] = nor[k * 3 + 1];
    nor[s * 3 + 2] = nor[k * 3 + 2];
    col[s * 3] = col[k * 3];
    col[s * 3 + 1] = col[k * 3 + 1];
    col[s * 3 + 2] = col[k * 3 + 2];
    s++;
  };
  for (let i = 0; i <= n; i++) edge(i, 0);
  for (let i = 0; i <= n; i++) edge(i, n);
  for (let j = 0; j <= n; j++) edge(0, j);
  for (let j = 0; j <= n; j++) edge(n, j);
  return { key, pos, nor, col, minH, maxH, cx, cz };
}

// Tree placement for a vegetation tile: returns packed [x, y, z, scale, type, tint] records.
function trees({ key, x0, z0, size, spacing, density }) {
  const n = Math.round(size / spacing);
  const g = n + 3;
  const H = new Float32Array(g * g);
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) H[j * g + i] = terrainHeight(x0 + (i - 1) * spacing, z0 + (j - 1) * spacing);
  const out = [];
  const seedX = Math.floor(x0 / spacing),
    seedZ = Math.floor(z0 / spacing);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r1 = hash2(seedX + i, seedZ + j, 11);
      const r2 = hash2(seedX + i, seedZ + j, 12);
      const r3 = hash2(seedX + i, seedZ + j, 13);
      const gi = (j + 1) * g + (i + 1);
      const h = H[gi];
      const dhx = (H[gi + 1] - H[gi - 1]) / (2 * spacing);
      const dhz = (H[gi + g] - H[gi - g]) / (2 * spacing);
      const ny = 1 / Math.sqrt(1 + dhx * dhx + dhz * dhz);
      const x = x0 + (i + r2) * spacing;
      const z = z0 + (j + r3) * spacing;
      if (h < waterLevelAt(x, z) + 1.5) continue;
      let p = forestDensity(x, z, h, ny);
      p = p * 0.95 + 0.006; // scattered lone trees
      if (r1 > p * density) continue;
      if (airportInfluence(x, z) > 0.02) continue;
      const ci = cityInfluence(x, z);
      if (ci.w > 0.25 && r1 > 0.05) continue;
      const hy = terrainHeight(x, z);
      const conifer = h > 700 ? r2 < 0.85 : r2 < 0.35;
      const scale = (conifer ? 9 : 7) + r3 * (conifer ? 14 : 9);
      out.push(x, hy - 0.3, z, scale, conifer ? 1 : 0, r1 * 2 - 1);
    }
  }
  return { key, data: new Float32Array(out) };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'trees') {
    const r = trees(msg);
    self.postMessage({ type: 'trees', key: r.key, data: r.data }, [r.data.buffer]);
  } else if (msg.type === 'tile') {
    const r = build(msg);
    self.postMessage({ type: 'tile', ...r }, [r.pos.buffer, r.nor.buffer, r.col.buffer]);
  } else if (msg.type === 'map') {
    // Low resolution coloured, hill-shaded map image (one height sample per pixel)
    const { w, h, x0, z0, size } = msg;
    const img = new Uint8ClampedArray(w * h * 4);
    const c = [0, 0, 0];
    const px = size / w;
    let prevRow = new Float32Array(w + 1);
    let curRow = new Float32Array(w + 1);
    const sample = (row, j) => {
      const z = z0 + ((j + 0.5) / h) * size;
      for (let i = 0; i <= w; i++) row[i] = terrainHeight(x0 + ((i + 0.5) / w) * size, z);
    };
    sample(prevRow, 0);
    for (let j = 0; j < h; j++) {
      sample(curRow, j + 1);
      const z = z0 + ((j + 0.5) / h) * size;
      for (let i = 0; i < w; i++) {
        const x = x0 + ((i + 0.5) / w) * size;
        const hh = prevRow[i];
        const hx = prevRow[i + 1];
        const hz = curRow[i];
        let r, g, b;
        if (hh < 0) {
          const d = Math.min(1, -hh / 80);
          r = 0.1 + 0.15 * (1 - d);
          g = 0.28 + 0.2 * (1 - d);
          b = 0.45 + 0.15 * (1 - d);
        } else {
          terrainColor(x, z, hh, 0.95, c);
          r = Math.sqrt(c[0]);
          g = Math.sqrt(c[1]);
          b = Math.sqrt(c[2]);
          const shade = Math.max(0.55, Math.min(1.35, 1 + ((hh - hx) + (hh - hz)) / px * 1.5));
          const tint = Math.min(1, hh / 3000);
          r = (r * (1 - tint * 0.4) + tint * 0.5) * shade;
          g = (g * (1 - tint * 0.4) + tint * 0.45) * shade;
          b = (b * (1 - tint * 0.4) + tint * 0.4) * shade;
        }
        const k = (j * w + i) * 4;
        img[k] = r * 255;
        img[k + 1] = g * 255;
        img[k + 2] = b * 255;
        img[k + 3] = 255;
      }
      const t = prevRow;
      prevRow = curRow;
      curRow = t;
      if (j % 32 === 0) self.postMessage({ type: 'mapProgress', id: msg.id, progress: j / h });
    }
    self.postMessage({ type: 'map', id: msg.id, w, h, img }, [img.buffer]);
  }
};
