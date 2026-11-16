// Shared UI state, the action registry and toast/modal helpers.
import { esc, h } from './fmt.js';
import { markDirty } from '../engine/state.js';

export const app = {
  s: null,
  map: null,
  screen: 'menu',
  tab: null,
  selected: null,
  mapMode: 'political',
  resource: 'oil',
  speed: 0,
  lastSpeed: 2,
  acc: 0,
  lastMonth: -1,
  lastDirty: -1,
  modalOpen: false,
  dragging: false,
  settings: loadSettings(),
};
window.WD = app; // handy for debugging in the console

function loadSettings() {
  try { return { labels: true, autosave: true, pauseOnEvents: true, ...JSON.parse(localStorage.getItem('wd-settings') || '{}') }; } catch { return { labels: true, autosave: true, pauseOnEvents: true }; }
}
export function saveSettings() {
  try { localStorage.setItem('wd-settings', JSON.stringify(app.settings)); } catch { /* ignore */ }
}


export const handlers = {};
export function on(act, fn) { handlers[act] = fn; }
// Filled in by app.js to break import cycles
export const hooks = {};

// ---------- Toasts ----------
export function toast(text, type = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  const el = h(`<div class="toast ${type}">${esc(text)}</div>`);
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
export function result(r) {
  if (!r) return r;
  if (r.msg) toast(r.msg, r.ok ? 'good' : 'bad');
  markDirty(app.s);
  hooks.refreshAll(true);
  return r;
}
// ---------- Modal ----------
export function modal(html, opts = {}) {
  const box = document.getElementById('modal');
  box.innerHTML = `<div class="modal-card ${opts.wide ? 'wide' : ''}">${opts.dismissible !== false ? '<button class="x" data-act="close-modal" aria-label="Close">✕</button>' : ''}${html}</div>`;
  box.hidden = false;
  app.modalOpen = true;
  app.modalOnClose = opts.onClose || null;
  return box.firstElementChild;
}
export function closeModal() {
  const box = document.getElementById('modal');
  box.hidden = true;
  box.innerHTML = '';
  app.modalOpen = false;
  const fn = app.modalOnClose;
  app.modalOnClose = null;
  if (fn) fn();
}

