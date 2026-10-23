// World map: shaded terrain, airports & runways, cities, flight plan editing,
// ILS approach selection, traffic, weather cells and (free flight) teleport.

import { el, clear, button } from './dom.js';
import { AIRPORT_INFO, getAirport, nearestAirport } from '../world/airportGeometry.js';
import { CITIES } from '../world/worldData.js';
import { terrainHeight } from '../world/terrainGen.js';
import { fmtLatLon, fmtHeading, fmtDuration } from '../core/format.js';

const MAP = { x0: -195000, z0: -175000, size: 380000, px: 1024 };
const TYPE_NAMES = { international: 'International airport', regional: 'Regional airport', ga: 'General aviation airfield', military: 'Military air base', cargo: 'Cargo hub' };

export class MapView {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.open = false;
    this.image = null;
    this.loading = false;
    this.progress = 0;
    this.view = { cx: 0, cz: 0, scale: 0.004 };
    this.follow = true;
    this.trail = [];
    this.trailTimer = 0;
    this.popup = null;
    this.drawTimer = 0;
    this.wptCounter = 1;
  }

  // Render the terrain image in a worker (once)
  prefetch() {
    if (this.image || this.loading) return;
    this.loading = true;
    const t = this.game.world.terrain;
    const n = MAP.px;
    t.renderMap(MAP.x0, MAP.z0, MAP.size, n, n, (p) => (this.progress = p)).then((msg) => {
      const c = document.createElement('canvas');
      c.width = msg.w;
      c.height = msg.h;
      const ctx = c.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(msg.img.buffer), msg.w, msg.h), 0, 0);
      this.image = c;
      this.loading = false;
      if (this.open) this.draw();
    });
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const g = this.game;
    if (!g.player) return;
    this.prefetch();
    this.open = true;
    this.follow = true;
    const p = g.player.position;
    this.view.cx = p.x;
    this.view.cz = p.z;
    if (this.view.scale < 0.0015) this.view.scale = 0.004;
    this.canvas = el('canvas');
    this.side = el('div.map-side.scroll');
    this.hint = el('div.map-hint', null, 'Drag to pan · scroll to zoom · click an airport or the map for options');
    this.wrap = el('div.map-wrap', null, el('div', { style: { position: 'relative', flex: '1', display: 'flex', minWidth: '0' } }, this.canvas, this.hint), this.side);
    this.ui.root.appendChild(this.wrap);
    this.bindEvents();
    this.resize();
    this.renderSide();
    this.draw();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.closePopup();
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
    this.wrap = null;
    window.removeEventListener('resize', this._resize);
  }

  resize() {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(10, r.width * dpr);
    c.height = Math.max(10, r.height * dpr);
    this.dpr = dpr;
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    this._resize = () => {
      if (this.open) {
        this.resize();
        this.draw();
      }
    };
    window.addEventListener('resize', this._resize);
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        this.follow = false;
        this.view.cx = drag.cx - dx / this.view.scale;
        this.view.cz = drag.cz - dy / this.view.scale;
        this.closePopup();
        this.draw();
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.onClick(e);
      drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const mx = e.clientX - r.left,
          my = e.clientY - r.top;
        const before = this.toWorld(mx, my);
        const f = e.deltaY > 0 ? 0.8 : 1.25;
        this.view.scale = Math.max(0.0012, Math.min(0.6, this.view.scale * f));
        const after = this.toWorld(mx, my);
        this.view.cx += before.x - after.x;
        this.view.cz += before.z - after.z;
        this.follow = false;
        this.closePopup();
        this.draw();
      },
      { passive: false }
    );
  }

  // CSS-pixel transforms
  toScreen(x, z) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (x - this.view.cx) * this.view.scale + r.width / 2, y: (z - this.view.cz) * this.view.scale + r.height / 2 };
  }
  toWorld(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (sx - r.width / 2) / this.view.scale + this.view.cx, z: (sy - r.height / 2) / this.view.scale + this.view.cz };
  }

  // ------------------------------------------------------------------ interaction
  onClick(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    // Airport hit test
    let best = null,
      bd = 18;
    for (const a of AIRPORT_INFO) {
      const s = this.toScreen(a.x, a.z);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) this.airportPopup(best, sx, sy);
    else this.pointPopup(this.toWorld(sx, sy), sx, sy);
  }

  closePopup() {
    if (this.popup && this.popup.parentNode) this.popup.parentNode.removeChild(this.popup);
    this.popup = null;
  }

  placePopup(node, sx, sy) {
    this.closePopup();
    const r = this.canvas.getBoundingClientRect();
    node.style.left = `${Math.min(sx + 12, r.width - 290)}px`;
    node.style.top = `${Math.min(sy + 12, r.height - 260)}px`;
    this.canvas.parentNode.appendChild(node);
    this.popup = node;
  }

  canTeleport() {
    const g = this.game;
    return g.missions.kind === 'free' && !g.multiplayer.connected;
  }

  airportPopup(a, sx, sy) {
    const g = this.game;
    const nav = g.player.sim.nav;
    const pos = g.player.position;
    const dist = Math.hypot(a.x - pos.x, a.z - pos.z) / 1852;
    const brg = ((Math.atan2(a.x - pos.x, -(a.z - pos.z)) * 180) / Math.PI + 360) % 360;
    const rw = el('div.rw');
    for (const r of a.runwayObjs)
      for (const e of r.ends) {
        const sel = nav.approach === e;
        rw.appendChild(
          el(
            'button.btn.small' + (sel ? '.primary' : ''),
            {
              title: e.ils ? 'Select ILS approach' : 'Select visual approach (no ILS)',
              onclick: () => {
                nav.setApproach(e);
                g.missions.setApproachGuidance(e);
                this.ui.toast(`Approach selected: ${a.icao} RWY ${e.id}${e.ils ? ' ILS' : ' visual'}`, 'info');
                this.closePopup();
                this.renderSide();
                this.draw();
              },
            },
            `${e.ils ? 'ILS' : 'VIS'} ${e.id}`
          )
        );
      }
    const node = el(
      'div.map-popup.panel',
      null,
      el('h3', null, `${a.icao} · ${a.name}`),
      el('div.muted', { style: { fontSize: '12px' } }, `${TYPE_NAMES[a.type] || ''} · elev ${Math.round(a.elevation / 0.3048)} ft`),
      el('div.mono', { style: { fontSize: '12px', marginTop: '4px' } }, `${fmtHeading(brg)}° · ${dist.toFixed(dist < 10 ? 1 : 0)} NM`),
      el('div.mono', { style: { fontSize: '11px', color: 'var(--green-soft)', marginTop: '4px' } }, `TWR ${a.freq.tower.toFixed(2)} · GND ${a.freq.ground.toFixed(2)} · ATIS ${a.freq.atis.toFixed(2)}`),
      el('div.section-title', { style: { margin: '10px 0 2px' } }, 'Approach'),
      rw,
      el(
        'div.btns',
        null,
        button('Set destination', () => {
          const origin = nav.origin || nearestAirport(pos.x, pos.z).airport;
          const mid = nav.plan.filter((w) => w.type !== 'airport');
          nav.setRoute(origin.icao, a.icao, mid);
          // skip legs already behind us: go direct to the first user waypoint or destination
          nav.directTo(Math.min(1, nav.plan.length - 1));
          this.ui.toast(`Destination set: ${a.icao} ${a.name}`, 'success');
          this.closePopup();
          this.renderSide();
          this.draw();
        }, 'small'),
        button('Direct to', () => {
          const i = nav.plan.findIndex((w) => w.id === a.icao);
          if (i >= 0) nav.directTo(i);
          else {
            nav.addWaypoint({ id: a.icao, name: a.name, type: 'airport', x: a.x, z: a.z }, nav.active);
            nav.directTo(nav.active);
          }
          if (g.player.sim.ap.engaged) g.player.sim.ap.modeNAV();
          this.closePopup();
          this.renderSide();
          this.draw();
        }, 'small'),
        this.canTeleport()
          ? button('Teleport', () => {
              const e = a.runwayObjs[0].ends[0];
              const back = 9000;
              g.teleport(e.x - e.dirX * back, e.z - e.dirZ * back, Math.round(a.elevation / 0.3048 + 2500));
              const sim = g.player.sim;
              const fm = sim.fm;
              fm.placeInAir(fm.position.x, fm.position.y, fm.position.z, (e.heading * Math.PI) / 180, fm.tas, 0.03);
              sim.ap.syncTargets();
              nav.setApproach(e);
              g.missions.setApproachGuidance(e);
              this.resetTrail();
              this.closePopup();
              this.close();
            }, 'small')
          : null
      )
    );
    this.placePopup(node, sx, sy);
  }

  pointPopup(w, sx, sy) {
    const g = this.game;
    const nav = g.player.sim.nav;
    const h = Math.max(0, terrainHeight(w.x, w.z));
    const node = el(
      'div.map-popup.panel',
      null,
      el('h3', null, 'Map position'),
      el('div.mono', { style: { fontSize: '12px' } }, fmtLatLon(w.x, w.z)),
      el('div.muted', { style: { fontSize: '12px', marginTop: '2px' } }, h > 1 ? `Terrain ${Math.round(h / 0.3048).toLocaleString()} ft` : 'Water'),
      el(
        'div.btns',
        null,
        button('Add waypoint', () => {
          const id = `WPT${String(this.wptCounter++).padStart(2, '0')}`;
          nav.addWaypoint({ id, name: id, type: 'wpt', x: w.x, z: w.z });
          if (nav.plan.length === 1) nav.directTo(0);
          this.closePopup();
          this.renderSide();
          this.draw();
        }, 'small'),
        this.canTeleport()
          ? button('Teleport here', () => {
              g.teleport(w.x, w.z, Math.round(Math.max(h / 0.3048 + 3000, g.player.flightData.alt)));
              this.resetTrail();
              this.closePopup();
              this.close();
            }, 'small')
          : null
      )
    );
    this.placePopup(node, sx, sy);
  }

  renderSide() {
    const g = this.game;
    const s = this.side;
    if (!s) return;
    clear(s);
    const p = g.player;
    const nav = p.sim.nav;
    s.appendChild(el('h2', null, 'Navigation'));
    s.appendChild(el('div.info', null, `${fmtLatLon(p.position.x, p.position.z)}`, el('br'), `HDG ${fmtHeading(p.flightData.heading)}° · ${Math.round(p.flightData.alt).toLocaleString()} ft · GS ${Math.round(p.flightData.gs)} kt`));
    s.appendChild(el('div.section-title', null, 'Flight plan'));
    if (!nav.plan.length) s.appendChild(el('div.info', null, 'No flight plan. Click an airport to set a destination or click the map to add waypoints.'));
    let total = 0;
    let last = { x: p.position.x, z: p.position.z };
    nav.plan.forEach((w, i) => {
      if (i >= nav.active) {
        total += Math.hypot(w.x - last.x, w.z - last.z);
        last = w;
      }
      s.appendChild(
        el(
          'div.wp' + (i === nav.active ? '.active' : ''),
          null,
          el('span.i', null, i + 1),
          el('span.n', null, w.id),
          el('button', { title: 'Direct to', onclick: () => (nav.directTo(i), this.renderSide(), this.draw()) }, 'D→'),
          el('button', { title: 'Remove', onclick: () => (nav.removeWaypoint(i), this.renderSide(), this.draw()) }, '✕')
        )
      );
    });
    if (nav.plan.length) {
      const gs = Math.max(60, p.flightData.gs);
      s.appendChild(el('div.info', null, `Remaining ${(total / 1852).toFixed(0)} NM · ETE ${fmtDuration((total / 1852 / gs) * 3600)}`));
      s.appendChild(
        el(
          'div',
          { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          button('Fly plan (NAV)', () => {
            const ap = p.sim.ap;
            if (!ap.engaged && !p.sim.fm.wow) ap.engage();
            ap.modeNAV();
            this.ui.toast('Autopilot NAV mode — following the flight plan', 'info');
          }, 'small'),
          button('Clear plan', () => (nav.clear(), this.renderSide(), this.draw()), 'small ghost')
        )
      );
    }
    s.appendChild(el('div.section-title', null, 'Approach'));
    if (nav.approach) {
      const e = nav.approach;
      s.appendChild(el('div.info', null, `${e.airport.icao} RWY ${e.id} — ${e.ils ? `ILS, course ${fmtHeading(e.heading)}°` : 'visual'}`));
      s.appendChild(
        el(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          button('Arm APPR', () => {
            const ap = p.sim.ap;
            if (!ap.engaged && !p.sim.fm.wow) ap.engage();
            p.armApproach();
          }, 'small'),
          button('Clear', () => (nav.setApproach(null), this.renderSide(), this.draw()), 'small ghost')
        )
      );
    } else s.appendChild(el('div.info', null, 'None selected — click an airport and pick a runway.'));
    s.appendChild(el('div.section-title', null, 'View'));
    s.appendChild(
      el(
        'div',
        { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        button('Centre on aircraft', () => {
          this.follow = true;
          this.draw();
        }, 'small'),
        button('Whole world', () => {
          this.follow = false;
          this.view.cx = MAP.x0 + MAP.size / 2;
          this.view.cz = MAP.z0 + MAP.size / 2;
          const r = this.canvas.getBoundingClientRect();
          this.view.scale = Math.min(r.width, r.height) / MAP.size;
          this.draw();
        }, 'small')
      )
    );
    s.appendChild(el('div', { style: { flex: '1' } }));
    s.appendChild(el('div.info', { style: { fontSize: '12px' } }, el('span', { style: { color: 'var(--magenta)' } }, '━ '), 'route   ', el('span', { style: { color: 'var(--cyan)' } }, '● '), 'traffic   ', el('span', { style: { color: 'var(--red)' } }, '◯ '), 'storm cell'));
    s.appendChild(button('Close map (M)', () => this.close(), 'wide'));
  }

  // ------------------------------------------------------------------ drawing
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 2;
      const pos = p.position;
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - pos.x, last.z - pos.z) > 150) this.trail.push({ x: pos.x, z: pos.z });
      if (this.trail.length > 1500) this.trail.shift();
    }
    if (!this.open) return;
    this.drawTimer -= dt;
    if (this.drawTimer <= 0) {
      this.drawTimer = 0.1;
      this.draw();
    }
    this.sideTimer = (this.sideTimer || 0) - dt;
    if (this.sideTimer <= 0) {
      this.sideTimer = 1;
      if (!this.side.contains(document.activeElement)) this.renderSide();
    }
  }

  resetTrail() {
    this.trail = [];
  }

  draw() {
    if (!this.open || !this.canvas) return;
    const g = this.game;
    const p = g.player;
    if (!p) return;
    const c = this.canvas;
    const ctx = c.getContext('2d');
    const dpr = this.dpr || 1;
    const W = c.width / dpr,
      H = c.height / dpr;
    if (this.follow) {
      this.view.cx = p.position.x;
      this.view.cz = p.position.z;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d2a45';
    ctx.fillRect(0, 0, W, H);
    const sc = this.view.scale;
    // Terrain
    if (this.image) {
      const o = this.toScreen(MAP.x0, MAP.z0);
      ctx.imageSmoothingEnabled = sc * (MAP.size / MAP.px) < 3;
      ctx.drawImage(this.image, o.x, o.y, MAP.size * sc, MAP.size * sc);
    } else {
      ctx.fillStyle = '#9fb3c8';
      ctx.font = '600 14px Barlow, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Rendering terrain map… ${Math.round(this.progress * 100)}%`, W / 2, H / 2 - 40);
    }
    // Grid every 0.5° approx (55 km)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const step = sc > 0.02 ? 5000 : sc > 0.006 ? 20000 : 50000;
    const tl = this.toWorld(0, 0),
      br = this.toWorld(W, H);
    ctx.beginPath();
    for (let x = Math.ceil(tl.x / step) * step; x < br.x; x += step) {
      const s = this.toScreen(x, 0).x;
      ctx.moveTo(s, 0);
      ctx.lineTo(s, H);
    }
    for (let z = Math.ceil(tl.z / step) * step; z < br.z; z += step) {
      const s = this.toScreen(0, z).y;
      ctx.moveTo(0, s);
      ctx.lineTo(W, s);
    }
    ctx.stroke();
    // Cities
    ctx.textAlign = 'center';
    for (const city of CITIES) {
      const s = this.toScreen(city.x, city.z);
      const r = Math.max(3, city.r * sc * 0.6);
      ctx.fillStyle = 'rgba(255,214,140,0.22)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,200,0.85)';
      ctx.font = `600 ${city.r > 4000 ? 13 : 11}px Barlow, sans-serif`;
      ctx.fillText(city.name, s.x, s.y - r - 4);
    }
    // Storm cells
    for (const st of g.weather.state.storms || []) {
      const s = this.toScreen(st.x, st.z);
      const r = st.r * sc;
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(4, r * 1.6));
      grd.addColorStop(0, 'rgba(255,40,40,0.55)');
      grd.addColorStop(0.5, 'rgba(255,200,0,0.3)');
      grd.addColorStop(1, 'rgba(0,255,80,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(4, r * 1.6), 0, Math.PI * 2);
      ctx.fill();
    }
    // Airports
    const nav = p.sim.nav;
    for (const a of AIRPORT_INFO) {
      const s = this.toScreen(a.x, a.z);
      if (s.x < -60 || s.y < -60 || s.x > W + 60 || s.y > H + 60) continue;
      const big = sc > 0.012;
      ctx.strokeStyle = a.type === 'military' ? '#ffb000' : '#ffffff';
      ctx.fillStyle = a.type === 'military' ? '#ffb000' : '#ffffff';
      if (big) {
        ctx.lineCap = 'round';
        for (const r of a.runwayObjs) {
          const e0 = this.toScreen(r.ends[0].x, r.ends[0].z),
            e1 = this.toScreen(r.ends[1].x, r.ends[1].z);
          ctx.lineWidth = Math.max(3, r.width * sc);
          ctx.strokeStyle = '#2b2f36';
          ctx.beginPath();
          ctx.moveTo(e0.x, e0.y);
          ctx.lineTo(e1.x, e1.y);
          ctx.stroke();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = '#f2f2f2';
          ctx.stroke();
          if (sc > 0.05) {
            ctx.font = '600 11px "B612 Mono", monospace';
            ctx.fillStyle = '#ffffff';
            for (const e of r.ends) {
              const t = this.toScreen(e.x - e.dirX * 120, e.z - e.dirZ * 120);
              ctx.fillText(e.id, t.x, t.y + 4);
            }
          }
        }
      } else {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        for (const r of a.runwayObjs) {
          const ang = (r.ends[0].heading * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.sin(ang) * 9, s.y + Math.cos(ang) * 9);
          ctx.lineTo(s.x + Math.sin(ang) * 9, s.y - Math.cos(ang) * 9);
          ctx.stroke();
        }
      }
      ctx.font = '700 12px "B612 Mono", monospace';
      ctx.fillStyle = nav.destination === a ? '#ff5cf0' : '#e6eef8';
      ctx.textAlign = 'left';
      ctx.fillText(a.icao, s.x + 10, s.y - 8);
      if (sc > 0.006) {
        ctx.font = '500 11px Barlow, sans-serif';
        ctx.fillStyle = 'rgba(230,238,248,0.75)';
        ctx.fillText(a.name, s.x + 10, s.y + 5);
      }
      ctx.textAlign = 'center';
    }
    // ILS feather for the selected approach
    if (nav.approach) {
      const e = nav.approach;
      const L = 18520;
      const t = this.toScreen(e.x, e.z);
      const a1 = this.toScreen(e.x - e.dirX * L + -e.dirZ * L * 0.05, e.z - e.dirZ * L + e.dirX * L * 0.05);
      const a2 = this.toScreen(e.x - e.dirX * L - -e.dirZ * L * 0.05, e.z - e.dirZ * L - e.dirX * L * 0.05);
      const m = this.toScreen(e.x - e.dirX * L, e.z - e.dirZ * L);
      ctx.fillStyle = 'rgba(79,209,255,0.18)';
      ctx.strokeStyle = 'rgba(79,209,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Trail
    if (this.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      this.trail.forEach((pt, i) => {
        const s = this.toScreen(pt.x, pt.z);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      const s = this.toScreen(p.position.x, p.position.z);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Route
    if (nav.plan.length) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ff5cf0';
      ctx.beginPath();
      nav.plan.forEach((w, i) => {
        const s = this.toScreen(w.x, w.z);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
      const aw = nav.plan[nav.active];
      if (aw) {
        const s0 = this.toScreen(p.position.x, p.position.z),
          s1 = this.toScreen(aw.x, aw.z);
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(255,92,240,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = '600 11px "B612 Mono", monospace';
      nav.plan.forEach((w, i) => {
        if (w.type === 'airport') return;
        const s = this.toScreen(w.x, w.z);
        ctx.fillStyle = i === nav.active ? '#ff5cf0' : '#ffffff';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 6);
        ctx.lineTo(s.x + 6, s.y);
        ctx.lineTo(s.x, s.y + 6);
        ctx.lineTo(s.x - 6, s.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillText(w.id, s.x, s.y - 10);
      });
    }
    // Mission markers
    const ms = g.missions;
    if (ms.targetPos) this.marker(ctx, ms.targetPos.x, ms.targetPos.z, '#ff7a1a', 'TARGET');
    if (ms.rings) {
      ms.rings.forEach((r, i) => {
        const s = this.toScreen(r.pos.x, r.pos.z);
        ctx.strokeStyle = r.passed ? 'rgba(60,255,106,0.6)' : '#ffb000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        if (i === 0) ctx.fillText('RINGS', s.x, s.y - 9);
      });
    }
    if (ms.interceptTarget) this.marker(ctx, ms.interceptTarget.pos.x, ms.interceptTarget.pos.z, '#ff4d4d', 'BOGEY');
    // Traffic
    const traffic = g.trafficFor(p.position);
    ctx.font = '600 10px "B612 Mono", monospace';
    for (const t of traffic) {
      const s = this.toScreen(t.x, t.z);
      if (s.x < 0 || s.y < 0 || s.x > W || s.y > H) continue;
      ctx.fillStyle = t.human ? '#ffd27a' : '#4fd1ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, t.human ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (sc > 0.01 || t.human) ctx.fillText(`${t.callsign || ''} ${Math.round(t.alt / 100)}`, s.x, s.y - 7);
    }
    // Player aircraft
    const s = this.toScreen(p.position.x, p.position.z);
    const hd = (p.flightData.heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(hd);
    ctx.fillStyle = '#ffd400';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Scale bar
    const nmPx = 1852 * sc;
    let nm = 1;
    for (const n of [1, 2, 5, 10, 20, 50, 100]) if (n * nmPx < 160) nm = n;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W - 30 - nm * nmPx, H - 24);
    ctx.lineTo(W - 30, H - 24);
    ctx.stroke();
    ctx.font = '600 11px "B612 Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${nm} NM`, W - 30, H - 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('N ↑', 16, 22);
  }

  marker(ctx, x, z, color, label) {
    const s = this.toScreen(x, z);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 11px "B612 Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, s.x, s.y - 12);
  }
}

export { getAirport, MAP };
