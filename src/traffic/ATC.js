// Air traffic control: frequencies, active runways, context-sensitive player
// requests, automatic clearances and vectors, taxi routing, AI radio chatter
// and a radio log. Speech goes through the AudioEngine (Web Speech API).

import * as THREE from 'three';
import { AIRPORT_INFO, nearestAirport, bestRunwayEnd, runwayAt, runwayRelative, getAirport } from '../world/airportGeometry.js';
import { LAYOUTS, taxiRoute, nearestNode } from '../world/airportLayout.js';
import { KT, FT, NM, DEG } from '../physics/atmosphere.js';

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

function digits(s) {
  return String(s)
    .split('')
    .map((c) => (c >= '0' && c <= '9' ? DIGITS[+c] : c === '.' ? 'decimal' : c))
    .join(' ');
}

function sayRunway(id) {
  const num = id.replace(/[LRC]/, '');
  const l = id.slice(num.length);
  return `${digits(num)}${l ? ' ' + { L: 'left', R: 'right', C: 'center' }[l] : ''}`;
}

function sayCallsign(cs) {
  const parts = cs.split(' ');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return `${parts[0].toLowerCase()} ${digits(parts[1])}`;
  return cs
    .split('')
    .map((c) => (/\d/.test(c) ? DIGITS[+c] : c))
    .join(' ');
}

function sayAlt(ft) {
  ft = Math.round(ft / 100) * 100;
  if (ft >= 18000) return `flight level ${digits(Math.round(ft / 100))}`;
  const th = Math.floor(ft / 1000),
    h = Math.round((ft % 1000) / 100);
  return `${th ? digits(th).replace(/ /g, '') + ' thousand' : ''}${h ? ' ' + digits(h) + ' hundred' : ''}`.trim();
}

function fmtAlt(ft) {
  ft = Math.round(ft / 100) * 100;
  return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString('en-US')} ft`;
}

function sayHeading(h) {
  return digits(String(Math.round(h) % 360 || 360).padStart(3, '0'));
}

function shortName(ap) {
  return ap.name.split(' ')[0];
}

export class ATC {
  constructor(game) {
    this.game = game;
    this.log = [];
    this.listeners = [];
    this.state = 'idle';
    this.airport = null; // airport currently handling the player
    this.assignedEnd = null;
    this.instruction = '';
    this.taxiPath = null;
    this.clearances = { takeoff: false, landing: false, taxi: false };
    this.emergency = false;
    this.lastVector = 0;
    this.violations = [];
    this.aiTalkTimer = 0;
    this.runwayCache = new Map();
    // Taxi guidance line
    this.lineMat = new THREE.LineDashedMaterial({ color: 0x3cff6a, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.9, depthWrite: false });
    this.line = null;
  }

  onMessage(fn) {
    this.listeners.push(fn);
  }

  reset() {
    this.state = 'idle';
    this.airport = null;
    this.assignedEnd = null;
    this.instruction = '';
    this.clearances = { takeoff: false, landing: false, taxi: false };
    this.emergency = false;
    this.violations = [];
    this.setTaxiPath(null);
    this.log = [];
    this.runwayCache.clear();
  }

  // Active runway at an airport (cached; changes only with large wind shifts)
  activeRunway(ap, minLen = 0) {
    const ws = this.game.weather.state;
    const key = `${ap.icao}|${minLen}|${Math.round(ws.windDir / 45)}`;
    if (!this.runwayCache.has(key)) this.runwayCache.set(key, bestRunwayEnd(ap, ws.windDir, Math.max(3, ws.windSpeed), minLen));
    return this.runwayCache.get(key);
  }

  station(ap, kind) {
    const names = { ground: 'Ground', tower: 'Tower', approach: 'Approach', atis: 'Information' };
    if (kind === 'center') return { name: 'Aurelia Center', freq: 132.45 };
    return { name: `${shortName(ap)} ${names[kind]}`, freq: ap.freq[kind] };
  }

  windText() {
    const ws = this.game.weather.state;
    const d = Math.round(ws.windDir / 10) * 10 || 360;
    const kt = Math.round(ws.windSpeed * 1.944);
    return { text: `wind ${String(d).padStart(3, '0')} at ${kt}`, speech: `wind ${sayHeading(d)} at ${digits(kt)}` };
  }

  // Post a radio message. from: 'atc' | 'player' | 'ai'
  say(station, text, speech, from = 'atc', voice = 'atc', speak = true) {
    const msg = { time: Date.now(), station: station.name, freq: station.freq, text, from };
    this.log.push(msg);
    if (this.log.length > 60) this.log.shift();
    for (const fn of this.listeners) fn(msg);
    if (speak && speech) this.game.audio.speak(speech, voice);
  }

  playerSay(station, text, speech) {
    this.say(station, text, speech, 'player', 'pilot1', false);
  }

  get player() {
    return this.game.player;
  }

  callsign() {
    return this.player ? this.player.callsign : 'SKYWARD 1';
  }

  // ---------------------------------------------------------------- context
  context() {
    const p = this.player;
    if (!p) return null;
    const fm = p.sim.fm;
    const na = nearestAirport(fm.position.x, fm.position.z);
    const ap = na.airport;
    const onGround = fm.wow;
    const atAirport = na.distance < 6000 && fm.position.y - ap.elevation < 300;
    const dest = p.sim.nav.destination;
    return { p, fm, ap, dist: na.distance, onGround, atAirport, dest, agl: fm.position.y - ap.elevation };
  }

  // Options for the ATC menu
  menuOptions() {
    const c = this.context();
    if (!c) return [];
    const opts = [];
    const { ap, onGround, atAirport, dest } = c;
    if (onGround && atAirport) {
      const L = LAYOUTS.get(ap.icao);
      const nearGate = L && L.gates.some((g) => Math.hypot(g.x - c.fm.position.x, g.z - c.fm.position.z) < 60);
      if (this.state !== 'taxiing' && this.state !== 'holdShort') {
        if (nearGate) opts.push({ id: 'pushback', label: `Request pushback and taxi (${shortName(ap)} Ground)` });
        opts.push({ id: 'taxi', label: `Request taxi to the active runway` });
      }
      if (this.state === 'taxiing' || this.state === 'holdShort' || this.nearHoldShort()) opts.push({ id: 'ready', label: 'Ready for departure' });
      if (this.state === 'landed' || this.state === 'clearedLand') opts.push({ id: 'taxiGate', label: 'Request taxi to the gate' });
      opts.push({ id: 'atis', label: `Request weather (${shortName(ap)} ATIS)` });
    } else if (!onGround) {
      const target = dest && c.dist > 8000 ? dest : ap;
      opts.push({ id: 'ils', label: `Request ILS approach — ${target.icao} ${target.name}`, airport: target.icao });
      opts.push({ id: 'visual', label: `Request visual approach and landing at ${target.icao}`, airport: target.icao });
      if (dest && dest !== ap) opts.push({ id: 'ils', label: `Request ILS approach — nearest: ${ap.icao} ${ap.name}`, airport: ap.icao });
      opts.push({ id: 'climb', label: 'Request higher altitude' });
      opts.push({ id: 'descend', label: 'Request lower altitude' });
      if (dest) opts.push({ id: 'direct', label: `Request direct to ${dest.icao}` });
      opts.push({ id: 'following', label: 'Request flight following' });
      opts.push({ id: 'atis', label: `Request weather (${ap.icao})` });
    }
    opts.push({ id: 'mayday', label: this.emergency ? 'Cancel emergency' : 'Declare emergency (MAYDAY)' });
    return opts;
  }

  nearHoldShort() {
    const c = this.context();
    if (!c) return false;
    const L = LAYOUTS.get(c.ap.icao);
    if (!L) return false;
    const n = nearestNode(L, c.fm.position.x, c.fm.position.z, ['hold']);
    return n && Math.hypot(n.x - c.fm.position.x, n.z - c.fm.position.z) < 120;
  }

  // ---------------------------------------------------------------- requests
  request(id, opt = {}) {
    const c = this.context();
    if (!c) return;
    const cs = this.callsign();
    const scs = sayCallsign(cs);
    const { ap, fm } = c;
    const minLen = c.p.spec.mass.maxTakeoff > 150000 ? 2400 : c.p.spec.mass.maxTakeoff > 30000 ? 1700 : 500;
    switch (id) {
      case 'taxi':
      case 'pushback': {
        const st = this.station(ap, 'ground');
        this.playerSay(st, `${st.name}, ${cs}, ${id === 'pushback' ? 'request pushback and taxi' : 'request taxi'}.`);
        const end = this.activeRunway(ap, minLen);
        this.airport = ap;
        this.assignedEnd = end;
        const route = this.routeToHold(ap, end, fm.position);
        const w = this.windText();
        const via = route ? route.via : '';
        setTimeout(() => {
          this.say(st, `${cs}, ${id === 'pushback' ? 'pushback approved, ' : ''}taxi to runway ${end.id}${via ? ' via ' + via : ''}, hold short. ${w.text}, QNH 1013.`, `${scs}, ${id === 'pushback' ? 'push back approved, ' : ''}taxi to runway ${sayRunway(end.id)}${via ? ' via ' + via.split('').join(' ') : ''}, hold short. ${w.speech}, QNH one zero one three.`);
          this.instruction = `Taxi to RWY ${end.id}${via ? ' via ' + via : ''}, hold short`;
          this.state = 'taxiing';
          this.clearances.taxi = true;
          if (route) this.setTaxiPath(route.points);
          this.setDepartureApproach(ap, end);
        }, 1200);
        break;
      }
      case 'ready': {
        const st = this.station(ap, 'tower');
        const end = this.assignedEnd || this.activeRunway(ap, minLen);
        this.assignedEnd = end;
        this.airport = ap;
        this.playerSay(st, `${st.name}, ${cs}, ready for departure runway ${end.id}.`);
        setTimeout(() => {
          const traffic = !this.game.traffic || this.game.traffic.runwayFreeForDeparture(ap, end, null);
          const w = this.windText();
          if (traffic) {
            this.say(st, `${cs}, runway ${end.id}, ${w.text}, cleared for takeoff.`, `${scs}, runway ${sayRunway(end.id)}, ${w.speech}, cleared for take off.`);
            this.clearances.takeoff = true;
            this.state = 'clearedTakeoff';
            this.instruction = `Cleared for takeoff RWY ${end.id}`;
            this.setTaxiPath(null);
          } else {
            this.say(st, `${cs}, hold short runway ${end.id}, traffic on final.`, `${scs}, hold short runway ${sayRunway(end.id)}, traffic on final.`);
            this.state = 'holdShort';
            this.instruction = `Hold short RWY ${end.id} — traffic`;
            this.pendingTakeoff = { end, t: 20 };
          }
        }, 1300);
        break;
      }
      case 'taxiGate': {
        const st = this.station(ap, 'ground');
        this.playerSay(st, `${st.name}, ${cs}, request taxi to the gate.`);
        const L = LAYOUTS.get(ap.icao);
        const gate = this.game.traffic ? this.game.traffic.freeGate(ap, c.p.spec) : L.gates[0];
        setTimeout(() => {
          if (!gate) {
            this.say(st, `${cs}, no gates available, hold position.`, `${scs}, no gates available, hold position.`);
            return;
          }
          gate.reserved = true;
          const from = nearestNode(L, fm.position.x, fm.position.z, ['hold', 'parallel', 'lane', 'runway']);
          const route = taxiRoute(L, from.id, gate.node.id);
          const gname = `${String.fromCharCode(65 + (L.gates.indexOf(gate) % 6))}${(L.gates.indexOf(gate) % 20) + 1}`;
          this.say(st, `${cs}, taxi to gate ${gname} via the parallel taxiway. Welcome to ${shortName(ap)}.`, `${scs}, taxi to gate ${gname.split('').join(' ')}. Welcome to ${shortName(ap)}.`);
          if (route) this.setTaxiPath([{ x: fm.position.x, z: fm.position.z }, ...route.map((n) => ({ x: n.x, z: n.z }))]);
          this.instruction = `Taxi to gate ${gname}`;
          this.state = 'taxiIn';
        }, 1200);
        break;
      }
      case 'atis': {
        const st = this.station(ap, 'atis');
        const end = this.activeRunway(ap, minLen);
        const w = this.game.weather;
        const metar = w.metar(ap.icao);
        const s = w.state;
        const vis = s.visibility >= 10000 ? '10 kilometres or more' : `${Math.round(s.visibility / 100) * 100} metres`;
        const wt = this.windText();
        this.say(st, `${ap.name} information. ${metar}. Landing and departing runway ${end.id}.`, `${shortName(ap)} information. ${wt.speech}. Visibility ${vis}. Temperature ${digits(Math.round(15 + s.tempOffset))}. Landing and departing runway ${sayRunway(end.id)}.`);
        break;
      }
      case 'ils':
      case 'visual': {
        const target = getAirport(opt.airport || (c.dest ? c.dest.icao : ap.icao)) || ap;
        const st = this.station(target, c.dist < 15000 ? 'tower' : 'approach');
        this.playerSay(st, `${st.name}, ${cs}, request ${id === 'ils' ? 'ILS' : 'visual'} approach.`);
        const end = this.activeRunway(target, minLen);
        const ils = id === 'ils' && end.ils ? end : null;
        const useEnd = ils || (id === 'ils' ? target.runwayObjs.flatMap((r) => r.ends).find((e) => e.ils) : end) || end;
        this.airport = target;
        this.assignedEnd = useEnd;
        c.p.sim.nav.setApproach(useEnd);
        if (!c.p.sim.nav.destination || c.p.sim.nav.destination.icao !== target.icao) {
          c.p.sim.nav.destination = target;
        }
        this.game.missions && this.game.missions.buildApproachGuidance && this.game.settings.get('gameplay').guidance && !this.game.missions.guide && this.game.missions.buildApproachGuidance(useEnd);
        setTimeout(() => {
          const alt = Math.round((target.elevation / FT + 3000) / 100) * 100;
          this.state = 'approach';
          this.approachAlt = alt;
          this.lastVector = 0;
          if (id === 'ils' && useEnd.ils) this.say(st, `${cs}, expect ILS approach runway ${useEnd.id}. Descend and maintain ${fmtAlt(alt)}. ILS course ${String(Math.round(useEnd.heading)).padStart(3, '0')}.`, `${scs}, expect I L S approach runway ${sayRunway(useEnd.id)}. Descend and maintain ${sayAlt(alt)}.`);
          else this.say(st, `${cs}, make straight-in approach runway ${useEnd.id}, report 5 mile final.`, `${scs}, make straight in approach runway ${sayRunway(useEnd.id)}, report five mile final.`);
          this.instruction = `${id === 'ils' ? 'ILS' : 'Visual'} RWY ${useEnd.id} — descend ${fmtAlt(alt)}`;
          this.vectoring = id === 'ils';
        }, 1400);
        break;
      }
      case 'climb':
      case 'descend': {
        const st = c.dist < 30000 ? this.station(ap, 'approach') : this.station(ap, 'center');
        const cur = fm.position.y / FT;
        const tgt = Math.max(2000, Math.round((cur + (id === 'climb' ? 4000 : -4000)) / 1000) * 1000);
        this.playerSay(st, `${st.name}, ${cs}, request ${id === 'climb' ? 'higher' : 'lower'}.`);
        setTimeout(() => {
          this.say(st, `${cs}, ${id === 'climb' ? 'climb' : 'descend'} and maintain ${fmtAlt(tgt)}.`, `${scs}, ${id === 'climb' ? 'climb' : 'descend'} and maintain ${sayAlt(tgt)}.`);
          this.instruction = `${id === 'climb' ? 'Climb' : 'Descend'} ${fmtAlt(tgt)}`;
          c.p.sim.ap.alt = tgt;
        }, 1200);
        break;
      }
      case 'direct': {
        const st = this.station(ap, 'center');
        this.playerSay(st, `${st.name}, ${cs}, request direct ${c.dest.icao}.`);
        setTimeout(() => {
          this.say(st, `${cs}, cleared direct ${c.dest.icao}.`, `${scs}, cleared direct ${c.dest.icao.split('').join(' ')}.`);
          const nav = c.p.sim.nav;
          nav.directTo(nav.plan.length - 1);
          this.instruction = `Direct ${c.dest.icao}`;
        }, 1100);
        break;
      }
      case 'following': {
        const st = this.station(ap, 'center');
        this.playerSay(st, `${st.name}, ${cs}, ${fmtAlt(fm.position.y / FT)}, request flight following.`);
        setTimeout(() => {
          this.say(st, `${cs}, radar contact, ${Math.round(c.dist / NM)} miles from ${shortName(ap)}. Maintain VFR.`, `${scs}, radar contact. Maintain V F R.`);
          this.state = 'enroute';
        }, 1200);
        break;
      }
      case 'mayday': {
        const st = c.dist < 30000 ? this.station(ap, c.onGround ? 'tower' : 'approach') : this.station(ap, 'center');
        if (this.emergency) {
          this.emergency = false;
          this.playerSay(st, `${st.name}, ${cs}, cancel emergency.`);
          setTimeout(() => this.say(st, `${cs}, roger, emergency cancelled.`, `${scs}, roger.`), 900);
          break;
        }
        this.emergency = true;
        this.playerSay(st, `MAYDAY MAYDAY MAYDAY, ${st.name}, ${cs}, declaring an emergency.`);
        const near = nearestAirport(fm.position.x, fm.position.z, (a) => a.runwayObjs.some((r) => r.length >= minLen));
        const tgt = near.airport;
        const end = this.activeRunway(tgt, minLen);
        this.airport = tgt;
        this.assignedEnd = end;
        c.p.sim.nav.setApproach(end);
        c.p.sim.nav.destination = tgt;
        setTimeout(() => {
          const brg = (Math.atan2(tgt.x - fm.position.x, -(tgt.z - fm.position.z)) / DEG + 360) % 360;
          this.say(st, `${cs}, MAYDAY acknowledged. Nearest suitable airport ${tgt.name}, bearing ${String(Math.round(brg)).padStart(3, '0')}, ${Math.round(near.distance / NM)} miles. Runway ${end.id}, all runways available, emergency services standing by. Cleared to land any runway.`, `${scs}, mayday acknowledged. ${shortName(tgt)} bearing ${sayHeading(brg)}, ${digits(Math.round(near.distance / NM))} miles. Cleared to land, any runway.`);
          this.clearances.landing = true;
          this.state = 'clearedLand';
          this.instruction = `MAYDAY — ${tgt.icao} RWY ${end.id}, cleared to land`;
        }, 1200);
        break;
      }
    }
  }

  setDepartureApproach() {}

  routeToHold(ap, end, pos) {
    const L = LAYOUTS.get(ap.icao);
    if (!L) return null;
    const from = nearestNode(L, pos.x, pos.z, ['gate', 'lane', 'alley', 'parallel', 'hold']);
    const holdId = L.holdPoints[end.id];
    if (from == null || holdId === undefined) return null;
    const r = taxiRoute(L, from.id, holdId);
    if (!r) return null;
    const names = new Set();
    for (const n of r) if (n.kind === 'parallel') names.add('A');
    for (const n of r) if (n.kind === 'lane' || n.kind === 'alley') names.add('L');
    return { points: [{ x: pos.x, z: pos.z }, ...r.map((n) => ({ x: n.x, z: n.z }))], via: [...names].sort().join(' ') };
  }

  setTaxiPath(points) {
    const scene = this.game.scene;
    if (this.line) {
      scene.remove(this.line);
      this.line.geometry.dispose();
      this.line = null;
    }
    this.taxiPath = points;
    if (!points || points.length < 2) return;
    const world = this.game.world;
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 15));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n,
          z = a.z + ((b.z - a.z) * k) / n;
        pts.push(new THREE.Vector3(x, world.heightAt(x, z) + 0.6, z));
      }
    }
    const last = points[points.length - 1];
    pts.push(new THREE.Vector3(last.x, world.heightAt(last.x, last.z) + 0.6, last.z));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.line = new THREE.Line(g, this.lineMat);
    this.line.computeLineDistances();
    this.line.renderOrder = 6;
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  // ---------------------------------------------------------------- automatic
  update(dt) {
    const c = this.context();
    if (!c || c.p.sim.crashed) return;
    const cs = this.callsign();
    const scs = sayCallsign(cs);
    const fm = c.fm;
    const ap = this.airport || c.ap;
    // Pending takeoff clearance once traffic is clear
    if (this.pendingTakeoff) {
      this.pendingTakeoff.t -= dt;
      if (this.pendingTakeoff.t <= 0) {
        const end = this.pendingTakeoff.end;
        if (!this.game.traffic || this.game.traffic.runwayFreeForDeparture(ap, end, null)) {
          const st = this.station(ap, 'tower');
          const w = this.windText();
          this.say(st, `${cs}, runway ${end.id}, ${w.text}, cleared for takeoff.`, `${scs}, runway ${sayRunway(end.id)}, ${w.speech}, cleared for take off.`);
          this.clearances.takeoff = true;
          this.state = 'clearedTakeoff';
          this.instruction = `Cleared for takeoff RWY ${end.id}`;
          this.pendingTakeoff = null;
        } else this.pendingTakeoff.t = 10;
      }
    }
    // Clear taxi line when reaching its end
    if (this.taxiPath && fm.wow) {
      const last = this.taxiPath[this.taxiPath.length - 1];
      if (Math.hypot(last.x - fm.position.x, last.z - fm.position.z) < 25) {
        this.setTaxiPath(null);
        if (this.state === 'taxiing') {
          this.state = 'holdShort';
          this.instruction = `Holding short RWY ${this.assignedEnd ? this.assignedEnd.id : ''} — call ready (Tab)`;
        }
      }
    }
    // Takeoff without clearance (monitoring)
    if (fm.wow && fm.groundSpeed > 30 && runwayAt(fm.position.x, fm.position.z) && !this.clearances.takeoff && this.state !== 'landed' && this.state !== 'clearedLand' && !this.emergency && this.game.atcStrict) {
      if (!this.warnedTakeoff) {
        this.warnedTakeoff = true;
        const st = this.station(c.ap, 'tower');
        this.say(st, `${cs}, you were not cleared for takeoff! Contact the tower after departure.`, `${scs}, you were not cleared for take off.`);
        this.violations.push('Takeoff without clearance');
      }
    }
    // After takeoff -> departure
    if (this.state === 'clearedTakeoff' && !fm.wow && c.agl > 300) {
      const st = this.station(ap, 'approach');
      const alt = Math.max(5000, Math.round((ap.elevation / FT + 5000) / 1000) * 1000);
      this.say(st, `${cs}, ${st.name}, radar contact. Climb and maintain ${fmtAlt(alt)}, proceed on course.`, `${scs}, radar contact. Climb and maintain ${sayAlt(alt)}, proceed on course.`);
      this.state = 'departure';
      this.instruction = `Climb ${fmtAlt(alt)}, on course`;
      this.clearances.takeoff = false;
    }
    if (this.state === 'departure' && c.dist > 30000) {
      const st = this.station(ap, 'center');
      this.say(st, `${cs}, contact Aurelia Center on 132.45. Good day.`, `${scs}, contact Aurelia Center, one three two decimal four five. Good day.`);
      this.state = 'enroute';
      this.instruction = '';
    }
    // Approach vectors to the ILS
    if (this.state === 'approach' && this.assignedEnd && !fm.wow) {
      const end = this.assignedEnd;
      const rel = runwayRelative(end, fm.position.x, fm.position.z);
      const dist = -rel.along;
      this.lastVector -= dt;
      const ils = c.p.sim.nav.ils;
      if (this.vectoring && this.lastVector <= 0 && dist > 9000) {
        this.lastVector = 25;
        // intercept heading: 30 degrees toward the centreline when within 15 km, else direct to a fix 15 km out
        let hdg;
        if (Math.abs(rel.lateral) < 12000 && dist < 30000 && dist > 8000) hdg = end.heading - Math.sign(rel.lateral) * 30;
        else {
          const fx = end.x - end.dirX * 16000,
            fz = end.z - end.dirZ * 16000;
          hdg = Math.atan2(fx - fm.position.x, -(fz - fm.position.z)) / DEG;
        }
        hdg = (Math.round(hdg / 5) * 5 + 360) % 360 || 360;
        const st = this.station(ap, 'approach');
        if (!this.lastHdg || Math.abs(((hdg - this.lastHdg + 540) % 360) - 180) > 8) {
          this.lastHdg = hdg;
          const intercept = Math.abs(rel.lateral) < 12000 && dist < 30000;
          this.say(st, `${cs}, turn ${((hdg - c.p.attitude.heading / DEG + 540) % 360) - 180 > 0 ? 'right' : 'left'} heading ${String(hdg).padStart(3, '0')}${intercept ? `, maintain ${fmtAlt(this.approachAlt)} until established, cleared ILS runway ${end.id} approach` : ''}.`, `${scs}, turn ${((hdg - c.p.attitude.heading / DEG + 540) % 360) - 180 > 0 ? 'right' : 'left'} heading ${sayHeading(hdg)}${intercept ? `, cleared I L S runway ${sayRunway(end.id)} approach` : ''}.`);
          this.instruction = `Fly heading ${String(hdg).padStart(3, '0')}${intercept ? `, cleared ILS ${end.id}` : ''}`;
          if (c.p.sim.ap.engaged && c.p.sim.ap.lat === 'HDG') c.p.sim.ap.hdg = hdg;
          if (intercept) this.vectoring = false;
        }
      }
      if (dist < 11000 && dist > 0 && Math.abs(rel.lateral) < 1500 && !this.clearances.landing) {
        const st = this.station(ap, 'tower');
        const traffic = !this.game.traffic || this.game.traffic.runwayFreeForArrival(ap, end, null);
        const w = this.windText();
        if (traffic) {
          this.say(st, `${cs}, ${st.name}, runway ${end.id}, ${w.text}, cleared to land.`, `${scs}, runway ${sayRunway(end.id)}, ${w.speech}, cleared to land.`);
          this.clearances.landing = true;
          this.state = 'clearedLand';
          this.instruction = `Cleared to land RWY ${end.id}`;
        } else if (!this.continueSaid) {
          this.continueSaid = true;
          this.say(st, `${cs}, continue approach, traffic on the runway.`, `${scs}, continue approach, traffic on the runway.`);
        }
      }
    }
    // Landed
    if ((this.state === 'clearedLand' || this.state === 'approach') && fm.wow && fm.groundSpeed < 30 * KT && fm.groundSpeed > 2) {
      const st = this.station(c.ap, 'tower');
      this.say(st, `${cs}, welcome to ${shortName(c.ap)}. Vacate the runway when able, contact ground ${c.ap.freq.ground}.`, `${scs}, welcome to ${shortName(c.ap)}. Vacate when able, contact ground.`);
      this.state = 'landed';
      this.instruction = 'Vacate runway, request taxi to gate (Tab)';
      this.clearances.landing = false;
      this.continueSaid = false;
      this.emergency = false;
    }
    this.aiTalkTimer -= dt;
  }

  // ---------------------------------------------------------------- AI chatter
  aiCall(ai, kind) {
    const p = this.player;
    if (!p) return;
    const ap = kind === 'final' || kind === 'goAround' || kind === 'vacated' ? ai.dest : ai.origin;
    if (!ap) return;
    const d = Math.hypot(ap.x - p.position.x, ap.z - p.position.z);
    if (d > 45000) return;
    const speak = this.aiTalkTimer <= 0 && d < 25000;
    if (speak) this.aiTalkTimer = 9;
    const cs = ai.callsign,
      scs = sayCallsign(cs);
    const w = this.windText();
    const voice = ['pilot2', 'pilot3'][ai.id % 2];
    const delay = (fn) => setTimeout(fn, 1500);
    switch (kind) {
      case 'pushback': {
        const st = this.station(ap, 'ground');
        this.say(st, `${st.name}, ${cs}, request pushback.`, `${shortName(ap)} ground, ${scs}, request push back.`, 'ai', voice, speak);
        delay(() => this.say(st, `${cs}, pushback approved, face ${ai.depEnd ? (ai.depEnd.heading > 180 ? 'east' : 'west') : 'north'}.`, `${scs}, push back approved.`, 'atc', 'atc', speak));
        break;
      }
      case 'taxi': {
        const st = this.station(ap, 'ground');
        this.say(st, `${cs}, taxi to runway ${ai.depEnd.id}, hold short.`, `${scs}, taxi to runway ${sayRunway(ai.depEnd.id)}, hold short.`, 'atc', 'atc', false);
        break;
      }
      case 'ready': {
        const st = this.station(ap, 'tower');
        this.say(st, `${st.name}, ${cs}, holding short ${ai.depEnd.id}, ready.`, `${shortName(ap)} tower, ${scs}, ready for departure.`, 'ai', voice, speak);
        break;
      }
      case 'takeoffClearance': {
        const st = this.station(ap, 'tower');
        this.say(st, `${cs}, runway ${ai.depEnd.id}, ${w.text}, cleared for takeoff.`, `${scs}, runway ${sayRunway(ai.depEnd.id)}, cleared for take off.`, 'atc', 'atc', speak);
        break;
      }
      case 'final': {
        const st = this.station(ap, 'tower');
        this.say(st, `${st.name}, ${cs}, established ILS ${ai.destEnd.id}.`, `${shortName(ap)} tower, ${scs}, established, runway ${sayRunway(ai.destEnd.id)}.`, 'ai', voice, speak);
        delay(() => this.say(st, `${cs}, runway ${ai.destEnd.id}, ${w.text}, cleared to land.`, `${scs}, cleared to land runway ${sayRunway(ai.destEnd.id)}.`, 'atc', 'atc', speak));
        break;
      }
      case 'goAround': {
        const st = this.station(ap, 'tower');
        this.say(st, `${cs}, going around.`, `${scs}, going around.`, 'ai', voice, true);
        delay(() => this.say(st, `${cs}, roger, fly runway heading, climb ${fmtAlt(3000 + ap.elevation / FT)}.`, `${scs}, roger, fly runway heading.`, 'atc', 'atc', true));
        break;
      }
      case 'vacated': {
        const st = this.station(ap, 'tower');
        this.say(st, `${cs}, runway vacated.`, null, 'ai', voice, false);
        break;
      }
    }
  }
}

export { sayCallsign, sayRunway, digits };
