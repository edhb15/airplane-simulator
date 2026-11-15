// Destructible city buildings and explosions.
//
// Buildings take damage from cannon rounds, bombs and missiles. When one is
// destroyed its instance is hidden and replaced by falling pieces: tall
// buildings snap and the top topples over while the stump sinks, low houses
// tip and crumble. Chunks of debris fly out, dust rolls out from the base, a
// smoking rubble pile is left behind, and a falling top can bring down the
// buildings it lands on. reset() puts the whole city back.

import * as THREE from 'three';
import { ParticleSystem } from '../aircraft/Effects.js';
import { terrainHeight, waterLevelAt } from '../world/terrainGen.js';

const G = 9.81;
const MAX_DEBRIS = 900;
const MAX_RUBBLE = 500;
const MAX_SCORCH = 48;

// Hit points grow with the building's volume: a house takes a short burst, a
// tower a long one or a bomb
export function buildingHealth(b) {
  return 120 + b.w * b.d * b.h * 0.018;
}

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(10,8,6,0.95)');
  grd.addColorStop(0.45, 'rgba(25,20,16,0.75)');
  grd.addColorStop(0.8, 'rgba(40,34,28,0.25)');
  grd.addColorStop(1, 'rgba(40,34,28,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rand = (a, b) => a + Math.random() * (b - a);

export class Destruction {
  constructor(game, cities) {
    this.game = game;
    this.cities = cities;
    const scene = (this.scene = game.scene);
    this.smoke = new ParticleSystem(scene, false, 6000);
    this.fire = new ParticleSystem(scene, true, 2500);
    this.damaged = new Set();
    this.destroyed = [];
    this.pieces = [];
    this.burning = [];
    this.collapsedCount = 0;

    // Flying chunks of concrete and glass
    const chunkGeo = new THREE.BoxGeometry(1, 1, 1);
    this.chunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05 });
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, this.chunkMat, MAX_DEBRIS);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.chunkMesh.count = 0;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.castShadow = true;
    scene.add(this.chunkMesh);
    this.chunks = [];

    // Rubble piles where buildings stood
    const rubbleGeo = new THREE.DodecahedronGeometry(0.5, 0);
    rubbleGeo.translate(0, 0.25, 0);
    this.rubbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    this.rubbleMesh = new THREE.InstancedMesh(rubbleGeo, this.rubbleMat, MAX_RUBBLE);
    this.rubbleMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.rubbleMesh.count = 0;
    this.rubbleMesh.frustumCulled = false;
    this.rubbleMesh.receiveShadow = true;
    scene.add(this.rubbleMesh);
    this.rubble = [];

    // Scorch marks on the ground
    this.scorchMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const scorchGeo = new THREE.CircleGeometry(1, 24);
    scorchGeo.rotateX(-Math.PI / 2);
    this.scorches = [];
    for (let i = 0; i < MAX_SCORCH; i++) {
      const m = new THREE.Mesh(scorchGeo, this.scorchMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.scorches.push(m);
    }
    this.nextScorch = 0;

    // One flash light, moved to the latest explosion (a fixed light count
    // avoids recompiling every material when explosions start and end)
    this.flash = new THREE.PointLight(0xffaa55, 0, 900, 1.6);
    this.flash.position.set(0, -10000, 0);
    scene.add(this.flash);
    this.flashLevel = 0;
  }

  // ------------------------------------------------------------------ damage
  // Returns true if this damage destroyed the building
  damage(b, dmg, point, opts = {}) {
    if (!b.mesh || b.destroyed) return false; // landmarks are indestructible
    if (b.hp === undefined) {
      b.maxHp = buildingHealth(b);
      b.hp = b.maxHp;
    }
    b.hp -= dmg;
    this.damaged.add(b);
    if (opts.bullet) this.chip(point, b);
    if (b.hp <= 0) {
      this.collapse(b, point, opts.dir || null);
      return true;
    }
    // Badly damaged buildings start to smoke from the hit
    if (b.hp < b.maxHp * 0.5 && !b.smoking) {
      b.smoking = true;
      this.burning.push({ x: point.x, y: point.y, z: point.z, t: 0, life: 45, rate: 2, size: Math.min(3, 0.8 + b.w / 25), fire: 0, building: b });
    }
    return false;
  }

  // Bullet strike on a wall: concrete dust and a few chips
  chip(p, b) {
    const col = b.tint ? [b.tint[0] * 0.7, b.tint[1] * 0.68, b.tint[2] * 0.65] : [0.6, 0.58, 0.55];
    this.smoke.emit(p, _v.set(rand(-2, 2), rand(1, 3), rand(-2, 2)), { life: 1.6, size0: 1.2, size1: 7, alpha: 0.55, color: col, drag: 1.5, rise: 0.3 });
    if (Math.random() < 0.35) this.fire.emit(p, _v.set(rand(-4, 4), rand(0, 4), rand(-4, 4)), { life: 0.12, size0: 1.6, size1: 0.5, alpha: 0.9, color: [1, 0.8, 0.45], drag: 0 });
    if (Math.random() < 0.25) this.addChunk(p, _v.set(rand(-6, 6), rand(2, 9), rand(-6, 6)), rand(0.25, 0.6), b.tint);
  }

  addChunk(p, v, size, tint) {
    if (this.chunks.length >= MAX_DEBRIS) this.chunks.shift();
    const k = 0.55 + Math.random() * 0.3;
    const t = tint || [0.8, 0.78, 0.74];
    this.chunks.push({
      p: p.clone(),
      v: v.clone(),
      q: new THREE.Quaternion().setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
      w: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
      s: new THREE.Vector3(size * rand(0.6, 1.4), size * rand(0.5, 1), size * rand(0.6, 1.4)),
      color: [t[0] * k, t[1] * k, t[2] * k],
      age: 0,
      life: rand(7, 12),
      rest: false,
    });
  }

  // ------------------------------------------------------------------ collapse
  collapse(b, point, dir) {
    const cities = this.cities;
    cities.hideBuilding(b);
    this.destroyed.push(b);
    this.collapsedCount++;
    this.game.events.emit('buildingDestroyed', { building: b });
    const ground = terrainHeight(b.x, b.z);
    // Fall direction: away from the hit, snapped to one of the building's sides
    let fx, fz;
    if (dir && Math.hypot(dir.x, dir.z) > 0.01) {
      fx = dir.x;
      fz = dir.z;
    } else if (point) {
      fx = b.x - point.x;
      fz = b.z - point.z;
    }
    if (!fx && !fz) {
      const a = Math.random() * Math.PI * 2;
      fx = Math.cos(a);
      fz = Math.sin(a);
    }
    const c = Math.cos(b.rot),
      s = Math.sin(b.rot);
    const lx = fx * c + fz * s,
      lz = -fx * s + fz * c;
    const alongX = Math.abs(lx) > Math.abs(lz);
    const sign = alongX ? Math.sign(lx) || 1 : Math.sign(lz) || 1;
    const tall = b.h > 1.4 * Math.min(b.w, b.d) && b.h > 14;
    if (tall) {
      // Snap somewhere in the lower half; short towers go over from the base
      const breakFrac = b.h > 45 ? rand(0.18, 0.5) : 0;
      const breakH = b.h * breakFrac;
      if (breakH > 2) this.addPiece(b, { y0: b.y, h: breakH, mode: 'sink' });
      this.addPiece(b, { y0: b.y + breakH, h: b.h - breakH, mode: 'topple', alongX, sign, ground });
    } else {
      this.addPiece(b, { y0: b.y, h: b.h, mode: 'crumble', alongX, sign, ground });
    }
    // Debris burst and the first dust cloud
    const n = Math.min(60, 10 + Math.round(Math.sqrt(b.w * b.d * b.h) * 0.4));
    const top = b.y + b.h * 0.6;
    for (let i = 0; i < n; i++) {
      _p.set(b.x + rand(-b.w, b.w) * 0.5, b.y + 2 + Math.random() * (top - b.y), b.z + rand(-b.d, b.d) * 0.5);
      this.addChunk(_p, _v.set(rand(-14, 14), rand(2, 16), rand(-14, 14)), rand(0.5, 1.6 + b.w / 25), b.tint);
    }
    this.dust(b.x, ground, b.z, Math.max(b.w, b.d), 1);
    // Rubble pile and fire / smoke column where it stood
    this.addRubble(b.x, b.z, b.w * 1.05, b.d * 1.05, b.rot, Math.min(8, 1.5 + b.h * 0.08), b.tint);
    this.burning.push({ x: b.x, y: ground + 1, z: b.z, t: 0, life: rand(50, 80), rate: 4 + Math.min(8, b.w / 6), size: Math.min(5, 1 + Math.max(b.w, b.d) / 15), fire: rand(14, 30) });
    this.sound(b.x, ground, b.z, Math.min(1.6, 0.5 + b.h / 80));
  }

  addPiece(b, { y0, h, mode, alongX = true, sign = 1, ground = b.y }) {
    const mesh = new THREE.InstancedMesh(this.cities.box, this.cities.material, 1);
    mesh.setMatrixAt(0, _m.identity());
    mesh.setColorAt(0, _c.setRGB(b.tint[0] * 0.92, b.tint[1] * 0.92, b.tint[2] * 0.92));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const pivot = new THREE.Group();
    const yaw = new THREE.Quaternion().setFromAxisAngle(_up, -b.rot);
    // The pivot sits on the bottom edge the piece falls over; the box hangs
    // off it (box origin is the centre of its base)
    const ex = alongX ? (b.w / 2) * sign : 0;
    const ez = alongX ? 0 : (b.d / 2) * sign;
    _v.set(ex, 0, ez).applyQuaternion(yaw);
    pivot.position.set(b.x + _v.x, y0, b.z + _v.z);
    mesh.position.set(-ex, 0, -ez);
    mesh.scale.set(b.w, h, b.d);
    pivot.add(mesh);
    pivot.quaternion.copy(yaw);
    this.scene.add(pivot);
    // Tilt axis (local): falling toward +x tilts about -z, toward +z about +x
    const axis = alongX ? new THREE.Vector3(0, 0, -sign) : new THREE.Vector3(sign, 0, 0);
    this.pieces.push({
      b,
      mesh,
      pivot,
      yaw,
      axis,
      mode,
      h,
      thick: alongX ? b.w : b.d,
      len: h,
      dirX: alongX ? sign : 0,
      dirZ: alongX ? 0 : sign,
      angle: mode === 'topple' ? rand(0.02, 0.05) : 0,
      angVel: mode === 'topple' ? rand(0.15, 0.3) : 0,
      maxAngle: mode === 'crumble' ? rand(0.25, 0.5) : mode === 'sink' ? rand(0.03, 0.1) : Math.PI / 2,
      sinkTo: -h - 2,
      sinkRate: mode === 'sink' ? h / rand(3, 5) : mode === 'crumble' ? h / rand(2.5, 4) : 0,
      sunk: 0,
      fallV: 0,
      ground,
      landed: false,
      t: 0,
    });
  }

  addRubble(x, z, w, d, rot, height, tint) {
    const count = Math.min(14, 3 + Math.round((w * d) / 120));
    const t = tint || [0.7, 0.68, 0.64];
    const c = Math.cos(rot),
      s = Math.sin(rot);
    for (let i = 0; i < count; i++) {
      if (this.rubble.length >= MAX_RUBBLE) this.rubble.shift();
      const ox = rand(-0.42, 0.42) * w,
        oz = rand(-0.42, 0.42) * d;
      const px = x + ox * c - oz * s,
        pz = z + ox * s + oz * c;
      const size = rand(0.45, 0.8) * Math.min(w, d) * 0.6;
      const k = rand(0.35, 0.6);
      this.rubble.push({ x: px, y: terrainHeight(px, pz) - size * 0.25, z: pz, sx: size * rand(0.9, 1.5), sy: height * rand(0.5, 1.2), sz: size * rand(0.9, 1.5), ry: Math.random() * 6, color: [t[0] * k, t[1] * k, t[2] * k] });
    }
    this.rubbleDirty = true;
  }

  dust(x, y, z, size, strength) {
    const n = Math.round(10 + size * 0.6 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(4, 12) * strength;
      _p.set(x + Math.cos(a) * size * 0.3, y + rand(1, 6), z + Math.sin(a) * size * 0.3);
      const g = rand(0.55, 0.7);
      this.smoke.emit(_p, _v.set(Math.cos(a) * sp, rand(0.5, 3), Math.sin(a) * sp), { life: rand(6, 11), size0: size * 0.25 + 4, size1: size * 0.9 + 25, alpha: 0.55, color: [g, g * 0.95, g * 0.88], drag: 0.6, rise: 0.5 });
    }
  }

  sound(x, y, z, strength) {
    const cam = this.game.camera.position;
    const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    const gain = Math.min(2.2, (strength * 600) / (d + 200));
    if (gain < 0.03) return;
    const delay = Math.min(3, d / 340);
    const a = this.game.audio;
    a.burst({ type: 'brown', filter: 'lowpass', freq: 220, dur: 3.5, gain: gain * 1.4, bus: 'env', decay: 2.2, delay });
    a.burst({ type: 'pink', filter: 'bandpass', freq: 900, q: 0.7, dur: 1.4, gain: gain * 0.6, bus: 'env', decay: 1.2, delay: delay + 0.1 });
  }

  // ------------------------------------------------------------------ explosions
  // Visual and sound of a bomb or missile detonation. size ~1 for a bomb.
  blast(p, { size = 1, water = false, onGround = true } = {}) {
    const fx = this;
    const s = size;
    if (water) {
      for (let i = 0; i < 50 * s; i++) fx.smoke.emit(p, _v.set(rand(-6, 6) * s, rand(20, 55) * s, rand(-6, 6) * s), { life: rand(2.5, 4), size0: 3 * s, size1: 18 * s, alpha: 0.75, color: [0.92, 0.95, 1], drag: 0.6, rise: -9 });
    } else {
      for (let i = 0; i < 70 * s; i++) fx.fire.emit(p, _v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 34) * s), { life: rand(0.5, 1.3), size0: 7 * s, size1: 26 * s, alpha: 0.95, color: [1, rand(0.45, 0.7), 0.15], drag: 2.6, rise: 4 });
      for (let i = 0; i < 26 * s; i++) fx.smoke.emit(p, _v.set(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).multiplyScalar(rand(4, 14) * s), { life: rand(8, 14), size0: 8 * s, size1: 45 * s, alpha: 0.6, color: [0.13, 0.12, 0.11], drag: 0.7, rise: 2.5 });
      if (onGround) {
        // Dirt thrown up
        for (let i = 0; i < 24 * s; i++) fx.smoke.emit(p, _v.set(rand(-10, 10) * s, rand(15, 40) * s, rand(-10, 10) * s), { life: rand(2, 3.5), size0: 3 * s, size1: 14 * s, alpha: 0.7, color: [0.36, 0.3, 0.24], drag: 1.2, rise: -12 });
        for (let i = 0; i < 10 * s; i++) this.addChunk(p, _v.set(rand(-18, 18), rand(10, 30), rand(-18, 18)), rand(0.3, 0.8), [0.42, 0.36, 0.3]);
        this.scorch(p.x, p.z, 14 * s);
      }
    }
    this.flash.position.copy(p).y += 8;
    this.flashLevel = Math.max(this.flashLevel, 60000 * s);
    this.sound(p.x, p.y, p.z, 2.2 * s);
  }

  scorch(x, z, r) {
    const m = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % MAX_SCORCH;
    m.position.set(x, terrainHeight(x, z) + 0.25, z);
    m.scale.set(r, 1, r);
    m.rotation.y = Math.random() * 6;
    m.visible = waterLevelAt(x, z) < terrainHeight(x, z);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (dt <= 0) {
      this.smoke.update(0);
      this.fire.update(0);
      return;
    }
    this.updatePieces(dt);
    this.updateChunks(dt);
    this.updateBurning(dt);
    if (this.rubbleDirty) this.writeRubble();
    this.flashLevel *= Math.exp(-dt * 7);
    this.flash.intensity = this.flashLevel > 50 ? this.flashLevel : 0;
    this.smoke.update(dt);
    this.fire.update(dt);
  }

  updatePieces(dt) {
    for (const pc of this.pieces) {
      pc.t += dt;
      const pv = pc.pivot;
      if (pc.mode === 'topple') {
        if (!pc.landed) {
          if (pc.angle < pc.maxAngle) {
            // Rod tipping over its base edge
            pc.angVel += ((3 * G) / (2 * pc.len)) * Math.sin(pc.angle + 0.03) * dt;
            pc.angle = Math.min(pc.maxAngle, pc.angle + pc.angVel * dt);
          }
          // The break point drops as the stump below gives way
          const floor = pc.ground - 0.5;
          if (pv.position.y > floor) {
            pc.fallV += G * dt * (pc.angle > 0.6 ? 1 : 0.35);
            pv.position.y = Math.max(floor, pv.position.y - pc.fallV * dt);
          }
          // Dust streaming off the leaning tower
          if (Math.random() < dt * 8) {
            _p.set(0, Math.random() * pc.len, 0).applyQuaternion(pv.quaternion).add(pv.position);
            this.smoke.emit(_p, _v.set(rand(-2, 2), rand(-2, 1), rand(-2, 2)), { life: 5, size0: 4, size1: 22, alpha: 0.4, color: [0.62, 0.6, 0.56], drag: 0.8, rise: 0.2 });
          }
          if (pc.angle >= pc.maxAngle && pv.position.y <= floor + 0.01) this.landPiece(pc);
          else if (pc.t > 14) this.landPiece(pc);
        } else {
          // Crumble into the ground after landing
          pc.sunk += pc.sinkRate * dt;
          pv.position.y -= pc.sinkRate * dt;
          if (pc.sunk > pc.thick + 2) pc.done = true;
        }
      } else {
        // Sinking stump or crumbling house, with a slight lean and shudder
        if (pc.angle < pc.maxAngle) pc.angle = Math.min(pc.maxAngle, pc.angle + dt * 0.25);
        pc.sunk += pc.sinkRate * dt;
        pv.position.y -= pc.sinkRate * dt;
        if (Math.random() < dt * 10) this.dust(pv.position.x, pc.ground, pv.position.z, Math.max(pc.b.w, pc.b.d) * 0.6, 0.3);
        if (pc.sunk > pc.h + 1) pc.done = true;
      }
      _q.setFromAxisAngle(pc.axis, pc.angle);
      pv.quaternion.copy(pc.yaw).multiply(_q);
      if (pc.mode !== 'topple' || !pc.landed) pv.position.x += Math.sin(pc.t * 40) * 0.02;
    }
    for (const pc of this.pieces.filter((x) => x.done)) this.removePiece(pc);
    this.pieces = this.pieces.filter((x) => !x.done);
  }

  // A toppled top hits the ground: dust along its length, debris, rubble, and
  // damage to whatever it fell on
  landPiece(pc) {
    pc.landed = true;
    pc.sinkRate = Math.max(1.2, pc.thick / 7);
    const pv = pc.pivot;
    _dir.set(pc.dirX, 0, pc.dirZ).applyQuaternion(pc.yaw);
    const len = pc.len;
    const cx = pv.position.x + _dir.x * len * 0.5;
    const cz = pv.position.z + _dir.z * len * 0.5;
    const cy = terrainHeight(cx, cz);
    const steps = Math.max(2, Math.round(len / 20));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const x = pv.position.x + _dir.x * len * f,
        z = pv.position.z + _dir.z * len * f;
      this.dust(x, terrainHeight(x, z), z, pc.thick, 0.8);
    }
    for (let i = 0; i < 25; i++) {
      const f = Math.random();
      _p.set(pv.position.x + _dir.x * len * f, cy + 3, pv.position.z + _dir.z * len * f);
      this.addChunk(_p, _v.set(rand(-10, 10), rand(4, 14), rand(-10, 10)), rand(0.6, 2.2), pc.b.tint);
    }
    const yawAngle = Math.atan2(_dir.x, _dir.z);
    this.addRubble(cx, cz, pc.thick * 0.9, len * 0.9, -yawAngle, Math.min(6, 1 + pc.thick * 0.12), pc.b.tint);
    this.sound(cx, cy, cz, Math.min(1.8, 0.6 + len / 70));
    this.game.combat && this.game.combat.addShake && this.game.combat.addShake(_p.set(cx, cy, cz), len * 3);
    // Domino: heavy damage to buildings under the falling tower
    const hits = this.cities.buildingsNear(_p.set(cx, cy + 5, cz), len * 0.45);
    for (const { building } of hits) {
      if (building === pc.b) continue;
      if (building.hp === undefined) {
        building.maxHp = buildingHealth(building);
        building.hp = building.maxHp;
      }
      this.damage(building, building.maxHp * 0.75 + len * 20, _p, { dir: _dir });
    }
  }

  removePiece(pc) {
    this.scene.remove(pc.pivot);
    pc.mesh.dispose();
  }

  updateChunks(dt) {
    const list = this.chunks;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.age += dt;
      if (c.age > c.life) continue;
      if (!c.rest) {
        c.v.y -= G * dt;
        c.v.multiplyScalar(1 - 0.15 * dt);
        c.p.addScaledVector(c.v, dt);
        _q.setFromEuler(_e.set(c.w.x * dt, c.w.y * dt, c.w.z * dt));
        c.q.multiply(_q);
        const gy = terrainHeight(c.p.x, c.p.z) + c.s.y * 0.4;
        if (c.p.y < gy) {
          c.p.y = gy;
          if (c.v.y < -3) {
            c.v.y *= -0.3;
            c.v.x *= 0.5;
            c.v.z *= 0.5;
            c.w.multiplyScalar(0.5);
          } else c.rest = true;
        }
      }
      // Sink out of sight at the end of life
      const fade = c.life - c.age < 2 ? (c.life - c.age) / 2 : 1;
      list[n++] = c;
      _s.copy(c.s).multiplyScalar(fade);
      _m.compose(c.p, c.q, _s);
      this.chunkMesh.setMatrixAt(n - 1, _m);
      this.chunkMesh.setColorAt(n - 1, _c.setRGB(c.color[0], c.color[1], c.color[2]));
    }
    list.length = n;
    this.chunkMesh.count = n;
    if (n) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
      this.chunkMesh.instanceColor.needsUpdate = true;
    }
  }

  writeRubble() {
    this.rubbleDirty = false;
    const list = this.rubble;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      _q.setFromAxisAngle(_up, r.ry);
      _m.compose(_p.set(r.x, r.y, r.z), _q, _s.set(r.sx, r.sy, r.sz));
      this.rubbleMesh.setMatrixAt(i, _m);
      this.rubbleMesh.setColorAt(i, _c.setRGB(r.color[0], r.color[1], r.color[2]));
    }
    this.rubbleMesh.count = list.length;
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
    if (this.rubbleMesh.instanceColor) this.rubbleMesh.instanceColor.needsUpdate = true;
  }

  updateBurning(dt) {
    const cam = this.game.camera.position;
    for (const f of this.burning) {
      f.t += dt;
      if (f.building && f.building.destroyed) f.t = f.life;
      const far = Math.hypot(cam.x - f.x, cam.z - f.z) > 30000;
      if (far) continue;
      const k = Math.max(0, 1 - f.t / f.life);
      if (Math.random() < f.rate * k * dt) {
        _p.set(f.x + rand(-3, 3) * f.size, f.y + 2, f.z + rand(-3, 3) * f.size);
        const g = rand(0.08, 0.2);
        this.smoke.emit(_p, _v.set(rand(-1, 1), rand(3, 7), rand(-1, 1)), { life: rand(10, 16), size0: 4 * f.size, size1: 30 * f.size, alpha: 0.5 * Math.min(1, k * 2), color: [g, g, g * 0.95], drag: 0.3, rise: 3.5 });
      }
      if (f.t < f.fire && Math.random() < dt * 12) {
        _p.set(f.x + rand(-4, 4) * f.size, f.y + rand(0, 3), f.z + rand(-4, 4) * f.size);
        this.fire.emit(_p, _v.set(rand(-1, 1), rand(2, 6), rand(-1, 1)), { life: rand(0.5, 1.1), size0: 3 * f.size, size1: 8 * f.size, alpha: 0.85, color: [1, rand(0.4, 0.6), 0.12], drag: 1.5, rise: 2 });
      }
    }
    this.burning = this.burning.filter((f) => f.t < f.life);
  }

  // ------------------------------------------------------------------ reset
  // Rebuild the city (new flight, back to the menu)
  reset() {
    for (const b of this.destroyed) this.cities.showBuilding(b);
    for (const b of this.damaged) {
      b.hp = b.maxHp;
      b.smoking = false;
    }
    this.destroyed = [];
    this.damaged.clear();
    for (const pc of this.pieces) this.removePiece(pc);
    this.pieces = [];
    this.chunks = [];
    this.chunkMesh.count = 0;
    this.rubble = [];
    this.rubbleMesh.count = 0;
    this.burning = [];
    this.collapsedCount = 0;
    for (const m of this.scorches) m.visible = false;
    for (const ps of [this.smoke, this.fire]) {
      ps.count = 0;
      ps.next = 0;
    }
    this.flashLevel = 0;
    this.flash.intensity = 0;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _e = new THREE.Euler();
