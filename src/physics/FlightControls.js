// Flight control computer.
// Converts pilot inputs (or autopilot attitude targets) into control surface
// commands. Supports direct law, airliner fly-by-wire (rate command / attitude
// hold with envelope protection) and fighter fly-by-wire. Inner loops use
// nonlinear dynamic inversion of the aerodynamic model, which gives consistent
// handling across all aircraft and speeds.

import { G0, DEG, KT } from './atmosphere.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function moveToward(cur, target, maxStep) {
  if (target > cur) return Math.min(target, cur + maxStep);
  return Math.max(target, cur - maxStep);
}
function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const _att = {};

export class FlightControlSystem {
  constructor(fm) {
    this.fm = fm;
    this.spec = fm.spec;
    this.assist = 'intermediate'; // beginner | intermediate | realistic
    this.elevator = 0;
    this.aileron = 0;
    this.rudder = 0;
    this.steer = 0;
    this.thetaHold = 0;
    this.phiHold = 0;
    this.pitchNeutralT = 0;
    this.rollNeutralT = 0;
    this.iPitch = 0;
    this.iRoll = 0;
    this.airBlend = 0;
    this.activeLaw = 'direct';
    this.protection = '';
  }

  get law() {
    const base = this.spec.fcs.law;
    if (this.assist === 'beginner' && base === 'direct') return 'fbw';
    return base;
  }

  reset() {
    this.elevator = this.aileron = this.rudder = this.steer = 0;
    this.iPitch = this.iRoll = 0;
    this.pitchNeutralT = this.rollNeutralT = 0;
    const att = this.fm.getAttitude(_att);
    this.thetaHold = att.pitch;
    this.phiHold = 0;
    this.airBlend = this.fm.wow ? 0 : 1;
  }

  // input: { pitch, roll, yaw, tiller } in -1..1 (+pitch = nose up, +roll = right, +yaw = nose right)
  // ap: null or { pitch, bank, pitchRate? } (radians)
  update(dt, input, ap) {
    const fm = this.fm;
    const fcs = this.spec.fcs;
    const att = fm.getAttitude(_att);
    const theta = att.pitch;
    const phi = att.bank;
    const V = Math.max(fm.tas, 25);
    const p = -fm.omega.z;
    const q = fm.omega.x;
    const r = -fm.omega.y;
    const I = fm.inertia;
    const eff = fm.ctrlEff;
    const m0 = fm.moment0;
    const airborne = !fm.wow;

    this.airBlend = airborne ? Math.min(1, this.airBlend + dt / 1.5) : Math.max(0, this.airBlend - dt * 3);
    const law = ap ? 'attitude' : this.law;
    this.activeLaw = law;
    this.protection = '';
    const isFighter = this.spec.fcs.law === 'fighter';

    let eCmd = input.pitch;
    let aCmd = input.roll;
    let rCmd = input.yaw;
    const maxQ = fcs.maxPitchRate * DEG;
    const maxP = fcs.maxRollRate * DEG;

    const coordinatedYawRate = (G0 / V) * Math.sin(phi) * Math.cos(theta);
    let qTurn = 0;
    if (Math.abs(phi) < 75 * DEG) qTurn = clamp((G0 / V) * Math.sin(phi) * Math.tan(phi), -maxQ, maxQ);

    if (law !== 'direct' && this.airBlend > 0) {
      // ------------------------------------------------------------ pitch
      let qCmd;
      if (law === 'attitude') {
        if (ap.pitchRate !== undefined) qCmd = ap.pitchRate + qTurn;
        else qCmd = clamp(0.9 * (ap.pitch - theta), -maxQ * 0.45, maxQ * 0.45) + qTurn;
        this.thetaHold = theta;
      } else {
        const s = input.pitch;
        if (Math.abs(s) > 0.03) {
          this.pitchNeutralT = 0;
          this.thetaHold = theta;
          qCmd = s * maxQ + qTurn * (1 - Math.abs(s));
        } else {
          this.pitchNeutralT += dt;
          if (this.pitchNeutralT < 0.35) this.thetaHold = theta;
          const hold = Math.abs(phi) < 55 * DEG ? 0.8 * (this.thetaHold - theta) : 0;
          qCmd = qTurn + clamp(hold, -maxQ * 0.3, maxQ * 0.3);
        }
      }
      // Envelope protections
      const alphaProt = isFighter ? (fcs.alphaLimit || 25) * DEG : fm.alphaStall - 2.5 * DEG;
      if (fm.alpha > alphaProt - 3 * DEG) {
        const lim = (alphaProt - fm.alpha) * 2.5;
        if (qCmd > lim) {
          qCmd = lim;
          this.protection = 'ALPHA';
        }
      }
      const cc = Math.cos(theta) * Math.cos(phi);
      const qMax = ((fcs.nzMax - cc) * G0) / V;
      const qMin = ((fcs.nzMin - cc) * G0) / V;
      if (qCmd > qMax) {
        qCmd = qMax;
        this.protection = 'G LIMIT';
      }
      if (qCmd < qMin) qCmd = qMin;
      if (!isFighter) {
        if (theta > 30 * DEG) qCmd = Math.min(qCmd, (30 * DEG - theta) * 1.5);
        if (theta < -15 * DEG) qCmd = Math.max(qCmd, (-15 * DEG - theta) * 1.5);
        const vmo = (this.spec.speeds.vmo || this.spec.speeds.vne || 999) * KT;
        if (fm.ias > vmo + 4 * KT) {
          qCmd = Math.max(qCmd, (fm.ias - vmo) * 0.004);
          this.protection = 'OVERSPEED';
        }
      }
      const qdot = 4.5 * (qCmd - q);
      let e = eff.y > 1 ? (I.x * qdot - m0.y) / eff.y : input.pitch;
      e += this.iPitch;
      if (Math.abs(e) < 1) this.iPitch = clamp(this.iPitch + (qCmd - q) * dt * 3, -0.4, 0.4);
      eCmd = input.pitch * (1 - this.airBlend) + e * this.airBlend;

      // ------------------------------------------------------------ roll
      let pCmd;
      if (law === 'attitude') {
        pCmd = clamp(1.1 * wrapPi(ap.bank - phi), -maxP * 0.45, maxP * 0.45);
        this.phiHold = phi;
      } else {
        const s = input.roll;
        if (Math.abs(s) > 0.03) {
          this.rollNeutralT = 0;
          this.phiHold = phi;
          pCmd = s * maxP;
        } else {
          this.rollNeutralT += dt;
          if (this.rollNeutralT < 0.25) this.phiHold = phi;
          if (!isFighter) {
            const lim = 33 * DEG;
            if (Math.abs(this.phiHold) > lim) this.phiHold -= Math.sign(this.phiHold) * Math.min(Math.abs(this.phiHold) - lim, 5 * DEG * dt);
            if (Math.abs(this.phiHold) < 2.5 * DEG && this.rollNeutralT > 0.5) this.phiHold = 0;
          }
          pCmd = clamp(1.6 * wrapPi(this.phiHold - phi), -maxP * 0.5, maxP * 0.5);
        }
      }
      if (!isFighter) {
        const bl = fcs.bankLimit * DEG;
        if (Math.abs(phi) > bl) {
          pCmd = (Math.sign(phi) * bl - phi) * 2;
          this.protection = this.protection || 'BANK';
        }
      }
      const pdot = (isFighter ? 9 : 5.5) * (pCmd - p);
      let a = eff.x > 1 ? (I.z * pdot - m0.x) / eff.x : input.roll;
      a += this.iRoll;
      if (Math.abs(a) < 1) this.iRoll = clamp(this.iRoll + (pCmd - p) * dt * 1.5, -0.3, 0.3);
      aCmd = input.roll * (1 - this.airBlend) + a * this.airBlend;

      // ------------------------------------------------------------ yaw (turn coordination)
      const rWanted = coordinatedYawRate + input.yaw * 6 * DEG;
      const rdot = 2.5 * (rWanted - r) + 3.0 * fm.beta * (law === 'attitude' || this.assist !== 'realistic' ? 1 : 0.6);
      let rr = eff.z > 1 ? (I.y * rdot - m0.z) / eff.z : input.yaw;
      rr = clamp(rr, -1, 1);
      rCmd = input.yaw * (1 - this.airBlend) + rr * this.airBlend;
    } else if (airborne) {
      // Direct law: optional auto-rudder / yaw damper and auto-trim
      const autoRudder = this.assist !== 'realistic';
      if (autoRudder && eff.z > 1) {
        const rdot = 2.0 * (coordinatedYawRate - r) + 3.0 * fm.beta;
        const yd = clamp((I.y * rdot - m0.z) / eff.z, -0.6, 0.6);
        rCmd = clamp(input.yaw + yd * this.airBlend, -1, 1);
      } else if (fcs.yawDamper && eff.z > 1) {
        // Yaw damper: damp yaw rate deviations only (does not remove pilot sideslip)
        const yd = clamp((I.y * 1.5 * (coordinatedYawRate - r)) / eff.z, -0.3, 0.3);
        rCmd = clamp(input.yaw + yd * this.airBlend, -1, 1);
      }
      if (this.assist !== 'realistic' && eff.y > 1) {
        // Auto-trim: when the stick is neutral, run trim to hold pitch attitude
        if (Math.abs(input.pitch) < 0.03) {
          this.pitchNeutralT += dt;
          if (this.pitchNeutralT < 0.5) this.thetaHold = theta;
          const qWant = clamp(0.5 * (this.thetaHold - theta), -0.05, 0.05) + qTurn;
          const eHold = (I.x * 3 * (qWant - q) - m0.y) / eff.y;
          const cmtrim = this.spec.aero.Cmtrim / this.spec.aero.Cme;
          fm.controls.trim = clamp(fm.controls.trim + clamp(eHold / cmtrim, -1, 1) * 0.6 * dt, -1, 1);
        } else {
          this.pitchNeutralT = 0;
          this.thetaHold = theta;
        }
      }
    }

    // Nose wheel steering from pedals + tiller
    this.steer = clamp(input.yaw + (input.tiller || 0), -1, 1);

    // Actuators (rate limited)
    const rate = isFighter ? 8 : 4;
    this.elevator = moveToward(this.elevator, clamp(eCmd, -1, 1), rate * dt);
    this.aileron = moveToward(this.aileron, clamp(aCmd, -1, 1), rate * dt);
    this.rudder = moveToward(this.rudder, clamp(rCmd, -1, 1), rate * 0.75 * dt);
    const c = fm.controls;
    c.elevator = this.elevator;
    c.aileron = this.aileron;
    c.rudder = this.rudder;
    c.steer = this.steer;
  }
}
