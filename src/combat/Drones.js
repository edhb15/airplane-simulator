// Remote-controlled target drones for gunnery practice: fly circuits with a
// gentle weave, take damage from cannon rounds and fall burning when destroyed.

import * as THREE from 'three';
import { terrainHeight, waterLevelAt } from '../world/terrainGen.js';

const G = 9.81;
let droneMeshes = null;

function droneGeometry() {
  if (droneMeshes) return droneMeshes;
  const body = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.5, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6 });
  // Fuselage along -Z (nose forward), delta wing, twin fins, engine pod
  const fus = new THREE.CylinderGeometry(0.32, 0.38, 4.6, 12);
  fus.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.32, 1.1, 12);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, -2.85);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.6);
  wingShape.lineTo(1.9, 1.2);
  wingShape.lineTo(1.9, 1.7);
  wingShape.lineTo(0, 1.7);
  wingShape.lineTo(-1.9, 1.7);
  wingShape.lineTo(-1.9, 1.2);
  wingShape.closePath();
  const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false });
  wing.rotateX(Math.PI / 2);
  wing.translate(0, 0, 0);
  const fin = new THREE.BoxGeometry(0.05, 0.75, 0.9);
  const finL = fin.clone().translate(-0.45, 0.4, 1.7);
  const finR = fin.clone().translate(0.45, 0.4, 1.7);
  finL.rotateZ(0.2);
  finR.rotateZ(-0.2);
  const pod = new THREE.CylinderGeometry(0.22, 0.26, 1.2, 10);
  pod.rotateX(Math.PI / 2);
  pod.translate(0, 0.42, 1.4);
  droneMeshes = { body, white, dark, fus, nose, wing, finL, finR, pod };
  return droneMeshes;
}

function buildDrone() {
  const m = droneGeometry();
  const g = new THREE.Group();
  const add = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(m.fus, m.body);
  add(m.nose, m.white);
  add(m.wing, m.body);
  add(m.finL, m.white);
  add(m.finR, m.white);
  add(m.pod, m.dark);
  // Strobe so the small target can be spotted at range
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
  strobe.position.set(0, 0.55, 0.2);
  g.add(strobe);
  return { group: g, strobe };
}

export class TargetDrone {
  constructor(scene, opts) {
    this.scene = scene;
    this.id = opts.id;
    this.callsign = opts.callsign || 'DRONE';
    this.center = { x: opts.x, z: opts.z };
    this.orbit = opts.radius || 1800;
    this.speed = opts.speed || 110;
    this.dirSign = opts.dir || 1;
    this.alt = opts.alt;
    this.weave = opts.weave ?? 60;
    this.angle = opts.phase ?? Math.random() * Math.PI * 2;
    this.radius = 4.5; // hit radius (m), a little generous for a 4 m drone
    this.health = 100;
    this.alive = true;
    this.state = 'flying';
    this.time = Math.random() * 10;
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    const d = buildDrone();
    this.group = d.group;
    this.strobe = d.strobe;
    scene.add(this.group);
    this.update(0);
  }

  getPosition(out) {
    return out.copy(this.group.position);
  }

  getVelocity(out) {
    return out.copy(this.vel);
  }

  // Returns true when this hit destroyed the drone
  onHit(dmg) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flashHit = 0.08;
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'falling';
      this.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6);
      return true;
    }
    return false;
  }

  update(dt, fx = null) {
    this.time += dt;
    const p = this.group.position;
    if (this.state === 'flying') {
      const w = (this.speed / this.orbit) * this.dirSign;
      this.angle += w * dt;
      const x = this.center.x + Math.cos(this.angle) * this.orbit;
      const z = this.center.z + Math.sin(this.angle) * this.orbit;
      const y = Math.max(this.alt + Math.sin(this.time * 0.35) * this.weave, terrainHeight(x, z) + 150);
      if (dt > 0) this.vel.set((x - p.x) / dt, (y - p.y) / dt, (z - p.z) / dt);
      p.set(x, y, z);
      // Face along the circle, banked into the turn
      const heading = Math.atan2(-Math.sin(this.angle) * this.dirSign, Math.cos(this.angle) * this.dirSign);
      const bank = Math.atan((this.speed * this.speed) / (this.orbit * G)) * this.dirSign;
      this.group.rotation.set(0, 0, 0);
      this.group.rotateY(heading + Math.PI);
      this.group.rotateZ(-bank);
      this.strobe.visible = this.time % 1.2 < 0.12 || (this.flashHit || 0) > 0;
      if (this.flashHit) this.flashHit = Math.max(0, this.flashHit - dt);
    } else if (this.state === 'falling') {
      this.vel.y -= G * dt;
      this.vel.multiplyScalar(1 - 0.25 * dt);
      p.addScaledVector(this.vel, dt);
      this.group.rotateX(this.spin.x * dt);
      this.group.rotateY(this.spin.y * dt);
      this.group.rotateZ(this.spin.z * dt);
      this.strobe.visible = false;
      if (fx) {
        fx.smoke.emit(p, _v.copy(this.vel).multiplyScalar(0.2), { life: 6, size0: 2, size1: 14, alpha: 0.55, color: [0.1, 0.1, 0.1], drag: 0.6, rise: 1 });
        if (Math.random() < 0.8) fx.fire.emit(p, _v.copy(this.vel).multiplyScalar(0.3), { life: 0.35, size0: 3, size1: 6, alpha: 0.9, color: [1, 0.5, 0.12], drag: 2 });
      }
      const ground = Math.max(terrainHeight(p.x, p.z), waterLevelAt(p.x, p.z));
      if (p.y <= ground) {
        p.y = ground;
        this.state = 'dead';
        this.deadTime = 0;
        if (fx) {
          for (let k = 0; k < 40; k++) fx.fire.emit(p, _v.set((Math.random() - 0.5) * 20, Math.random() * 15, (Math.random() - 0.5) * 20), { life: 0.8 + Math.random(), size0: 4, size1: 14, alpha: 0.9, color: [1, 0.55, 0.15], drag: 2.5, rise: 3 });
        }
      }
    } else if (this.state === 'dead') {
      this.deadTime += dt;
      this.group.visible = false;
    }
  }

  // Mid-air explosion when destroyed
  explode(fx) {
    const p = this.group.position;
    for (let k = 0; k < 60; k++) fx.fire.emit(p, _v.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30).addScaledVector(this.vel, 0.5), { life: 0.6 + Math.random() * 0.8, size0: 4, size1: 16, alpha: 0.95, color: [1, 0.6 + Math.random() * 0.2, 0.2], drag: 2.5, rise: 1 });
    for (let k = 0; k < 20; k++) fx.smoke.emit(p, _v.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12).addScaledVector(this.vel, 0.3), { life: 8, size0: 4, size1: 24, alpha: 0.5, color: [0.12, 0.12, 0.12], drag: 0.8 });
  }

  get finished() {
    return this.state === 'dead' && this.deadTime > 2;
  }

  dispose() {
    this.scene.remove(this.group);
    this.strobe.geometry.dispose();
    this.strobe.material.dispose();
  }
}

const _v = new THREE.Vector3();
