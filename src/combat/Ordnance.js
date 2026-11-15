// Air-to-air / air-to-ground stores for the fighters: guided missiles and
// free-fall bombs. WeaponSystem hangs them on wing pylons, runs the missile
// seeker (air targets, or the building / ground point under the nose), the
// bomb impact sight (CCIP) and releases them; Missile and Bomb fly until they
// hit something and ask the CombatManager to explode.

import * as THREE from 'three';
import { terrainHeight, waterLevelAt } from '../world/terrainGen.js';

const G = 9.81;
const DEG = Math.PI / 180;

export const MISSILE = {
  name: 'Short-range missile',
  motorDelay: 0.25, // s of free fall after release before the motor lights
  burn: 2.8, // s
  accel: 270, // m/s² while burning
  drag: 7e-5, // per metre: speed loss = drag * v²
  maxSpeed: 1050,
  maxG: 32,
  life: 22,
  fuse: 11, // proximity fuse radius against aircraft (m)
  damage: 2600, // blast damage at the centre (buildings)
  radius: 22,
  airDamage: 120, // direct hit on an aircraft or drone
  seekerCone: 28, // degrees off the nose
  range: 9000,
  lockTime: 0.7,
};

export const BOMB = {
  name: '500 lb bomb',
  drag: 1.2e-4,
  damage: 7000,
  radius: 55,
  life: 90,
};

// ---------------------------------------------------------------- models
let parts = null;
function storeParts() {
  if (parts) return parts;
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ebe8, roughness: 0.45, metalness: 0.2 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x6d737a, roughness: 0.5, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.4, metalness: 0.3 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4f5638, roughness: 0.7, metalness: 0.15 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.6 });
  // Missile along -Z: 2.9 m long, 0.13 m body
  const mBody = new THREE.CylinderGeometry(0.064, 0.064, 2.5, 10);
  mBody.rotateX(Math.PI / 2);
  const mNose = new THREE.ConeGeometry(0.064, 0.4, 10);
  mNose.rotateX(-Math.PI / 2);
  mNose.translate(0, 0, -1.45);
  const fin = new THREE.BoxGeometry(0.012, 0.2, 0.22);
  const mFins = [];
  const mCanards = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    mFins.push(fin.clone().translate(0, 0.16, 1.08).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)));
    mCanards.push(new THREE.BoxGeometry(0.01, 0.12, 0.14).translate(0, 0.12, -0.95).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)));
  }
  // Bomb along -Z: 2.2 m, 0.36 m body
  const bBody = new THREE.CylinderGeometry(0.18, 0.15, 1.5, 14);
  bBody.rotateX(Math.PI / 2);
  const bNose = new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  bNose.rotateX(-Math.PI / 2);
  bNose.scale(1, 1, 2.4);
  bNose.translate(0, 0, -0.75);
  const bTail = new THREE.CylinderGeometry(0.15, 0.06, 0.45, 12);
  bTail.rotateX(Math.PI / 2);
  bTail.translate(0, 0, 0.97);
  const bBand = new THREE.CylinderGeometry(0.182, 0.182, 0.08, 14);
  bBand.rotateX(Math.PI / 2);
  bBand.translate(0, 0, -0.5);
  const bFins = [];
  for (let i = 0; i < 4; i++) bFins.push(new THREE.BoxGeometry(0.015, 0.32, 0.36).translate(0, 0.16, 1.0).applyMatrix4(new THREE.Matrix4().makeRotationZ((i * Math.PI) / 2 + Math.PI / 4)));
  const pylon = new THREE.BoxGeometry(0.08, 0.22, 1.1);
  pylon.translate(0, 0.11, 0);
  parts = { white, grey, dark, olive, yellow, mBody, mNose, mFins, mCanards, bBody, bNose, bTail, bBand, bFins, pylon };
  return parts;
}

export function buildMissileMesh() {
  const p = storeParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(p.mBody, p.white), new THREE.Mesh(p.mNose, p.dark));
  for (const f of p.mFins) g.add(new THREE.Mesh(f, p.grey));
  for (const f of p.mCanards) g.add(new THREE.Mesh(f, p.grey));
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function buildBombMesh() {
  const p = storeParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(p.bBody, p.olive), new THREE.Mesh(p.bNose, p.olive), new THREE.Mesh(p.bTail, p.olive), new THREE.Mesh(p.bBand, p.yellow));
  for (const f of p.bFins) g.add(new THREE.Mesh(f, p.olive));
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Pylon stations along the wing of a model: fraction of the semispan, placed
// under the local mid-chord
function wingStation(model, f, side) {
  const w = model.wing;
  const half = w.span / 2;
  const x = f * half;
  const chord = w.rootChord + (w.tipChord - w.rootChord) * f;
  const le = w.rootLE + x * Math.tan((w.sweep || 0) * DEG);
  const y = w.y + x * Math.tan((w.dihedral || 0) * DEG);
  return { x: x * side, y, z: le + chord * 0.5 };
}

// ---------------------------------------------------------------- projectiles
export class Missile {
  constructor(combat, { pos, vel, quat, target = null, point = null, building = null, cfg = MISSILE }) {
    this.combat = combat;
    this.cfg = cfg;
    this.pos = pos.clone();
    this.speed = vel.length();
    this.vel = vel.clone();
    this.dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    this.target = target;
    this.point = point ? point.clone() : null;
    this.building = building;
    this.age = 0;
    this.done = false;
    this.mesh = buildMissileMesh();
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(quat);
    combat.scene.add(this.mesh);
  }

  aimPoint(out) {
    if (this.target && this.target.alive) {
      this.target.getPosition(out);
      const tv = this.target.getVelocity ? this.target.getVelocity(_tv) : _tv.set(0, 0, 0);
      // Lead the target by the time to go
      const tgo = out.distanceTo(this.pos) / Math.max(250, this.speed);
      return out.addScaledVector(tv, Math.min(6, tgo));
    }
    if (this.point) return out.copy(this.point);
    return null;
  }

  update(dt) {
    const c = this.cfg;
    this.age += dt;
    _a.copy(this.pos);
    if (this.age < c.motorDelay) {
      // Dropped off the rail
      this.vel.y -= G * dt;
      this.pos.addScaledVector(this.vel, dt);
    } else {
      const burning = this.age < c.motorDelay + c.burn;
      if (burning) this.speed += c.accel * dt;
      this.speed -= (c.drag * this.speed * this.speed + G * this.dir.y) * dt;
      this.speed = Math.max(80, Math.min(c.maxSpeed, this.speed));
      const aim = this.aimPoint(_aim);
      if (aim) {
        _want.subVectors(aim, this.pos).normalize();
        const ang = this.dir.angleTo(_want);
        const maxTurn = ((c.maxG * G) / Math.max(100, this.speed)) * dt;
        if (ang > 1e-4) {
          _axis.crossVectors(this.dir, _want).normalize();
          this.dir.applyAxisAngle(_axis, Math.min(ang, maxTurn));
        }
      } else {
        // Unguided: gravity slowly bends the flight path
        this.dir.y -= (G / Math.max(100, this.speed)) * dt * 0.3;
        this.dir.normalize();
      }
      this.vel.copy(this.dir).multiplyScalar(this.speed);
      this.pos.addScaledVector(this.vel, dt);
      // Exhaust and smoke trail
      const fx = this.combat.destruction;
      _b.copy(this.dir).multiplyScalar(-1.5).add(this.pos);
      if (burning) {
        fx.fire.emit(_b, _v.copy(this.vel).multiplyScalar(0.6), { life: 0.08, size0: 2.2, size1: 0.8, alpha: 1, color: [1, 0.8, 0.45], drag: 0 });
        for (let k = 0; k < 2; k++) {
          _p.lerpVectors(_a, _b, k / 2);
          fx.smoke.emit(_p, _v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), { life: 4 + Math.random() * 2, size0: 1.2, size1: 9, alpha: 0.45, color: [0.88, 0.88, 0.86], drag: 0.8, rise: 0.4 });
        }
      } else if (Math.random() < 0.3) fx.smoke.emit(_b, _v.set(0, 0, 0), { life: 2, size0: 0.8, size1: 4, alpha: 0.2, color: [0.85, 0.85, 0.85], drag: 1 });
    }
    this.mesh.position.copy(this.pos);
    // Matrix4.lookAt points +Z away from the target: the nose (-Z) follows dir
    _m.lookAt(_zero, this.dir, _upv);
    this.mesh.quaternion.setFromRotationMatrix(_m);
    // Proximity fuse against the locked aircraft / drone
    if (this.target && this.target.alive) {
      this.target.getPosition(_tp);
      if (segDist2(_a, this.pos, _tp, _hp) < c.fuse * c.fuse) return this.detonate(_hp, { direct: this.target });
    }
    // Aimed at a ground point: detonate on arrival
    if (!this.target && this.point && this.pos.distanceToSquared(this.point) < 36) return this.detonate(this.point);
    // Buildings, then terrain and water
    const hit = this.combat.game.cities.raycast(_a.x, _a.y, _a.z, this.pos.x, this.pos.y, this.pos.z, _hit);
    if (hit) return this.detonate(hit.point, { building: hit.building, dir: this.dir });
    const gh = terrainHeight(this.pos.x, this.pos.z),
      wl = waterLevelAt(this.pos.x, this.pos.z);
    if (this.pos.y <= Math.max(gh, wl)) return this.detonate(_p.set(this.pos.x, Math.max(gh, wl), this.pos.z), { water: wl > gh, ground: true });
    if (this.age > c.life) return this.detonate(this.pos, { air: true });
  }

  detonate(p, opts = {}) {
    this.done = true;
    this.combat.explode(p, { radius: this.cfg.radius, damage: this.cfg.damage, airDamage: this.cfg.airDamage, size: 0.55, kind: 'missile', dir: this.dir, ...opts });
  }

  dispose() {
    this.combat.scene.remove(this.mesh);
  }
}

export class Bomb {
  constructor(combat, { pos, vel, quat, cfg = BOMB }) {
    this.combat = combat;
    this.cfg = cfg;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.age = 0;
    this.done = false;
    this.mesh = buildBombMesh();
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    combat.scene.add(this.mesh);
  }

  update(dt) {
    this.age += dt;
    _a.copy(this.pos);
    stepBomb(this.pos, this.vel, this.cfg.drag, dt);
    this.mesh.position.copy(this.pos);
    // Fins keep the nose along the flight path
    _m.lookAt(_zero, _v.copy(this.vel).normalize(), _upv);
    _q.setFromRotationMatrix(_m);
    this.mesh.quaternion.slerp(_q, Math.min(1, dt * 3));
    const hit = this.combat.game.cities.raycast(_a.x, _a.y, _a.z, this.pos.x, this.pos.y, this.pos.z, _hit);
    if (hit) return this.detonate(hit.point, { building: hit.building });
    const gh = terrainHeight(this.pos.x, this.pos.z),
      wl = waterLevelAt(this.pos.x, this.pos.z);
    if (this.pos.y <= Math.max(gh, wl)) return this.detonate(_p.set(this.pos.x, Math.max(gh, wl), this.pos.z), { water: wl > gh, ground: true });
    if (this.age > this.cfg.life) this.done = true;
  }

  detonate(p, opts = {}) {
    this.done = true;
    this.combat.explode(p, { radius: this.cfg.radius, damage: this.cfg.damage, airDamage: 150, size: 1, kind: 'bomb', dir: _v.copy(this.vel).normalize(), ...opts });
  }

  dispose() {
    this.combat.scene.remove(this.mesh);
  }
}

function stepBomb(pos, vel, drag, dt) {
  const v = vel.length();
  vel.multiplyScalar(Math.max(0, 1 - drag * v * dt));
  vel.y -= G * dt;
  pos.addScaledVector(vel, dt);
}

function segDist2(a, b, c, out) {
  _d.subVectors(b, a);
  const len2 = _d.lengthSq();
  let t = len2 > 0 ? _e.subVectors(c, a).dot(_d) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  out.copy(a).addScaledVector(_d, t);
  return out.distanceToSquared(c);
}

// ---------------------------------------------------------------- aircraft stores
export class WeaponSystem {
  // stores: { missiles: n, bombs: n } from the aircraft data
  constructor(player, stores) {
    this.player = player;
    this.stores = stores;
    this.pylons = [];
    this.lock = null; // air target being tracked
    this.lockTime = 0;
    this.locked = false;
    this.groundPoint = new THREE.Vector3();
    this.groundBuilding = null;
    this.hasGround = false;
    this.ccip = new THREE.Vector3();
    this.hasCcip = false;
    this.ccipTime = 0;
    this.fired = { missiles: 0, bombs: 0 };
    this.restTime = 0;
    this.toneTimer = 0;
    this.nextMissileSide = 1;
    this.nextBombSide = 1;
    this.buildPylons();
  }

  buildPylons() {
    const spec = this.player.spec;
    const model = spec.model;
    const root = this.player.visual.root;
    const p = storeParts();
    const nm = this.stores.missiles || 0;
    const nb = this.stores.bombs || 0;
    // Missiles from the wingtips inwards, bombs inboard
    const mFrac = [0.99, 0.76, 0.6].slice(0, Math.ceil(nm / 2));
    const bFrac = [0.48, 0.32].slice(0, Math.ceil(nb / 2));
    const add = (type, f, side, idx) => {
      const st = wingStation(model, f, side);
      const tip = f > 0.95;
      const group = new THREE.Group();
      const drop = type === 'bomb' ? 0.48 : tip ? 0 : 0.26;
      group.position.set(st.x, st.y - drop - (type === 'bomb' ? 0.08 : 0.07), st.z);
      const mesh = type === 'bomb' ? buildBombMesh() : buildMissileMesh();
      group.add(mesh);
      if (!tip) {
        const py = new THREE.Mesh(p.pylon, p.grey);
        py.position.set(0, type === 'bomb' ? 0.1 : 0.05, 0);
        py.scale.set(1, drop / 0.22, type === 'bomb' ? 1 : 0.8);
        group.add(py);
      }
      root.add(group);
      this.pylons.push({ type, side, order: idx, group, mesh, loaded: true });
    };
    for (let i = 0; i < Math.ceil(nm / 2); i++) for (const side of [-1, 1]) if (this.pylons.filter((x) => x.type === 'missile').length < nm) add('missile', mFrac[i], side, i);
    for (let i = 0; i < Math.ceil(nb / 2); i++) for (const side of [-1, 1]) if (this.pylons.filter((x) => x.type === 'bomb').length < nb) add('bomb', bFrac[i], side, i);
  }

  get missiles() {
    return this.pylons.filter((p) => p.type === 'missile' && p.loaded).length;
  }
  get bombs() {
    return this.pylons.filter((p) => p.type === 'bomb' && p.loaded).length;
  }
  get missilesMax() {
    return this.stores.missiles || 0;
  }
  get bombsMax() {
    return this.stores.bombs || 0;
  }

  get armed() {
    const sim = this.player.sim;
    return !sim.fm.wow && !sim.fm.crashed && sim.powered;
  }

  // Next loaded pylon of a type, alternating wings
  takePylon(type) {
    const key = type === 'missile' ? 'nextMissileSide' : 'nextBombSide';
    const loaded = this.pylons.filter((p) => p.type === type && p.loaded);
    if (!loaded.length) return null;
    // Outermost station first, alternating wings
    const minOrder = Math.min(...loaded.map((x) => x.order));
    const tier = loaded.filter((x) => x.order === minOrder);
    const p = tier.find((x) => x.side === this[key]) || tier[0];
    this[key] = -p.side;
    p.loaded = false;
    p.mesh.visible = false;
    return p;
  }

  pylonWorld(p, outPos, outQuat) {
    p.mesh.updateWorldMatrix(true, false);
    p.mesh.getWorldPosition(outPos);
    p.mesh.getWorldQuaternion(outQuat);
  }

  fireMissile(combat) {
    const game = this.player.game;
    if (!this.armed) return game.ui.toast(this.player.sim.fm.wow ? 'Weapons are safe on the ground' : 'Weapons unavailable', 'info', 1500);
    const p = this.takePylon('missile');
    if (!p) return game.ui.toast('Missiles empty — land and stop to rearm', 'warn', 2500);
    this.pylonWorld(p, _p, _q);
    const fm = this.player.sim.fm;
    _v.copy(fm.velocity);
    _b.set(0, -4, 0).applyQuaternion(fm.quaternion);
    _v.add(_b);
    const target = this.locked ? this.lock : null;
    combat.ordnance.push(new Missile(combat, { pos: _p, vel: _v, quat: fm.quaternion, target, point: !target && this.hasGround ? this.groundPoint : null, building: this.groundBuilding }));
    this.fired.missiles++;
    game.audio.burst({ type: 'white', filter: 'lowpass', freq: 1800, dur: 1.4, gain: 0.9, bus: 'env', decay: 0.9 });
    game.audio.burst({ type: 'brown', filter: 'lowpass', freq: 300, dur: 1.2, gain: 0.8, bus: 'env' });
    game.ui.toast(target ? `Missile away — tracking ${target.callsign || 'target'}` : this.hasGround ? 'Missile away — ground target' : 'Missile away — no lock', 'info', 1600);
    game.events.emit('weaponFired', { type: 'missile' });
  }

  releaseBomb(combat) {
    const game = this.player.game;
    if (!this.armed) return game.ui.toast(this.player.sim.fm.wow ? 'Weapons are safe on the ground' : 'Weapons unavailable', 'info', 1500);
    const p = this.takePylon('bomb');
    if (!p) return game.ui.toast('Bombs gone — land and stop to rearm', 'warn', 2500);
    this.pylonWorld(p, _p, _q);
    const fm = this.player.sim.fm;
    // Ejector pushes the bomb clear of the wing
    _v.copy(fm.velocity).add(_b.set(0, -2.5, 0).applyQuaternion(fm.quaternion));
    combat.ordnance.push(new Bomb(combat, { pos: _p, vel: _v, quat: _q }));
    this.fired.bombs++;
    game.audio.burst({ type: 'brown', filter: 'lowpass', freq: 500, dur: 0.15, gain: 0.6, bus: 'env' });
    game.events.emit('weaponFired', { type: 'bomb' });
  }

  update(dt, targets) {
    const player = this.player;
    const game = player.game;
    const fm = player.sim.fm;
    const armed = this.armed;
    // Rearm after standing still on the ground
    if (fm.wow && fm.groundSpeed < 1 && (this.missiles < this.missilesMax || this.bombs < this.bombsMax)) {
      this.restTime += dt;
      if (this.restTime > 4) {
        for (const p of this.pylons) {
          p.loaded = true;
          p.mesh.visible = true;
        }
        game.ui.toast(`Rearmed — ${this.missilesMax} missiles, ${this.bombsMax} bombs`, 'success');
      }
    } else this.restTime = 0;

    // Missile seeker: air target nearest the nose inside the cone
    const fwd = _f.set(0, 0, -1).applyQuaternion(fm.quaternion);
    let best = null,
      bestAng = MISSILE.seekerCone * DEG;
    if (armed && this.missiles > 0) {
      for (const t of targets) {
        if (!t.alive) continue;
        t.getPosition(_tp).sub(fm.position);
        const d = _tp.length();
        if (d < 150 || d > MISSILE.range) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, _tp.dot(fwd) / d)));
        if (ang < bestAng) {
          bestAng = ang;
          best = t;
        }
      }
    }
    if (best && best === this.lock) this.lockTime += dt;
    else {
      this.lock = best;
      this.lockTime = 0;
    }
    const wasLocked = this.locked;
    this.locked = !!this.lock && this.lockTime >= MISSILE.lockTime;
    if (this.locked && !wasLocked) game.audio.tone(1250, 0.12, { gain: 0.08 });
    // Seeker tone: slow growl while tracking, fast beeps when locked
    this.toneTimer -= dt;
    if (this.lock && this.toneTimer <= 0) {
      this.toneTimer = this.locked ? 0.14 : 0.45;
      game.audio.tone(this.locked ? 1180 : 620, this.locked ? 0.07 : 0.12, { gain: 0.035 });
    }

    // Ground aim and bomb impact point at 30 Hz (each walks the terrain)
    this.aimTimer = (this.aimTimer || 0) - dt;
    if (this.aimTimer > 0) return;
    this.aimTimer = 1 / 30;
    // Without an air target, a missile goes for the building or ground under the nose
    this.hasGround = false;
    this.groundBuilding = null;
    if (armed && this.missiles > 0 && !this.lock) this.groundAim(fm, fwd);
    this.hasCcip = false;
    if (armed && this.bombs > 0) this.computeCcip(fm);
  }

  groundAim(fm, fwd) {
    const cities = this.player.game.cities;
    const step = 90;
    _a.copy(fm.position);
    for (let d = step; d <= 7000; d += step) {
      _b.copy(fm.position).addScaledVector(fwd, d);
      const hit = cities.raycast(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _hit);
      if (hit) {
        this.groundPoint.copy(hit.point);
        this.groundBuilding = hit.building;
        this.hasGround = true;
        return;
      }
      const g = Math.max(terrainHeight(_b.x, _b.z), waterLevelAt(_b.x, _b.z));
      if (_b.y <= g) {
        // Refine between the last two samples
        let lo = d - step,
          hi = d;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          _p.copy(fm.position).addScaledVector(fwd, mid);
          if (_p.y <= Math.max(terrainHeight(_p.x, _p.z), waterLevelAt(_p.x, _p.z))) hi = mid;
          else lo = mid;
        }
        this.groundPoint.copy(fm.position).addScaledVector(fwd, hi);
        this.hasGround = true;
        return;
      }
      _a.copy(_b);
    }
  }

  computeCcip(fm) {
    const cities = this.player.game.cities;
    _p.copy(fm.position);
    _p.y -= 1;
    _v.copy(fm.velocity);
    const dt = 0.25;
    _a.copy(_p);
    for (let t = 0; t < 60; t += dt) {
      stepBomb(_p, _v, BOMB.drag, dt);
      if (_p.y < cities.maxTop + 5) {
        const hit = cities.raycast(_a.x, _a.y, _a.z, _p.x, _p.y, _p.z, _hit);
        if (hit) {
          this.ccip.copy(hit.point);
          this.hasCcip = true;
          this.ccipTime = t;
          return;
        }
      }
      const g = Math.max(terrainHeight(_p.x, _p.z), waterLevelAt(_p.x, _p.z));
      if (_p.y <= g) {
        // Refine along the last step
        let lo = 0,
          hi = 1;
        for (let i = 0; i < 5; i++) {
          const mid = (lo + hi) / 2;
          _b.lerpVectors(_a, _p, mid);
          if (_b.y <= Math.max(terrainHeight(_b.x, _b.z), waterLevelAt(_b.x, _b.z))) hi = mid;
          else lo = mid;
        }
        _b.lerpVectors(_a, _p, hi);
        this.ccip.set(_b.x, Math.max(terrainHeight(_b.x, _b.z), waterLevelAt(_b.x, _b.z)), _b.z);
        this.hasCcip = true;
        this.ccipTime = t + hi * dt;
        return;
      }
      _a.copy(_p);
    }
  }

  // Direction of a world point in HUD degrees (right, down of the nose)
  hudAngles(p, out) {
    const fm = this.player.sim.fm;
    _p.subVectors(p, fm.position).applyQuaternion(_qi.copy(fm.quaternion).invert());
    out.x = Math.atan2(_p.x, -_p.z) / DEG;
    out.y = Math.atan2(-_p.y, -_p.z) / DEG;
    out.behind = _p.z > 0;
    return out;
  }

  dispose() {
    for (const p of this.pylons) this.player.visual.root.remove(p.group);
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _want = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _zero = new THREE.Vector3();
const _upv = new THREE.Vector3(0, 1, 0);
const _hit = {};
