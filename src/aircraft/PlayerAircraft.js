// The player's aircraft: simulation + visual model + cockpit + cabin + effects,
// input application, sound/warning handling and the flight data feed used by
// every instrument and the HUD.

import * as THREE from 'three';
import { AircraftSim } from './AircraftSim.js';
import { AircraftVisual, visualStateFromSim } from './AircraftVisual.js';
import { Cockpit } from '../cockpit/Cockpit.js';
import { CabinInterior, hasCabin } from '../cockpit/CabinInterior.js';
import { AircraftEffects } from './Effects.js';
import { AIRPORT_INFO, nearestAirport, bestRunwayEnd } from '../world/airportGeometry.js';
import { KT, FT, FPM, DEG } from '../physics/atmosphere.js';
import { fmtTime, fmtDuration } from '../core/format.js';

const ND_AIRPORTS = AIRPORT_INFO.map((a) => ({
  icao: a.icao,
  x: a.x,
  z: a.z,
  runways: a.runwayObjs.map((r) => ({ x1: r.ends[0].x, z1: r.ends[0].z, x2: r.ends[1].x, z2: r.ends[1].z })),
}));

const WARNING_TEXT = {
  pullUp: 'PULL UP',
  terrain: 'TERRAIN',
  stall: 'STALL',
  overspeed: 'OVERSPEED',
  gear: 'GEAR NOT DOWN',
  engineFire: 'ENGINE FIRE',
  config: 'CONFIG',
};

export class PlayerAircraft {
  constructor(game, spec, livery, opts = {}) {
    this.game = game;
    this.spec = spec;
    const gp = game.settings.get('gameplay');
    this.sim = new AircraftSim(spec, { groundFn: game.world.groundAt, weather: game.weather.state, crashEnabled: gp.crashes });
    this.sim.setAssist(gp.difficulty === 'beginner' ? 'beginner' : gp.difficulty === 'realistic' ? 'realistic' : 'intermediate');
    this.sim.fm.infiniteFuel = !!gp.unlimitedFuel;
    this.livery = livery;
    this.visual = new AircraftVisual(spec, livery, { detail: 'high' });
    game.scene.add(this.visual.root);
    this.cockpit = new Cockpit(this);
    this.visual.root.add(this.cockpit.group);
    this.hasCabin = hasCabin(spec);
    if (this.hasCabin) {
      this.cabin = new CabinInterior(spec);
      this.visual.root.add(this.cabin.group);
    }
    this.effects = new AircraftEffects(game.scene, this);
    // Landing light illuminating the runway at night
    this.landingLight = new THREE.SpotLight(0xfff2dd, 0, 1100, 0.33, 0.55, 1.2);
    this.landingLight.castShadow = false;
    const ll = spec.gear.points[0].pos;
    this.landingLight.position.set(0, ll[1] + 0.8, ll[2] - 1);
    this.landingLight.target.position.set(0, ll[1] - 8, ll[2] - 120);
    this.visual.root.add(this.landingLight);
    this.visual.root.add(this.landingLight.target);

    this.inputs = { pitch: 0, roll: 0, yaw: 0 };
    this.attitude = { pitch: 0, heading: 0, bank: 0 };
    this.flightData = { powered: true, engines: [], ap: {} };
    this.visState = {};
    this.shakeAmount = 0;
    this.silenced = false;
    this.lastWarn = {};
    this.iasTrend = 0;
    this.lastIas = 0;
    this.callsign = opts.callsign || `${spec.callsignPrefix || 'SKY'} ${Math.floor(100 + Math.random() * 899)}`;
    this.messages = [];
    game.audio.setAircraft(spec);
  }

  get position() {
    return this.sim.fm.position;
  }

  dispose() {
    this.game.scene.remove(this.visual.root);
    this.visual.dispose();
    this.cockpit.dispose();
    this.effects.dispose();
    this.game.audio.stopAllWarnings();
  }

  toggleAP() {
    const ap = this.sim.ap;
    if (ap.engaged) ap.disengage('manual');
    else if (!ap.engage()) this.game.ui.toast('Autopilot cannot engage on the ground', 'warn');
  }

  toggleATHR() {
    const ap = this.sim.ap;
    if (!this.spec.autopilot.athr) {
      this.game.ui.toast('This aircraft has no autothrottle', 'warn');
      return;
    }
    ap.setAthr(!ap.athr);
    this.game.audio.chime(ap.athr ? 'apEngage' : 'caution');
  }

  armApproach() {
    const nav = this.sim.nav;
    if (!nav.approach) {
      const end = this.autoSelectApproach();
      if (end) nav.setApproach(end);
      else {
        this.game.ui.toast('No ILS approach selected — choose a runway in the map / ATC menu', 'warn');
        return;
      }
    }
    if (this.sim.ap.modeAPP()) this.game.ui.toast(`Approach armed: ${nav.approach.airport.icao} RWY ${nav.approach.id}`, 'info');
  }

  // Pick an ILS runway at the destination (or the nearest airport) into the wind
  autoSelectApproach() {
    const nav = this.sim.nav;
    const pos = this.position;
    let ap = nav.destination;
    if (!ap || Math.hypot(ap.x - pos.x, ap.z - pos.z) > 120000) ap = nearestAirport(pos.x, pos.z).airport;
    if (!ap) return null;
    const ws = this.game.weather.state;
    const minLen = this.spec.mass.maxTakeoff > 150000 ? 2400 : this.spec.mass.maxTakeoff > 30000 ? 1600 : 500;
    const best = bestRunwayEnd(ap, ws.windDir, Math.max(3, ws.windSpeed), minLen);
    if (best && best.ils) return best;
    const ils = ap.runwayObjs.flatMap((r) => r.ends).filter((e) => e.ils);
    return ils[0] || best || null;
  }

  update(dt, input) {
    const sim = this.sim;
    const fm = sim.fm;
    const ax = input.axes;
    const game = this.game;
    // Pilot inputs
    sim.input.pitch = ax.pitch;
    sim.input.roll = ax.roll;
    sim.input.yaw = ax.yaw;
    sim.input.brake = ax.brake;
    this.inputs.pitch = ax.pitch;
    this.inputs.roll = ax.roll;
    this.inputs.yaw = ax.yaw;
    if (ax.throttleAbs !== null && ax.throttleAbs !== undefined) {
      if (sim.ap.athr) sim.ap.setAthr(false);
      sim.throttleLever = ax.throttleAbs;
    } else if (ax.throttleRate) {
      if (sim.ap.athr) {
        sim.ap.setAthr(false);
        game.ui.toast('A/THR disconnected (manual thrust)', 'info');
      }
      sim.throttleLever = Math.max(0, Math.min(1, sim.throttleLever + ax.throttleRate * dt));
    }
    if (ax.trim) fm.controls.trim = Math.max(-1, Math.min(1, fm.controls.trim + ax.trim * 0.25 * dt));
    sim.fm.infiniteFuel = !!game.settings.get('gameplay').unlimitedFuel;

    sim.update(dt);

    // Visual transform
    const root = this.visual.root;
    root.position.copy(fm.position);
    root.quaternion.copy(fm.quaternion);
    root.updateMatrixWorld();
    const night = game.world.night;
    visualStateFromSim(sim, night, this.visState);
    this.visual.update(dt, this.visState);

    fm.getAttitude(this.attitude);

    // Cockpit / cabin visibility and updates
    const camMode = game.cameras.mode;
    const inCockpit = camMode === 'cockpit';
    const inCabin = camMode === 'cabin';
    this.cockpit.setVisible(inCockpit || camMode === 'cabin' ? inCockpit : false);
    if (this.cabin) {
      this.cabin.group.visible = inCabin;
      this.cabin.update(sim.switches.cabinLights && sim.powered, night);
    }
    this.cockpit.update(dt, night, inCockpit);
    // Hide the external canopy glass from inside to avoid double reflections
    if (this.visual.parts.canopy) this.visual.parts.canopy.visible = !inCockpit;

    // Landing light
    const llOn = sim.switches.landingLights && sim.powered;
    this.landingLight.intensity = llOn ? 60 + 3000 * night : 0;

    // Shake
    const gs = fm.groundSpeed;
    let shake = fm.wow ? Math.min(1, gs / 50) * (fm.groundSurface === 'grass' || fm.groundSurface === 'dirt' ? 1.6 : 0.5) : 0;
    shake += sim.wind.intensity * 0.8;
    if (fm.stalled) shake += 0.8;
    if (sim.warnings.stall) shake += 0.4;
    for (const e of sim.engines) shake += (e.afterburner || 0) * 0.15;
    shake += Math.max(0, fm.mach - 0.95) * 2 * (fm.mach < 1.1 ? 1 : 0);
    if (this.touchShake > 0) {
      shake += this.touchShake;
      this.touchShake = Math.max(0, this.touchShake - dt * 3);
    }
    this.shakeAmount = shake;

    // Events
    for (const ev of sim.consumeEvents()) this.handleEvent(ev);

    // Warnings / sounds
    this.updateWarnings();

    this.effects.update(dt, game.world, game.weather);
    this.buildFlightData(dt);
  }

  handleEvent(ev) {
    const game = this.game;
    const audio = game.audio;
    switch (ev.type) {
      case 'touchdown': {
        const fpm = ev.vs / FPM;
        const strength = Math.min(1, Math.abs(fpm) / 600);
        audio.thump(0.3 + strength);
        if (ev.gs > 25) {
          audio.screech(0.5 + strength);
          this.effects.touchdown(strength);
        }
        this.touchShake = 0.5 + strength * 2;
        game.onTouchdown(ev);
        break;
      }
      case 'crash':
        audio.explosion();
        this.effects.crash();
        game.onCrash(ev.reason);
        break;
      case 'hardLanding':
        game.ui.toast(`Hard landing: ${Math.round(ev.vs / FPM)} fpm`, 'warn');
        break;
      case 'tailstrike':
        game.ui.toast('TAIL STRIKE!', 'warn');
        audio.burst({ type: 'white', filter: 'lowpass', freq: 800, dur: 0.6, gain: 0.6, bus: 'env' });
        break;
      case 'scrape':
        audio.burst({ type: 'white', filter: 'bandpass', freq: 1500, dur: 0.4, gain: 0.4, bus: 'env' });
        break;
      case 'bellyLanding':
        game.ui.toast('Gear-up landing!', 'warn');
        break;
      case 'liftoff':
        game.onLiftoff(ev);
        break;
      case 'gear':
        audio.gearMotor();
        break;
      case 'flaps':
        audio.flapsMotor();
        audio.click();
        break;
      case 'switch':
      case 'spoilers':
      case 'parkingBrake':
      case 'reverse':
        audio.click();
        if (ev.name === 'seatbelts') audio.chime('seatbelt');
        break;
      case 'engineStart':
        audio.click();
        game.ui.toast(`Engine ${ev.index + 1} starting…`, 'info');
        break;
      case 'message':
        game.ui.toast(ev.text, 'info');
        break;
      case 'failure': {
        const names = { engine: `ENGINE ${ev.index + 1} FAILURE`, fire: `ENGINE ${ev.index + 1} FIRE`, fuelLeak: 'FUEL LEAK', hydraulic: 'HYDRAULIC FAILURE', gear: 'GEAR MALFUNCTION', electrical: 'ELECTRICAL FAILURE', allEngines: 'DUAL ENGINE FAILURE' };
        game.ui.toast(names[ev.failure] || 'SYSTEM FAILURE', 'error');
        audio.chime('warning');
        break;
      }
      case 'callout':
        audio.callout(ev.value);
        break;
      case 'ap':
        if (ev.what === 'disconnect') audio.chime('apDisconnect');
        else if (ev.what === 'engage') audio.chime('apEngage');
        else if (ev.what === 'altCapture') audio.chime('altAlert');
        else if (ev.what === 'flare' && this.spec.cockpit === 'airliner') setTimeout(() => audio.callout('retard'), 2500);
        break;
    }
    game.events.emit('aircraftEvent', ev);
  }

  updateWarnings() {
    const sim = this.sim;
    const w = sim.warnings;
    const audio = this.game.audio;
    const ga = this.spec.cockpit === 'ga';
    if (!sim.crashed) {
      audio.setWarning('stall', !!w.stall, ga ? 'ga' : 'jet');
      audio.setWarning('overspeed', !!w.overspeed && !this.silenced);
      audio.setWarning('gear', !!w.gear && !this.silenced);
      audio.setWarning('fire', !!w.engineFire && !this.silenced);
      audio.setWarning('config', !!w.config);
    } else audio.stopAllWarnings();
    if (!w.overspeed && !w.gear && !w.engineFire) this.silenced = false;
    // Voice alerts with repeat intervals
    const now = performance.now();
    const say = (key, cond, word, every = 3500) => {
      if (cond && (!this.lastWarn[key] || now - this.lastWarn[key] > every)) {
        this.lastWarn[key] = now;
        audio.callout(word);
      }
    };
    if (this.spec.cockpit !== 'ga' && !sim.crashed) {
      say('pullUp', w.pullUp, 'pullup', 2500);
      say('terrain', w.terrain && !w.pullUp, 'terrain', 4000);
      say('sink', w.sinkRate && !w.pullUp, 'sinkrate', 3500);
      say('bank', w.bankAngle, 'bankangle', 4000);
      say('gearLow', w.gear, 'toolowgear', 5000);
      say('gs', w.glideslope, 'glideslope', 5000);
    }
    // Master caution chime on new cautions
    const anyC = sim.masterCaution;
    if (anyC && !this.prevCaution) audio.chime('caution');
    this.prevCaution = anyC;
  }

  buildFlightData(dt) {
    const sim = this.sim;
    const fm = sim.fm;
    const spec = this.spec;
    const game = this.game;
    const d = this.flightData;
    const s = sim.snapshot(d);
    void s;
    d.powered = sim.powered && sim.switches.avionics !== false;
    d.x = fm.position.x;
    d.z = fm.position.z;
    d.beta = fm.beta / DEG;
    d.slip = fm.ny;
    d.turnRate = (-fm.omega.y / DEG) * 1.0;
    const iasNow = fm.ias / KT;
    const trend = (iasNow - this.lastIas) / Math.max(1e-3, dt);
    this.iasTrend = this.iasTrend * 0.92 + trend * 0.08;
    this.lastIas = iasNow;
    d.iasTrend = this.iasTrend;
    d.vmax = spec.speeds.vmo || spec.speeds.vne;
    if (sim.flapsIndex > 0 && spec.speeds.vfe) d.vmax = Math.min(d.vmax, spec.speeds.vfe);
    const stallFactor = Math.sqrt(fm.mass / spec.mass.reference);
    const flapFrac = sim.flapsIndex / Math.max(1, spec.flaps.length - 1);
    d.vstall = spec.speeds.vs * stallFactor * (1.22 - 0.22 * flapFrac) * (spec.category === 'fighter' ? 0.8 : 1);
    d.vls = d.vstall * 1.23;
    d.vr = spec.speeds.vr;
    d.engineType = spec.engine.type;
    d.maxRPM = spec.engine.maxRPM;
    d.engines.length = sim.engines.length;
    sim.engines.forEach((e, i) => {
      const o = d.engines[i] || (d.engines[i] = {});
      o.n1 = e.n1 ?? e.rpmFraction;
      o.n2 = e.n2 ?? e.rpmFraction;
      o.egt = e.egt;
      o.ff = e.fuelFlow * 3600;
      o.rpm = e.rpm ?? 0;
      o.power = e.powerFrac ?? e.n1;
      o.afterburner = e.afterburner;
      o.reverse = e.reverse;
      o.failed = e.failed;
      o.fire = e.fire;
      o.oil = e.oilPressure;
      o.status = e.statusText;
      o.running = e.running;
    });
    d.afterburner = sim.engines.some((e) => e.afterburner > 0.1);
    d.mass = fm.mass;
    d.oat = fm.oat;
    d.flapsFrac = flapFrac;
    d.spoilers = fm.controls.spoilers;
    d.spoilersArmed = sim.spoilersArmed;
    d.parkingBrake = sim.parkingBrake;
    d.autobrake = sim.autobrake;
    d.brakeTemp = sim.brakeTemp;
    d.clock = fmtTime(game.world.time);
    d.flightTime = fmtDuration(sim.stats.flightTime);
    d.nz = fm.nz;
    // Autopilot
    const ap = sim.ap;
    d.ap = d.ap || {};
    Object.assign(d.ap, {
      engaged: ap.engaged,
      athr: ap.athr,
      athrMode: ap.athrMode,
      lat: ap.lat,
      latArmed: ap.latArmed,
      vert: ap.vert,
      vertArmed: ap.vertArmed,
      hdg: ap.hdg,
      alt: ap.alt,
      vs: ap.vs,
      spd: ap.spd,
      mach: ap.mach,
      useMach: ap.useMach,
      fdOn: ap.fd,
      canLand: ap.canAutoland,
    });
    d.fd = d.fd || {};
    d.fd.on = ap.fd && !fm.wow && (ap.engaged || ap.lat !== 'HDG' || true);
    d.fd.pitch = ap.pitchCmd / DEG;
    d.fd.bank = ap.bankCmd / DEG;
    d.protection = sim.fcs.protection;
    // Navigation
    const nav = sim.nav;
    d.plan = nav.plan;
    d.activeWpt = nav.active;
    d.guidance = nav.guidance;
    d.ils = d.ils || {};
    Object.assign(d.ils, nav.ils);
    d.ils.ident = nav.approach ? `I-${nav.approach.airport.icao.slice(2)}${nav.approach.id}` : '';
    d.airports = ND_AIRPORTS;
    d.traffic = game.trafficFor ? game.trafficFor(fm.position) : [];
    d.storms = game.weather.state.storms;
    d.weatherRadar = true;
    const wind = sim.wind.mean;
    const wspd = Math.hypot(wind.x, wind.z);
    d.wind = { dir: ((Math.atan2(-wind.x, wind.z) / DEG + 360) % 360), kt: wspd / KT };
    d.ndRange = this.cockpit.ndRange;
    // Warnings
    const w = sim.warnings;
    let wt = '';
    for (const k of ['pullUp', 'terrain', 'stall', 'engineFire', 'gear', 'overspeed', 'config']) if (w[k]) {
      wt = WARNING_TEXT[k];
      break;
    }
    d.warningText = wt;
    const msgs = [];
    if (w.engineFire) msgs.push({ text: 'ENG FIRE', level: 'warning' });
    if (w.stall) msgs.push({ text: 'STALL', level: 'warning' });
    if (w.config) msgs.push({ text: 'CONFIG T/O FLAPS', level: 'warning' });
    if (w.engineFail) msgs.push({ text: 'ENG FAIL', level: 'caution' });
    if (w.lowFuel) msgs.push({ text: 'FUEL LO LEVEL', level: 'caution' });
    if (w.fuelLeak) msgs.push({ text: 'FUEL LEAK', level: 'caution' });
    if (w.hydraulic) msgs.push({ text: 'HYD SYS LO PR', level: 'caution' });
    if (w.electrical) msgs.push({ text: 'ELEC GEN FAULT', level: 'caution' });
    if (w.parkingBrake) msgs.push({ text: 'PARK BRK ON', level: 'caution' });
    if (w.flapOverspeed) msgs.push({ text: 'FLAP OVERSPEED', level: 'caution' });
    if (sim.switches.seatbelts && this.spec.category !== 'fighter') msgs.push({ text: 'SEAT BELTS', level: 'memo' });
    if (sim.spoilersArmed) msgs.push({ text: 'GND SPLRS ARMED', level: 'memo' });
    d.messages = msgs;
    d.onGround = fm.wow;
    d.callsign = this.callsign;
  }
}
