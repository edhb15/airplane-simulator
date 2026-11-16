// Military power, wars, combat, occupation and peace.
import { TERR, distance } from './world.js';
import { OFFICIAL_TRAITS } from '../data/people.js';
import {
  clamp, rng, owned, controlled, touch, techMod, hasTech, news, nameOf, warsOf, sideOf, enemySide, friendSide,
  atWar, defenders, addOpinion, addTrust, remember, worldRemembers, hasTreaty, removeTreaty, subjectsOf, topOverlord,
  capitalOf, aliveIds, markDirty, memo, dayMemo, opinion, coBelligerents, enemiesOf,
} from './state.js';

// ---------- Strength ----------
export const qLand = (s, nid) => 1 + techMod(s, nid, 'land') + techMod(s, nid, 'allMil');
export const qNaval = (s, nid) => 1 + techMod(s, nid, 'naval') + techMod(s, nid, 'allMil');
export const qAir = (s, nid) => 1 + techMod(s, nid, 'air') + techMod(s, nid, 'allMil');

export function powerOf(s, nid) {
  const n = s.nations[nid];
  const rd = n.readiness;
  const land = n.army * qLand(s, nid) * rd;
  const naval = n.navy * qNaval(s, nid) * rd;
  const air = n.air * qAir(s, nid) * rd;
  const strategic = n.missiles * 0.25 + n.nukes * 20;
  return { land, naval, air, strategic, total: land + naval * 1.3 + air * 1.6 + strategic };
}
export function updatePower(s) {
  for (const id of aliveIds(s)) {
    const p = powerOf(s, id);
    const st = s.nations[id].stats;
    st.power = p.total; st.land = p.land; st.naval = p.naval; st.airPow = p.air;
  }
}
// Conventional power a nation can bring to bear (no nukes)
export const convPower = (s, nid) => {
  const st = s.nations[nid].stats;
  return (st.land || 0) + (st.naval || 0) * 1.3 + (st.airPow || 0) * 1.6;
};

export function territoryValue(s, tid) {
  const t = s.terr[tid];
  return 2 + Math.sqrt(t.gdp) + Math.sqrt(t.pop) * 0.5;
}
export function nationValue(s, nid) {
  return owned(s, nid).reduce((a, t) => a + territoryValue(s, t), 0);
}

// ---------- Wars ----------
function warName(s, att, def) {
  const total = att.length + def.length;
  if (total >= 10) {
    s.world.worldWars = (s.world.worldWars || 0) + 1;
    return s.world.worldWars === 1 ? 'The Third World War' : `World War ${['', '', '', 'IV', 'V', 'VI', 'VII'][Math.min(6, s.world.worldWars + 2)] || s.world.worldWars + 2}`;
  }
  return `${nameOf(s, att[0])}–${nameOf(s, def[0])} War`;
}

export function canDeclare(s, a, b) {
  const A = s.nations[a], B = s.nations[b];
  if (!A?.alive || !B?.alive || a === b) return { ok: false, why: 'Invalid target' };
  if (A.overlord) return { ok: false, why: 'Subjects cannot declare wars' };
  if (topOverlord(s, b) === a) return { ok: false, why: 'They are your subject' };
  if (atWar(s, a, b)) return { ok: false, why: 'Already at war' };
  return { ok: true };
}

export function hasClaim(s, a, b) {
  const A = s.nations[a];
  if (owned(s, b).some((t) => A.claims.includes(t) || s.terr[t].core === a)) return 'Territorial claim';
  if (s.wars.some((w) => w.def.includes(a) && w.att.includes(b))) return 'Defensive war';
  if (s.nations[b].infamy > 50) return 'Containment of an aggressor';
  if (s.coalitions.some((c) => c.target === b && c.members.includes(a))) return 'Coalition mandate';
  if (s.flags[`ultimatum:${a}:${b}`]) return 'Rejected ultimatum';
  return null;
}

export function declareWar(s, a, b, opts = {}) {
  const r = rng(s);
  const A = s.nations[a], B = s.nations[b];
  // Wars are fought against the top of a subject chain
  const target = B.overlord && !opts.independence ? topOverlord(s, b) : b;
  const cb = opts.cb ?? hasClaim(s, a, target);
  const war = {
    id: s.world.warId++, name: '', att: [a], def: [target], attLead: a, defLead: target, start: s.day,
    cb: cb || 'No justification', offs: [], cas: {}, goal: opts.goal || null, independence: !!opts.independence,
  };
  // Treaty betrayal
  for (const type of ['nap', 'defense', 'trade', 'research']) {
    if (hasTreaty(s, a, target, type)) {
      removeTreaty(s, type, a, target);
      if (type === 'nap' || type === 'defense') {
        worldRemembers(s, a, `Broke a ${type === 'nap' ? 'non-aggression pact' : 'defense pact'} with ${B.name}`, -25, -25, [target]);
        A.infamy += 10;
      }
    }
  }
  if (!cb) {
    A.infamy += 12;
    worldRemembers(s, a, `Launched an unprovoked war on ${B.name}`, -15, -8, [target]);
    A.stability = clamp(A.stability - 6, 0, 100);
  } else if (!opts.independence) A.infamy += 4;
  addOpinion(s, target, a, -40);
  remember(s, target, a, 'Declared war on us', -40);
  // Subjects follow their masters
  for (const sub of subjectsOf(s, a)) if (!war.att.includes(sub) && sub !== target) war.att.push(sub);
  for (const sub of subjectsOf(s, target)) if (!war.def.includes(sub) && sub !== a) war.def.push(sub);
  s.wars.push(war);
  war.name = warName(s, war.att, war.def);
  touch(s); markDirty(s);
  news(s, `⚔️ ${A.name} declares war on ${s.nations[target].name}! (${war.cb})`, { type: 'war', nations: [a, target] });

  // Call to arms for the defender
  for (const ally of defenders(s, target)) {
    if (war.att.includes(ally) || war.def.includes(ally)) continue;
    if (ally === s.player) {
      s.pending.push({ kind: 'callToArms', war: war.id, side: 'def', ally: target, enemy: a, day: s.day });
      continue;
    }
    if (aiHonorsCall(s, ally, target, a)) joinWar(s, war, ally, 'def');
    else breakCall(s, ally, target, a);
  }
  // Opportunistic attackers
  for (const ally of defenders(s, a)) {
    if (war.att.includes(ally) || war.def.includes(ally) || ally === s.player) continue;
    const Al = s.nations[ally];
    if (opinion(s, ally, target) < -40 && Al.pers.aggression > 0.45 && r.chance(0.5)) joinWar(s, war, ally, 'att');
  }
  if (a !== s.player && defenders(s, a).includes(s.player) && !war.def.includes(s.player)) {
    s.pending.push({ kind: 'joinOffensive', war: war.id, ally: a, enemy: target, day: s.day });
  }
  if (war.att.length + war.def.length >= 10 && !/World War/.test(war.name)) war.name = warName(s, war.att, war.def);
  return war;
}

function aiHonorsCall(s, ally, friend, enemy) {
  const A = s.nations[ally];
  if (A.overlord) return true;
  if (atWar(s, ally, friend)) return false;
  let score = 0.45 + A.pers.honor * 0.5 + opinion(s, ally, friend) / 200 - opinion(s, ally, enemy) / 300;
  const ratio = (convPower(s, ally) + convPower(s, friend)) / Math.max(1, convPower(s, enemy));
  if (ratio < 0.4) score -= 0.3;
  if (hasTreaty(s, ally, enemy, 'nap')) score -= 0.3;
  if (s.nations[enemy].nukes > 5 && !s.nations[ally].nukes) score -= 0.15;
  return rng(s).chance(clamp(score, 0.05, 0.97));
}
export function breakCall(s, ally, friend, enemy) {
  addTrust(s, friend, ally, -30);
  addOpinion(s, friend, ally, -35);
  remember(s, friend, ally, 'Abandoned us in our hour of need', -35);
  removeTreaty(s, 'defense', ally, friend);
  news(s, `${nameOf(s, ally)} refuses to honor its commitments to ${nameOf(s, friend)}.`, { nations: [ally, friend] });
}

export function joinWar(s, war, nid, side) {
  if (war.att.includes(nid) || war.def.includes(nid)) return;
  war[side].push(nid);
  for (const sub of subjectsOf(s, nid)) if (!war.att.includes(sub) && !war.def.includes(sub)) war[side].push(sub);
  touch(s); markDirty(s);
  news(s, `${nameOf(s, nid)} joins the ${war.name} on the side of ${nameOf(s, side === 'att' ? war.attLead : war.defLead)}.`, { type: 'war', nations: [nid] });
  if (war.att.length + war.def.length >= 10 && !/World War/.test(war.name)) {
    war.name = warName(s, war.att, war.def);
    news(s, `🌍 The conflict has engulfed the globe. Historians already call it ${war.name}.`, { type: 'major' });
  }
}

// ---------- Reachability ----------
export function reach(s, nid, tid) {
  const t = s.terr[tid];
  const friends = new Set([nid, ...coBelligerents(s, nid)]);
  for (const nb of TERR[tid].nb) if (friends.has(s.terr[nb].ctrl) && s.terr[nb].ctrl === nid) return { mode: 'land', from: nb };
  for (const nb of TERR[tid].nb) if (friends.has(s.terr[nb].ctrl)) return { mode: 'land', from: nb, access: true };
  if (!TERR[tid].coastal) return null;
  const n = s.nations[nid];
  if (n.navy < 1) return null;
  // nearest coastal base
  let best = null, bd = Infinity;
  for (const c of controlled(s, nid)) {
    if (!TERR[c].coastal) continue;
    const d = distance(c, tid);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return null;
  const range = navalRange(s, nid);
  if (bd > range * 2.2) return null;
  return { mode: 'naval', from: best, dist: bd };
}
export function navalRange(s, nid) {
  const bases = owned(s, nid).reduce((a, t) => a + s.terr[t].bases, 0);
  return 3500 * (1 + techMod(s, nid, 'range')) + Math.min(6000, bases * 250) + Math.min(4000, s.nations[nid].navy * 15);
}
// Naval superiority of nid's side over the defenders of tid's controller
export function navalBalance(s, nid, tid) {
  const ctrl = s.terr[tid].ctrl;
  let mine = 0, theirs = 0;
  for (const id of [nid, ...coBelligerents(s, nid)]) mine += (s.nations[id].stats.naval || 0) * (id === nid ? 1 : 0.35);
  for (const id of [ctrl, ...coBelligerents(s, ctrl)]) {
    const d = Math.min(1, 6000 / Math.max(500, distance(capitalOf(s, id) || tid, tid)));
    theirs += (s.nations[id].stats.naval || 0) * (id === ctrl ? 1 : 0.35 * d);
  }
  return mine / Math.max(0.5, mine + theirs);
}

// ---------- Garrisons ----------
export function committed(s, nid) {
  let c = 0;
  for (const w of s.wars) for (const o of w.offs) if (o.by === nid) c += o.divs;
  return c;
}
export function freeArmy(s, nid) {
  return Math.max(0, s.nations[nid].army - committed(s, nid));
}
function garrisonWeights(s, nid) {
  return dayMemo(s, `gw:${nid}`, () => {
    const attacked = new Map();
    for (const w of s.wars) for (const o of w.offs) attacked.set(o.target, (attacked.get(o.target) || 0) + 1);
    const enemies = enemiesOf(s, nid);
    const cap = capitalOf(s, nid);
    const w = {};
    let sum = 0;
    for (const t of controlled(s, nid)) {
      let v = 1 + 3 * (attacked.get(t) || 0) + (t === cap ? 1.5 : 0) + Math.sqrt(s.terr[t].pop) * 0.05;
      if (TERR[t].nb.some((x) => enemies.has(s.terr[x].ctrl))) v += 1.5;
      w[t] = v; sum += v;
    }
    return { w, sum };
  });
}
export function militia(s, tid) {
  const t = s.terr[tid];
  return (t.core === t.ctrl ? 1 : 0.25) * Math.sqrt(t.pop) * 0.35 + 0.05;
}
export function garrison(s, tid) {
  const t = s.terr[tid];
  const c = t.ctrl;
  const gw = garrisonWeights(s, c);
  let g = gw.sum > 0 ? (freeArmy(s, c) * (gw.w[tid] || 0)) / gw.sum : 0;
  if (t.governor && OFFICIAL_TRAITS[t.governor.trait]?.garrison) g *= 1 + OFFICIAL_TRAITS[t.governor.trait].garrison;
  g += t.bases * 0.6;
  // Allies in the war lend a hand when they can reach
  for (const ally of coBelligerents(s, c)) {
    const near = TERR[tid].nb.some((x) => s.terr[x].ctrl === ally) || (TERR[tid].coastal && s.nations[ally].navy > 10);
    if (near) g += freeArmy(s, ally) * 0.06;
  }
  return g;
}

export function defenseStrength(s, tid, attacker) {
  const t = s.terr[tid];
  const c = t.ctrl;
  const C = s.nations[c];
  const g = garrison(s, tid);
  const air = airBonus(s, attacker, c);
  const size = 1 + Math.log10(1 + TERR[tid].area / 150000) * 0.35;
  let d = (g * qLand(s, c) * C.readiness + militia(s, tid) * 0.8) * (1 + 0.12 * t.forts) * size * (1 - air) * (t.core === c ? 1.1 : 1);
  d *= 1 - Math.min(0.6, (t.shock || 0) / 100);
  return { d, g };
}
function airBonus(s, a, b) {
  const pa = s.nations[a].stats.airPow || 0, pb = s.nations[b].stats.airPow || 0;
  return 0.6 * (pa / (pa + pb + 0.01) - 0.5);
}
export function attackStrength(s, nid, divs, tid, mode) {
  const n = s.nations[nid];
  const air = airBonus(s, nid, s.terr[tid].ctrl);
  let supply = 1 + techMod(s, nid, 'supply');
  if (mode === 'naval') {
    const d = reach(s, nid, tid)?.dist ?? 3000;
    supply *= clamp(1 - d / (navalRange(s, nid) * 2.5), 0.35, 1) * 0.65;
  }
  return divs * qLand(s, nid) * n.readiness * supply * (1 + air);
}
const sizeFactor = (tid) => 1 + Math.log10(1 + TERR[tid].area / 150000) * 0.9;

// ---------- Offensives ----------
export function canAttack(s, nid, tid) {
  const t = s.terr[tid];
  if (!atWar(s, nid, t.ctrl)) return { ok: false, why: 'Not at war with the controller' };
  const rr = reach(s, nid, tid);
  if (!rr) return { ok: false, why: TERR[tid].coastal ? 'Out of range — need a border or a navy in range' : 'No land route' };
  if (rr.mode === 'naval' && navalBalance(s, nid, tid) < 0.45) return { ok: false, why: 'Enemy fleets control the seas — naval superiority needed' };
  if (s.wars.some((w) => w.offs.some((o) => o.by === nid && o.target === tid))) return { ok: false, why: 'Offensive already underway' };
  return { ok: true, mode: rr.mode, from: rr.from };
}

export function maxNavalLift(s, nid) {
  return s.nations[nid].navy * 1.2 + 2;
}

export function launchOffensive(s, nid, tid, divs) {
  const chk = canAttack(s, nid, tid);
  if (!chk.ok) return chk;
  const free = freeArmy(s, nid);
  divs = Math.min(divs, free);
  if (chk.mode === 'naval') divs = Math.min(divs, maxNavalLift(s, nid));
  if (divs < 0.2) return { ok: false, why: 'Not enough free divisions' };
  const war = s.wars.find((w) => (w.att.includes(nid) && w.def.includes(s.terr[tid].ctrl)) || (w.def.includes(nid) && w.att.includes(s.terr[tid].ctrl)));
  war.offs.push({ id: `${war.id}-${s.day}-${tid}-${nid}`, by: nid, target: tid, divs, prog: 0, mode: chk.mode, from: chk.from, start: s.day });
  markDirty(s);
  return { ok: true, mode: chk.mode };
}
export function cancelOffensive(s, nid, tid) {
  for (const w of s.wars) w.offs = w.offs.filter((o) => !(o.by === nid && o.target === tid));
  markDirty(s);
}

// Weekly combat resolution
export function combatWeek(s) {
  const r = rng(s);
  for (const w of [...s.wars]) {
    for (const o of [...w.offs]) {
      const t = s.terr[o.target];
      const A = s.nations[o.by];
      if (!A?.alive || !atWar(s, o.by, t.ctrl) || A.army < 0.1) { w.offs = w.offs.filter((x) => x !== o); continue; }
      // Divisions can be lost elsewhere; don't commit more than exist
      o.divs = Math.min(o.divs, A.army);
      const att = attackStrength(s, o.by, o.divs, o.target, o.mode);
      const { d, g } = defenseStrength(s, o.target, o.by);
      const ratio = att / Math.max(0.001, att + d);
      o.ratio = ratio;
      const dp = ((ratio - 0.42) * 45) / sizeFactor(o.target) * r.range(0.75, 1.25);
      o.prog = clamp(o.prog + (dp > 0 ? dp : dp * 0.5), 0, 100);
      const intensity = 0.035 * r.range(0.7, 1.3);
      const attLoss = o.divs * intensity * (1 - ratio) * (o.mode === 'naval' ? 1.4 : 1);
      const defLoss = g * intensity * ratio;
      const D = s.nations[t.ctrl];
      A.army = Math.max(0, A.army - attLoss);
      o.divs = Math.max(0, o.divs - attLoss);
      D.army = Math.max(0, D.army - defLoss);
      w.cas[o.by] = (w.cas[o.by] || 0) + attLoss;
      w.cas[t.ctrl] = (w.cas[t.ctrl] || 0) + defLoss;
      A.warEx = clamp(A.warEx + (attLoss / Math.max(1, A.army + attLoss)) * 25, 0, 100);
      D.warEx = clamp(D.warEx + (defLoss / Math.max(1, D.army + defLoss)) * 25, 0, 100);
      t.devast = clamp(t.devast + 1.5, 0, 100);
      if (t.shock) t.shock = Math.max(0, t.shock - 15);
      if (o.prog >= 100) {
        w.offs = w.offs.filter((x) => x !== o);
        occupy(s, o.target, o.by, w);
      } else if (o.divs < 0.15 || (o.prog <= 0 && s.day - o.start > 60 && ratio < 0.3)) {
        w.offs = w.offs.filter((x) => x !== o);
        if (o.by === s.player) news(s, `Our offensive in ${TERR[o.target].name} has collapsed.`, { type: 'bad', player: true });
      }
    }
  }
  // Blockades
  for (const id of aliveIds(s)) {
    const n = s.nations[id];
    n.blockaded = false;
    const en = enemiesOf(s, id);
    if (!en.size) continue;
    let enemyNavy = 0;
    for (const e of en) enemyNavy += s.nations[e].stats.naval || 0;
    if (enemyNavy > (n.stats.naval || 0) * 2 + 5) n.blockaded = true;
  }
  checkCapitulations(s);
}

export function occupy(s, tid, nid, war) {
  const t = s.terr[tid];
  const prev = t.ctrl;
  t.ctrl = nid;
  t.devast = clamp(t.devast + 15, 0, 100);
  // Returning home: liberated lands go back to their owner if they're on our side
  if (t.owner !== nid && war && friendSide(war, nid).includes(t.owner)) t.ctrl = t.owner;
  touch(s); markDirty(s);
  const lib = t.ctrl === t.owner;
  news(s, lib ? `${nameOf(s, nid)} liberates ${TERR[tid].name}.` : `${nameOf(s, nid)} captures ${TERR[tid].name} from ${nameOf(s, prev)}.`,
    { type: 'war', nations: [nid, prev], terr: tid });
  // Divisions trapped by the advance are lost in the encirclement
  const P = s.nations[prev];
  if (!controlled(s, prev).length) {
    const lost = P.army * 0.5;
    P.army -= lost;
  }
}

// ---------- War score & peace ----------
export function warScore(s, war, a, b) {
  const sideA = friendSide(war, a), sideB = friendSide(war, b);
  const vb = nationValue(s, b) || 1, va = nationValue(s, a) || 1;
  let occB = 0, occA = 0;
  for (const t of owned(s, b)) if (sideA.includes(s.terr[t].ctrl)) occB += territoryValue(s, t);
  for (const t of owned(s, a)) if (sideB.includes(s.terr[t].ctrl)) occA += territoryValue(s, t);
  let score = (occB / vb) * 100 - (occA / va) * 100;
  const casA = sideA.reduce((x, id) => x + (war.cas[id] || 0), 0), casB = sideB.reduce((x, id) => x + (war.cas[id] || 0), 0);
  score += ((casB - casA) / (casA + casB + 2)) * 20;
  const capB = capitalOf(s, b), capA = capitalOf(s, a);
  if (capB && sideA.includes(s.terr[capB].ctrl)) score += 15;
  if (capA && sideB.includes(s.terr[capA].ctrl)) score -= 15;
  // Time favours the defender a little: long wars weigh on the attacker
  return clamp(Math.round(score), -100, 100);
}

export function termsCost(s, war, a, b, terms) {
  const vb = nationValue(s, b) || 1;
  let c = 0;
  for (const tid of terms.annex || []) c += Math.max(4, (territoryValue(s, tid) / vb) * 100);
  if (terms.puppet) c += 45 + clamp((convPower(s, b) / Math.max(1, convPower(s, a))) * 30, 0, 40) - (terms.annex?.length ? 10 : 0);
  if (terms.reparations) c += 12;
  if (terms.release) c += 10;
  return Math.round(c);
}

export function capitulated(s, nid) {
  const own = owned(s, nid);
  if (!own.length) return true;
  const total = nationValue(s, nid);
  let held = 0;
  for (const t of own) if (s.terr[t].ctrl === nid) held += territoryValue(s, t);
  const cap = capitalOf(s, nid);
  const capLost = cap && s.terr[cap].ctrl !== nid;
  return held / total < 0.2 || (capLost && held / total < 0.55) || (s.nations[nid].army < 0.2 && capLost);
}

// AI willingness to accept terms from a (winner) as b (loser)
export function peaceAcceptance(s, war, a, b, terms) {
  const B = s.nations[b];
  const score = warScore(s, war, a, b);
  const cost = termsCost(s, war, a, b, terms);
  const isWhite = cost === 0;
  const parts = [['War score', score], ['Demands', -cost], ['War exhaustion', Math.round(B.warEx * 0.3)]];
  if (B.pers.aggression > 0.5) parts.push(['Defiant leader', -8]);
  if (capitulated(s, b)) parts.push(['Capitulated', 100]);
  if (isWhite) {
    const theirScore = warScore(s, war, b, a);
    parts.push(['White peace appeal', theirScore < 15 ? 12 : -theirScore]);
  }
  const total = parts.reduce((x, [, v]) => x + v, 0);
  return { accept: total >= 0, total, parts, score, cost };
}

// Default terms a winning AI demands
export function aiTerms(s, war, a, b) {
  const A = s.nations[a];
  const score = warScore(s, war, a, b);
  const cap = capitulated(s, b);
  const occupiedByA = owned(s, b).filter((t) => s.terr[t].ctrl === a);
  const terms = { annex: [], puppet: false, reparations: false };
  if (score <= 5 && !cap) return terms;
  const greed = 0.4 + A.pers.expansion * 0.8 + A.pers.aggression * 0.4 - Math.min(0.5, A.infamy / 150);
  if (cap && owned(s, b).length && (occupiedByA.length === owned(s, b).length || greed > 0.9) && !(A.pers.expansion < 0.4)) {
    // Full conquest of a small nation, or puppet if large
    if (convPower(s, b) > convPower(s, a) * 0.5 || occupiedByA.length < owned(s, b).length) terms.puppet = true;
    else terms.annex = occupiedByA;
  } else if (cap && greed > 0.55) terms.puppet = true;
  else {
    terms.annex = occupiedByA.filter(() => rng(s).chance(greed));
    if (!terms.annex.length) terms.reparations = true;
  }
  // Trim to what the score supports
  if (!cap) {
    while (terms.annex.length && termsCost(s, war, a, b, terms) > score + 5) terms.annex.pop();
  }
  return terms;
}

export function annexTerritory(s, tid, nid, via = 'treaty') {
  const t = s.terr[tid];
  const old = t.owner;
  t.owner = nid;
  t.ctrl = nid;
  if (t.core !== nid) { t.integ = 0; t.unrest = Math.max(t.unrest, 40); }
  t.governor = null;
  t.build = [];
  const A = s.nations[nid];
  const share = territoryValue(s, tid) / Math.max(1, nationValue(s, old) + territoryValue(s, tid));
  if (via !== 'release' && via !== 'integrate') A.infamy += 4 + 22 * share + Math.sqrt(t.pop) * 0.6;
  touch(s); markDirty(s);
  // Claims satisfied
  A.claims = A.claims.filter((c) => c !== tid);
  if (!owned(s, old).length) destroyNation(s, old, nid);
}

export function makePuppet(s, sub, lord) {
  const S = s.nations[sub];
  S.overlord = lord;
  S.liberty = 25;
  S.subjectSince = s.day;
  for (const b of s.blocs) if (b.type === 'military') b.members = b.members.filter((m) => m !== sub);
  s.treaties = s.treaties.filter((t) => !((t.a === sub || t.b === sub) && (t.type === 'defense' || t.type === 'guarantee')));
  for (const c of s.coalitions) c.members = c.members.filter((m) => m !== sub);
  // Puppets bring their subjects along
  for (const x of subjectsOf(s, sub)) s.nations[x].overlord = lord;
  touch(s); markDirty(s);
}

export function destroyNation(s, nid, by) {
  const n = s.nations[nid];
  if (!n || !n.alive) return;
  n.alive = false;
  n.army = n.navy = n.air = n.missiles = n.nukes = 0;
  for (const b of s.blocs) b.members = b.members.filter((m) => m !== nid);
  s.blocs = s.blocs.filter((b) => b.members.length >= 2);
  s.treaties = s.treaties.filter((t) => t.a !== nid && t.b !== nid);
  s.coalitions = s.coalitions.filter((c) => c.target !== nid);
  for (const c of s.coalitions) c.members = c.members.filter((m) => m !== nid);
  s.embargo = s.embargo.filter((e) => e.a !== nid && e.b !== nid);
  for (const w of s.wars) {
    w.att = w.att.filter((m) => m !== nid);
    w.def = w.def.filter((m) => m !== nid);
    w.offs = w.offs.filter((o) => o.by !== nid);
  }
  s.wars = s.wars.filter((w) => w.att.length && w.def.length);
  for (const id of aliveIds(s)) if (s.nations[id].overlord === nid) s.nations[id].overlord = null;
  // Territories it still controlled as an occupier go back to their owners
  for (const t of Object.values(s.terr)) if (t.ctrl === nid) t.ctrl = t.owner;
  touch(s); markDirty(s);
  news(s, `🏴 ${n.name} has ceased to exist${by ? `, absorbed by ${nameOf(s, by)}` : ''}.`, { type: 'major', nations: [nid, by].filter(Boolean) });
  if (nid === s.player && !s.outcome) s.outcome = { type: 'defeat', reason: `${n.name} has been wiped off the map.`, day: s.day };
}

// Remove nation b from a war (separate peace) and apply terms in favour of a
export function makePeace(s, war, a, b, terms = {}) {
  const A = s.nations[a], B = s.nations[b];
  const winners = friendSide(war, a);
  const loserIsLeader = b === war.attLead || b === war.defLead;
  // The whole losing side leaves when its leader gives up
  const leaving = loserIsLeader ? [...friendSide(war, b)] : [b, ...subjectsOf(s, b).filter((x) => friendSide(war, b).includes(x))];
  const leaderSide = sideOf(war, b);
  const side1 = new Set(friendSide(war, a)), side2 = new Set(leaving);
  // Apply terms
  if (terms.annex?.length) for (const tid of terms.annex) if (s.terr[tid].owner === b) annexTerritory(s, tid, a);
  if (terms.reparations && B.alive) {
    const amt = (B.stats.gdp || 0) * 0.08;
    B.debt += amt; A.treasury += amt;
  }
  if (terms.puppet && B.alive) makePuppet(s, b, a);
  if (terms.release) releaseNation(s, terms.release, a);
  // Occupations between the two camps end
  for (const t of Object.values(s.terr)) {
    if ((side1.has(t.ctrl) && side2.has(t.owner)) || (side2.has(t.ctrl) && side1.has(t.owner))) t.ctrl = t.owner;
  }
  if (s.wars.includes(war)) {
    war[leaderSide] = war[leaderSide].filter((x) => !leaving.includes(x));
    war.offs = war.offs.filter((o) => !leaving.includes(o.by) && !leaving.includes(s.terr[o.target].owner));
    if (!war.att.length || !war.def.length || loserIsLeader) endWar(s, war);
  }
  // Consequences
  const harsh = (terms.annex?.length || 0) + (terms.puppet ? 3 : 0);
  if (B.alive) {
    addOpinion(s, b, a, -15 - harsh * 8);
    if (harsh) remember(s, b, a, terms.puppet ? 'Turned us into a puppet state' : 'Took our land', -30);
    B.stability = clamp(B.stability - 5 - harsh * 2, 0, 100);
  }
  A.stability = clamp(A.stability + (harsh ? 4 : 1), 0, 100);
  A.ai.lastWar = s.day;
  const desc = terms.puppet ? `${B.name} becomes a puppet of ${A.name}` : terms.annex?.length ? `${A.name} annexes ${terms.annex.map((t) => TERR[t].name).join(', ')}` : terms.reparations ? `${B.name} pays reparations` : 'white peace';
  news(s, `🕊️ Peace between ${A.name} and ${nameOf(s, b)}: ${desc}.`, { type: 'peace', nations: [a, b] });
  touch(s); markDirty(s);
}

export function endWar(s, war) {
  for (const t of Object.values(s.terr)) {
    if (t.ctrl !== t.owner && (war.att.includes(t.ctrl) || war.def.includes(t.ctrl)) && !s.wars.some((w) => w !== war && ((w.att.includes(t.ctrl) && w.def.includes(t.owner)) || (w.def.includes(t.ctrl) && w.att.includes(t.owner))))) t.ctrl = t.owner;
  }
  s.wars = s.wars.filter((w) => w !== war);
  touch(s); markDirty(s);
}

export function releaseNation(s, tid, by) {
  // Recreate (or revive) the nation whose homeland tid is
  const t = s.terr[tid];
  const nid = s.nations[tid] ? tid : t.core;
  let n = s.nations[nid];
  if (!n) return null;
  n.alive = true;
  n.overlord = null;
  t.owner = nid; t.ctrl = nid; t.core = nid; t.integ = 100; t.unrest = 10;
  n.capital = tid;
  n.army = Math.max(n.army, militia(s, tid) * 2);
  n.stability = 50; n.warEx = 0;
  touch(s); markDirty(s);
  return nid;
}

function checkCapitulations(s) {
  for (const w of [...s.wars]) {
    if (!s.wars.includes(w)) continue;
    for (const nid of [...w.att, ...w.def]) {
      if (!s.wars.includes(w) || !s.nations[nid].alive) continue;
      if (!friendSide(w, nid).includes(nid)) continue;
      if (!capitulated(s, nid)) continue;
      // Who dictates the peace: the enemy holding most of the land, else their leader
      const enemies = enemySide(w, nid);
      let winner = enemies.includes(w.attLead) ? w.attLead : w.defLead, best = -1;
      for (const e of enemies) {
        const held = owned(s, nid).filter((t) => s.terr[t].ctrl === e).length;
        if (held > best) { best = held; winner = e; }
      }
      if (topOverlord(s, winner) !== winner) winner = topOverlord(s, winner);
      if (!enemies.includes(winner)) winner = enemies[0];
      const N = s.nations[nid];
      news(s, `🏳️ ${N.name} capitulates in the ${w.name}!`, { type: 'major', nations: [nid, winner] });
      if (winner === s.player) {
        if (!s.pending.some((p) => p.kind === 'dictate' && p.loser === nid)) s.pending.push({ kind: 'dictate', war: w.id, loser: nid, day: s.day });
        continue;
      }
      if (nid === s.player) {
        const terms = aiTerms(s, w, winner, nid);
        s.pending.push({ kind: 'surrender', war: w.id, winner, terms, day: s.day });
        makePeace(s, w, winner, nid, terms);
        continue;
      }
      makePeace(s, w, winner, nid, aiTerms(s, w, winner, nid));
    }
  }
}

// ---------- Missiles & nuclear weapons ----------
export function interceptChance(s, attacker, defender) {
  return clamp(techMod(s, defender, 'abm') * (1 - techMod(s, attacker, 'pierce')), 0, 0.85);
}

export function missileStrike(s, by, tid, count) {
  const A = s.nations[by];
  const t = s.terr[tid];
  if (!hasTech(s, by, 'str1')) return { ok: false, why: 'Requires Ballistic Missiles technology' };
  if (!atWar(s, by, t.ctrl)) return { ok: false, why: 'Not at war with the controller' };
  count = Math.min(count, Math.floor(A.missiles));
  if (count < 1) return { ok: false, why: 'No missiles available' };
  const range = hasTech(s, by, 'str3') ? Infinity : 4000;
  const dist = Math.min(...controlled(s, by).map((c) => distance(c, tid)));
  if (dist > range) return { ok: false, why: 'Target out of range — ICBMs required' };
  A.missiles -= count;
  const ic = interceptChance(s, by, t.ctrl);
  let hits = 0;
  for (let i = 0; i < count; i++) if (!rng(s).chance(ic)) hits++;
  const dmg = hits * (1 + techMod(s, by, 'missileDmg'));
  const D = s.nations[t.ctrl];
  const killed = Math.min(D.army * 0.3, dmg * 0.08);
  D.army -= killed;
  t.devast = clamp(t.devast + Math.min(25, dmg * 0.6), 0, 100);
  t.infra = Math.max(0, t.infra - Math.min(0.5, dmg * 0.01));
  t.fac = Math.max(0, t.fac - Math.min(2, Math.floor(dmg * 0.02)));
  t.shock = clamp((t.shock || 0) + dmg * 2.5, 0, 60);
  A.infamy += 0.3 + count * 0.02;
  markDirty(s);
  news(s, `🚀 ${A.name} launches ${count} missiles at ${TERR[tid].name}: ${hits} hit${ic > 0 ? `, ${count - hits} intercepted` : ''}.`, { type: 'war', nations: [by, t.ctrl], terr: tid });
  return { ok: true, hits, intercepted: count - hits, killed };
}

export function nukeStrike(s, by, tid, isRetaliation = false) {
  const A = s.nations[by];
  const t = s.terr[tid];
  if (!hasTech(s, by, 'str2') || A.nukes < 1) return { ok: false, why: 'No nuclear warheads' };
  if (!atWar(s, by, t.ctrl) && !isRetaliation) return { ok: false, why: 'Not at war with the controller' };
  const dist = Math.min(...controlled(s, by).map((c) => distance(c, tid)));
  if (!hasTech(s, by, 'str3') && dist > 5000) return { ok: false, why: 'Target out of range — ICBMs required' };
  A.nukes -= 1;
  const victim = t.ctrl;
  const V = s.nations[victim];
  s.world.nukesUsed += 1;
  if (rng(s).chance(interceptChance(s, by, victim))) {
    news(s, `☢️ ${A.name} launches a nuclear missile at ${TERR[tid].name} — intercepted by ${V.name}'s missile shield!`, { type: 'major', nations: [by, victim] });
    worldRemembers(s, by, 'Attempted a nuclear strike', -50, -30, [victim]);
    A.infamy += 30;
    return { ok: true, intercepted: true };
  }
  const deaths = t.pop * rng(s).range(0.08, 0.18);
  t.pop -= deaths;
  t.gdp *= 0.5;
  t.devast = 100;
  t.infra = Math.max(0, t.infra - 3);
  t.fac = Math.floor(t.fac / 2);
  t.labs = Math.floor(t.labs / 2);
  const g = garrison(s, tid);
  V.army = Math.max(0, V.army - g * 0.65 - V.army * 0.05);
  V.readiness = Math.max(0.2, V.readiness - 0.2);
  V.stability = clamp(V.stability - 12, 0, 100);
  s.world.winter += 1.5;
  s.world.cycle -= 0.01;
  A.infamy += isRetaliation ? 15 : 60;
  A.stability = clamp(A.stability - (A.gov === 'D' || A.gov === 'K' ? 15 : 5), 0, 100);
  worldRemembers(s, by, `Used nuclear weapons on ${TERR[tid].name}`, isRetaliation ? -30 : -90, isRetaliation ? -15 : -45, [victim]);
  markDirty(s);
  news(s, `☢️☢️ NUCLEAR DETONATION over ${TERR[tid].name}! ${A.name} has used a nuclear weapon. ~${fmtDeaths(deaths)} dead.`, { type: 'nuke', nations: [by, victim], terr: tid });
  // Retaliation
  if (!isRetaliation) {
    const responders = [victim, ...defenders(s, victim)].filter((id) => s.nations[id].alive && s.nations[id].nukes >= 1 && hasTech(s, id, 'str2'));
    for (const id of responders) {
      const targetTid = capitalOf(s, by);
      if (!targetTid) break;
      if (id === s.player) {
        s.pending.push({ kind: 'retaliate', enemy: by, day: s.day });
        continue;
      }
      const p = id === victim ? 0.9 : 0.45 * s.nations[id].pers.honor + 0.1;
      if (rng(s).chance(p)) {
        if (!atWar(s, id, by)) {
          const w = warsOf(s, victim).find((x) => enemySide(x, victim).includes(by));
          if (w) joinWar(s, w, id, sideOf(w, victim));
        }
        nukeStrike(s, id, targetTid, true);
      }
    }
  }
  if (V.alive && victim === s.player) s.alerts.push({ day: s.day, text: `We have been struck by a nuclear weapon in ${TERR[tid].name}!`, type: 'bad' });
  return { ok: true, deaths };
}
function fmtDeaths(m) {
  return m >= 1 ? `${m.toFixed(1)} million` : `${Math.round(m * 1000)},000`;
}

export function warLeaderFor(s, war, nid) {
  return sideOf(war, nid) === 'att' ? war.attLead : war.defLead;
}
