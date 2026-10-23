// Runs missions, free flights and tutorials: spawn configuration, objectives,
// failure triggers, targets/rings/guidance, landing analysis and scoring.

import * as THREE from 'three';
import { CANYON_RINGS } from './missions.js';
import { getAirport, getRunwayEnd, runwayAt, runwayRelative, nearestAirport, ALL_RUNWAY_ENDS } from '../world/airportGeometry.js';
import { terrainHeight, waterLevelAt } from '../world/terrainGen.js';
import { KT, FT, FPM, NM, DEG } from '../physics/atmosphere.js';
import { AircraftVisual } from '../aircraft/AircraftVisual.js';
import { getAircraft } from '../aircraft/aircraftData.js';
import { glowTexture } from '../render/GlowPoints.js';

function landingScore(fpm) {
  const v = Math.abs(fpm);
  if (v < 100) return 100;
  if (v < 200) return 92;
  if (v < 300) return 80;
  if (v < 450) return 62;
  if (v < 600) return 40;
  return 15;
}

export function landingVerdict(fpm) {
  const v = Math.abs(fpm);
  if (v < 80) return 'Butter!';
  if (v < 180) return 'Smooth';
  if (v < 300) return 'Good';
  if (v < 450) return 'Firm';
  if (v < 600) return 'Hard';
  return 'Very hard';
}

// Smoke column marker (rescue targets)
class SmokeColumn {
  constructor(scene, pos, color) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);
    const n = 60;
    this.sprites = [];
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, opacity: 0.5 });
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.userData.t = Math.random();
      this.sprites.push(s);
      this.group.add(s);
    }
  }
  update(dt, wind) {
    for (const s of this.sprites) {
      s.userData.t = (s.userData.t + dt * 0.05) % 1;
      const t = s.userData.t;
      s.position.set(wind.x * t * 40 + Math.sin(t * 20 + s.id) * 3, t * 260, wind.z * t * 40);
      const sc = 8 + t * 70;
      s.scale.set(sc, sc, 1);
      s.material.opacity = 0.55 * (1 - t) * Math.min(1, t * 10);
    }
  }
  dispose() {
    this.scene.remove(this.group);
  }
}

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.mission = null;
    this.active = false;
    this.objects = [];
  }

  // Returns a spawn description for Game.startFlight
  static spawnFor(start, spec) {
    if (start.air) {
      const a = start.air;
      return { mode: 'air', x: a.x, z: a.z, altitude: a.altFt * FT, heading: a.heading, speed: a.kt * KT };
    }
    if (start.final) {
      const f = start.final;
      const end = getRunwayEnd(f.airport, f.runway);
      const dist = f.nm * NM;
      const off = (f.offsetDeg || 0) * DEG;
      // position on the extended centreline (optionally offset to set up an intercept)
      const bx = end.x - end.dirX * dist,
        bz = end.z - end.dirZ * dist;
      const lat = Math.tan(off) * dist * 0.35;
      const x = bx + -end.dirZ * lat,
        z = bz + end.dirX * lat;
      return { mode: 'air', x, z, altitude: end.elevation + f.altFt * FT, heading: (end.heading - (f.offsetDeg || 0) + 360) % 360, speed: (spec.speeds.vref + 40) * KT, approachEnd: end };
    }
    if (start.pattern) {
      const end = getRunwayEnd(start.pattern.airport, start.pattern.runway);
      const L = end.length;
      // left-hand downwind, abeam the runway midpoint, 1000 ft AGL
      const mx = end.x + end.dirX * L * 0.3,
        mz = end.z + end.dirZ * L * 0.3;
      const leftX = end.dirZ,
        leftZ = -end.dirX;
      return { mode: 'air', x: mx + leftX * 1100, z: mz + leftZ * 1100, altitude: end.elevation + 1000 * FT, heading: (end.heading + 180) % 360, speed: 85 * KT, patternEnd: end };
    }
    return { mode: start.spawn === 'gate' ? 'parked' : 'runway', airport: start.airport, runway: start.runway };
  }

  begin(mission, opts = {}) {
    this.cleanup();
    const game = this.game;
    this.mission = mission;
    this.kind = opts.kind || (mission ? (mission.steps ? 'tutorial' : 'mission') : 'free');
    this.active = true;
    this.failed = false;
    this.done = false;
    this.time = 0;
    this.objIndex = 0;
    this.objState = {};
    this.touchdown = null;
    this.landedAt = null;
    this.failuresFired = new Set();
    this.messages = [];
    this.stepIndex = 0;
    this.stepTime = 0;
    this.stepHold = 0;
    this.stepState = {};
    this.guideProgress = 0;
    this.startPos = game.player.position.clone();
    this.job = opts.job || null;
    const nav = game.player.sim.nav;
    if (mission) {
      const startAp = mission.start.airport || nearestAirport(this.startPos.x, this.startPos.z).airport.icao;
      if (mission.destination) nav.setRoute(startAp, mission.destination, mission.route || []);
      else if (mission.route) {
        nav.clear();
        for (const w of mission.route) nav.addWaypoint({ ...w, type: 'wpt' });
      }
      if (mission.approach && (mission.destination || mission.start.airport)) {
        const end = getRunwayEnd(mission.destination || mission.start.airport, mission.approach);
        if (end) nav.setApproach(end);
      }
      if (mission.cruiseAlt) game.player.sim.ap.alt = mission.cruiseAlt;
      // Targets
      if (mission.target) {
        const t = mission.target;
        const h = Math.max(terrainHeight(t.x, t.z), waterLevelAt(t.x, t.z));
        const pos = new THREE.Vector3(t.x, h, t.z);
        this.targetPos = pos;
        const smoke = new SmokeColumn(game.scene, pos, t.kind === 'boat' ? 0xff7a1a : 0xff3030);
        this.objects.push(smoke);
        this.smoke = smoke;
        const g = new THREE.Group();
        g.position.copy(pos);
        if (t.kind === 'boat') {
          const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 16), new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
          hull.position.y = 0.6;
          const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 5), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
          cab.position.set(0, 2.5, -2);
          g.add(hull, cab);
          g.rotation.z = 0.12;
        } else {
          const tent = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.5, 4), new THREE.MeshStandardMaterial({ color: 0xff8800 }));
          tent.position.y = 1.2;
          g.add(tent);
        }
        game.scene.add(g);
        this.objects.push({ dispose: () => game.scene.remove(g) });
      }
      if (mission.checkpoints === 'canyon') this.buildRings(CANYON_RINGS);
      if (mission.intercept) this.buildInterceptTarget(mission.intercept);
      if (mission.start && mission.start.pattern) this.buildPatternGuidance(getRunwayEnd(mission.start.pattern.airport, mission.start.pattern.runway));
    }
    if (game.settings.get('gameplay').guidance && this.kind !== 'tutorial' && nav.approach && !this.guide) this.buildApproachGuidance(nav.approach);
  }

  cleanup() {
    for (const o of this.objects) o.dispose();
    this.objects = [];
    this.rings = null;
    this.guide = null;
    this.interceptTarget = null;
    this.targetPos = null;
    this.smoke = null;
    this.active = false;
  }

  // ---------------------------------------------------------------- 3D helpers
  buildRings(list) {
    const game = this.game;
    this.rings = list.map(([x, z, alt], i) => {
      const ground = terrainHeight(x, z);
      const y = Math.max(alt, ground + 180);
      const next = list[i + 1] || list[i];
      const prev = list[i - 1] || list[i];
      const dir = new THREE.Vector3(next[0] - prev[0], 0, next[1] - prev[1]).normalize();
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(70, 4, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.85 }));
      mesh.position.set(x, y, z);
      mesh.lookAt(x + dir.x, y, z + dir.z);
      game.scene.add(mesh);
      return { mesh, pos: mesh.position.clone(), dir, passed: false };
    });
    this.objects.push({ dispose: () => this.rings && this.rings.forEach((r) => game.scene.remove(r.mesh)) });
  }

  buildInterceptTarget(t) {
    const spec = getAircraft('mj320');
    const v = new AircraftVisual(spec, 'classic', { detail: 'low', merge: true });
    this.game.scene.add(v.root);
    this.interceptTarget = { visual: v, pos: new THREE.Vector3(t.x, t.altFt * FT, t.z), heading: t.heading * DEG, speed: t.kt * KT, held: 0 };
    this.objects.push({ dispose: () => this.game.scene.remove(v.root) });
  }

  // Guidance boxes ("highway in the sky") along a path of points
  buildGuidance(points) {
    const game = this.game;
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.85, depthWrite: false });
    const boxes = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const n = points[Math.min(points.length - 1, i + 1)];
      const pr = points[Math.max(0, i - 1)];
      const dir = new THREE.Vector3(n.x - pr.x, n.y - pr.y, n.z - pr.z).normalize();
      const w = 70,
        h = 40;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, 0), new THREE.Vector3(w / 2, h / 2, 0), new THREE.Vector3(-w / 2, h / 2, 0), new THREE.Vector3(-w / 2, -h / 2, 0)]);
      const line = new THREE.Line(geo, mat);
      line.position.set(p.x, p.y, p.z);
      line.lookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z);
      g.add(line);
      boxes.push(line);
    }
    game.scene.add(g);
    this.guide = { group: g, points, boxes };
    this.objects.push({ dispose: () => game.scene.remove(g) });
  }

  buildPatternGuidance(end) {
    const pts = [];
    const L = end.length;
    const fx = end.dirX,
      fz = end.dirZ;
    const lx = fz,
      lz = -fx; // left of the landing direction
    const elev = end.elevation;
    const tpa = elev + 1000 * FT;
    const add = (a, l, y) => pts.push({ x: end.x + fx * a + lx * l, y, z: end.z + fz * a + lz * l });
    // Downwind leg (flown opposite to the landing direction)
    for (let a = L * 0.3; a >= -1100; a -= 220) add(a, 1100, tpa);
    // Base leg, descending
    const baseTop = tpa - 40,
      baseBottom = elev + 110;
    for (let l = 1100, k = 0; l >= 100; l -= 200, k++) add(-1500, l, baseTop + ((baseBottom - baseTop) * (1100 - l)) / 1000);
    // Final approach on a 3 degree glide path
    for (let a = -1500; a <= 150; a += 180) add(a, 0, elev + Math.max(12, (150 - a) * Math.tan(3 * DEG)) + 3);
    this.buildGuidance(pts);
  }

  buildApproachGuidance(end) {
    const pts = [];
    for (let d = 9000; d >= 0; d -= 450) pts.push({ x: end.x - end.dirX * d, y: end.elevation + Math.max(15, (d + 300) * Math.tan(3 * DEG)), z: end.z - end.dirZ * d });
    this.buildGuidance(pts);
    this.guide.group.visible = false;
    this.guide.approachOnly = true;
  }

  // Replace the approach guidance boxes (e.g. after selecting a runway on the map)
  setApproachGuidance(end) {
    if (this.kind === 'tutorial' || (this.guide && !this.guide.approachOnly)) return;
    if (this.guide) this.game.scene.remove(this.guide.group);
    this.guide = null;
    if (end && this.game.settings.get('gameplay').guidance) this.buildApproachGuidance(end);
  }

  // ---------------------------------------------------------------- events
  onTouchdown(ev) {
    const p = this.game.player;
    const pos = p.position;
    const rw = runwayAt(pos.x, pos.z, 8);
    let end = null,
      rel = null;
    if (rw) {
      // landing end is the one whose direction matches the heading
      const hdg = p.attitude.heading / DEG;
      end = rw.ends.reduce((best, e) => (Math.abs(((e.heading - hdg + 540) % 360) - 180) < Math.abs(((best.heading - hdg + 540) % 360) - 180) ? e : best));
      rel = runwayRelative(end, pos.x, pos.z);
    }
    const fpm = ev.vs / FPM;
    if (!this.touchdown || this.touchdown.airborneAfter) {
      this.touchdown = {
        fpm,
        runway: rw,
        end,
        along: rel ? rel.along : null,
        lateral: rel ? rel.lateral : null,
        airport: rw ? rw.airport.icao : null,
        water: false,
        time: this.time,
        verdict: landingVerdict(fpm),
      };
    }
    this.game.ui.showLandingRate(fpm, this.touchdown);
  }

  onLiftoff() {
    if (this.touchdown) this.touchdown.airborneAfter = true;
  }

  onCrash(reason) {
    if (!this.active || this.done) return;
    this.finish(false, reason);
  }

  dropSupplies() {
    const p = this.game.player;
    if (!this.mission) return;
    const obj = this.mission.objectives[this.objIndex];
    // Visual: a parachute crate falling
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xffb000 }));
    crate.position.copy(p.position);
    this.game.scene.add(crate);
    const vel = p.sim.fm.velocity.clone().multiplyScalar(0.6);
    const scene = this.game.scene;
    const obj3 = {
      t: 0,
      update: (dt) => {
        obj3.t += dt;
        vel.multiplyScalar(1 - dt * 0.6);
        vel.y = Math.max(vel.y - 9.81 * dt, -7);
        crate.position.addScaledVector(vel, dt);
        const g = Math.max(terrainHeight(crate.position.x, crate.position.z), 0);
        if (crate.position.y < g + 0.7) crate.position.y = g + 0.7;
      },
      dispose: () => scene.remove(crate),
    };
    this.objects.push(obj3);
    if (obj && obj.type === 'drop' && this.targetPos) {
      const d = Math.hypot(p.position.x - this.targetPos.x, p.position.z - this.targetPos.z);
      const agl = p.position.y - this.targetPos.y;
      if (d < obj.radius * 1.4 && agl < obj.maxAglFt * FT * 1.3) {
        this.objState.dropped = true;
        this.game.ui.toast('Supplies dropped on target!', 'success');
      } else this.game.ui.toast(`Missed — ${Math.round(d)} m from the target`, 'warn');
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const game = this.game;
    const p = game.player;
    if (!p) return;
    this.time += dt * p.sim.simRate;
    const m = this.mission;
    const fm = p.sim.fm;
    for (const o of this.objects) if (o.update) o.update(dt, p.sim.wind.mean);
    if (this.smoke) this.smoke.update(dt, p.sim.wind.mean);
    if (this.guide) {
      if (this.guide.approachOnly) {
        const ils = p.sim.nav.ils;
        this.guide.group.visible = ils.valid && ils.dist < 16000 && !fm.wow;
      }
      // progress along guidance
      let best = 0,
        bd = Infinity;
      this.guide.points.forEach((pt, i) => {
        const d = Math.hypot(pt.x - fm.position.x, pt.y - fm.position.y, pt.z - fm.position.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      this.guideProgress = Math.max(this.guideProgress, best / Math.max(1, this.guide.points.length - 1));
      this.guide.boxes.forEach((b, i) => (b.material.opacity = i < best ? 0.15 : 0.85));
    }
    // Intercept target motion
    if (this.interceptTarget) {
      const t = this.interceptTarget;
      t.pos.x += Math.sin(t.heading) * t.speed * dt * p.sim.simRate;
      t.pos.z += -Math.cos(t.heading) * t.speed * dt * p.sim.simRate;
      t.visual.root.position.copy(t.pos);
      t.visual.root.rotation.set(0, -t.heading, 0, 'YXZ');
      t.visual.update(dt, { gearPos: 0, lights: { nav: true, strobe: true, beacon: true }, engines: [{ rpm: 0.8 }, { rpm: 0.8 }], night: game.world.night });
    }
    if (this.kind === 'tutorial') {
      this.updateTutorial(dt);
      return;
    }
    if (!m || this.done) return;
    // Failures
    for (const [i, f] of (m.failures || []).entries()) {
      if (this.failuresFired.has(i)) continue;
      const tr = f.trigger;
      let fire = false;
      if (tr.type === 'time') fire = this.time >= tr.value;
      else if (tr.type === 'altitude') fire = fm.position.y / FT > tr.value;
      if (fire) {
        this.failuresFired.add(i);
        p.sim.fail(f.type, f.index || 0);
      }
    }
    // Time limit
    if (m.timeLimit && this.time > m.timeLimit) {
      this.finish(false, 'Time limit exceeded');
      return;
    }
    // Objectives
    const obj = m.objectives[this.objIndex];
    if (!obj) return;
    if (this.checkObjective(obj, dt)) {
      this.objIndex++;
      this.objState = {};
      game.audio.chime('mission');
      const next = m.objectives[this.objIndex];
      if (next) game.ui.toast(`Objective complete. Next: ${this.objectiveLabel(next)}`, 'success');
      else this.finish(true);
    }
  }

  objectiveLabel(o) {
    if (o.label) return o.label;
    switch (o.type) {
      case 'takeoff':
        return 'Take off';
      case 'land':
        return o.airport === 'any' ? 'Land at the nearest suitable airport' : o.airport === 'anyfield' ? 'Make a safe landing' : `Land at ${getAirport(o.airport)?.name || o.airport}`;
      case 'stop':
        return 'Come to a complete stop';
      case 'rings':
        return `Fly through the rings (${this.rings ? this.rings.filter((r) => r.passed).length : 0}/${this.rings ? this.rings.length : 0})`;
      default:
        return o.type;
    }
  }

  checkObjective(o, dt) {
    const p = this.game.player;
    const fm = p.sim.fm;
    const st = this.objState;
    switch (o.type) {
      case 'takeoff':
        return !fm.wow && fm.agl > 15;
      case 'land': {
        const td = this.touchdown;
        if (!td || !fm.wow || fm.groundTime < 1.5) return false;
        if (o.airport === 'anyfield') return fm.groundSpeed < 25 * KT;
        if (!td.airport) {
          if (!st.warned) {
            st.warned = true;
            this.game.ui.toast('That was not on a runway!', 'warn');
          }
          return false;
        }
        if (o.airport !== 'any' && td.airport !== o.airport) {
          if (!st.warned) {
            st.warned = true;
            this.game.ui.toast(`Wrong airport — destination is ${o.airport}`, 'warn');
          }
          return false;
        }
        this.landedAt = td.airport;
        return fm.groundSpeed < 40 * KT;
      }
      case 'stop':
        return fm.wow && fm.groundSpeed < 1.5;
      case 'reach':
        return Math.hypot(fm.position.x - o.x, fm.position.z - o.z) < o.radius;
      case 'altitude': {
        st.t = (st.t || 0) + dt;
        if (o.withinSec && st.t > o.withinSec && !(fm.position.y / FT > o.minFt)) {
          this.finish(false, 'Too slow to climb');
          return false;
        }
        return fm.position.y / FT > o.minFt;
      }
      case 'locate': {
        if (!this.targetPos) return true;
        const d = Math.hypot(fm.position.x - this.targetPos.x, fm.position.z - this.targetPos.z);
        return d < o.radius && fm.position.y - this.targetPos.y < o.maxAglFt * FT;
      }
      case 'drop':
        return !!st.dropped;
      case 'pass': {
        const d = Math.hypot(fm.position.x - o.x, fm.position.z - o.z);
        return d < o.radius && fm.agl < o.maxAglFt * FT && fm.ias / KT > o.minKt;
      }
      case 'rings': {
        if (!this.rings) return true;
        const next = this.rings.find((r) => !r.passed);
        if (!next) return true;
        this.rings.forEach((r) => (r.mesh.material.color.setHex(r === next ? 0x3cff6a : r.passed ? 0x666666 : 0xffb000)));
        const rel = fm.position.clone().sub(next.pos);
        const along = rel.dot(next.dir);
        const lateral = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
        if (st.prevAlong !== undefined && st.prevAlong < 0 && along >= 0 && lateral < 75) {
          next.passed = true;
          this.game.audio.chime('altAlert');
        } else if (st.prevAlong !== undefined && st.prevAlong < 0 && along >= 0 && lateral < 300) {
          this.game.ui.toast('Missed the ring! Turn back.', 'warn');
        }
        st.prevAlong = along;
        if (next.passed) st.prevAlong = undefined;
        return this.rings.every((r) => r.passed);
      }
      case 'intercept': {
        const t = this.interceptTarget;
        if (!t) return true;
        const d = fm.position.distanceTo(t.pos);
        if (d < NM) {
          t.held += dt;
          if (Math.floor(t.held) !== st.lastSec) {
            st.lastSec = Math.floor(t.held);
            if (t.held < 10) this.game.ui.toast(`Holding position… ${Math.ceil(10 - t.held)}`, 'info');
          }
        } else t.held = Math.max(0, t.held - dt * 0.5);
        if (t.held >= 10) {
          this.game.ui.toast('Target identified. Return to base.', 'success');
          return true;
        }
        return false;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- tutorials
  updateTutorial(dt) {
    const steps = this.mission.steps;
    const s = steps[this.stepIndex];
    if (!s) return;
    const game = this.game;
    this.stepTime += dt;
    let ok = false;
    if (s.wait) ok = this.stepTime > s.wait;
    else if (s.check)
      try {
        ok = s.check(game, this.stepTime, this.stepState);
      } catch {
        ok = false;
      }
    if (ok && s.hold) {
      this.stepHold += dt;
      ok = this.stepHold > s.hold;
    } else if (!ok) this.stepHold = 0;
    if (ok) {
      if (s.final) {
        if (!this.done) this.finish(true);
        return;
      }
      this.stepIndex++;
      this.stepTime = 0;
      this.stepHold = 0;
      this.stepState = {};
      game.audio.chime('mission');
      game.ui.tutorialStep(steps[this.stepIndex], this.stepIndex, steps.length);
    }
  }

  currentObjectiveText() {
    if (this.kind === 'tutorial') return null;
    if (!this.mission) return null;
    const o = this.mission.objectives[this.objIndex];
    return o ? this.objectiveLabel(o) : 'Mission complete';
  }

  // ---------------------------------------------------------------- scoring
  finish(success, reason = '') {
    if (this.done) return;
    this.done = true;
    const game = this.game;
    const p = game.player;
    const st = p.sim.stats;
    const m = this.mission;
    const td = this.touchdown;
    const parts = [];
    let score = 0;
    if (success) {
      let total = 0,
        wsum = 0;
      const add = (name, val, w, detail) => {
        parts.push({ name, value: Math.round(val), detail });
        total += val * w;
        wsum += w;
      };
      if (td) {
        add('Landing', landingScore(td.fpm), 3, `${Math.round(td.fpm)} fpm — ${td.verdict}`);
        if (td.along !== null) {
          const a = td.along;
          const tdz = a >= 120 && a <= 800 ? 100 : a < 120 ? Math.max(0, 100 + (a - 120) * 0.6) : Math.max(0, 100 - (a - 800) * 0.08);
          add('Touchdown zone', tdz, 1.2, `${Math.round(a)} m past threshold`);
          const lat = Math.abs(td.lateral);
          add('Centreline', lat < 3 ? 100 : lat < 8 ? 85 : lat < 15 ? 60 : 30, 1, `${lat.toFixed(1)} m offset`);
        }
      }
      if (m && m.payload && m.payload.passengers) add('Passenger comfort', Math.max(0, 100 - st.discomfort * 6), 1.5, st.discomfort < 2 ? 'Smooth ride' : st.discomfort < 8 ? 'Some bumps' : 'Uncomfortable');
      if (m && m.timeLimit) add('Time', Math.min(100, 50 + ((m.timeLimit - this.time) / m.timeLimit) * 100), 1, `${Math.round(this.time / 60)} of ${Math.round(m.timeLimit / 60)} min`);
      const pen = Math.min(60, st.overspeedTime * 2 + st.stallTime * 4);
      add('Airmanship', 100 - pen, 1, pen > 0 ? 'Overspeed/stall penalties' : 'No exceedances');
      score = wsum ? total / wsum : 100;
      if (td && Math.abs(td.fpm) > 600) score *= 0.85;
    }
    score = Math.round(Math.max(0, Math.min(100, score)));
    const stars = success ? (score >= 85 ? 3 : score >= 65 ? 2 : 1) : 0;
    let credits = 0,
      xp = 0;
    const reward = m && m.reward ? m.reward : this.job ? this.job.reward : { credits: 0, xp: 40 };
    if (this.kind === 'tutorial') {
      xp = success ? 150 : 0;
      credits = success ? 1000 : 0;
    } else if (success) {
      credits = Math.round(reward.credits * (0.45 + (score / 100) * 0.75));
      xp = Math.round(reward.xp * (0.5 + score / 200));
    } else {
      xp = Math.round((reward.xp || 40) * 0.1);
      credits = this.job ? -Math.round((reward.credits || 0) * 0.15) : 0;
    }
    const result = {
      kind: this.kind,
      missionId: m ? m.id : null,
      title: m ? m.title : this.job ? this.job.title : 'Free Flight',
      success,
      reason,
      score,
      stars,
      parts,
      credits,
      xp,
      touchdown: td,
      stats: { ...st },
      duration: st.flightTime,
      distanceNm: st.distance / NM,
      job: this.job,
    };
    this.active = this.kind === 'free';
    game.onMissionFinished(result);
  }

  // Free-flight summary (no scoring)
  freeFlightSummary() {
    const p = this.game.player;
    const st = p.sim.stats;
    return {
      kind: 'free',
      title: 'Free Flight',
      success: !p.sim.crashed,
      reason: p.sim.crashed ? p.sim.fm.crashReason : '',
      score: null,
      stars: 0,
      parts: [],
      credits: 0,
      xp: Math.min(150, Math.round(st.airTime / 30)),
      touchdown: this.touchdown,
      stats: { ...st },
      duration: st.flightTime,
      distanceNm: st.distance / NM,
    };
  }
}

export { ALL_RUNWAY_ENDS };
