// Engine models: turbofan/turbojet (with afterburner and reversers), piston and turboprop.

function approach(cur, target, dt, tau) {
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
}

class BaseEngine {
  constructor(spec, index) {
    this.spec = spec;
    this.index = index;
    this.running = false;
    this.starting = false;
    this.starter = false;
    this.fuelCutoff = false; // engine master / fuel control switch OFF
    this.failed = false;
    this.fire = false;
    this.extinguished = false;
    this.throttle = 0;
    this.reverseCmd = false;
    this.reverse = 0; // deployed fraction
    this.thrust = 0;
    this.fuelFlow = 0; // kg/s
    this.egt = 15; // deg C
    this.oilPressure = 0;
    this.afterburner = 0;
  }

  // Instantly put the engine into a running or stopped state (spawning).
  setRunning(on) {
    this.running = on;
    this.starting = false;
    this.starter = false;
    this.fuelCutoff = !on;
  }

  get statusText() {
    if (this.fire) return 'FIRE';
    if (this.failed) return 'FAIL';
    if (this.starting) return 'START';
    if (this.running) return this.reverse > 0.5 ? 'REV' : 'RUN';
    return 'OFF';
  }

  updateReverser(dt, onGround) {
    const want = this.reverseCmd && onGround ? 1 : 0;
    const rate = dt / 2.0;
    if (this.reverse < want) this.reverse = Math.min(want, this.reverse + rate);
    else if (this.reverse > want) this.reverse = Math.max(want, this.reverse - rate);
  }
}

export class JetEngine extends BaseEngine {
  constructor(spec, index) {
    super(spec, index);
    this.n1 = 0;
    this.n2 = 0;
  }

  setRunning(on) {
    super.setRunning(on);
    this.n1 = on ? this.spec.idleN1 : 0;
    this.n2 = on ? 0.6 : 0;
    this.egt = on ? 420 : 15;
  }

  get rpmFraction() {
    return this.n1;
  }

  update(dt, atm, mach, hasFuel, onGround) {
    const s = this.spec;
    const idle = s.idleN1;
    this.updateReverser(dt, onGround);
    const canRun = hasFuel && !this.fuelCutoff && !this.failed && !this.fire;

    // Start sequence: starter spins the core, light-off near 70% of idle N1.
    if (!this.running && this.starter && !this.failed) {
      this.starting = true;
      const rate = idle / (s.startTime || 20);
      this.n1 = Math.min(idle, this.n1 + rate * dt);
      if (canRun && this.n1 >= idle * 0.97) {
        this.running = true;
        this.starting = false;
        this.starter = false;
      }
    } else if (!this.starter) {
      this.starting = false;
    }

    if (this.running && !canRun) {
      this.running = false; // flame-out or shutdown
    }

    let target;
    if (this.running) {
      const thr = Math.min(1, this.throttle);
      target = idle + (1.0 - idle) * thr;
    } else if (this.starting) {
      target = this.n1;
    } else {
      target = Math.min(0.12, Math.max(0, mach) * 0.22); // windmilling
    }
    let tau = s.spoolUp * (this.n1 < 0.55 ? 1.7 : 1.0);
    if (target < this.n1) tau *= 0.75;
    if (!this.running && !this.starting) tau = 6;
    this.n1 = approach(this.n1, target, dt, tau);
    this.n2 = approach(this.n2, this.running ? 0.6 + this.n1 * 0.42 : this.n1 * 0.9, dt, tau * 0.8);

    // Afterburner
    const wantAb = this.running && s.abThrust && this.throttle > 0.92 && this.n1 > 0.93 && this.reverse === 0;
    this.afterburner = approach(this.afterburner, wantAb ? (this.throttle - 0.92) / 0.08 : 0, dt, 0.5);

    if (this.running) {
      const x = Math.max(0, Math.min(1.05, (this.n1 - idle) / (1 - idle)));
      const frac = 0.04 + 0.96 * Math.pow(x, 1.6);
      const dens = Math.pow(atm.sigma, s.densityExp || 0.8);
      const machF = Math.max(0.35, Math.min(2.2, 1 + (s.machLapse || -0.3) * mach));
      let gross = s.maxThrust * frac * dens * machF;
      const ab = s.abThrust ? s.abThrust * this.afterburner * dens * machF : 0;
      const tsfc = s.tsfc * (0.62 + 0.45 * Math.min(1, mach));
      this.fuelFlow = Math.max(0.02 * s.maxThrust * 1e-5, gross * tsfc) + ab * (s.abTsfc || 5e-5);
      gross += ab;
      this.thrust = gross * (1 - 1.45 * this.reverse);
      this.egt = approach(this.egt, 380 + 520 * this.n1 + 200 * this.afterburner, dt, 2.5);
    } else {
      this.thrust = 0;
      this.fuelFlow = 0;
      this.egt = approach(this.egt, this.fire ? 900 : 15 + 300 * this.n1, dt, this.fire ? 1 : 20);
    }
    this.oilPressure = approach(this.oilPressure, this.running ? 40 + 50 * this.n2 : this.n2 * 30, dt, 1.5);
  }
}

export class PropEngine extends BaseEngine {
  constructor(spec, index) {
    super(spec, index);
    this.turbine = spec.type === 'turboprop';
    this.rpm = 0;
    this.power = 0;
    this.powerFrac = 0;
    this.mixture = 1;
    this.propAngle = Math.random() * Math.PI * 2;
    this.manifold = 0;
    this.torque = 0;
  }

  setRunning(on) {
    super.setRunning(on);
    this.rpm = on ? this.spec.idleRPM : 0;
    this.powerFrac = on ? 0.06 : 0;
    this.egt = on ? 600 : 15;
  }

  get rpmFraction() {
    return this.rpm / this.spec.maxRPM;
  }

  update(dt, atm, mach, hasFuel, onGround, tas) {
    const s = this.spec;
    this.updateReverser(dt, onGround);
    const canRun = hasFuel && !this.fuelCutoff && !this.failed && !this.fire && this.mixture > 0.05;

    if (!this.running && this.starter && !this.failed) {
      this.starting = true;
      const crank = this.turbine ? s.idleRPM : s.idleRPM * 0.45;
      this.rpm = approach(this.rpm, crank, dt, (s.startTime || 4) * 0.4);
      if (canRun && this.rpm > crank * 0.9) {
        this.running = true;
        this.starting = false;
        this.starter = false;
      }
    } else if (!this.starter) {
      this.starting = false;
    }
    if (this.running && !canRun) this.running = false;

    const dens = this.turbine
      ? Math.min(1, 1.25 * Math.pow(atm.sigma, 0.75))
      : Math.max(0, (atm.sigma - 0.12) / 0.88);
    const targetFrac = this.running ? 0.06 + 0.94 * Math.min(1, this.throttle) : 0;
    this.powerFrac = approach(this.powerFrac, targetFrac, dt, this.turbine ? s.spoolUp || 2 : 0.35);
    this.power = this.running ? s.maxPower * this.powerFrac * dens : 0;

    // RPM: constant-speed props on turboprops; fixed-pitch props on pistons.
    let rpmTarget;
    if (this.running) {
      if (this.turbine) rpmTarget = this.throttle > 0.15 || tas > 30 ? s.maxRPM : s.idleRPM + (s.maxRPM - s.idleRPM) * this.throttle * 4;
      else rpmTarget = s.idleRPM + (s.maxRPM - s.idleRPM) * Math.sqrt(this.powerFrac) * 0.86 + tas * 2.4;
    } else if (this.starting) {
      rpmTarget = this.rpm;
    } else {
      rpmTarget = Math.min(s.maxRPM * 0.6, tas * (this.turbine ? 4 : 9));
    }
    rpmTarget = Math.min(rpmTarget, s.maxRPM * 1.05);
    this.rpm = approach(this.rpm, rpmTarget, dt, this.running ? 0.6 : 2.5);

    const V = Math.max(0, tas);
    let thrust = this.running ? (s.efficiency * this.power) / Math.sqrt(V * V + s.vKnee * s.vKnee) : 0;
    // Windmilling drag of a stopped/failed propeller
    if (!this.running) thrust = -0.0006 * V * V * s.propDiameter * s.propDiameter * atm.sigma * 6;
    this.thrust = thrust * (1 - 1.5 * this.reverse);
    const omega = Math.max(1, (this.rpm * 2 * Math.PI) / 60);
    this.torque = this.power / omega;
    this.fuelFlow = this.running ? Math.max(0.0008, ((s.bsfc || 0.25) * this.power) / 3.6e6) : 0;
    this.propAngle = (this.propAngle + omega * dt) % (Math.PI * 2);
    this.manifold = this.running ? 10 + 19 * this.powerFrac * dens : 29.9 * atm.sigma;
    this.egt = approach(this.egt, this.running ? (this.turbine ? 450 + 400 * this.powerFrac : 1150 + 350 * this.powerFrac) : 15, dt, 3);
    this.oilPressure = approach(this.oilPressure, this.running ? 55 + 20 * this.rpmFraction : 0, dt, 1.0);
  }
}

export function createEngines(engineSpec) {
  return engineSpec.list.map((e, i) => {
    const s = { ...engineSpec, pos: e.pos };
    return engineSpec.type === 'jet' ? new JetEngine(s, i) : new PropEngine(s, i);
  });
}
