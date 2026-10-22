// Procedural audio using the Web Audio API: engines (turbofan, piston, turboprop,
// afterburner), wind, ground roll, rain, thunder, mechanical sounds, cockpit
// warnings and speech (ATC radio and GPWS callouts).

function makeNoise(ctx, seconds, type) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

class Voice {
  constructor(engine, bus) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(bus);
    this.nodes = [];
  }
  noise(type, filterType, freq, q = 0.7) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.e.noise[type];
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.out);
    src.start(0, Math.random() * 2);
    this.nodes.push(src);
    return { src, filter: f, gain: g };
  }
  osc(type, freq, filterType = null, ffreq = 1000, q = 1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    let f = null;
    if (filterType) {
      f = this.ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = ffreq;
      f.Q.value = q;
      o.connect(f).connect(g);
    } else o.connect(g);
    g.connect(this.out);
    o.start();
    this.nodes.push(o);
    return { osc: o, gain: g, filter: f };
  }
  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.1);
    setTimeout(() => {
      for (const n of this.nodes)
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      this.out.disconnect();
    }, 600);
  }
}

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.engineVoices = [];
    this.warnLoops = {};
    this.speechQueue = [];
    this.speaking = false;
    this.voices = [];
    this.inside = true;
    this.lastCallout = 0;
    settings.on('change', (e) => {
      if (e.section === 'audio') this.applyVolumes();
    });
  }

  // Must be called from a user gesture
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = {};
    for (const b of ['engine', 'env', 'ui', 'radio', 'warn']) {
      this.buses[b] = ctx.createGain();
    }
    // Engine bus passes through a cockpit muffling filter
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.buses.engine.connect(this.muffle).connect(this.master);
    this.buses.env.connect(this.master);
    this.buses.ui.connect(this.master);
    this.buses.radio.connect(this.master);
    this.buses.warn.connect(this.master);
    this.noise = { white: makeNoise(ctx, 3, 'white'), pink: makeNoise(ctx, 4, 'pink'), brown: makeNoise(ctx, 4, 'brown') };
    // Environment voices
    this.env = new Voice(this, this.buses.env);
    this.env.out.gain.value = 1;
    this.wind = this.env.noise('pink', 'bandpass', 500, 0.6);
    this.windHigh = this.env.noise('white', 'highpass', 3000, 0.5);
    this.roll = this.env.noise('brown', 'lowpass', 140, 0.8);
    this.rain = this.env.noise('white', 'highpass', 1800, 0.4);
    this.cabin = this.env.noise('pink', 'lowpass', 400, 0.5);
    this.applyVolumes();
    this.ready = true;
    if (window.speechSynthesis) {
      const load = () => (this.voices = window.speechSynthesis.getVoices());
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.get('audio');
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.05);
    this.buses.engine.gain.setTargetAtTime(a.engine, t, 0.05);
    this.buses.env.gain.setTargetAtTime(a.environment, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(a.ui, t, 0.05);
    this.buses.radio.gain.setTargetAtTime(a.radio, t, 0.05);
    this.buses.warn.gain.setTargetAtTime(Math.max(0.3, a.engine), t, 0.05);
  }

  // Build engine sound voices for an aircraft
  setAircraft(spec) {
    if (!this.ctx) return;
    for (const v of this.engineVoices) v.voice.stop();
    this.engineVoices = [];
    const type = spec.engine.type;
    const n = Math.min(2, spec.engine.list.length);
    for (let i = 0; i < n; i++) {
      const voice = new Voice(this, this.buses.engine);
      voice.out.gain.value = 0;
      const ev = { voice, type, spec, index: i };
      if (type === 'jet') {
        ev.roar = voice.noise('brown', 'lowpass', 300, 0.7);
        ev.hiss = voice.noise('white', 'bandpass', 2500, 0.6);
        ev.whine = voice.osc('sawtooth', 800, 'bandpass', 3000, 6);
        ev.whine2 = voice.osc('triangle', 1600, 'bandpass', 4000, 8);
        ev.rumble = voice.osc('sine', 45);
        if (spec.engine.abThrust) ev.ab = voice.noise('brown', 'lowpass', 500, 0.9);
      } else {
        ev.pulse = voice.osc('sawtooth', 80, 'lowpass', 600, 2);
        ev.harm = voice.osc('square', 160, 'lowpass', 900, 1);
        ev.buzz = voice.osc('sawtooth', 90, 'bandpass', 300, 3);
        ev.roar = voice.noise('brown', 'lowpass', 400, 0.7);
        if (type === 'turboprop') ev.whine = voice.osc('sawtooth', 900, 'bandpass', 3000, 8);
      }
      this.engineVoices.push(ev);
    }
    this.blades = spec.engine.blades || 2;
  }

  // state: { engines:[{rpm, n1, running, afterburner, throttle}], tas, gs, onGround, inside, cameraDist, closingSpeed, precip, cabin, stall }
  update(dt, s) {
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime;
    const tc = 0.08;
    const inside = s.inside;
    this.muffle.frequency.setTargetAtTime(inside ? (s.cabin ? 700 : 1400) : 16000, t, 0.2);
    const dist = Math.max(1, s.cameraDist || 1);
    const att = inside ? 0.55 : Math.min(1.2, 30 / (dist * 0.25 + 10));
    // Doppler (external views)
    const dop = inside ? 1 : Math.max(0.6, Math.min(1.6, 343 / Math.max(150, 343 - (s.closingSpeed || 0))));
    for (const ev of this.engineVoices) {
      const e = s.engines[Math.min(ev.index, s.engines.length - 1)] || { rpm: 0 };
      const r = e.rpm || 0;
      const on = r > 0.02 ? 1 : 0;
      ev.voice.out.gain.setTargetAtTime(att * on * (this.engineVoices.length > 1 ? 0.75 : 1), t, 0.2);
      if (ev.type === 'jet') {
        const thr = e.n1 || r;
        ev.roar.filter.frequency.setTargetAtTime((180 + 1600 * thr * thr) * dop, t, tc);
        ev.roar.gain.gain.setTargetAtTime(0.15 + 1.4 * thr * thr * (inside ? 0.7 : 1.2), t, tc);
        ev.hiss.gain.gain.setTargetAtTime(0.04 + 0.25 * thr, t, tc);
        ev.hiss.filter.frequency.setTargetAtTime(2200 * dop, t, tc);
        ev.whine.osc.frequency.setTargetAtTime((350 + 2600 * thr) * dop, t, tc);
        ev.whine.filter.frequency.setTargetAtTime((350 + 2600 * thr) * dop, t, tc);
        ev.whine.gain.gain.setTargetAtTime((0.05 + 0.12 * thr) * (inside ? 0.5 : 1), t, tc);
        ev.whine2.osc.frequency.setTargetAtTime((900 + 5200 * thr) * dop, t, tc);
        ev.whine2.gain.gain.setTargetAtTime(0.03 * thr, t, tc);
        ev.rumble.osc.frequency.setTargetAtTime(30 + 40 * thr, t, tc);
        ev.rumble.gain.gain.setTargetAtTime(0.25 * thr, t, tc);
        if (ev.ab) ev.ab.gain.gain.setTargetAtTime(2.2 * (e.afterburner || 0), t, 0.15);
      } else {
        const rpm = r * (ev.spec.engine.maxRPM || 2500);
        const fire = (rpm / 60) * (ev.type === 'turboprop' ? 1 : 2);
        const blade = (rpm / 60) * this.blades;
        const load = Math.max(0.15, e.throttle || 0);
        ev.pulse.osc.frequency.setTargetAtTime(Math.max(10, fire) * dop, t, tc);
        ev.pulse.gain.gain.setTargetAtTime(ev.type === 'turboprop' ? 0.08 : 0.35 * (0.4 + load), t, tc);
        ev.harm.osc.frequency.setTargetAtTime(Math.max(20, fire * 2) * dop, t, tc);
        ev.harm.gain.gain.setTargetAtTime(ev.type === 'turboprop' ? 0.03 : 0.08 * load, t, tc);
        ev.buzz.osc.frequency.setTargetAtTime(Math.max(10, blade) * dop, t, tc);
        ev.buzz.filter.frequency.setTargetAtTime(Math.max(60, blade * 3) * dop, t, tc);
        ev.buzz.gain.gain.setTargetAtTime(0.25 * r * (0.5 + load), t, tc);
        ev.roar.filter.frequency.setTargetAtTime((250 + 900 * r) * dop, t, tc);
        ev.roar.gain.gain.setTargetAtTime(0.3 + 0.8 * r * load, t, tc);
        if (ev.whine) {
          ev.whine.osc.frequency.setTargetAtTime((600 + 1400 * r) * dop, t, tc);
          ev.whine.gain.gain.setTargetAtTime(0.07 * r, t, tc);
        }
      }
    }
    // Wind
    const v = s.tas || 0;
    const wv = Math.min(1.5, (v / 120) ** 2);
    this.wind.gain.gain.setTargetAtTime(wv * (inside ? 0.5 : 0.9) + (s.stall ? 0.2 : 0), t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 5, t, 0.1);
    this.windHigh.gain.gain.setTargetAtTime(wv * (inside ? 0.05 : 0.2), t, 0.1);
    // Ground roll
    const gs = s.onGround ? s.gs || 0 : 0;
    this.roll.gain.gain.setTargetAtTime(Math.min(1.2, gs / 40) * (inside ? 1 : 0.4), t, 0.05);
    this.roll.filter.frequency.setTargetAtTime(80 + gs * 3, t, 0.1);
    // Rain
    this.rain.gain.gain.setTargetAtTime((s.precip || 0) * (inside ? 0.35 : 0.2) * (1 + Math.min(1, v / 100)), t, 0.3);
    // Cabin ambience
    this.cabin.gain.gain.setTargetAtTime(s.cabin ? 0.25 : 0, t, 0.3);
  }

  // ---- One-shot sounds -------------------------------------------------------
  burst({ type = 'white', filter = 'bandpass', freq = 2000, q = 1, dur = 0.05, gain = 0.4, bus = 'ui', delay = 0, decay = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[type];
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setTargetAtTime(0, t + dur * 0.3, decay || dur * 0.4);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random());
    src.stop(t + dur * 4 + 2);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, bus = 'warn', delay = 0, slide = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setTargetAtTime(0, t + dur * 0.8, dur * 0.15);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur * 2 + 0.2);
  }

  click() {
    this.burst({ freq: 3200, q: 2, dur: 0.02, gain: 0.35 });
    this.burst({ freq: 900, q: 1, dur: 0.03, gain: 0.2 });
  }
  uiClick() {
    this.tone(1400, 0.05, { type: 'sine', gain: 0.06, bus: 'ui' });
  }
  uiHover() {
    this.tone(2000, 0.03, { type: 'sine', gain: 0.02, bus: 'ui' });
  }
  thump(intensity = 1) {
    this.burst({ type: 'brown', filter: 'lowpass', freq: 120, dur: 0.25, gain: 0.9 * intensity, bus: 'env' });
    this.tone(70, 0.3, { gain: 0.5 * intensity, bus: 'env', slide: 35 });
  }
  screech(intensity = 1) {
    this.burst({ type: 'white', filter: 'bandpass', freq: 2400, q: 3, dur: 0.35, gain: 0.25 * intensity, bus: 'env' });
  }
  gearMotor() {
    this.burst({ type: 'pink', filter: 'bandpass', freq: 300, q: 2, dur: 2.5, gain: 0.25, bus: 'env', decay: 1.5 });
    this.tone(180, 2.5, { type: 'sawtooth', gain: 0.03, bus: 'env' });
    this.thump(0.3);
  }
  flapsMotor() {
    this.tone(260, 1.6, { type: 'sawtooth', gain: 0.02, bus: 'env' });
    this.burst({ type: 'pink', filter: 'bandpass', freq: 500, q: 2, dur: 1.5, gain: 0.08, bus: 'env', decay: 1 });
  }
  explosion() {
    this.burst({ type: 'brown', filter: 'lowpass', freq: 400, dur: 2.5, gain: 2.5, bus: 'env', decay: 1.5 });
    this.burst({ type: 'white', filter: 'lowpass', freq: 2000, dur: 0.6, gain: 1.0, bus: 'env' });
  }
  thunder(distance) {
    const delay = Math.min(12, distance / 343);
    const g = Math.max(0.15, 1.6 - distance / 15000);
    this.burst({ type: 'brown', filter: 'lowpass', freq: 160, dur: 3.5, gain: g, bus: 'env', delay, decay: 2.0 });
    this.burst({ type: 'brown', filter: 'lowpass', freq: 90, dur: 4, gain: g * 0.8, bus: 'env', delay: delay + 0.4, decay: 2.5 });
  }
  chime(kind) {
    switch (kind) {
      case 'seatbelt':
        this.tone(988, 0.6, { gain: 0.12, bus: 'ui' });
        this.tone(784, 0.9, { gain: 0.12, bus: 'ui', delay: 0.35 });
        break;
      case 'caution':
        this.tone(1100, 0.35, { type: 'triangle', gain: 0.14 });
        break;
      case 'warning':
        for (let i = 0; i < 3; i++) this.tone(800, 0.18, { type: 'square', gain: 0.05, delay: i * 0.25 });
        break;
      case 'apDisconnect':
        for (let i = 0; i < 3; i++) {
          this.tone(1200, 0.12, { type: 'sawtooth', gain: 0.05, delay: i * 0.3 });
          this.tone(1600, 0.12, { type: 'sawtooth', gain: 0.05, delay: i * 0.3 + 0.13 });
        }
        break;
      case 'apEngage':
        this.tone(1300, 0.08, { gain: 0.06 });
        break;
      case 'altAlert':
        this.tone(1500, 0.5, { type: 'triangle', gain: 0.08 });
        break;
      case 'mission':
        this.tone(660, 0.18, { gain: 0.1, bus: 'ui' });
        this.tone(880, 0.18, { gain: 0.1, bus: 'ui', delay: 0.15 });
        this.tone(1320, 0.4, { gain: 0.1, bus: 'ui', delay: 0.3 });
        break;
      case 'fail':
        this.tone(440, 0.4, { gain: 0.1, bus: 'ui' });
        this.tone(330, 0.6, { gain: 0.1, bus: 'ui', delay: 0.3 });
        break;
    }
  }

  // Continuous warning loops: stall (shaker/horn), overspeed clacker, gear horn, fire bell
  setWarning(name, on, type = 'jet') {
    if (!this.ctx) return;
    const cur = this.warnLoops[name];
    if (on && !cur) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.buses.warn);
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      let src;
      if (name === 'stall' && type === 'ga') {
        src = ctx.createOscillator();
        src.type = 'square';
        src.frequency.value = 1700;
        lfo.frequency.value = 0.0001;
        lg.gain.value = 0;
        g.gain.value = 0.03;
      } else if (name === 'stall') {
        // Stick shaker: low rattle
        src = ctx.createBufferSource();
        src.buffer = this.noise.brown;
        src.loop = true;
        lfo.frequency.value = 17;
        lg.gain.value = 0.6;
        g.gain.value = 0.6;
      } else if (name === 'overspeed') {
        src = ctx.createOscillator();
        src.type = 'square';
        src.frequency.value = 2200;
        lfo.type = 'square';
        lfo.frequency.value = 7;
        lg.gain.value = 0.03;
        g.gain.value = 0.03;
      } else if (name === 'gear' || name === 'config') {
        src = ctx.createOscillator();
        src.type = 'sawtooth';
        src.frequency.value = 900;
        lfo.type = 'square';
        lfo.frequency.value = 3;
        lg.gain.value = 0.03;
        g.gain.value = 0.03;
      } else if (name === 'fire') {
        src = ctx.createOscillator();
        src.type = 'triangle';
        src.frequency.value = 1400;
        lfo.type = 'square';
        lfo.frequency.value = 9;
        lg.gain.value = 0.06;
        g.gain.value = 0.06;
      } else return;
      lfo.connect(lg).connect(g.gain);
      src.connect(g);
      src.start();
      lfo.start();
      this.warnLoops[name] = { src, lfo, g };
    } else if (!on && cur) {
      try {
        cur.src.stop();
        cur.lfo.stop();
      } catch {
        /* ignore */
      }
      cur.g.disconnect();
      delete this.warnLoops[name];
    }
  }

  stopAllWarnings() {
    for (const k of Object.keys(this.warnLoops)) this.setWarning(k, false);
  }

  // ---- Speech ----------------------------------------------------------------
  pickVoice(kind) {
    const vs = this.voices.filter((v) => v.lang && v.lang.startsWith('en'));
    if (!vs.length) return null;
    const idx = { atc: 0, gpws: 1, pilot1: 2, pilot2: 3, pilot3: 4, captain: 1 }[kind] ?? 0;
    return vs[idx % vs.length];
  }

  speak(text, kind = 'atc', { priority = false } = {}) {
    if (!window.speechSynthesis || !this.settings.get('audio').voice) return;
    if (priority) {
      window.speechSynthesis.cancel();
      this.speechQueue = [];
    }
    const u = new SpeechSynthesisUtterance(text.replace(/\bAX/g, 'A X'));
    const v = this.pickVoice(kind);
    if (v) u.voice = v;
    u.rate = kind === 'gpws' ? 1.05 : 1.12;
    u.pitch = kind === 'gpws' ? 0.65 : kind.startsWith('pilot') ? 0.9 + Math.random() * 0.3 : 1.0;
    u.volume = Math.min(1, this.settings.get('audio').radio * this.settings.get('audio').master * 1.3);
    if (kind !== 'gpws') {
      u.onstart = () => this.squelch();
      u.onend = () => this.squelch(0.6);
    }
    window.speechSynthesis.speak(u);
  }

  squelch(g = 1) {
    this.burst({ type: 'white', filter: 'bandpass', freq: 3000, q: 0.8, dur: 0.12, gain: 0.08 * g, bus: 'radio' });
  }

  callout(value) {
    const now = performance.now();
    const words = {
      2500: 'twenty five hundred',
      1000: 'one thousand',
      500: 'five hundred',
      400: 'four hundred',
      300: 'three hundred',
      200: 'two hundred',
      100: 'one hundred',
      50: 'fifty',
      40: 'forty',
      30: 'thirty',
      20: 'twenty',
      10: 'ten',
      minimums: 'minimums',
      retard: 'retard',
      pullup: 'pull up',
      terrain: 'terrain, terrain',
      sinkrate: 'sink rate',
      bankangle: 'bank angle',
      toolowgear: 'too low, gear',
      glideslope: 'glide slope',
      stall: 'stall, stall',
      windshear: 'wind shear',
    };
    const w = words[value] || String(value);
    const urgent = typeof value === 'number' && value <= 50;
    if (!urgent && now - this.lastCallout < 600) return;
    this.lastCallout = now;
    this.speak(w, 'gpws', { priority: urgent || value === 'pullup' || value === 'terrain' });
  }
}
