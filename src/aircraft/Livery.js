// Livery definitions and procedural livery texture painting.
//
// Fuselage UV layout: u = position along the fuselage (nose -> tail),
// v = angle around the fuselage (0 top, 0.25 right side, 0.5 belly, 0.75 left side).
// Drawing helpers map "side coordinates" (metres from the nose, metres above the
// fuselage centre line) onto the canvas for each side so artwork and text read
// correctly on both sides of the aircraft.

import * as THREE from 'three';

export const LIVERIES = [
  // ---- Airlines --------------------------------------------------------------
  {
    id: 'aurelia', name: 'Aurelia Airways', for: ['commercial', 'private'],
    base: '#f7f8fa', belly: '#d7dce3', text: 'AURELIA', textColor: '#0b2f6b', textStyle: 'serif',
    stripe: { style: 'cheatline', color: '#0b2f6b', color2: '#e8a33c' },
    tail: { pattern: 'sunrise', color: '#0b2f6b', color2: '#e8a33c' }, engine: '#0b2f6b', wing: '#c9ced6',
  },
  {
    id: 'coastal', name: 'Coastal Air', for: ['commercial', 'private'],
    base: '#ffffff', belly: '#ffffff', text: 'coastal', textColor: '#008a9e', textStyle: 'round',
    stripe: { style: 'wave', color: '#00a7b5', color2: '#7fd6c9' },
    tail: { pattern: 'waves', color: '#00a7b5', color2: '#7fd6c9' }, engine: '#ffffff', wing: '#cfd3d8',
  },
  {
    id: 'northstar', name: 'Northstar', for: ['commercial', 'private'],
    base: '#e9edf2', belly: '#1c2a44', text: 'NORTHSTAR', textColor: '#1c2a44', textStyle: 'sans',
    stripe: { style: 'belly', color: '#1c2a44', color2: '#c8102e' },
    tail: { pattern: 'star', color: '#1c2a44', color2: '#ffffff' }, engine: '#1c2a44', wing: '#c3c8cf',
  },
  {
    id: 'meridian', name: 'Meridian Air', for: ['commercial'],
    base: '#ffffff', belly: '#e1e4e8', text: 'MERIDIAN', textColor: '#b3123c', textStyle: 'sans',
    stripe: { style: 'swoosh', color: '#b3123c', color2: '#5a0d22' },
    tail: { pattern: 'split', color: '#b3123c', color2: '#5a0d22' }, engine: '#b3123c', wing: '#c9ced6',
  },
  {
    id: 'islander', name: 'Island Hopper', for: ['commercial', 'private', 'cargo'],
    base: '#fff7e6', belly: '#2bb673', text: 'ISLAND HOPPER', textColor: '#ff6f3c', textStyle: 'round',
    stripe: { style: 'belly', color: '#2bb673', color2: '#ffc93c' },
    tail: { pattern: 'palm', color: '#ff6f3c', color2: '#ffc93c' }, engine: '#2bb673', wing: '#d2d6db',
  },
  {
    id: 'skycargo', name: 'SkyCargo Express', for: ['cargo', 'commercial'],
    base: '#f4f4f4', belly: '#9aa3ad', text: 'SKYCARGO', textColor: '#4b1d8f', textStyle: 'sans',
    stripe: { style: 'cheatline', color: '#4b1d8f', color2: '#ff7a00' },
    tail: { pattern: 'chevron', color: '#4b1d8f', color2: '#ff7a00' }, engine: '#4b1d8f', wing: '#c5cad0',
  },
  {
    id: 'sunset', name: 'Sunset Charter', for: ['commercial', 'private'],
    base: '#ffffff', belly: '#ffffff', text: 'SUNSET', textColor: '#d1495b', textStyle: 'serif',
    stripe: { style: 'gradient', color: '#edae49', color2: '#d1495b' },
    tail: { pattern: 'gradient', color: '#edae49', color2: '#d1495b' }, engine: '#d1495b', wing: '#cfd3d8',
  },
  {
    id: 'classic', name: 'Classic Silver', for: ['commercial', 'cargo', 'private'],
    base: '#c7ccd2', belly: '#a7adb5', text: 'AERO CLASSIC', textColor: '#1f3a93', textStyle: 'serif', metallic: true,
    stripe: { style: 'cheatline', color: '#1f3a93', color2: '#c0392b' },
    tail: { pattern: 'stripes', color: '#1f3a93', color2: '#c0392b' }, engine: '#c7ccd2', wing: '#b8bec5',
  },
  {
    id: 'house', name: 'Manufacturer House Colours', for: ['commercial', 'cargo', 'private'],
    base: '#ffffff', belly: '#ffffff', text: '', textColor: '#333333', textStyle: 'sans',
    stripe: { style: 'swoosh', color: '#2a6fdb', color2: '#16a085' },
    tail: { pattern: 'swoosh', color: '#2a6fdb', color2: '#16a085' }, engine: '#ffffff', wing: '#cfd3d8',
  },
  // ---- Cargo ----------------------------------------------------------------
  {
    id: 'aircorps', name: 'Aurelian Air Corps', for: ['cargo'],
    base: '#5f6b5a', belly: '#525c4e', text: 'AIR CORPS', textColor: '#20251f', textStyle: 'stencil', military: true,
    stripe: { style: 'none', color: '#20251f', color2: '#20251f' },
    tail: { pattern: 'roundel', color: '#20251f', color2: '#c8a400' }, engine: '#5f6b5a', wing: '#5f6b5a', matte: true,
  },
  {
    id: 'rescue', name: 'Search & Rescue', for: ['cargo', 'private'],
    base: '#f2f2f2', belly: '#f2f2f2', text: 'RESCUE', textColor: '#d62828', textStyle: 'sans',
    stripe: { style: 'band', color: '#ff6b00', color2: '#d62828' },
    tail: { pattern: 'cross', color: '#ff6b00', color2: '#ffffff' }, engine: '#ff6b00', wing: '#d0d4d9',
  },
  // ---- General aviation ------------------------------------------------------
  {
    id: 'trainer', name: 'Flight School Trainer', for: ['private'],
    base: '#fbfbfb', belly: '#fbfbfb', text: '', textColor: '#a4161a', textStyle: 'sans',
    stripe: { style: 'ga', color: '#a4161a', color2: '#e0a800' },
    tail: { pattern: 'gastripe', color: '#a4161a', color2: '#e0a800' }, engine: '#fbfbfb', wing: '#fbfbfb',
  },
  {
    id: 'skyblue', name: 'Sky Blue', for: ['private'],
    base: '#f4f7fb', belly: '#f4f7fb', text: '', textColor: '#1d4e89', textStyle: 'sans',
    stripe: { style: 'ga', color: '#1d4e89', color2: '#7fb3e6' },
    tail: { pattern: 'gastripe', color: '#1d4e89', color2: '#7fb3e6' }, engine: '#f4f7fb', wing: '#f4f7fb',
  },
  {
    id: 'executive', name: 'Executive Black', for: ['private'],
    base: '#15171b', belly: '#2a2e35', text: 'LYRA', textColor: '#c9a227', textStyle: 'serif',
    stripe: { style: 'cheatline', color: '#c9a227', color2: '#8a6d1d' },
    tail: { pattern: 'stripes', color: '#c9a227', color2: '#15171b' }, engine: '#15171b', wing: '#9aa0a8', metallic: true,
  },
  // ---- Military --------------------------------------------------------------
  {
    id: 'ghost', name: 'Ghost Grey', for: ['fighter'], camo: { pattern: 'counter', colors: ['#7d8590', '#8f97a1', '#6c737d'] },
    base: '#848c96', belly: '#a2a9b2', tail: { pattern: 'lowvis', color: '#5b626b', color2: '#5b626b' }, text: '', textColor: '#4a5058', engine: '#4b4f55', wing: '#848c96', matte: true,
  },
  {
    id: 'splinter', name: 'Splinter Camo', for: ['fighter'], camo: { pattern: 'splinter', colors: ['#6b7a5c', '#4a5640', '#9a9a7a', '#2f3a2c'] },
    base: '#6b7a5c', belly: '#b9c0b1', tail: { pattern: 'lowvis', color: '#2f3a2c', color2: '#2f3a2c' }, text: '', textColor: '#2f3a2c', engine: '#3d4239', wing: '#6b7a5c', matte: true,
  },
  {
    id: 'desert', name: 'Desert Storm', for: ['fighter', 'cargo'], camo: { pattern: 'blob', colors: ['#c2a878', '#9c7f55', '#e0cfa6'] },
    base: '#c2a878', belly: '#d9cbb0', tail: { pattern: 'lowvis', color: '#6e5a3c', color2: '#6e5a3c' }, text: '', textColor: '#6e5a3c', engine: '#77684d', wing: '#c2a878', matte: true,
  },
  {
    id: 'naval', name: 'Navy Blue', for: ['fighter'], camo: { pattern: 'counter', colors: ['#2c3e5a', '#34486a', '#22324a'] },
    base: '#2c3e5a', belly: '#9fb1c8', tail: { pattern: 'lowvis', color: '#c9d3e0', color2: '#c9d3e0' }, text: '', textColor: '#c9d3e0', engine: '#2b2f36', wing: '#2c3e5a', matte: true,
  },
  {
    id: 'demo', name: 'Display Team', for: ['fighter'], camo: { pattern: 'demo', colors: ['#d90429', '#ffffff', '#0b2545'] },
    base: '#ffffff', belly: '#0b2545', tail: { pattern: 'demo', color: '#d90429', color2: '#0b2545' }, text: '', textColor: '#0b2545', engine: '#2b2f36', wing: '#ffffff',
  },
  {
    id: 'tiger', name: 'Tiger Meet', for: ['fighter'], camo: { pattern: 'tiger', colors: ['#f2a007', '#111111'] },
    base: '#f2a007', belly: '#f2a007', tail: { pattern: 'tiger', color: '#f2a007', color2: '#111111' }, text: '', textColor: '#111111', engine: '#2b2f36', wing: '#f2a007',
  },
];

// Default liveries per aircraft
export const AIRCRAFT_LIVERIES = {
  k172: ['trainer', 'skyblue', 'rescue', 'islander', 'aurelia'],
  lj45: ['executive', 'house', 'aurelia', 'northstar', 'sunset', 'coastal'],
  rj900: ['coastal', 'islander', 'aurelia', 'northstar', 'meridian', 'house', 'sunset'],
  mj320: ['aurelia', 'meridian', 'coastal', 'northstar', 'sunset', 'islander', 'classic', 'house'],
  mw350: ['aurelia', 'meridian', 'northstar', 'sunset', 'classic', 'house'],
  fx16: ['ghost', 'splinter', 'desert', 'naval', 'demo', 'tiger'],
  ef2: ['ghost', 'splinter', 'naval', 'demo', 'tiger', 'desert'],
  t74f: ['skycargo', 'classic', 'northstar', 'house', 'aurelia'],
  ct130: ['aircorps', 'rescue', 'desert', 'skycargo', 'islander'],
};

export const TAIL_PATTERNS = ['solid', 'split', 'stripes', 'sunrise', 'star', 'chevron', 'gradient', 'waves', 'swoosh', 'circle', 'cross', 'palm', 'roundel'];
export const STRIPE_STYLES = ['none', 'cheatline', 'belly', 'swoosh', 'wave', 'gradient', 'band'];

export function getLivery(id) {
  return LIVERIES.find((l) => l.id === id) || null;
}

// Build a livery object from a custom definition saved by the player.
export function resolveLivery(liveryOrId) {
  if (!liveryOrId) return LIVERIES[0];
  if (typeof liveryOrId === 'string') return getLivery(liveryOrId) || LIVERIES[0];
  return liveryOrId;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fontFor(style, sizePx) {
  switch (style) {
    case 'serif':
      return `italic 700 ${sizePx}px Georgia, 'Times New Roman', serif`;
    case 'round':
      return `700 ${sizePx}px 'Trebuchet MS', 'Arial Rounded MT Bold', Verdana, sans-serif`;
    case 'stencil':
      return `900 ${sizePx}px Impact, 'Arial Black', sans-serif`;
    default:
      return `800 ${sizePx}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  }
}

class SidePainter {
  constructor(ctx, W, H, length, radius) {
    this.ctx = ctx;
    this.W = W;
    this.H = H;
    this.L = length;
    this.r = radius;
    this.sx = W / length;
    this.sy = H / (2 * Math.PI * radius);
  }
  // Set the canvas transform so that (X metres from nose, Y metres above centre) map to this side.
  begin(side) {
    const c = this.ctx;
    c.save();
    if (side === 'right') c.setTransform(this.sx, 0, 0, -this.sy, 0, this.H * 0.25);
    else c.setTransform(this.sx, 0, 0, this.sy, 0, this.H * 0.75);
  }
  end() {
    this.ctx.restore();
  }
  both(fn) {
    for (const side of ['right', 'left']) {
      this.begin(side);
      fn(this.ctx, side);
      this.end();
    }
  }
  // Draw readable text centred at (X, Y) with cap height in metres.
  text(side, str, X, Y, height, color, style, align = 'center') {
    if (!str) return;
    const c = this.ctx;
    c.save();
    c.translate(X, Y);
    // glyph space -> side space: up is +Y, reading direction toward tail on the left side, toward nose on the right
    const k = height / 100;
    if (side === 'right') c.scale(-k, -k);
    else c.scale(k, -k);
    c.font = fontFor(style, 130);
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(str, 0, 0);
    c.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintCamo(ctx, W, H, camo, seed) {
  const r = rng(seed);
  const cols = camo.colors;
  ctx.fillStyle = cols[0];
  ctx.fillRect(0, 0, W, H);
  if (camo.pattern === 'counter') {
    // Two-tone counter-shading with soft blotches
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = cols[1 + (i % (cols.length - 1))];
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.ellipse(r() * W, r() * H, 30 + r() * 120, 20 + r() * 60, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (camo.pattern === 'splinter') {
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = cols[1 + Math.floor(r() * (cols.length - 1))];
      ctx.beginPath();
      const x = r() * W,
        y = r() * H;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) ctx.lineTo(x + (r() - 0.5) * 260, y + (r() - 0.5) * 200);
      ctx.closePath();
      ctx.fill();
    }
  } else if (camo.pattern === 'blob') {
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = cols[1 + Math.floor(r() * (cols.length - 1))];
      ctx.beginPath();
      const x = r() * W,
        y = r() * H;
      ctx.moveTo(x, y);
      for (let a = 0; a < Math.PI * 2; a += 0.6) {
        const rr = 25 + r() * 50;
        ctx.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (camo.pattern === 'demo') {
    ctx.fillStyle = cols[1];
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = cols[0];
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const y0 = (i / 6) * H;
      ctx.moveTo(0, y0);
      ctx.lineTo(W, y0 + H * 0.12);
      ctx.lineTo(W, y0 + H * 0.2);
      ctx.lineTo(0, y0 + H * 0.08);
      ctx.fill();
    }
  } else if (camo.pattern === 'tiger') {
    ctx.fillStyle = cols[1];
    for (let i = 0; i < 90; i++) {
      const x = r() * W;
      const y = r() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 20 + r() * 30, y + 30 + r() * 30, x + (r() - 0.5) * 30, y + 70 + r() * 50);
      ctx.lineTo(x + 8, y + 60);
      ctx.quadraticCurveTo(x + 18, y + 25, x + 6, y);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Fuselage texture
// ---------------------------------------------------------------------------

export function paintFuselageTexture(spec, livery, opts = {}) {
  const m = spec.model;
  const f = m.fuselage;
  const length = f.tailZ - f.noseZ;
  const radius = f.radius || Math.max(f.width || 1, f.height || 1) / 2;
  const W = opts.width || (length > 50 ? 4096 : 2048);
  const H = opts.height || 512;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const P = new SidePainter(ctx, W, H, length, radius);
  const isFighter = spec.category === 'fighter';
  const isGA = m.style === 'ga';

  // Base & belly
  if (livery.camo) paintCamo(ctx, W, H, livery.camo, hashStr(spec.id + livery.id));
  else {
    ctx.fillStyle = livery.base;
    ctx.fillRect(0, 0, W, H);
  }
  // Belly band (v 0.37..0.63 => below the side centreline)
  if (!livery.camo || livery.belly) {
    const g = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.5);
    g.addColorStop(0, livery.camo ? 'rgba(0,0,0,0)' : livery.base);
    g.addColorStop(0.35, livery.belly);
    g.addColorStop(1, livery.belly);
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.3, W, H * 0.2);
    const g2 = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.7);
    g2.addColorStop(0, livery.belly);
    g2.addColorStop(0.65, livery.belly);
    g2.addColorStop(1, livery.camo ? 'rgba(0,0,0,0)' : livery.base);
    ctx.fillStyle = g2;
    ctx.fillRect(0, H * 0.5, W, H * 0.2);
  }

  const st = livery.stripe || { style: 'none' };
  const win = m.paxWindows;
  const winY = win ? win.y : radius * 0.2;
  const noseEnd = f.noseLength || 3;
  const tailStart = length - (f.tailLength || 5);

  // Stripes
  P.both((c) => {
    switch (st.style) {
      case 'cheatline': {
        c.fillStyle = st.color;
        c.fillRect(noseEnd * 0.5, winY - radius * 0.32, length * 0.92 - noseEnd * 0.5, radius * 0.16);
        c.fillStyle = st.color2;
        c.fillRect(noseEnd * 0.5, winY - radius * 0.42, length * 0.92 - noseEnd * 0.5, radius * 0.06);
        break;
      }
      case 'belly': {
        c.fillStyle = st.color;
        c.beginPath();
        c.moveTo(0, -radius * 0.25);
        c.lineTo(length, radius * 0.1);
        c.lineTo(length, -radius * 2);
        c.lineTo(0, -radius * 2);
        c.fill();
        c.fillStyle = st.color2;
        c.beginPath();
        c.moveTo(0, -radius * 0.18);
        c.lineTo(length, radius * 0.17);
        c.lineTo(length, radius * 0.1);
        c.lineTo(0, -radius * 0.25);
        c.fill();
        break;
      }
      case 'swoosh': {
        c.fillStyle = st.color;
        c.beginPath();
        c.moveTo(length * 0.35, -radius);
        c.quadraticCurveTo(length * 0.7, -radius * 0.95, length, radius * 0.9);
        c.lineTo(length, radius * 0.2);
        c.quadraticCurveTo(length * 0.78, -radius * 0.6, length * 0.35, -radius);
        c.fill();
        c.fillStyle = st.color2;
        c.beginPath();
        c.moveTo(length * 0.5, -radius);
        c.quadraticCurveTo(length * 0.8, -radius * 0.9, length, radius * 0.15);
        c.lineTo(length, -radius * 0.2);
        c.quadraticCurveTo(length * 0.85, -radius * 0.85, length * 0.5, -radius);
        c.fill();
        break;
      }
      case 'wave': {
        for (let k = 0; k < 2; k++) {
          c.fillStyle = k ? st.color2 : st.color;
          c.beginPath();
          c.moveTo(0, -radius * (0.55 + k * 0.12));
          for (let X = 0; X <= length; X += length / 40) c.lineTo(X, -radius * (0.55 + k * 0.12) + Math.sin((X / length) * Math.PI * 3) * radius * 0.12);
          c.lineTo(length, -radius * 2);
          c.lineTo(0, -radius * 2);
          c.fill();
        }
        break;
      }
      case 'gradient': {
        const g = c.createLinearGradient(0, 0, length, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, st.color);
        g.addColorStop(1, st.color2);
        c.fillStyle = g;
        c.fillRect(0, -radius * 1.5, length, radius * 0.95);
        break;
      }
      case 'band': {
        c.fillStyle = st.color;
        c.fillRect(length * 0.55, -radius * 2, length * 0.12, radius * 4);
        c.fillRect(noseEnd * 0.9, -radius * 2, length * 0.05, radius * 4);
        break;
      }
      case 'ga': {
        c.fillStyle = st.color;
        c.beginPath();
        c.moveTo(0.2, -0.05);
        c.lineTo(length, 0.25);
        c.lineTo(length, 0.12);
        c.lineTo(0.2, -0.17);
        c.fill();
        c.fillStyle = st.color2;
        c.beginPath();
        c.moveTo(0.2, -0.22);
        c.lineTo(length, 0.07);
        c.lineTo(length, 0.01);
        c.lineTo(0.2, -0.28);
        c.fill();
        break;
      }
    }
  });

  // Passenger windows & doors
  if (win) {
    P.both((c) => {
      const h = win.size * (win.oval ? 1.5 : 1.35);
      const w = win.size * (win.oval ? 1.1 : 0.85);
      for (let X = win.from - f.noseZ; X <= win.to - f.noseZ; X += win.spacing) {
        // skip windows where doors are
        if (m.doors && m.doors.some((d) => Math.abs(d - f.noseZ - X) < 0.9)) continue;
        c.fillStyle = '#1b2430';
        roundRect(c, X - w / 2, winY - h / 2, w, h, w * 0.45);
        c.fill();
        c.fillStyle = 'rgba(160,190,220,0.35)';
        roundRect(c, X - w / 2 + w * 0.15, winY + h * 0.05, w * 0.45, h * 0.35, w * 0.2);
        c.fill();
      }
    });
  }
  if (m.upperWindows) {
    const uw = m.upperWindows;
    const hump = f.hump ? f.hump.height : 0;
    P.both((c) => {
      for (let X = uw.from - f.noseZ; X <= uw.to - f.noseZ; X += uw.spacing) {
        c.fillStyle = '#1b2430';
        roundRect(c, X - 0.13, radius + hump * 0.45, 0.26, 0.36, 0.1);
        c.fill();
      }
    });
  }
  if (m.doors) {
    P.both((c) => {
      for (const d of m.doors) {
        const X = d - f.noseZ;
        c.strokeStyle = 'rgba(40,45,55,0.75)';
        c.lineWidth = 0.035;
        roundRect(c, X - 0.45, winY - radius * 0.62, 0.9, radius * 0.95 + 0.4, 0.15);
        c.stroke();
        c.fillStyle = '#1b2430';
        roundRect(c, X - 0.12, winY - 0.12, 0.24, 0.3, 0.08);
        c.fill();
      }
    });
  }

  // Cockpit windows (airliners / cargo / bizjets)
  if (!isFighter && !isGA) {
    const cx = (spec.eye[2] - f.noseZ) - 0.35;
    const cy = spec.eye[1] - 0.05;
    P.both((c) => {
      c.fillStyle = '#121820';
      const s = Math.min(1, radius / 2);
      c.beginPath();
      c.moveTo(cx - 1.25 * s, cy - 0.15 * s);
      c.lineTo(cx - 0.55 * s, cy + 0.42 * s);
      c.lineTo(cx + 0.95 * s, cy + 0.42 * s);
      c.lineTo(cx + 1.05 * s, cy - 0.1 * s);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(120,150,180,0.35)';
      c.fillRect(cx - 0.7 * s, cy + 0.12 * s, 0.6 * s, 0.12 * s);
      // frame posts
      c.fillStyle = livery.base;
      c.fillRect(cx - 0.25 * s, cy - 0.2 * s, 0.07 * s, 0.7 * s);
      c.fillRect(cx + 0.45 * s, cy - 0.2 * s, 0.07 * s, 0.7 * s);
    });
    // Windshield across the top of the nose (v around 0 / 1): draw as band
    const wx0 = (cx - 1.7) * P.sx;
    const wx1 = (cx - 0.9) * P.sx;
    ctx.fillStyle = '#121820';
    ctx.beginPath();
    ctx.moveTo(wx0, H * 0.115);
    ctx.lineTo(wx1, H * 0.13);
    ctx.lineTo(wx1, H * 0.0);
    ctx.lineTo(wx0, H * 0.0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wx0, H * 0.885);
    ctx.lineTo(wx1, H * 0.87);
    ctx.lineTo(wx1, H);
    ctx.lineTo(wx0, H);
    ctx.fill();
    ctx.fillStyle = livery.base;
    ctx.fillRect(wx0, H * 0.0, wx1 - wx0, H * 0.008);
    ctx.fillRect(wx0, H * 0.992, wx1 - wx0, H * 0.008);
  }

  // GA cabin windows
  if (isGA) {
    P.both((c) => {
      c.fillStyle = '#1a2129';
      c.beginPath();
      // windshield side + two side windows
      c.moveTo(1.55, 0.18);
      c.lineTo(2.05, 0.66);
      c.lineTo(3.0, 0.66);
      c.lineTo(3.0, 0.12);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(3.1, 0.12);
      c.lineTo(3.1, 0.66);
      c.lineTo(4.05, 0.62);
      c.lineTo(4.45, 0.18);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(140,170,200,0.3)';
      c.fillRect(2.3, 0.4, 0.5, 0.1);
      c.fillRect(3.3, 0.4, 0.5, 0.1);
    });
    // windshield on top
    ctx.fillStyle = '#1a2129';
    ctx.fillRect(1.5 * P.sx, 0, 0.6 * P.sx, H * 0.09);
    ctx.fillRect(1.5 * P.sx, H * 0.91, 0.6 * P.sx, H * 0.09);
  }

  // Airline name
  if (livery.text && !isFighter) {
    const len = livery.text.length;
    const startX = win ? Math.max(noseEnd + 1, (win.from - f.noseZ) + length * 0.06) : noseEnd + length * 0.12;
    const endX = win ? Math.min(tailStart, win.to - f.noseZ) : tailStart;
    const centerX = (startX + endX) / 2;
    const maxH = radius * 0.42;
    const textH = Math.min(maxH, ((endX - startX) / Math.max(4, len)) * 1.15);
    const ty = win ? winY + radius * 0.42 : radius * 0.25;
    for (const side of ['right', 'left']) {
      P.begin(side);
      P.text(side, livery.text, centerX, ty, textH, livery.textColor, livery.textStyle);
      P.end();
    }
  }

  // Registration / national markings
  const reg = opts.registration || (isFighter ? '' : `${spec.callsignPrefix === 'N' ? 'AX-' : 'AX-'}${spec.id.toUpperCase().slice(0, 3)}`);
  if (reg) {
    for (const side of ['right', 'left']) {
      P.begin(side);
      P.text(side, reg, length - (f.tailLength || 4) * 0.55, winY - radius * 0.05, Math.max(0.18, radius * 0.13), isGA ? '#222' : 'rgba(30,30,40,0.75)', 'sans');
      P.end();
    }
  }
  if (isFighter || livery.military) {
    // Roundels and serial
    for (const side of ['right', 'left']) {
      P.begin(side);
      const c = ctx;
      const X = length * 0.62;
      c.fillStyle = livery.camo ? 'rgba(30,35,30,0.55)' : '#0b2545';
      c.beginPath();
      c.arc(X, 0, radius * 0.38, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = livery.camo ? 'rgba(200,200,190,0.5)' : '#ffffff';
      c.beginPath();
      c.arc(X, 0, radius * 0.25, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = livery.camo ? 'rgba(30,35,30,0.6)' : '#d90429';
      c.beginPath();
      c.arc(X, 0, radius * 0.11, 0, Math.PI * 2);
      c.fill();
      P.text(side, isFighter ? (spec.id === 'fx16' ? '86-0216' : '31+07') : 'AC-130', length * 0.85, -radius * 0.1, radius * 0.16, livery.textColor || '#222', 'stencil');
      P.end();
    }
  }

  // Subtle panel lines
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (let X = 0; X < length; X += isGA ? 0.8 : 1.6) {
    ctx.beginPath();
    ctx.moveTo(X * P.sx, 0);
    ctx.lineTo(X * P.sx, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Vertical tail texture (planar mapped: u along length, v up the fin)
// ---------------------------------------------------------------------------

export function paintTailTexture(spec, livery) {
  const S = 512;
  const canvas = makeCanvas(S, S);
  const c = canvas.getContext('2d');
  const t = livery.tail || { pattern: 'solid', color: livery.base, color2: livery.base };
  if (livery.camo) paintCamo(c, S, S, livery.camo, hashStr(spec.id + livery.id + 'tail'));
  else {
    c.fillStyle = livery.base;
    c.fillRect(0, 0, S, S);
  }
  // Coordinates: x 0 (front) .. S (rear), y 0 (fin root) .. S (fin tip) -> canvas y flipped later via uv
  const tri = () => {
    c.beginPath();
    c.rect(0, 0, S, S);
  };
  c.save();
  switch (t.pattern) {
    case 'solid':
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      break;
    case 'split':
      c.fillStyle = t.color;
      c.beginPath();
      c.moveTo(0, S * 0.2);
      c.lineTo(S, S * 0.75);
      c.lineTo(S, S);
      c.lineTo(0, S);
      c.fill();
      c.fillStyle = t.color2;
      c.beginPath();
      c.moveTo(0, S * 0.2);
      c.lineTo(S, S * 0.75);
      c.lineTo(S, S * 0.6);
      c.lineTo(0, S * 0.08);
      c.fill();
      break;
    case 'stripes':
      for (let i = 0; i < 3; i++) {
        c.fillStyle = i % 2 ? t.color2 : t.color;
        c.fillRect(0, S * (0.45 + i * 0.12), S, S * 0.08);
      }
      break;
    case 'sunrise': {
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color2;
      c.beginPath();
      c.arc(S * 0.62, S * 0.42, S * 0.17, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * 0.05 + (i / 8) * Math.PI * 1.1;
        c.save();
        c.translate(S * 0.62, S * 0.42);
        c.rotate(a);
        c.fillRect(S * 0.22, -S * 0.015, S * 0.18, S * 0.03);
        c.restore();
      }
      break;
    }
    case 'star': {
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color2;
      c.beginPath();
      const cx = S * 0.6,
        cy = S * 0.55,
        R = S * 0.24;
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? R * 0.42 : R;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      c.closePath();
      c.fill();
      break;
    }
    case 'chevron':
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color2;
      for (let i = 0; i < 2; i++) {
        c.beginPath();
        const o = i * S * 0.22;
        c.moveTo(S * 0.15 + o, S * 0.15);
        c.lineTo(S * 0.45 + o, S * 0.5);
        c.lineTo(S * 0.15 + o, S * 0.85);
        c.lineTo(S * 0.27 + o, S * 0.85);
        c.lineTo(S * 0.57 + o, S * 0.5);
        c.lineTo(S * 0.27 + o, S * 0.15);
        c.fill();
      }
      break;
    case 'gradient': {
      const g = c.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, t.color);
      g.addColorStop(1, t.color2);
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      break;
    }
    case 'waves':
      for (let k = 0; k < 4; k++) {
        c.fillStyle = k % 2 ? t.color2 : t.color;
        c.beginPath();
        c.moveTo(0, S);
        for (let x = 0; x <= S; x += 8) c.lineTo(x, S * (0.25 + k * 0.17) + Math.sin(x * 0.025 + k) * S * 0.04);
        c.lineTo(S, S);
        c.fill();
      }
      break;
    case 'swoosh':
      c.fillStyle = t.color;
      c.beginPath();
      c.moveTo(0, S * 0.1);
      c.quadraticCurveTo(S * 0.4, S * 0.9, S, S);
      c.lineTo(S, S * 0.6);
      c.quadraticCurveTo(S * 0.5, S * 0.55, 0, S * 0.1);
      c.fill();
      c.fillStyle = t.color2;
      c.beginPath();
      c.moveTo(0, S * 0.05);
      c.quadraticCurveTo(S * 0.5, S * 0.45, S, S * 0.5);
      c.lineTo(S, S * 0.4);
      c.quadraticCurveTo(S * 0.5, S * 0.35, 0, S * 0.05);
      c.fill();
      break;
    case 'circle':
    case 'roundel': {
      if (t.pattern === 'circle') {
        c.fillStyle = t.color;
        c.fillRect(0, 0, S, S);
      }
      c.fillStyle = t.color2;
      c.beginPath();
      c.arc(S * 0.55, S * 0.5, S * 0.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = t.color;
      c.beginPath();
      c.arc(S * 0.55, S * 0.5, S * 0.1, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case 'cross':
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color2;
      c.fillRect(S * 0.47, S * 0.3, S * 0.14, S * 0.46);
      c.fillRect(S * 0.31, S * 0.46, S * 0.46, S * 0.14);
      break;
    case 'palm': {
      c.fillStyle = t.color;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color2;
      c.beginPath();
      c.arc(S * 0.62, S * 0.66, S * 0.12, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = S * 0.025;
      c.beginPath();
      c.moveTo(S * 0.5, S * 0.15);
      c.quadraticCurveTo(S * 0.47, S * 0.45, S * 0.55, S * 0.62);
      c.stroke();
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(S * 0.55, S * 0.62);
        const a = -0.4 + i * 0.55;
        c.quadraticCurveTo(S * (0.55 + Math.cos(a) * 0.12), S * (0.62 + Math.sin(a) * 0.05 + 0.08), S * (0.55 + Math.cos(a) * 0.22), S * (0.62 - Math.sin(a) * 0.1 - 0.05));
        c.stroke();
      }
      break;
    }
    case 'gastripe':
      c.fillStyle = t.color;
      c.fillRect(0, S * 0.55, S, S * 0.12);
      c.fillStyle = t.color2;
      c.fillRect(0, S * 0.7, S, S * 0.05);
      break;
    case 'lowvis':
      c.fillStyle = t.color;
      c.globalAlpha = 0.6;
      c.font = `900 ${S * 0.16}px Impact, 'Arial Black', sans-serif`;
      c.textAlign = 'center';
      c.fillText('AX', S * 0.55, S * 0.55);
      c.globalAlpha = 1;
      break;
    case 'demo':
      c.fillStyle = t.color2;
      c.fillRect(0, 0, S, S);
      c.fillStyle = t.color;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(0, S * (0.1 + i * 0.25));
        c.lineTo(S, S * (0.3 + i * 0.25));
        c.lineTo(S, S * (0.4 + i * 0.25));
        c.lineTo(0, S * (0.2 + i * 0.25));
        c.fill();
      }
      break;
    case 'tiger':
      break;
  }
  c.restore();
  tri();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Simple solid-colour + subtle panel texture for wings
let _wingTexCache = new Map();
export function wingTexture(color) {
  if (_wingTexCache.has(color)) return _wingTexCache.get(color);
  const S = 256;
  const canvas = makeCanvas(S, S);
  const c = canvas.getContext('2d');
  c.fillStyle = color;
  c.fillRect(0, 0, S, S);
  c.globalAlpha = 0.08;
  c.strokeStyle = '#000';
  for (let i = 0; i < S; i += 32) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, S);
    c.stroke();
  }
  for (let i = 0; i < S; i += 64) {
    c.beginPath();
    c.moveTo(0, i);
    c.lineTo(S, i);
    c.stroke();
  }
  c.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _wingTexCache.set(color, tex);
  return tex;
}
