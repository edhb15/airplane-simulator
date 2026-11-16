// Formatting helpers and tiny DOM utilities.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function money(b, signed = false) {
  const sign = b < 0 ? '−' : signed ? '+' : '';
  const a = Math.abs(b);
  const v = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 1 : 2)}T` : a >= 1 ? `$${a.toFixed(a >= 100 ? 0 : 1)}B` : `$${Math.round(a * 1000)}M`;
  return sign + v;
}
export function num(x, d = 0) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (x / 1e3).toFixed(1) + 'k';
  return x.toFixed(d);
}
export function pop(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)}B`;
  if (m >= 1) return `${m.toFixed(1)}M`;
  return `${Math.round(m * 1000)}k`;
}
export const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
export const signed = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

export function bar(value, max = 100, color = 'var(--accent)', label = '') {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar" title="${esc(label)}"><i style="width:${w}%;background:${color}"></i><span>${esc(label)}</span></div>`;
}

export function flag(n) {
  if (!n) return '';
  return `<i class="flag" style="--c:${n.color}">${n.flag ? `<b>${n.flag}</b>` : ''}</i>`;
}

export function opinionColor(v) {
  if (v >= 50) return '#3fb950';
  if (v >= 15) return '#8bc34a';
  if (v > -15) return '#c9d1d9';
  if (v > -50) return '#f0883e';
  return '#f85149';
}

export function mixColor(hex, other, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const a = p(hex), b = p(other);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

export function scale(t, stops) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(t * n));
  return mixColor(stops[i], stops[i + 1], t * n - i);
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
