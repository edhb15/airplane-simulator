// Minimal canvas line chart.
export function lineChart(canvas, series, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 360, hgt = canvas.clientHeight || 160;
  canvas.width = w * dpr; canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const pad = { l: 46, r: 10, t: 10, b: 20 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    ctx.fillStyle = '#8b949e'; ctx.font = '12px sans-serif'; ctx.fillText('Not enough history yet — check back in a few months', 8, hgt / 2);
    return;
  }
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = opts.zero === false ? Math.min(...ys) : Math.min(0, ...ys), ymax = Math.max(...ys);
  if (ymax === ymin) ymax = ymin + 1;
  const X = (x) => pad.l + ((x - xmin) / Math.max(1, xmax - xmin)) * (w - pad.l - pad.r);
  const Y = (y) => hgt - pad.b - ((y - ymin) / (ymax - ymin)) * (hgt - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(139,148,158,0.18)';
  ctx.fillStyle = '#8b949e';
  ctx.font = '10px "Barlow", sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = ymin + ((ymax - ymin) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(w - pad.r, Y(y)); ctx.stroke();
    ctx.fillText(opts.fmt ? opts.fmt(y) : String(Math.round(y)), 2, Y(y) + 3);
  }
  if (opts.xfmt) {
    ctx.fillText(opts.xfmt(xmin), pad.l, hgt - 5);
    const t = opts.xfmt(xmax);
    ctx.fillText(t, w - pad.r - ctx.measureText(t).width, hgt - 5);
  }
  for (const s of series) {
    if (s.points.length < 1) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2;
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
    if (s.label) {
      const [lx, ly] = s.points[s.points.length - 1];
      ctx.fillStyle = s.color;
      ctx.fillText(s.label, Math.min(X(lx) - 30, w - 40), Y(ly) - 4);
    }
  }
}
