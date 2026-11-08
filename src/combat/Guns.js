// Aircraft cannon: ballistics for every round in flight, tracer rendering,
// impacts on terrain and water, hit tests against combat targets, and the
// per-aircraft gun (rate of fire, ammunition, muzzle flash, gunsight).

import * as THREE from 'three';
import { glowTexture } from '../render/GlowPoints.js';
import { terrainHeight, waterLevelAt } from '../world/terrainGen.js';

const MAX_ROUNDS = 1200;
const GRAVITY = 9.81;
const DRAG = 0.08; // 1/s, simple velocity decay for small-calibre rounds
const TRACER_TAIL = 0.028; // s of travel drawn behind each tracer head
const DEG = Math.PI / 180;

export const OWNER_PLAYER = 0;
export const OWNER_REMOTE = 1; // other pilots' gunfire: drawn, never hits anything

const headVertex = /* glsl */ `
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(1.1 * uScale / max(1.0, -mv.z), 2.5, 9.0);
    vAlpha = aAlpha;
    #include <logdepthbuf_vertex>
  }
`;
const headFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uColor;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(uTex, gl_PointCoord).r * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * 1.5, a);
  }
`;

// Closest approach of the segment a->b to point c; returns squared distance and
// writes the closest point into out.
function segmentPointDist2(ax, ay, az, bx, by, bz, c, out) {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  out.set(ax + dx * t, ay + dy * t, az + dz * t);
  return out.distanceToSquared(c);
}

export class BulletManager {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects; // { smoke, fire } particle systems for impacts and sparks
    this.pos = new Float32Array(MAX_ROUNDS * 3);
    this.vel = new Float32Array(MAX_ROUNDS * 3);
    this.age = new Float32Array(MAX_ROUNDS);
    this.life = new Float32Array(MAX_ROUNDS);
    this.dmg = new Float32Array(MAX_ROUNDS);
    this.owner = new Uint8Array(MAX_ROUNDS);
    this.alive = new Uint8Array(MAX_ROUNDS);
    this.next = 0;
    this.active = 0;
    // Tracer streaks (lines) and glowing heads (points)
    this.linePos = new Float32Array(MAX_ROUNDS * 6);
    this.lineCol = new Float32Array(MAX_ROUNDS * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 16;
    this.headPos = new Float32Array(MAX_ROUNDS * 3);
    this.headAlpha = new Float32Array(MAX_ROUNDS);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('aAlpha', new THREE.BufferAttribute(this.headAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(
      hg,
      new THREE.ShaderMaterial({
        uniforms: { uTex: { value: glowTexture() }, uScale: { value: 600 }, uColor: { value: new THREE.Color(1.0, 0.62, 0.22) } },
        vertexShader: headVertex,
        fragmentShader: headFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.heads.frustumCulled = false;
    this.heads.renderOrder = 16;
    scene.add(this.lines, this.heads);
    this.impactBudget = 0;
    this.hits = 0;
  }

  // Launch one round. p, v: THREE.Vector3 (world position, m/s)
  fire(p, v, owner = OWNER_PLAYER, dmg = 30, life = 3.2, preAge = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_ROUNDS;
    const k = i * 3;
    this.pos[k] = p.x + v.x * preAge;
    this.pos[k + 1] = p.y + v.y * preAge;
    this.pos[k + 2] = p.z + v.z * preAge;
    this.vel[k] = v.x;
    this.vel[k + 1] = v.y;
    this.vel[k + 2] = v.z;
    this.age[i] = preAge;
    this.life[i] = life;
    this.dmg[i] = dmg;
    this.owner[i] = owner;
    this.alive[i] = 1;
  }

  clear() {
    this.alive.fill(0);
    this.active = 0;
  }

  impact(x, y, z, water) {
    if (this.impactBudget-- <= 0) return;
    const fx = this.effects;
    const p = _a.set(x, y + 0.5, z);
    if (water) {
      for (let k = 0; k < 2; k++) fx.smoke.emit(p, _b.set((Math.random() - 0.5) * 2, 6 + Math.random() * 5, (Math.random() - 0.5) * 2), { life: 1.2, size0: 1, size1: 6, alpha: 0.6, color: [0.92, 0.95, 1.0], drag: 1.5, rise: -6 });
    } else {
      fx.smoke.emit(p, _b.set((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3), { life: 1.8, size0: 1.5, size1: 9, alpha: 0.55, color: [0.45, 0.38, 0.3], drag: 1.6, rise: 0.4 });
      fx.fire.emit(p, _b.set(0, 1, 0), { life: 0.12, size0: 2.5, size1: 1, alpha: 0.9, color: [1, 0.75, 0.35], drag: 0 });
    }
  }

  sparks(p, v) {
    for (let k = 0; k < 6; k++) {
      _b.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30).addScaledVector(v, 0.6);
      this.effects.fire.emit(p, _b, { life: 0.25 + Math.random() * 0.2, size0: 1.6, size1: 0.4, alpha: 1, color: [1, 0.8, 0.4], drag: 2 });
    }
  }

  // targets: [{ alive, radius, getPosition(out), getVelocity?(out), onHit(dmg, point) }]
  update(dt, targets, camera) {
    this.impactBudget = 24;
    let n = 0;
    const tgts = targets.filter((t) => t.alive);
    for (let i = 0; i < MAX_ROUNDS; i++) {
      if (!this.alive[i]) continue;
      const k = i * 3;
      const ax = this.pos[k],
        ay = this.pos[k + 1],
        az = this.pos[k + 2];
      const decay = Math.max(0, 1 - DRAG * dt);
      this.vel[k] *= decay;
      this.vel[k + 1] = this.vel[k + 1] * decay - GRAVITY * dt;
      this.vel[k + 2] *= decay;
      const bx = ax + this.vel[k] * dt,
        by = ay + this.vel[k + 1] * dt,
        bz = az + this.vel[k + 2] * dt;
      this.pos[k] = bx;
      this.pos[k + 1] = by;
      this.pos[k + 2] = bz;
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) {
        this.alive[i] = 0;
        continue;
      }
      // Hits (own rounds only; other pilots report their own hits)
      if (this.owner[i] === OWNER_PLAYER && tgts.length) {
        let hit = null;
        for (const t of tgts) {
          t.getPosition(_c);
          const r = t.radius;
          if (Math.abs(_c.x - bx) > 400 || Math.abs(_c.z - bz) > 400) continue;
          if (segmentPointDist2(ax, ay, az, bx, by, bz, _c, _hp) <= r * r) {
            hit = t;
            break;
          }
        }
        if (hit) {
          this.alive[i] = 0;
          this.hits++;
          this.sparks(_hp, hit.getVelocity ? hit.getVelocity(_v) : _v.set(0, 0, 0));
          hit.onHit(this.dmg[i], _hp);
          continue;
        }
      }
      // Terrain and water (nothing reaches the ground above the highest peaks)
      if (by < 4200) {
        const h = terrainHeight(bx, bz);
        const wl = waterLevelAt(bx, bz);
        if (by <= Math.max(h, wl)) {
          this.alive[i] = 0;
          this.impact(bx, Math.max(h, wl), bz, wl > h);
          continue;
        }
      }
      // Render: tracer streak from tail to head, fading with age
      const fade = 1 - this.age[i] / this.life[i];
      const lk = n * 6;
      this.linePos[lk] = bx - this.vel[k] * TRACER_TAIL;
      this.linePos[lk + 1] = by - this.vel[k + 1] * TRACER_TAIL;
      this.linePos[lk + 2] = bz - this.vel[k + 2] * TRACER_TAIL;
      this.linePos[lk + 3] = bx;
      this.linePos[lk + 4] = by;
      this.linePos[lk + 5] = bz;
      this.lineCol[lk] = 0.35 * fade;
      this.lineCol[lk + 1] = 0.15 * fade;
      this.lineCol[lk + 2] = 0.03 * fade;
      this.lineCol[lk + 3] = 1.4 * fade;
      this.lineCol[lk + 4] = 0.85 * fade;
      this.lineCol[lk + 5] = 0.35 * fade;
      const hk = n * 3;
      this.headPos[hk] = bx;
      this.headPos[hk + 1] = by;
      this.headPos[hk + 2] = bz;
      this.headAlpha[n] = 0.35 + 0.65 * fade;
      n++;
    }
    this.active = n;
    const lg = this.lines.geometry;
    lg.attributes.position.needsUpdate = true;
    lg.attributes.color.needsUpdate = true;
    lg.setDrawRange(0, n * 2);
    const hg = this.heads.geometry;
    hg.attributes.position.needsUpdate = true;
    hg.attributes.aAlpha.needsUpdate = true;
    hg.setDrawRange(0, n);
    if (camera) this.heads.material.uniforms.uScale.value = 600 * (60 / camera.fov);
  }

  dispose() {
    this.scene.remove(this.lines, this.heads);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.heads.geometry.dispose();
    this.heads.material.dispose();
  }
}

// Unit vector of the gun line in body axes (nose is -Z), raised by the
// boresight elevation so the stream crosses the gunsight at typical ranges
export function gunAxis(elevDeg, out = new THREE.Vector3()) {
  return out.set(0, Math.sin(elevDeg * DEG), -Math.cos(elevDeg * DEG));
}

// Fixed-range gunsight: where rounds fired now are, relative to the aircraft,
// once they have travelled `range` metres (gravity drop included). Returns the
// offset in body axes and the HUD angles (degrees right / down of the boresight).
export function gunsightSolution(quaternion, gun, range, out = {}) {
  const t = range / gun.muzzle;
  const axis = gunAxis(gun.elev || 0, _axis);
  const gBody = _g.set(0, -GRAVITY, 0).applyQuaternion(_qi.copy(quaternion).invert());
  const rel = (out.rel || (out.rel = new THREE.Vector3())).copy(axis).multiplyScalar(range).addScaledVector(gBody, 0.5 * t * t);
  out.x = Math.atan2(rel.x, -rel.z) / DEG;
  out.y = Math.atan2(-rel.y, -rel.z) / DEG;
  out.t = t;
  return out;
}

// The cannon on one aircraft
export class GunSystem {
  constructor(player, cfg) {
    this.player = player;
    this.cfg = cfg;
    this.ammo = cfg.rounds;
    this.accum = 0;
    this.firing = false;
    this.fired = 0;
    this.trigger = false;
    this.restTime = 0;
    this.range = 600;
    this.lock = null;
    this.sight = { x: 0, y: 0, t: 0, rel: new THREE.Vector3() };
    this.impactPoint = new THREE.Vector3();
    this.flash = new THREE.PointLight(0xffb060, 0, 18, 2);
    this.flash.position.set(...cfg.pos);
    player.visual.root.add(this.flash);
  }

  get armed() {
    const sim = this.player.sim;
    return !sim.fm.wow && !sim.fm.crashed && sim.powered;
  }

  update(dt, trigger, bullets, targets) {
    const p = this.player;
    const sim = p.sim;
    const fm = sim.fm;
    const cfg = this.cfg;
    const game = p.game;
    const pressed = trigger && !this.trigger;
    this.trigger = trigger;
    this.firing = trigger && this.armed && this.ammo > 0;
    if (pressed && this.armed && this.ammo === 0) game.ui.toast('Guns empty — land and stop to rearm', 'warn', 2500);
    if (pressed && !this.armed && !fm.crashed && fm.wow) game.ui.toast('Guns are safe on the ground', 'info', 1500);
    if (this.firing) {
      this.accum += dt * cfg.rate;
      const shots = Math.min(this.ammo, Math.floor(this.accum));
      this.accum -= shots;
      const q = fm.quaternion;
      _muzzle.set(...cfg.pos).applyQuaternion(q).add(fm.position);
      for (let s = 0; s < shots; s++) {
        gunAxis(cfg.elev || 0, _dir);
        _dir.x += (Math.random() - 0.5) * cfg.spread;
        _dir.y += (Math.random() - 0.5) * cfg.spread;
        _dir.normalize().applyQuaternion(q);
        _bv.copy(fm.velocity).addScaledVector(_dir, cfg.muzzle);
        // spread the rounds of one frame along the stream instead of bunching them
        bullets.fire(_muzzle, _bv, OWNER_PLAYER, cfg.damage, cfg.life || 3.2, (s / Math.max(1, shots)) * dt);
      }
      this.ammo -= shots;
      this.fired += shots;
      // Muzzle flash and gun gas. From the cockpit the gun port is a metre from
      // the pilot's eye: only a faint flicker on the panel, no particles in the face
      const inCockpit = game.cameras && game.cameras.mode === 'cockpit';
      this.flash.intensity = inCockpit ? 2 + Math.random() * 3 : 40 + Math.random() * 60;
      const fx = p.effects;
      if (!inCockpit) {
        if (Math.random() < 0.7) fx.fire.emit(_muzzle, _bv.copy(fm.velocity).addScaledVector(_dir, 30), { life: 0.06, size0: 2.2, size1: 0.6, alpha: 1, color: [1, 0.75, 0.35], drag: 0 });
        if (Math.random() < 0.3) fx.smoke.emit(_muzzle, _bv.copy(fm.velocity).multiplyScalar(0.85), { life: 1.0, size0: 0.6, size1: 3.2, alpha: 0.16, color: [0.8, 0.8, 0.8], drag: 1.5 });
      }
    } else {
      this.flash.intensity = 0;
      this.accum = 0;
    }
    game.audio.setGun(this.firing, cfg.rate);
    // Rearm after standing still on the ground for a few seconds
    if (fm.wow && fm.groundSpeed < 1 && this.ammo < cfg.rounds) {
      this.restTime += dt;
      if (this.restTime > 4) {
        this.ammo = cfg.rounds;
        game.ui.toast(`Guns rearmed — ${cfg.rounds} rounds`, 'success');
      }
    } else this.restTime = 0;
    // Gunsight: range to the target nearest the gun line, else a fixed 600 m
    this.lock = null;
    let best = 2200;
    gunAxis(cfg.elev || 0, _dir).applyQuaternion(fm.quaternion);
    for (const t of targets) {
      if (!t.alive) continue;
      t.getPosition(_c).sub(fm.position);
      const d = _c.length();
      if (d < 80 || d > best) continue;
      if (_c.dot(_dir) / d < Math.cos(12 * DEG)) continue;
      best = d;
      this.lock = t;
    }
    this.range = this.lock ? best : 600;
    gunsightSolution(fm.quaternion, cfg, this.range, this.sight);
    this.impactPoint.copy(this.sight.rel).applyQuaternion(fm.quaternion).add(fm.position);
  }

  dispose() {
    this.player.visual.root.remove(this.flash);
    this.player.game.audio.setGun(false);
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _g = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bv = new THREE.Vector3();
