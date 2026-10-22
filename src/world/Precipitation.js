// Rain streaks and snowflakes simulated on the GPU in a box wrapped around the
// camera (streaks stretch with the aircraft's relative velocity), plus lightning.

import * as THREE from 'three';

const rainVertex = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aEnd;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uFall;
  uniform vec3 uRel;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uStreak;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 p = aSeed.xyz * uBox + uFall * uTime;
    p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
    p -= uRel * uStreak * aEnd;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = length(mv.xyz);
    vAlpha = (aSeed.w < uIntensity ? 1.0 : 0.0) * smoothstep(1.0, 4.0, d) * (1.0 - smoothstep(25.0, 45.0, d)) * (1.0 - aEnd * 0.7);
    #include <logdepthbuf_vertex>
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, vAlpha * 0.35);
  }
`;

const snowVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uFall;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uScale;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 p = aSeed.xyz * uBox + uFall * uTime;
    p.x += sin(uTime * 0.8 + aSeed.w * 30.0) * 0.6;
    p.z += cos(uTime * 0.7 + aSeed.w * 21.0) * 0.6;
    p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = length(mv.xyz);
    gl_PointSize = clamp(uScale / d, 1.0, 9.0);
    vAlpha = (aSeed.w < uIntensity ? 1.0 : 0.0) * smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(30.0, 50.0, d));
    #include <logdepthbuf_vertex>
  }
`;
const snowFragment = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vAlpha;
    gl_FragColor = vec4(uColor, a * 0.9);
  }
`;

export class Precipitation {
  constructor(scene) {
    this.scene = scene;
    const N = 9000;
    const box = new THREE.Vector3(90, 70, 90);
    // Rain: line segments, two vertices per drop
    const seeds = new Float32Array(N * 2 * 4);
    const ends = new Float32Array(N * 2);
    const pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        seeds.set(s, (i * 2 + k) * 4);
        ends[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainUniforms = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: box },
      uFall: { value: new THREE.Vector3(0, -9, 0) },
      uRel: { value: new THREE.Vector3(0, -9, 0) },
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uStreak: { value: 0.035 },
      uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
    };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ uniforms: this.rainUniforms, vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 20;
    this.rain.visible = false;
    scene.add(this.rain);

    // Snow: points
    const sn = 7000;
    const ss = new Float32Array(sn * 4);
    for (let i = 0; i < sn * 4; i++) ss[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sn * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 4));
    this.snowUniforms = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(80, 60, 80) },
      uFall: { value: new THREE.Vector3(0, -1.4, 0) },
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uScale: { value: 160 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.snowUniforms, vertexShader: snowVertex, fragmentShader: snowFragment, transparent: true, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 20;
    this.snow.visible = false;
    scene.add(this.snow);

    // Lightning
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xe8eeff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolt = null;
    this.flash = 0;
    this.nextStrike = 5;
    this.boltTime = 0;
    this.events = [];
    this.time = 0;
  }

  makeBolt(x, z, top, ground) {
    const pts = [];
    let px = x,
      pz = z;
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const y = top - ((top - ground) * i) / steps;
      pts.push(new THREE.Vector3(px, y, pz));
      px += (Math.random() - 0.5) * 180;
      pz += (Math.random() - 0.5) * 180;
    }
    // A couple of branches
    const all = [...pts];
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push(pts[i], pts[i + 1]);
    for (let b = 0; b < 3; b++) {
      let p = pts[4 + Math.floor(Math.random() * 12)].clone();
      for (let k = 0; k < 6; k++) {
        const n = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 220, -120 - Math.random() * 150, (Math.random() - 0.5) * 220));
        segs.push(p, n);
        p = n;
      }
    }
    void all;
    const g = new THREE.BufferGeometry().setFromPoints(segs);
    const line = new THREE.LineSegments(g, this.boltMat);
    line.frustumCulled = false;
    line.renderOrder = 30;
    return line;
  }

  update(dt, camera, weather, aircraftVelocity, groundHeightFn) {
    const w = weather.state;
    this.time += dt;
    const cam = camera.position;
    const belowBase = cam.y < (w.layer > 0.3 ? w.layerTop : w.cloudBase + w.cloudDepth);
    const intensity = belowBase ? w.precipitation : 0;
    const isSnow = w.precipType === 'snow';
    const wr = ((w.windDir + 180) * Math.PI) / 180;
    const wx = Math.sin(wr) * w.windSpeed,
      wz = -Math.cos(wr) * w.windSpeed;
    const vel = aircraftVelocity || new THREE.Vector3();

    this.rain.visible = !isSnow && intensity > 0.01;
    if (this.rain.visible) {
      const u = this.rainUniforms;
      u.uTime.value = this.time % 1000;
      u.uCam.value.copy(cam);
      u.uFall.value.set(wx, -9.5, wz);
      u.uRel.value.set(wx - vel.x, -9.5 - vel.y, wz - vel.z);
      u.uIntensity.value = intensity;
      const speed = u.uRel.value.length();
      u.uStreak.value = Math.min(0.05, 0.6 / Math.max(10, speed)) + 0.012;
    }
    this.snow.visible = isSnow && intensity > 0.01;
    if (this.snow.visible) {
      const u = this.snowUniforms;
      u.uTime.value = this.time % 1000;
      u.uCam.value.copy(cam);
      u.uFall.value.set(wx * 0.8, -1.4, wz * 0.8);
      u.uIntensity.value = intensity;
    }

    // Lightning
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.bolt) {
      this.boltTime -= dt;
      this.boltMat.opacity = this.boltTime > 0 ? (Math.random() < 0.7 ? 1 : 0.2) : 0;
      if (this.boltTime <= 0) {
        this.scene.remove(this.bolt);
        this.bolt.geometry.dispose();
        this.bolt = null;
      }
    }
    if (w.lightning > 0.4 && w.storms && w.storms.length) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 2 + Math.random() * 9 / w.lightning;
        const st = w.storms[Math.floor(Math.random() * w.storms.length)];
        const a = Math.random() * Math.PI * 2,
          rr = Math.random() * st.r;
        const x = st.x + Math.cos(a) * rr,
          z = st.z + Math.sin(a) * rr;
        const ground = groundHeightFn ? groundHeightFn(x, z) : 0;
        if (this.bolt) {
          this.scene.remove(this.bolt);
          this.bolt.geometry.dispose();
        }
        this.bolt = this.makeBolt(x, z, w.cloudBase + 200, ground);
        this.scene.add(this.bolt);
        this.boltTime = 0.25 + Math.random() * 0.2;
        const dist = Math.hypot(x - cam.x, z - cam.z);
        this.flash = Math.max(this.flash, Math.max(0.15, 1 - dist / 25000));
        this.events.push({ type: 'thunder', distance: dist, delay: dist / 340 });
      }
    }
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
