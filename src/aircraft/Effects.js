// Visual effects attached to an aircraft: contrails, tyre smoke on touchdown,
// wingtip vapour, engine smoke/fire after failures, crash fireball & smoke.

import * as THREE from 'three';
import { glowTexture } from '../render/GlowPoints.js';

const MAX = 2400;

const vertex = /* glsl */ `
  attribute float aAge;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 1.0, 900.0);
    vAlpha = aAlpha;
    vColor = aColor;
    #include <logdepthbuf_vertex>
  }
`;
const fragment = /* glsl */ `
  uniform sampler2D uTex;
  varying float vAlpha;
  varying vec3 vColor;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(uTex, gl_PointCoord).r * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

class ParticleSystem {
  constructor(scene, additive = false) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.size1 = new Float32Array(MAX);
    this.alpha0 = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    this.sizeAttr = new Float32Array(MAX);
    this.alphaAttr = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.rise = new Float32Array(MAX);
    this.count = 0;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTexture() }, uScale: { value: 600 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
    scene.add(this.points);
  }

  emit(p, v, { life = 3, size0 = 2, size1 = 10, alpha = 0.5, color = [1, 1, 1], drag = 0.5, rise = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.count = Math.max(this.count, this.next === 0 ? MAX : this.next);
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.color[i * 3] = color[0];
    this.color[i * 3 + 1] = color[1];
    this.color[i * 3 + 2] = color[2];
    this.drag[i] = drag;
    this.rise[i] = rise;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alphaAttr[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.rise[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizeAttr[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      this.alphaAttr[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    const g = this.geo;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.setDrawRange(0, this.count);
  }

  dispose(scene) {
    scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class AircraftEffects {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.smoke = new ParticleSystem(scene, false);
    this.fire = new ParticleSystem(scene, true);
    this.contrailTimer = 0;
    this.crashTime = 0;
    this.smokeOn = false;
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 120, 2);
    scene.add(this.fireLight);
  }

  touchdown(strength) {
    const sim = this.player.sim;
    const fm = sim.fm;
    for (const g of fm.gear) {
      if (g.name === 'nose') continue;
      _p.copy(g.body).applyQuaternion(fm.quaternion).add(fm.position);
      for (let k = 0; k < 6 + strength * 10; k++) {
        _v.set((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3).addScaledVector(fm.velocity, 0.15);
        this.smoke.emit(_p, _v, { life: 2.5 + Math.random() * 1.5, size0: 1.5, size1: 9 + strength * 6, alpha: 0.35 + strength * 0.2, color: [0.85, 0.85, 0.85], drag: 1.2, rise: 0.4 });
      }
    }
  }

  crash() {
    this.crashTime = 0.001;
    const fm = this.player.sim.fm;
    for (let k = 0; k < 160; k++) {
      _v.set((Math.random() - 0.5) * 40, Math.random() * 30, (Math.random() - 0.5) * 40).addScaledVector(fm.velocity, 0.2);
      this.fire.emit(fm.position, _v, { life: 1.2 + Math.random() * 1.5, size0: 6, size1: 30, alpha: 0.9, color: [1, 0.55 + Math.random() * 0.2, 0.15], drag: 2.5, rise: 3 });
    }
  }

  update(dt, world, weather) {
    const p = this.player;
    const sim = p.sim;
    const fm = sim.fm;
    const spec = p.spec;
    // Contrails at high altitude in cold air
    const alt = fm.position.y;
    const contrail = alt > 7800 && fm.tas > 120 && !fm.crashed;
    this.contrailTimer -= dt;
    if (contrail && this.contrailTimer <= 0) {
      this.contrailTimer = 0.05;
      for (const e of sim.engines) {
        if (!e.running) continue;
        const pos = e.spec.pos;
        _p.set(pos[0], pos[1], pos[2] + (spec.category === 'fighter' ? 1 : 4)).applyQuaternion(fm.quaternion).add(fm.position);
        _v.copy(fm.velocity).multiplyScalar(0.05);
        this.smoke.emit(_p, _v, { life: 14, size0: 1.5, size1: 22, alpha: 0.45, color: [0.95, 0.96, 1.0], drag: 0.05, rise: 0 });
      }
    }
    // Wingtip vapour at high g / alpha in humid air
    if (!fm.wow && (fm.nz > 3 || (fm.alpha > 0.16 && fm.tas > 70)) && Math.random() < 0.6) {
      const half = spec.wing.span / 2;
      for (const sx of [-1, 1]) {
        _p.set(sx * half * 0.98, spec.model.wing.y, spec.model.wing.rootLE + 2).applyQuaternion(fm.quaternion).add(fm.position);
        this.smoke.emit(_p, _w.copy(fm.velocity).multiplyScalar(0.7), { life: 0.6, size0: 0.6, size1: 2.5, alpha: 0.5, color: [1, 1, 1], drag: 3 });
      }
    }
    // Engine fire / failure smoke
    for (const e of sim.engines) {
      if ((e.fire || (e.failed && !e.extinguished)) && Math.random() < 0.8) {
        const pos = e.spec.pos;
        _p.set(pos[0], pos[1], pos[2] + 2).applyQuaternion(fm.quaternion).add(fm.position);
        this.smoke.emit(_p, _v.copy(fm.velocity).multiplyScalar(0.3), { life: 6, size0: 2, size1: 18, alpha: 0.5, color: e.fire ? [0.15, 0.15, 0.15] : [0.4, 0.4, 0.4], drag: 0.4, rise: 1 });
        if (e.fire) this.fire.emit(_p, _v.copy(fm.velocity).multiplyScalar(0.5), { life: 0.4, size0: 2, size1: 6, alpha: 0.9, color: [1, 0.5, 0.1], drag: 2 });
      }
    }
    // Display smoke (aerobatics) when toggled
    if (this.smokeOn && !fm.wow) {
      _p.set(0, 0, spec.model.fuselage.tailZ).applyQuaternion(fm.quaternion).add(fm.position);
      this.smoke.emit(_p, _v.copy(fm.velocity).multiplyScalar(0.1), { life: 20, size0: 2, size1: 14, alpha: 0.7, color: [1, 1, 1], drag: 0.1 });
    }
    // Crash site fire
    if (fm.crashed) {
      this.crashTime += dt;
      const k = Math.max(0, 1 - this.crashTime / 120);
      if (Math.random() < 0.9 * k) {
        _p.copy(fm.position);
        _p.y = Math.max(_p.y, world.heightAt(_p.x, _p.z) + 1);
        this.fire.emit(_p.clone().add(_w.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)), _v.set(0, 3, 0), { life: 1.5, size0: 6, size1: 14, alpha: 0.8, color: [1, 0.5, 0.12], drag: 1, rise: 4 });
        this.smoke.emit(_p, _v.set((Math.random() - 0.5) * 2, 6, (Math.random() - 0.5) * 2), { life: 18, size0: 8, size1: 60, alpha: 0.5, color: [0.12, 0.12, 0.12], drag: 0.2, rise: 1.5 });
      }
      this.fireLight.position.copy(fm.position).add(_w.set(0, 6, 0));
      this.fireLight.intensity = 800 * k * (0.8 + Math.random() * 0.4);
    } else this.fireLight.intensity = 0;
    // Drift particles with wind
    this.smoke.update(dt);
    this.fire.update(dt);
  }

  dispose() {
    this.smoke.dispose(this.scene);
    this.fire.dispose(this.scene);
    this.scene.remove(this.fireLight);
  }
}
