// In-flight heads-up interface: flight dashboard (mini PFD/ND, flight data,
// engines, fuel, gear, GPS), autopilot control panel, mode annunciator,
// warnings, mission & tutorial panels, ATC radio, chat, landing rate popup and
// mouse interaction with the 3D cockpit.

import { el, clear, keyCap } from './dom.js';
import { drawPFD, drawND } from '../cockpit/Instruments.js';
import { CAMERA_LABELS } from '../camera/CameraManager.js';
import { fmtHeading, fmtDuration, fmtLatLon, fmtTime, escapeHtml } from '../core/format.js';
import { KT, FT } from '../physics/atmosphere.js';

const HUD_MODES = ['full', 'minimal', 'off'];

function dv(label, cls = '') {
  const b = el('b' + (cls ? '.' + cls : ''));
  const small = el('small');
  const node = el('div.dv', null, el('span', null, label), b, small);
  return { node, b, small, set: (v, unit = '', c = null) => {
    b.textContent = v;
    small.textContent = unit;
    if (c !== null) b.className = c;
  } };
}

export class FlightHUD {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.root = el('div#hud.hidden');
    this.timer = 0;
    this.canvasTimer = 0;
    this.radioMsgs = [];
    this.atcOpen = false;
    this.chatOpen = false;
    this.hoverTimer = 0;
    this.camLabelTimer = null;
    this.landingTimer = null;
    this.build();
    // Cockpit clicks & wheel
    this.game.input.on((ev) => this.onInput(ev));
  }

  // Subscribe to systems created after the UI (ATC)
  bindSystems() {
    this.game.atc.onMessage((m) => this.onRadio(m));
  }

  // ------------------------------------------------------------------ build
  build() {
    const r = this.root;
    // Mode annunciator
    this.fma = { athr: el('div'), lat: el('div'), vert: el('div'), ap: el('div') };
    this.fmaNode = el('div.fma.hud-panel', null, this.fma.athr, this.fma.vert, this.fma.lat, this.fma.ap);
    r.appendChild(this.fmaNode);
    this.master = el('div.master.interactive');
    r.appendChild(this.master);
    this.warnBig = el('div.warning-big.hidden');
    r.appendChild(this.warnBig);
    this.stallFlash = el('div.stall-flash.hidden');
    r.appendChild(this.stallFlash);

    // Top left: mission objective + tutorial
    this.objective = el('div.objective.hud-panel.hidden', null, el('div.t'), el('div.o'), el('div.timer'));
    this.tutorial = el('div.tutorial.hud-panel.interactive.hidden');
    r.appendChild(el('div.hud-tl', null, this.objective, this.tutorial));

    // Top right: status chips + radio
    this.chips = el('div', { style: { display: 'flex', gap: '6px' } });
    this.radio = el('div.radio.hud-panel.hidden');
    r.appendChild(el('div.hud-tr', null, this.chips, this.radio));
    this.camLabel = el('div.cam-label');
    r.appendChild(this.camLabel);

    // Bottom dashboard
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const mk = (cls) => {
      const c = el('canvas.' + cls);
      c.width = 256 * dpr;
      c.height = 256 * dpr;
      c.style.width = '256px';
      c.style.height = '256px';
      return c;
    };
    this.pfdCanvas = mk('pfd');
    this.ndCanvas = mk('nd');
    this.pfdCtx = this.pfdCanvas.getContext('2d');
    this.ndCtx = this.ndCanvas.getContext('2d');
    this.ndCanvas.title = 'Navigation display — scroll to change range';
    this.ndCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const ranges = [5, 10, 20, 40, 80, 160];
      const p = this.game.player;
      if (!p) return;
      let i = ranges.indexOf(p.cockpit.ndRange);
      if (i < 0) i = 2;
      i = Math.max(0, Math.min(ranges.length - 1, i + Math.sign(e.deltaY)));
      p.cockpit.ndRange = ranges[i];
    });
    this.ndCanvas.addEventListener('click', () => this.ui.toggleMap());
    const glass = el('div.glass.hud-panel.interactive', null, this.pfdCanvas, this.ndCanvas);

    this.d = {
      ias: dv('IAS'),
      alt: dv('ALT'),
      vs: dv('V/S'),
      hdg: dv('HDG'),
      gs: dv('GS', 'w'),
      mach: dv('MACH', 'w'),
      ra: dv('RAD ALT', 'w'),
      g: dv('G', 'w'),
      fuel: dv('FUEL', 'c'),
      endur: dv('ENDURANCE', 'c'),
      thr: dv('THRUST', 'c'),
      wind: dv('WIND', 'w'),
    };
    const data = el('div.data.hud-panel', null, ...Object.values(this.d).map((x) => x.node));

    // Systems
    this.engBars = el('div.bars');
    this.thrBar = el('div.b.thr', null, el('div'));
    this.gearLights = el('div.gear-lights', null, el('i'), el('i'), el('i'));
    this.sys = {
      flaps: el('b'),
      spoilers: el('b'),
      brakes: el('b'),
      trim: el('b'),
      gps: el('b', { style: { fontSize: '11px' } }),
      wpt: el('b'),
    };
    const line = (label, v) => el('div.line', null, el('span', null, label), v);
    this.engLabel = el('div.lbl', null, 'N1');
    const sys = el(
      'div.sys.hud-panel',
      null,
      el('div.engines-row', null, el('div', null, this.engBars, this.engLabel), el('div', null, el('div.bars', null, this.thrBar), el('div.lbl', null, 'THR')), el('div', { style: { marginLeft: 'auto' } }, this.gearLights, el('div.lbl', null, 'GEAR'))),
      line('Flaps', this.sys.flaps),
      line('Spoilers', this.sys.spoilers),
      line('Brakes', this.sys.brakes),
      line('Trim', this.sys.trim),
      line('Next', this.sys.wpt),
      line('GPS', this.sys.gps)
    );
    this.apPanel = el('div.ap-panel.hud-panel.interactive');
    this.buildAP();
    this.dash = el('div.dash', null, glass, data, sys, this.apPanel);
    r.appendChild(this.dash);

    // Minimal strip
    this.m = { ias: dv('IAS'), alt: dv('ALT'), vs: dv('V/S'), hdg: dv('HDG'), thr: dv('THR') };
    this.minStrip = el('div.hud-min.hud-panel.hidden', null, ...Object.values(this.m).map((x) => x.node));
    r.appendChild(this.minStrip);

    // Tooltip, landing popup, ATC, chat, fps
    this.tooltip = el('div.tooltip.hidden');
    r.appendChild(this.tooltip);
    this.landing = el('div.landing-rate.hud-panel.hidden');
    r.appendChild(this.landing);
    this.atc = el('div.atc-panel.hud-panel.interactive.hidden');
    r.appendChild(this.atc);
    this.chatLines = el('div.lines.hud-panel.scroll');
    this.chatInput = el('input.hidden', { type: 'text', placeholder: 'Message all pilots — Enter to send, Esc to cancel', maxLength: 240 });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) {
          if (this.game.multiplayer.connected) this.game.multiplayer.chat(t);
          else this.ui.toast('Not connected to multiplayer — open Multiplayer from the main menu', 'warn');
        }
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    this.chat = el('div.chat-box.interactive', null, this.chatLines, this.chatInput);
    r.appendChild(this.chat);
    this.fpsNode = el('div.fps.hidden');
    r.appendChild(this.fpsNode);
  }

  buildAP() {
    const p = this.apPanel;
    clear(p);
    const btn = (label, title, act, state) => {
      const b = el('button.ap-btn', { title, onclick: () => (act(), this.game.audio.click(), this.refreshAP()) }, label);
      b._state = state;
      return b;
    };
    const sim = () => this.game.player.sim;
    const ap = () => sim().ap;
    this.apButtons = [
      btn('AP', 'Autopilot (Z)', () => this.game.player.toggleAP(), () => (ap().engaged ? 'on' : '')),
      btn('A/THR', 'Autothrottle (X)', () => this.game.player.toggleATHR(), () => (ap().athr ? 'on' : '')),
      btn('HDG', 'Heading select', () => (ap().modeHDG(), this.ensureAP()), () => (ap().lat === 'HDG' ? 'on' : '')),
      btn('NAV', 'Follow the GPS flight plan', () => {
        if (!sim().nav.plan.length) this.ui.toast('No flight plan — open the map (M) to create one', 'warn');
        ap().modeNAV();
        this.ensureAP();
      }, () => (ap().lat === 'NAV' ? 'on' : '')),
      btn('APPR', 'Arm ILS approach (localizer + glideslope)', () => (this.game.player.armApproach(), this.ensureAP()), () => (ap().lat === 'LOC' || ap().vert === 'GS' ? 'on' : ap().latArmed || ap().vertArmed ? 'arm' : '')),
    ];
    this.apButtons2 = [
      btn('ALT', 'Hold altitude', () => (ap().modeALT(), this.ensureAP()), () => (ap().vert === 'ALT' ? 'on' : '')),
      btn('V/S', 'Vertical speed', () => (ap().modeVS(), this.ensureAP()), () => (ap().vert === 'VS' ? 'on' : '')),
      btn('LVL CHG', 'Climb/descend to the selected altitude', () => (ap().modeFLCH(), this.ensureAP()), () => (ap().vert === 'FLCH' ? 'on' : '')),
      btn('SYNC', 'Synchronise targets to current flight values', () => ap().syncTargets(), () => ''),
    ];
    p.appendChild(el('div.row', null, ...this.apButtons));
    p.appendChild(el('div.row', null, ...this.apButtons2));
    const knob = (label, get, change, fmt) => {
      const b = el('b', { title: 'Scroll to adjust (Shift = ×10)' });
      b.addEventListener('wheel', (e) => {
        e.preventDefault();
        change(-Math.sign(e.deltaY), e.shiftKey);
        this.refreshAP();
      });
      const node = el(
        'div.k',
        null,
        el('span', null, label),
        b,
        el('div.pm', null, el('button', { onclick: (e) => (change(-1, e.shiftKey), this.refreshAP()) }, '−'), el('button', { onclick: (e) => (change(1, e.shiftKey), this.refreshAP()) }, '+'))
      );
      node._update = () => (b.textContent = fmt(get()));
      return node;
    };
    this.apKnobs = [
      knob('SPD', () => ap().spd, (d, s) => (ap().spd = Math.max(60, Math.min(600, ap().spd + d * (s ? 10 : 5)))), (v) => v),
      knob('HDG', () => ap().hdg, (d, s) => (ap().hdg = (ap().hdg + d * (s ? 10 : 1) + 360) % 360), (v) => fmtHeading(v)),
      knob('ALT', () => ap().alt, (d, s) => (ap().alt = Math.max(0, Math.min(50000, ap().alt + d * (s ? 1000 : 100)))), (v) => v.toLocaleString()),
      knob('V/S', () => ap().vs, (d, s) => (ap().vs = Math.max(-6000, Math.min(6000, ap().vs + d * (s ? 500 : 100)))), (v) => (v > 0 ? '+' : '') + v),
    ];
    p.appendChild(el('div.ap-sel', null, ...this.apKnobs));
  }

  ensureAP() {
    const p = this.game.player;
    if (p && !p.sim.ap.engaged && !p.sim.fm.wow) p.sim.ap.engage();
  }

  refreshAP() {
    const p = this.game.player;
    if (!p) return;
    for (const b of [...this.apButtons, ...this.apButtons2]) {
      const st = b._state();
      b.classList.toggle('on', st === 'on');
      b.classList.toggle('arm', st === 'arm');
    }
    this.apButtons[1].disabled = !p.spec.autopilot.athr;
    for (const k of this.apKnobs) k._update();
  }

  // ------------------------------------------------------------------ lifecycle
  show() {
    this.root.classList.remove('hidden');
    this.reset();
  }
  hide() {
    this.root.classList.add('hidden');
    this.closeATC();
    this.closeChat();
    this.tooltip.classList.add('hidden');
  }

  reset() {
    this.radioMsgs = [];
    clear(this.radio);
    this.radio.classList.add('hidden');
    this.tutorial.classList.add('hidden');
    this.objective.classList.add('hidden');
    this.landing.classList.add('hidden');
    this.closeATC();
    const p = this.game.player;
    if (p) {
      this.engLabel.textContent = p.spec.engine.type === 'piston' ? 'RPM' : p.spec.engine.type === 'turboprop' ? 'TQ' : 'N1';
      clear(this.engBars);
      this.engBarEls = p.spec.engine.list.map(() => {
        const b = el('div.b', null, el('div'));
        this.engBars.appendChild(b);
        return b;
      });
      this.gearLights.style.opacity = p.spec.gear.retractable === false ? '0.5' : '1';
      this.refreshAP();
    }
    this.cameraLabel(this.game.cameras.mode);
  }

  cameraLabel(mode) {
    this.camLabel.textContent = CAMERA_LABELS[mode] || mode;
    this.camLabel.classList.add('show');
    clearTimeout(this.camLabelTimer);
    this.camLabelTimer = setTimeout(() => this.camLabel.classList.remove('show'), 1400);
  }

  cycleHud() {
    const s = this.game.settings;
    const key = this.game.cameras.inside ? 'cockpitHud' : 'mode';
    const cur = s.get('hud')[key];
    const next = HUD_MODES[(HUD_MODES.indexOf(cur) + 1) % HUD_MODES.length];
    s.set('hud', key, next);
    this.ui.toast(`HUD: ${next}`, 'info', 1000);
  }

  // ------------------------------------------------------------------ tutorial / objective
  tutorialStep(step, index, total) {
    if (!step) return;
    const t = this.tutorial;
    clear(t);
    t.classList.remove('hidden');
    t.appendChild(el('div.hdr', null, el('span', null, 'Flight School'), el('span', null, `Step ${index + 1} / ${total}`)));
    t.appendChild(el('div.txt', null, step.text));
    if (step.keys) t.appendChild(el('div.keys', null, 'Keys: ', ...step.keys.split(/\s*\/\s*|\s*\+\s*/).map((k) => el('kbd', null, k))));
    t.appendChild(el('div.prog', null, el('div', { style: { width: `${((index + 1) / total) * 100}%` } })));
    t.classList.remove('flash');
    void t.offsetWidth;
    t.classList.add('flash');
  }

  // ------------------------------------------------------------------ landing
  showLandingRate(fpm, td) {
    const v = Math.abs(fpm);
    const col = v < 180 ? 'var(--green)' : v < 350 ? 'var(--accent-2)' : v < 600 ? 'var(--amber)' : 'var(--red)';
    clear(this.landing);
    this.landing.appendChild(el('div.l', { style: { color: col } }, td ? td.verdict : ''));
    this.landing.appendChild(el('div.v', { style: { color: col } }, `${Math.round(fpm)} fpm`));
    const extra = [];
    if (td && td.along !== null && td.along !== undefined) extra.push(`${Math.round(td.along)} m past threshold`, `${Math.abs(td.lateral).toFixed(1)} m ${td.lateral > 0 ? 'right' : 'left'} of centreline`);
    const p = this.game.player;
    if (p) extra.push(`${p.flightData.nz ? p.flightData.nz.toFixed(2) : '1.00'} g`);
    this.landing.appendChild(el('div.d', null, extra.join(' · ')));
    this.landing.classList.remove('hidden');
    clearTimeout(this.landingTimer);
    this.landingTimer = setTimeout(() => this.landing.classList.add('hidden'), 6000);
  }

  // ------------------------------------------------------------------ radio
  onRadio(m) {
    this.radioMsgs.push({ ...m, t: performance.now() });
    if (this.radioMsgs.length > 4) this.radioMsgs.shift();
    this.renderRadio();
    if (this.atcOpen) this.renderATC();
  }

  renderRadio() {
    clear(this.radio);
    const now = performance.now();
    const msgs = this.radioMsgs.filter((m) => now - m.t < (m.from === 'ai' ? 9000 : 20000));
    this.radio.classList.toggle('hidden', !msgs.length || this.atcOpen);
    for (const m of msgs.slice(-3)) this.radio.appendChild(el('div.msg.' + m.from, null, el('div.st', null, `${m.station} ${m.freq ? m.freq.toFixed(2) : ''}`), m.text));
  }

  toggleATC() {
    if (this.atcOpen) this.closeATC();
    else {
      this.atcOpen = true;
      this.atc.classList.remove('hidden');
      this.renderATC();
      this.renderRadio();
    }
  }
  closeATC() {
    this.atcOpen = false;
    this.atc.classList.add('hidden');
  }

  renderATC() {
    const atc = this.game.atc;
    const c = this.atc;
    clear(c);
    const ap = atc.airport;
    const p = this.game.player;
    let freq = '';
    if (p) {
      const ctx = atc.context();
      if (ctx) {
        const kind = ctx.onGround ? (atc.state === 'clearedTakeoff' || atc.state === 'lineup' ? 'tower' : 'ground') : ctx.dist < 25000 ? 'tower' : ctx.dist < 70000 ? 'approach' : 'center';
        const st = atc.station(ctx.ap, kind);
        freq = `${st.name} · ${st.freq.toFixed(2)}`;
      }
    }
    c.appendChild(el('div.hd', null, el('b', null, 'ATC RADIO'), el('span', null, freq || (ap ? ap.icao : ''))));
    const opts = atc.menuOptions();
    this.atcOptions = opts;
    opts.forEach((o, i) => {
      c.appendChild(
        el(
          'button.opt',
          {
            onclick: () => {
              atc.request(o.id, o);
              this.game.audio.click();
              this.renderATC();
            },
          },
          el('span.n', null, i < 9 ? `${i + 1}` : '·'),
          el('span', null, o.label)
        )
      );
    });
    if (atc.instruction) c.appendChild(el('div.instr', null, atc.instruction));
    const log = el('div.log.scroll');
    for (const m of atc.log.slice(-14)) log.appendChild(el('div.' + m.from, null, el('span.st', null, `${m.station}: `), m.text));
    c.appendChild(log);
    c.appendChild(el('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, 'Press 1–9 to transmit · Tab to close'));
    log.scrollTop = log.scrollHeight;
  }

  // ATC number key selection (called from the key capture in UIManager)
  atcKey(n) {
    if (!this.atcOpen || !this.atcOptions) return false;
    const o = this.atcOptions[n - 1];
    if (!o) return false;
    this.game.atc.request(o.id, o);
    this.game.audio.click();
    this.renderATC();
    return true;
  }

  // ------------------------------------------------------------------ chat
  openChat() {
    this.chatOpen = true;
    this.chatInput.classList.remove('hidden');
    this.game.input.context = 'text';
    setTimeout(() => this.chatInput.focus(), 0);
  }
  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatInput.value = '';
    this.chatInput.blur();
    this.chatInput.classList.add('hidden');
    if (this.game.state === 'flying') this.game.input.context = 'flight';
  }
  addChat(m) {
    const line = m.system ? el('div.sys', null, m.text) : el('div', null, el('span.from', null, m.from || '?'), m.text);
    this.chatLines.appendChild(line);
    while (this.chatLines.children.length > 8) this.chatLines.removeChild(this.chatLines.firstChild);
    this.chatLines.scrollTop = this.chatLines.scrollHeight;
    setTimeout(() => {
      if (line.parentNode && !this.chatOpen) line.parentNode.removeChild(line);
    }, 30000);
  }

  // ------------------------------------------------------------------ cockpit interaction
  onInput(ev) {
    const g = this.game;
    if (g.state !== 'flying' || !g.player || this.ui.modalOpen || g.cameras.mode !== 'cockpit') return;
    const cp = g.player.cockpit;
    if (ev.type === 'click') {
      const hit = cp.pick(g.camera, ev.nx, ev.ny);
      if (hit && hit.userData.control) {
        const c = hit.userData.control;
        c.act(c.kind === 'knob' ? 0 : 1, false);
        g.audio.click();
        this.hoverTimer = 0;
      }
    } else if (ev.type === 'wheel' && cp.hovering && !ev.shift) {
      const c = cp.hovering.userData.control;
      if (c && (c.kind === 'knob' || c.kind === 'lever')) {
        c.act(ev.delta, false);
        g.audio.click();
      }
    }
  }

  updateHover(dt) {
    const g = this.game;
    const p = g.player;
    const tt = this.tooltip;
    if (!p || g.cameras.mode !== 'cockpit' || this.ui.modalOpen || !g.input.mouse.inside) {
      if (p) p.cockpit.hovering = null;
      tt.classList.add('hidden');
      g.canvas.style.cursor = '';
      return;
    }
    this.hoverTimer -= dt;
    if (this.hoverTimer <= 0) {
      this.hoverTimer = 0.08;
      const m = g.input.mouse;
      const hit = p.cockpit.pick(g.camera, m.nx, m.ny);
      p.cockpit.hovering = hit && hit.userData.control ? hit : null;
    }
    const h = p.cockpit.hovering;
    if (h) {
      const c = h.userData.control;
      const st = typeof c.state === 'function' ? c.state() : '';
      tt.innerHTML = `${escapeHtml(c.label)}${st ? `<b>${escapeHtml(st)}</b>` : ''}`;
      tt.style.left = `${g.input.mouse.x}px`;
      tt.style.top = `${g.input.mouse.y}px`;
      tt.classList.remove('hidden');
      g.canvas.style.cursor = 'pointer';
    } else {
      tt.classList.add('hidden');
      g.canvas.style.cursor = '';
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.updateHover(dt);
    this.timer -= dt;
    this.canvasTimer -= dt;
    const inside = g.cameras.inside;
    const hs = g.settings.get('hud');
    const mode = inside ? hs.cockpitHud : hs.mode;
    const fighterCockpit = inside && g.cameras.mode === 'cockpit';
    const showDash = mode === 'full';
    this.dash.classList.toggle('hidden', !showDash);
    this.minStrip.classList.toggle('hidden', mode !== 'minimal');
    this.fmaNode.classList.toggle('hidden', mode === 'off' || (fighterCockpit && mode !== 'full'));
    const gr = g.settings.get('graphics');
    this.fpsNode.classList.toggle('hidden', !gr.fpsCounter);
    if (this.timer > 0) return;
    this.timer = 1 / 12;
    const fd = p.flightData;
    const sim = p.sim;
    const units = g.settings.get('gameplay').units;
    const metric = units === 'metric';
    // FMA
    const ap = fd.ap;
    this.fma.athr.innerHTML = ap.athr ? `<div class="act">${ap.athrMode}</div>` : `<div class="off">${p.spec.autopilot.athr ? 'MAN THR' : ''}</div>`;
    const latTxt = ap.lat === 'LOC' ? 'LOC' : ap.lat === 'ROLLOUT' ? 'ROLL OUT' : ap.lat;
    this.fma.lat.innerHTML = `<div class="${ap.engaged || fd.fd.on ? 'act' : 'off'}">${latTxt}</div>${ap.latArmed ? `<div class="arm">${ap.latArmed}</div>` : ''}`;
    const vertTxt = ap.vert === 'VS' ? `V/S ${ap.vs > 0 ? '+' : ''}${ap.vs}` : ap.vert === 'FLCH' ? 'LVL CHG' : ap.vert === 'GS' ? 'G/S' : ap.vert;
    this.fma.vert.innerHTML = `<div class="${ap.engaged || fd.fd.on ? 'act' : 'off'}">${vertTxt}</div>${ap.vertArmed ? `<div class="arm">${ap.vertArmed === 'GS' ? 'G/S' : ap.vertArmed}</div>` : ''}`;
    this.fma.ap.innerHTML = ap.engaged ? `<div class="ap-on">AP1</div><div class="arm">${ap.canLand && (ap.lat === 'LOC' || ap.latArmed) ? 'CAT 3' : ''}</div>` : `<div class="off">AP OFF</div>`;

    // Warnings
    const msgs = fd.messages || [];
    const warn = msgs.filter((m) => m.level === 'warning');
    const caut = msgs.filter((m) => m.level === 'caution');
    clear(this.master);
    if (warn.length) this.master.appendChild(el('div.w.red', { title: 'Click to silence', onclick: () => (p.silenced = true) }, `MASTER WARN · ${warn[0].text}`));
    if (caut.length) this.master.appendChild(el('div.w.amber', null, `MASTER CAUT · ${caut[0].text}`));
    const big = sim.crashed ? '' : fd.warningText === 'PULL UP' || fd.warningText === 'STALL' || fd.warningText === 'TERRAIN' ? fd.warningText : '';
    this.warnBig.textContent = big;
    this.warnBig.classList.toggle('hidden', !big);
    this.stallFlash.classList.toggle('hidden', !sim.warnings.stall || sim.crashed);

    // Chips
    clear(this.chips);
    const chip = (label, v) => this.chips.appendChild(el('div.chip.hud-panel', null, label + ' ', el('b', null, v)));
    if (sim.simRate > 1) chip('SIM', `${sim.simRate}×`);
    if (g.paused) chip('', 'PAUSED');
    chip('', fmtTime(g.world.time));
    chip('CAM', (CAMERA_LABELS[g.cameras.mode] || '').toUpperCase());
    if (g.multiplayer.connected) chip('MP', `${g.multiplayer.players.length + 1}`);
    this.renderRadio();

    // Objective
    const ms = g.missions;
    if (ms.kind === 'mission' && ms.mission) {
      const o = this.objective;
      o.classList.remove('hidden');
      o.children[0].textContent = ms.mission.title;
      o.children[1].textContent = ms.currentObjectiveText() || '';
      const tl = ms.mission.timeLimit;
      o.children[2].textContent = tl ? `Time remaining ${fmtDuration(Math.max(0, tl - ms.time))}` : `Elapsed ${fmtDuration(ms.time)}`;
    } else if (ms.kind === 'free' && sim.nav.destination) {
      const o = this.objective;
      const dest = sim.nav.destination;
      const dist = Math.hypot(dest.x - fd.x, dest.z - fd.z) / 1852;
      o.classList.remove('hidden');
      o.children[0].textContent = 'Free flight';
      o.children[1].textContent = `Destination ${dest.icao} ${dest.name}`;
      o.children[2].textContent = `${dist.toFixed(dist < 10 ? 1 : 0)} NM${fd.gs > 30 ? ` · ETE ${fmtDuration((dist / fd.gs) * 3600)}` : ''}`;
    } else this.objective.classList.add('hidden');

    // Data
    const ias = fd.ias,
      alt = fd.alt,
      vs = fd.vs;
    const iasCls = ias > fd.vmax + 2 || (!fd.onGround && ias < fd.vls - 3) ? 'a' : '';
    const D = this.d;
    if (metric) {
      D.ias.set(Math.round(ias * 1.852), 'km/h', iasCls);
      D.alt.set(Math.round(alt * 0.3048).toLocaleString(), 'm');
      D.vs.set(((vs * 0.00508) >= 0 ? '+' : '') + (vs * 0.00508).toFixed(1), 'm/s', vs < -2000 ? 'r' : '');
      D.gs.set(Math.round(fd.gs * 1.852), 'km/h');
    } else {
      D.ias.set(Math.round(ias), 'kt', iasCls);
      D.alt.set(Math.round(alt).toLocaleString(), 'ft');
      D.vs.set((vs >= 0 ? '+' : '') + Math.round(vs / 10) * 10, 'fpm', vs < -2000 && fd.radioAlt < 2500 ? 'r' : '');
      D.gs.set(Math.round(fd.gs), 'kt');
    }
    D.hdg.set(fmtHeading(fd.heading), '°');
    D.mach.set(fd.mach.toFixed(2));
    D.ra.set(fd.radioAlt < 2500 ? (metric ? Math.round(fd.radioAlt * 0.3048) : Math.round(fd.radioAlt)) : '—', fd.radioAlt < 2500 ? (metric ? 'm' : 'ft') : '');
    D.g.set(fd.nz.toFixed(1), '', fd.nz > 4 || fd.nz < -0.5 ? 'a' : 'w');
    const fuelKg = fd.fuel;
    const endur = fd.fuelFlow > 1 ? fuelKg / fd.fuelFlow : Infinity;
    D.fuel.set(fuelKg >= 10000 ? (fuelKg / 1000).toFixed(1) : Math.round(fuelKg), `${fuelKg >= 10000 ? 't' : 'kg'} ${Math.round(fd.fuelFrac * 100)}%`, fd.fuelFrac < 0.08 ? 'a' : 'c');
    D.endur.set(isFinite(endur) ? fmtDuration(endur * 3600).replace(/:\d\d$/, '') : '—', isFinite(endur) ? 'h:m' : '', endur < 0.5 ? 'a' : 'c');
    D.thr.set(Math.round(sim.throttleLever * 100), '%' + (sim.ap.athr ? ' A' : ''), fd.afterburner ? 'a' : 'c');
    D.wind.set(`${fmtHeading(fd.wind.dir)}/${Math.round(fd.wind.kt)}`, 'kt');
    const M = this.m;
    M.ias.set(metric ? Math.round(ias * 1.852) : Math.round(ias), '', iasCls);
    M.alt.set(metric ? Math.round(alt * 0.3048).toLocaleString() : Math.round(alt).toLocaleString(), '');
    M.vs.set(metric ? (vs * 0.00508).toFixed(1) : (vs >= 0 ? '+' : '') + Math.round(vs / 10) * 10, '');
    M.hdg.set(fmtHeading(fd.heading), '');
    M.thr.set(`${Math.round(sim.throttleLever * 100)}%`, '');

    if (gr.fpsCounter) this.fpsNode.textContent = `${Math.round(g.fps)} FPS · ${(g.pixelRatio * 100).toFixed(0)}% res`;
    if (!showDash) return;
    // Systems
    fd.engines.forEach((e, i) => {
      const b = this.engBarEls && this.engBarEls[i];
      if (!b) return;
      const v = p.spec.engine.type === 'piston' ? (e.rpm || 0) / (p.spec.engine.maxRPM || 2700) : e.n1 || 0;
      b.firstChild.style.height = `${Math.max(0, Math.min(1, v)) * 100}%`;
      b.classList.toggle('ab', !!e.afterburner && e.afterburner > 0.1);
      b.classList.toggle('fail', !!e.failed || !!e.fire);
      b.title = `Engine ${i + 1}: ${e.status || (e.running ? 'running' : 'off')}`;
    });
    this.thrBar.firstChild.style.height = `${sim.throttleLever * 100}%`;
    const gearPos = sim.gearPos;
    const transit = gearPos > 0.02 && gearPos < 0.98;
    for (const i of this.gearLights.children) {
      i.className = gearPos >= 0.98 ? 'down' : transit ? 'transit' : '';
    }
    this.sys.flaps.textContent = fd.flapsName;
    this.sys.spoilers.textContent = fd.spoilersArmed ? 'ARMED' : fd.spoilers > 0.02 ? `${Math.round(fd.spoilers * 100)}%` : 'RET';
    this.sys.spoilers.style.color = fd.spoilers > 0.02 ? 'var(--amber)' : fd.spoilersArmed ? 'var(--cyan)' : '';
    this.sys.brakes.textContent = fd.parkingBrake ? 'PARK' : fd.autobrake ? `AUTO ${fd.autobrake === 4 ? 'MAX' : fd.autobrake}` : g.input.axes.brake > 0 ? 'ON' : 'OFF';
    this.sys.brakes.style.color = fd.parkingBrake ? 'var(--amber)' : '';
    this.sys.trim.textContent = `${(sim.fm.controls.trim * 100).toFixed(0)}%`;
    const gd = fd.guidance;
    this.sys.wpt.textContent = gd && gd.valid && gd.wpt ? `${gd.wpt.id} ${(gd.distance / 1852).toFixed(1)} NM` : fd.ils && fd.ils.valid ? `${fd.ils.ident} ${fd.ils.dme ? fd.ils.dme.toFixed(1) : ''}` : '—';
    this.sys.gps.textContent = fmtLatLon(fd.x, fd.z);
    this.refreshAP();
    // Canvases
    if (this.canvasTimer <= 0) {
      this.canvasTimer = 1 / 15;
      const w = this.pfdCanvas.width,
        h = this.pfdCanvas.height;
      try {
        drawPFD(this.pfdCtx, w, h, fd, { compact: true });
        if (this.ndCanvas.offsetParent !== null) drawND(this.ndCtx, w, h, fd, { range: p.cockpit.ndRange });
      } catch (e) {
        if (!this.drawErr) console.error(e);
        this.drawErr = true;
      }
    }
  }
}

export { keyCap, KT, FT };
