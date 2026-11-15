// Safe storage wrapper. Uses the portal's cloud save (CrazyGames data module)
// when available, otherwise localStorage (which can be unavailable in private
// modes). Writes go to both so progress survives either one going away.
import { platform } from '../platform/platform.js';

function readRaw(key) {
  const ps = platform.storage;
  if (ps) {
    try {
      const v = ps.getItem(key);
      if (v !== null && v !== undefined) return v;
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function load(key, fallback) {
  try {
    const raw = readRaw(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  let ok = false;
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  const ps = platform.storage;
  if (ps) {
    try {
      ps.setItem(key, raw);
      ok = true;
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(key, raw);
    ok = true;
  } catch {
    /* ignore */
  }
  return ok;
}
