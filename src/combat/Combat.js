// Combat: rounds in flight, target drones and the list of everything that can
// be shot (drones, plus other pilots flying fighters in multiplayer).

import * as THREE from 'three';
import { BulletManager } from './Guns.js';
import { TargetDrone } from './Drones.js';
import { ParticleSystem } from '../aircraft/Effects.js';
import { terrainHeight } from '../world/terrainGen.js';
import { FT } from '../physics/atmosphere.js';

export class CombatManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.fx = { smoke: new ParticleSystem(game.scene, false), fire: new ParticleSystem(game.scene, true) };
    this.bullets = new BulletManager(game.scene, this.fx);
    this.drones = [];
    this.kills = 0;
    this.nextDroneId = 1;
    this.hitSoundTime = 0;
  }

  reset() {
    this.clearDrones();
    this.bullets.clear();
    this.kills = 0;
  }

  clearDrones() {
    for (const d of this.drones) d.dispose();
    this.drones = [];
  }

  // Spawn drones on circuits around a centre point (world metres, altitude in m)
  spawnDrones({ x, z, alt, count = 5, spread = 4000, speed = [95, 135], radius = [1200, 2600] }) {
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const cx = x + Math.cos(a) * spread * (0.3 + Math.random() * 0.7);
      const cz = z + Math.sin(a) * spread * (0.3 + Math.random() * 0.7);
      const ground = terrainHeight(cx, cz);
      const d = new TargetDrone(this.scene, {
        id: this.nextDroneId++,
        callsign: `DRONE ${i + 1}`,
        x: cx,
        z: cz,
        alt: Math.max(alt + (Math.random() - 0.5) * 400, ground + 350),
        radius: radius[0] + Math.random() * (radius[1] - radius[0]),
        speed: speed[0] + Math.random() * (speed[1] - speed[0]),
        dir: Math.random() < 0.5 ? 1 : -1,
        weave: 40 + Math.random() * 80,
      });
      d.kind = 'drone';
      d.onHitOriginal = d.onHit;
      d.onHit = (dmg, point) => this.droneHit(d, dmg, point);
      this.drones.push(d);
      list.push(d);
    }
    return list;
  }

  // Drones in front of the player (free flight practice)
  spawnPracticeDrones(count = 5) {
    const p = this.game.player;
    if (!p) return;
    const fm = p.sim.fm;
    const h = p.attitude.heading;
    const ahead = 5000;
    this.spawnDrones({ x: fm.position.x + Math.sin(h) * ahead, z: fm.position.z - Math.cos(h) * ahead, alt: Math.max(fm.position.y, terrainHeight(fm.position.x, fm.position.z) + 900), count, spread: 3000 });
    this.game.ui.toast(`${count} target drones ahead — hold Space to fire`, 'info', 4000);
  }

  droneHit(d, dmg, point) {
    const destroyed = d.onHitOriginal(dmg, point);
    const audio = this.game.audio;
    const now = performance.now();
    if (now - this.hitSoundTime > 70) {
      this.hitSoundTime = now;
      audio.burst({ type: 'white', filter: 'bandpass', freq: 2600, q: 3, dur: 0.03, gain: 0.25, bus: 'ui' });
    }
    if (destroyed) {
      this.kills++;
      d.explode(this.fx);
      audio.explosion();
      const left = this.drones.filter((x) => x.alive).length;
      this.game.ui.toast(`Splash! ${d.callsign} destroyed${left ? ` — ${left} left` : ''}`, 'success', 2500);
      this.game.events.emit('kill', { target: d });
    }
  }

  // Everything the player's rounds can hit
  targets() {
    const list = this.drones.filter((d) => d.alive);
    const mp = this.game.multiplayer;
    if (mp && mp.connected) list.push(...mp.combatTargets());
    return list;
  }

  update(dt) {
    for (const d of this.drones) d.update(dt, this.fx);
    for (const d of this.drones.filter((x) => x.finished)) d.dispose();
    this.drones = this.drones.filter((x) => !x.finished);
    this.bullets.update(dt, this.targets(), this.game.camera);
    this.fx.smoke.update(dt);
    this.fx.fire.update(dt);
  }

  // Drones for the radar, navigation display and map
  trafficFor(pos) {
    return this.drones
      .filter((d) => d.alive)
      .map((d) => {
        const p = d.group.position;
        return { x: p.x, z: p.z, alt: p.y / FT, relAlt: (p.y - pos.y) / FT, vs: d.vel.y / 0.00508, dist: Math.hypot(p.x - pos.x, p.z - pos.z), callsign: d.callsign, target: true };
      });
  }
}

export { THREE };
