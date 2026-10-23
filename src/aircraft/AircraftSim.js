// Aircraft simulation: physics + flight controls + autopilot + aircraft systems.
// Contains no rendering code so it can run headless (tests, tools).

import { Vector3 } from 'three';
import { FlightModel } from '../physics/FlightModel.js';
import { FlightControlSystem } from '../physics/FlightControls.js';
import { WindModel } from '../physics/Wind.js';
import { NavSystem } from './Navigation.js';
import { Autopilot } from './Autopilot.js';
import { DEG, KT, FT, FPM, G0 } from '../physics/atmosphere.js';

const PHYS_DT = 1 / 240;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function moveToward(cur, target, step) {
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

const DEFAULT_WEATHER = { windDir: 270, windSpeed: 0, gust: 0, turbulence: 0, storms: [], tempOffset: 0 };
const CALLOUTS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
const _att = {};
const _tmp = new Vector3();

export class AircraftSim {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.fm = new FlightModel(spec, { groundFn: opts.groundFn, crashEnabled: opts.crashEnabled !== false });
    this.fcs = new FlightControlSystem(this.fm);
    this.nav = opts.nav || new NavSystem();
    this.ap = new Autopilot(this);
    this.wind = new WindModel(opts.seed || 4242);
    this.weather = opts.weather || DEFAULT_WEATHER;
    this.engineCount = spec.engine.list.length;
    this.accumulator = 0;
    this.simRate = 1;

    this.input = { pitch: 0, roll: 0, yaw: 0, tiller: 0, brake: 0, brakeL: 0, brakeR: 0 };
    this.throttleLever = 0;
    this.reverseLever = false;
    this.flapsIndex = 0;
    this.gearLever = 1;
    this.gearPos = 1;
    this.spoilerLever = 0;
    this.spoilersArmed = false;
    this.groundSpoilers = 0;
    this.parkingBrake = true;
    this.autobrake = 'OFF';
    this.autobrakeActive = false;
    this.brakeTemp = 0;
    this.switches = {
      battery: true,
      avionics: true,
      fuelPumps: true,
      landingLights: false,
      taxiLights: false,
      navLights: true,
      strobeLights: false,
      beacon: true,
      logoLights: false,
      cabinLights: true,
      seatbelts: true,
      antiIce: false,
      pitotHeat: false,
      apu: false,
      altGear: false,
    };
    this.failures = { hydraulic: false, gearJam: false, electrical: false, fuelLeak: false };
    this.warnings = {};
    this.masterWarning = false;
    this.masterCaution = false;
    this.events = [];
    this.calloutsDone = new Set();
    this.lastRadioAlt = 0;
    this.stats = this.newStats();
    this.prevVs = 0;
  }

  newStats() {
    return {
      flightTime: 0,
      airTime: 0,
      distance: 0,
      maxG: 1,
      minG: 1,
      maxBank: 0,
      discomfort: 0,
      touchdowns: [],
      liftoffs: 0,
      maxAlt: 0,
      maxIas: 0,
      overspeedTime: 0,
      stallTime: 0,
    };
  }

  get position() {
    return this.fm.position;
  }
  get quaternion() {
    return this.fm.quaternion;
  }
  get crashed() {
    return this.fm.crashed;
  }
  get engines() {
    return this.fm.engines;
  }
  get powered() {
    return !this.failures.electrical && (this.switches.battery || this.fm.engines.some((e) => e.running) || this.switches.apu);
  }
  get flapsTarget() {
    return this.spec.flaps[this.flapsIndex].deg;
  }

  // Approximate total thrust available at full throttle (N) for control gain scheduling.
  maxThrustEstimate() {
    const e = this.spec.engine;
    const fm = this.fm;
    const sigma = fm.rho / 1.225;
    const n = fm.engines.filter((x) => x.running).length || 1;
    if (e.type === 'jet') return n * e.maxThrust * Math.pow(sigma, e.densityExp || 0.8) * Math.max(0.4, 1 + (e.machLapse || -0.3) * fm.mach) * 0.85;
    return (n * e.efficiency * e.maxPower * Math.min(1, sigma)) / Math.sqrt(fm.tas * fm.tas + e.vKnee * e.vKnee);
  }

  setAssist(level) {
    this.fcs.assist = level;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  // mode: 'parked' | 'runway' | 'air'
  spawn({ mode, x, z, heading, groundH, altitude, speed, coldDark = false, fuelFrac = 0.6, payloadFrac = 0.5 }) {
    const fm = this.fm;
    fm.resetState();
    fm.fuel = this.spec.mass.maxFuel * clamp(fuelFrac, 0.02, 1);
    fm.payload = this.spec.mass.maxPayload * clamp(payloadFrac, 0, 1);
    this.stats = this.newStats();
    this.calloutsDone.clear();
    this.events.length = 0;
    this.ap.engaged = false;
    this.ap.athr = false;
    this.ap.lat = 'HDG';
    this.ap.vert = 'ALT';
    this.ap.latArmed = null;
    this.ap.vertArmed = null;
    this.reverseLever = false;
    this.spoilerLever = 0;
    this.groundSpoilers = 0;
    this.autobrakeActive = false;
    this.brakeTemp = 0;
    this.failures = { hydraulic: false, gearJam: false, electrical: false, fuelLeak: false };
    fm.fuelLeakRate = 0;
    for (const e of fm.engines) {
      e.failed = false;
      e.fire = false;
      e.extinguished = false;
      e.reverseCmd = false;
      e.reverse = 0;
      e.afterburner = 0;
    }
    const s = this.switches;
    if (mode === 'air') {
      fm.placeInAir(x, altitude, z, heading, speed, 2 * DEG);
      this.gearLever = 0;
      this.gearPos = 0;
      fm.controls.gear = 0;
      this.flapsIndex = 0;
      fm.controls.flaps = 0;
      this.parkingBrake = false;
      for (const e of fm.engines) e.setRunning(true);
      this.throttleLever = 0.65;
      Object.assign(s, { battery: true, avionics: true, fuelPumps: true, navLights: true, beacon: true, strobeLights: true, landingLights: altitude < 3000 });
      this.fcs.reset();
      this.ap.syncTargets();
      this.ap.alt = Math.round(altitude / FT / 100) * 100;
      this.ap.spd = Math.round(this.fm.ias / KT);
      this.ap.hdg = Math.round(heading / DEG);
    } else {
      fm.placeOnGround(x, z, heading, groundH);
      this.gearLever = 1;
      this.gearPos = 1;
      fm.controls.gear = 1;
      this.throttleLever = 0;
      this.parkingBrake = mode === 'parked';
      const toFlaps = this.spec.category === 'fighter' ? 0 : Math.min(this.spec.category === 'private' && this.spec.cockpit === 'ga' ? 1 : 2, this.spec.flaps.length - 1);
      this.flapsIndex = mode === 'runway' ? toFlaps : 0;
      fm.controls.flaps = this.spec.flaps[this.flapsIndex].deg;
      if (coldDark) {
        for (const e of fm.engines) e.setRunning(false);
        Object.assign(s, { battery: false, avionics: false, fuelPumps: false, navLights: false, beacon: false, strobeLights: false, landingLights: false, taxiLights: false, seatbelts: false });
      } else {
        for (const e of fm.engines) e.setRunning(true);
        Object.assign(s, { battery: true, avionics: true, fuelPumps: true, navLights: true, beacon: true, strobeLights: mode === 'runway', landingLights: mode === 'runway', taxiLights: mode !== 'runway', seatbelts: true });
      }
      this.fcs.reset();
      this.ap.syncTargets();
      this.ap.hdg = Math.round(heading / DEG);
      this.ap.spd = this.spec.speeds.v2 || this.spec.speeds.vr + 10;
      this.ap.alt = Math.max(3000, Math.round((groundH / FT + 3000) / 1000) * 1000);
      this.spoilersArmed = mode === 'runway' && this.spec.aero.spoilerCL < 0;
    }
    fm.controls.trim = 0;
    this.lastRadioAlt = fm.agl;
  }

  // ---------------------------------------------------------------------------
  // Commands (from keyboard / cockpit / gamepad)
  // ---------------------------------------------------------------------------
  flapsUp() {
    if (this.flapsIndex > 0) {
      this.flapsIndex--;
      this.events.push({ type: 'flaps', index: this.flapsIndex });
    }
  }
  flapsDown() {
    if (this.flapsIndex < this.spec.flaps.length - 1) {
      this.flapsIndex++;
      this.events.push({ type: 'flaps', index: this.flapsIndex });
    }
  }
  setFlaps(i) {
    this.flapsIndex = clamp(i, 0, this.spec.flaps.length - 1);
    this.events.push({ type: 'flaps', index: this.flapsIndex });
  }
  toggleGear() {
    if (!this.spec.gear.retractable) return;
    const want = this.gearLever ? 0 : 1;
    if (want === 0 && this.fm.wow) {
      this.events.push({ type: 'message', text: 'Gear lever locked: weight on wheels' });
      return;
    }
    this.gearLever = want;
    this.events.push({ type: 'gear', down: !!want });
  }
  setGear(down) {
    if ((down ? 1 : 0) !== this.gearLever) this.toggleGear();
  }
  toggleSpoilers() {
    if (this.spec.aero.spoilerCL === 0 && !this.spec.aero.spoilerCD) return;
    if (this.spoilerLever > 0) this.spoilerLever = 0;
    else if (!this.spoilersArmed && this.fm.wow === false && this.gearLever === 1) this.spoilersArmed = true;
    else {
      this.spoilerLever = 1;
      this.spoilersArmed = false;
    }
    this.events.push({ type: 'spoilers', value: this.spoilerLever, armed: this.spoilersArmed });
  }
  armSpoilers() {
    this.spoilersArmed = !this.spoilersArmed;
    this.events.push({ type: 'spoilers', value: this.spoilerLever, armed: this.spoilersArmed });
  }
  toggleParkingBrake() {
    this.parkingBrake = !this.parkingBrake;
    this.events.push({ type: 'parkingBrake', on: this.parkingBrake });
  }
  toggleReverse() {
    if (!this.fm.wow && !this.reverseLever) return;
    this.reverseLever = !this.reverseLever;
    if (this.reverseLever) this.throttleLever = Math.min(this.throttleLever, 0.05);
    this.events.push({ type: 'reverse', on: this.reverseLever });
  }
  cycleAutobrake() {
    const modes = ['OFF', 'LO', 'MED', 'MAX'];
    this.autobrake = modes[(modes.indexOf(this.autobrake) + 1) % modes.length];
    this.events.push({ type: 'message', text: `Autobrake ${this.autobrake}` });
  }
  setSwitch(name, value) {
    if (!(name in this.switches)) return;
    this.switches[name] = value === undefined ? !this.switches[name] : !!value;
    this.events.push({ type: 'switch', name, value: this.switches[name] });
  }
  startEngine(i) {
    const e = this.fm.engines[i];
    if (!e || e.running) return;
    if (!this.powered) {
      this.events.push({ type: 'message', text: 'No electrical power — turn on the battery' });
      return;
    }
    e.fuelCutoff = false;
    e.starter = true;
    this.events.push({ type: 'engineStart', index: i });
  }
  stopEngine(i) {
    const e = this.fm.engines[i];
    if (!e) return;
    e.fuelCutoff = true;
    e.starter = false;
    this.events.push({ type: 'engineStop', index: i });
  }
  // Starts all engines in sequence (with a tiny delay handled by caller) or instantly.
  autoStart(instant = false) {
    this.switches.battery = true;
    this.switches.avionics = true;
    this.switches.fuelPumps = true;
    this.switches.beacon = true;
    this.switches.navLights = true;
    for (let i = 0; i < this.fm.engines.length; i++) {
      if (instant) this.fm.engines[i].setRunning(true);
      else this.startEngine(i);
    }
  }
  extinguish(i) {
    const e = this.fm.engines[i];
    if (e && e.fire) {
      e.fire = false;
      e.extinguished = true;
      e.failed = true;
      e.fuelCutoff = true;
      this.events.push({ type: 'message', text: `Engine ${i + 1} fire extinguished` });
    }
  }

  // Failure injection (missions)
  fail(type, index = 0) {
    const fm = this.fm;
    switch (type) {
      case 'engine':
        if (fm.engines[index]) fm.engines[index].failed = true;
        break;
      case 'fire':
        if (fm.engines[index]) fm.engines[index].fire = true;
        break;
      case 'allEngines':
        for (const e of fm.engines) e.failed = true;
        break;
      case 'fuelLeak':
        this.failures.fuelLeak = true;
        fm.fuelLeakRate = Math.max(0.5, this.spec.mass.maxFuel * 0.0006);
        break;
      case 'hydraulic':
        this.failures.hydraulic = true;
        break;
      case 'gear':
        this.failures.gearJam = true;
        break;
      case 'electrical':
        this.failures.electrical = true;
        break;
    }
    this.events.push({ type: 'failure', failure: type, index });
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  update(frameDt) {
    const fm = this.fm;
    const dtTotal = Math.min(frameDt, 0.1) * this.simRate;
    this.accumulator += dtTotal;
    let steps = 0;
    const maxSteps = 240 * 0.1 * Math.max(1, this.simRate);

    // Systems at frame rate
    this.updateSystems(dtTotal);

    // Wind
    this.wind.update(dtTotal);
    this.fm.env.tempOffset = this.weather.tempOffset || 0;
    this.wind.sample(fm.position, Math.max(0, fm.agl), this.weather, fm.env.wind, fm.env.turbMoment);

    // Navigation + autopilot
    this.nav.update(fm.position.x, fm.position.z, fm.position.y, fm.groundSpeed, fm.track);
    const apOut = this.ap.update(dtTotal);
    if (this.ap.engaged && Math.abs(this.input.pitch) + Math.abs(this.input.roll) > 0.6 && this.ap.vert !== 'ROLLOUT') this.ap.disengage('pilot override');

    // Engines get lever positions
    const thr = this.throttleLever;
    for (const e of fm.engines) {
      e.throttle = thr;
      e.reverseCmd = this.reverseLever;
    }

    const input = this.input;
    const fcsInput = this._fcsInput || (this._fcsInput = { pitch: 0, roll: 0, yaw: 0, tiller: 0 });
    fcsInput.pitch = input.pitch;
    fcsInput.roll = input.roll;
    fcsInput.yaw = input.yaw;
    fcsInput.tiller = input.tiller;
    if (this.ap.engaged && this.ap.lat === 'ROLLOUT') fcsInput.yaw = clamp(input.yaw + this.ap.steer, -1, 1);

    while (this.accumulator >= PHYS_DT && steps < maxSteps) {
      this.fcs.update(PHYS_DT, fcsInput, this.ap.engaged ? apOut : null);
      fm.step(PHYS_DT);
      this.accumulator -= PHYS_DT;
      steps++;
    }
    if (steps >= maxSteps) this.accumulator = 0;

    this.postUpdate(dtTotal);
  }

  updateSystems(dt) {
    const fm = this.fm;
    const spec = this.spec;
    const c = fm.controls;
    const hyd = !this.failures.hydraulic && fm.engines.some((e) => e.running || e.rpmFraction > 0.15);

    // Flaps
    const fRate = (spec.flapRate || 3) * (hyd ? 1 : 0.3);
    c.flaps = moveToward(c.flaps, this.flapsTarget, fRate * dt);

    // Gear
    if (spec.gear.retractable) {
      const t = spec.gear.retractTime || 8;
      if (this.gearLever === 1) {
        if (this.failures.gearJam || !hyd) {
          if (this.switches.altGear) this.gearPos = Math.min(1, this.gearPos + dt / 15);
        } else this.gearPos = Math.min(1, this.gearPos + dt / t);
      } else if (!fm.wow && hyd) this.gearPos = Math.max(0, this.gearPos - dt / t);
      c.gear = this.gearPos;
    } else c.gear = 1;

    // Spoilers: speed brake lever + armed ground spoilers
    const onGround = fm.wow && fm.groundTime > 0.15;
    if (this.spoilersArmed && onGround && this.throttleLever < 0.15 && fm.groundSpeed > 15) this.groundSpoilers = 1;
    if (this.throttleLever > 0.3 || fm.groundSpeed < 5) this.groundSpoilers = 0;
    const spTarget = Math.max(onGround ? this.spoilerLever : this.spoilerLever * 0.6, this.groundSpoilers);
    c.spoilers = moveToward(c.spoilers, spTarget, 1.5 * dt);

    // Brakes
    let bl = Math.max(this.input.brake, this.input.brakeL);
    let br = Math.max(this.input.brake, this.input.brakeR);
    if (this.parkingBrake) {
      bl = 1;
      br = 1;
    }
    // Autobrake
    if (this.autobrake !== 'OFF' && onGround && this.groundSpoilers > 0.5 && fm.groundSpeed > 8) this.autobrakeActive = true;
    if (this.autobrakeActive) {
      if (this.input.brake > 0.3 || this.throttleLever > 0.3 || fm.groundSpeed < 2 || fm.airborneTime > 1) this.autobrakeActive = false;
      else {
        const decel = { LO: 1.8, MED: 3.0, MAX: 5.5 }[this.autobrake] || 2;
        const vAlong = -this.fm.accel.dot(_tmp.copy(fm.velocity).normalize());
        this._abCmd = clamp((this._abCmd || 0.3) + (decel - vAlong) * 0.15 * dt, 0, 1);
        bl = Math.max(bl, this._abCmd);
        br = Math.max(br, this._abCmd);
      }
    } else this._abCmd = 0.2;
    c.brakeL = bl;
    c.brakeR = br;
    this.brakeTemp = Math.max(0, this.brakeTemp + ((bl + br) * 0.5 * fm.groundSpeed * 0.02 - this.brakeTemp * 0.003) * dt);

    // Electrical: avionics need power
    this.avionicsOn = this.powered && this.switches.avionics;
    if (!this.avionicsOn && this.ap.engaged) this.ap.disengage('power');

    // Fuel pumps: without pumps engines flame out above 20000 ft (suction feed below)
    const noPumps = !this.switches.fuelPumps || !this.powered;
    for (const e of fm.engines) {
      if (noPumps && fm.position.y > 6000 && e.running && spec.engine.type !== 'piston') e.fuelCutoff = true;
      if (e.fire && Math.random() < dt * 0.02) e.failed = true;
    }
  }

  postUpdate(dt) {
    const fm = this.fm;
    const spec = this.spec;
    const att = fm.getAttitude(_att);
    const st = this.stats;

    // Collect physics events
    for (const ev of fm.events) {
      this.events.push(ev);
      if (ev.type === 'touchdown') {
        st.touchdowns.push({ vs: ev.vs, ias: ev.ias, pitch: att.pitch, bank: att.bank, x: fm.position.x, z: fm.position.z, heading: att.heading, time: fm.time });
        this.calloutsDone.clear();
      }
      if (ev.type === 'liftoff') st.liftoffs++;
    }
    fm.events.length = 0;
    for (const ev of this.ap.events) this.events.push({ type: 'ap', what: ev });
    this.ap.events.length = 0;

    if (fm.crashed) return;

    // Statistics
    st.flightTime += dt;
    if (!fm.wow) st.airTime += dt;
    st.distance += fm.groundSpeed * dt;
    if (!fm.wow) {
      st.maxG = Math.max(st.maxG, fm.nz);
      st.minG = Math.min(st.minG, fm.nz);
      st.maxBank = Math.max(st.maxBank, Math.abs(att.bank));
      // Passenger comfort accumulates when manoeuvres are harsh
      const gExcess = Math.max(0, Math.abs(fm.nz - 1) - 0.25);
      const bankExcess = Math.max(0, Math.abs(att.bank) / DEG - 33) / 30;
      const vsExcess = Math.max(0, Math.abs(fm.velocity.y / FPM) - 3000) / 3000;
      st.discomfort += (gExcess * 2 + bankExcess + vsExcess) * dt;
    }
    st.maxAlt = Math.max(st.maxAlt, fm.position.y);
    st.maxIas = Math.max(st.maxIas, fm.ias);

    this.updateWarnings(dt, att);
  }

  updateWarnings(dt, att) {
    const fm = this.fm;
    const spec = this.spec;
    const w = this.warnings;
    const airborne = !fm.wow;
    const iasKt = fm.ias / KT;
    const radioAlt = fm.agl / FT;
    const vsFpm = fm.velocity.y / FPM;
    const powered = this.powered;

    w.stall = airborne && iasKt > 30 && fm.alpha > fm.alphaStall - 1.5 * DEG;
    const vmo = spec.speeds.vmo || spec.speeds.vne;
    w.overspeed = airborne && (iasKt > vmo + 3 || fm.mach > (spec.speeds.mmo || 9) + 0.01);
    if (w.overspeed) this.stats.overspeedTime += dt;
    if (w.stall) this.stats.stallTime += dt;
    w.gear =
      spec.gear.retractable &&
      airborne &&
      this.gearPos < 0.99 &&
      radioAlt < 750 &&
      vsFpm < -200 &&
      (this.flapsIndex >= this.spec.flaps.length - 2 || this.throttleLever < 0.2);
    w.sinkRate = airborne && radioAlt < 2500 && radioAlt > 30 && vsFpm < -Math.max(1500, radioAlt * 1.4 + 1000);
    w.pullUp = airborne && radioAlt < 2000 && radioAlt > 20 && vsFpm < -Math.max(2200, radioAlt * 1.8 + 1400);
    // Terrain look-ahead
    w.terrain = false;
    if (airborne && fm.groundSpeed > 30 && radioAlt < 3000 && this.gearPos < 0.5) {
      const look = 30;
      const px = fm.position.x + fm.velocity.x * look;
      const pz = fm.position.z + fm.velocity.z * look;
      const py = fm.position.y + fm.velocity.y * look;
      const g = fm.groundFn(px, pz);
      if (py - g.h < 60) w.terrain = true;
    }
    w.bankAngle = airborne && spec.category !== 'fighter' && Math.abs(att.bank) > 40 * DEG;
    w.lowFuel = !fm.infiniteFuel && fm.fuel < spec.mass.maxFuel * 0.08;
    w.engineFire = fm.engines.some((e) => e.fire);
    w.engineFail = fm.engines.some((e) => e.failed || (!e.running && !e.starting && !e.fuelCutoff));
    w.parkingBrake = this.parkingBrake && this.throttleLever > 0.6;
    w.config =
      fm.wow &&
      this.throttleLever > 0.6 &&
      spec.category !== 'fighter' &&
      (this.flapsIndex === 0 || this.groundSpoilers > 0 || this.spoilerLever > 0) &&
      spec.category !== 'private';
    w.flapOverspeed = airborne && this.flapsIndex > 0 && iasKt > (spec.speeds.vfe || 999) + 8;
    w.glideslope = airborne && this.nav.ils.gsValid && radioAlt < 1000 && radioAlt > 50 && this.nav.ils.gsDots < -1.5;
    w.hydraulic = this.failures.hydraulic;
    w.electrical = this.failures.electrical;
    w.fuelLeak = this.failures.fuelLeak;

    if (!powered) {
      for (const k of Object.keys(w)) if (k !== 'stall') w[k] = false;
    }
    this.masterWarning = w.stall || w.overspeed || w.pullUp || w.terrain || w.engineFire || w.config || w.gear;
    this.masterCaution = w.lowFuel || w.engineFail || w.bankAngle || w.sinkRate || w.flapOverspeed || w.hydraulic || w.electrical || w.fuelLeak || w.glideslope || w.parkingBrake;

    // Radio altitude callouts (airliners and business jets)
    if (spec.cockpit === 'airliner' && powered && airborne && this.gearPos > 0.9 && vsFpm < -100) {
      for (const h of CALLOUTS) {
        if (this.lastRadioAlt / FT > h && radioAlt <= h && !this.calloutsDone.has(h)) {
          this.calloutsDone.add(h);
          this.events.push({ type: 'callout', value: h });
          if (h === 200) this.events.push({ type: 'callout', value: 'minimums' });
        }
      }
    }
    if (!airborne || vsFpm > 500) {
      if (radioAlt > 2600) this.calloutsDone.clear();
    }
    this.lastRadioAlt = fm.agl;
  }

  consumeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // Compact state used by the HUD, network and AI.
  snapshot(out = {}) {
    const fm = this.fm;
    const att = fm.getAttitude(_att);
    out.ias = fm.ias / KT;
    out.tas = fm.tas / KT;
    out.gs = fm.groundSpeed / KT;
    out.mach = fm.mach;
    out.alt = fm.position.y / FT;
    out.radioAlt = fm.agl / FT;
    out.vs = fm.velocity.y / FPM;
    out.heading = att.heading / DEG;
    out.track = fm.track / DEG;
    out.pitch = att.pitch / DEG;
    out.bank = att.bank / DEG;
    out.alpha = fm.alpha / DEG;
    out.nz = fm.nz;
    out.fuel = fm.fuel;
    out.fuelFrac = fm.fuel / this.spec.mass.maxFuel;
    out.fuelFlow = fm.totalFuelFlow * 3600;
    out.throttle = this.throttleLever;
    out.flaps = this.flapsIndex;
    out.flapsName = this.spec.flaps[this.flapsIndex].name;
    out.gear = this.gearPos;
    out.onGround = fm.wow;
    return out;
  }
}

export { PHYS_DT };
