// Multiplayer client. Transports: WebSocket relay server (server/server.js) or
// "local" mode using BroadcastChannel between tabs of the same browser.
// Remote aircraft are interpolated ~150 ms behind real time.

import * as THREE from 'three';
import { AircraftVisual } from '../aircraft/AircraftVisual.js';
import { getAircraft } from '../aircraft/aircraftData.js';
import { FT, KT } from '../physics/atmosphere.js';

const SEND_HZ = 10;
const DELAY = 0.15;

class BroadcastTransport {
  constructor(room) {
    this.id = Math.floor(Math.random() * 1e9);
    this.ch = new BroadcastChannel(`skyward-mp-${room}`);
    this.room = room;
    this.peers = new Map();
    this.onmessage = null;
    this.ch.onmessage = (e) => this.receive(e.data);
    this.presence = setInterval(() => this.post({ t: 'presence' }), 2000);
    this.reaper = setInterval(() => {
      const now = Date.now();
      for (const [id, p] of this.peers) if (now - p.seen > 7000) {
        this.peers.delete(id);
        this.emit({ t: 'leave', id });
      }
    }, 3000);
    window.addEventListener('beforeunload', () => this.post({ t: 'bye' }));
  }
  emit(msg) {
    if (this.onmessage) this.onmessage(msg);
  }
  post(msg) {
    this.ch.postMessage({ ...msg, from: this.id, info: this.info });
  }
  send(msg) {
    if (msg.t === 'hello') {
      this.info = { id: this.id, name: msg.name, callsign: msg.callsign, aircraft: msg.aircraft, livery: msg.livery };
      this.post({ t: 'presence' });
      setTimeout(() => this.emit({ t: 'welcome', id: this.id, room: this.room, players: [...this.peers.values()].map((p) => p.info) }), 50);
      return;
    }
    if (msg.t === 'chat') this.emit({ t: 'chat', id: this.id, name: this.info.callsign, text: msg.text, ts: Date.now() });
    if (msg.t === 'info') this.info = { ...this.info, aircraft: msg.aircraft, livery: msg.livery };
    this.post(msg);
  }
  receive(m) {
    if (!m || m.from === this.id) return;
    const known = this.peers.get(m.from);
    if (m.t === 'bye') {
      if (known) {
        this.peers.delete(m.from);
        this.emit({ t: 'leave', id: m.from });
      }
      return;
    }
    if (!m.info) return;
    if (!known) {
      this.peers.set(m.from, { info: m.info, seen: Date.now() });
      this.emit({ t: 'join', player: m.info });
      this.post({ t: 'presence' });
    } else {
      known.seen = Date.now();
      if (known.info.aircraft !== m.info.aircraft || known.info.livery !== m.info.livery) {
        known.info = m.info;
        this.emit({ t: 'info', player: m.info });
      }
    }
    if (m.t === 'state') this.emit({ t: 'state', id: m.from, s: m.s });
    if (m.t === 'chat') this.emit({ t: 'chat', id: m.from, name: m.info.callsign, text: m.text, ts: Date.now() });
  }
  close() {
    this.post({ t: 'bye' });
    clearInterval(this.presence);
    clearInterval(this.reaper);
    this.ch.close();
  }
}

class SocketTransport {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.onmessage = null;
    this.onclose = null;
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('Could not connect to ' + url));
    });
    this.ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (this.onmessage) this.onmessage(m);
      } catch {
        /* ignore malformed */
      }
    };
    this.ws.onclose = () => this.onclose && this.onclose();
  }
  send(msg) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  close() {
    this.ws.close();
  }
}

function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,16,28,0.75)';
  g.beginPath();
  if (g.roundRect) g.roundRect(4, 8, 248, 44, 10);
  else g.rect(4, 8, 248, 44);
  g.fill();
  g.strokeStyle = 'rgba(47,230,255,0.9)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#e8f7ff';
  g.font = '600 26px Segoe UI, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 16), 128, 31);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
  s.scale.set(0.12, 0.03, 1);
  s.renderOrder = 100;
  return s;
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.transport = null;
    this.connected = false;
    this.myId = null;
    this.room = '';
    this.remotes = new Map();
    this.sendTimer = 0;
    this.listeners = new Set();
    this.time = 0;
    this.mode = '';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  defaultUrl() {
    const loc = window.location;
    if (loc.port === '5173' || loc.port === '4173') return `ws://${loc.hostname}:8080/ws`;
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
  }

  async connect({ url, room, name, callsign, aircraft, livery }) {
    this.disconnect();
    this.room = room || 'public';
    this.hello = { t: 'hello', name, callsign, aircraft, livery: typeof livery === 'string' ? livery : livery?.id || '', room: this.room };
    if (url === 'local') {
      this.mode = 'local';
      this.transport = new BroadcastTransport(this.room);
    } else {
      this.mode = 'server';
      const t = new SocketTransport(url || this.defaultUrl());
      this.transport = t;
      await t.ready;
      t.onclose = () => {
        if (this.connected) this.emit({ type: 'status', text: 'Disconnected from server' });
        this.connected = false;
        this.clearRemotes();
      };
    }
    this.transport.onmessage = (m) => this.receive(m);
    this.transport.send(this.hello);
    this.connected = true;
    this.emit({ type: 'status', text: `Connected to room "${this.room}" (${this.mode === 'local' ? 'local tabs' : 'server'})` });
  }

  disconnect() {
    if (this.transport) this.transport.close();
    this.transport = null;
    this.connected = false;
    this.clearRemotes();
  }

  clearRemotes() {
    for (const r of this.remotes.values()) this.removeRemote(r);
    this.remotes.clear();
  }

  updateInfo(aircraft, livery) {
    if (this.transport) this.transport.send({ t: 'info', aircraft, livery: typeof livery === 'string' ? livery : livery?.id || '' });
  }

  addRemote(info) {
    if (this.remotes.has(info.id)) return this.remotes.get(info.id);
    const r = { info, buffer: [], visual: null, tag: null, last: null };
    this.remotes.set(info.id, r);
    this.buildVisual(r);
    this.emit({ type: 'join', player: info });
    return r;
  }

  buildVisual(r) {
    if (r.visual) {
      this.game.scene.remove(r.visual.root);
      r.visual.dispose();
    }
    const spec = getAircraft(r.info.aircraft);
    r.spec = spec;
    r.visual = new AircraftVisual(spec, r.info.livery || undefined, { detail: 'low', merge: true });
    r.tag = nameTag(r.info.callsign || r.info.name);
    r.tag.position.set(0, (spec.model.vtail ? spec.model.vtail.height : 2) + 4, 0);
    r.visual.root.add(r.tag);
    r.visual.root.visible = false;
    this.game.scene.add(r.visual.root);
    r.vstate = { gear: spec.gear.points.map(() => ({ compression: 0.1, spin: 0, steerAngle: 0 })), engines: spec.engine.list.map(() => ({ rpm: 0.5 })), lights: {} };
  }

  removeRemote(r) {
    if (r.visual) {
      this.game.scene.remove(r.visual.root);
      r.visual.dispose();
    }
  }

  receive(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        for (const p of m.players) this.addRemote(p);
        break;
      case 'join':
        this.addRemote(m.player);
        this.emit({ type: 'chat', system: true, text: `${m.player.callsign || m.player.name} joined the session` });
        break;
      case 'info': {
        const r = this.remotes.get(m.player.id);
        if (r) {
          r.info = m.player;
          this.buildVisual(r);
        } else this.addRemote(m.player);
        break;
      }
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) {
          this.emit({ type: 'chat', system: true, text: `${r.info.callsign || r.info.name} left the session` });
          this.removeRemote(r);
          this.remotes.delete(m.id);
        }
        break;
      }
      case 'state': {
        const r = this.remotes.get(m.id);
        if (!r) return;
        r.buffer.push({ t: this.time, ...m.s });
        if (r.buffer.length > 30) r.buffer.shift();
        break;
      }
      case 'chat':
        this.emit({ type: 'chat', from: m.name, text: m.text, mine: m.id === this.myId });
        break;
      case 'error':
        this.emit({ type: 'status', text: m.text });
        break;
    }
  }

  chat(text) {
    if (!this.transport || !text.trim()) return;
    this.transport.send({ t: 'chat', text: text.trim().slice(0, 240) });
    if (this.mode === 'server') {
      /* server echoes chat back to everyone including us */
    }
  }

  update(dt) {
    this.time += dt;
    if (!this.connected) return;
    const p = this.game.player;
    this.sendTimer -= dt;
    if (p && this.sendTimer <= 0 && this.game.state === 'flying') {
      this.sendTimer = 1 / SEND_HZ;
      const fm = p.sim.fm;
      const sim = p.sim;
      const sw = sim.switches;
      this.transport.send({
        t: 'state',
        s: {
          p: [fm.position.x, fm.position.y, fm.position.z],
          q: [fm.quaternion.x, fm.quaternion.y, fm.quaternion.z, fm.quaternion.w],
          v: [fm.velocity.x, fm.velocity.y, fm.velocity.z],
          g: sim.gearPos,
          f: fm.controls.flaps,
          sp: fm.controls.spoilers,
          e: sim.engines.map((e) => +e.rpmFraction.toFixed(2)),
          ab: sim.engines.map((e) => +(e.afterburner || 0).toFixed(2)),
          l: (sw.navLights ? 1 : 0) | (sw.strobeLights ? 2 : 0) | (sw.beacon ? 4 : 0) | (sw.landingLights ? 8 : 0) | (sw.taxiLights ? 16 : 0),
          c: [+fm.controls.elevator.toFixed(2), +fm.controls.aileron.toFixed(2), +fm.controls.rudder.toFixed(2)],
          ias: Math.round(fm.ias / KT),
        },
      });
    }
    // Interpolate remotes
    const renderT = this.time - DELAY;
    const night = this.game.world.night;
    for (const r of this.remotes.values()) {
      const b = r.buffer;
      if (b.length === 0 || !r.visual) continue;
      while (b.length > 2 && b[1].t <= renderT) b.shift();
      let a = b[0],
        c = b[1] || b[0];
      let k = c.t > a.t ? (renderT - a.t) / (c.t - a.t) : 1;
      k = Math.max(0, Math.min(1.5, k));
      const root = r.visual.root;
      root.visible = true;
      if (k <= 1) {
        root.position.set(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
        _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
        _qb.set(c.q[0], c.q[1], c.q[2], c.q[3]);
        root.quaternion.slerpQuaternions(_qa, _qb, k);
      } else {
        // extrapolate with velocity
        const ex = renderT - c.t;
        root.position.set(c.p[0] + c.v[0] * ex, c.p[1] + c.v[1] * ex, c.p[2] + c.v[2] * ex);
      }
      const vs = r.vstate;
      vs.gearPos = c.g;
      vs.flapsDeg = c.f;
      vs.spoilers = c.sp;
      [vs.elevator, vs.aileron, vs.rudder] = c.c || [0, 0, 0];
      vs.engines.forEach((e, i) => {
        e.rpm = c.e ? c.e[Math.min(i, c.e.length - 1)] : 0.5;
        e.afterburner = c.ab ? c.ab[Math.min(i, c.ab.length - 1)] : 0;
      });
      vs.lights.nav = !!(c.l & 1);
      vs.lights.strobe = !!(c.l & 2);
      vs.lights.beacon = !!(c.l & 4);
      vs.lights.landing = !!(c.l & 8);
      vs.lights.taxi = !!(c.l & 16);
      vs.night = night;
      r.visual.update(dt, vs);
      r.last = c;
    }
  }

  get players() {
    return [...this.remotes.values()].map((r) => r.info);
  }

  trafficFor(pos) {
    const out = [];
    for (const r of this.remotes.values()) {
      if (!r.last || !r.visual) continue;
      const p = r.visual.root.position;
      const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
      out.push({ x: p.x, z: p.z, alt: p.y / FT, relAlt: (p.y - pos.y) / FT, vs: (r.last.v ? r.last.v[1] : 0) / 0.00508, dist, callsign: r.info.callsign, human: true });
    }
    return out;
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
