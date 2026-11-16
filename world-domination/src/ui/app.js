// Game controller: loop, HUD, input, toasts and modal plumbing.
import { WorldMap } from './map.js';
import { MAP_MODES, colorFor, legendFor, computeLabels, drawOverlay } from './mapmodes.js';
import { esc, money, num, pct, flag, h } from './fmt.js';
import { TERR } from '../engine/world.js';
import { GOVS } from '../data/people.js';
import { RESOURCES, RES_KEYS, manpowerCap, refreshStats } from '../engine/economy.js';
import { advanceDay, domination } from '../engine/sim.js';
import { updatePower } from '../engine/military.js';
import { fmtDate, owned, warsOf, refreshMonthly, markDirty, leaderTitle } from '../engine/state.js';
import { saveGame } from '../engine/save.js';
import { renderPanel, TABS } from './panels.js';
import { renderCountry } from './country.js';
import { showPending, showOutcome } from './dialogs.js';
import { app, on, handlers, toast, modal, closeModal, hooks } from './core.js';
export { app, on, toast, modal, closeModal };

const SPEEDS = [0, 1.5, 4, 10, 25, 60];

// ---------- Boot ----------
export function initApp() {
  hooks.refreshAll = refreshAll;
  hooks.select = select;
  hooks.setSpeed = setSpeed;
  hooks.renderHud = renderHud;
  hooks.updateNewsTicker = updateNewsTicker;
  hooks.startGame = startGame;
  hooks.refreshMap = () => updateMapData();
  const canvas = document.getElementById('map');
  app.map = new WorldMap(canvas);
  app.map.colorFn = (tid) => (app.s ? colorFor(app.s, app.mapMode, tid, { resource: app.resource }) : '#3a4250');
  app.map.overlay = (ctx, map, px, time) => { if (app.s && app.screen === 'game') drawOverlay(app.s, ctx, map, px, time); };
  app.map.on('click', (tid) => onMapClick(tid));
  app.map.on('hover', (tid, x, y) => showMapTooltip(tid, x, y));
  app.map.on('rightclick', (tid) => { if (tid && app.screen === 'game') { select(tid); openCountryTab('war'); } });

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) app.dragging = true; });
  document.addEventListener('pointerup', () => { app.dragging = false; });

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    tick(dt);
    app.map.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- Main loop ----------
function tick(dt) {
  const s = app.s;
  if (!s || app.screen !== 'game') return;
  if (app.speed > 0 && !app.modalOpen && !s.outcome) {
    app.acc += dt * SPEEDS[app.speed];
    let steps = 0;
    const t0 = performance.now();
    while (app.acc >= 1 && steps < 30 && performance.now() - t0 < 40) {
      app.acc -= 1;
      steps++;
      advanceDay(s);
      if (s.pending.length && app.settings.pauseOnEvents) { app.acc = 0; break; }
      if (s.outcome) break;
    }
    if (app.acc > 3) app.acc = 3;
    if (steps) onDaysAdvanced();
  }
  if (!app.modalOpen) {
    if (s.outcome && !s.outcomeShown) { s.outcomeShown = true; setSpeed(0); showOutcome(app); }
    else if (s.pending.length) showPending(app);
  }
  flushAlerts();
}

function onDaysAdvanced() {
  const s = app.s;
  const month = Math.floor(s.day / 30);
  renderHud();
  if (month !== app.lastMonth) {
    app.lastMonth = month;
    refreshAll(false);
    if (app.settings.autosave && s.day % 360 === 0 && s.day > 0 && !s.outcome) saveGame(s, 'autosave', 'Autosave');
  } else if (s.dirty !== app.lastDirty) {
    app.lastDirty = s.dirty;
    updateMapData();
  }
}

export function refreshAll(force = true) {
  if (!app.s) return;
  if (force) refreshMonthly(app.s);
  updateMapData();
  renderHud();
  if (!app.dragging) {
    renderPanel(app);
    renderCountry(app);
  }
  renderLegend();
  updateNewsTicker();
}

export function updateMapData() {
  const s = app.s;
  const owners = {};
  for (const id of Object.keys(s.terr)) owners[id] = s.terr[id].owner;
  if (app.map.ownerRev !== s.rev) {
    app.map.updateOwners(owners, s.rev);
    app.map.setLabels(computeLabels(s, app.map));
  }
  // highlight the player's realm border lightly in non-political modes
  app.map.highlight = null;
  if (app.selected && app.mapMode === 'political') {
    const o = s.terr[app.selected].owner;
    app.map.highlight = owned(s, o);
    app.map.highlightColor = 'rgba(255,230,140,0.55)';
  }
  app.map.showLabels = app.settings.labels;
  app.map.needsDraw = true;
}

// ---------- Speed ----------
export function setSpeed(v) {
  if (v > 0) app.lastSpeed = v;
  app.speed = v;
  renderHud();
}
export function togglePause() { setSpeed(app.speed ? 0 : app.lastSpeed || 2); }

// ---------- HUD ----------
export function renderHud() {
  const s = app.s;
  const el = document.getElementById('hud');
  if (!s || app.screen !== 'game') { el.innerHTML = ''; return; }
  const P = s.nations[s.player];
  const b = P.stats.budget || { balance: 0 };
  const d = domination(s);
  const cap = manpowerCap(s, s.player);
  const warCount = warsOf(s, s.player).length;
  const stat = (icon, label, value, cls = '', tip = '', tab = '') =>
    `<button class="stat ${cls}" title="${esc(tip)}" ${tab ? `data-act="tab" data-tab="${tab}"` : ''}><span class="si">${icon}</span><span class="sv"><small>${label}</small><b>${value}</b></span></button>`;
  el.innerHTML = `
    <button class="nation-chip" data-act="tab" data-tab="nation" title="Your nation">
      ${flag(P)}<span><b>${esc(P.name)}</b><small>${esc(leaderTitle(P))} ${esc(P.leader.name)}</small></span>
    </button>
    <div class="stats">
      ${stat('💰', 'Treasury', money(P.treasury), P.treasury < 1 ? 'warn' : '', 'Money available for building, recruiting and diplomacy', 'economy')}
      ${stat('📊', 'Monthly', money(b.balance / 12, true), b.balance < 0 ? 'bad' : 'good', 'Monthly budget balance', 'economy')}
      ${stat('🏭', 'GDP', money(P.stats.gdp || 0), '', 'Gross domestic product per year', 'economy')}
      ${stat('🎖️', 'Political', Math.floor(P.pc), '', 'Political capital — spent on diplomacy, espionage and reforms', 'nation')}
      ${stat('⚖️', 'Stability', Math.round(P.stability) + '%', P.stability < 30 ? 'bad' : P.stability < 45 ? 'warn' : '', 'Below 20% revolutions become likely', 'nation')}
      ${stat('🪖', 'Army', `${num(P.army, 0)}<small>/${num(cap, 0)}</small>`, '', 'Divisions / manpower cap', 'military')}
      ${stat('☠️', 'Infamy', Math.round(P.infamy), P.infamy > 50 ? 'bad' : P.infamy > 25 ? 'warn' : '', 'Aggressive expansion — high infamy creates coalitions against you', 'nation')}
      ${stat('🌍', 'Domination', pct(d.terr, 1), 'dom', `${d.terrCount} of ${d.total} territories • ${pct(d.pop, 1)} of world population • ${pct(d.gdp, 1)} of world GDP`, 'world')}
      ${warCount ? stat('⚔️', 'Wars', warCount, 'bad', 'Active wars', 'wars') : ''}
    </div>
    <div class="clock">
      <div class="date">${fmtDate(s)}</div>
      <div class="speeds">
        <button data-act="pause" class="${app.speed === 0 ? 'on' : ''}" title="Pause (Space)">⏸</button>
        ${[1, 2, 3, 4, 5].map((v) => `<button data-act="speed" data-v="${v}" class="${app.speed === v ? 'on' : ''}" title="Speed ${v} (${v})">${v}</button>`).join('')}
      </div>
    </div>
    <button class="menu-btn" data-act="tab" data-tab="menu" title="Menu (Esc)">☰</button>`;
}

function renderLegend() {
  const el = document.getElementById('mapmodes');
  if (!app.s || app.screen !== 'game') { el.innerHTML = ''; return; }
  const legend = legendFor(app.s, app.mapMode, { resource: app.resource });
  el.innerHTML = `
    <div class="modes">${Object.entries(MAP_MODES).map(([k, m]) => `<button data-act="mapmode" data-mode="${k}" class="${app.mapMode === k ? 'on' : ''}" title="${m.name} (${m.key})">${m.icon}<span>${m.name}</span></button>`).join('')}</div>
    ${app.mapMode === 'resources' ? `<div class="res-pick">${RES_KEYS.map((r) => `<button data-act="resource" data-r="${r}" class="${app.resource === r ? 'on' : ''}" title="${RESOURCES[r].name}">${RESOURCES[r].icon}</button>`).join('')}</div>` : ''}
    ${legend.length ? `<div class="legend">${legend.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>` : ''}`;
}

// ---------- Tooltip ----------
function showMapTooltip(tid, x, y) {
  const tip = document.getElementById('maptip');
  if (!tid || !app.s) { tip.hidden = true; return; }
  const s = app.s, t = s.terr[tid], n = s.nations[t.owner];
  const occ = t.ctrl !== t.owner ? `<div class="bad">Occupied by ${esc(s.nations[t.ctrl]?.name)}</div>` : '';
  const sub = n.overlord ? `<div class="muted">Subject of ${esc(s.nations[n.overlord].name)}</div>` : '';
  const terrName = TERR[tid].name !== n.name ? `<div class="muted">${esc(TERR[tid].name)}</div>` : '';
  tip.innerHTML = `<b>${flag(n)} ${esc(n.name)}</b>${terrName}${sub}${occ}<div class="muted">${GOVS[n.gov].name} • GDP ${money(n.stats.gdp || 0)} • ⚔ ${num(n.stats.power || 0)}</div>`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
  tip.style.top = Math.min(window.innerHeight - r.height - 8, y + 14) + 'px';
}

// ---------- Selection ----------
export function select(tid, fly = false) {
  app.selected = tid;
  app.map.selected = tid;
  app.map.needsDraw = true;
  document.body.classList.toggle('has-country', !!tid);
  if (fly && tid) {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const narrow = window.innerWidth < 760;
    app.map.insets = narrow ? { left: 0, right: 0 } : { left: (app.tab ? (r('#panel')?.right || 0) : (r('#nav')?.right || 0)), right: r('#country')?.width || 390 };
    app.map.flyTo(tid);
  }
  updateMapData();
  renderCountry(app);
}
export function openCountryTab(tab) {
  app.countryTab = tab;
  renderCountry(app);
}

function onMapClick(tid) {
  if (app.screen === 'setup') { app.onSetupPick?.(tid); return; }
  if (app.screen !== 'game') return;
  if (!tid) { select(null); return; }
  select(tid);
}

function flushAlerts() {
  const s = app.s;
  if (!s?.alerts?.length) return;
  const list = s.alerts.splice(0, s.alerts.length);
  for (const a of list.slice(-4)) toast(a.text, a.type === 'milestone' ? 'milestone' : a.type);
  updateNewsTicker();
}

export function updateNewsTicker() {
  const s = app.s;
  const el = document.getElementById('ticker');
  if (!s) { el.innerHTML = ''; return; }
  const items = s.news.slice(0, 12);
  el.innerHTML = `<button class="news-open" data-act="tab" data-tab="news" title="News archive">📰 NEWS</button><div class="ticker-track">${items.map((n) => `<span class="ni ${n.type}">${esc(fmtDate(s, n.day))} — ${esc(n.text)}</span>`).join('')}</div>`;
}

// ---------- Input ----------

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (handlers[act]) { handlers[act](el.dataset, el, e); return; }
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.input && handlers['input:' + el.dataset.input]) handlers['input:' + el.dataset.input](el.value, el, false);
}
function onChange(e) {
  const el = e.target;
  if (el.dataset.input && handlers['input:' + el.dataset.input]) handlers['input:' + el.dataset.input](el.value, el, true);
}
function onKey(e) {
  if (e.target.matches('input[type=text],input[type=search],textarea,select')) return;
  if (app.screen !== 'game') return;
  if (e.key === 'Escape') {
    if (app.modalOpen) { if (!document.querySelector('#modal .x')) return; closeModal(); return; }
    if (app.tab) { app.tab = null; renderPanel(app); return; }
    if (app.selected) { select(null); return; }
    app.tab = 'menu'; renderPanel(app); return;
  }
  if (app.modalOpen) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
  if (/^[1-5]$/.test(e.key)) { setSpeed(+e.key); return; }
  if (e.key === '+' || e.key === '=') { setSpeed(Math.min(5, app.speed + 1)); return; }
  if (e.key === '-') { setSpeed(Math.max(0, app.speed - 1)); return; }
  const mm = Object.entries(MAP_MODES).find(([, m]) => m.key.toLowerCase() === e.key.toLowerCase());
  if (mm) { app.mapMode = mm[0]; refreshAll(false); return; }
  const tab = TABS.find((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase());
  if (tab) { app.tab = app.tab === tab.id ? null : tab.id; renderPanel(app); return; }
  if (e.key === 'h' || e.key === 'H') { const cap = app.s.nations[app.s.player].capital; if (cap) select(cap, true); }
}

// Generic handlers
on('close-modal', () => closeModal());
on('pause', () => togglePause());
on('speed', (d) => setSpeed(+d.v));
on('mapmode', (d) => { app.mapMode = d.mode; refreshAll(false); });
on('resource', (d) => { app.resource = d.r; refreshAll(false); });
on('tab', (d) => { app.tab = app.tab === d.tab ? null : d.tab; renderPanel(app); });
on('close-panel', () => { app.tab = null; renderPanel(app); });
on('select', (d) => select(d.t, true));
on('select-nation', (d) => { const n = app.s.nations[d.n]; const t = n?.capital && app.s.terr[n.capital]?.owner === d.n ? n.capital : owned(app.s, d.n)[0]; if (t) select(t, true); });
on('close-country', () => select(null));
on('ctab', (d) => openCountryTab(d.t));

export function startGame(s, opts = {}) {
  app.s = s;
  app.screen = 'game';
  app.tab = null;
  app.selected = null;
  app.lastMonth = -1;
  app.map.autoPan = false;
  document.body.classList.remove('menu-mode', 'setup-mode');
  document.body.classList.add('game-mode');
  document.getElementById('screen').innerHTML = '';
  document.getElementById('screen').hidden = true;
  refreshStats(s);
  updatePower(s);
  app.map.resize();
  setSpeed(0);
  refreshAll(true);
  updateNewsTicker();
  const cap = s.nations[s.player].capital;
  if (cap) select(cap, true);
  if (opts.intro) opts.intro();
}
