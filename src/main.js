// Entry point: checks WebGL support, connects to the web portal (if any) and
// boots the game.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/b612-mono/latin-400.css';
import '@fontsource/b612-mono/latin-700.css';
import { Game } from './core/Game.js';
import { platform } from './platform/platform.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

// Keep arrow keys, Space and Page Up/Down from scrolling the page that embeds
// the game (portals show it in an iframe). Form fields keep their keys.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);
window.addEventListener('keydown', (e) => {
  if (!SCROLL_KEYS.has(e.code)) return;
  const t = e.target;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  if (tag === 'BUTTON' && (e.code === 'Space')) return;
  e.preventDefault();
});
window.addEventListener('wheel', (e) => {
  if (e.target === document.body || e.target === document.documentElement) e.preventDefault();
}, { passive: false });

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui-root');

async function boot() {
  await platform.init();
  platform.loadingStart();
  const game = new Game(canvas, uiRoot);
  await game.init();
}

function removeBoot() {
  const boot = document.getElementById('boot');
  if (boot) boot.remove();
}

if (!webglAvailable()) {
  removeBoot();
  uiRoot.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:sans-serif;color:#e6eef8;background:#050b14;pointer-events:auto"><div><h1>WebGL 2 is not available</h1><p>Skyward needs a browser with WebGL 2 and hardware acceleration enabled (Chrome, Edge, Firefox or Safari 15+).</p></div></div>';
} else {
  boot().catch((e) => {
    console.error(e);
    platform.loadingStop();
    // Still on the boot screen (failed before the game UI existed): report it there
    if (document.getElementById('boot') && window.__bootError) window.__bootError(`Failed to start: ${e && e.message ? e.message : e}`);
    uiRoot.insertAdjacentHTML('beforeend', `<div style="position:fixed;left:16px;bottom:16px;max-width:520px;padding:12px 16px;background:#3a0b0b;color:#ffd0d0;border:1px solid #ff6b6b;border-radius:8px;font-family:sans-serif;pointer-events:auto;z-index:100">Failed to start: ${String(e && e.message ? e.message : e).replace(/</g, '&lt;')}</div>`);
  });
}
