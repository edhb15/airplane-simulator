// Unified input: keyboard (rebindable), mouse (yoke mode, look, wheel),
// gamepads (standard mapping) and joysticks / HOTAS (raw axes).

const CONTINUOUS = new Set(['pitchDown', 'pitchUp', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown', 'brakes', 'trimUp', 'trimDown', 'lookBack', 'lookLeft', 'lookRight']);

function approach(cur, target, rate, dt) {
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

function applyDeadzone(v, dz) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

export class Input {
  constructor(game, element) {
    this.game = game;
    this.settings = game.settings;
    this.element = element;
    this.down = new Set();
    this.events = [];
    this.context = 'menu'; // menu | flight | text
    this.axes = { pitch: 0, roll: 0, yaw: 0, tiller: 0, brake: 0, brakeL: 0, brakeR: 0, throttleRate: 0, throttleAbs: null, trim: 0, lookX: 0, lookY: 0 };
    this.kb = { pitch: 0, roll: 0, yaw: 0 };
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, inside: false, buttons: 0, dx: 0, dy: 0, wheel: 0, overUI: false };
    this.mouseYoke = false;
    this.gamepadInfo = { connected: false, id: '', type: 'none', axes: [], buttons: [] };
    this.prevButtons = [];
    this.lastJoyThrottle = null;
    this.captureCallback = null;
    this.listeners = new Set();
    this.bindingIndex = new Map();
    this.rebuildIndex();
    this.settings.on('change', (e) => {
      if (e.section === 'controls' || e.section === '*') this.rebuildIndex();
    });
    this.attach();
  }

  rebuildIndex() {
    this.bindingIndex.clear();
    const b = this.settings.get('controls').bindings;
    for (const [action, codes] of Object.entries(b)) for (const c of codes) {
      if (!this.bindingIndex.has(c)) this.bindingIndex.set(c, []);
      this.bindingIndex.get(c).push(action);
    }
    this.mouseYoke = !!this.settings.get('controls').mouseYoke;
  }

  attach() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    const el = this.element;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.nx = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ny = (this.mouse.y / r.height) * 2 - 1;
      if (this.mouse.buttons & 2 || (this.mouse.buttons & 4) || (this.mouse.buttons & 1 && this.dragLook)) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    el.addEventListener('pointerdown', (e) => {
      this.mouse.buttons = e.buttons;
      this.dragLook = e.button === 0 && e.shiftKey;
      if (e.button === 0 && !this.dragLook) this.emit({ type: 'click', x: this.mouse.x, y: this.mouse.y, nx: this.mouse.nx, ny: this.mouse.ny });
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('pointerup', (e) => {
      this.mouse.buttons = e.buttons;
      if (e.button === 0) this.dragLook = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mouseenter', () => (this.mouse.inside = true));
    el.addEventListener('mouseleave', () => (this.mouse.inside = false));
    el.addEventListener(
      'wheel',
      (e) => {
        this.mouse.wheel += Math.sign(e.deltaY);
        this.emit({ type: 'wheel', delta: Math.sign(e.deltaY), shift: e.shiftKey });
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener('gamepadconnected', (e) => {
      this.emit({ type: 'gamepad', connected: true, id: e.gamepad.id });
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      this.emit({ type: 'gamepad', connected: false, id: e.gamepad.id });
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  // Capture the next key press for rebinding.
  captureKey(cb) {
    this.captureCallback = cb;
  }

  onKey(e, isDown) {
    if (this.captureCallback && isDown) {
      e.preventDefault();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(e.code);
      return;
    }
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (typing) return;
    const actions = this.bindingIndex.get(e.code) || [];
    if (this.context === 'flight' && (actions.length || e.code === 'Tab' || e.code.startsWith('F') || e.code === 'Space')) {
      if (!(e.code === 'F5' || e.code === 'F11' || e.code === 'F12')) e.preventDefault();
    }
    if (isDown) {
      if (this.down.has(e.code) && !e.repeat) return;
      if (e.repeat) {
        // Allow auto-repeat only for a few discrete actions
        for (const a of actions) if (a === 'trimUp' || a === 'trimDown') this.events.push(a);
        return;
      }
      this.down.add(e.code);
      for (const a of actions) {
        if (!CONTINUOUS.has(a) || a === 'brakes') this.events.push(a);
        this.emit({ type: 'action', action: a, code: e.code, shift: e.shiftKey });
      }
    } else {
      this.down.delete(e.code);
      for (const a of actions) this.emit({ type: 'actionUp', action: a, code: e.code });
    }
  }

  isDown(action) {
    const codes = this.settings.get('controls').bindings[action] || [];
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  // Returns and clears discrete actions pressed since the last call.
  consume() {
    const e = this.events;
    this.events = [];
    return e;
  }

  update(dt) {
    const ctl = this.settings.get('controls');
    const ax = this.axes;
    const flight = this.context === 'flight';
    const rate = 2.6 * (ctl.keyboardRate || 1);
    const center = 3.5;
    // Keyboard axes with smoothing
    const kpUp = flight && this.isDown('pitchUp'),
      kpDn = flight && this.isDown('pitchDown');
    const krL = flight && this.isDown('rollLeft'),
      krR = flight && this.isDown('rollRight');
    const kyL = flight && this.isDown('yawLeft'),
      kyR = flight && this.isDown('yawRight');
    const tp = (kpUp ? 1 : 0) - (kpDn ? 1 : 0);
    const tr = (krR ? 1 : 0) - (krL ? 1 : 0);
    const ty = (kyR ? 1 : 0) - (kyL ? 1 : 0);
    this.kb.pitch = approach(this.kb.pitch, tp, tp ? rate : center, dt);
    this.kb.roll = approach(this.kb.roll, tr, tr ? rate : center, dt);
    this.kb.yaw = approach(this.kb.yaw, ty, ty ? rate * 1.5 : center, dt);
    let pitch = this.kb.pitch,
      roll = this.kb.roll,
      yaw = this.kb.yaw;
    let throttleRate = 0;
    if (flight && this.isDown('throttleUp')) throttleRate += 0.45;
    if (flight && this.isDown('throttleDown')) throttleRate -= 0.45;
    let brake = flight && this.isDown('brakes') ? 1 : 0;
    let trim = 0;
    if (flight && this.isDown('trimUp')) trim += 1;
    if (flight && this.isDown('trimDown')) trim -= 1;
    let lookX = 0,
      lookY = 0;
    if (flight && this.isDown('lookLeft')) lookX -= 1;
    if (flight && this.isDown('lookRight')) lookX += 1;

    // Mouse yoke
    if (flight && this.mouseYoke && this.mouse.inside && !this.mouse.overUI && !(this.mouse.buttons & 2)) {
      const s = ctl.sensitivity || 1;
      const mx = applyDeadzone(this.mouse.nx, 0.04) * 1.25 * s;
      const my = applyDeadzone(this.mouse.ny, 0.04) * 1.25 * s;
      roll = Math.abs(roll) > 0.05 ? roll : Math.max(-1, Math.min(1, mx));
      pitch = Math.abs(pitch) > 0.05 ? pitch : Math.max(-1, Math.min(1, my));
    }

    // Gamepads / joysticks
    ax.throttleAbs = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let found = null;
    for (const p of pads) if (p && p.connected) {
      found = p;
      break;
    }
    const gi = this.gamepadInfo;
    if (found) {
      gi.connected = true;
      gi.id = found.id;
      gi.type = found.mapping === 'standard' ? 'gamepad' : 'joystick';
      gi.axes = [...found.axes];
      gi.buttons = found.buttons.map((b) => b.value);
      const dz = ctl.deadzone ?? 0.08;
      const press = (i) => found.buttons[i] && found.buttons[i].pressed && !this.prevButtons[i];
      if (gi.type === 'gamepad') {
        const m = ctl.gamepad;
        const gp = applyDeadzone(found.axes[1] || 0, dz) * (m.invertPitch ? -1 : 1);
        const gr = applyDeadzone(found.axes[0] || 0, dz);
        if (Math.abs(gp) > 0.01) pitch = gp; // stick back (+) = nose up
        if (Math.abs(gr) > 0.01) roll = gr;
        const lt = found.buttons[6] ? found.buttons[6].value : 0;
        const rt = found.buttons[7] ? found.buttons[7].value : 0;
        throttleRate += (rt - lt) * 0.6;
        if (found.buttons[4] && found.buttons[4].pressed) yaw = -1;
        if (found.buttons[5] && found.buttons[5].pressed) yaw = 1;
        if (found.buttons[0] && found.buttons[0].pressed) brake = 1;
        lookX += applyDeadzone(found.axes[2] || 0, dz);
        lookY += applyDeadzone(found.axes[3] || 0, dz);
        if (flight) {
          if (press(1)) this.events.push('flapsUp');
          if (press(2)) this.events.push('flapsDown');
          if (press(3)) this.events.push('gear');
          if (press(8)) this.events.push('camera');
          if (press(9)) this.events.push('pause');
          if (press(10)) this.events.push('atc');
          if (press(11)) this.events.push('lookCenter');
          if (press(14)) this.events.push('autopilot');
          if (press(15)) this.events.push('map');
        } else if (press(9)) this.events.push('pause');
        if (found.buttons[12] && found.buttons[12].pressed) trim += 1;
        if (found.buttons[13] && found.buttons[13].pressed) trim -= 1;
      } else {
        const m = ctl.joystick;
        const jp = applyDeadzone(found.axes[m.pitch] || 0, dz) * (m.invertPitch ? -1 : 1);
        const jr = applyDeadzone(found.axes[m.roll] || 0, dz);
        const jy = m.yaw >= 0 && m.yaw < found.axes.length ? applyDeadzone(found.axes[m.yaw] || 0, dz * 1.5) : 0;
        if (Math.abs(jp) > 0.005) pitch = jp;
        if (Math.abs(jr) > 0.005) roll = jr;
        if (Math.abs(jy) > 0.01) yaw = jy;
        if (m.throttle >= 0 && m.throttle < found.axes.length) {
          let t = found.axes[m.throttle];
          t = m.invertThrottle ? (1 - t) / 2 : (1 + t) / 2;
          if (this.lastJoyThrottle === null || Math.abs(t - this.lastJoyThrottle) > 0.015) {
            this.lastJoyThrottle = t;
            ax.throttleAbs = Math.max(0, Math.min(1, t));
          }
        }
        if (found.buttons[0] && found.buttons[0].pressed) brake = 1;
        if (flight) {
          if (press(1)) this.events.push('autopilot');
          if (press(2)) this.events.push('flapsDown');
          if (press(3)) this.events.push('flapsUp');
          if (press(4)) this.events.push('gear');
          if (press(5)) this.events.push('camera');
          if (press(6)) this.events.push('spoilers');
          if (press(7)) this.events.push('reverse');
        }
        // Hat switch reported as buttons 12-15 on many devices
        if (found.buttons[14] && found.buttons[14].pressed) lookX -= 1;
        if (found.buttons[15] && found.buttons[15].pressed) lookX += 1;
      }
      this.prevButtons = found.buttons.map((b) => b.pressed);
    } else {
      gi.connected = false;
      gi.type = 'none';
    }

    if (ctl.invertPitch) pitch = -pitch;
    const sens = ctl.sensitivity || 1;
    ax.pitch = Math.max(-1, Math.min(1, pitch * (this.mouseYoke ? 1 : Math.min(1.3, sens))));
    ax.roll = Math.max(-1, Math.min(1, roll * Math.min(1.3, sens)));
    ax.yaw = Math.max(-1, Math.min(1, yaw));
    ax.throttleRate = flight ? throttleRate : 0;
    ax.brake = brake;
    ax.trim = trim;
    ax.lookX = lookX;
    ax.lookY = lookY;
    if (!flight) {
      ax.pitch = ax.roll = ax.yaw = 0;
      ax.throttleAbs = null;
    }
  }

  // Mouse deltas for camera look since the last call
  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return d;
  }
}
