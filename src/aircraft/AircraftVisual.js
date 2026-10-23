// Animates an aircraft model from simulation state: control surfaces, gear,
// propellers, fans, afterburners and lights.

import * as THREE from 'three';
import { buildAircraftModel } from './ModelBuilder.js';

const DEG = Math.PI / 180;

export class AircraftVisual {
  constructor(spec, livery, opts = {}) {
    this.spec = spec;
    this.model = buildAircraftModel(spec, livery, opts);
    this.root = this.model.root;
    this.parts = this.model.parts;
    this.time = Math.random() * 10;
    this.propAngles = this.parts.props.map(() => Math.random() * 6);
    this.fanAngles = this.parts.fans.map(() => Math.random() * 6);
    this.lightIntensity = new Float32Array(this.parts.glow.geometry.attributes.intensity.count);
    this.strobePhase = Math.random();
  }

  get livery() {
    return this.model.livery;
  }

  setVisibleExterior(v) {
    this.root.visible = v;
  }

  // state: {
  //   elevator, aileron, rudder, flapsDeg, spoilers, gearPos, gear: [{compression, spin, steerAngle}],
  //   engines: [{ rpm (0..1), afterburner }], lights: { nav, strobe, beacon, landing, taxi }, night (0..1)
  // }
  update(dt, s) {
    this.time += dt;
    const p = this.parts;
    const el = s.elevator || 0;
    const ai = s.aileron || 0;
    const ru = s.rudder || 0;
    for (const e of p.elevators) {
      const side = e.userData.side || 1;
      let te = -el * 22;
      if (e.userData.elevon) te = -el * 18 - ai * 14 * side;
      e.rotation.x = te * DEG * e.userData.sign;
    }
    const flapVis = Math.min(40, s.flapsDeg || 0);
    for (const a of p.ailerons) {
      if (a.userData.elevon) continue;
      const side = a.userData.side || 1;
      let te = -ai * 18 * side;
      if (a.userData.name === 'flaperon') te += flapVis * 0.6;
      a.rotation.x = te * DEG * a.userData.sign;
    }
    for (const f of p.flaps) {
      if (f.userData.name === 'flaperon') continue;
      f.rotation.x = flapVis * DEG * f.userData.sign;
    }
    const sp = s.spoilers || 0;
    for (const f of p.spoilers) {
      // Spoilers also assist roll on airliners (the down-going wing's spoilers rise)
      const side = f.userData.side;
      const rollAssist = Math.max(0, ai * side) * 0.5;
      f.rotation.x = -Math.min(1, sp + rollAssist) * 48 * DEG * f.userData.sign;
    }
    for (const r of p.rudders) r.rotation.x = ru * 25 * DEG * r.userData.sign;
    for (const st of p.stabilators) {
      const side = st.userData.side;
      st.rotation.x = (-el * 18 - ai * 6 * side) * DEG * st.userData.sign;
    }
    for (const c of p.canards) c.rotation.x = el * 16 * DEG * c.userData.sign;

    // Gear
    const gp = s.gearPos ?? 1;
    const retract = (1 - gp) * 92 * DEG;
    const fighter = this.spec.category === 'fighter';
    for (let i = 0; i < p.gear.length; i++) {
      const leg = p.gear[i];
      const gs = s.gear ? s.gear[Math.min(i, s.gear.length - 1)] : null;
      if (leg.nose || fighter) leg.pivot.rotation.x = leg.nose ? retract : -retract;
      else leg.pivot.rotation.z = -leg.side * retract;
      leg.pivot.visible = gp > 0.03;
      const comp = (gs && gs.compression) || 0;
      leg.lower.position.y = -leg.legLen + Math.min(comp, leg.legLen * 0.5);
      if (leg.nose && gs) leg.lower.rotation.y = -(gs.steerAngle || 0);
      if (gs) for (const w of leg.wheels) w.rotation.x = (-(gs.spin || 0) / Math.max(0.1, leg.radius)) * 0.5;
    }

    // Props
    const engines = s.engines || [];
    for (let i = 0; i < p.props.length; i++) {
      const pr = p.props[i];
      const e = engines[Math.min(i, engines.length - 1)] || { rpm: 0 };
      const rpm = e.rpm || 0;
      this.propAngles[i] += rpm * 2 * Math.PI * 22 * dt * pr.dir;
      pr.blades.rotation.z = this.propAngles[i];
      const fast = rpm > 0.32;
      pr.disc.visible = fast;
      pr.blades.visible = !fast || rpm < 0.45;
      pr.disc.material.opacity = Math.min(1, (rpm - 0.3) * 3);
    }
    for (let i = 0; i < p.fans.length; i++) {
      const e = engines[Math.min(i, engines.length - 1)] || { rpm: 0 };
      this.fanAngles[i] += (e.rpm || 0) * 2 * Math.PI * 12 * dt;
      p.fans[i].rotation.z = this.fanAngles[i];
    }
    for (let i = 0; i < p.afterburners.length; i++) {
      const e = engines[Math.min(i, engines.length - 1)] || {};
      const ab = e.afterburner || 0;
      const f = p.afterburners[i];
      f.visible = ab > 0.02;
      f.material.uniforms.uIntensity.value = ab;
      f.material.uniforms.uTime.value = this.time;
      f.scale.set(1, 0.6 + ab * 0.6, 1);
    }

    // Lights
    const L = s.lights || {};
    const groups = p.lightGroups;
    const I = this.lightIntensity;
    I.fill(0);
    const set = (name, v) => {
      if (groups[name]) for (const k of groups[name]) I[k] = v;
    };
    if (L.nav) {
      set('navRed', 1);
      set('navGreen', 1);
      set('navWhite', 0.9);
    }
    if (L.strobe) {
      const t = (this.time + this.strobePhase) % 1.3;
      set('strobe', t < 0.05 || (t > 0.16 && t < 0.2) ? 3 : 0);
    }
    if (L.beacon) {
      const t = (this.time + this.strobePhase * 0.7) % 1.0;
      set('beacon', t < 0.14 ? 1.8 : 0.05);
    }
    if (L.landing) set('landing', 1.0 + 0.8 * (s.night ?? 0));
    if (L.taxi && gp > 0.9) set('taxi', 1.2);
    const attr = p.glow.geometry.attributes.intensity;
    attr.array.set(I);
    attr.needsUpdate = true;
    p.glowMat.uniforms.uGlobal.value = 0.35 + 1.1 * (s.night ?? 0);
  }

  dispose() {
    this.model.dispose();
  }
}

// Builds the visual state object from an AircraftSim.
export function visualStateFromSim(sim, night, out = {}) {
  const fm = sim.fm;
  const c = fm.controls;
  out.elevator = c.elevator;
  out.aileron = c.aileron;
  out.rudder = c.rudder;
  out.flapsDeg = c.flaps;
  out.spoilers = c.spoilers;
  out.gearPos = sim.spec.gear.retractable ? sim.gearPos : 1;
  out.gear = out.gear || fm.gear.map(() => ({}));
  for (let i = 0; i < fm.gear.length; i++) {
    const g = fm.gear[i];
    const o = out.gear[i];
    o.compression = g.compression;
    o.spin = g.spin;
    o.steerAngle = g.steerAngle;
  }
  out.engines = out.engines || fm.engines.map(() => ({}));
  for (let i = 0; i < fm.engines.length; i++) {
    const e = fm.engines[i];
    out.engines[i].rpm = e.rpmFraction;
    out.engines[i].afterburner = e.afterburner;
  }
  const sw = sim.switches;
  const powered = sim.powered;
  out.lights = out.lights || {};
  out.lights.nav = powered && sw.navLights;
  out.lights.strobe = powered && sw.strobeLights;
  out.lights.beacon = powered && sw.beacon;
  out.lights.landing = powered && sw.landingLights;
  out.lights.taxi = powered && sw.taxiLights;
  out.night = night;
  return out;
}
