// Cloud rendering: cumulus fields and thunderstorm towers built from sorted,
// sun-shaded instanced billboard puffs, plus stratus / fog layers.

import * as THREE from 'three';
import { cloudPuffTexture, cloudLayerTexture } from '../render/textures.js';
import { hash2, Simplex2D } from './noise.js';

const CELL = 2400;
const MAX_PUFFS = 9000;

const puffVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData; // size, lit, shade, variant
  attribute float iAlpha;
  varying vec2 vUv;
  varying float vLit;
  varying float vShade;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    float dist = length(mvPosition.xyz);
    float size = iData.x;
    float nearFade = smoothstep(size * 0.25, size * 1.1, dist);
    float rot = iData.w * 1.7;
    vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
    mvPosition.xy += q * size;
    gl_Position = projectionMatrix * mvPosition;
    float v = floor(iData.w);
    vUv = uv * 0.5 + vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
    vLit = iData.y;
    vShade = iData.z;
    vAlpha = iAlpha * nearFade;
    if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

const puffFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uSun;
  uniform vec3 uShadow;
  uniform vec3 uAmbient;
  uniform float uFlash;
  varying vec2 vUv;
  varying float vLit;
  varying float vShade;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(uTex, vUv);
    float a = t.a * vAlpha;
    if (a < 0.004) discard;
    float light = clamp(0.28 + vShade * 0.62 + (vLit - 0.5) * 0.35 - (1.0 - t.g) * 0.18, 0.0, 1.0);
    vec3 col = mix(uShadow, uSun, light) + uAmbient * (0.2 + 0.25 * vShade) + vec3(uFlash);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`;

const layerVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vUv = w.xz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;
const layerFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec2 uOffset;
  uniform float uCover;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uIsTop;
  uniform float uFlash;
  varying vec2 vUv;
  varying vec3 vW;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv / 9000.0 + uOffset;
    vec4 a = texture2D(uTex, p);
    vec4 b = texture2D(uTex, p * 3.1 + 0.37);
    float d = a.g * 0.65 + b.g * 0.35;
    float alpha = clamp((d - (1.0 - uCover) * 0.85) * 2.4, 0.0, 1.0) * clamp(uCover * 1.6, 0.0, 1.0);
    float edge = 1.0 - smoothstep(14000.0, 30000.0, length(vW.xz - cameraPosition.xz));
    alpha *= edge;
    if (alpha < 0.01) discard;
    vec3 col = mix(uBottom, uTop, uIsTop > 0.5 ? 0.6 + 0.4 * d : 0.25 + 0.3 * d) + vec3(uFlash);
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

export class Clouds {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.radius = opts.radius || 34000;
    this.noise = new Simplex2D(909);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);
    this.iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iData.setUsage(THREE.DynamicDrawUsage);
    this.iAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iData', this.iData);
    geo.setAttribute('iAlpha', this.iAlpha);
    geo.instanceCount = 0;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTex: { value: cloudPuffTexture() },
        uSun: { value: new THREE.Color(1, 1, 1) },
        uShadow: { value: new THREE.Color(0.5, 0.55, 0.62) },
        uAmbient: { value: new THREE.Color(0.2, 0.25, 0.3) },
        uFlash: { value: 0 },
      },
    ]);
    this.uniforms.uTex.value = cloudPuffTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.puffs = []; // {x,y,z,size,lit,shade,variant,alpha}
    this.order = [];
    this.lastBuild = new THREE.Vector3(1e9, 0, 0);
    this.buildKey = '';
    this.sortTimer = 0;
    this.clouds = []; // for in-cloud test: {x,y,z,rx,ry,rz}

    // Stratus layers (bottom and top surfaces)
    this.layerUniforms = [];
    this.layers = [];
    for (let i = 0; i < 2; i++) {
      const u = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: null },
          uOffset: { value: new THREE.Vector2() },
          uCover: { value: 0 },
          uTop: { value: new THREE.Color(1, 1, 1) },
          uBottom: { value: new THREE.Color(0.5, 0.5, 0.55) },
          uIsTop: { value: i },
          uFlash: { value: 0 },
        },
      ]);
      u.uTex.value = cloudLayerTexture();
      const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: layerVertex, fragmentShader: layerFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const g = new THREE.PlaneGeometry(60000, 60000, 1, 1);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      mesh.visible = false;
      scene.add(mesh);
      this.layers.push(mesh);
      this.layerUniforms.push(u);
    }
    this.layerOffset = new THREE.Vector2();
    this.inCloud = 0;
  }

  setRadius(r) {
    this.radius = r;
    this.buildKey = '';
  }

  rebuild(cam, w, sunDir) {
    const puffs = [];
    this.clouds = [];
    const cover = w.cloudCover;
    const r = this.radius;
    const i0 = Math.floor((cam.x - r) / CELL),
      i1 = Math.floor((cam.x + r) / CELL);
    const j0 = Math.floor((cam.z - r) / CELL),
      j1 = Math.floor((cam.z + r) / CELL);
    const seed = w.seed || 1;
    if (cover > 0.01) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = (i + 0.5) * CELL,
            cz = (j + 0.5) * CELL;
          if (Math.hypot(cx - cam.x, cz - cam.z) > r + CELL) continue;
          const cluster = 0.5 + 0.5 * this.noise.noise(cx * 0.00003 + seed, cz * 0.00003);
          const h0 = hash2(i, j, seed);
          if (h0 > cover * (0.55 + cluster * 0.9)) continue;
          const h1 = hash2(i, j, seed + 1),
            h2 = hash2(i, j, seed + 2),
            h3 = hash2(i, j, seed + 3);
          const x = cx + (h1 - 0.5) * CELL * 0.7;
          const z = cz + (h2 - 0.5) * CELL * 0.7;
          const width = (500 + h3 * 1500) * (0.7 + cover * 0.8);
          const height = w.cloudDepth * (0.5 + h1 * 0.8) * (0.6 + 0.6 * Math.min(1, width / 1500));
          const base = w.cloudBase + (h2 - 0.5) * 120;
          this.clouds.push({ x, y: base + height * 0.45, z, rx: width * 0.55, ry: height * 0.6, rz: width * 0.5 });
          // Cumulus: a few rising turrets over a flat base
          const subs = 1 + Math.floor(width / 650);
          for (let sIdx = 0; sIdx < subs; sIdx++) {
            const sa = hash2(i * 7 + sIdx, j * 5 - sIdx, seed + 9);
            const sb = hash2(i * 3 - sIdx, j * 11 + sIdx, seed + 10);
            const sxo = (sa - 0.5) * width * 0.6;
            const szo = (sb - 0.5) * width * 0.5;
            const subR = (width / Math.sqrt(subs)) * (0.4 + 0.2 * sa);
            const subH = height * (0.55 + 0.45 * sb);
            const n = Math.min(26, 7 + Math.floor(subR / 45));
            for (let k = 0; k < n; k++) {
              const a = hash2(i * 97 + k + sIdx * 13, j * 31 - k, seed + 5);
              const b = hash2(i * 13 - k, j * 71 + k + sIdx * 7, seed + 6);
              const c = hash2(i + k * 7, j - k * 3 + sIdx, seed + 7);
              const ang = a * Math.PI * 2;
              const rad = Math.sqrt(b) * subR * 0.85;
              const px = sxo + Math.cos(ang) * rad;
              const pz = szo + Math.sin(ang) * rad * 0.85;
              const dome = 1 - (rad / subR) * (rad / subR);
              const py = subH * (0.12 + 0.88 * c * Math.max(0.15, dome));
              const size = subR * (0.55 + 0.35 * (1 - c * 0.5)) * (0.75 + 0.3 * dome);
              const shade = Math.min(1, py / Math.max(1, height));
              const dl = Math.hypot(px, py - subH * 0.4, pz) || 1;
              const lit = 0.5 + 0.5 * ((px * sunDir.x + (py - subH * 0.4) * sunDir.y + pz * sunDir.z) / dl);
              puffs.push({ x: x + px, y: base + Math.max(py, size * 0.28), z: z + pz, size, lit, shade, variant: Math.floor(a * 4) + c * 0.5, alpha: 0.8 });
            }
          }
        }
      }
    }
    // Thunderstorm towers
    for (const st of w.storms || []) {
      const d = Math.hypot(st.x - cam.x, st.z - cam.z);
      if (d > r * 2.2) continue;
      const top = st.top;
      const base = w.cloudBase;
      const levels = 14;
      for (let l = 0; l < levels; l++) {
        const f = l / (levels - 1);
        const y = base + f * (top - base);
        const anvil = f > 0.82 ? (f - 0.82) / 0.18 : 0;
        const rad = st.r * (0.75 + 0.25 * Math.sin(f * 3)) + anvil * st.r * 2.2;
        const count = 6 + Math.floor(anvil * 14);
        for (let k = 0; k < count; k++) {
          const ang = hash2(l, k, 77) * Math.PI * 2;
          const rr = rad * Math.sqrt(hash2(k, l, 78));
          const px = Math.cos(ang) * rr,
            pz = Math.sin(ang) * rr;
          const size = st.r * (0.8 + hash2(k, l, 79) * 0.6) * (anvil ? 0.8 : 1);
          const dl = Math.hypot(px, pz) || 1;
          const lit = 0.35 + 0.45 * (((px / dl) * sunDir.x + (pz / dl) * sunDir.z) * 0.5 + f * 0.6);
          puffs.push({ x: st.x + px, y, z: st.z + pz, size, lit: Math.min(1, lit), shade: f * 0.8, variant: (k + l) % 4, alpha: 0.95 });
        }
      }
      this.clouds.push({ x: st.x, y: (base + top) / 2, z: st.z, rx: st.r, ry: (top - base) / 2, rz: st.r });
    }
    if (puffs.length > MAX_PUFFS) puffs.length = MAX_PUFFS;
    this.puffs = puffs;
    this.order = puffs.map((_, i) => i);
    this.sort(cam);
  }

  sort(cam) {
    const p = this.puffs;
    const d = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) {
      const dx = p[i].x - cam.x,
        dy = p[i].y - cam.y,
        dz = p[i].z - cam.z;
      d[i] = dx * dx + dy * dy + dz * dz;
    }
    this.order.sort((a, b) => d[b] - d[a]);
    const P = this.iPos.array,
      D = this.iData.array,
      A = this.iAlpha.array;
    for (let k = 0; k < this.order.length; k++) {
      const q = p[this.order[k]];
      P[k * 3] = q.x;
      P[k * 3 + 1] = q.y;
      P[k * 3 + 2] = q.z;
      D[k * 4] = q.size;
      D[k * 4 + 1] = q.lit;
      D[k * 4 + 2] = q.shade;
      D[k * 4 + 3] = q.variant;
      A[k] = q.alpha;
    }
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
    this.iAlpha.needsUpdate = true;
    this.mesh.geometry.instanceCount = p.length;
  }

  // Returns how deep the camera is inside a cloud (0..1)
  cloudDensityAt(p, w) {
    let d = 0;
    for (const c of this.clouds) {
      const dx = (p.x - c.x) / c.rx,
        dy = (p.y - c.y) / c.ry,
        dz = (p.z - c.z) / c.rz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < 1) d = Math.max(d, 1 - r2);
    }
    if (w.layer > 0.3 && p.y > w.layerBase && p.y < w.layerTop) {
      const mid = (w.layerBase + w.layerTop) / 2,
        half = (w.layerTop - w.layerBase) / 2;
      d = Math.max(d, Math.min(1, (1 - Math.abs(p.y - mid) / half) * 3) * w.layer);
    }
    return d;
  }

  update(dt, camera, sky, weather, flash) {
    const w = weather.state;
    const cam = camera.position;
    const sunDir = sky.sunDir;
    const key = `${w.cloudCover.toFixed(2)}|${Math.round(w.cloudBase / 50)}|${Math.round(w.cloudDepth / 50)}|${w.seed}|${(w.storms || []).length}|${Math.round(sky.sunElevation / 3)}`;
    if (key !== this.buildKey || Math.hypot(cam.x - this.lastBuild.x, cam.z - this.lastBuild.z) > 2500) {
      this.buildKey = key;
      this.lastBuild.copy(cam);
      this.rebuild(cam, w, sunDir);
    } else {
      this.sortTimer -= dt;
      if (this.sortTimer <= 0) {
        this.sortTimer = 0.4;
        this.sort(cam);
      }
    }
    // Colours from the sky
    const u = this.uniforms;
    const sc = sky.uniforms.uSunColor.value;
    const day = Math.max(0, Math.min(1, (sky.sunElevation + 4) / 14));
    const zen = sky.uniforms.uZenith.value;
    const hor = sky.uniforms.uHorizon.value;
    const storm = w.lightning > 0.3 ? 0.55 : 1;
    const oc = 1 - 0.45 * w.overcast;
    u.uSun.value.setRGB(0.25 + sc.r * 0.9 * day, 0.25 + sc.g * 0.9 * day, 0.27 + sc.b * 0.85 * day).multiplyScalar(oc * storm * Math.max(0.06, day));
    const grey = 0.52 * day + 0.03;
    u.uShadow.value.setRGB(grey * 0.95 + hor.r * 0.12, grey * 0.97 + hor.g * 0.12, grey + hor.b * 0.14).multiplyScalar(storm);
    u.uAmbient.value.setRGB(zen.r * 0.35, zen.g * 0.35, zen.b * 0.38);
    u.uFlash.value = flash;

    // Layers
    const wr = ((w.windDir + 180) * Math.PI) / 180;
    this.layerOffset.x += (Math.sin(wr) * w.windSpeed * dt) / 9000;
    this.layerOffset.y += (-Math.cos(wr) * w.windSpeed * dt) / 9000;
    const show = w.layer > 0.02;
    const heights = [w.layerBase, w.layerTop];
    for (let i = 0; i < 2; i++) {
      const m = this.layers[i];
      m.visible = show;
      m.position.set(Math.round(cam.x / 500) * 500, heights[i], Math.round(cam.z / 500) * 500);
      const lu = this.layerUniforms[i];
      lu.uCover.value = w.layer * (i === 1 ? 1 : 0.95);
      lu.uOffset.value.copy(this.layerOffset);
      lu.uTop.value.setRGB(0.3 + sc.r * 0.75 * day, 0.3 + sc.g * 0.75 * day, 0.32 + sc.b * 0.72 * day).multiplyScalar(Math.max(0.05, day));
      lu.uBottom.value.setRGB(hor.r * 0.7, hor.g * 0.72, hor.b * 0.78).multiplyScalar((w.precipitation > 0.5 ? 0.6 : 0.85) * storm);
      lu.uIsTop.value = cam.y > heights[i] ? 1 : 0;
      lu.uFlash.value = flash;
    }
    this.inCloud = this.cloudDensityAt(cam, w);
  }
}
