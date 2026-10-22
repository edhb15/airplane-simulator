// Sky dome, sun and moon, stars, day/night lighting, fog colour and
// environment (reflection) map.

import * as THREE from 'three';
import { WORLD } from './worldData.js';

const DEG = Math.PI / 180;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunColor;
  uniform vec3 uGround;
  uniform float uSunVisible;
  uniform float uMoonVisible;
  uniform float uGroundMode;
  uniform float uHaze;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = dot(d, uSunDir);
    float hp = max(h, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(hp, 0.42));
    // Horizon haze band
    col = mix(col, uHorizon * 1.05, uHaze * (1.0 - smoothstep(0.0, 0.18, hp)));
    // Glow around the sun (stronger near horizon at sunrise/sunset)
    float g = pow(max(sd, 0.0), 5.0);
    col += uGlow * g * (1.0 - smoothstep(0.0, 0.6, hp)) * 1.4;
    col += uGlow * pow(max(sd, 0.0), 60.0) * 0.6;
    // Sun disc and halo
    float disc = smoothstep(0.99955, 0.99975, sd);
    col += uSunColor * (disc * 40.0 + pow(max(sd, 0.0), 1200.0) * 3.0) * uSunVisible;
    // Moon
    float md = dot(d, uMoonDir);
    float moon = smoothstep(0.99965, 0.9998, md);
    col += vec3(0.9, 0.92, 1.0) * (moon * 1.6 + pow(max(md, 0.0), 2000.0) * 0.4) * uMoonVisible;
    // Below the horizon
    if (h < 0.0) {
      vec3 below = mix(uHorizon, uGround, uGroundMode > 0.5 ? smoothstep(0.0, 0.08, -h) : smoothstep(0.0, 0.5, -h) * 0.3);
      col = mix(col, below, smoothstep(0.0, 0.015, -h));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aTwinkle;
  uniform float uTime;
  uniform float uVisible;
  varying float vAlpha;
  void main() {
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + aTwinkle * 3.0) + aTwinkle * 40.0);
    vAlpha = uVisible * tw * smoothstep(-0.05, 0.12, normalize(position).y);
    gl_PointSize = aSize;
  }
`;
const starFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c)) * vAlpha;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

function lerpColor(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

// Key frames by sun elevation (degrees): [elev, zenith, horizon, glow, sunColor]
const KEYS = [
  [-18, [0.003, 0.005, 0.014], [0.008, 0.012, 0.026], [0.0, 0.0, 0.0], [0, 0, 0]],
  [-10, [0.008, 0.014, 0.04], [0.04, 0.05, 0.09], [0.06, 0.03, 0.04], [0, 0, 0]],
  [-4, [0.03, 0.06, 0.16], [0.28, 0.2, 0.25], [0.5, 0.18, 0.08], [0.9, 0.3, 0.1]],
  [0, [0.07, 0.15, 0.36], [0.75, 0.48, 0.34], [1.0, 0.42, 0.12], [1.0, 0.45, 0.15]],
  [5, [0.1, 0.24, 0.55], [0.85, 0.66, 0.5], [0.9, 0.5, 0.2], [1.0, 0.68, 0.38]],
  [15, [0.12, 0.3, 0.66], [0.66, 0.75, 0.86], [0.35, 0.3, 0.2], [1.0, 0.88, 0.72]],
  [35, [0.1, 0.28, 0.66], [0.6, 0.74, 0.9], [0.15, 0.15, 0.12], [1.0, 0.96, 0.9]],
  [90, [0.08, 0.25, 0.62], [0.56, 0.72, 0.9], [0.1, 0.1, 0.1], [1.0, 0.98, 0.95]],
];

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uGround: { value: new THREE.Color(0.08, 0.09, 0.07) },
      uSunVisible: { value: 1 },
      uMoonVisible: { value: 0 },
      uGroundMode: { value: 0 },
      uHaze: { value: 0.3 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // Stars
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th);
      pos[i * 3 + 1] = u;
      pos[i * 3 + 2] = r * Math.sin(th);
      size[i] = Math.random() < 0.04 ? 2.6 + Math.random() * 1.5 : 1.0 + Math.random() * 1.3;
      tw[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aTwinkle', new THREE.BufferAttribute(tw, 1));
    this.starUniforms = { uTime: { value: 0 }, uVisible: { value: 0 } };
    this.stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({ uniforms: this.starUniforms, vertexShader: starVertex, fragmentShader: starFragment, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    scene.add(this.stars);

    // Lights
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.05;
    const sc = this.sunLight.shadow.camera;
    sc.left = -90;
    sc.right = 90;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 1;
    sc.far = 2000;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5243, 0.8);
    scene.add(this.hemi);

    // Environment map generation
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material.clone());
    this.envDome.material.uniforms = this.uniforms;
    this.envScene.add(this.envDome);
    this.envRT = null;
    this.lastEnvKey = '';

    this.timeOfDay = 12;
    this.dayOfYear = 172;
    this.sunElevation = 60;
    this.night = 0;
    this.fogColor = new THREE.Color();
    this.ambientColor = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this._c = [0, 0, 0];
    this._d = [0, 0, 0];
    this.cloudCover = 0;
    this.overcast = 0;
    this.envTimer = 0;
  }

  // Sun position from local solar time (hours) at the world latitude.
  computeSun(hours) {
    const lat = WORLD.originLat * DEG;
    const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + this.dayOfYear)) / 365);
    const H = (hours - 12) * 15 * DEG;
    const elev = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
    return { elev, az };
  }

  static dirFrom(elev, az, out) {
    return out.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), -Math.cos(elev) * Math.cos(az));
  }

  // weather: { cloudCover 0..1, overcast 0..1, precipitation 0..1, visibility m }
  update(dt, hours, weather, camera, focus) {
    this.timeOfDay = hours;
    const s = this.computeSun(hours);
    SkySystem.dirFrom(s.elev, s.az, this.sunDir);
    const m = this.computeSun((hours + 12.4) % 24);
    SkySystem.dirFrom(m.elev * 0.9 + 0.1, m.az + 0.3, this.moonDir);
    const elevDeg = s.elev / DEG;
    this.sunElevation = elevDeg;

    // Interpolate colour keys
    let i = 0;
    while (i < KEYS.length - 2 && elevDeg > KEYS[i + 1][0]) i++;
    const k0 = KEYS[i],
      k1 = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (elevDeg - k0[0]) / (k1[0] - k0[0])));
    const zen = lerpColor([0, 0, 0], k0[1], k1[1], t);
    const hor = lerpColor([0, 0, 0], k0[2], k1[2], t);
    const glow = lerpColor([0, 0, 0], k0[3], k1[3], t);
    const sunC = lerpColor([0, 0, 0], k0[4], k1[4], t);

    // Overcast: desaturate & darken
    const oc = weather.overcast || 0;
    this.overcast = oc;
    const dayLum = Math.max(0, Math.min(1, (elevDeg + 6) / 20));
    const grey = (0.42 + 0.2 * dayLum) * dayLum + 0.01;
    for (const c of [zen, hor]) {
      const l = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
      const target = grey * (c === zen ? 0.9 : 1.0) * (1 - 0.35 * (weather.precipitation || 0));
      c[0] = c[0] + (Math.max(l, target) * 0.95 - c[0]) * oc;
      c[1] = c[1] + (Math.max(l, target) * 0.97 - c[1]) * oc;
      c[2] = c[2] + (Math.max(l, target) * 1.0 - c[2]) * oc;
    }
    glow[0] *= 1 - oc * 0.85;
    glow[1] *= 1 - oc * 0.85;
    glow[2] *= 1 - oc * 0.85;

    const u = this.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uZenith.value.setRGB(zen[0], zen[1], zen[2]);
    u.uHorizon.value.setRGB(hor[0], hor[1], hor[2]);
    u.uGlow.value.setRGB(glow[0], glow[1], glow[2]);
    u.uSunColor.value.setRGB(sunC[0], sunC[1], sunC[2]);
    u.uSunVisible.value = (1 - oc * 0.95) * (elevDeg > -2 ? 1 : 0);
    u.uMoonVisible.value = (1 - oc) * Math.max(0, Math.min(1, (-elevDeg - 2) / 8)) * (this.moonDir.y > 0 ? 1 : 0);
    u.uHaze.value = 0.25 + 0.6 * (1 - Math.min(1, (weather.visibility || 40000) / 40000));

    this.night = Math.max(0, Math.min(1, (2 - elevDeg) / 10));
    this.starUniforms.uVisible.value = this.night * (1 - oc) * Math.max(0, Math.min(1, (-elevDeg - 4) / 8));
    this.starUniforms.uTime.value += dt;

    // Lights
    const sunUp = Math.max(0, Math.min(1, (elevDeg + 3) / 9));
    const moonUp = this.moonDir.y > 0.05 ? 1 : 0;
    const useMoon = sunUp < 0.05 && moonUp;
    const lightDir = useMoon ? this.moonDir : this.sunDir;
    const cloudDim = 1 - 0.78 * oc;
    if (useMoon) {
      this.sunLight.color.setRGB(0.55, 0.62, 0.85);
      this.sunLight.intensity = 0.22 * (1 - oc * 0.8);
    } else {
      this.sunLight.color.setRGB(sunC[0] * 0.9 + 0.1, sunC[1] * 0.9 + 0.1, sunC[2] * 0.9 + 0.1);
      this.sunLight.intensity = 2.6 * sunUp * cloudDim;
    }
    const hemiDay = Math.max(0.02, Math.min(1, (elevDeg + 8) / 25));
    this.hemi.color.setRGB(zen[0] * 0.6 + hor[0] * 0.4, zen[1] * 0.6 + hor[1] * 0.4, zen[2] * 0.6 + hor[2] * 0.4).multiplyScalar(1.6);
    this.hemi.groundColor.setRGB(0.32, 0.29, 0.24).multiplyScalar(hemiDay);
    this.hemi.intensity = 0.2 + 0.85 * hemiDay + oc * 0.4 * hemiDay;
    if (this.night > 0.9) this.hemi.intensity = Math.max(this.hemi.intensity, 0.18);

    // Shadow camera follows the focus point
    if (focus) {
      this.sunLight.target.position.copy(focus);
      this.sunLight.position.copy(focus).addScaledVector(lightDir, 800);
      this.sunLight.target.updateMatrixWorld();
    }

    // Fog colour: horizon colour in the view direction (glow toward the sun)
    if (camera) {
      const vd = camera.getWorldDirection(_v);
      vd.y = 0;
      vd.normalize();
      const sd = Math.max(0, vd.dot(_v2.set(this.sunDir.x, 0, this.sunDir.z).normalize()));
      const gk = Math.pow(sd, 3) * (1 - Math.min(1, Math.max(0, elevDeg) / 30));
      this.fogColor.setRGB(hor[0] + glow[0] * gk * 0.9, hor[1] + glow[1] * gk * 0.9, hor[2] + glow[2] * gk * 0.9);
      if (this.scene.fog) this.scene.fog.color.copy(this.fogColor);
    }

    // Environment map refresh when the sky changed noticeably
    this.envTimer -= dt;
    const key = `${Math.round(elevDeg * 2)}|${Math.round(oc * 10)}|${useMoon}`;
    if (key !== this.lastEnvKey && this.envTimer <= 0) {
      this.lastEnvKey = key;
      this.envTimer = 0.5;
      this.updateEnvironment();
    }
  }

  updateEnvironment() {
    this.uniforms.uGroundMode.value = 1;
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
    this.scene.environment = this.envRT.texture;
    this.uniforms.uGroundMode.value = 0;
    if (prev) prev.dispose();
  }

  // Follow the camera
  updateCamera(camera) {
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
