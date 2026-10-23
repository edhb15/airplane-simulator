// User interface controller: loading screen, menu screens, in-flight HUD,
// modals (pause, settings, help, crash, debrief), toasts and the world map.

import './styles.css';
import { el, clear, button, stars } from './dom.js';
import { MenuScreens, TIPS, ACTION_INFO } from './MenuScreens.js';
import { FlightHUD } from './FlightHUD.js';
import { MapView } from './MapView.js';
import { WEATHER_PRESETS } from '../world/Weather.js';
import { fmtMoney, fmtDuration, fmtTime } from '../core/format.js';
import { keyCap } from './dom.js';

const WX_LABELS = { clear: 'Clear', fewClouds: 'Few clouds', scattered: 'Scattered', broken: 'Broken', overcast: 'Overcast', rain: 'Rain', thunderstorm: 'Storm', fog: 'Fog', snow: 'Snow' };

export class UIManager {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.screen = null;
    this.modal = null;
    this.chatHistory = [];
    this.screenLayer = el('div.screen-layer');
    this.toasts = el('div#toasts');
    this.loading = el('div#loading', null, el('div.box', null, null));
    root.appendChild(this.screenLayer);
    this.menus = new MenuScreens(this);
    this.hud = new FlightHUD(this);
    root.appendChild(this.hud.root);
    this.map = new MapView(this);
    this.modalLayer = el('div.modal-host');
    root.appendChild(this.modalLayer);
    root.appendChild(this.toasts);
    root.appendChild(this.loading);
    this.buildLoading();
    game.input.on((ev) => {
      if (ev.type === 'gamepad') this.toast(ev.connected ? `Controller connected: ${ev.id.slice(0, 48)}` : 'Controller disconnected', 'info');
    });
    // Number keys for the ATC menu, Escape in menu screens
    window.addEventListener(
      'keydown',
      (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        if (this.hud.atcOpen && game.state === 'flying' && /^(Digit|Numpad)[1-9]$/.test(e.code) && !this.modalOpen) {
          if (this.hud.atcKey(Number(e.code.slice(-1)))) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        } else if (e.code === 'Escape' && game.state === 'menu' && !this.modal && this.screen && this.screen !== 'main') {
          const back = this.screenLayer.firstChild && this.screenLayer.firstChild._back;
          if (back) {
            e.preventDefault();
            back();
          }
        }
      },
      true
    );
    // Play UI hover/click sounds on buttons
    root.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button') && game.audio) {
        game.audio.init();
      }
    });
  }

  // Called by the game once ATC, traffic and multiplayer exist
  bindSystems() {
    const game = this.game;
    this.hud.bindSystems();
    // Multiplayer chat & status
    game.multiplayer.on((ev) => {
      if (ev.type === 'chat') {
        this.chatHistory.push(ev);
        if (this.chatHistory.length > 80) this.chatHistory.shift();
        if (this.menus.mpLog && this.menus.mpLog.isConnected) {
          this.menus.mpLog.appendChild(this.menus.chatLine(ev));
          this.menus.mpLog.scrollTop = this.menus.mpLog.scrollHeight;
        }
        if (game.state === 'flying') this.hud.addChat(ev);
      } else if (ev.type === 'status') this.toast(ev.text, 'info');
    });
  }

  // ------------------------------------------------------------------ loading
  buildLoading() {
    const box = this.loading.firstChild;
    clear(box);
    box.appendChild(this.menus.logo());
    this.loadBar = el('div');
    box.appendChild(el('div.bar', null, this.loadBar));
    this.loadStatus = el('div.status');
    box.appendChild(this.loadStatus);
    this.loadTip = el('div.tip', null, TIPS[Math.floor(Math.random() * TIPS.length)]);
    box.appendChild(this.loadTip);
  }

  showLoading(text, progress) {
    const l = this.loading;
    if (l.classList.contains('hidden') || l.classList.contains('fade')) {
      l.classList.remove('hidden', 'fade');
      l.classList.toggle('overlay', this.game.state !== 'boot');
      this.loadTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    this.loadStatus.textContent = text;
    this.loadBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  hideLoading() {
    const l = this.loading;
    if (l.classList.contains('hidden')) return;
    l.classList.add('fade');
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      if (l.classList.contains('fade')) l.classList.add('hidden');
    }, 650);
  }

  // ------------------------------------------------------------------ screens
  showScreen(name, opts = {}) {
    const g = this.game;
    this.closeModal(true);
    this.map.close();
    this.hud.hide();
    this.hideLoading();
    clear(this.screenLayer);
    this.screen = name;
    if (g.state !== 'flying') g.input.context = 'menu';
    let node;
    switch (name) {
      case 'main':
        node = this.menus.main();
        break;
      case 'freeflight':
        node = this.menus.freeflight(opts);
        break;
      case 'hangar':
        node = this.menus.hangar(opts);
        break;
      case 'career':
        node = this.menus.career(opts);
        break;
      case 'missions':
        node = this.menus.missions(opts);
        break;
      case 'school':
        node = this.menus.school(opts);
        break;
      case 'multiplayer':
        node = this.menus.multiplayer(opts);
        break;
      case 'settings':
        node = this.menus.settingsScreen(opts);
        break;
      case 'exit':
        node = this.menus.exitScreen();
        break;
      default:
        node = this.menus.main();
        this.screen = 'main';
    }
    this.screenLayer.appendChild(node);
    if (name === 'main') {
      // Background map render once the menu is up
      setTimeout(() => this.map.prefetch(), 4000);
      const first = node.querySelector('.menu button');
      if (first) first.focus({ preventScroll: true });
    }
  }

  showFlight() {
    clear(this.screenLayer);
    this.screen = null;
    this.closeModal(true);
    this.hideLoading();
    this.hud.show();
    this.map.resetTrail();
    this.pendingDebrief = null;
  }

  // ------------------------------------------------------------------ modals
  get modalOpen() {
    return !!this.modal || this.map.open;
  }

  openModal(content, opts = {}) {
    this.closeModal(true);
    const layer = el('div.modal-layer' + (opts.cls ? '.' + opts.cls : ''), { style: opts.transparent ? { background: 'transparent', pointerEvents: 'none' } : null }, content);
    if (opts.transparent) content.style.pointerEvents = 'auto';
    this.modalLayer.appendChild(layer);
    this.modal = { layer, onClose: opts.onClose || null, kind: opts.kind || '' };
    if (this.game.state === 'flying') this.game.input.context = 'menu';
    return this.modal;
  }

  // Close the topmost modal (map or dialog). silent: don't run onClose
  closeModal(silent = false) {
    if (!silent && this.map.open && !this.modal) {
      this.map.close();
      return;
    }
    if (!this.modal) return;
    const m = this.modal;
    this.modal = null;
    if (m.layer.parentNode) m.layer.parentNode.removeChild(m.layer);
    if (this.game.state === 'flying' && !this.hud.chatOpen) this.game.input.context = 'flight';
    if (!silent && m.onClose) m.onClose();
  }

  confirm(title, text, onYes, yesLabel = 'Confirm') {
    const prev = this.modal;
    const node = el(
      'div.modal.panel',
      null,
      el('h2', null, title),
      el('p.muted', null, text),
      el(
        'div',
        { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' } },
        button('Cancel', () => this.closeModal(true), 'ghost'),
        button(yesLabel, () => {
          this.closeModal(true);
          onYes();
        }, 'primary')
      )
    );
    void prev;
    this.openModal(node);
  }

  confirmExit() {
    this.confirm('Exit Skyward?', 'Your progress is saved automatically.', () => {
      this.game.audio.stopAllWarnings();
      try {
        window.close();
      } catch {
        /* ignore */
      }
      this.showScreen('exit');
    }, 'Exit');
  }

  // ------------------------------------------------------------------ in-flight overlays
  showPause() {
    const g = this.game;
    const ms = g.missions;
    const title = ms.mission ? ms.mission.title : 'Free Flight';
    const node = el(
      'div.modal.panel.pause-menu',
      null,
      el('h2', null, 'Paused'),
      el('div.muted', { style: { marginTop: '-8px', marginBottom: '16px' } }, title),
      button('▶  Resume', () => this.closeModal()),
      button('🗺  Map & flight plan', () => {
        this.closeModal();
        this.toggleMap();
      }),
      ms.kind === 'free' ? button('☁  Weather & time', () => this.conditionsPanel()) : null,
      button('⚙  Settings', () => this.openSettings()),
      button('⌨  Controls', () => this.toggleHelp()),
      button('↻  Restart flight', () => {
        this.closeModal(true);
        g.restartFlight();
      }),
      button(ms.kind === 'free' ? '✓  End flight' : '✕  Abandon mission', () => {
        this.closeModal(true);
        g.setPaused(false);
        g.endFlight(true);
      }),
      button('⌂  Main menu', () => {
        this.closeModal(true);
        g.setPaused(false);
        g.toMenu();
      })
    );
    this.openModal(node, { kind: 'pause', onClose: () => g.setPaused(false) });
  }

  hidePause() {
    if (this.modal && this.modal.kind === 'pause') this.closeModal(true);
  }

  openSettings() {
    const node = this.menus.settingsScreen({ inFlight: true });
    node.classList.add('panel');
    node.style.inset = '3vh 4vw';
    node.style.position = 'absolute';
    node.style.background = 'rgba(5,11,20,0.96)';
    node.style.borderRadius = '12px';
    this.openModal(node, { kind: 'settings', onClose: () => this.game.paused && this.showPause() });
  }

  conditionsPanel() {
    const g = this.game;
    const w = g.weather;
    const seg = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0 14px' } });
    for (const k of Object.keys(WEATHER_PRESETS))
      seg.appendChild(
        button(WX_LABELS[k] || k, () => {
          w.transitionTo(k, 20, g.player ? g.player.position : null);
          this.toast(`Weather changing to ${WX_LABELS[k] || k}`, 'info');
        }, 'small' + (w.preset === k ? ' primary' : ''))
      );
    const timeOut = el('output.mono', null, fmtTime(g.world.time));
    const timeIn = el('input', { type: 'range', min: 0, max: 23.75, step: 0.25 });
    timeIn.value = g.world.time;
    timeIn.addEventListener('input', () => {
      g.world.time = Number(timeIn.value);
      timeOut.textContent = fmtTime(g.world.time);
    });
    const windDir = el('input', { type: 'range', min: 0, max: 350, step: 10 });
    windDir.value = Math.round(w.state.windDir / 10) * 10;
    const windSpd = el('input', { type: 'range', min: 0, max: 25, step: 1 });
    windSpd.value = Math.round(w.state.windSpeed);
    const windOut = el('output.mono');
    const upd = () => {
      windOut.textContent = `${String(Number(windDir.value) || 360).padStart(3, '0')}° / ${Math.round(Number(windSpd.value) * 1.944)} kt`;
      w.setWind(Number(windDir.value), Number(windSpd.value));
    };
    windDir.addEventListener('input', upd);
    windSpd.addEventListener('input', upd);
    windOut.textContent = `${String(Number(windDir.value) || 360).padStart(3, '0')}° / ${Math.round(Number(windSpd.value) * 1.944)} kt`;
    const rate = el('div', { style: { display: 'flex', gap: '6px' } });
    for (const r of [0, 1, 10, 60]) rate.appendChild(button(r === 0 ? 'Frozen' : r === 1 ? 'Real time' : `${r}×`, () => ((g.world.timeRate = r), this.toast(`Time flow ${r === 0 ? 'frozen' : r + '×'}`, 'info', 1200)), 'small'));
    const node = el(
      'div.modal.panel',
      null,
      el('h2', null, 'Weather & Time'),
      el('div.section-title', null, 'Weather'),
      seg,
      el('div.section-title', null, 'Time of day'),
      el('div.slider', null, timeIn, timeOut),
      el('div', { style: { marginTop: '8px' } }, rate),
      el('div.section-title', null, 'Wind'),
      el('div.slider', null, windDir, windSpd, windOut),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px' } }, button('Done', () => this.closeModal(), 'primary'))
    );
    this.openModal(node, { kind: 'conditions', onClose: () => this.game.paused && this.showPause() });
  }

  toggleHelp() {
    if (this.modal && this.modal.kind === 'help') return this.closeModal();
    const b = this.game.settings.get('controls').bindings;
    const grid = el('div.help-grid');
    for (const [action, [label]] of Object.entries(ACTION_INFO)) {
      const keys = (b[action] || []).slice(0, 2);
      if (!keys.length) continue;
      grid.appendChild(el('div.h', null, el('span', null, label), el('span', null, ...keys.map((k) => el('kbd', null, keyCap(k))))));
    }
    const node = el(
      'div.modal.panel.wide',
      { style: { height: 'auto' } },
      el('h2', null, 'Flight controls'),
      el('div.scroll', { style: { flex: '1', minHeight: '0' } }, grid,
        el('p.muted', { style: { fontSize: '13px', marginTop: '14px' } }, 'Mouse: right-drag to look around, wheel to zoom. In the cockpit, click switches/buttons/levers and scroll over knobs. Gamepads and joysticks are detected automatically — see Settings → Controls.')),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } }, button('Close', () => this.closeModal(), 'primary'))
    );
    const wasPause = this.modal && this.modal.kind === 'pause';
    this.openModal(node, { kind: 'help', onClose: () => wasPause && this.game.paused && this.showPause() });
  }

  toggleMap() {
    if (this.modal) return;
    this.map.toggle();
  }
  toggleATC() {
    if (this.modalOpen) return;
    this.hud.toggleATC();
  }
  openChat() {
    if (this.modalOpen) return;
    this.hud.openChat();
  }
  cycleHud() {
    this.hud.cycleHud();
  }
  cameraLabel(mode) {
    this.hud.cameraLabel(mode);
  }
  tutorialStep(step, index, total) {
    this.hud.tutorialStep(step, index, total);
  }
  showLandingRate(fpm, td) {
    this.hud.showLandingRate(fpm, td);
  }

  showCrash(reason) {
    const g = this.game;
    this.map.close();
    this.hud.closeATC();
    const hasDebrief = !!this.pendingDebrief;
    const node = el(
      'div',
      { style: { textAlign: 'center' } },
      el('h1', null, 'CRASH'),
      el('p', { style: { fontSize: '18px', color: '#ffd0d0', marginTop: '6px' } }, reason || 'The aircraft was destroyed'),
      el(
        'div',
        { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '26px' } },
        button('↻ Retry', () => {
          this.closeModal(true);
          g.restartFlight();
        }, 'primary'),
        hasDebrief
          ? button('Debrief', () => this.flushDebrief())
          : button('End flight', () => {
              this.closeModal(true);
              g.endFlight(true);
            }),
        button('Main menu', () => {
          this.closeModal(true);
          g.toMenu();
        }),
        hasDebrief ? null : button('Look around', () => this.closeModal(true), 'ghost')
      )
    );
    this.crashShownFor = g.player;
    this.openModal(node, { kind: 'crash', cls: 'crash-overlay', onClose: () => this.pendingDebrief && this.flushDebrief() });
    if (hasDebrief) {
      clearTimeout(this.debriefTimer);
      this.debriefTimer = setTimeout(() => this.flushDebrief(), 5000);
    }
  }

  flushDebrief() {
    clearTimeout(this.debriefTimer);
    const r = this.pendingDebrief;
    this.pendingDebrief = null;
    if (r) this.renderDebrief(r);
  }

  showDebrief(result) {
    const p = this.game.player;
    this.map.close();
    this.hud.closeATC();
    this.hud.closeChat();
    if (p && p.sim.crashed && this.crashShownFor !== p) {
      // Let the crash overlay show first (Game calls showCrash right after)
      this.pendingDebrief = result;
      return;
    }
    this.renderDebrief(result);
  }

  renderDebrief(r) {
    const g = this.game;
    this.closeModal(true);
    this.hud.hide();
    const ok = r.success;
    const panel = el('div.panel.scroll');
    panel.appendChild(el('div.result.' + (ok ? 'ok' : 'fail'), null, ok ? (r.kind === 'free' ? 'Flight complete' : r.kind === 'tutorial' ? 'Lesson passed' : 'Mission complete') : r.kind === 'free' ? 'Flight ended' : 'Mission failed'));
    panel.appendChild(el('h2', null, r.title));
    if (r.reason) panel.appendChild(el('div.muted', { style: { marginTop: '4px' } }, r.reason));
    if (r.rankUp) panel.appendChild(el('div.rankup', { style: { marginTop: '14px' } }, `${r.rankUp.badge} Promotion! You are now a ${r.rankUp.name}. New aircraft may be available in the hangar.`));
    if (r.score !== null && r.score !== undefined && ok) {
      panel.appendChild(el('div.score', null, el('div.big', null, r.score), el('div', null, stars(r.stars), el('div.muted', { style: { fontSize: '12px' } }, 'Score out of 100'))));
      if (r.parts && r.parts.length) {
        const parts = el('div.parts');
        for (const pt of r.parts) parts.appendChild(el('div.pt', null, el('span', null, pt.name), el('div.bar', null, el('div', { style: { width: `${Math.max(0, Math.min(100, pt.value))}%` } })), el('span.mono', { style: { textAlign: 'right' } }, pt.value), el('small', null, pt.detail || '')));
        panel.appendChild(parts);
      }
    }
    const td = r.touchdown;
    const st = r.stats || {};
    const rewards = el('div.rewards');
    const box = (label, v, color = null) => rewards.appendChild(el('div', null, el('span', null, label), el('b', { style: color ? { color } : null }, v)));
    box('Flight time', fmtDuration(r.duration || 0));
    box('Distance', `${Math.round(r.distanceNm || 0)} NM`);
    if (td) box('Landing rate', `${Math.round(td.fpm)} fpm`, Math.abs(td.fpm) < 200 ? 'var(--green-soft)' : Math.abs(td.fpm) < 450 ? 'var(--accent-2)' : 'var(--red)');
    if (st.maxG) box('Max G', st.maxG.toFixed(1));
    box('Credits', r.credits ? `${r.credits > 0 ? '+' : ''}${fmtMoney(r.credits)}` : '—', r.credits < 0 ? 'var(--red)' : 'var(--accent-2)');
    box('Experience', `+${r.xp || 0} XP`, 'var(--cyan)');
    panel.appendChild(rewards);
    const prof = g.profile;
    panel.appendChild(el('div.muted', { style: { fontSize: '13px' } }, `${prof.rank.badge} ${prof.rank.name} · ${prof.data.xp.toLocaleString()} XP · Balance ${fmtMoney(prof.data.credits)}`));
    const back = r.job ? 'career' : r.kind === 'mission' ? 'missions' : r.kind === 'tutorial' ? 'school' : 'main';
    const backLabel = { career: 'Job board', missions: 'Missions', school: 'Flight school', main: 'Main menu' }[back];
    panel.appendChild(
      el(
        'div',
        { style: { display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end', flexWrap: 'wrap' } },
        button(ok ? 'Fly again' : 'Retry', () => g.restartFlight()),
        button(backLabel, () => {
          g.toMenu();
          if (back !== 'main') this.showScreen(back);
        }, 'primary')
      )
    );
    clear(this.screenLayer);
    this.screenLayer.appendChild(el('div.screen.debrief', null, panel));
    this.screen = 'debrief';
  }

  // ------------------------------------------------------------------ toasts
  toast(text, level = 'info', ms = 3200) {
    if (!text) return;
    const last = this.toasts.lastChild;
    if (last && last.textContent === text && !last.classList.contains('out')) {
      clearTimeout(last._t);
      last._t = setTimeout(() => this.removeToast(last), ms);
      return;
    }
    const t = el('div.toast.' + level, null, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.removeChild(this.toasts.firstChild);
    t._t = setTimeout(() => this.removeToast(t), ms);
  }

  removeToast(t) {
    t.classList.add('out');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 420);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (this.game.state === 'flying') {
      this.hud.update(dt);
      this.map.update(dt);
    }
  }
}
