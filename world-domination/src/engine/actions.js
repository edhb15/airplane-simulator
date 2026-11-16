// Every command the player can issue. Each returns { ok, msg }.
import { TERR } from './world.js';
import { GOVS, OFFICIAL_TRAITS, randomLeaderName, personalityOf } from '../data/people.js';
import { TECH_BY_ID } from '../data/techs.js';
import {
  clamp, rng, owned, news, nameOf, atWar, hasTreaty, addTreaty, removeTreaty, addOpinion, addTrust, remember,
  aliveIds, markDirty, touch, opinion, warsOf, enemySide, friendSide, sideOf, subjectsOf, hasTech, opinionBreakdown, allied,
} from './state.js';
import {
  UNITS, BUILDINGS, buildCost, unitBuildCost, manpowerCap, unitField, availableTechs, effectiveTechCost,
} from './economy.js';
import {
  canDeclare, declareWar, hasClaim, launchOffensive, cancelOffensive, missileStrike, nukeStrike, peaceAcceptance,
  makePeace, warScore, termsCost, joinWar, breakCall, annexTerritory, releaseNation, makePuppet, territoryValue, nationValue,
} from './military.js';
import { evaluate, signTreaty, breakTreaty, TREATY_INFO, addInfluence, foundBloc, joinBloc, leaveBloc, protectorate, influence } from './diplomacy.js';
import { runOp } from './intel.js';
import { resolveDecision } from './events.js';
import { makeLeader } from './setup.js';

const ok = (msg) => ({ ok: true, msg });
const no = (msg) => ({ ok: false, msg });
const P = (s) => s.nations[s.player];

// ---------- Economy ----------
export function setTax(s, v) { P(s).tax = clamp(Math.round(v), 5, 70); return ok(); }
export function setBudget(s, key, v) {
  const lim = { mil: 30, res: 8, infra: 10, welfare: 25 }[key];
  P(s).budget[key] = clamp(+v, 0, lim);
  return ok();
}
export function setMix(s, key, v) { P(s).mix[key] = clamp(Math.round(v), 0, 100); return ok(); }
export function setMobil(s, level) {
  const n = P(s);
  if (level > n.mobil + 1 && !warsOf(s, s.player).length) return no('Total war requires an active war');
  n.mobil = clamp(level, 0, 2);
  return ok();
}
export function borrow(s, amount) {
  const n = P(s);
  const cap = (n.stats.gdp || 0) * 2.5;
  if (n.debt + amount > cap) return no('Lenders refuse: debt would exceed 250% of GDP');
  n.debt += amount; n.treasury += amount;
  return ok(`Borrowed $${amount.toFixed(1)}B`);
}
export function repay(s, amount) {
  const n = P(s);
  amount = Math.min(amount, n.treasury, n.debt);
  if (amount <= 0) return no('Nothing to repay');
  n.debt -= amount; n.treasury -= amount;
  return ok(`Repaid $${amount.toFixed(1)}B`);
}

export function build(s, tid, type) {
  const n = P(s), t = s.terr[tid];
  if (t.owner !== s.player) return no('Not your territory');
  if (t.ctrl !== s.player) return no('Territory is occupied');
  if (type === 'mines' && !Object.values(t.res).some((v) => v > 0)) return no('No resources to exploit here');
  const queued = t.build.filter((b) => b.type === type).length;
  if (t[type] + queued >= BUILDINGS[type].max) return no('Maximum level reached');
  if (t.build.length >= 3) return no('Construction queue is full (3)');
  const cost = buildCost(s, tid, type);
  if (n.treasury < cost) return no(`Need $${cost}B`);
  n.treasury -= cost;
  const fac = owned(s, s.player).reduce((a, x) => a + s.terr[x].fac, 0);
  const days = Math.round(BUILDINGS[type].days * (1 - Math.min(0.4, fac * 0.01)));
  t.build.push({ type, by: s.player, done: s.day + days, start: s.day });
  return ok(`${BUILDINGS[type].name} under construction (${days} days)`);
}

// ---------- Military ----------
export function recruit(s, type, amount) {
  const n = P(s);
  if (amount <= 0) return no('Nothing to build');
  if (type === 'missile' && !hasTech(s, s.player, 'str1')) return no('Requires Ballistic Missiles');
  if (type === 'navy' && !owned(s, s.player).some((t) => TERR[t].coastal)) return no('We have no coastline');
  if (type === 'nuke') return buildNuke(s);
  const cost = unitBuildCost(s, s.player, type) * amount;
  if (n.treasury < cost) return no(`Need $${cost.toFixed(1)}B`);
  if (type === 'army') {
    const queued = (n.prodQueue || []).filter((q) => q.type === 'army').reduce((a, q) => a + q.amount, 0);
    if (n.army + queued + amount > manpowerCap(s, s.player)) return no('Not enough manpower — raise mobilization');
  }
  n.treasury -= cost;
  (n.prodQueue ||= []).push({ type, amount, done: s.day + UNITS[type].days });
  return ok(`${amount} ${UNITS[type].unit} ordered for $${cost.toFixed(1)}B — ready in ${UNITS[type].days} days`);
}
export function buildNuke(s) {
  const n = P(s);
  if (!hasTech(s, s.player, 'str2')) return no('Requires Nuclear Weapons technology');
  if (n.nukeBuild > 0) return no('A warhead is already in production');
  const uranium = n.stats.resProd?.uranium || 0;
  const cost = unitBuildCost(s, s.player, 'nuke') * (uranium >= 0.3 ? 1 : 2.5);
  if (n.treasury < cost) return no(`Need $${cost.toFixed(1)}B${uranium < 0.3 ? ' (uranium imports triple the price)' : ''}`);
  n.treasury -= cost;
  n.nukeBuild = 12;
  n.infamy += 2;
  return ok('Warhead production started (12 months)');
}
export function disband(s, type, amount) {
  const n = P(s);
  const f = unitField(type);
  n[f] = Math.max(0, n[f] - amount);
  return ok();
}

export function declareWarOn(s, target) {
  const n = P(s);
  const chk = canDeclare(s, s.player, target);
  if (!chk.ok) return no(chk.why);
  const cb = hasClaim(s, s.player, target);
  if (!cb && n.pc < 25) return no('An unjustified war needs 25 political capital');
  if (!cb) n.pc -= 25;
  const w = declareWar(s, s.player, target);
  n.ai.lastWar = s.day;
  return ok(`War declared: ${w.name}`);
}
export function offensive(s, tid, divs) {
  const r = launchOffensive(s, s.player, tid, divs);
  return r.ok ? ok(`Offensive launched (${r.mode === 'naval' ? 'amphibious' : 'land'})`) : no(r.why);
}
export function haltOffensive(s, tid) { cancelOffensive(s, s.player, tid); return ok('Offensive halted'); }
export function fireMissiles(s, tid, count) {
  const r = missileStrike(s, s.player, tid, count);
  return r.ok ? ok(`${r.hits} missiles hit, ${r.intercepted} intercepted`) : no(r.why);
}
export function launchNuke(s, tid) {
  const r = nukeStrike(s, s.player, tid);
  return r.ok ? ok(r.intercepted ? 'Our warhead was intercepted!' : 'Target destroyed.') : no(r.why);
}

// Player-proposed peace. `mine` = what we demand (we're the winner);
// with concede=true the enemy gets `terms` from us.
export function proposePeace(s, warId, enemy, terms, concede = false) {
  const w = s.wars.find((x) => x.id === warId);
  if (!w) return no('War not found');
  if (!concede) {
    for (const tid of terms.annex || []) if (s.terr[tid].ctrl !== s.player && s.terr[tid].ctrl !== enemy) return no(`${TERR[tid].name} must be occupied by us first`);
    const acc = peaceAcceptance(s, w, s.player, enemy, terms);
    if (!acc.accept) { addOpinion(s, enemy, s.player, -3); return no(`${nameOf(s, enemy)} rejects the terms (${acc.total})`); }
    makePeace(s, w, s.player, enemy, terms);
    return ok('Peace signed');
  }
  const E = s.nations[enemy];
  const theirScore = warScore(s, w, enemy, s.player);
  const cost = termsCost(s, w, enemy, s.player, terms);
  const want = theirScore - E.warEx * 0.4 - 5;
  if (cost < want) return no(`${E.name} demands more (they feel entitled to ~${Math.round(want)} points, offered ${cost})`);
  makePeace(s, w, enemy, s.player, terms);
  return ok('Peace signed');
}
export function callAlly(s, warId, ally) {
  const w = s.wars.find((x) => x.id === warId);
  if (!w) return no('War not found');
  const side = sideOf(w, s.player);
  const enemy = side === 'att' ? w.defLead : w.attLead;
  const ev = evaluate(s, s.player, ally, 'callToArms', { enemy });
  if (!ev.accept) { breakCall(s, ally, s.player, enemy); return no(`${nameOf(s, ally)} refuses to join`); }
  joinWar(s, w, ally, side);
  return ok(`${nameOf(s, ally)} joins the war!`);
}

// ---------- Research ----------
export function research(s, techId) {
  const n = P(s);
  if (!availableTechs(s, s.player).some((t) => t.id === techId)) return no('Not available yet');
  if (n.research) {
    if (n.queue.includes(techId) || n.research.id === techId) return no('Already queued');
    n.queue.push(techId);
    return ok(`${TECH_BY_ID[techId].name} queued`);
  }
  n.research = { id: techId, prog: n.rpBank || 0 };
  n.rpBank = 0;
  return ok(`Researching ${TECH_BY_ID[techId].name}`);
}
export function unqueue(s, techId) {
  const n = P(s);
  n.queue = n.queue.filter((x) => x !== techId);
  if (n.research?.id === techId) { n.rpBank = n.research.prog; n.research = null; }
  return ok();
}

// ---------- Diplomacy ----------
export function propose(s, target, kind, extra = {}) {
  const n = P(s);
  const cost = kind === 'joinBloc' ? 20 : kind === 'protectorate' ? 40 : TREATY_INFO[kind]?.pc || 10;
  if (n.pc < cost) return no(`Needs ${cost} political capital`);
  const key = `prop:${kind}:${target}`;
  if ((s.flags[key] || -999) > s.day - 90) return no('They refused recently — wait a few months');
  const ev = evaluate(s, s.player, target, kind, extra);
  if (!ev.accept) {
    s.flags[key] = s.day;
    n.pc -= Math.round(cost / 4);
    return { ok: false, msg: `${nameOf(s, target)} declines`, ev };
  }
  n.pc -= cost;
  if (kind === 'joinBloc') joinBloc(s, extra.bloc, target);
  else if (kind === 'protectorate') protectorate(s, s.player, target);
  else signTreaty(s, kind, s.player, target);
  return { ok: true, msg: `${nameOf(s, target)} accepts!`, ev };
}
export function requestJoinBloc(s, blocId) {
  const b = s.blocs.find((x) => x.id === blocId);
  if (!b) return no('No such bloc');
  if (b.leader === s.player || b.members.includes(s.player)) return no('Already a member');
  const ev = evaluate(s, b.leader, s.player, 'joinBloc', { bloc: blocId });
  // The leader judges us: flip perspective
  const leaderView = evaluate(s, s.player, b.leader, b.type === 'military' ? 'defense' : 'trade');
  const total = Math.round((ev.total + leaderView.total) / 2);
  if (total <= 0) return { ok: false, msg: `${b.name} rejects our application`, ev: leaderView };
  joinBloc(s, blocId, s.player);
  return ok(`We have joined ${b.name}`);
}
export function quitBloc(s, blocId) { leaveBloc(s, blocId, s.player); return ok(); }
export function createBloc(s, name, type) {
  const n = P(s);
  if (n.pc < 50) return no('Needs 50 political capital');
  if (s.blocs.some((b) => b.leader === s.player && b.type === type)) return no(`You already lead a ${type} bloc`);
  n.pc -= 50;
  foundBloc(s, s.player, name || `${n.name} ${type === 'military' ? 'Alliance' : 'Economic Union'}`, type);
  return ok('Bloc founded — invite members from the diplomacy panel');
}
export function cancelTreaty(s, target, type) { breakTreaty(s, type, s.player, target); return ok(); }
export function guarantee(s, target) {
  const n = P(s);
  if (hasTreaty(s, s.player, target, 'guarantee')) { removeTreaty(s, 'guarantee', s.player, target); addTrust(s, target, s.player, -10); return ok('Guarantee withdrawn'); }
  if (n.pc < 20) return no('Needs 20 political capital');
  n.pc -= 20;
  addTreaty(s, 'guarantee', s.player, target);
  addOpinion(s, target, s.player, 20);
  addInfluence(s, s.player, target, 5);
  news(s, `${n.name} guarantees the independence of ${nameOf(s, target)}.`, { nations: [s.player, target] });
  return ok('Independence guaranteed');
}
export function improveRelations(s, target) {
  const n = P(s);
  if (n.pc < 15) return no('Needs 15 political capital');
  n.improving ||= [];
  if (n.improving.some((x) => x.target === target)) return no('Already improving relations');
  if (n.improving.length >= 4 + Math.floor(n.pers.diplomacy * 4)) return no('Too many diplomatic missions at once');
  n.pc -= 15;
  n.improving.push({ target, until: s.day + 360 });
  return ok('Diplomats dispatched for a year');
}
export function sendAid(s, target, amount) {
  const n = P(s), T = s.nations[target];
  if (n.treasury < amount) return no('Not enough money');
  n.treasury -= amount;
  T.treasury += amount;
  const rel = amount / Math.max(1, Math.sqrt(T.stats.gdp || 1));
  addOpinion(s, target, s.player, clamp(rel * 18, 2, 40));
  addInfluence(s, s.player, target, clamp(rel * 10, 1, 25));
  return ok(`Aid delivered to ${T.name}`);
}
export function investIn(s, target) {
  const n = P(s), T = s.nations[target];
  const cost = +(1 + (T.stats.gdp || 0) * 0.02).toFixed(1);
  if (n.treasury < cost) return no(`Needs $${cost}B`);
  n.treasury -= cost;
  T.treasury += cost * 0.5;
  addInfluence(s, s.player, target, 8 * (1 + 0) * (1 - influence(s, s.player, target) / 150));
  addOpinion(s, target, s.player, 4);
  return ok(`Invested $${cost}B — influence grows`);
}
export function culturalExchange(s, target) {
  const n = P(s);
  if (n.pc < 12) return no('Needs 12 political capital');
  n.pc -= 12;
  addInfluence(s, s.player, target, 6);
  addOpinion(s, target, s.player, 6);
  return ok('Cultural exchange programme launched');
}
export function denounce(s, target) {
  const n = P(s);
  addOpinion(s, target, s.player, -25);
  n.pc += 5;
  for (const id of aliveIds(s)) if (opinion(s, id, target) < -20) addOpinion(s, id, s.player, 6);
  news(s, `${n.name} publicly denounces ${nameOf(s, target)}.`, { nations: [s.player, target] });
  return ok('Denounced');
}
export function toggleEmbargo(s, target) {
  const i = s.embargo.findIndex((e) => e.a === s.player && e.b === target);
  if (i >= 0) { s.embargo.splice(i, 1); return ok('Embargo lifted'); }
  s.embargo.push({ a: s.player, b: target, since: s.day });
  removeTreaty(s, 'trade', s.player, target);
  addOpinion(s, target, s.player, -30);
  news(s, `${P(s).name} imposes an embargo on ${nameOf(s, target)}.`, { nations: [s.player, target] });
  return ok('Embargo imposed');
}
export function ultimatum(s, target, tid, vassal = false) {
  const n = P(s), T = s.nations[target];
  if (n.pc < 30) return no('Needs 30 political capital');
  n.pc -= 30;
  const ev = evaluate(s, s.player, target, 'ultimatum', vassal ? { vassal: true } : { terr: tid });
  if (ev.accept) {
    if (vassal) { makePuppet(s, target, s.player); n.infamy += 8; news(s, `${T.name} bows to ${n.name}'s ultimatum and becomes its puppet.`, { type: 'major', nations: [s.player, target] }); }
    else { annexTerritory(s, tid, s.player, 'ultimatum'); news(s, `${T.name} cedes ${TERR[tid].name} to ${n.name} under threat of war.`, { type: 'major', nations: [s.player, target] }); }
    addOpinion(s, target, s.player, -40);
    remember(s, target, s.player, 'Extorted us with threats of war', -40);
    return { ok: true, msg: `${T.name} gives in!`, ev };
  }
  s.flags[`ultimatum:${s.player}:${target}`] = s.day;
  addOpinion(s, target, s.player, -25);
  news(s, `${T.name} defies ${n.name}'s ultimatum.`, { nations: [s.player, target] });
  return { ok: false, msg: `${T.name} refuses — you now have a justification for war`, ev };
}

// ---------- Intelligence ----------
export function covertOp(s, target, op, opts) {
  const r = runOp(s, s.player, target, op, opts);
  if (!r.ok && r.why) return no(r.why);
  let msg = r.success ? `Success: ${r.result}` : 'The operation failed.';
  if (r.discovered) msg += ' Our agents were exposed!';
  return { ok: r.success, msg };
}

// ---------- Subjects, governors and conquered lands ----------
export function candidates(s, key, count = 3, gov) {
  const fkey = `cands:${key}`;
  const cached = s.flags[fkey];
  if (cached && cached.day > s.day - 180) return cached.list;
  const r = rng(s);
  const traits = Object.keys(OFFICIAL_TRAITS);
  const tid = TERR[key] ? key : s.nations[key]?.capital || key;
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({ name: randomLeaderName(r, tid, TERR[tid]?.subregion || 'Western Europe'), trait: r.pick(traits), age: r.int(35, 70) });
  }
  s.flags[fkey] = { day: s.day, list };
  return list;
}
export function appointGovernor(s, tid, idx) {
  const n = P(s), t = s.terr[tid];
  if (t.owner !== s.player) return no('Not your territory');
  const c = candidates(s, tid)[idx];
  if (!c) return no('No such candidate');
  const cost = Math.round(10 * (1 - (OFFICIAL_TRAITS[c.trait].cost || 0)));
  if (n.pc < cost) return no(`Needs ${cost} political capital`);
  n.pc -= cost;
  t.governor = { ...c, since: s.day };
  delete s.flags[`cands:${tid}`];
  return ok(`${c.name} appointed governor of ${TERR[tid].name}`);
}
export function appointPuppetLeader(s, sub, idx) {
  const n = P(s), S = s.nations[sub];
  if (S.overlord !== s.player) return no('Not your subject');
  const c = candidates(s, sub)[idx];
  if (!c) return no('No such candidate');
  if (n.pc < 25) return no('Needs 25 political capital');
  n.pc -= 25;
  S.leader = { name: c.name, traits: ['Pragmatist', c.trait === 'Loyalist' ? 'Honorable' : 'Cautious'], since: s.day, age: c.age, official: c.trait };
  S.pers = personalityOf(S.leader.traits);
  S.loyaltyBonus = OFFICIAL_TRAITS[c.trait].loyalty || 0;
  if (c.trait === 'Beloved') S.stability = Math.min(100, S.stability + 10);
  if (c.trait === 'Economist') S.budget.infra += 1;
  delete s.flags[`cands:${sub}`];
  news(s, `${c.name} is installed as leader of ${S.name}.`, { nations: [sub, s.player] });
  return ok(`${c.name} now governs ${S.name}`);
}
export function setSubjectGov(s, sub, gov) {
  const n = P(s), S = s.nations[sub];
  if (S.overlord !== s.player) return no('Not your subject');
  if (n.pc < 30) return no('Needs 30 political capital');
  n.pc -= 30;
  S.gov = gov; S.title = null;
  S.stability = clamp(S.stability - 10, 0, 100);
  S.nextElection = GOVS[gov].democratic ? s.day + 360 * 4 : null;
  if (GOVS[gov].democratic) S.loyaltyBonus = (S.loyaltyBonus || 0) - 5; else S.loyaltyBonus = (S.loyaltyBonus || 0) + 5;
  news(s, `${S.name} is reorganised as a ${GOVS[gov].name.toLowerCase()}.`, { nations: [sub] });
  return ok('Government established');
}
export function setTribute(s, sub, rate) {
  const S = s.nations[sub];
  if (S.overlord !== s.player) return no('Not your subject');
  S.tribute = clamp(rate, 0, 0.5);
  return ok();
}
export function integrationCost(s, sub) {
  const S = s.nations[sub];
  return Math.round(40 + owned(s, sub).length * 15 + Math.sqrt(S.stats.pop || 1) * 4);
}
export function integrateSubject(s, sub) {
  const n = P(s), S = s.nations[sub];
  if (S.overlord !== s.player) return no('Not your subject');
  const years = (s.day - S.subjectSince) / 360;
  if (years < 5) return no(`Must be a subject for 5 years (${years.toFixed(1)} so far)`);
  if (S.liberty > 50) return no('Liberty desire must be below 50%');
  const cost = integrationCost(s, sub);
  if (n.pc < cost) return no(`Needs ${cost} political capital`);
  n.pc -= cost;
  n.army += S.army * 0.8; n.navy += S.navy * 0.8; n.air += S.air * 0.8; n.nukes += S.nukes;
  n.treasury += S.treasury;
  for (const tid of [...owned(s, sub)]) {
    annexTerritory(s, tid, s.player, 'integrate');
    s.terr[tid].integ = 40;
  }
  news(s, `${S.name} is formally annexed into ${n.name}.`, { type: 'major', nations: [s.player, sub] });
  return ok(`${S.name} integrated`);
}
export function freeSubject(s, sub) {
  const S = s.nations[sub];
  if (S.overlord !== s.player) return no('Not your subject');
  S.overlord = null;
  addOpinion(s, sub, s.player, 40);
  news(s, `${P(s).name} grants ${S.name} full independence.`, { nations: [s.player, sub] });
  return ok('Independence granted');
}
// Hand an annexed territory back to (or create) its own nation, as our puppet
export function releaseAsPuppet(s, tid) {
  const t = s.terr[tid];
  if (t.owner !== s.player) return no('Not your territory');
  if (t.core === s.player && !s.nations[tid]) return no('This is our own homeland');
  const nid = releaseNation(s, tid, s.player);
  if (!nid) return no('No nation to release');
  makePuppet(s, nid, s.player);
  const N = s.nations[nid];
  N.leader = makeLeader(s, nid, N.gov, ['Pragmatist', 'Cautious']);
  N.pers = personalityOf(N.leader.traits);
  N.liberty = 20;
  addOpinion(s, nid, s.player, 20);
  news(s, `${P(s).name} establishes ${N.name} as a client state.`, { type: 'major', nations: [s.player, nid] });
  return ok(`${N.name} released as a puppet state`);
}
export function changeGovernment(s, gov) {
  const n = P(s);
  if (gov === n.gov) return no('Already your government');
  if (n.pc < 100) return no('Needs 100 political capital');
  n.pc -= 100;
  const was = n.gov;
  n.gov = gov; n.title = null;
  n.stability = clamp(n.stability - 15, 0, 100);
  n.nextElection = GOVS[gov].democratic ? s.day + 360 * 4 : null;
  if (GOVS[was].democratic && !GOVS[gov].democratic) for (const id of aliveIds(s)) if (GOVS[s.nations[id].gov].democratic) addOpinion(s, id, s.player, -15);
  news(s, `${n.name} becomes a ${GOVS[gov].name.toLowerCase()}.`, { type: 'major', nations: [s.player] });
  return ok('Government reformed');
}

export function declareIndependence(s) {
  const n = P(s);
  if (!n.overlord) return no('We are already independent');
  const lord = n.overlord;
  n.overlord = null;
  const w = declareWar(s, s.player, lord, { independence: true, cb: 'War of Independence' });
  w.name = `${n.name} War of Independence`;
  news(s, `🔥 ${n.name} throws off the yoke of ${nameOf(s, lord)}!`, { type: 'major', nations: [s.player, lord] });
  return ok('The war of independence has begun!');
}

// ---------- Pending decisions ----------
export function answer(s, idx, choice) {
  const p = s.pending[idx];
  if (!p) return no('Nothing to answer');
  s.pending.splice(idx, 1);
  const n = P(s);
  const w = p.war != null ? s.wars.find((x) => x.id === p.war) : null;
  switch (p.kind) {
    case 'event': resolveDecision(s, p, choice); break;
    case 'callToArms':
      if (!w) break;
      if (choice === 0) joinWar(s, w, s.player, p.side);
      else breakCall(s, s.player, p.ally, p.enemy);
      break;
    case 'joinOffensive':
      if (w && choice === 0) joinWar(s, w, s.player, 'att');
      break;
    case 'proposal':
      if (choice === 0 && s.nations[p.from]?.alive && !atWar(s, s.player, p.from)) signTreaty(s, p.treaty, p.from, s.player);
      else addOpinion(s, p.from, s.player, -5);
      break;
    case 'peaceDemand':
      if (w && choice === 0 && s.nations[p.from]?.alive) makePeace(s, w, p.from, s.player, p.terms);
      break;
    case 'peaceOffer':
      if (w && choice === 0 && s.nations[p.from]?.alive) {
        const terms = { ...p.terms, annex: (p.terms.annex || []).filter((t) => s.terr[t].owner === p.from) };
        makePeace(s, w, s.player, p.from, terms);
      }
      break;
    case 'ultimatum':
      if (choice === 0) {
        if (s.terr[p.terr].owner === s.player) annexTerritory(s, p.terr, p.from, 'ultimatum');
        n.stability -= 10;
        news(s, `${n.name} cedes ${TERR[p.terr].name} to ${nameOf(s, p.from)}.`, { type: 'bad', player: true });
      } else {
        s.flags[`ultimatum:${p.from}:${s.player}`] = s.day;
        if (s.nations[p.from]?.alive && !atWar(s, p.from, s.player) && !allied(s, p.from, s.player) && rng(s).chance(0.7)) declareWar(s, p.from, s.player, { cb: 'Rejected ultimatum' });
      }
      break;
    case 'retaliate':
      if (choice === 0 && s.nations[p.enemy]?.alive) {
        const cap = s.nations[p.enemy].capital;
        if (cap) nukeStrike(s, s.player, cap, true);
      }
      break;
    default: break;
  }
  markDirty(s);
  return ok();
}
