// Autopilot / flight director / autothrottle.
// Lateral modes: HDG, NAV (GPS flight plan), LOC (localizer), ROLLOUT.
// Vertical modes: ALT, VS, FLCH (level change, pitch-on-speed), GS (glideslope), FLARE.
// Autothrust: SPEED, THR CLB, IDLE, RETARD.

import { DEG, KT, FT, FPM, G0 } from '../physics/atmosphere.js';
import { wrap180 } from './Navigation.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function moveToward(cur, target, step) {
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

const _att = {};

export class Autopilot {
  constructor(sim) {
    this.sim = sim;
    this.fm = sim.fm;
    this.spec = sim.spec;
    this.engaged = false;
    this.athr = false;
    this.fd = true;
    this.lat = 'HDG';
    this.vert = 'ALT';
    this.latArmed = null;
    this.vertArmed = null;
    this.athrMode = 'SPEED';
    this.hdg = 0;
    this.alt = 3000; // ft
    this.vs = 0; // fpm
    this.spd = 250; // kt IAS
    this.mach = 0.78;
    this.useMach = false;
    this.pitchCmd = 0;
    this.bankCmd = 0;
    this.vsIntegral = 0;
    this.thrIntegral = 0;
    this.lastIas = 0;
    this.iasTrend = 0;
    this.output = null;
    this.steer = 0;
    this.disconnectReason = '';
    this.events = [];
    const cat = this.spec.category;
    this.maxBank = cat === 'fighter' ? 45 : cat === 'private' && this.spec.id === 'k172' ? 20 : 25;
    this.pitchLimits = cat === 'fighter' ? [-30, 40] : [-12, 22];
  }

  get canAutoland() {
    return !!this.spec.autopilot.autoland;
  }

  syncTargets() {
    const fm = this.fm;
    const att = fm.getAttitude(_att);
    this.hdg = Math.round(att.heading / DEG);
    this.alt = Math.round(fm.position.y / FT / 100) * 100;
    this.spd = Math.round(fm.ias / KT);
    this.vs = Math.round(fm.velocity.y / FPM / 100) * 100;
  }

  engage() {
    const fm = this.fm;
    if (fm.wow || fm.crashed) return false;
    if (!this.engaged) {
      const att = fm.getAttitude(_att);
      this.pitchCmd = att.pitch;
      this.bankCmd = att.bank;
      this.vsIntegral = 0;
      if (!this.lat || this.lat === 'ROLLOUT') this.lat = 'HDG';
      if (!this.vert || this.vert === 'FLARE' || this.vert === 'ROLLOUT') {
        this.vert = 'VS';
        this.vs = Math.round(fm.velocity.y / FPM / 100) * 100;
      }
      if (this.vert === 'ALT' && Math.abs(this.alt * FT - fm.position.y) > 60) {
        this.vert = 'VS';
        this.vs = Math.round(fm.velocity.y / FPM / 100) * 100;
        if (Math.abs(this.vs) < 200) {
          this.vert = 'ALT';
          this.alt = Math.round(fm.position.y / FT / 100) * 100;
        }
      }
    }
    this.engaged = true;
    this.events.push('engage');
    return true;
  }

  disengage(reason = '') {
    if (this.engaged) {
      this.engaged = false;
      this.disconnectReason = reason;
      this.events.push('disconnect');
    }
    if (this.vert === 'FLARE' || this.vert === 'ROLLOUT') this.vert = 'VS';
    if (this.lat === 'ROLLOUT') this.lat = 'HDG';
  }

  toggle() {
    if (this.engaged) this.disengage('manual');
    else this.engage();
  }

  setAthr(on) {
    if (!this.spec.autopilot.athr) return;
    if (on && !this.athr) {
      this.athrMode = 'SPEED';
      this.thrIntegral = 0;
      // Never chase a target below the stall speed (e.g. an unset or stale selection)
      if (!this.spd || this.spd < this.spec.speeds.vs) this.spd = Math.max(this.spec.speeds.vs + 20, Math.round(this.fm.ias / KT));
    }
    if (!on && this.athr) this.events.push('athrOff');
    this.athr = on;
  }

  // ---- Mode selection -------------------------------------------------------
  modeHDG() {
    this.lat = 'HDG';
    this.latArmed = null;
  }
  modeNAV() {
    if (this.sim.nav.plan.length > 0) {
      this.lat = 'NAV';
      this.latArmed = null;
    }
  }
  modeAPP() {
    const nav = this.sim.nav;
    if (!nav.approach) return false;
    this.latArmed = 'LOC';
    this.vertArmed = 'GS';
    if (this.lat !== 'NAV' && this.lat !== 'HDG') this.lat = 'HDG';
    return true;
  }
  modeALT() {
    this.vert = 'ALT';
    this.alt = Math.round(this.fm.position.y / FT / 100) * 100;
  }
  modeVS(vs = null) {
    this.vert = 'VS';
    this.vs = vs !== null ? vs : Math.round(this.fm.velocity.y / FPM / 100) * 100;
    this.vsIntegral = 0;
  }
  modeFLCH() {
    const diff = this.alt * FT - this.fm.position.y;
    if (Math.abs(diff) < 30) return this.modeALT();
    this.vert = 'FLCH';
    this.flchClimb = diff > 0;
    const att = this.fm.getAttitude(_att);
    this.pitchCmd = att.pitch;
  }

  // ---- Main update ------------------------------------------------------------
  update(dt) {
    const fm = this.fm;
    const sim = this.sim;
    const nav = sim.nav;
    const att = fm.getAttitude(_att);
    const V = Math.max(fm.tas, 30);
    const iasKt = fm.ias / KT;
    this.iasTrend = this.iasTrend * 0.9 + ((iasKt - this.lastIas) / Math.max(dt, 1e-3)) * 0.1;
    this.lastIas = iasKt;
    this.steer = 0;

    if (this.engaged && (fm.crashed || (fm.wow && this.vert !== 'ROLLOUT' && this.vert !== 'FLARE'))) {
      this.disengage(fm.crashed ? 'crash' : 'ground');
    }
    if (this.engaged && fm.stalled) this.disengage('stall');

    // ------------------------------------------------------------------ lateral
    const trackDeg = fm.groundSpeed > 15 ? fm.track / DEG : att.heading / DEG;
    let bankTarget = 0;
    const ils = nav.ils;

    if (this.latArmed === 'LOC' && ils.valid) {
      const intercepting = Math.abs(ils.locDev) < 2.0 && Math.abs(wrap180(trackDeg - ils.course)) < 80;
      if (intercepting) {
        this.lat = 'LOC';
        this.latArmed = null;
        this.events.push('locCapture');
      }
    }
    if (this.vertArmed === 'GS' && ils.gsValid && this.lat === 'LOC') {
      if (ils.gsDev < 0.15 && ils.gsDev > -0.6) {
        this.vert = 'GS';
        this.vertArmed = null;
        this.events.push('gsCapture');
      }
    }

    if (this.lat === 'HDG') {
      const err = wrap180(this.hdg - att.heading / DEG);
      bankTarget = clamp(err * 2.0, -this.maxBank, this.maxBank);
    } else if (this.lat === 'NAV') {
      const g = nav.guidance;
      if (g.valid) {
        const intercept = clamp(-g.xte * 0.012, -40, 40);
        const desired = g.desiredTrack + intercept;
        const err = wrap180(desired - trackDeg);
        bankTarget = clamp(err * 2.2, -this.maxBank, this.maxBank);
      } else {
        this.lat = 'HDG';
        this.hdg = Math.round(att.heading / DEG);
      }
    } else if (this.lat === 'LOC' || this.lat === 'ROLLOUT') {
      if (!ils.end) {
        this.lat = 'HDG';
      } else {
        const latVel = fm.velocity.x * -ils.end.dirZ + fm.velocity.z * ils.end.dirX;
        if (this.lat === 'LOC') {
          const k = ils.dist < 5000 ? 0.06 : 0.04;
          const intercept = clamp(-ils.lateral * k - latVel * 0.8, -30, 30);
          const err = wrap180(ils.course + intercept - trackDeg);
          bankTarget = clamp(err * 2.0, -this.maxBank, this.maxBank);
          if (fm.agl < 30 * FT) bankTarget = clamp(bankTarget, -3, 3);
        } else {
          // Rollout: steer to centreline with nose wheel / rudder
          const hdgErr = wrap180(ils.course - att.heading / DEG);
          this.steer = clamp(-ils.lateral * 0.08 - latVel * 0.25 + hdgErr * 0.05, -0.6, 0.6);
          bankTarget = 0;
        }
      }
    }
    this.bankCmd = moveToward(this.bankCmd, bankTarget * DEG, (this.spec.category === 'fighter' ? 15 : 4) * DEG * dt);

    // ------------------------------------------------------------------ vertical
    const altFt = fm.position.y / FT;
    let vsCmd = null; // m/s
    const aglFt = fm.agl / FT;

    if (this.vert === 'GS' && this.engaged && aglFt < 60 && aglFt > 1) {
      if (this.canAutoland) {
        this.vert = 'FLARE';
        this.events.push('flare');
      }
    }
    // Without autoland capability the autopilot disconnects at minimums
    if (this.engaged && !this.canAutoland && (this.vert === 'GS' || this.lat === 'LOC') && aglFt < 180 && fm.velocity.y < 0) {
      this.disengage('minimums');
      this.setAthr(false);
    }

    if (this.vert === 'VS' || this.vert === 'FLCH') {
      const diffFt = this.alt - altFt;
      const vsFpm = fm.velocity.y / FPM;
      const captureBand = Math.max(150, Math.abs(vsFpm) * 0.12);
      const towards = (diffFt > 0 && vsFpm > 0) || (diffFt < 0 && vsFpm < 0);
      if (Math.abs(diffFt) < captureBand && (towards || Math.abs(diffFt) < 60)) {
        this.vert = 'ALT';
        this.events.push('altCapture');
      }
    }

    if (this.vert !== this._prevVert) {
      this.vsIntegral = 0;
      this._prevVert = this.vert;
    }
    if (this.vert === 'ALT') {
      const err = this.alt * FT - fm.position.y;
      const mag = Math.min(Math.abs(err) * 0.1, Math.sqrt(2 * 0.7 * Math.abs(err)));
      vsCmd = clamp(Math.sign(err) * mag, -2500 * FPM, 2500 * FPM);
    } else if (this.vert === 'VS') {
      vsCmd = this.vs * FPM;
    } else if (this.vert === 'GS') {
      const gsAngle = 3 * DEG;
      vsCmd = -fm.groundSpeed * Math.tan(gsAngle) + clamp((ils.gsAlt - fm.position.y) * 0.18, -4, 4);
      if (!ils.gsValid && ils.along > -200) vsCmd = -fm.groundSpeed * Math.tan(gsAngle);
    } else if (this.vert === 'FLARE') {
      // Exponential flare (tau 3 s) blended from the glide path descent rate
      vsCmd = Math.max(-fm.groundSpeed * Math.tan(3 * DEG), -(Math.max(0, fm.agl) / 3.5 + 0.4));
      if (fm.wow) {
        this.vert = 'ROLLOUT';
        this.lat = 'ROLLOUT';
        this.events.push('rollout');
      }
    }

    if (this.vert === 'ROLLOUT') {
      // Lower the nose and track the centreline until slow
      this.pitchCmd = moveToward(this.pitchCmd, -1 * DEG, 1.5 * DEG * dt);
      this.output = { pitchRate: -1.5 * DEG, pitch: this.pitchCmd, bank: 0 };
      if (iasKt < 40) {
        this.disengage('rollout complete');
        this.setAthr(false);
        sim.throttleLever = 0;
      }
    } else if (this.vert === 'FLCH') {
      // Pitch on speed
      const target = this.flchClimb ? 1 : -1;
      const spdErr = iasKt - this.spd;
      this.pitchCmd += clamp(spdErr * 0.05 + this.iasTrend * 0.3, -1.5, 1.5) * DEG * dt;
      const vsNow = fm.velocity.y / FPM;
      if (target > 0 && vsNow < 300) this.pitchCmd += 1.0 * DEG * dt;
      if (target < 0 && vsNow > -300) this.pitchCmd -= 1.0 * DEG * dt;
      if (Math.abs(vsNow) > 6000) this.pitchCmd -= Math.sign(vsNow) * 1.5 * DEG * dt;
      const lim = this.spec.category === 'fighter' ? this.pitchLimits : [-10, 16];
      this.pitchCmd = clamp(this.pitchCmd, lim[0] * DEG, lim[1] * DEG);
      this.vsIntegral = 0;
    } else if (vsCmd !== null) {
      const vsErr = vsCmd - fm.velocity.y;
      this.vsIntegral = clamp(this.vsIntegral + (vsErr / V) * dt * 0.5, -3 * DEG, 3 * DEG);
      const gamma = Math.asin(clamp(vsCmd / V, -0.35, 0.35));
      const pGain = this.vert === 'FLARE' ? 1.2 : 0.6;
      const target = gamma + fm.trimAlpha(Math.cos(gamma)) + this.vsIntegral + clamp((vsErr / V) * pGain, -0.05, 0.05);
      const rate = (this.spec.category === 'fighter' ? 8 : this.vert === 'FLARE' ? 6 : 2.5) * DEG;
      this.pitchCmd = moveToward(this.pitchCmd, clamp(target, this.pitchLimits[0] * DEG, this.pitchLimits[1] * DEG), rate * dt);
    }

    // ------------------------------------------------------------------ autothrust
    if (this.athr && sim.engineCount > 0) {
      let thr = sim.throttleLever;
      if (this.vert === 'FLARE' && (aglFt < 30 || this.athrMode === 'RETARD')) this.athrMode = 'RETARD';
      else if (this.vert === 'ROLLOUT') this.athrMode = 'IDLE';
      else if (this.vert === 'FLCH') this.athrMode = this.flchClimb ? 'THR CLB' : 'IDLE';
      else this.athrMode = 'SPEED';

      const maxThr = this.spec.engine.abThrust ? 0.9 : 1.0;
      if (this.athrMode === 'SPEED') {
        if (this._prevAthrMode !== 'SPEED') this.thrIntegral = sim.throttleLever;
        let target = this.spd;
        if (this.useMach && fm.mach > 0.1) target = (this.mach / fm.mach) * iasKt;
        const err = clamp(target - iasKt, -25, 25);
        // Gains normalised by available acceleration per unit of throttle (kt/s)
        const k = Math.max(0.5, sim.maxThrustEstimate() / fm.mass / KT);
        this.thrIntegral = clamp(this.thrIntegral + ((err * 0.009) / k) * dt, 0, maxThr);
        thr = clamp(this.thrIntegral + (err * 0.12) / k - (clamp(this.iasTrend, -5, 5) * 0.7) / k, 0, maxThr);
      } else if (this.athrMode === 'THR CLB') thr = Math.min(0.9, maxThr);
      else thr = 0;
      sim.throttleLever = moveToward(sim.throttleLever, thr, (this.athrMode === 'RETARD' ? 0.35 : 0.2) * dt);
      this._prevAthrMode = this.athrMode;
    } else {
      this._prevAthrMode = null;
    }

    // ------------------------------------------------------------------ output
    if (this.vert !== 'ROLLOUT') this.output = { pitch: this.pitchCmd, bank: this.bankCmd };
    if (!this.engaged) {
      // Flight director follows aircraft when disengaged
      if (!this.fd) this.output = null;
      return null;
    }
    return this.output;
  }
}
