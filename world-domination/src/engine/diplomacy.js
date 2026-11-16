// Diplomacy: proposals and how AI judges them, influence & spheres, blocs and coalitions.
import { TERR } from './world.js';
import { DIFFICULTY } from './config.js';
import {
  clamp, rng, opinion, trust, addOpinion, addTrust, remember, hasTreaty, addTreaty, removeTreaty, news, nameOf,
  atWar, proximity, borders, aliveIds, allied, govSimilarity, owned, topOverlord, subjectsOf, enemiesOf, markDirty,
  warsOf, sameBloc, blocsOf, defenders,
} from './state.js';
import { convPower, declareWar, makePuppet, territoryValue, nationValue, joinWar } from './military.js';

export const TREATY_INFO = {
  trade: { name: 'Trade Agreement', icon: '🤝', pc: 10, desc: 'Both economies gain trade income; builds influence.' },
  nap: { name: 'Non-Aggression Pact', icon: '🕊️', pc: 10, desc: 'A promise not to attack each other. Breaking it is a betrayal.' },
  defense: { name: 'Defense Pact', icon: '🛡️', pc: 25, desc: 'Each side must defend the other if attacked.' },
  research: { name: 'Research Pact', icon: '🔬', pc: 15, desc: '+8% research for both sides.' },
};

// ---------- Influence ----------
export function influence(s, owner, target) {
  return s.influence[target]?.[owner] || 0;
}
export function addInfluence(s, owner, target, v) {
  if (owner === target) return;
  const m = (s.influence[target] ||= {});
  m[owner] = clamp((m[owner] || 0) + v, 0, 100);
  // Competing spheres push each other out
  if (v > 0) for (const k of Object.keys(m)) if (k !== owner) m[k] = Math.max(0, m[k] - v * 0.35);
  for (const k of Object.keys(m)) if (m[k] < 0.5) delete m[k];
}
export function topInfluencer(s, target) {
  const m = s.influence[target];
  if (!m) return null;
  let best = null, bv = 0;
  for (const [k, v] of Object.entries(m)) if (v > bv && s.nations[k]?.alive) { bv = v; best = k; }
  return best ? { id: best, value: bv } : null;
}

// ---------- Proposal evaluation ----------
function powerRatio(s, a, b) {
  return (convPower(s, a) + 1) / (convPower(s, b) + 1);
}
function sharedThreat(s, a, b) {
  let best = 0, who = null;
  for (const x of aliveIds(s)) {
    if (x === a || x === b) continue;
    const oa = opinion(s, a, x), ob = opinion(s, b, x);
    if (oa < -25 && ob < -10) {
      const v = Math.min(-oa, -ob) * Math.min(2, (convPower(s, x) + 1) / (convPower(s, b) + 1));
      if (v > best) { best = v; who = x; }
    }
  }
  return { value: Math.min(35, best / 3), who };
}

// How `to` judges a proposal from `from`. Returns { accept, total, parts }
export function evaluate(s, from, to, kind, extra = {}) {
  const T = s.nations[to], F = s.nations[from];
  const p = T.pers;
  const parts = [];
  const add = (label, v) => { if (Math.abs(v) >= 1) parts.push([label, Math.round(v)]); };
  if (atWar(s, from, to) && kind !== 'peace') return { accept: false, total: -999, parts: [['At war', -999]] };
  if (T.overlord && T.overlord !== from && kind !== 'trade') return { accept: false, total: -999, parts: [['Subject of ' + nameOf(s, T.overlord), -999]] };
  const op = opinion(s, to, from);
  add('Opinion of us', op * 0.4);
  add('Trust', (trust(s, to, from) - 50) * 0.35);
  if (F.infamy > 10) add('Fear of our aggression', -F.infamy * 0.3 * proximity(s, to, from));
  const inf = influence(s, from, to);
  if (inf > 0) add('Our influence', inf * 0.25);
  const ratio = powerRatio(s, from, to);

  switch (kind) {
    case 'trade': {
      if (hasTreaty(s, from, to, 'trade')) return { accept: false, total: -999, parts: [['Already have a trade agreement', -999]] };
      add('Economic benefit', 12 + p.economy * 12);
      if (T.leader.traits.includes('Isolationist')) add('Isolationist leader', -18);
      if (s.embargo.some((e) => (e.a === from && e.b === to) || (e.a === to && e.b === from))) add('Embargo', -60);
      break;
    }
    case 'nap': {
      if (hasTreaty(s, from, to, 'nap')) return { accept: false, total: -999, parts: [['Already have a pact', -999]] };
      add('Base', 5);
      if (ratio > 1.3) add('They fear our strength', Math.min(25, Math.log2(ratio) * 8));
      add('Caution', p.caution * 12);
      if (p.aggression > 0.55 && ratio < 0.8) add('Ambitious leader wants a free hand', -20);
      if (borders(s, from, to)) add('Shared border', 5);
      break;
    }
    case 'defense': {
      if (hasTreaty(s, from, to, 'defense')) return { accept: false, total: -999, parts: [['Already allied', -999]] };
      add('Base reluctance', -25);
      const th = sharedThreat(s, from, to);
      if (th.value) add(`Common threat: ${nameOf(s, th.who)}`, th.value);
      add('Our military might', clamp(Math.log2(ratio) * 9, -15, 25));
      const sim = govSimilarity(F.gov, T.gov);
      add(sim > 0 ? 'Similar government' : 'Different ideology', sim * 10 * (0.5 + p.ideology));
      const prox = proximity(s, from, to);
      if (prox < 0.35) add('Far away', -12);
      if (warsOf(s, from).length) add('Would be dragged into our wars', -20 - warsOf(s, from).length * 5);
      if (T.leader.traits.includes('Isolationist')) add('Isolationist leader', -25);
      add('Diplomatic leader', (p.diplomacy - 0.5) * 20);
      if (blocsOf(s, to).some((b) => b.type === 'military')) add('Already in a military bloc', -8);
      break;
    }
    case 'research': {
      if (hasTreaty(s, from, to, 'research')) return { accept: false, total: -999, parts: [['Already have a pact', -999]] };
      add('Scientific exchange', 6 + p.science * 18);
      if (F.techs.length > T.techs.length + 4) add('They would learn from us', 8);
      if (F.techs.length + 4 < T.techs.length) add('We have little to offer', -12);
      break;
    }
    case 'joinBloc': {
      const bloc = s.blocs.find((b) => b.id === extra.bloc);
      if (!bloc) return { accept: false, total: -999, parts: [['No such bloc', -999]] };
      if (bloc.members.includes(to)) return { accept: false, total: -999, parts: [['Already a member', -999]] };
      if (bloc.type === 'military') {
        add('Base reluctance', -28);
        const th = sharedThreat(s, from, to);
        if (th.value) add(`Common threat: ${nameOf(s, th.who)}`, th.value);
        add('Bloc strength', clamp(Math.log2(ratio) * 8 + bloc.members.length, -10, 28));
        if (blocsOf(s, to).some((b) => b.type === 'military')) add('Member of another military bloc', -35);
        if (warsOf(s, from).length) add('Bloc is at war', -18);
      } else {
        add('Market access', 10 + bloc.members.length + p.economy * 10);
        if (blocsOf(s, to).some((b) => b.type === 'economic')) add('Member of another trade bloc', -25);
      }
      if (T.leader.traits.includes('Isolationist')) add('Isolationist leader', -25);
      break;
    }
    case 'protectorate': {
      add('Base: sovereignty is precious', -75);
      add('Our influence', inf * 0.6);
      add('Power disparity', clamp(Math.log2(ratio) * 9, -30, 40));
      if (T.stability < 35) add('Unstable government seeks protection', 12);
      const threats = enemiesOf(s, to);
      if (threats.size) add('Needs protection from its enemies', 15);
      if (T.leader.traits.includes('Honorable') || T.leader.traits.includes('Isolationist')) add('Proud leader', -15);
      if (owned(s, to).length > 3) add('Too large to submit', -20);
      break;
    }
    case 'ultimatum': {
      // extra.terr: territory demanded, or extra.vassal
      const allies = defenders(s, to).filter((x) => x !== from);
      const theirSide = convPower(s, to) + allies.reduce((a, x) => a + convPower(s, x) * 0.5, 0);
      const r2 = (convPower(s, from) + 1) / (theirSide + 1);
      add('Balance of power (incl. allies)', clamp(Math.log2(r2) * 14, -40, 45));
      add('Caution', p.caution * 20);
      add('Pride', -15 - p.aggression * 15 - p.honor * 10);
      if (extra.terr) {
        const share = territoryValue(s, extra.terr) / Math.max(1, nationValue(s, to));
        add('Value of the land', -share * 120 - (s.terr[extra.terr].core === to ? 15 : 0));
      }
      if (extra.vassal) add('Surrender of sovereignty', -55);
      if (s.nations[from].nukes > 3 && !T.nukes) add('Nuclear intimidation', 12);
      break;
    }
    case 'callToArms': {
      add('Base', allied(s, from, to) ? 15 : -30);
      add('Honor', p.honor * 30);
      const en = s.nations[extra.enemy];
      if (en) {
        add('Opinion of the enemy', -opinion(s, to, extra.enemy) * 0.3);
        add('Enemy strength', -clamp(Math.log2((convPower(s, extra.enemy) + 1) / (convPower(s, to) + 1)) * 10, -10, 30));
        if (hasTreaty(s, to, extra.enemy, 'nap')) add('Non-aggression pact with enemy', -30);
      }
      break;
    }
    default:
      break;
  }
  const total = parts.reduce((x, [, v]) => x + v, 0);
  return { accept: total > 0, total: Math.round(total), parts };
}

// ---------- Executing treaties ----------
export function signTreaty(s, type, a, b) {
  addTreaty(s, type, a, b);
  addOpinion(s, a, b, 8); addOpinion(s, b, a, 8);
  addTrust(s, a, b, 3); addTrust(s, b, a, 3);
  const big = Math.max(s.nations[a].stats.gdp || 0, s.nations[b].stats.gdp || 0) > 400 || type === 'defense';
  if (big || a === s.player || b === s.player) news(s, `${TREATY_INFO[type].icon} ${nameOf(s, a)} and ${nameOf(s, b)} sign a ${TREATY_INFO[type].name.toLowerCase()}.`, { nations: [a, b] });
}
export function breakTreaty(s, type, a, b) {
  if (!hasTreaty(s, a, b, type)) return;
  removeTreaty(s, type, a, b);
  const hit = type === 'defense' ? -25 : type === 'nap' ? -15 : -8;
  addOpinion(s, b, a, hit * 1.5);
  addTrust(s, b, a, hit);
  remember(s, b, a, `Cancelled our ${TREATY_INFO[type].name.toLowerCase()}`, hit);
  news(s, `${nameOf(s, a)} cancels its ${TREATY_INFO[type].name.toLowerCase()} with ${nameOf(s, b)}.`, { nations: [a, b] });
}

export function joinBloc(s, blocId, nid) {
  const b = s.blocs.find((x) => x.id === blocId);
  if (!b || b.members.includes(nid)) return;
  b.members.push(nid);
  markDirty(s);
  news(s, `${nameOf(s, nid)} joins ${b.name}.`, { nations: [nid, b.leader] });
}
export function leaveBloc(s, blocId, nid) {
  const b = s.blocs.find((x) => x.id === blocId);
  if (!b) return;
  b.members = b.members.filter((m) => m !== nid);
  for (const m of b.members) { addOpinion(s, m, nid, -12); if (b.type === 'military') addTrust(s, m, nid, -8); }
  news(s, `${nameOf(s, nid)} leaves ${b.name}.`, { nations: [nid] });
  if (b.leader === nid && b.members.length) b.leader = b.members.reduce((x, y) => ((s.nations[x].stats.gdp || 0) > (s.nations[y].stats.gdp || 0) ? x : y));
  if (b.members.length < 2) {
    s.blocs = s.blocs.filter((x) => x !== b);
    news(s, `${b.name} has dissolved.`, { nations: [nid] });
  }
  markDirty(s);
}
export function foundBloc(s, nid, name, type) {
  const id = `B${s.day}${nid}`;
  s.blocs.push({ id, name, type, leader: nid, members: [nid], color: s.nations[nid].color, founded: s.day });
  news(s, `${nameOf(s, nid)} founds the ${name}.`, { nations: [nid], type: 'major' });
  markDirty(s);
  return id;
}

export function protectorate(s, lord, sub) {
  makePuppet(s, sub, lord);
  s.nations[sub].liberty = 10;
  addOpinion(s, sub, lord, 15);
  news(s, `🤝 ${nameOf(s, sub)} accepts the protection of ${nameOf(s, lord)} and enters its sphere.`, { type: 'major', nations: [sub, lord] });
}

// ---------- Monthly diplomacy ----------
export function diplomacyMonth(s) {
  const r = rng(s);
  // Opinion modifiers & trust drift back toward neutral
  for (const k of Object.keys(s.rel)) {
    s.rel[k] *= 0.975;
    if (Math.abs(s.rel[k]) < 0.5) delete s.rel[k];
  }
  for (const k of Object.keys(s.trust)) {
    const [a] = k.split('>');
    const honor = s.nations[a]?.pers.honor ?? 0.5;
    s.trust[k] += (50 - s.trust[k]) * (0.02 - honor * 0.012);
    if (Math.abs(s.trust[k] - 50) < 0.5) delete s.trust[k];
  }
  // Influence: passive gains and decay
  for (const target of Object.keys(s.influence)) {
    const m = s.influence[target];
    for (const k of Object.keys(m)) {
      m[k] *= 0.985;
      if (!s.nations[k]?.alive || m[k] < 0.5) delete m[k];
    }
  }
  for (const t of s.treaties) {
    if (t.type !== 'trade') continue;
    const A = s.nations[t.a], B = s.nations[t.b];
    if ((A.stats.gdp || 0) > (B.stats.gdp || 0) * 3) addInfluence(s, t.a, t.b, 0.6);
    else if ((B.stats.gdp || 0) > (A.stats.gdp || 0) * 3) addInfluence(s, t.b, t.a, 0.6);
  }
  for (const id of aliveIds(s)) {
    const n = s.nations[id];
    if (n.overlord) addInfluence(s, n.overlord, id, 1.5);
  }
  // Ongoing relation improvement missions
  for (const id of aliveIds(s)) {
    const n = s.nations[id];
    if (!n.improving) continue;
    n.improving = n.improving.filter((x) => {
      if (x.until < s.day || !s.nations[x.target]?.alive) return false;
      addOpinion(s, x.target, id, 2.5 + n.pers.diplomacy * 1.5);
      return true;
    });
  }
  coalitionsMonth(s);
}

function coalitionsMonth(s) {
  const r = rng(s);
  const f = DIFFICULTY[s.difficulty].coalition;
  const ids = aliveIds(s);
  for (const x of ids) {
    const X = s.nations[x];
    let c = s.coalitions.find((cc) => cc.target === x);
    if (X.infamy < 20 * f) {
      if (c && X.infamy < 12 * f) {
        s.coalitions = s.coalitions.filter((cc) => cc !== c);
        news(s, `The coalition against ${X.name} disbands as tensions ease.`, { nations: [x] });
      }
      continue;
    }
    const xp = convPower(s, x) + subjectsOf(s, x).reduce((a, y) => a + convPower(s, y), 0);
    for (const m of ids) {
      if (m === x || topOverlord(s, m) === x || s.nations[m].overlord) continue;
      const M = s.nations[m];
      const member = c?.members.includes(m);
      const fear = X.infamy * (0.3 + proximity(s, m, x)) * (xp / (xp + convPower(s, m) + 1)) * (0.7 + M.pers.caution * 0.6);
      const op = opinion(s, m, x);
      if (!member && fear > 22 * f && op < 5 && !allied(s, m, x) && !hasTreaty(s, m, x, 'nap')) {
        if (!c) {
          c = { target: x, members: [], since: s.day };
          s.coalitions.push(c);
        }
        c.members.push(m);
        if (x === s.player || c.members.length === 1 || r.chance(0.2)) news(s, `${M.name} joins the coalition against ${X.name}.`, { type: x === s.player ? 'bad' : 'info', nations: [m, x] });
      } else if (member && (fear < 8 * f || op > 30)) {
        c.members = c.members.filter((y) => y !== m);
      }
    }
    if (c && !c.members.length) s.coalitions = s.coalitions.filter((cc) => cc !== c);
    // Coalition goes to war
    if (c && c.members.length >= 2 && !atWar(s, c.members[0], x) && s.day - (c.lastWar || -999) > 360) {
      const members = c.members.filter((m) => s.nations[m].alive && !atWar(s, m, x));
      const cp = members.reduce((a, m) => a + convPower(s, m), 0);
      const atWarElsewhere = warsOf(s, x).length > 0;
      const trigger = (cp > xp * (atWarElsewhere ? 0.6 : 0.95) && X.infamy > 40 * f) || (X.infamy > 85 && cp > xp * 0.5);
      if (trigger && r.chance(0.25 * (x === s.player ? 1 : 0.6))) {
        const leader = members.reduce((a, b) => (convPower(s, a) > convPower(s, b) ? a : b));
        c.lastWar = s.day;
        const war = declareWar(s, leader, x, { cb: 'Coalition mandate' });
        war.name = `War of the Coalition against ${X.name}`;
        for (const m of members) if (m !== leader && s.nations[m].alive) joinWar(s, war, m, 'att');
        news(s, `🛡️ The coalition strikes! ${members.length} nations go to war to stop ${X.name}.`, { type: 'major', nations: [x, ...members] });
      }
    }
  }
}

// Fear and coalition readout used by the UI
export function threatReport(s, nid) {
  const c = s.coalitions.find((cc) => cc.target === nid);
  return { coalition: c ? c.members : [], infamy: s.nations[nid].infamy };
}
