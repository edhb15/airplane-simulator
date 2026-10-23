// Six-degree-of-freedom rigid body flight model.
// Aerodynamics use a stability-derivative model with non-linear lift (stall),
// induced/parasitic/wave drag, ground effect, flaps, spoilers and gear drag.
// Landing gear are spring-damper contacts with rolling, braking and side friction.

import { Vector3, Quaternion } from 'three';
import { atmosphere, G0, DEG, tasToIas } from './atmosphere.js';
import { createEngines } from './engines.js';
import { structuralContacts } from '../aircraft/aircraftData.js';

const _va = new Vector3();
const _vb = new Vector3();
const _qInv = new Quaternion();
const _F = new Vector3();
const _Fw = new Vector3();
const _tau = new Vector3();
const _r = new Vector3();
const _p = new Vector3();
const _vp = new Vector3();
const _wWorld = new Vector3();
const _n = new Vector3();
const _fwd = new Vector3();
const _lat = new Vector3();
const _gf = new Vector3();
const _tq = new Vector3();
const _tmp = new Vector3();
const _spec = new Vector3();

const SURFACE = {
  asphalt: { roll: 0.015, brake: 0.62, side: 0.8 },
  concrete: { roll: 0.015, brake: 0.62, side: 0.8 },
  grass: { roll: 0.05, brake: 0.32, side: 0.55 },
  dirt: { roll: 0.04, brake: 0.38, side: 0.6 },
  snow: { roll: 0.035, brake: 0.18, side: 0.3 },
  wet: { roll: 0.016, brake: 0.4, side: 0.55 },
  water: { roll: 0.5, brake: 0.5, side: 0.5 },
};

const flatGroundResult = { h: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', water: false };
function flatGround() {
  return flatGroundResult;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Lift coefficient with linear range, soft stall and flat-plate behaviour beyond.
export function liftCoefficient(alpha, CL0, CLa, aStall, aStallNeg) {
  const flat = 1.05 * Math.sin(2 * alpha);
  if (alpha >= aStallNeg && alpha <= aStall) {
    // Round the peak slightly in the last 2 degrees
    const lin = CL0 + CLa * alpha;
    const near = smoothstep(aStall - 3 * DEG, aStall, alpha);
    return lin - near * CLa * 0.6 * DEG;
  }
  if (alpha > aStall) {
    const peak = CL0 + CLa * aStall - CLa * 0.6 * DEG;
    const t = smoothstep(aStall, aStall + 14 * DEG, alpha);
    const drop = peak * (1 - 0.28 * smoothstep(aStall, aStall + 3 * DEG, alpha));
    return drop + (flat - drop) * t;
  }
  const peakN = CL0 + CLa * aStallNeg;
  const t = smoothstep(-aStallNeg, -aStallNeg + 14 * DEG, -alpha);
  const dropN = peakN * (1 - 0.25 * smoothstep(-aStallNeg, -aStallNeg + 3 * DEG, -alpha));
  return dropN + (flat - dropN) * t;
}

function waveDrag(M, A) {
  const mc = A.Mcrit || 0.8;
  if (M <= mc) return 0;
  if (!A.supersonic) {
    const d = M - mc;
    return 20 * d * d * d + 1.5 * d * d;
  }
  const peak = A.waveDrag || 0.03;
  if (M < 1.05) {
    const t = (M - mc) / (1.05 - mc);
    return peak * t * t * (3 - 2 * t);
  }
  return peak * (0.55 + (0.45 * 1.05) / M);
}

export class FlightModel {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.omega = new Vector3(); // body angular velocity (x pitch, y yaw, z roll; right-handed)
    this.accel = new Vector3();
    this.specificForce = new Vector3(0, G0, 0);
    this.engines = createEngines(spec.engine);
    this.fuel = spec.mass.maxFuel * 0.5;
    this.payload = 0;
    this.infiniteFuel = false;
    this.fuelLeakRate = 0;
    this.groundFn = opts.groundFn || flatGround;
    this.crashEnabled = opts.crashEnabled !== false;
    this.env = { wind: new Vector3(), tempOffset: 0, turbMoment: new Vector3() };
    this.controls = {
      elevator: 0,
      aileron: 0,
      rudder: 0,
      trim: 0,
      flaps: 0, // degrees
      gear: spec.gear.retractable ? 1 : 1, // 1 = down
      spoilers: 0,
      brakeL: 0,
      brakeR: 0,
      steer: 0,
    };
    this.maxFlapDeg = spec.flaps[spec.flaps.length - 1].deg || 1;

    this.gear = spec.gear.points.map((p) => ({
      ...p,
      body: new Vector3(p.pos[0], p.pos[1], p.pos[2]),
      compression: 0,
      contact: false,
      load: 0,
      spin: 0,
      steerAngle: 0,
      broken: false,
      k: 0,
      c: 0,
    }));
    this.gearBottomY = Math.min(...spec.gear.points.map((p) => p.pos[1]));
    this.contacts = structuralContacts(spec).map((c) => ({ ...c, body: new Vector3(c.pos[0], c.pos[1], c.pos[2]), contact: false }));
    this.computeGearConstants();

    // Outputs
    this.alpha = 0;
    this.beta = 0;
    this.tas = 0;
    this.ias = 0;
    this.mach = 0;
    this.qbar = 0;
    this.rho = 1.225;
    this.oat = 15;
    this.nz = 1;
    this.ny = 0;
    this.agl = 0;
    this.groundHeight = 0;
    this.groundSurface = 'asphalt';
    this.wow = false;
    this.airborneTime = 0;
    this.groundTime = 0;
    this.stalled = false;
    this.crashed = false;
    this.crashReason = '';
    this.damage = 0;
    this.events = [];
    this.totalFuelFlow = 0;
    this.overstressTime = 0;
    this.moment0 = new Vector3(); // aero moments without controls: (L roll, M pitch, N yaw)
    this.ctrlEff = new Vector3(); // moment per unit command (L/aileron, M/elevator, N/rudder)
    this.inertia = new Vector3(1, 1, 1);
    this.CL = 0;
    this.CD = 0;
    this.time = 0;
    this.lastTouchdown = null;
  }

  get mass() {
    return this.spec.mass.empty + this.fuel + this.payload;
  }

  computeGearConstants() {
    const spec = this.spec;
    const m = spec.mass.reference;
    const nose = this.gear.find((g) => g.name === 'nose');
    const mains = this.gear.filter((g) => g.name !== 'nose');
    const zm = mains.reduce((a, g) => a + g.body.z, 0) / Math.max(1, mains.length);
    const zn = nose ? nose.body.z : zm - 1;
    const noseFrac = clamp(zm / (zm - zn), 0.05, 0.3);
    const travel = spec.gear.travel || 0.3;
    for (const g of this.gear) {
      const frac = g.name === 'nose' ? noseFrac : (1 - noseFrac) / Math.max(1, mains.length);
      const W = m * G0 * frac;
      g.k = W / (travel * 0.35);
      g.c = 2 * 0.7 * Math.sqrt(g.k * (W / G0));
      g.travel = travel;
    }
  }

  resetState() {
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.crashed = false;
    this.crashReason = '';
    this.damage = 0;
    this.events.length = 0;
    this.overstressTime = 0;
    for (const g of this.gear) {
      g.broken = false;
      g.contact = false;
      g.compression = 0;
    }
    for (const c of this.contacts) c.contact = false;
  }

  emit(type, data = {}) {
    this.events.push({ type, time: this.time, ...data });
  }

  crash(reason) {
    if (this.crashed) return;
    if (!this.crashEnabled) {
      this.emit('crashIgnored', { reason });
      return;
    }
    this.crashed = true;
    this.crashReason = reason;
    this.emit('crash', { reason, speed: this.velocity.length() });
  }

  step(dt) {
    this.time += dt;
    if (this.crashed) {
      this.velocity.multiplyScalar(Math.max(0, 1 - 3 * dt));
      this.omega.multiplyScalar(Math.max(0, 1 - 3 * dt));
      this.position.addScaledVector(this.velocity, dt);
      for (const e of this.engines) e.thrust = 0;
      return;
    }
    const spec = this.spec;
    const A = spec.aero;
    const ctl = this.controls;
    const S = spec.wing.area;
    const b = spec.wing.span;
    const c = spec.wing.chord;
    const mass = this.mass;
    const ms = mass / spec.mass.reference;
    // inertia: x = pitch (Iyy), y = yaw (Izz), z = roll (Ixx)
    this.inertia.set(spec.inertia[1] * ms, spec.inertia[2] * ms, spec.inertia[0] * ms);

    const atm = atmosphere(this.position.y, this.env.tempOffset);
    this.rho = atm.rho;
    this.oat = atm.T - 273.15;

    // Air-relative velocity in body axes
    _va.copy(this.velocity).sub(this.env.wind);
    _qInv.copy(this.quaternion).invert();
    _vb.copy(_va).applyQuaternion(_qInv);
    const V = _vb.length();
    this.tas = V;
    this.mach = V / atm.a;
    this.ias = tasToIas(V, atm.rho);

    // Ground below CG
    const g0 = this.groundFn(this.position.x, this.position.z, this.position.y);
    this.groundHeight = g0.h;
    this.groundSurface = g0.surface;
    this.agl = this.position.y - g0.h + this.gearBottomY;

    let alpha = 0,
      beta = 0,
      qbar = 0;
    if (V > 0.5) {
      alpha = Math.atan2(-_vb.y, -_vb.z);
      beta = Math.asin(clamp(_vb.x / V, -1, 1));
      qbar = 0.5 * atm.rho * V * V;
    }
    this.alpha = alpha;
    this.beta = beta;
    this.qbar = qbar;

    // Flap table interpolation
    const flaps = spec.flaps;
    let dCL = 0,
      dCD = 0,
      dStall = 0;
    const fd = ctl.flaps;
    for (let i = 0; i < flaps.length - 1; i++) {
      const f0 = flaps[i],
        f1 = flaps[i + 1];
      if (fd <= f1.deg || i === flaps.length - 2) {
        const t = clamp((fd - f0.deg) / Math.max(1e-6, f1.deg - f0.deg), 0, 1);
        dCL = f0.dCL + (f1.dCL - f0.dCL) * t;
        dCD = f0.dCD + (f1.dCD - f0.dCD) * t;
        dStall = f0.dStall + (f1.dStall - f0.dStall) * t;
        break;
      }
    }
    if (flaps.length === 1) {
      dCL = flaps[0].dCL;
      dCD = flaps[0].dCD;
    }
    const aStall = (A.alphaStall + dStall) * DEG;
    const aStallNeg = A.alphaStallNeg * DEG;

    this.CL0eff = A.CL0 + dCL;
    let CL = liftCoefficient(alpha, A.CL0 + dCL, A.CLa, aStall, aStallNeg);
    CL += (A.spoilerCL || 0) * ctl.spoilers * clamp(CL * 2, 0, 1);
    // Ground effect
    const hb = Math.max(0, this.agl) / b;
    let geInd = 1;
    if (hb < 1) {
      const x = 16 * hb;
      geInd = Math.max(0.3, (x * x) / (1 + x * x));
      CL *= 1 + 0.08 * (1 - hb) * (1 - hb);
    }
    const AR = (b * b) / S;
    const CDi = ((CL * CL) / (Math.PI * A.e * AR)) * geInd;
    const absA = Math.abs(alpha);
    const post = alpha >= 0 ? smoothstep(aStall, aStall + 12 * DEG, absA) : smoothstep(-aStallNeg, -aStallNeg + 12 * DEG, absA);
    const sinA = Math.sin(alpha);
    const CD =
      A.CD0 + dCD + (A.gearCD || 0) * ctl.gear + (A.spoilerCD || 0) * ctl.spoilers + CDi + 1.25 * sinA * sinA * post + 0.5 * beta * beta + waveDrag(this.mach, A);
    const CY = A.CYb * beta + A.CYr * ctl.rudder;
    this.CL = CL;
    this.CD = CD;
    this.stalled = !this.wow && V > 5 && (alpha > aStall || alpha < aStallNeg);
    this.alphaStall = aStall;

    _F.set(0, 0, 0);
    _tau.set(0, 0, 0);
    if (V > 0.5) {
      const vhx = _vb.x / V,
        vhy = _vb.y / V,
        vhz = _vb.z / V;
      let ly = -vhz,
        lz = vhy;
      const ll = Math.hypot(ly, lz);
      if (ll > 1e-4) {
        ly /= ll;
        lz /= ll;
      }
      const L = qbar * S * CL;
      const D = qbar * S * CD;
      const Y = qbar * S * CY;
      _F.x += Y - D * vhx;
      _F.y += L * ly - D * vhy;
      _F.z += L * lz - D * vhz;
    }

    // Moments (aero convention: L roll right +, M pitch up +, N yaw right +)
    const Vn = Math.max(V, 20);
    const p = -this.omega.z,
      q = this.omega.x,
      r = -this.omega.y;
    const ph = (p * b) / (2 * Vn),
      qh = (q * c) / (2 * Vn),
      rh = (r * b) / (2 * Vn);
    const aC = clamp(alpha, -0.5, 0.5);
    let Cm0 = A.Cm0 + A.Cma * aC + A.Cmq * qh + A.CmFlap * (ctl.flaps / this.maxFlapDeg);
    if (alpha > aStall) Cm0 -= (spec.category === 'fighter' ? 0.05 : 0.3) * Math.min(alpha - aStall, 0.4);
    let Cl0 = A.Clb * beta + A.Clp * ph + A.Clr * rh;
    const Cn0 = A.Cnb * beta + A.Cnr * rh + A.Cnp * ph;
    // Asymmetric wing drop in a stall
    if (this.stalled && spec.category !== 'fighter') Cl0 += 0.03 * Math.sin(this.time * 1.7 + 0.5) * post;

    const qS = qbar * S;
    // Propeller slipstream over the tail for single-engine aircraft
    let qTail = qS;
    if (spec.engine.type === 'piston' && this.engines.length === 1) {
      const e = this.engines[0];
      const disk = Math.PI * (spec.engine.propDiameter / 2) ** 2;
      qTail = qS + 0.35 * Math.max(0, e.thrust) * (S / disk);
    }
    const effL = qS * b * A.Cla;
    const effM = qTail * c * A.Cme;
    const effN = qTail * b * A.Cnr_rud;
    this.ctrlEff.set(effL, effM, effN);
    const M0 = qS * c * Cm0 + qTail * c * A.Cmtrim * ctl.trim;
    const L0 = qS * b * Cl0 + qS * b * A.Clr_rud * ctl.rudder;
    const N0 = qS * b * Cn0 + qS * b * A.Cna * ctl.aileron;
    this.moment0.set(L0, M0, N0);
    const Lm = L0 + effL * ctl.aileron;
    const Mm = M0 + effM * ctl.elevator;
    const Nm = N0 + effN * ctl.rudder;
    _tau.x += Mm;
    _tau.y -= Nm;
    _tau.z -= Lm;
    // Turbulence moments
    _tau.addScaledVector(this.env.turbMoment, qS * c);

    // Engines
    const hasFuel = this.infiniteFuel || this.fuel > 0.01;
    let fuelFlow = 0;
    for (const e of this.engines) {
      e.update(dt, atm, this.mach, hasFuel, this.wow, V);
      fuelFlow += e.fuelFlow;
      const T = e.thrust;
      const pos = e.spec.pos;
      _F.z -= T;
      _tau.x += -pos[1] * T;
      _tau.y += pos[0] * T;
      if (e.torque) {
        // Torque reaction and P-factor (single engine props)
        if (this.engines.length === 1) {
          _tau.z += e.torque * 0.25;
          _tau.y += Math.max(0, T) * spec.engine.propDiameter * 0.05 * clamp(alpha, -0.3, 0.4);
        }
      }
    }
    this.totalFuelFlow = fuelFlow;
    if (!this.infiniteFuel) this.fuel = Math.max(0, this.fuel - (fuelFlow + this.fuelLeakRate) * dt);

    // Body force to world
    _Fw.copy(_F).applyQuaternion(this.quaternion);

    // Ground contacts
    const prevWow = this.wow;
    this.wow = false;
    _wWorld.copy(this.omega).applyQuaternion(this.quaternion);
    const gearUsable = !spec.gear.retractable || ctl.gear > 0.98;
    let steerFade = 1;
    const gs = Math.hypot(this.velocity.x, this.velocity.z);
    steerFade = 1 - smoothstep(4, 28, gs) * 0.88;
    const maxSteer = (spec.gear.maxSteer || (spec.category === 'private' ? 35 : 60)) * DEG;

    for (const g of this.gear) {
      g.contact = false;
      g.load = 0;
      if (!gearUsable || g.broken) {
        g.compression = 0;
        continue;
      }
      _r.copy(g.body).applyQuaternion(this.quaternion);
      _p.copy(this.position).add(_r);
      const gnd = this.groundFn(_p.x, _p.z, _p.y);
      _n.set(gnd.nx, gnd.ny, gnd.nz);
      const depth = (gnd.h - _p.y) * gnd.ny;
      g.steerAngle = g.steer ? ctl.steer * maxSteer * steerFade : 0;
      if (depth <= 0) {
        g.compression = 0;
        continue;
      }
      if (gnd.water) {
        this.crash('Ditched in water');
        return;
      }
      g.contact = true;
      this.wow = true;
      _vp.crossVectors(_wWorld, _r).add(this.velocity);
      const vn = _vp.dot(_n);
      const comp = Math.min(depth, g.travel);
      let Fn = g.k * comp - g.c * vn;
      if (depth > g.travel) {
        Fn += g.k * 25 * (depth - g.travel);
        if (vn < -4.5 && this.crashEnabled) {
          g.broken = true;
          this.crash('Landing gear collapsed (hard landing)');
          return;
        }
      }
      Fn = Math.max(0, Fn);
      g.compression = comp;
      g.load = Fn;
      // Wheel axes
      const sa = Math.sin(g.steerAngle),
        ca = Math.cos(g.steerAngle);
      _fwd.set(sa, 0, -ca).applyQuaternion(this.quaternion);
      _fwd.addScaledVector(_n, -_fwd.dot(_n)).normalize();
      _lat.crossVectors(_fwd, _n);
      const vf = _vp.dot(_fwd);
      const vl = _vp.dot(_lat);
      const surf = SURFACE[gnd.surface] || SURFACE.asphalt;
      let brake = 0;
      if (g.brake) brake = g.body.x < 0 ? ctl.brakeL : ctl.brakeR;
      const mu = surf.roll + brake * surf.brake;
      const Ff = -mu * Fn * clamp(vf / 0.4, -1, 1);
      const Fl = -surf.side * Fn * clamp(vl / 0.3, -1, 1);
      _gf.copy(_n).multiplyScalar(Fn).addScaledVector(_fwd, Ff).addScaledVector(_lat, Fl);
      _Fw.add(_gf);
      _tq.crossVectors(_r, _gf).applyQuaternion(_qInv);
      _tau.add(_tq);
      g.spin += (vf / 0.5) * dt;
    }

    // Structural contacts (crash / scrape detection)
    for (const ct of this.contacts) {
      _r.copy(ct.body).applyQuaternion(this.quaternion);
      _p.copy(this.position).add(_r);
      const gnd = this.groundFn(_p.x, _p.z, _p.y);
      const depth = (gnd.h - _p.y) * gnd.ny;
      if (depth <= 0) {
        ct.contact = false;
        continue;
      }
      _n.set(gnd.nx, gnd.ny, gnd.nz);
      _vp.crossVectors(_wWorld, _r).add(this.velocity);
      const vn = _vp.dot(_n);
      if (!ct.contact) {
        ct.contact = true;
        const impact = -vn;
        if (gnd.water && (ct.type !== 'tail' || impact > 1.5 || gs > 60)) {
          this.crash('Ditched in water');
          return;
        }
        if (ct.type === 'tail') {
          if (impact > 3.5) {
            this.crash('Tail strike — fuselage destroyed');
            return;
          }
          this.emit('tailstrike', { impact });
          this.damage = Math.min(1, this.damage + 0.2);
        } else if (ct.type === 'belly') {
          if (impact > 4 || (gearUsable && gs > 15)) {
            this.crash('Belly impact');
            return;
          }
          this.emit('bellyLanding', { impact });
          this.damage = Math.min(1, this.damage + 0.6);
        } else if (impact > 2 || gs > 22) {
          const reason =
            ct.type === 'wingtip' ? 'Wingtip struck the ground' : ct.type === 'engine' ? 'Engine pod struck the ground' : 'Nose impact with terrain';
          this.crash(reason);
          return;
        } else {
          this.emit('scrape', { part: ct.name });
          this.damage = Math.min(1, this.damage + 0.1);
        }
      }
      if (depth > 3 && gs > 10) {
        this.crash('Collision with terrain');
        return;
      }
      const k = (this.mass * G0) / 0.08;
      let Fn = k * Math.min(depth, 1.5) - 2 * Math.sqrt(k * this.mass) * 0.5 * vn;
      Fn = Math.max(0, Fn);
      const vtan = _tmp.copy(_vp).addScaledVector(_n, -vn);
      const vt = vtan.length();
      _gf.copy(_n).multiplyScalar(Fn);
      if (vt > 1e-3) _gf.addScaledVector(vtan, (-0.45 * Fn * clamp(vt / 0.5, 0, 1)) / vt);
      _Fw.add(_gf);
      _tq.crossVectors(_r, _gf).applyQuaternion(_qInv);
      _tau.add(_tq);
      this.wow = true;
    }

    // Gravity
    _Fw.y -= mass * G0;

    // Linear integration
    const invM = 1 / mass;
    this.accel.copy(_Fw).multiplyScalar(invM);
    this.velocity.addScaledVector(this.accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // Angular integration (Euler's equations)
    const I = this.inertia;
    const w = this.omega;
    const gx = w.y * (I.z * w.z) - w.z * (I.y * w.y);
    const gy = w.z * (I.x * w.x) - w.x * (I.z * w.z);
    const gz = w.x * (I.y * w.y) - w.y * (I.x * w.x);
    w.x += ((_tau.x - gx) / I.x) * dt;
    w.y += ((_tau.y - gy) / I.y) * dt;
    w.z += ((_tau.z - gz) / I.z) * dt;
    // Small structural damping for numerical robustness at very low airspeeds
    if (V < 15) w.multiplyScalar(1 - 0.4 * dt);

    const qq = this.quaternion;
    const qx = qq.x,
      qy = qq.y,
      qz = qq.z,
      qw = qq.w;
    const hdt = 0.5 * dt;
    qq.x += hdt * (qw * w.x + qy * w.z - qz * w.y);
    qq.y += hdt * (qw * w.y + qz * w.x - qx * w.z);
    qq.z += hdt * (qw * w.z + qx * w.y - qy * w.x);
    qq.w += hdt * (-qx * w.x - qy * w.y - qz * w.z);
    qq.normalize();

    // Load factor
    _spec.copy(this.accel);
    _spec.y += G0;
    _spec.applyQuaternion(_qInv.copy(qq).invert());
    this.specificForce.copy(_spec);
    this.nz = _spec.y / G0;
    this.ny = _spec.x / G0;
    const fcs = spec.fcs;
    if (!this.wow && (this.nz > fcs.nzMax * 1.55 || this.nz < fcs.nzMin * 1.6)) {
      this.overstressTime += dt;
      if (this.overstressTime > 0.25) {
        this.crash('Structural failure — airframe overstressed');
        return;
      }
    } else this.overstressTime = Math.max(0, this.overstressTime - dt);

    // Air/ground transitions
    if (this.wow) {
      this.groundTime += dt;
      if (!prevWow && this.airborneTime > 1.0) {
        const vs = this.velocity.y;
        this.lastTouchdown = { vs, ias: this.ias, time: this.time };
        this.emit('touchdown', { vs, ias: this.ias, gs });
        if (vs < -3.05) this.emit('hardLanding', { vs });
      }
      this.airborneTime = 0;
    } else {
      this.airborneTime += dt;
      if (prevWow && this.groundTime > 1.0) this.emit('liftoff', { ias: this.ias });
      this.groundTime = 0;
    }
  }

  // Angle of attack needed for 1g (times nz) flight at the current speed and configuration.
  trimAlpha(nz = 1) {
    const qS = Math.max(50, this.qbar) * this.spec.wing.area;
    const hb = Math.max(0, this.agl) / this.spec.wing.span;
    const ge = hb < 1 ? 1 + 0.08 * (1 - hb) * (1 - hb) : 1;
    const clReq = (nz * this.mass * G0) / qS / ge;
    const a = (clReq - (this.CL0eff ?? this.spec.aero.CL0)) / this.spec.aero.CLa;
    return clamp(a, -0.1, (this.alphaStall || 0.25) - 0.02);
  }

  // --- Convenience read-outs ----------------------------------------------
  getAttitude(out = {}) {
    const q = this.quaternion;
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _lat.set(1, 0, 0).applyQuaternion(q);
    _n.set(0, 1, 0).applyQuaternion(q);
    out.pitch = Math.asin(clamp(_fwd.y, -1, 1));
    let hdg = Math.atan2(_fwd.x, -_fwd.z);
    if (hdg < 0) hdg += Math.PI * 2;
    out.heading = hdg;
    out.bank = Math.atan2(-_lat.y, _n.y);
    return out;
  }

  get verticalSpeed() {
    return this.velocity.y;
  }

  get groundSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get track() {
    let t = Math.atan2(this.velocity.x, -this.velocity.z);
    if (t < 0) t += Math.PI * 2;
    return t;
  }

  // Place the aircraft resting on its gear at a ground position with a heading (radians).
  placeOnGround(x, z, heading, groundH) {
    const spec = this.spec;
    const gearY = this.gearBottomY;
    const nose = this.gear.find((g) => g.name === 'nose');
    const main = this.gear.find((g) => g.name !== 'nose');
    // Small pitch so that all wheels touch (gear points are at equal heights by design)
    let pitch = 0;
    if (nose && main) pitch = Math.atan2(main.body.y - nose.body.y, main.body.z - nose.body.z);
    this.setAttitude(heading, pitch, 0);
    const staticComp = (spec.gear.travel || 0.3) * 0.35;
    this.position.set(x, groundH - gearY - staticComp, z);
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.controls.gear = 1;
    this.wow = true;
    this.groundTime = 5;
    this.airborneTime = 0;
  }

  setAttitude(heading, pitch, bank) {
    // heading: 0 = north (-Z), clockwise positive. Rotation order: yaw, pitch, roll.
    const qy = _qa.setFromAxisAngle(_ay, -heading);
    const qp = _qb.setFromAxisAngle(_ax, pitch);
    const qr = _qc.setFromAxisAngle(_az, -bank);
    this.quaternion.copy(qy).multiply(qp).multiply(qr);
  }

  placeInAir(x, y, z, heading, tas, pitch = 0) {
    this.position.set(x, y, z);
    this.setAttitude(heading, pitch, 0);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    this.velocity.copy(fwd).multiplyScalar(tas);
    this.omega.set(0, 0, 0);
    this.wow = false;
    this.airborneTime = 10;
    this.groundTime = 0;
  }
}

const _qa = new Quaternion();
const _qb = new Quaternion();
const _qc = new Quaternion();
const _ax = new Vector3(1, 0, 0);
const _ay = new Vector3(0, 1, 0);
const _az = new Vector3(0, 0, 1);
