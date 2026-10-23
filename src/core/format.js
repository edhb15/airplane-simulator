// Unit formatting helpers.
import { WORLD } from '../world/worldData.js';

export function pad(n, w = 2) {
  return String(Math.floor(n)).padStart(w, '0');
}

export function fmtHeading(deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return pad(d === 0 ? 360 : d, 3);
}

export function fmtTime(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${pad(h)}:${pad(m)}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtDistance(m, units = 'aviation') {
  if (units === 'metric') return m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
  const nm = m / 1852;
  return nm < 10 ? `${nm.toFixed(1)} NM` : `${Math.round(nm)} NM`;
}

export function fmtSpeed(kt, units = 'aviation') {
  return units === 'metric' ? `${Math.round(kt * 1.852)} km/h` : `${Math.round(kt)} kt`;
}

export function fmtAlt(ft, units = 'aviation') {
  return units === 'metric' ? `${Math.round(ft * 0.3048)} m` : `${Math.round(ft).toLocaleString('en-US')} ft`;
}

export function fmtMass(kg) {
  return kg >= 10000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg).toLocaleString('en-US')} kg`;
}

export function fmtMoney(v) {
  return `₳ ${Math.round(v).toLocaleString('en-US')}`;
}

export function toLatLon(x, z) {
  const lat = WORLD.originLat - z / 111320;
  const lon = WORLD.originLon + x / (111320 * Math.cos((WORLD.originLat * Math.PI) / 180));
  return { lat, lon };
}

export function fmtLatLon(x, z) {
  const { lat, lon } = toLatLon(x, z);
  const f = (v, p, n) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${v >= 0 ? p : n}${d}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
