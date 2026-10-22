// Screen-space glowing point lights (aircraft nav/strobe lights, runway lights,
// city lights). Points keep a minimum pixel size so they stay visible at long
// range at night, are drawn additively and support logarithmic depth.

import * as THREE from 'three';

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float intensity;
  attribute float papi;
  attribute float flash;
  uniform float uScale;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uGlobal;
  uniform float uTime;
  uniform vec3 uCamPos;
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(1.0, -mvPosition.z);
    float px = size * uScale / dist;
    float a = intensity * uGlobal;
    vec3 col = color;
    // PAPI: colour depends on elevation angle of the viewer relative to the light
    if (papi > 0.0) {
      vec3 d = uCamPos - world.xyz;
      float elev = degrees(atan(d.y, length(d.xz)));
      col = elev > papi ? vec3(1.0, 0.95, 0.9) : vec3(1.0, 0.08, 0.05);
    }
    // Sequenced flashers / strobes: flash = phase offset (0..1) + 1.0
    if (flash > 0.0) {
      float ph = fract(uTime * 2.0 - (flash - 1.0));
      a *= ph < 0.08 ? 3.0 : 0.0;
    }
    gl_PointSize = clamp(px, uMinSize, uMaxSize) * (0.6 + 0.4 * clamp(a, 0.0, 1.5));
    vColor = col;
    vAlpha = clamp(a, 0.0, 2.0);
    if (a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTex;
  varying vec3 vColor;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.r * vAlpha, t.r * vAlpha);
  }
`;

export function createGlowMaterial({ scale = 300, minSize = 2, maxSize = 64 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: glowTexture() },
      uScale: { value: scale },
      uMinSize: { value: minSize },
      uMaxSize: { value: maxSize },
      uGlobal: { value: 1 },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Builds a Points object from a list of { pos:[x,y,z], color:[r,g,b], size, intensity, papi, flash }
export function createGlowPoints(lights, material) {
  const n = lights.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const inten = new Float32Array(n);
  const papi = new Float32Array(n);
  const flash = new Float32Array(n);
  lights.forEach((l, i) => {
    pos.set(l.pos, i * 3);
    col.set(l.color, i * 3);
    size[i] = l.size ?? 1;
    inten[i] = l.intensity ?? 1;
    papi[i] = l.papi ?? 0;
    flash[i] = l.flash ?? 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('intensity', new THREE.BufferAttribute(inten, 1));
  geo.setAttribute('papi', new THREE.BufferAttribute(papi, 1));
  geo.setAttribute('flash', new THREE.BufferAttribute(flash, 1));
  geo.computeBoundingSphere();
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}
