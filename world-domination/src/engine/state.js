// Core state accessors shared by every engine module.
import { TERR, TERR_IDS, distance } from './world.js';
import { GOVS } from '../data/people.js';
import { TECH_BY_ID } from '../data/techs.js';
import { Rng } from './rng.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const rng = (s) => (s._rng ||= new Rng(s, 'rngState'));

// ---------- Dates ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateOf(day, startYear = 2027) {
  // 30-day months / 360-day years keep the calendar simple and saves stable
  const y = startYear + Math.floor(day / 360);
  const m = Math.floor((day % 360) / 30);
  const d = (day % 30) + 1;
  return { y, m, d };
}
export function fmtDate(s, day = s.day) {
  const { y, m, d } = dateOf(day, s.startYear);
  return `${d} ${MONTHS[m]} ${y}`;
}
export function fmtMonth(s, day = s.day) {
  const { y, m } = dateOf(day, s.startYear);
  return `${MONTHS[m]} ${y}`;
}
export const yearOf = (s, day = s.day) => dateOf(day, s.startYear).y;

// ---------- Nations & territories ----------
export const nat = (s, id) => s.nations[id];
export const alive = (s) => Object.values(s.nations).filter((n) => n.alive);
// Cached per ownership revision; callers must not mutate the returned array
export const aliveIds = (s) => memo(s, 'alive', () => Object.keys(s.nations).filter((id) => s.nations[id].alive));

// Ownership index (rebuilt lazily when s.rev changes)
const idx = new WeakMap();
function index(s) {
  let c = idx.get(s);
  if (!c || c.rev !== s.rev) {
    const owned = {}, controlled = {};
    for (const id of TERR_IDS) {
      const t = s.terr[id];
      (owned[t.owner] ||= []).push(id);
      (controlled[t.ctrl] ||= []).push(id);
    }
    c = { rev: s.rev, owned, controlled, cache: new Map() };
    idx.set(s, c);
  }
  return c;
}
export const touch = (s) => { s.rev = (s.rev || 0) + 1; };
export const owned = (s, nid) => index(s).owned[nid] || [];
export const controlled = (s, nid) => index(s).controlled[nid] || [];
export function memo(s, key, fn) {
  const c = index(s).cache;
  let v = c.get(key);
  if (v === undefined) { v = fn(); c.set(key, v); }
  return v;
}
// Cache cleared every game day
const dayIdx = new WeakMap();
export function dayMemo(s, key, fn) {
  let c = dayIdx.get(s);
  const stamp = `${s.day}:${s.rev}`;
  if (!c || c.stamp !== stamp) { c = { stamp, data: new Map() }; dayIdx.set(s, c); }
  let v = c.data.get(key);
  if (v === undefined) { v = fn(); c.data.set(key, v); }
  return v;
}
// Per-month cache that also resets when ownership changes
const monthIdx = new WeakMap();
export function monthMemo(s, key, fn) {
  let c = monthIdx.get(s);
  const stamp = `${s.rev}:${Math.floor(s.day / 30)}:${s.mstamp || 0}`;
  if (!c || c.stamp !== stamp) { c = { stamp, data: new Map() }; monthIdx.set(s, c); }
  let v = c.data.get(key);
  if (v === undefined) { v = fn(); c.data.set(key, v); }
  return v;
}
export const markDirty = (s) => { s.dirty = (s.dirty || 0) + 1; };
// Force monthly caches (opinions) to refresh, e.g. right after a player action
export const refreshMonthly = (s) => { s.mstamp = (s.mstamp || 0) + 1; };

export function capitalOf(s, nid) {
  const n = s.nations[nid];
  if (n.capital && s.terr[n.capital]?.owner === nid) return n.capital;
  const list = owned(s, nid);
  if (!list.length) return null;
  let best = list[0];
  for (const t of list) if (s.terr[t].gdp > s.terr[best].gdp) best = t;
  n.capital = best;
  return best;
}

export function nationGdp(s, nid) {
  let g = 0;
  for (const t of owned(s, nid)) g += s.terr[t].gdp * (s.terr[t].ctrl === nid ? 1 : 0.35);
  return g;
}
export function nationPop(s, nid) {
  let p = 0;
  for (const t of owned(s, nid)) p += s.terr[t].pop;
  return p;
}
export function gdpPerCapita(s, nid) {
  const p = nationPop(s, nid);
  return p > 0 ? (nationGdp(s, nid) * 1000) / p : 0; // $ per person
}

// Top of the subject chain (a puppet's puppet answers to the top overlord)
export function topOverlord(s, nid) {
  let n = s.nations[nid], guard = 0;
  while (n && n.overlord && guard++ < 10) n = s.nations[n.overlord];
  return n ? n.id : nid;
}
export const subjectsOf = (s, nid) => aliveIds(s).filter((id) => s.nations[id].overlord === nid);
export function realm(s, nid) {
  // nid plus every subject below it
  return aliveIds(s).filter((id) => topOverlord(s, id) === nid);
}

// ---------- Technology ----------
export function techMod(s, nid, key) {
  return memo(s, `tm:${nid}:${key}:${s.nations[nid].techs.length}`, () => {
    let v = 0;
    for (const t of s.nations[nid].techs) v += TECH_BY_ID[t]?.effects[key] || 0;
    return v;
  });
}
export const hasTech = (s, nid, id) => s.nations[nid].techs.includes(id);

// ---------- Relations ----------
const pk = (a, b) => `${a}>${b}`;
export function relMod(s, a, b) {
  return s.rel[pk(a, b)] || 0;
}
export function addOpinion(s, a, b, v) {
  if (a === b) return;
  const k = pk(a, b);
  s.rel[k] = clamp((s.rel[k] || 0) + v, -200, 200);
  if (Math.abs(s.rel[k]) < 0.5) delete s.rel[k];
  markDirty(s);
}
// Trust a holds in b (0..100, 50 neutral)
export function trust(s, a, b) {
  const v = s.trust[pk(a, b)];
  return v === undefined ? 50 : v;
}
export function addTrust(s, a, b, v) {
  if (a === b) return;
  const k = pk(a, b);
  s.trust[k] = clamp(trust(s, a, b) + v, 0, 100);
  if (Math.abs(s.trust[k] - 50) < 0.5) delete s.trust[k];
}
export function remember(s, a, b, text, value) {
  // a remembers something b did
  const k = pk(a, b);
  const list = (s.memory[k] ||= []);
  list.unshift({ day: s.day, text, value });
  if (list.length > 6) list.length = 6;
}
// Everyone remembers a betrayal or atrocity, the victims most of all
export function worldRemembers(s, culprit, text, opinion, trustHit, victims = []) {
  for (const id of aliveIds(s)) {
    if (id === culprit) continue;
    const victim = victims.includes(id);
    const m = victim ? 1 : 0.35;
    addOpinion(s, id, culprit, opinion * m);
    addTrust(s, id, culprit, trustHit * m);
    if (victim) remember(s, id, culprit, text, opinion);
  }
}

// ---------- Treaties & blocs ----------
const treatyIdx = new WeakMap();
function treatyIndex(s) {
  let c = treatyIdx.get(s.treaties);
  if (!c || c.len !== s.treaties.length) {
    const set = new Set();
    for (const t of s.treaties) {
      set.add(`${t.type}:${t.a}:${t.b}`);
      if (t.type !== 'guarantee') set.add(`${t.type}:${t.b}:${t.a}`);
    }
    c = { len: s.treaties.length, set };
    treatyIdx.set(s.treaties, c);
  }
  return c.set;
}
export function hasTreaty(s, a, b, type) {
  return treatyIndex(s).has(`${type}:${a}:${b}`);
}
export function treatiesOf(s, nid) {
  return s.treaties.filter((t) => t.a === nid || t.b === nid);
}
export function addTreaty(s, type, a, b) {
  if (hasTreaty(s, a, b, type)) return;
  s.treaties.push({ type, a, b, since: s.day });
  markDirty(s);
}
export function removeTreaty(s, type, a, b) {
  s.treaties = s.treaties.filter((t) => !(t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
  markDirty(s);
}
export const blocsOf = (s, nid) => s.blocs.filter((b) => b.members.includes(nid));
export function sameBloc(s, a, b, type) {
  return s.blocs.some((bl) => (!type || bl.type === type) && bl.members.includes(a) && bl.members.includes(b));
}
// Nations that are bound to defend nid if attacked
export function defenders(s, nid) {
  const out = new Set();
  for (const t of s.treaties) {
    if (t.type === 'defense') { if (t.a === nid) out.add(t.b); if (t.b === nid) out.add(t.a); }
    if (t.type === 'guarantee' && t.b === nid) out.add(t.a);
  }
  for (const b of s.blocs) if (b.type === 'military' && b.members.includes(nid)) b.members.forEach((m) => out.add(m));
  for (const c of s.coalitions) if (c.members.includes(nid)) c.members.forEach((m) => out.add(m));
  const n = s.nations[nid];
  if (n.overlord) out.add(n.overlord);
  for (const sub of subjectsOf(s, nid)) out.add(sub);
  out.delete(nid);
  return [...out].filter((id) => s.nations[id]?.alive);
}
export function allied(s, a, b) {
  if (a === b) return true;
  return hasTreaty(s, a, b, 'defense') || sameBloc(s, a, b, 'military') || topOverlord(s, a) === topOverlord(s, b);
}

// ---------- Wars ----------
export const warsOf = (s, nid) => s.wars.filter((w) => w.att.includes(nid) || w.def.includes(nid));
export const sideOf = (w, nid) => (w.att.includes(nid) ? 'att' : w.def.includes(nid) ? 'def' : null);
export const enemySide = (w, nid) => (w.att.includes(nid) ? w.def : w.att);
export const friendSide = (w, nid) => (w.att.includes(nid) ? w.att : w.def);
export function atWar(s, a, b) {
  return s.wars.some((w) => (w.att.includes(a) && w.def.includes(b)) || (w.def.includes(a) && w.att.includes(b)));
}
export function enemiesOf(s, nid) {
  const out = new Set();
  for (const w of warsOf(s, nid)) enemySide(w, nid).forEach((e) => out.add(e));
  return out;
}
export function coBelligerents(s, nid) {
  const out = new Set();
  for (const w of warsOf(s, nid)) friendSide(w, nid).forEach((e) => out.add(e));
  out.delete(nid);
  return out;
}

// ---------- Opinion ----------
const IDEOLOGY_GROUP = { D: 'free', K: 'free', M: 'crown', C: 'red', A: 'strong', J: 'strong', T: 'faith' };
export function govSimilarity(g1, g2) {
  if (g1 === g2) return 1;
  if (IDEOLOGY_GROUP[g1] === IDEOLOGY_GROUP[g2]) return 0.7;
  const dem1 = GOVS[g1].democratic, dem2 = GOVS[g2].democratic;
  if (dem1 !== dem2) return -0.6;
  return 0.1;
}

// Opinion a holds of b, with the breakdown for tooltips
export function opinionBreakdown(s, a, b) {
  const A = s.nations[a], B = s.nations[b];
  const parts = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.5) parts.push([label, Math.round(v)]); };
  const sim = govSimilarity(A.gov, B.gov);
  add(sim > 0 ? 'Similar government' : 'Rival ideology', sim * (10 + 25 * A.pers.ideology));
  if (borders(s, a, b)) add('Shared border', -6);
  if (sameBloc(s, a, b)) add('Same bloc', 18);
  if (hasTreaty(s, a, b, 'defense')) add('Defense pact', 22);
  if (hasTreaty(s, a, b, 'trade')) add('Trade agreement', 10);
  if (hasTreaty(s, a, b, 'research')) add('Research pact', 6);
  if (hasTreaty(s, a, b, 'nap')) add('Non-aggression pact', 6);
  if (hasTreaty(s, b, a, 'guarantee')) add('Guarantees our independence', 20);
  if (s.embargo.some((e) => e.a === b && e.b === a)) add('Embargo against us', -30);
  if (A.overlord === b) add('Our overlord', 10 - A.liberty * 0.4);
  if (B.overlord === a) add('Our subject', 10);
  if (atWar(s, a, b)) add('At war', -80);
  const enemiesA = enemiesOf(s, a);
  for (const e of enemiesOf(s, b)) if (enemiesA.has(e)) { add('Common enemy', 20); break; }
  if (B.infamy > 5) {
    const near = proximity(s, a, b);
    add('Aggressive expansion', -B.infamy * (0.25 + 0.75 * near) * (a === s.player || b !== s.player ? 1 : 1));
  }
  // Claims on our land
  const ours = owned(s, a);
  if (ours.some((t) => s.terr[t].core === b && s.terr[t].owner !== b)) add('Occupies their homeland', -10);
  if (owned(s, b).some((t) => s.terr[t].core === a)) add('Holds our homeland', -45);
  const inf = s.influence[a]?.[b] || 0;
  if (inf > 1) add('Their influence over us', inf * 0.25);
  const tr = trust(s, a, b);
  if (tr !== 50) add(tr > 50 ? 'Trusts them' : 'Distrusts them', (tr - 50) * 0.4);
  add('Recent events', relMod(s, a, b));
  const total = parts.reduce((x, [, v]) => x + v, 0);
  return { total: clamp(total, -200, 200), parts };
}
export function opinion(s, a, b) {
  if (a === b) return 100;
  return monthMemo(s, `op:${a}:${b}`, () => opinionBreakdown(s, a, b).total);
}

export function borders(s, a, b) {
  return memo(s, `bd:${a < b ? a + b : b + a}`, () => {
    const ob = new Set(owned(s, b));
    for (const t of owned(s, a)) for (const n of TERR[t].nb) if (ob.has(n)) return true;
    return false;
  });
}
export function neighborsOf(s, nid) {
  return memo(s, `nb:${nid}`, () => {
    const out = new Set();
    for (const t of owned(s, nid)) for (const n of TERR[t].nb) {
      const o = s.terr[n].owner;
      if (o !== nid) out.add(o);
    }
    return [...out];
  });
}
// 1 = right next door, ~0 = other side of the planet
export function proximity(s, a, b) {
  return memo(s, `px:${a < b ? a + b : b + a}`, () => {
    if (borders(s, a, b)) return 1;
    const ca = capitalOf(s, a), cb = capitalOf(s, b);
    if (!ca || !cb) return 0;
    let best = distance(ca, cb);
    // closest pair of territories, sampled for big empires
    const la = owned(s, a).slice(0, 25), lb = owned(s, b).slice(0, 25);
    for (const x of la) for (const y of lb) best = Math.min(best, distance(x, y));
    return clamp(1 - best / 9000, 0.05, 0.95);
  });
}

// ---------- News ----------
export function news(s, text, opts = {}) {
  s.news.unshift({ day: s.day, text, type: opts.type || 'info', n: opts.nations || [], t: opts.terr });
  if (s.news.length > 400) s.news.length = 400;
  if (opts.player || (opts.nations || []).includes(s.player)) s.alerts.push({ day: s.day, text, type: opts.type || 'info' });
}

export function nameOf(s, nid) {
  return s.nations[nid]?.name || TERR[nid]?.name || nid;
}
export function govName(n) {
  return GOVS[n.gov].name;
}
export function leaderTitle(n) {
  return n.title || GOVS[n.gov].title;
}
