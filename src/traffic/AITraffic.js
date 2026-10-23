// AI air traffic: kinematic aircraft flying complete flights between airports
// (gate, pushback, taxi, hold short, takeoff, climb, cruise, descent, ILS
// approach, landing, rollout, taxi-in) plus GA circuit traffic. Coordinates
// runway use with the ATC module.

import * as THREE from 'three';
import { AircraftVisual } from '../aircraft/AircraftVisual.js';
import { getAircraft } from '../aircraft/aircraftData.js';
import { AIRCRAFT_LIVERIES } from '../aircraft/Livery.js';
import { AIRPORT_INFO, getAirport, bestRunwayEnd, runwayRelative, runwayAt } from '../world/airportGeometry.js';
import { LAYOUTS, taxiRoute } from '../world/airportLayout.js';
import { AIRLINES } from '../world/worldData.js';
import { KT, FT, DEG } from '../physics/atmosphere.js';

const TYPES = {
  international: ['mj320', 'mj320', 'mj320', 'rj900', 'mw350', 'mw350'],
  regional: ['rj900', 'rj900', 'mj320', 'lj45'],
  cargo: ['t74f', 't74f', 'ct130', 'mj320'],
  military: ['fx16', 'fx16', 'ef2', 'ct130'],
  ga: ['k172', 'k172', 'k172', 'lj45'],
};

const COUNTS = { off: 0, low: 7, normal: 14, high: 24 };

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

let nextId = 1;

class AIAircraft {
  constructor(mgr, specId, airline) {
    this.mgr = mgr;
    this.id = nextId++;
    this.spec = getAircraft(specId);
    const military = this.spec.category === 'fighter';
    const ga = this.spec.id === 'k172';
    this.airline = airline;
    const livs = AIRCRAFT_LIVERIES[specId] || ['house'];
    let livery = livs[Math.floor(Math.random() * livs.length)];
    if (airline && livs.includes(airline.livery)) livery = airline.livery;
    this.callsign = military ? `${this.spec.callsignPrefix} ${Math.floor(11 + Math.random() * 80)}` : ga ? `N${Math.floor(100 + Math.random() * 899)}${'ABCDEFGHJK'[Math.floor(Math.random() * 10)]}` : `${airline ? airline.callsign : 'AURELIA'} ${Math.floor(10 + Math.random() * 980)}`;
    this.visual = new AircraftVisual(this.spec, livery, { detail: 'low', merge: true });
    this.visual.root.traverse((o) => {
      if (o.isMesh) o.castShadow = o.parent && o.parent.visible;
    });
    mgr.game.scene.add(this.visual.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = 0;
    this.vs = 0;
    this.state = 'idle';
    this.timer = 0;
    this.gearPos = 1;
    this.flaps = 0;
    this.lights = { nav: true, strobe: false, beacon: false, landing: false, taxi: false };
    this.engineRpm = 0.25;
    this.path = null;
    this.pathIndex = 0;
    this.gearH = -Math.min(...this.spec.gear.points.map((g) => g.pos[1])) - (this.spec.gear.travel || 0.3) * 0.35;
    this.vstate = { gear: this.spec.gear.points.map(() => ({ compression: (this.spec.gear.travel || 0.3) * 0.35, spin: 0, steerAngle: 0 })), engines: this.spec.engine.list.map(() => ({ rpm: 0.25 })), lights: this.lights };
    this.perf = {
      vr: this.spec.speeds.vr * KT,
      vref: this.spec.speeds.vref * KT,
      climb: (ga ? 230 : military ? 330 : 250) * KT,
      cruise: Math.min(this.spec.speeds.cruise, ga ? 110 : 420) * KT,
      accel: ga ? 2.2 : military ? 7 : this.spec.mass.maxTakeoff > 200000 ? 1.7 : 2.1,
      climbRate: (ga ? 700 : military ? 6000 : 2200) * 0.00508,
      descentRate: (ga ? 600 : 1800) * 0.00508,
      turnRate: (ga ? 5 : military ? 8 : 2.5) * DEG,
      taxi: ga ? 6 : 9,
    };
  }

  dispose() {
    this.mgr.game.scene.remove(this.visual.root);
    this.visual.dispose();
  }

  get altitudeFt() {
    return this.pos.y / FT;
  }

  groundY() {
    return this.mgr.game.world.heightAt(this.pos.x, this.pos.z) + this.gearH;
  }

  // ---------------------------------------------------------------- setup
  parkAt(airport, gate) {
    this.origin = airport;
    this.gate = gate;
    gate.occupied = this;
    this.pos.set(gate.x, 0, gate.z);
    this.pos.y = this.groundY();
    this.heading = gate.heading * DEG;
    this.state = 'parked';
    this.timer = 40 + Math.random() * 500;
    this.speed = 0;
    this.gearPos = 1;
    this.engineRpm = 0;
    Object.assign(this.lights, { nav: true, strobe: false, beacon: false, landing: false, taxi: false });
  }

  startArrival(dest, fromDistance = 35000) {
    this.dest = dest;
    const end = this.mgr.activeEnd(dest, this.spec);
    this.destEnd = end;
    // spawn somewhere around the final fix, up-range
    const ang = Math.random() * Math.PI * 2;
    const fix = this.finalFix(end);
    this.pos.set(fix.x + Math.cos(ang) * fromDistance, end.elevation + (7000 + Math.random() * 4000) * FT, fix.z + Math.sin(ang) * fromDistance);
    this.heading = Math.atan2(fix.x - this.pos.x, -(fix.z - this.pos.z));
    this.speed = this.perf.climb;
    this.gearPos = 0;
    this.state = 'arrive';
    this.engineRpm = 0.6;
    Object.assign(this.lights, { nav: true, strobe: true, beacon: true, landing: false, taxi: false });
  }

  startEnroute(from, to) {
    this.dest = to;
    this.destEnd = this.mgr.activeEnd(to, this.spec);
    const t = 0.25 + Math.random() * 0.4;
    this.pos.set(from.x + (to.x - from.x) * t, Math.max(this.spec.speeds.cruiseAlt * 0.6, 12000) * FT, from.z + (to.z - from.z) * t);
    this.heading = Math.atan2(to.x - from.x, -(to.z - from.z));
    this.speed = this.perf.cruise;
    this.gearPos = 0;
    this.state = 'arrive';
    this.cruiseAlt = this.pos.y;
    this.engineRpm = 0.75;
    Object.assign(this.lights, { nav: true, strobe: true, beacon: true });
  }

  finalFix(end) {
    const d = this.spec.id === 'k172' ? 4500 : 14000;
    return { x: end.x - end.dirX * d, z: end.z - end.dirZ * d, y: end.elevation + Math.tan(3 * DEG) * (d + 300), d };
  }

  // ---------------------------------------------------------------- steering
  steerTo(tx, tz, dt, maxBank = 25) {
    const desired = Math.atan2(tx - this.pos.x, -(tz - this.pos.z));
    const err = wrapPi(desired - this.heading);
    const rate = Math.max(-this.perf.turnRate, Math.min(this.perf.turnRate, err * 0.8));
    this.heading = wrapPi(this.heading + rate * dt);
    const bankT = Math.atan((this.speed * rate) / 9.81);
    this.bank += (Math.max(-maxBank * DEG, Math.min(maxBank * DEG, bankT)) - this.bank) * Math.min(1, dt * 2);
    return err;
  }

  climbTo(alt, dt, rateUp = this.perf.climbRate, rateDown = this.perf.descentRate) {
    const err = alt - this.pos.y;
    const vsT = Math.max(-rateDown, Math.min(rateUp, err * 0.15));
    this.vs += (vsT - this.vs) * Math.min(1, dt * 0.8);
  }

  accelTo(v, dt, a = 1.2) {
    const d = v - this.speed;
    this.speed += Math.sign(d) * Math.min(Math.abs(d), a * dt);
  }

  moveAir(dt) {
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.pos.y += this.vs * dt;
    const gy = this.groundY() + 30;
    if (this.pos.y < gy && this.state !== 'final' && this.state !== 'flare') {
      this.pos.y = gy;
      this.vs = Math.max(0, this.vs);
    }
    const gamma = Math.atan2(this.vs, Math.max(1, this.speed));
    const aoa = this.state === 'final' || this.state === 'flare' ? 4 * DEG : 2.5 * DEG;
    this.pitch += (gamma + aoa - this.pitch) * Math.min(1, dt * 1.5);
  }

  // Follow a ground path (list of {x,z}) at taxi speed
  followPath(dt, speed) {
    if (!this.path || this.pathIndex >= this.path.length) return true;
    const t = this.path[this.pathIndex];
    const dx = t.x - this.pos.x,
      dz = t.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) {
      this.pathIndex++;
      return this.pathIndex >= this.path.length;
    }
    const desired = Math.atan2(dx, -dz);
    const err = wrapPi(desired - this.heading);
    const turn = Math.max(-0.5, Math.min(0.5, err * 1.5));
    this.heading = wrapPi(this.heading + turn * dt);
    const v = Math.abs(err) > 0.5 ? speed * 0.35 : speed;
    // Simple separation with other traffic ahead
    const blocked = this.mgr.blockedAhead(this, 70);
    this.accelTo(blocked ? 0 : v, dt, 1.5);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.pos.y = this.groundY();
    this.pitch = 0;
    this.bank = 0;
    return false;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const mgr = this.mgr;
    const atc = mgr.game.atc;
    this.timer -= dt;
    switch (this.state) {
      case 'parked':
        this.engineRpm = 0;
        if (this.timer <= 0 && mgr.wantDepartures) this.beginDeparture();
        break;
      case 'pushback': {
        this.lights.beacon = true;
        this.engineRpm = Math.min(0.25, this.engineRpm + dt * 0.05);
        const t = this.gate.push;
        const dx = t.x - this.pos.x,
          dz = t.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2) {
          this.state = 'taxiOut';
          this.speed = 0;
          this.gate.occupied = null;
          this.lights.taxi = true;
          atc && atc.aiCall(this, 'taxi');
        } else {
          this.speed = 1.6;
          this.pos.x += (dx / d) * this.speed * dt;
          this.pos.z += (dz / d) * this.speed * dt;
          this.pos.y = this.groundY();
        }
        break;
      }
      case 'taxiOut':
        if (this.followPath(dt, this.perf.taxi)) {
          this.state = 'holding';
          this.speed = 0;
          atc && atc.aiCall(this, 'ready');
        }
        break;
      case 'holding':
        this.speed = 0;
        if (mgr.runwayFreeForDeparture(this.origin, this.depEnd, this)) {
          this.state = 'lineup';
          this.path = [{ x: this.depEnd.x + this.depEnd.dirX * 40, z: this.depEnd.z + this.depEnd.dirZ * 40 }, { x: this.depEnd.x + this.depEnd.dirX * 120, z: this.depEnd.z + this.depEnd.dirZ * 120 }];
          this.pathIndex = 0;
          mgr.occupy(this.depEnd, this);
          atc && atc.aiCall(this, 'takeoffClearance');
          Object.assign(this.lights, { strobe: true, landing: true, taxi: false });
        }
        break;
      case 'lineup':
        if (this.followPath(dt, 6)) {
          this.state = 'takeoff';
          this.heading = this.depEnd.heading * DEG;
        }
        break;
      case 'takeoff': {
        this.engineRpm = 1;
        this.speed += this.perf.accel * dt;
        const e = this.depEnd;
        // keep on centreline
        const rel = runwayRelative(e, this.pos.x, this.pos.z);
        this.heading = wrapPi(e.heading * DEG - Math.max(-0.05, Math.min(0.05, rel.lateral * 0.01)));
        this.pos.x += Math.sin(this.heading) * this.speed * dt;
        this.pos.z += -Math.cos(this.heading) * this.speed * dt;
        if (this.speed > this.perf.vr) {
          this.pitch = Math.min(9 * DEG, this.pitch + dt * 3 * DEG);
          if (this.speed > this.perf.vr * 1.08) {
            this.state = 'climb';
            this.vs = 2;
            mgr.release(this.depEnd, this);
          }
        }
        this.pos.y = this.groundY() + (this.state === 'climb' ? 0.5 : 0);
        break;
      }
      case 'climb': {
        this.engineRpm = 0.95;
        this.accelTo(this.perf.climb, dt, 1.5);
        if (this.pos.y - this.origin.elevation > 300) this.gearPos = Math.max(0, this.gearPos - dt / 6);
        this.flaps = Math.max(0, this.flaps - dt * 2);
        // Circuit traffic turns into the pattern once safely airborne
        if (this.patternMode && this.pos.y - this.origin.elevation > 150) {
          this.state = 'pattern';
          this.patternLeg = 0;
          break;
        }
        const target = this.dest || this.origin;
        const fix = this.finalFix(this.destEnd || this.depEnd);
        if (this.pos.y - this.origin.elevation > 450) this.steerTo(fix.x, fix.z, dt);
        this.climbTo(this.cruiseAlt, dt);
        this.moveAir(dt);
        if (Math.abs(this.pos.y - this.cruiseAlt) < 60) this.state = 'arrive';
        void target;
        if (this.pos.y > 3000) this.lights.landing = false;
        break;
      }
      case 'arrive': {
        // Cruise toward the final fix, descending on a 3:1 profile
        const end = this.destEnd;
        const fix = this.finalFix(end);
        const dist = Math.hypot(fix.x - this.pos.x, fix.z - this.pos.z);
        this.engineRpm = 0.7;
        this.steerTo(fix.x, fix.z, dt);
        const tod = ((this.pos.y - fix.y) / FT / 1000) * 3 * 1852;
        const targetAlt = dist < tod + 8000 ? Math.max(fix.y, fix.y + (dist / 1852 / 3) * 1000 * FT) : this.cruiseAlt || this.pos.y;
        this.climbTo(targetAlt, dt);
        this.accelTo(dist < 25000 ? this.perf.vref * 1.4 : this.perf.cruise, dt, 1.0);
        this.moveAir(dt);
        if (dist < 1500) {
          this.state = 'final';
          atc && atc.aiCall(this, 'final');
        }
        if (this.pos.y < end.elevation + 3000 * FT) this.lights.landing = true;
        break;
      }
      case 'final': {
        const e = this.destEnd;
        const rel = runwayRelative(e, this.pos.x, this.pos.z);
        const toThr = -rel.along;
        // Lateral correction toward the centreline
        const corr = Math.max(-0.35, Math.min(0.35, -rel.lateral * 0.004 - 0));
        const desired = e.heading * DEG + corr;
        this.heading = wrapPi(this.heading + Math.max(-this.perf.turnRate, Math.min(this.perf.turnRate, wrapPi(desired - this.heading) * 0.8)) * dt);
        this.bank += (wrapPi(desired - this.heading) * 0.6 - this.bank) * Math.min(1, dt * 2);
        const gsAlt = e.elevation + this.gearH + Math.max(0, toThr + 300) * Math.tan(3 * DEG);
        this.vs = (gsAlt - this.pos.y) * 0.4 - this.speed * Math.tan(3 * DEG);
        this.accelTo(this.perf.vref, dt, 1.0);
        this.gearPos = Math.min(1, this.gearPos + dt / 8);
        this.flaps = Math.min(1, this.flaps + dt / 10);
        this.engineRpm = 0.55;
        this.moveAir(dt);
        // Go-around if the runway is occupied when close
        if (toThr < 1500 && toThr > 0 && !mgr.runwayFreeForArrival(this.dest, e, this)) {
          this.state = 'goAround';
          this.timer = 60;
          atc && atc.aiCall(this, 'goAround');
          break;
        }
        if (toThr < 1200) mgr.occupy(e, this);
        if (this.pos.y - (e.elevation + this.gearH) < 12 && toThr < 300) this.state = 'flare';
        break;
      }
      case 'flare': {
        this.vs += (-0.6 - this.vs) * Math.min(1, dt * 2);
        this.accelTo(this.perf.vref * 0.92, dt, 1);
        this.engineRpm = 0.25;
        this.moveAir(dt);
        const gy = this.groundY();
        if (this.pos.y <= gy + 0.2) {
          this.pos.y = gy;
          this.state = 'rollout';
          this.vs = 0;
        }
        break;
      }
      case 'rollout': {
        const e = this.destEnd;
        this.engineRpm = 0.4;
        this.pitch += (0 - this.pitch) * Math.min(1, dt * 2);
        this.bank = 0;
        this.accelTo(12, dt, 2.6);
        this.heading = e.heading * DEG;
        this.pos.x += Math.sin(this.heading) * this.speed * dt;
        this.pos.z += -Math.cos(this.heading) * this.speed * dt;
        this.pos.y = this.groundY();
        if (this.speed <= 12.5) this.exitRunway();
        break;
      }
      case 'taxiIn':
        if (this.followPath(dt, this.perf.taxi)) {
          if (this.gate) {
            this.state = 'parked';
            this.origin = this.dest;
            this.timer = 120 + Math.random() * 400;
            this.speed = 0;
            this.heading = this.gate.heading * DEG;
            Object.assign(this.lights, { strobe: false, beacon: false, landing: false, taxi: false });
            mgr.parkedArrived(this);
          } else this.state = 'despawn';
        }
        break;
      case 'goAround': {
        this.engineRpm = 1;
        mgr.release(this.destEnd, this);
        this.accelTo(this.perf.climb * 0.8, dt, 1.5);
        this.climbTo(this.destEnd.elevation + 3000 * FT, dt);
        this.gearPos = Math.max(0, this.gearPos - dt / 8);
        this.heading = this.destEnd.heading * DEG;
        this.moveAir(dt);
        if (this.timer <= 0) this.state = 'arrive';
        break;
      }
      case 'pattern':
        this.updatePattern(dt);
        break;
    }
    this.updateVisual(dt);
  }

  beginDeparture() {
    const mgr = this.mgr;
    const ap = this.origin;
    const L = LAYOUTS.get(ap.icao);
    this.depEnd = mgr.activeEnd(ap, this.spec);
    const holdId = L.holdPoints[this.depEnd.id];
    const route = taxiRoute(L, this.gate.push.id, holdId);
    if (!route) {
      this.timer = 200;
      return;
    }
    this.path = route.map((n) => ({ x: n.x, z: n.z }));
    this.pathIndex = 0;
    // Pick a destination: another airport suitable for the type
    const dests = AIRPORT_INFO.filter((a) => a.icao !== ap.icao && TYPES[a.type] && TYPES[a.type].includes(this.spec.id));
    this.dest = dests.length ? dests[Math.floor(Math.random() * dests.length)] : ap;
    this.destEnd = mgr.activeEnd(this.dest, this.spec);
    const dist = Math.hypot(this.dest.x - ap.x, this.dest.z - ap.z);
    this.cruiseAlt = Math.max(ap.elevation, this.dest.elevation) + Math.min(this.spec.speeds.cruiseAlt * 0.7 * FT, Math.max(1500, dist * 0.06));
    if (this.spec.id === 'k172' && Math.random() < 0.6) {
      this.dest = ap;
      this.destEnd = this.depEnd;
      this.patternMode = true;
      this.cruiseAlt = ap.elevation + 1000 * FT;
    }
    this.state = 'pushback';
    this.mgr.game.atc && this.mgr.game.atc.aiCall(this, 'pushback');
  }

  exitRunway() {
    const ap = this.dest;
    const L = LAYOUTS.get(ap.icao);
    // nearest runway exit node ahead
    let exit = null,
      bd = Infinity;
    for (const n of L.nodes) {
      if (n.kind !== 'runway') continue;
      const rel = runwayRelative(this.destEnd, n.x, n.z);
      const me = runwayRelative(this.destEnd, this.pos.x, this.pos.z);
      if (Math.abs(rel.lateral) > 5) continue;
      const ahead = rel.along - me.along;
      if (ahead > -10 && ahead < bd) {
        bd = ahead;
        exit = n;
      }
    }
    const gate = this.mgr.freeGate(ap, this.spec);
    this.mgr.release(this.destEnd, this);
    if (!exit) {
      this.state = 'despawn';
      return;
    }
    let route = gate ? taxiRoute(L, exit.id, gate.node.id) : null;
    if (gate && route) {
      gate.occupied = this;
      this.gate = gate;
      this.path = [{ x: exit.x, z: exit.z }, ...route.slice(1).map((n) => ({ x: n.x, z: n.z }))];
    } else {
      this.gate = null;
      const hold = L.nodes.find((n) => n.kind === 'hold' && Math.hypot(n.x - exit.x, n.z - exit.z) < 200);
      this.path = [{ x: exit.x, z: exit.z }, ...(hold ? [{ x: hold.x, z: hold.z }] : [])];
    }
    this.pathIndex = 0;
    this.state = 'taxiIn';
    this.lights.landing = false;
    this.lights.taxi = true;
    this.lights.strobe = false;
    this.mgr.game.atc && this.mgr.game.atc.aiCall(this, 'vacated');
  }

  // GA circuits: takeoff climbs out then this flies a rectangular pattern
  updatePattern(dt) {
    const e = this.depEnd;
    const L = e.length;
    const lx = e.dirZ,
      lz = -e.dirX;
    const pts = [
      { a: L + 900, l: 0 },
      { a: L + 900, l: 1100 },
      { a: -1100, l: 1100 },
      { a: -1100, l: 0 },
    ];
    const p = pts[this.patternLeg % 4];
    const tx = e.x + e.dirX * p.a + lx * p.l,
      tz = e.z + e.dirZ * p.a + lz * p.l;
    this.steerTo(tx, tz, dt, 30);
    this.climbTo(e.elevation + 1000 * FT, dt);
    this.accelTo(this.perf.climb * 0.45, dt);
    this.moveAir(dt);
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 250) {
      this.patternLeg++;
      if (this.patternLeg % 4 === 0) {
        this.state = 'final';
        this.destEnd = e;
        this.dest = this.origin;
      }
    }
  }

  updateVisual(dt) {
    const root = this.visual.root;
    root.position.copy(this.pos);
    root.rotation.set(0, 0, 0);
    root.quaternion.setFromEuler(new THREE.Euler(this.pitch, -this.heading, -this.bank, 'YXZ'));
    const st = this.vstate;
    st.gearPos = this.spec.gear.retractable ? this.gearPos : 1;
    st.flapsDeg = this.flaps * (this.spec.flaps[this.spec.flaps.length - 1].deg || 0) * 0.8;
    for (const e of st.engines) e.rpm = this.engineRpm;
    for (const g of st.gear) g.spin += (this.state === 'takeoff' || this.state === 'rollout' || this.state.startsWith('taxi') ? this.speed : 0) * dt;
    st.night = this.mgr.game.world.night;
    this.visual.update(dt, st);
  }
}

export class AITraffic {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnTimer = 0;
    this.runwayUse = new Map(); // runway end key -> aircraft
    this.wantDepartures = true;
    this.gates = new Map();
    for (const [icao, L] of LAYOUTS) this.gates.set(icao, L.gates);
  }

  get maxCount() {
    return COUNTS[this.game.settings.get('gameplay').aiTraffic] ?? 14;
  }

  activeEnd(ap, spec) {
    const ws = this.game.weather.state;
    const minLen = spec ? (spec.mass.maxTakeoff > 150000 ? 2400 : spec.mass.maxTakeoff > 30000 ? 1600 : 500) : 0;
    return this.game.atc ? this.game.atc.activeRunway(ap, minLen) : bestRunwayEnd(ap, ws.windDir, ws.windSpeed, minLen);
  }

  runwayKey(end) {
    return `${end.airport.icao}:${end.runway.index}`;
  }

  occupy(end, who) {
    this.runwayUse.set(this.runwayKey(end), who);
  }
  release(end, who) {
    const k = this.runwayKey(end);
    if (this.runwayUse.get(k) === who) this.runwayUse.delete(k);
  }

  runwayFreeForDeparture(ap, end, who) {
    const k = this.runwayKey(end);
    const u = this.runwayUse.get(k);
    if (u && u !== who) return false;
    // arrivals on final within ~6 km?
    for (const a of this.list) {
      if (a === who || a.destEnd == null || a.dest !== ap) continue;
      if (a.state === 'final' || a.state === 'flare' || (a.state === 'arrive' && a.destEnd.runway === end.runway && Math.hypot(a.pos.x - end.x, a.pos.z - end.z) < 9000)) return false;
    }
    // the player on the runway or on short final
    const p = this.game.player;
    if (p && !p.sim.crashed) {
      const pp = p.position;
      const rw = runwayAt(pp.x, pp.z, 20);
      if (rw && rw === end.runway && pp.y - ap.elevation < 400) return false;
      const rel = runwayRelative(end, pp.x, pp.z);
      if (rel.along < 0 && rel.along > -8000 && Math.abs(rel.lateral) < 600 && pp.y - ap.elevation < 700) return false;
    }
    return true;
  }

  runwayFreeForArrival(ap, end, who) {
    const u = this.runwayUse.get(this.runwayKey(end));
    if (u && u !== who) return false;
    const p = this.game.player;
    if (p) {
      const pp = p.position;
      const rw = runwayAt(pp.x, pp.z, 10);
      if (rw === end.runway && pp.y - ap.elevation < 30) return false;
    }
    return true;
  }

  blockedAhead(me, dist) {
    const fx = Math.sin(me.heading),
      fz = -Math.cos(me.heading);
    for (const a of this.list) {
      if (a === me || a.state === 'parked') continue;
      const dx = a.pos.x - me.pos.x,
        dz = a.pos.z - me.pos.z;
      if (Math.abs(a.pos.y - me.pos.y) > 30) continue;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (along > 0 && along < dist && lat < 25) return true;
    }
    const p = this.game.player;
    if (p) {
      const dx = p.position.x - me.pos.x,
        dz = p.position.z - me.pos.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (along > 0 && along < dist + 20 && lat < 30 && p.sim.fm.wow) return true;
    }
    return false;
  }

  freeGate(ap, spec) {
    const gates = this.gates.get(ap.icao) || [];
    const ok = gates.filter((g) => !g.occupied && !g.reserved && this.gateFits(g, spec));
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  gateFits(g, spec) {
    if (spec.category === 'fighter') return g.size === 'fighter';
    if (g.size === 'fighter') return spec.category === 'cargo' && spec.id === 'ct130';
    if (g.size === 'small') return spec.id === 'k172' || spec.id === 'lj45';
    return true;
  }

  parkedArrived(ai) {
    ai.state = 'parked';
  }

  clear() {
    for (const a of this.list) a.dispose();
    this.list = [];
    this.runwayUse.clear();
    for (const gs of this.gates.values()) for (const g of gs) {
      g.occupied = null;
      g.reserved = false;
    }
  }

  // Keep a gate free for the player's spawn
  reserveGate(gate) {
    if (gate.occupied) {
      const a = gate.occupied;
      this.list.splice(this.list.indexOf(a), 1);
      a.dispose();
      gate.occupied = null;
    }
    gate.reserved = true;
  }

  pickType(ap) {
    const t = TYPES[ap.type] || TYPES.regional;
    return t[Math.floor(Math.random() * t.length)];
  }

  pickAirline(specId) {
    if (specId === 't74f' || specId === 'ct130') return AIRLINES.find((a) => a.code === 'SCX');
    return AIRLINES[Math.floor(Math.random() * AIRLINES.length)];
  }

  // Populate the gates of airports near a point (called on flight start)
  populate(center) {
    if (this.maxCount === 0) return;
    const near = AIRPORT_INFO.filter((a) => Math.hypot(a.x - center.x, a.z - center.z) < 45000);
    for (const ap of near) {
      const gates = this.gates.get(ap.icao) || [];
      const n = Math.min(gates.length, Math.ceil(gates.length * 0.35), ap.type === 'international' ? 8 : 3);
      let placed = 0;
      for (const g of [...gates].sort(() => Math.random() - 0.5)) {
        if (placed >= n || this.list.length >= this.maxCount) break;
        if (g.occupied || g.reserved) continue;
        const type = this.pickType(ap);
        const spec = getAircraft(type);
        if (!this.gateFits(g, spec)) continue;
        const ai = new AIAircraft(this, type, this.pickAirline(type));
        ai.parkAt(ap, g);
        this.list.push(ai);
        placed++;
      }
    }
  }

  spawnArrival(center) {
    const near = AIRPORT_INFO.filter((a) => Math.hypot(a.x - center.x, a.z - center.z) < 60000 && a.type !== 'ga');
    if (!near.length) return;
    const ap = near[Math.floor(Math.random() * near.length)];
    const type = this.pickType(ap);
    const ai = new AIAircraft(this, type, this.pickAirline(type));
    ai.origin = AIRPORT_INFO[Math.floor(Math.random() * AIRPORT_INFO.length)];
    ai.startArrival(ap, 25000 + Math.random() * 25000);
    ai.cruiseAlt = ai.pos.y;
    this.list.push(ai);
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const center = p ? p.position : game.camera.position;
    if (this.maxCount === 0) {
      if (this.list.length) this.clear();
      return;
    }
    for (const a of this.list) a.update(dt);
    // Despawn
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const far = Math.hypot(a.pos.x - center.x, a.pos.z - center.z) > 110000;
      if (a.state === 'despawn' || far) {
        if (a.gate && a.gate.occupied === a) a.gate.occupied = null;
        for (const [k, v] of this.runwayUse) if (v === a) this.runwayUse.delete(k);
        a.dispose();
        this.list.splice(i, 1);
      }
    }
    // Spawn
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 8 + Math.random() * 10;
      if (this.list.length < this.maxCount) {
        const flying = this.list.filter((a) => !['parked', 'pushback', 'taxiOut', 'holding', 'taxiIn'].includes(a.state)).length;
        if (flying < this.maxCount * 0.45) this.spawnArrival(center);
        else this.populate(center);
      }
    }
    // Visibility LOD
    const cam = game.camera.position;
    for (const a of this.list) {
      const d = a.pos.distanceTo(cam);
      a.visual.root.visible = d < 45000;
    }
  }

  // Traffic list for TCAS / radar
  trafficFor(pos) {
    const out = [];
    for (const a of this.list) {
      if (a.state === 'parked') continue;
      const dist = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (dist > 90000) continue;
      out.push({ x: a.pos.x, z: a.pos.z, alt: a.pos.y / FT, relAlt: (a.pos.y - pos.y) / FT, vs: a.vs / 0.00508, dist, callsign: a.callsign });
    }
    return out;
  }
}
