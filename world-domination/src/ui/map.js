// Canvas world map: projection, pan/zoom, hit testing and the political overlays.
import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
import * as topojson from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';
import { TERRITORIES, TERR } from '../engine/world.js';

const W = 2000;
const LAT_TOP = 84, LAT_BOTTOM = -58;

export class WorldMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.proj = geoMercator().scale(W / (2 * Math.PI)).translate([W / 2, 0]);
    const yTop = this.proj([0, LAT_TOP])[1], yBot = this.proj([0, LAT_BOTTOM])[1];
    this.proj.translate([W / 2, -yTop]);
    this.H = yBot - yTop;
    this.W = W;
    this.view = { z: 1, x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    this.colorFn = () => '#555';
    this.overlay = null; // function(ctx, map) for extra drawing
    this.needsDraw = true;
    this.ownerRev = -1;
    this.labels = [];
    this.listeners = {};
    this.build();
    this.attach();
    this.resize();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  build() {
    const geoms = topo.objects.countries.geometries;
    this.terrOfGeom = new Map();
    for (const t of TERRITORIES) for (const gi of t.geo) this.terrOfGeom.set(geoms[gi], t.id);
    this.paths = {};
    this.bounds = {};
    this.mainBounds = {};
    this.tiny = new Set();
    this.centers = {};
    const pathGen = geoPath(this.proj);
    for (const t of TERRITORIES) {
      const merged = topojson.merge(topo, t.geo.map((i) => geoms[i]));
      const p = new Path2D();
      geoPath(this.proj, p)(merged);
      this.paths[t.id] = p;
      const b = pathGen.bounds(merged);
      this.bounds[t.id] = b;
      // bounds of the biggest landmass, for framing the camera
      let best = null, bestA = -1;
      for (const poly of merged.coordinates) {
        const f = { type: 'Polygon', coordinates: poly };
        const a = pathGen.area(f);
        if (a > bestA) { bestA = a; best = f; }
      }
      this.mainBounds[t.id] = best ? pathGen.bounds(best) : b;
      const area = pathGen.area(merged);
      if (area < 6) this.tiny.add(t.id);
      this.centers[t.id] = this.proj([t.lng, t.lat]);
    }
    const coast = new Path2D();
    geoPath(this.proj, coast)(topojson.mesh(topo, topo.objects.countries, (a, b) => a === b));
    this.coast = coast;
    const internal = new Path2D();
    geoPath(this.proj, internal)(topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b && this.terrOfGeom.get(a) !== this.terrOfGeom.get(b)));
    this.internal = internal;
    const grat = new Path2D();
    geoPath(this.proj, grat)(geoGraticule10());
    this.graticule = grat;
    this.hitCtx = document.createElement('canvas').getContext('2d');
  }

  // Thick borders between different owners, rebuilt when ownership changes
  updateOwners(owners, rev) {
    if (rev === this.ownerRev) return;
    this.ownerRev = rev;
    this.owners = owners;
    const geoms = topo.objects.countries.geometries;
    const ownerOf = (g) => owners[this.terrOfGeom.get(g)] || null;
    const p = new Path2D();
    geoPath(this.proj, p)(topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b && ownerOf(a) !== ownerOf(b)));
    this.nationBorders = p;
    void geoms;
    this.needsDraw = true;
  }

  setLabels(labels) { this.labels = labels; this.needsDraw = true; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.dpr = dpr;
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.minZ = Math.max(this.cw / W, this.ch / this.H) * 0.98;
    if (this.view.z < this.minZ || !this.fitted) { this.fitAll(); this.fitted = true; }
    this.clampView();
    this.needsDraw = true;
  }
  fitAll() {
    this.view.z = Math.max(this.minZ, Math.min(this.cw / W, this.ch / this.H));
    this.view.x = (this.cw - W * this.view.z) / 2;
    this.view.y = (this.ch - this.H * this.view.z) / 2;
    this.clampView();
  }
  clampView() {
    const v = this.view;
    v.z = Math.max(this.minZ || 0.1, Math.min(60, v.z));
    const mw = W * v.z, mh = this.H * v.z;
    v.x = mw <= this.cw ? (this.cw - mw) / 2 : Math.min(0, Math.max(this.cw - mw, v.x));
    v.y = mh <= this.ch ? (this.ch - mh) / 2 : Math.min(0, Math.max(this.ch - mh, v.y));
  }
  toWorld(px, py) { return [(px - this.view.x) / this.view.z, (py - this.view.y) / this.view.z]; }
  toScreen(wx, wy) { return [wx * this.view.z + this.view.x, wy * this.view.z + this.view.y]; }

  zoomAt(px, py, factor) {
    const [wx, wy] = this.toWorld(px, py);
    this.view.z *= factor;
    this.clampView();
    this.view.x = px - wx * this.view.z;
    this.view.y = py - wy * this.view.z;
    this.clampView();
    this.needsDraw = true;
  }
  flyTo(tid, zoom) {
    const b = this.mainBounds[tid] || this.bounds[tid];
    if (!b) return;
    const ins = this.insets || { left: 0, right: 0 };
    const vw = Math.max(200, this.cw - ins.left - ins.right);
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    const span = Math.max(b[1][0] - b[0][0], (b[1][1] - b[0][1]) * 1.4, 18);
    const z = zoom || Math.min(14, Math.max(this.minZ, (vw * 0.5) / span));
    this.anim = { from: { ...this.view }, to: { z, x: ins.left + vw / 2 - cx * z, y: this.ch / 2 - cy * z }, t: 0 };
  }

  pick(px, py) {
    const [wx, wy] = this.toWorld(px, py);
    const ctx = this.hitCtx;
    const r = 7 / this.view.z;
    for (const id of this.tiny) {
      const c = this.centers[id];
      if ((c[0] - wx) ** 2 + (c[1] - wy) ** 2 < r * r) return id;
    }
    for (const t of TERRITORIES) {
      const b = this.bounds[t.id];
      if (wx < b[0][0] || wx > b[1][0] || wy < b[0][1] || wy > b[1][1]) continue;
      if (ctx.isPointInPath(this.paths[t.id], wx, wy)) return t.id;
    }
    return null;
  }

  attach() {
    const c = this.canvas;
    let drag = null, moved = false, pinch = null;
    const pointers = new Map();
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        drag = null;
      } else {
        drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
        moved = false;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch.d);
        pinch.d = d;
        moved = true;
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) {
          this.view.x = drag.vx + dx; this.view.y = drag.vy + dy;
          this.clampView();
          this.needsDraw = true;
          this.anim = null;
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const id = this.pick(e.clientX - r.left, e.clientY - r.top);
        if (id !== this.hover) { this.hover = id; this.needsDraw = true; }
        this.emit('hover', id, e.clientX, e.clientY);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && !moved && e.type === 'pointerup') {
        const r = c.getBoundingClientRect();
        const id = this.pick(e.clientX - r.left, e.clientY - r.top);
        this.emit('click', id, e);
      }
      if (!pointers.size) drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.needsDraw = true; } this.emit('hover', null); });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.emit('rightclick', this.pick(e.clientX - r.left, e.clientY - r.top), e); });
    window.addEventListener('resize', () => this.resize());
  }

  frame(dt) {
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / 0.7);
      const k = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
      const lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * k;
      this.view.z = Math.exp(lz);
      this.view.x = a.from.x + (a.to.x - a.from.x) * k;
      this.view.y = a.from.y + (a.to.y - a.from.y) * k;
      this.clampView();
      this.needsDraw = true;
      if (a.t >= 1) this.anim = null;
    }
    if (this.autoPan) {
      this.view.x -= dt * 12;
      if (this.view.x < this.cw - W * this.view.z) this.view.x = 0;
      this.needsDraw = true;
    }
    if (this.pulse) this.needsDraw = true;
    if (this.needsDraw) { this.draw(); this.needsDraw = false; }
  }

  draw() {
    const ctx = this.ctx, v = this.view, dpr = this.dpr;
    const time = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const ocean = css.getPropertyValue('--ocean').trim() || '#0b1d33';
    const ocean2 = css.getPropertyValue('--ocean2').trim() || '#06111f';
    const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, ocean); g.addColorStop(1, ocean2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    const px = 1 / v.z; // one screen pixel in world units

    ctx.strokeStyle = 'rgba(140,180,230,0.07)';
    ctx.lineWidth = px;
    ctx.stroke(this.graticule);

    // visible window for culling
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.cw, this.ch);
    const visible = (id) => { const b = this.bounds[id]; return !(b[1][0] < x0 || b[0][0] > x1 || b[1][1] < y0 || b[0][1] > y1); };

    for (const t of TERRITORIES) {
      if (!visible(t.id)) continue;
      const col = this.colorFn(t.id);
      ctx.fillStyle = col.fill || col;
      ctx.fill(this.paths[t.id]);
      if (col.hatch) {
        ctx.save();
        ctx.clip(this.paths[t.id]);
        ctx.strokeStyle = col.hatch;
        ctx.lineWidth = 3 * px;
        const b = this.bounds[t.id];
        const step = 9 * px;
        ctx.beginPath();
        for (let x = b[0][0] - (b[1][1] - b[0][1]); x < b[1][0]; x += step) {
          ctx.moveTo(x, b[1][1]); ctx.lineTo(x + (b[1][1] - b[0][1]), b[0][1]);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // borders
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.6 * px;
    ctx.stroke(this.internal);
    if (this.nationBorders) {
      ctx.strokeStyle = 'rgba(10,14,22,0.85)';
      ctx.lineWidth = 1.4 * px;
      ctx.stroke(this.nationBorders);
    }
    ctx.strokeStyle = 'rgba(160,200,255,0.25)';
    ctx.lineWidth = 0.8 * px;
    ctx.stroke(this.coast);

    // tiny islands get a dot so they can be seen and clicked
    for (const id of this.tiny) {
      if (!visible(id)) continue;
      const c = this.centers[id];
      const col = this.colorFn(id);
      ctx.beginPath();
      ctx.arc(c[0], c[1], Math.max(2.2 * px, 0.6), 0, Math.PI * 2);
      ctx.fillStyle = col.fill || col;
      ctx.fill();
      ctx.lineWidth = 0.8 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }

    if (this.highlight?.length) {
      ctx.save();
      ctx.strokeStyle = this.highlightColor || 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      for (const id of this.highlight) ctx.stroke(this.paths[id]);
      ctx.restore();
    }
    if (this.hover && this.hover !== this.selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill(this.paths[this.hover]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(this.paths[this.hover]);
    }
    if (this.selected && this.paths[this.selected]) {
      const a = 0.55 + 0.35 * Math.sin(time * 4);
      ctx.strokeStyle = `rgba(255,214,90,${a})`;
      ctx.lineWidth = 2.5 * px;
      ctx.stroke(this.paths[this.selected]);
      if (this.tiny.has(this.selected)) {
        const c = this.centers[this.selected];
        ctx.beginPath(); ctx.arc(c[0], c[1], 8 * px, 0, Math.PI * 2); ctx.stroke();
      }
      this.pulse = true;
    } else this.pulse = false;

    if (this.overlay) this.overlay(ctx, this, px, time);

    // labels
    if (this.showLabels !== false) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of this.labels) {
        const size = l.size;
        if (size * v.z < 8.5 || l.x < x0 - 200 || l.x > x1 + 200 || l.y < y0 - 50 || l.y > y1 + 50) continue;
        const fs = Math.min(size, 30 * px);
        ctx.font = `600 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        ctx.lineWidth = fs * 0.22;
        ctx.strokeStyle = 'rgba(5,8,14,0.75)';
        ctx.fillStyle = l.color || 'rgba(255,255,255,0.92)';
        const text = l.upper ? l.text.toUpperCase() : l.text;
        ctx.strokeText(text, l.x, l.y);
        ctx.fillText(text, l.x, l.y);
      }
    }
  }
}
