// Canvas-2D avionics rendering: PFD, ND, EICAS, systems page, FCU, GA steam
// gauges, fighter HUD and radar MFD. All functions draw into a 2D context of
// size (w, h) from a flight data object `d` built by the player aircraft.

const DEG = Math.PI / 180;
const C = {
  sky: '#2a6fb5',
  ground: '#7a4a1e',
  white: '#ffffff',
  green: '#3cff4a',
  cyan: '#2fe6ff',
  magenta: '#ff4cf0',
  amber: '#ffb000',
  red: '#ff3030',
  yellow: '#ffe400',
  grey: '#5a5f66',
  tape: 'rgba(60,64,72,0.85)',
  bg: '#05070a',
};

function font(px, weight = 600) {
  return `${weight} ${px}px "B612 Mono", "Consolas", "Menlo", "DejaVu Sans Mono", monospace`;
}

function wrap360(a) {
  return ((a % 360) + 360) % 360;
}

function text(ctx, s, x, y, color, px, align = 'left', base = 'middle', weight = 600) {
  ctx.fillStyle = color;
  ctx.font = font(px, weight);
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}

function box(ctx, x, y, w, h, stroke, fill = null, lw = 1.5) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
}

// ---------------------------------------------------------------------------
// Primary flight display
// ---------------------------------------------------------------------------
export function drawPFD(ctx, w, h, d, opts = {}) {
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (!d.powered) {
    ctx.restore();
    return;
  }
  const s = h / 512; // scale
  const cx = w * 0.5,
    cy = h * 0.47;
  const adiW = w * 0.5,
    adiH = h * 0.56;
  const ppd = adiH / 40; // pixels per degree of pitch

  // ---- Attitude
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cx - adiW / 2, cy - adiH / 2, adiW, adiH, 18 * s);
  else ctx.rect(cx - adiW / 2, cy - adiH / 2, adiW, adiH);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-d.bank * DEG);
  const po = d.pitch * ppd;
  ctx.fillStyle = C.sky;
  ctx.fillRect(-w, -h * 2 + po, w * 2, h * 2);
  ctx.fillStyle = C.ground;
  ctx.fillRect(-w, po, w * 2, h * 2);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(-w, po);
  ctx.lineTo(w, po);
  ctx.stroke();
  // Pitch ladder
  ctx.lineWidth = 1.6 * s;
  for (let p = -40; p <= 40; p += 2.5) {
    if (p === 0) continue;
    const y = po - p * ppd;
    if (Math.abs(y) > adiH * 0.48) continue;
    const major = p % 10 === 0;
    const mid = p % 5 === 0;
    const len = (major ? 60 : mid ? 34 : 14) * s;
    ctx.beginPath();
    ctx.moveTo(-len, y);
    ctx.lineTo(len, y);
    ctx.stroke();
    if (major) {
      text(ctx, String(Math.abs(p)), -len - 6 * s, y, C.white, 14 * s, 'right');
      text(ctx, String(Math.abs(p)), len + 6 * s, y, C.white, 14 * s, 'left');
    }
  }
  ctx.restore();

  // Bank scale
  ctx.save();
  ctx.translate(cx, cy);
  const R = adiH * 0.47;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2 - 45 * DEG, -Math.PI / 2 + 45 * DEG);
  ctx.stroke();
  for (const b of [-45, -30, -20, -10, 10, 20, 30, 45]) {
    const a = -Math.PI / 2 + b * DEG;
    const l = Math.abs(b) % 30 === 0 ? 14 * s : 8 * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    ctx.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l));
    ctx.stroke();
  }
  ctx.fillStyle = C.yellow;
  ctx.beginPath();
  ctx.moveTo(0, -R);
  ctx.lineTo(-8 * s, -R - 12 * s);
  ctx.lineTo(8 * s, -R - 12 * s);
  ctx.closePath();
  ctx.fill();
  // Roll pointer + slip
  ctx.rotate(-d.bank * DEG);
  ctx.fillStyle = Math.abs(d.bank) > 35 ? C.amber : C.yellow;
  ctx.beginPath();
  ctx.moveTo(0, -R + 2 * s);
  ctx.lineTo(-9 * s, -R + 15 * s);
  ctx.lineTo(9 * s, -R + 15 * s);
  ctx.closePath();
  ctx.fill();
  const slip = Math.max(-1, Math.min(1, (d.slip || 0) * 6));
  ctx.fillRect(-10 * s + slip * 14 * s, -R + 17 * s, 20 * s, 5 * s);
  ctx.restore();

  // Flight director
  if (d.fd && d.fd.on) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 3 * s;
    const fx = Math.max(-1, Math.min(1, (d.fd.bank - d.bank) / 25)) * adiW * 0.3;
    const fy = Math.max(-1, Math.min(1, -(d.fd.pitch - d.pitch) / 10)) * adiH * 0.3;
    ctx.beginPath();
    ctx.moveTo(fx, -adiH * 0.3);
    ctx.lineTo(fx, adiH * 0.3);
    ctx.moveTo(-adiW * 0.3, fy);
    ctx.lineTo(adiW * 0.3, fy);
    ctx.stroke();
    ctx.restore();
  }
  // Aircraft symbol
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = 3 * s;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sgn * 90 * s, 0);
    ctx.lineTo(sgn * 40 * s, 0);
    ctx.lineTo(sgn * 40 * s, 14 * s);
    ctx.stroke();
  }
  ctx.fillStyle = C.yellow;
  ctx.fillRect(-4 * s, -4 * s, 8 * s, 8 * s);
  ctx.restore();

  // ---- ILS deviation
  if (d.ils && d.ils.valid) {
    ctx.save();
    ctx.fillStyle = C.magenta;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 1.5 * s;
    const gy = cy + adiH * 0.5 + 16 * s;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.arc(cx + k * 30 * s, gy, 3.5 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    const lx = cx + Math.max(-2.5, Math.min(2.5, -d.ils.locDots)) * 30 * s;
    ctx.beginPath();
    ctx.moveTo(lx - 10 * s, gy);
    ctx.lineTo(lx, gy - 7 * s);
    ctx.lineTo(lx + 10 * s, gy);
    ctx.lineTo(lx, gy + 7 * s);
    ctx.closePath();
    ctx.fill();
    if (d.ils.gsValid) {
      const gx = cx + adiW * 0.5 + 14 * s;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(gx, cy + k * 30 * s, 3.5 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      const yy = cy + Math.max(-2.5, Math.min(2.5, d.ils.gsDots)) * 30 * s;
      ctx.beginPath();
      ctx.moveTo(gx, yy - 10 * s);
      ctx.lineTo(gx - 7 * s, yy);
      ctx.lineTo(gx, yy + 10 * s);
      ctx.lineTo(gx + 7 * s, yy);
      ctx.closePath();
      ctx.fill();
    }
    text(ctx, `${d.ils.ident || 'ILS'}`, cx - adiW / 2 + 6 * s, cy + adiH / 2 - 26 * s, C.magenta, 13 * s);
    text(ctx, `${(d.ils.dme / 1852).toFixed(1)} NM`, cx - adiW / 2 + 6 * s, cy + adiH / 2 - 10 * s, C.magenta, 13 * s);
    ctx.restore();
  }

  // ---- Speed tape
  const tx = cx - adiW / 2 - 90 * s,
    tw = 72 * s,
    th = adiH * 1.02;
  const ty = cy - th / 2;
  ctx.save();
  box(ctx, tx, ty, tw, th, null, C.tape);
  ctx.beginPath();
  ctx.rect(tx, ty, tw, th);
  ctx.clip();
  const kpp = th / 90; // pixels per knot
  const ias = Math.max(0, d.ias);
  for (let k = Math.floor((ias - 50) / 10) * 10; k <= ias + 50; k += 10) {
    if (k < 0) continue;
    const y = cy - (k - ias) * kpp;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(tx + tw - 14 * s, y);
    ctx.lineTo(tx + tw, y);
    ctx.stroke();
    if (k % 20 === 0) text(ctx, String(k), tx + tw - 18 * s, y, C.white, 16 * s, 'right');
  }
  // Overspeed barber pole and low-speed band
  if (d.vmax) {
    const y = cy - (d.vmax - ias) * kpp;
    for (let yy = y; yy > ty - 20; yy -= 12 * s) {
      ctx.fillStyle = C.red;
      ctx.fillRect(tx + tw - 8 * s, yy - 6 * s, 8 * s, 6 * s);
    }
  }
  if (d.vls) {
    const yls = cy - (d.vls - ias) * kpp;
    const ystall = cy - ((d.vstall || d.vls * 0.85) - ias) * kpp;
    ctx.fillStyle = C.amber;
    ctx.fillRect(tx + tw - 5 * s, yls, 5 * s, Math.max(0, ystall - yls));
    ctx.fillStyle = C.red;
    ctx.fillRect(tx + tw - 8 * s, ystall, 8 * s, th);
  }
  // Speed trend
  if (Math.abs(d.iasTrend || 0) > 0.5) {
    const y2 = cy - d.iasTrend * 10 * kpp;
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(tx + tw - 4 * s, cy);
    ctx.lineTo(tx + tw - 4 * s, y2);
    ctx.stroke();
  }
  // Target speed bug
  if (d.ap && d.ap.spd) {
    const y = cy - (d.ap.spd - ias) * kpp;
    ctx.fillStyle = C.magenta;
    ctx.beginPath();
    ctx.moveTo(tx + tw, y);
    ctx.lineTo(tx + tw + 10 * s, y - 8 * s);
    ctx.lineTo(tx + tw + 10 * s, y + 8 * s);
    ctx.closePath();
    ctx.fill();
  }
  // V-speed markers on ground
  if (d.onGround && d.vr) {
    const y = cy - (d.vr - ias) * kpp;
    text(ctx, 'R', tx + tw - 4 * s, y, C.cyan, 13 * s, 'right');
  }
  ctx.restore();
  // Current speed box
  box(ctx, tx - 2 * s, cy - 16 * s, tw + 4 * s, 32 * s, C.yellow, '#000', 2 * s);
  text(ctx, String(Math.round(ias)).padStart(3, ' '), tx + tw / 2, cy + 1 * s, C.white, 22 * s, 'center', 'middle', 700);
  if (d.ap && d.ap.spd) text(ctx, String(Math.round(d.ap.spd)), tx + tw / 2, ty - 12 * s, C.magenta, 16 * s, 'center');
  if (d.mach > 0.4) text(ctx, `.${String(Math.round(d.mach * 1000)).padStart(3, '0')}`.replace('.1000', '1.00'), tx + tw / 2, ty + th + 14 * s, C.green, 16 * s, 'center');
  else text(ctx, `GS ${Math.round(d.gs)}`, tx + tw / 2, ty + th + 14 * s, C.green, 13 * s, 'center');

  // ---- Altitude tape
  const ax = cx + adiW / 2 + 34 * s,
    aw = 84 * s;
  ctx.save();
  box(ctx, ax, ty, aw, th, null, C.tape);
  ctx.beginPath();
  ctx.rect(ax, ty, aw, th);
  ctx.clip();
  const fpp = th / 900; // pixels per foot
  const alt = d.alt;
  for (let a = Math.floor((alt - 500) / 100) * 100; a <= alt + 500; a += 100) {
    const y = cy - (a - alt) * fpp;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(ax, y);
    ctx.lineTo(ax + (a % 500 === 0 ? 16 : 8) * s, y);
    ctx.stroke();
    if (a % 500 === 0) text(ctx, String(a / 100 | 0).padStart(3, '0'), ax + 20 * s, y, C.white, 15 * s, 'left');
  }
  // Ground reference
  if (d.radioAlt < 600) {
    const gy = cy + d.radioAlt * fpp;
    ctx.fillStyle = 'rgba(160,80,20,0.85)';
    ctx.fillRect(ax, gy, aw, th);
  }
  // Selected altitude bug
  if (d.ap && d.ap.alt !== undefined) {
    const y = Math.max(ty, Math.min(ty + th, cy - (d.ap.alt - alt) * fpp));
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.5 * s;
    ctx.strokeRect(ax + 2 * s, y - 10 * s, 10 * s, 20 * s);
  }
  ctx.restore();
  box(ctx, ax - 4 * s, cy - 17 * s, aw + 8 * s, 34 * s, C.yellow, '#000', 2 * s);
  text(ctx, String(Math.round(alt)), ax + aw - 4 * s, cy + 1 * s, C.white, 21 * s, 'right', 'middle', 700);
  if (d.ap && d.ap.alt !== undefined) text(ctx, String(d.ap.alt), ax + aw / 2, ty - 12 * s, C.cyan, 16 * s, 'center');
  text(ctx, 'QNH 1013', ax + aw / 2, ty + th + 14 * s, C.cyan, 12 * s, 'center');

  // ---- Vertical speed
  const vx = ax + aw + 14 * s;
  ctx.save();
  ctx.fillStyle = C.tape;
  ctx.fillRect(vx, cy - th * 0.38, 26 * s, th * 0.76);
  const vsC = Math.max(-6000, Math.min(6000, d.vs));
  const vsy = (v) => cy - Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * th * 0.36;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 1.5 * s;
  for (const v of [-6000, -2000, -1000, -500, 0, 500, 1000, 2000, 6000]) {
    const y = vsy(v);
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.lineTo(vx + (v % 1000 === 0 ? 8 : 5) * s, y);
    ctx.stroke();
  }
  ctx.strokeStyle = Math.abs(vsC) > 6000 ? C.amber : C.green;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(vx + 30 * s, cy);
  ctx.lineTo(vx + 4 * s, vsy(vsC));
  ctx.stroke();
  if (Math.abs(d.vs) > 200) text(ctx, String(Math.round(d.vs / 100) * 100), vx + 12 * s, d.vs > 0 ? cy - th * 0.42 : cy + th * 0.42, C.green, 12 * s, 'center');
  ctx.restore();

  // ---- Heading tape
  const hy = cy + adiH / 2 + 46 * s,
    hw = adiW,
    hh = 34 * s;
  ctx.save();
  box(ctx, cx - hw / 2, hy, hw, hh, null, C.tape);
  ctx.beginPath();
  ctx.rect(cx - hw / 2, hy, hw, hh);
  ctx.clip();
  const dpp = hw / 60;
  for (let a = Math.floor(d.heading / 5) * 5 - 35; a <= d.heading + 35; a += 5) {
    const x = cx + (a - d.heading) * dpp;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x, hy);
    ctx.lineTo(x, hy + (a % 10 === 0 ? 10 : 6) * s);
    ctx.stroke();
    if (a % 10 === 0) {
      const v = wrap360(a) / 10;
      text(ctx, String(v === 0 ? 36 : v).padStart(2, '0'), x, hy + 21 * s, C.white, 14 * s, 'center');
    }
  }
  if (d.ap) {
    let dh = ((d.ap.hdg - d.heading + 540) % 360) - 180;
    const x = cx + Math.max(-30, Math.min(30, dh)) * dpp;
    ctx.fillStyle = C.cyan;
    ctx.fillRect(x - 4 * s, hy, 8 * s, 8 * s);
  }
  let dt2 = ((d.track - d.heading + 540) % 360) - 180;
  ctx.strokeStyle = C.green;
  ctx.lineWidth = 2 * s;
  const tx2 = cx + dt2 * dpp;
  ctx.beginPath();
  ctx.moveTo(tx2, hy + 2 * s);
  ctx.lineTo(tx2 - 5 * s, hy + 10 * s);
  ctx.lineTo(tx2, hy + 18 * s);
  ctx.lineTo(tx2 + 5 * s, hy + 10 * s);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(cx, hy - 6 * s);
  ctx.lineTo(cx, hy + 12 * s);
  ctx.stroke();

  // ---- Radio altitude
  if (d.radioAlt < 2500 && !d.onGround) {
    text(ctx, String(Math.max(0, Math.round(d.radioAlt / 10) * 10)), cx, cy + adiH * 0.38, d.radioAlt < 200 ? C.amber : C.green, 22 * s, 'center', 'middle', 700);
  }

  // ---- FMA (flight mode annunciator)
  const fy = 6 * s,
    fh = 44 * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, fy, w, fh);
  const cols = 5;
  const cw = w / cols;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  for (let i = 1; i < cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cw, fy + 4 * s);
    ctx.lineTo(i * cw, fy + fh - 4 * s);
    ctx.stroke();
  }
  const ap = d.ap || {};
  const athr = ap.athr ? ap.athrMode || 'SPEED' : '';
  text(ctx, athr, cw * 0.5, fy + 14 * s, C.green, 15 * s, 'center');
  text(ctx, ap.engaged || ap.fdOn ? (ap.vert || '') : '', cw * 1.5, fy + 14 * s, C.green, 15 * s, 'center');
  text(ctx, ap.vertArmed || '', cw * 1.5, fy + 32 * s, C.cyan, 13 * s, 'center');
  text(ctx, ap.engaged || ap.fdOn ? (ap.lat || '') : '', cw * 2.5, fy + 14 * s, C.green, 15 * s, 'center');
  text(ctx, ap.latArmed || '', cw * 2.5, fy + 32 * s, C.cyan, 13 * s, 'center');
  if (ap.vert === 'GS' || ap.vert === 'FLARE' || ap.lat === 'LOC') text(ctx, ap.canLand ? 'CAT3' : 'CAT1', cw * 3.5, fy + 14 * s, C.white, 14 * s, 'center');
  text(ctx, ap.engaged ? 'AP1' : '', cw * 4.5, fy + 12 * s, C.white, 14 * s, 'center');
  text(ctx, ap.fdOn ? '1 FD 2' : '', cw * 4.5, fy + 27 * s, C.white, 12 * s, 'center');
  text(ctx, ap.athr ? 'A/THR' : '', cw * 4.5, fy + 40 * s, C.white, 12 * s, 'center');
  if (d.protection) text(ctx, d.protection, cx, cy - adiH / 2 + 16 * s, C.amber, 15 * s, 'center');
  if (d.warningText) text(ctx, d.warningText, cx, cy + adiH * 0.24, C.red, 22 * s, 'center', 'middle', 800);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Navigation display (arc mode, heading up)
// ---------------------------------------------------------------------------
export function drawND(ctx, w, h, d, opts = {}) {
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (!d.powered) {
    ctx.restore();
    return;
  }
  const s = h / 512;
  const rangeNm = opts.range || d.ndRange || 20;
  const cx = w / 2,
    cy = h * 0.84;
  const R = h * 0.72;
  const ppm = R / (rangeNm * 1852); // pixels per metre
  const hdg = d.heading;
  const toScreen = (x, z) => {
    const dx = x - d.x,
      dz = z - d.z;
    const a = -hdg * DEG;
    // rotate so that heading is up (north = -z)
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    return [cx + rx * ppm, cy + rz * ppm];
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, h * 0.06, w, h * 0.94);
  ctx.clip();

  // Weather radar returns
  if (d.weatherRadar && d.storms) {
    for (const st of d.storms) {
      const [x, y] = toScreen(st.x, st.z);
      const rr = st.r * ppm;
      const rings = [
        [1.9, 'rgba(40,200,60,0.35)'],
        [1.3, 'rgba(240,220,40,0.45)'],
        [0.7, 'rgba(255,40,40,0.55)'],
      ];
      for (const [k, col] of rings) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x, y, rr * k, rr * k * 0.8, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Terrain proximity colouring
  if (d.terrainGrid) {
    for (const t of d.terrainGrid) {
      const [x, y] = toScreen(t.x, t.z);
      ctx.fillStyle = t.c;
      ctx.fillRect(x - 3 * s, y - 3 * s, 6 * s, 6 * s);
    }
  }
  // Range arcs
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.5 * s;
  for (const f of [0.5, 1]) {
    ctx.setLineDash(f < 1 ? [6 * s, 6 * s] : []);
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, Math.PI + 0.35, -0.35);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  text(ctx, String(rangeNm / 2), cx - R * 0.5 * Math.cos(0.5) - 4 * s, cy - R * 0.5 * Math.sin(0.5), C.cyan, 13 * s, 'right');
  // Airports
  for (const ap of d.airports || []) {
    const [x, y] = toScreen(ap.x, ap.z);
    if (Math.hypot(x - cx, y - cy) > R * 1.05) continue;
    ctx.strokeStyle = C.magenta;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
    ctx.stroke();
    if (rangeNm <= 40)
      for (const r of ap.runways || []) {
        const [x1, y1] = toScreen(r.x1, r.z1);
        const [x2, y2] = toScreen(r.x2, r.z2);
        ctx.strokeStyle = C.white;
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    text(ctx, ap.icao, x + 10 * s, y - 8 * s, C.magenta, 13 * s);
  }
  // Flight plan
  const plan = d.plan || [];
  if (plan.length > 1) {
    ctx.lineWidth = 2.5 * s;
    for (let i = 0; i < plan.length - 1; i++) {
      const [x1, y1] = toScreen(plan[i].x, plan[i].z);
      const [x2, y2] = toScreen(plan[i + 1].x, plan[i + 1].z);
      ctx.strokeStyle = i + 1 === d.activeWpt ? C.magenta : i + 1 < d.activeWpt ? '#666' : C.white;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    plan.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.z);
      const col = i === d.activeWpt ? C.magenta : C.white;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(x, y - 7 * s);
      ctx.lineTo(x + 7 * s, y);
      ctx.lineTo(x, y + 7 * s);
      ctx.lineTo(x - 7 * s, y);
      ctx.closePath();
      ctx.stroke();
      if (p.type !== 'airport') text(ctx, p.id, x + 10 * s, y + 10 * s, col, 12 * s);
    });
  }
  // ILS course line
  if (d.ils && d.ils.end) {
    const e = d.ils.end;
    const [x1, y1] = toScreen(e.x, e.z);
    const [x2, y2] = toScreen(e.x - e.dirX * 20000, e.z - e.dirZ * 20000);
    ctx.strokeStyle = C.magenta;
    ctx.setLineDash([10 * s, 6 * s]);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Traffic (TCAS)
  for (const t of d.traffic || []) {
    const [x, y] = toScreen(t.x, t.z);
    if (Math.hypot(x - cx, y - cy) > R * 1.05) continue;
    const rel = Math.round(t.relAlt / 100);
    const col = Math.abs(t.relAlt) < 1200 && t.dist < 6 * 1852 ? C.amber : C.cyan;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 7 * s);
    ctx.lineTo(x + 7 * s, y);
    ctx.lineTo(x, y + 7 * s);
    ctx.lineTo(x - 7 * s, y);
    ctx.closePath();
    ctx.fill();
    text(ctx, `${rel >= 0 ? '+' : '-'}${String(Math.abs(rel)).padStart(2, '0')}`, x, rel >= 0 ? y - 14 * s : y + 14 * s, col, 11 * s, 'center');
    if (t.vs > 500) text(ctx, '↑', x + 10 * s, y, col, 13 * s);
    else if (t.vs < -500) text(ctx, '↓', x + 10 * s, y, col, 13 * s);
  }
  ctx.restore();

  // Compass arc
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI + 0.35, -0.35);
  ctx.stroke();
  for (let a = 0; a < 360; a += 5) {
    const rel = ((a - hdg + 540) % 360) - 180;
    if (Math.abs(rel) > 65) continue;
    const ang = -Math.PI / 2 + rel * DEG;
    const l = a % 10 === 0 ? 14 * s : 7 * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * R, Math.sin(ang) * R);
    ctx.lineTo(Math.cos(ang) * (R - l), Math.sin(ang) * (R - l));
    ctx.stroke();
    if (a % 30 === 0) {
      ctx.save();
      ctx.rotate(rel * DEG);
      text(ctx, String(a / 10), 0, -R + 26 * s, C.white, 16 * s, 'center');
      ctx.restore();
    }
  }
  // Heading bug
  if (d.ap) {
    const rel = ((d.ap.hdg - hdg + 540) % 360) - 180;
    if (Math.abs(rel) < 65) {
      ctx.save();
      ctx.rotate(rel * DEG);
      ctx.fillStyle = C.cyan;
      ctx.beginPath();
      ctx.moveTo(-8 * s, -R - 2 * s);
      ctx.lineTo(8 * s, -R - 2 * s);
      ctx.lineTo(0, -R + 10 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  // Track line
  const trel = ((d.track - hdg + 540) % 360) - 180;
  ctx.save();
  ctx.rotate(trel * DEG);
  ctx.strokeStyle = C.green;
  ctx.setLineDash([6 * s, 6 * s]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -R);
  ctx.stroke();
  ctx.restore();
  // Aircraft symbol
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = 3 * s;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, -14 * s);
  ctx.lineTo(0, 22 * s);
  ctx.moveTo(-18 * s, 0);
  ctx.lineTo(18 * s, 0);
  ctx.moveTo(-7 * s, 16 * s);
  ctx.lineTo(7 * s, 16 * s);
  ctx.stroke();
  ctx.restore();
  // Heading box
  box(ctx, cx - 28 * s, h * 0.02, 56 * s, 28 * s, C.white, '#000', 2 * s);
  text(ctx, String(Math.round(wrap360(hdg))).padStart(3, '0'), cx, h * 0.02 + 15 * s, C.white, 18 * s, 'center', 'middle', 700);
  // Top-left: GS/TAS/wind
  text(ctx, `GS ${Math.round(d.gs)}  TAS ${Math.round(d.tas)}`, 10 * s, 18 * s, C.white, 14 * s);
  if (d.wind) {
    text(ctx, `${String(Math.round(d.wind.dir)).padStart(3, '0')}°/${Math.round(d.wind.kt)}`, 10 * s, 38 * s, C.green, 14 * s);
    ctx.save();
    ctx.translate(26 * s, 66 * s);
    ctx.rotate((d.wind.dir + 180 - hdg) * DEG);
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, -12 * s);
    ctx.lineTo(0, 12 * s);
    ctx.moveTo(-5 * s, 6 * s);
    ctx.lineTo(0, 12 * s);
    ctx.lineTo(5 * s, 6 * s);
    ctx.stroke();
    ctx.restore();
  }
  // Top-right: active waypoint
  if (d.guidance && d.guidance.valid && d.guidance.wpt) {
    const g = d.guidance;
    text(ctx, g.wpt.id, w - 10 * s, 18 * s, C.magenta, 16 * s, 'right', 'middle', 700);
    text(ctx, `${Math.round(g.bearing)}°  ${(g.distance / 1852).toFixed(1)} NM`, w - 10 * s, 38 * s, C.white, 14 * s, 'right');
    const ete = g.ete;
    if (ete > 0) text(ctx, `${Math.floor(ete / 60)}:${String(Math.floor(ete % 60)).padStart(2, '0')}`, w - 10 * s, 56 * s, C.white, 14 * s, 'right');
  }
  // Bottom: range & mode
  text(ctx, `ARC  ${rangeNm} NM`, 10 * s, h - 14 * s, C.cyan, 13 * s);
  if (d.weatherRadar) text(ctx, 'WXR', w - 10 * s, h - 14 * s, C.green, 13 * s, 'right');
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Engine display (EICAS / ECAM upper)
// ---------------------------------------------------------------------------
function dial(ctx, x, y, r, frac, label, value, color = C.white, redline = 1.0, s = 1) {
  const a0 = Math.PI * 0.75,
    a1 = Math.PI * 2.2;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a0 + (a1 - a0) * redline);
  ctx.stroke();
  ctx.strokeStyle = C.red;
  ctx.beginPath();
  ctx.arc(x, y, r, a0 + (a1 - a0) * redline, a1);
  ctx.stroke();
  const f = Math.max(0, Math.min(1.05, frac));
  const a = a0 + (a1 - a0) * f;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r - 3 * s, a0, a);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5 * s;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  ctx.stroke();
  box(ctx, x + 2 * s, y + 4 * s, r * 1.05, 24 * s, '#888', '#000', 1);
  text(ctx, value, x + 2 * s + r * 1.0, y + 17 * s, color, 17 * s, 'right', 'middle', 700);
  if (label) text(ctx, label, x - r, y - r - 8 * s, C.cyan, 12 * s);
}

export function drawEngines(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (!d.powered) {
    ctx.restore();
    return;
  }
  const s = h / 512;
  const eng = d.engines || [];
  const n = eng.length;
  const jet = d.engineType === 'jet';
  const colW = w / Math.max(2, n);
  eng.forEach((e, i) => {
    const x = colW * (i + 0.5) - 20 * s;
    const fail = e.failed || e.fire;
    const col = fail ? C.amber : C.green;
    if (jet) {
      dial(ctx, x, 95 * s, 46 * s * Math.min(1, 2 / n * 1.1), e.n1 / 1.04, i === 0 ? 'N1 %' : '', (e.n1 * 100).toFixed(1), col, 0.97, s);
      dial(ctx, x, 225 * s, 38 * s * Math.min(1, 2 / n * 1.1), (e.egt - 200) / 800, i === 0 ? 'EGT °C' : '', String(Math.round(e.egt)), col, 0.9, s);
      text(ctx, `N2 ${(e.n2 * 100).toFixed(1)}`, x + 10 * s, 300 * s, C.green, 14 * s, 'center');
      text(ctx, `FF ${Math.round(e.ff)}`, x + 10 * s, 320 * s, C.green, 14 * s, 'center');
      if (e.afterburner > 0.05) text(ctx, 'A/B', x + 10 * s, 340 * s, C.amber, 16 * s, 'center', 'middle', 800);
    } else {
      dial(ctx, x, 95 * s, 46 * s * Math.min(1, 2 / n * 1.1), e.rpm / (d.maxRPM || 2700), i === 0 ? 'RPM' : '', String(Math.round(e.rpm)), col, 0.95, s);
      dial(ctx, x, 225 * s, 38 * s * Math.min(1, 2 / n * 1.1), e.power, i === 0 ? d.engineType === 'turboprop' ? 'TORQUE %' : 'POWER %' : '', String(Math.round(e.power * 100)), col, 0.98, s);
      text(ctx, `${d.engineType === 'turboprop' ? 'ITT' : 'EGT'} ${Math.round(e.egt)}`, x + 10 * s, 300 * s, C.green, 14 * s, 'center');
      text(ctx, `FF ${Math.round(e.ff)}`, x + 10 * s, 320 * s, C.green, 14 * s, 'center');
    }
    if (e.reverse > 0.1) text(ctx, 'REV', x + 10 * s, 30 * s, C.green, 15 * s, 'center', 'middle', 800);
    if (e.status !== 'RUN') text(ctx, e.status, x + 10 * s, 360 * s, e.status === 'FIRE' ? C.red : C.amber, 16 * s, 'center', 'middle', 800);
  });
  // Fuel and config
  const y0 = 390 * s;
  ctx.strokeStyle = '#444';
  ctx.beginPath();
  ctx.moveTo(10 * s, y0 - 10 * s);
  ctx.lineTo(w - 10 * s, y0 - 10 * s);
  ctx.stroke();
  text(ctx, 'FOB', 14 * s, y0 + 10 * s, C.cyan, 14 * s);
  text(ctx, `${Math.round(d.fuel).toLocaleString('en-US')} KG`, 70 * s, y0 + 10 * s, d.fuelFrac < 0.1 ? C.amber : C.green, 18 * s, 'left', 'middle', 700);
  text(ctx, 'FLAPS', w * 0.62, y0 + 10 * s, C.cyan, 14 * s);
  text(ctx, d.flapsName, w * 0.62 + 64 * s, y0 + 10 * s, C.green, 18 * s, 'left', 'middle', 700);
  // Flap position bar
  ctx.fillStyle = '#333';
  ctx.fillRect(w * 0.62, y0 + 26 * s, w * 0.3, 8 * s);
  ctx.fillStyle = C.green;
  ctx.fillRect(w * 0.62, y0 + 26 * s, w * 0.3 * (d.flapsFrac || 0), 8 * s);
  // Messages
  let my = y0 + 50 * s;
  for (const m of (d.messages || []).slice(0, 4)) {
    text(ctx, m.text, 14 * s, my, m.level === 'warning' ? C.red : m.level === 'caution' ? C.amber : C.green, 15 * s, 'left', 'middle', 700);
    my += 20 * s;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Systems display (ECAM lower): gear, brakes, spoilers, fuel tanks, flight time
// ---------------------------------------------------------------------------
export function drawSystems(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (!d.powered) {
    ctx.restore();
    return;
  }
  const s = h / 512;
  text(ctx, 'WHEEL / FUEL', w / 2, 20 * s, C.white, 16 * s, 'center', 'middle', 700);
  // Gear boxes
  const gx = w / 2,
    gy = 110 * s;
  const gearCol = d.gear > 0.99 ? C.green : d.gear < 0.01 ? '#555' : C.red;
  const gearTxt = d.gear > 0.99 ? 'DN' : d.gear < 0.01 ? 'UP' : 'TRANSIT';
  for (const [dx, dy] of [
    [0, -40],
    [-60, 20],
    [60, 20],
  ]) {
    box(ctx, gx + dx * s - 22 * s, gy + dy * s - 14 * s, 44 * s, 28 * s, gearCol, d.gear > 0.99 ? 'rgba(60,255,74,0.12)' : null, 2 * s);
    text(ctx, gearTxt, gx + dx * s, gy + dy * s, gearCol, 12 * s, 'center');
  }
  text(ctx, 'LDG GEAR', gx, gy + 60 * s, C.cyan, 13 * s, 'center');
  // Brakes & autobrake
  text(ctx, `BRK TEMP ${Math.round(d.brakeTemp * 100)}°C`, 20 * s, 200 * s, d.brakeTemp > 3 ? C.amber : C.green, 14 * s);
  text(ctx, `AUTOBRK ${d.autobrake}`, 20 * s, 222 * s, d.autobrake === 'OFF' ? C.white : C.green, 14 * s);
  text(ctx, d.parkingBrake ? 'PARK BRK ON' : '', 20 * s, 244 * s, C.amber, 14 * s, 'left', 'middle', 700);
  text(ctx, `SPLR ${d.spoilersArmed ? 'ARM' : Math.round(d.spoilers * 100) + '%'}`, w - 20 * s, 200 * s, C.green, 14 * s, 'right');
  // Fuel
  text(ctx, 'FUEL', 20 * s, 290 * s, C.cyan, 14 * s);
  const fw = w - 40 * s;
  box(ctx, 20 * s, 302 * s, fw, 24 * s, '#888', null);
  ctx.fillStyle = d.fuelFrac < 0.1 ? C.amber : C.green;
  ctx.fillRect(22 * s, 304 * s, (fw - 4 * s) * Math.max(0, Math.min(1, d.fuelFrac)), 20 * s);
  text(ctx, `${Math.round(d.fuelFrac * 100)}%  FF ${Math.round(d.fuelFlow)} KG/H`, 20 * s, 344 * s, C.green, 14 * s);
  const endur = d.fuelFlow > 1 ? (d.fuel / d.fuelFlow) * 60 : 0;
  text(ctx, `ENDURANCE ${Math.floor(endur / 60)}H${String(Math.floor(endur % 60)).padStart(2, '0')}`, 20 * s, 366 * s, C.green, 14 * s);
  // Bottom strip: TAT, time, GW
  ctx.strokeStyle = '#444';
  ctx.beginPath();
  ctx.moveTo(10 * s, 420 * s);
  ctx.lineTo(w - 10 * s, 420 * s);
  ctx.stroke();
  text(ctx, `SAT ${Math.round(d.oat)}°C`, 20 * s, 444 * s, C.green, 14 * s);
  text(ctx, `UTC ${d.clock}`, w / 2, 444 * s, C.green, 14 * s, 'center');
  text(ctx, `GW ${Math.round(d.mass / 100) / 10}T`, w - 20 * s, 444 * s, C.green, 14 * s, 'right');
  text(ctx, `G ${d.nz.toFixed(1)}`, 20 * s, 470 * s, C.green, 14 * s);
  text(ctx, `FLT ${d.flightTime}`, w - 20 * s, 470 * s, C.green, 14 * s, 'right');
  ctx.restore();
}

// ---------------------------------------------------------------------------
// FCU / autopilot control panel read-outs (glareshield)
// ---------------------------------------------------------------------------
export function drawFCU(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  const ap = d.ap || {};
  const s = h / 64;
  const seg = (label, val, x) => {
    text(ctx, label, x, 14 * s, '#8a8f96', 10 * s, 'center');
    text(ctx, val, x, 40 * s, '#ffb347', 22 * s, 'center', 'middle', 700);
  };
  if (d.powered) {
    seg(ap.useMach ? 'MACH' : 'SPD', ap.useMach ? ap.mach.toFixed(2) : String(Math.round(ap.spd || 0)).padStart(3, '0'), w * 0.1);
    seg('HDG', String(Math.round(ap.hdg || 0) % 360).padStart(3, '0'), w * 0.3);
    seg('ALT', String(Math.round(ap.alt || 0)).padStart(5, '0'), w * 0.55);
    seg('V/S', ap.vert === 'VS' ? `${ap.vs >= 0 ? '+' : ''}${String(Math.round(ap.vs / 100)).padStart(2, '0')}oo` : '-----', w * 0.8);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// General aviation steam gauges (six-pack) on a 1024x512 canvas
// ---------------------------------------------------------------------------
function gaugeFace(ctx, x, y, r, s) {
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, '#1c1c1e');
  g.addColorStop(1, '#0b0b0c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 6 * s;
  ctx.stroke();
}

function needle(ctx, x, y, ang, len, wid, color = '#f2f2f2') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-wid, 0);
  ctx.lineTo(0, -len);
  ctx.lineTo(wid, 0);
  ctx.lineTo(0, wid * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawSixPack(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = '#2b2d30';
  ctx.fillRect(0, 0, w, h);
  const s = h / 512;
  const r = 105 * s;
  const pos = [
    [w * 0.17, h * 0.27],
    [w * 0.5, h * 0.27],
    [w * 0.83, h * 0.27],
    [w * 0.17, h * 0.74],
    [w * 0.5, h * 0.74],
    [w * 0.83, h * 0.74],
  ];
  // 1. Airspeed
  {
    const [x, y] = pos[0];
    gaugeFace(ctx, x, y, r, s);
    const a = (kt) => (-140 + Math.min(200, Math.max(0, kt)) * 1.45) * DEG;
    const arc = (k0, k1, col, rr) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 7 * s;
      ctx.beginPath();
      ctx.arc(x, y, rr, a(k0) - Math.PI / 2, a(k1) - Math.PI / 2);
      ctx.stroke();
    };
    arc(40, 85, '#ffffff', r * 0.78);
    arc(48, 129, '#2fbf3a', r * 0.86);
    arc(129, 163, '#e8c21a', r * 0.86);
    for (let k = 40; k <= 200; k += 10) {
      const an = a(k) - Math.PI / 2;
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * r * 0.92, y + Math.sin(an) * r * 0.92);
      ctx.lineTo(x + Math.cos(an) * r * (k % 20 === 0 ? 0.76 : 0.84), y + Math.sin(an) * r * (k % 20 === 0 ? 0.76 : 0.84));
      ctx.stroke();
      if (k % 20 === 0) text(ctx, String(k), x + Math.cos(an) * r * 0.6, y + Math.sin(an) * r * 0.6, '#eee', 16 * s, 'center');
    }
    text(ctx, 'KNOTS', x, y + r * 0.35, '#bbb', 12 * s, 'center');
    needle(ctx, x, y, a(d.ias), r * 0.85, 5 * s);
  }
  // 2. Attitude
  {
    const [x, y] = pos[1];
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(-d.bank * DEG);
    const po = Math.max(-r, Math.min(r, d.pitch * 3 * s));
    ctx.fillStyle = '#2f7fd0';
    ctx.fillRect(-r * 2, -r * 2 + po, r * 4, r * 2);
    ctx.fillStyle = '#7a4a1e';
    ctx.fillRect(-r * 2, po, r * 4, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(-r, po);
    ctx.lineTo(r, po);
    ctx.stroke();
    for (const p of [-20, -10, 10, 20]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, po - p * 3 * s);
      ctx.lineTo(r * 0.25, po - p * 3 * s);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#ff9a00';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y);
    ctx.lineTo(x - r * 0.18, y);
    ctx.lineTo(x - r * 0.08, y + r * 0.1);
    ctx.moveTo(x + r * 0.55, y);
    ctx.lineTo(x + r * 0.18, y);
    ctx.lineTo(x + r * 0.08, y + r * 0.1);
    ctx.stroke();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 3. Altimeter
  {
    const [x, y] = pos[2];
    gaugeFace(ctx, x, y, r, s);
    for (let i = 0; i < 50; i++) {
      const an = (i / 50) * Math.PI * 2 - Math.PI / 2;
      const big = i % 5 === 0;
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = (big ? 3 : 1.5) * s;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * r * 0.92, y + Math.sin(an) * r * 0.92);
      ctx.lineTo(x + Math.cos(an) * r * (big ? 0.78 : 0.86), y + Math.sin(an) * r * (big ? 0.78 : 0.86));
      ctx.stroke();
      if (big) text(ctx, String(i / 5), x + Math.cos(an) * r * 0.64, y + Math.sin(an) * r * 0.64, '#eee', 18 * s, 'center');
    }
    const alt = Math.max(0, d.alt);
    needle(ctx, x, y, ((alt % 10000) / 10000) * Math.PI * 2, r * 0.45, 7 * s);
    needle(ctx, x, y, ((alt % 1000) / 1000) * Math.PI * 2, r * 0.82, 4 * s);
    text(ctx, String(Math.round(alt)).padStart(5, ' '), x, y + r * 0.42, '#ddd', 13 * s, 'center');
  }
  // 4. Turn coordinator
  {
    const [x, y] = pos[3];
    gaugeFace(ctx, x, y, r, s);
    text(ctx, 'L', x - r * 0.72, y + r * 0.25, '#eee', 16 * s, 'center');
    text(ctx, 'R', x + r * 0.72, y + r * 0.25, '#eee', 16 * s, 'center');
    const rate = Math.max(-1.5, Math.min(1.5, (d.turnRate || 0) / 3));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rate * 20 * DEG);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(r * 0.6, 0);
    ctx.moveTo(0, -r * 0.15);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x - r * 0.5, y + r * 0.45, r, r * 0.16);
    ctx.fillStyle = '#000';
    const bx = Math.max(-1, Math.min(1, (d.slip || 0) * 5));
    ctx.beginPath();
    ctx.arc(x + bx * r * 0.4, y + r * 0.53, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // 5. Heading indicator
  {
    const [x, y] = pos[4];
    gaugeFace(ctx, x, y, r, s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-d.heading * DEG);
    for (let a = 0; a < 360; a += 5) {
      ctx.save();
      ctx.rotate(a * DEG);
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = (a % 10 === 0 ? 2.5 : 1.2) * s;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.lineTo(0, -r * (a % 10 === 0 ? 0.8 : 0.86));
      ctx.stroke();
      if (a % 30 === 0) {
        const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a / 10);
        text(ctx, lbl, 0, -r * 0.66, '#eee', 17 * s, 'center');
      }
      ctx.restore();
    }
    if (d.ap) {
      ctx.save();
      ctx.rotate(d.ap.hdg * DEG);
      ctx.fillStyle = '#ff9a00';
      ctx.fillRect(-6 * s, -r * 0.95, 12 * s, 9 * s);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#ff9a00';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.5);
    ctx.lineTo(x, y + r * 0.4);
    ctx.moveTo(x - r * 0.3, y);
    ctx.lineTo(x + r * 0.3, y);
    ctx.stroke();
  }
  // 6. Vertical speed
  {
    const [x, y] = pos[5];
    gaugeFace(ctx, x, y, r, s);
    const a = (fpm) => Math.PI + (Math.max(-2000, Math.min(2000, fpm)) / 2000) * Math.PI * 0.9;
    for (let v = -2000; v <= 2000; v += 500) {
      const an = a(v);
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * r * 0.92, y + Math.sin(an) * r * 0.92);
      ctx.lineTo(x + Math.cos(an) * r * 0.78, y + Math.sin(an) * r * 0.78);
      ctx.stroke();
      if (v % 1000 === 0) text(ctx, String(Math.abs(v / 100)), x + Math.cos(an) * r * 0.62, y + Math.sin(an) * r * 0.62, '#eee', 16 * s, 'center');
    }
    text(ctx, 'VSI', x + r * 0.3, y, '#bbb', 12 * s, 'center');
    needle(ctx, x, y, a(d.vs) + Math.PI / 2, r * 0.85, 5 * s);
  }
  ctx.restore();
}

export function drawGAEngine(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = '#2b2d30';
  ctx.fillRect(0, 0, w, h);
  const s = h / 256;
  const e = (d.engines || [])[0] || { rpm: 0 };
  const r = 70 * s;
  // Tachometer
  const tx = w * 0.18,
    ty = h * 0.5;
  gaugeFace(ctx, tx, ty, r, s);
  const ta = (rpm) => (-130 + Math.min(3500, rpm) / 3500 * 260) * DEG;
  ctx.strokeStyle = '#2fbf3a';
  ctx.lineWidth = 6 * s;
  ctx.beginPath();
  ctx.arc(tx, ty, r * 0.85, ta(2100) - Math.PI / 2, ta(2700) - Math.PI / 2);
  ctx.stroke();
  for (let k = 0; k <= 3500; k += 500) {
    const an = ta(k) - Math.PI / 2;
    text(ctx, String(k / 100), tx + Math.cos(an) * r * 0.62, ty + Math.sin(an) * r * 0.62, '#eee', 13 * s, 'center');
  }
  text(ctx, 'RPM', tx, ty + r * 0.4, '#bbb', 10 * s, 'center');
  needle(ctx, tx, ty, ta(e.rpm), r * 0.85, 4 * s);
  // Small engine gauges (bars)
  const bar = (label, frac, x, y, ok) => {
    text(ctx, label, x, y - 12 * s, '#ccc', 12 * s);
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y, 120 * s, 12 * s);
    ctx.fillStyle = ok ? '#2fbf3a' : '#e8c21a';
    ctx.fillRect(x, y, 120 * s * Math.max(0, Math.min(1, frac)), 12 * s);
  };
  bar('FUEL QTY', d.fuelFrac, w * 0.38, 50 * s, d.fuelFrac > 0.15);
  bar('OIL PRESS', (e.oil || 0) / 100, w * 0.38, 100 * s, (e.oil || 0) > 25);
  bar('EGT', (e.egt - 600) / 1000, w * 0.38, 150 * s, true);
  bar('FUEL FLOW', (e.ff || 0) / 60, w * 0.38, 200 * s, true);
  // GPS mini box
  ctx.fillStyle = '#081018';
  ctx.fillRect(w * 0.68, 20 * s, w * 0.3, h - 40 * s);
  text(ctx, 'GPS', w * 0.70, 40 * s, '#2fe6ff', 14 * s);
  const g = d.guidance;
  if (g && g.valid && g.wpt) {
    text(ctx, g.wpt.id, w * 0.70, 75 * s, '#ff4cf0', 22 * s, 'left', 'middle', 700);
    text(ctx, `DIS ${(g.distance / 1852).toFixed(1)}`, w * 0.70, 110 * s, '#3cff4a', 16 * s);
    text(ctx, `BRG ${String(Math.round(g.bearing)).padStart(3, '0')}`, w * 0.70, 140 * s, '#3cff4a', 16 * s);
    text(ctx, `GS  ${Math.round(d.gs)}`, w * 0.70, 170 * s, '#3cff4a', 16 * s);
  } else {
    text(ctx, 'NO FPL', w * 0.70, 90 * s, '#888', 16 * s);
    text(ctx, `GS  ${Math.round(d.gs)}`, w * 0.70, 130 * s, '#3cff4a', 16 * s);
  }
  if (d.ap && (d.ap.engaged)) text(ctx, `AP ${d.ap.lat} ${d.ap.vert}`, w * 0.70, 210 * s, '#3cff4a', 14 * s);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fighter HUD (green on transparent)
// ---------------------------------------------------------------------------
export function drawFighterHUD(ctx, w, h, d, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  if (!d.powered) return;
  ctx.save();
  const s = h / 512;
  const col = opts.color || 'rgba(80,255,120,0.95)';
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 2 * s;
  const cx = w / 2,
    cy = h * 0.45;
  const ppd = opts.ppd || h / 26; // pixels per degree (approx conformal)
  // Pitch ladder
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-d.bank * DEG);
  for (let p = -90; p <= 90; p += 5) {
    const y = (d.pitch - p) * ppd;
    if (Math.abs(y) > h * 0.42) continue;
    const len = p === 0 ? 150 * s : 70 * s;
    ctx.setLineDash(p < 0 ? [10 * s, 6 * s] : []);
    ctx.beginPath();
    ctx.moveTo(-len, y);
    ctx.lineTo(-24 * s, y);
    ctx.moveTo(24 * s, y);
    ctx.lineTo(len, y);
    ctx.stroke();
    if (p !== 0) {
      text(ctx, String(Math.abs(p)), -len - 8 * s, y, col, 15 * s, 'right');
      text(ctx, String(Math.abs(p)), len + 8 * s, y, col, 15 * s, 'left');
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
  // Flight path marker
  const fpmX = cx + Math.max(-8, Math.min(8, d.beta || 0)) * ppd;
  const fpmY = cy + (d.alpha || 0) * ppd;
  ctx.beginPath();
  ctx.arc(fpmX, fpmY, 8 * s, 0, Math.PI * 2);
  ctx.moveTo(fpmX - 22 * s, fpmY);
  ctx.lineTo(fpmX - 8 * s, fpmY);
  ctx.moveTo(fpmX + 8 * s, fpmY);
  ctx.lineTo(fpmX + 22 * s, fpmY);
  ctx.moveTo(fpmX, fpmY - 8 * s);
  ctx.lineTo(fpmX, fpmY - 18 * s);
  ctx.stroke();
  // Waterline
  ctx.beginPath();
  ctx.moveTo(cx - 30 * s, cy);
  ctx.lineTo(cx - 12 * s, cy);
  ctx.lineTo(cx - 6 * s, cy + 8 * s);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + 6 * s, cy + 8 * s);
  ctx.lineTo(cx + 12 * s, cy);
  ctx.lineTo(cx + 30 * s, cy);
  ctx.stroke();
  // Heading tape
  const hy = 40 * s;
  for (let a = Math.floor(d.heading / 5) * 5 - 20; a <= d.heading + 20; a += 5) {
    const x = cx + (a - d.heading) * 9 * s;
    ctx.beginPath();
    ctx.moveTo(x, hy);
    ctx.lineTo(x, hy + (a % 10 === 0 ? 12 : 6) * s);
    ctx.stroke();
    if (a % 10 === 0) text(ctx, String(wrap360(a) / 10).padStart(2, '0'), x, hy - 10 * s, col, 14 * s, 'center');
  }
  ctx.beginPath();
  ctx.moveTo(cx, hy + 16 * s);
  ctx.lineTo(cx - 6 * s, hy + 26 * s);
  ctx.lineTo(cx + 6 * s, hy + 26 * s);
  ctx.closePath();
  ctx.stroke();
  // Speed / altitude boxes
  box(ctx, cx - 210 * s, cy - 16 * s, 80 * s, 32 * s, col, null, 2 * s);
  text(ctx, String(Math.round(d.ias)), cx - 170 * s, cy, col, 20 * s, 'center', 'middle', 700);
  box(ctx, cx + 130 * s, cy - 16 * s, 90 * s, 32 * s, col, null, 2 * s);
  text(ctx, String(Math.round(d.alt)), cx + 175 * s, cy, col, 20 * s, 'center', 'middle', 700);
  text(ctx, `M ${d.mach.toFixed(2)}`, cx - 170 * s, cy + 36 * s, col, 15 * s, 'center');
  text(ctx, `G ${d.nz.toFixed(1)}`, cx - 170 * s, cy + 56 * s, col, 15 * s, 'center');
  text(ctx, `α ${d.alpha.toFixed(1)}`, cx - 170 * s, cy + 76 * s, col, 15 * s, 'center');
  text(ctx, `${d.vs >= 0 ? '+' : ''}${Math.round(d.vs)}`, cx + 175 * s, cy + 36 * s, col, 15 * s, 'center');
  if (d.radioAlt < 5000) text(ctx, `R ${Math.round(d.radioAlt)}`, cx + 175 * s, cy + 56 * s, col, 15 * s, 'center');
  text(ctx, `THR ${Math.round(d.throttle * 100)}%${d.afterburner ? ' AB' : ''}`, cx - 170 * s, h - 60 * s, col, 15 * s, 'center');
  if (d.gear > 0.5) text(ctx, 'GEAR', cx + 175 * s, h - 60 * s, col, 15 * s, 'center');
  if (d.ap && d.ap.engaged) text(ctx, `AP ${d.ap.lat}/${d.ap.vert}`, cx, h - 40 * s, col, 15 * s, 'center');
  if (d.guidance && d.guidance.valid && d.guidance.wpt) text(ctx, `${d.guidance.wpt.id} ${(d.guidance.distance / 1852).toFixed(1)}`, cx + 175 * s, h - 40 * s, col, 14 * s, 'center');
  if (d.warningText) text(ctx, d.warningText, cx, cy + 120 * s, 'rgba(255,90,60,0.95)', 22 * s, 'center', 'middle', 800);
  ctx.restore();
}

// Fighter radar MFD (B-scope)
export function drawRadarMFD(ctx, w, h, d) {
  ctx.save();
  ctx.fillStyle = '#020604';
  ctx.fillRect(0, 0, w, h);
  if (!d.powered) {
    ctx.restore();
    return;
  }
  const s = h / 512;
  const g = 'rgba(80,255,120,0.9)';
  const x0 = 40 * s,
    y0 = 50 * s,
    sw = w - 80 * s,
    sh = h - 110 * s;
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.5 * s;
  ctx.strokeRect(x0, y0, sw, sh);
  ctx.setLineDash([4 * s, 8 * s]);
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + (sh * k) / 4);
    ctx.lineTo(x0 + sw, y0 + (sh * k) / 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + (sw * k) / 4, y0);
    ctx.lineTo(x0 + (sw * k) / 4, y0 + sh);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const range = 40 * 1852;
  for (const t of d.traffic || []) {
    const dx = t.x - d.x,
      dz = t.z - d.z;
    const dist = Math.hypot(dx, dz);
    let brg = (Math.atan2(dx, -dz) / DEG - d.heading + 540) % 360 - 180;
    if (Math.abs(brg) > 60 || dist > range) continue;
    const x = x0 + ((brg + 60) / 120) * sw;
    const y = y0 + sh - (dist / range) * sh;
    ctx.fillStyle = g;
    ctx.fillRect(x - 6 * s, y - 4 * s, 12 * s, 8 * s);
    text(ctx, `${Math.round(t.alt / 1000)}`, x + 10 * s, y, g, 12 * s);
  }
  // Sweep line
  const sweep = ((performance.now() / 1000) % 4) / 4;
  const sx = x0 + (sweep < 0.5 ? sweep * 2 : 2 - sweep * 2) * sw;
  ctx.strokeStyle = 'rgba(80,255,120,0.35)';
  ctx.beginPath();
  ctx.moveTo(sx, y0);
  ctx.lineTo(sx, y0 + sh);
  ctx.stroke();
  text(ctx, 'RWS  40', x0, 30 * s, g, 15 * s);
  text(ctx, `${(d.traffic || []).length} TGT`, x0 + sw, 30 * s, g, 15 * s, 'right');
  text(ctx, `FUEL ${Math.round(d.fuel)}`, x0, h - 30 * s, g, 15 * s);
  text(ctx, `${d.flapsName}  GEAR ${d.gear > 0.99 ? 'DN' : d.gear < 0.01 ? 'UP' : 'TRN'}`, x0 + sw, h - 30 * s, g, 15 * s, 'right');
  ctx.restore();
}

export { C as COLORS };
