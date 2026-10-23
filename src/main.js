// Entry point: checks WebGL support and boots the game.
import { Game } from './core/Game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui-root');

if (!webglAvailable()) {
  uiRoot.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:sans-serif;color:#e6eef8;background:#050b14;pointer-events:auto"><div><h1>WebGL 2 is not available</h1><p>Skyward needs a browser with WebGL 2 and hardware acceleration enabled (Chrome, Edge, Firefox or Safari 15+).</p></div></div>';
} else {
  const game = new Game(canvas, uiRoot);
  game.init().catch((e) => {
    console.error(e);
    uiRoot.insertAdjacentHTML('beforeend', `<div style="position:fixed;left:16px;bottom:16px;max-width:520px;padding:12px 16px;background:#3a0b0b;color:#ffd0d0;border:1px solid #ff6b6b;border-radius:8px;font-family:sans-serif;pointer-events:auto;z-index:100">Failed to start: ${String(e && e.message ? e.message : e).replace(/</g, '&lt;')}</div>`);
  });
}
