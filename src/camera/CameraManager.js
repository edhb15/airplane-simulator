// Camera modes: cockpit, cabin, chase (orbit), wing, cinematic, tower, fly-by.

import * as THREE from 'three';
import { nearestAirport } from '../world/airportGeometry.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export const CAMERA_MODES = ['cockpit', 'cabin', 'chase', 'wing', 'cinematic', 'tower', 'flyby'];
export const CAMERA_LABELS = {
  cockpit: 'Cockpit',
  cabin: 'Passenger Cabin',
  chase: 'External',
  wing: 'Wing View',
  cinematic: 'Cinematic',
  tower: 'Tower',
  flyby: 'Fly-by',
};

function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

export class CameraManager {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.mode = 'chase';
    this.baseFov = game.settings.get('graphics').fov || 60;
    this.fov = this.baseFov;
    this.head = { yaw: 0, pitch: -6 * DEG, tyaw: 0, tpitch: -6 * DEG };
    this.orbit = { yaw: 0, pitch: 12 * DEG, dist: 1, tdist: 1, followYaw: 0 };
    this.wingSub = 0;
    this.cine = { shot: null, time: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fov: 50 };
    this.flybyPos = new THREE.Vector3();
    this.shake = new THREE.Vector3();
    this.gOffset = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.listeners = [];
    this.lookSnap = null;
    game.input.on((ev) => {
      if (ev.type === 'wheel' && game.state === 'flying' && !game.ui.modalOpen) this.onWheel(ev.delta, ev.shift);
    });
  }

  get inside() {
    return this.mode === 'cockpit' || this.mode === 'cabin';
  }

  setMode(mode) {
    const p = this.game.player;
    if (mode === 'cabin' && p && !p.hasCabin) mode = 'cockpit';
    if (mode === this.mode && mode === 'wing') this.wingSub = (this.wingSub + 1) % 2;
    if (mode === this.mode && mode === 'cinematic') this.cine.shot = null;
    this.mode = mode;
    if (mode === 'cockpit') {
      this.head.tyaw = this.head.yaw = 0;
      this.head.tpitch = this.head.pitch = -6 * DEG;
      this.fov = this.baseFov + 5;
    } else if (mode === 'cabin') {
      // Look out of the window, slightly forward and down towards the wing
      this.head.tyaw = this.head.yaw = -62 * DEG * (p ? Math.sign(p.spec.cabinEye[0] || 1) : 1);
      this.head.tpitch = this.head.pitch = -10 * DEG;
      this.fov = this.baseFov + 10;
    } else if (mode === 'flyby' && p) {
      this.placeFlyby();
    } else if (mode === 'cinematic') {
      this.cine.shot = null;
    } else {
      this.fov = this.baseFov;
    }
    for (const fn of this.listeners) fn(mode);
  }

  cycle(dir = 1) {
    const i = CAMERA_MODES.indexOf(this.mode);
    let next = CAMERA_MODES[(i + dir + CAMERA_MODES.length) % CAMERA_MODES.length];
    const p = this.game.player;
    if (next === 'cabin' && p && !p.hasCabin) next = CAMERA_MODES[(CAMERA_MODES.indexOf(next) + dir + CAMERA_MODES.length) % CAMERA_MODES.length];
    this.setMode(next);
  }

  onWheel(delta, shift) {
    if (this.inside) {
      if (this.game.player && this.game.player.cockpit && this.game.player.cockpit.hovering && !shift) return;
      this.fov = THREE.MathUtils.clamp(this.fov + delta * 4, 25, 95);
    } else if (this.mode === 'chase') {
      this.orbit.tdist = THREE.MathUtils.clamp(this.orbit.tdist * (delta > 0 ? 1.12 : 0.89), 0.35, 8);
    } else {
      this.fov = THREE.MathUtils.clamp(this.fov + delta * 3, 5, 90);
    }
  }

  lookCenter() {
    this.head.tyaw = this.mode === 'cabin' ? this.head.tyaw : 0;
    this.head.tpitch = -6 * DEG;
    this.orbit.yaw = 0;
    this.orbit.pitch = 12 * DEG;
    this.lookSnap = null;
  }

  placeFlyby() {
    const p = this.game.player;
    const fm = p.sim.fm;
    const v = _v.copy(fm.velocity);
    const speed = Math.max(20, v.length());
    v.normalize();
    const side = _v2.crossVectors(v, UP).normalize();
    const ahead = Math.min(1200, speed * 7);
    this.flybyPos.copy(fm.position).addScaledVector(v, ahead).addScaledVector(side, p.spec.wing.span * 1.6 + 25);
    this.flybyPos.y += 6;
    const g = this.game.world.heightAt(this.flybyPos.x, this.flybyPos.z);
    this.flybyPos.y = Math.max(this.flybyPos.y, g + 2);
  }

  // Cinematic director chooses shots
  nextShot() {
    const p = this.game.player;
    const fm = p.sim.fm;
    const span = p.spec.wing.span;
    const speed = fm.groundSpeed;
    const types = fm.wow && speed < 3 ? ['orbit', 'low', 'orbit'] : ['flyby', 'orbit', 'chase', 'side', 'flyby', 'low', 'below'];
    const type = types[Math.floor(Math.random() * types.length)];
    const c = this.cine;
    c.shot = type;
    c.time = 0;
    c.duration = 7 + Math.random() * 6;
    c.yaw = Math.random() * Math.PI * 2;
    c.side = Math.random() < 0.5 ? -1 : 1;
    c.fov = 40 + Math.random() * 20;
    if (type === 'flyby' || type === 'low') {
      const v = _v.copy(fm.velocity);
      if (v.lengthSq() < 1) v.set(0, 0, -1).applyQuaternion(fm.quaternion);
      v.y = 0;
      v.normalize();
      const sideV = _v2.crossVectors(v, UP).normalize().multiplyScalar(c.side);
      const ahead = speed > 5 ? Math.min(1500, speed * c.duration * 0.55) : span * 2;
      c.pos.copy(fm.position).addScaledVector(v, ahead).addScaledVector(sideV, span * (type === 'low' ? 0.9 : 1.5) + 20);
      const g = this.game.world.heightAt(c.pos.x, c.pos.z);
      c.pos.y = type === 'low' ? g + 1.6 : Math.max(g + 3, fm.position.y + (Math.random() - 0.3) * span * 0.8);
      c.fov = 35;
    }
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const cam = this.camera;
    if (!p) return;
    const fm = p.sim.fm;
    const input = game.input;
    const md = input.consumeMouseDelta();
    const span = p.spec.wing.span;
    const len = p.spec.model.fuselage.tailZ - p.spec.model.fuselage.noseZ;
    const size = Math.max(span, len);

    // Shake from ground roll, turbulence, buffet, touchdowns
    const shakeAmp = p.shakeAmount || 0;
    const t = performance.now() / 1000;
    this.shake.set(Math.sin(t * 37) * 0.6 + Math.sin(t * 53) * 0.4, Math.sin(t * 41 + 1) * 0.7 + Math.sin(t * 67) * 0.3, Math.sin(t * 29 + 2) * 0.5).multiplyScalar(shakeAmp);

    let near = 0.3;
    if (this.mode === 'cockpit' || this.mode === 'cabin') {
      near = 0.04;
      // Head look
      if (md.dx || md.dy) {
        this.head.tyaw -= md.dx * 0.0035;
        this.head.tpitch -= md.dy * 0.0035;
        this.lookSnap = null;
      }
      this.head.tyaw -= input.axes.lookX * 1.8 * dt;
      this.head.tpitch -= input.axes.lookY * 1.4 * dt;
      if (input.isDown('lookBack')) this.lookSnap = 'back';
      if (this.lookSnap === 'back') this.head.tyaw = Math.PI * 0.95;
      const yawLim = this.mode === 'cabin' ? 170 * DEG : 165 * DEG;
      this.head.tyaw = THREE.MathUtils.clamp(this.head.tyaw, -yawLim, yawLim);
      this.head.tpitch = THREE.MathUtils.clamp(this.head.tpitch, -65 * DEG, 80 * DEG);
      this.head.yaw = damp(this.head.yaw, this.head.tyaw, 12, dt);
      this.head.pitch = damp(this.head.pitch, this.head.tpitch, 12, dt);
      const eye = this.mode === 'cockpit' ? p.spec.eye : (p.cabin && p.cabin.eye) || p.spec.cabinEye;
      // G-force head movement
      const sf = fm.specificForce;
      const gx = THREE.MathUtils.clamp(-sf.x / 9.81, -2, 2) * 0.012;
      const gy = THREE.MathUtils.clamp(-(sf.y / 9.81 - 1), -3, 6) * 0.01;
      const gz = THREE.MathUtils.clamp(sf.z / 9.81, -1, 1) * 0.02;
      this.gOffset.x = damp(this.gOffset.x, gx, 6, dt);
      this.gOffset.y = damp(this.gOffset.y, gy, 6, dt);
      this.gOffset.z = damp(this.gOffset.z, gz, 6, dt);
      _v.set(eye[0], eye[1], eye[2]).add(this.gOffset).addScaledVector(this.shake, 0.01);
      _v.applyQuaternion(fm.quaternion).add(fm.position);
      cam.position.copy(_v);
      _e.set(this.head.pitch, this.head.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      cam.quaternion.copy(fm.quaternion).multiply(_q);
    } else if (this.mode === 'chase') {
      const o = this.orbit;
      if (md.dx || md.dy) {
        o.yaw -= md.dx * 0.005;
        o.pitch = THREE.MathUtils.clamp(o.pitch + md.dy * 0.004, -70 * DEG, 85 * DEG);
      }
      o.yaw -= input.axes.lookX * 1.5 * dt;
      o.pitch = THREE.MathUtils.clamp(o.pitch + input.axes.lookY * 1.2 * dt, -70 * DEG, 85 * DEG);
      o.dist = damp(o.dist, o.tdist, 6, dt);
      // Follow the aircraft's heading (track when moving) with lag
      const att = p.attitude;
      let hdg = att.heading;
      if (fm.groundSpeed > 30) hdg = fm.track;
      let d = hdg - o.followYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      o.followYaw += d * (1 - Math.exp(-3 * dt));
      const yaw = o.followYaw + o.yaw;
      const dist = size * 1.25 * o.dist + 6;
      // Behind the aircraft (opposite its forward vector) and raised by the orbit pitch
      const offset = _v.set(-Math.sin(yaw) * Math.cos(o.pitch) * dist, Math.sin(o.pitch) * dist, Math.cos(yaw) * Math.cos(o.pitch) * dist);
      const target = _v2.copy(fm.position).addScaledVector(fm.velocity, 0.0);
      cam.position.copy(target).add(offset);
      const g = game.world.heightAt(cam.position.x, cam.position.z);
      if (cam.position.y < g + 1.5) cam.position.y = g + 1.5;
      cam.position.addScaledVector(this.shake, 0.03);
      _m.lookAt(cam.position, target.add(_v.set(0, size * 0.06, 0)), UP);
      cam.quaternion.setFromRotationMatrix(_m);
      near = 0.5;
    } else if (this.mode === 'wing') {
      const w = p.spec.model.wing;
      const side = -1;
      let pos, look;
      if (this.wingSub === 0) {
        // Above the wing root looking out along the wing
        pos = _v.set(side * (p.spec.model.fuselage.radius || 0.7) * 1.2, w.y + 1.4 + (w.mount === 'high' ? 0.3 : 0), w.rootLE + w.rootChord * 0.75);
        look = _v2.set(side * w.span * 0.45, w.y, w.rootLE + Math.tan(w.sweep * DEG) * w.span * 0.3);
      } else {
        // Near the wingtip looking back at the fuselage
        pos = _v.set(side * w.span * 0.48, w.y + 1.2, w.rootLE + Math.tan(w.sweep * DEG) * w.span * 0.48 - 3);
        look = _v2.set(0, 0.5, w.rootLE + w.rootChord * 0.3);
      }
      const wp = pos.clone().applyQuaternion(fm.quaternion).add(fm.position);
      const wl = look.clone().applyQuaternion(fm.quaternion).add(fm.position);
      cam.position.copy(wp);
      const up = _v.set(0, 1, 0).applyQuaternion(fm.quaternion);
      _m.lookAt(wp, wl, up);
      cam.quaternion.setFromRotationMatrix(_m);
      if (md.dx || md.dy) {
        this.head.tyaw -= md.dx * 0.003;
        this.head.tpitch -= md.dy * 0.003;
      }
      _q.setFromEuler(_e.set(THREE.MathUtils.clamp(this.head.tpitch + 6 * DEG, -1, 1), THREE.MathUtils.clamp(this.head.tyaw, -1.5, 1.5), 0, 'YXZ'));
      cam.quaternion.multiply(_q);
      near = 0.1;
    } else if (this.mode === 'cinematic') {
      const c = this.cine;
      c.time += dt;
      if (!c.shot || c.time > c.duration) this.nextShot();
      const target = _v2.copy(fm.position);
      if (c.shot === 'flyby' || c.shot === 'low') {
        cam.position.copy(c.pos);
        const d = cam.position.distanceTo(target);
        const ang = 2 * Math.atan((size * 1.4) / Math.max(1, d)) / DEG;
        this.fov = THREE.MathUtils.clamp(ang, 6, 65);
        if (c.time > 2 && d > Math.max(400, size * 12) && _v.subVectors(target, cam.position).dot(fm.velocity) > 0) this.nextShot();
      } else if (c.shot === 'orbit') {
        const yaw = c.yaw + c.time * 0.18 * c.side;
        const dist = size * 1.9;
        cam.position.set(target.x + Math.sin(yaw) * dist, target.y + size * 0.35, target.z + Math.cos(yaw) * dist);
        this.fov = 45;
      } else if (c.shot === 'chase' || c.shot === 'below') {
        const back = _v.set(0, c.shot === 'below' ? -size * 0.25 : size * 0.18, size * 1.4).applyQuaternion(fm.quaternion);
        back.x += Math.sin(c.time * 0.5) * size * 0.2;
        cam.position.copy(target).add(back);
        this.fov = 50;
      } else if (c.shot === 'side') {
        const right = _v.set(c.side * size * 1.3, size * 0.1, -size * 0.2 + Math.sin(c.time * 0.3) * size * 0.4).applyQuaternion(fm.quaternion);
        cam.position.copy(target).add(right);
        this.fov = 42;
      }
      const g = game.world.heightAt(cam.position.x, cam.position.z);
      if (cam.position.y < g + 1.2) cam.position.y = g + 1.2;
      _m.lookAt(cam.position, target, UP);
      cam.quaternion.setFromRotationMatrix(_m);
      near = 0.5;
    } else if (this.mode === 'tower') {
      const na = nearestAirport(fm.position.x, fm.position.z);
      const tp = na.airport ? game.world.airports && game.world.airports.towerPosition(na.airport.icao) : null;
      if (tp && na.distance < 25000) cam.position.set(tp.x, tp.y, tp.z);
      else {
        // No tower nearby: a ground observer near the aircraft's path
        if (!this.groundObs || this.groundObs.distanceTo(fm.position) > 15000) {
          this.groundObs = fm.position.clone().add(_v.set(800, 0, 800));
          this.groundObs.y = game.world.heightAt(this.groundObs.x, this.groundObs.z) + 2;
        }
        cam.position.copy(this.groundObs);
      }
      const d = cam.position.distanceTo(fm.position);
      const ang = (2 * Math.atan((size * 2.4) / Math.max(1, d))) / DEG;
      this.fov = THREE.MathUtils.clamp(ang, 3, 60);
      _m.lookAt(cam.position, fm.position, UP);
      cam.quaternion.setFromRotationMatrix(_m);
      near = 1;
    } else if (this.mode === 'flyby') {
      cam.position.copy(this.flybyPos);
      const d = cam.position.distanceTo(fm.position);
      if (d > Math.max(2500, size * 30)) this.placeFlyby();
      this.fov = THREE.MathUtils.clamp((2 * Math.atan((size * 1.6) / Math.max(1, d))) / DEG, 8, 60);
      _m.lookAt(cam.position, fm.position, UP);
      cam.quaternion.setFromRotationMatrix(_m);
    }

    if (Math.abs(cam.fov - this.fov) > 0.01 || cam.near !== near) {
      cam.fov = damp(cam.fov, this.fov, 8, dt);
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  // Simple orbiting camera for the main menu / hangar background
  menuOrbit(dt, target, radius, height, speed = 0.05) {
    this.menuAngle = (this.menuAngle || 0) + dt * speed;
    const cam = this.camera;
    cam.position.set(target.x + Math.sin(this.menuAngle) * radius, target.y + height, target.z + Math.cos(this.menuAngle) * radius);
    const g = this.game.world.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < g + 2) cam.position.y = g + 2;
    _m.lookAt(cam.position, target, UP);
    cam.quaternion.setFromRotationMatrix(_m);
    if (cam.near !== 0.5 || Math.abs(cam.fov - 50) > 0.1) {
      cam.near = 0.5;
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
