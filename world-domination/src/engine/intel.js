// Espionage: spy networks and covert operations.
import { TERR } from './world.js';
import { GOVS } from '../data/people.js';
import { TECH_BY_ID } from '../data/techs.js';
import { clamp, rng, techMod, hasTech, addOpinion, addTrust, remember, news, nameOf, owned, aliveIds, markDirty, borders } from './state.js';
import { addInfluence } from './diplomacy.js';
import { effectiveTechCost, completeTech, addMod } from './economy.js';
import { makePuppet } from './military.js';
import { makeLeader } from './setup.js';
import { personalityOf } from '../data/people.js';

export const network = (s, a, b) => s.spy[`${a}>${b}`] || 0;
export function addNetwork(s, a, b, v) {
  const k = `${a}>${b}`;
  s.spy[k] = clamp((s.spy[k] || 0) + v, 0, 100);
  if (s.spy[k] < 0.5) delete s.spy[k];
}

export const OPS = {
  network: { name: 'Expand Spy Network', icon: '🕵️', net: 0, pc: 0, base: 0.85, risk: 0.04, desc: '+15 network strength. Costs money.' },
  propaganda: { name: 'Propaganda Campaign', icon: '📢', net: 10, pc: 10, base: 0.7, risk: 0.15, desc: '+10 influence and better opinion of us.' },
  steal: { name: 'Steal Technology', icon: '💾', net: 30, pc: 15, base: 0.55, risk: 0.25, desc: 'Steal research from a technology they have and we lack.' },
  sabotage: { name: 'Industrial Sabotage', icon: '💣', net: 30, pc: 15, base: 0.55, risk: 0.3, desc: 'Damage factories, output and military readiness.' },
  destabilize: { name: 'Fund the Opposition', icon: '✊', net: 25, pc: 20, base: 0.6, risk: 0.25, desc: '-12 stability, -10 approval.' },
  claim: { name: 'Fabricate Claim', icon: '📜', net: 20, pc: 20, base: 0.65, risk: 0.2, desc: 'Forge a legal claim on their land — a justification for war.' },
  cyber: { name: 'Cyber Attack', icon: '🖥️', net: 20, pc: 15, base: 0.6, risk: 0.2, tech: 'int2', desc: 'Wipe research progress, cut readiness and output.' },
  election: { name: 'Election Interference', icon: '🗳️', net: 40, pc: 30, base: 0.45, risk: 0.35, demo: true, desc: 'Force an early election won by a candidate friendly to us.' },
  rebellion: { name: 'Incite Revolution', icon: '🔥', net: 50, pc: 40, base: 0.4, risk: 0.35, maxStab: 45, desc: 'Topple the regime: new government, shattered army.' },
  coup: { name: 'Stage a Coup', icon: '🎖️', net: 60, pc: 60, base: 0.35, risk: 0.4, maxStab: 35, desc: 'Install a puppet regime loyal to us.' },
};

export function networkCost(s, target) {
  return +(1 + Math.sqrt(s.nations[target].stats.gdp || 1) * 0.25).toFixed(1);
}

export function opChance(s, a, b, op) {
  const o = OPS[op];
  const B = s.nations[b];
  let p = o.base + network(s, a, b) * 0.003 + techMod(s, a, 'spy') - techMod(s, b, 'counter') * 0.8 - (B.stability - 50) * 0.002;
  if (op === 'network') p = o.base - techMod(s, b, 'counter') * 0.3;
  return clamp(p, 0.05, 0.95);
}

export function canRunOp(s, a, b, op) {
  const o = OPS[op], A = s.nations[a], B = s.nations[b];
  if (!o) return { ok: false, why: 'Unknown operation' };
  if (a === b) return { ok: false, why: 'Cannot target yourself' };
  if (network(s, a, b) < o.net) return { ok: false, why: `Needs spy network ${o.net}` };
  if (A.pc < o.pc) return { ok: false, why: `Needs ${o.pc} political capital` };
  if (o.tech && !hasTech(s, a, o.tech)) return { ok: false, why: `Requires ${TECH_BY_ID[o.tech].name}` };
  if (o.demo && !GOVS[B.gov].democratic) return { ok: false, why: 'Only works on democracies' };
  if (o.maxStab && B.stability > o.maxStab) return { ok: false, why: `Their stability must be below ${o.maxStab}` };
  if (op === 'network' && A.treasury < networkCost(s, b)) return { ok: false, why: 'Not enough money' };
  if (op === 'steal' && !B.techs.some((t) => !A.techs.includes(t))) return { ok: false, why: 'They have nothing we lack' };
  if (op === 'coup' && B.overlord) return { ok: false, why: 'Already someone’s subject' };
  return { ok: true };
}

export function runOp(s, a, b, op, opts = {}) {
  const chk = canRunOp(s, a, b, op);
  if (!chk.ok) return chk;
  const r = rng(s);
  const o = OPS[op], A = s.nations[a], B = s.nations[b];
  A.pc -= o.pc;
  if (op === 'network') A.treasury -= networkCost(s, b);
  const success = r.chance(opChance(s, a, b, op));
  const discovered = r.chance(success ? o.risk * (1 - techMod(s, a, 'spy')) : 0.55 + o.risk * 0.5);
  let result = '';
  if (success) {
    switch (op) {
      case 'network': addNetwork(s, a, b, 15); result = 'Our network has grown.'; break;
      case 'propaganda': addInfluence(s, a, b, 10 * (1 + techMod(s, a, 'influence'))); addOpinion(s, b, a, 6); result = 'Our message is spreading.'; break;
      case 'steal': {
        const candidates = B.techs.filter((t) => !A.techs.includes(t));
        const tech = r.pick(candidates);
        const prereqOk = TECH_BY_ID[tech].tier === 1 || A.techs.some((t) => TECH_BY_ID[t].branch === TECH_BY_ID[tech].branch && TECH_BY_ID[t].tier === TECH_BY_ID[tech].tier - 1);
        if (prereqOk && (!A.research || A.research.id !== tech)) { completeTech(s, a, tech); result = `We stole ${TECH_BY_ID[tech].name}!`; }
        else { A.rpBank = (A.rpBank || 0) + effectiveTechCost(s, a, tech) * 0.5; result = `Stolen research on ${TECH_BY_ID[tech].name} boosts our labs.`; }
        break;
      }
      case 'sabotage': {
        const list = owned(s, b);
        const t = s.terr[r.pick(list)];
        t.gdp *= 0.97; t.fac = Math.max(0, t.fac - 1);
        B.readiness = Math.max(0.2, B.readiness - 0.06);
        result = `Explosions rock industrial sites in ${TERR[t.id].name}.`;
        break;
      }
      case 'destabilize': B.stability = clamp(B.stability - 12, 0, 100); B.approval = clamp(B.approval - 10, 0, 100); result = 'Protests erupt across the country.'; break;
      case 'claim': {
        const list = owned(s, b).filter((t) => !A.claims.includes(t));
        const borderT = list.filter((t) => TERR[t].nb.some((x) => s.terr[x].owner === a));
        const tid = opts.terr && list.includes(opts.terr) ? opts.terr : r.pick(borderT.length ? borderT : list);
        if (tid) { A.claims.push(tid); result = `We now hold a claim on ${TERR[tid].name}.`; }
        break;
      }
      case 'cyber':
        if (B.research) B.research.prog *= 0.4;
        B.readiness = Math.max(0.2, B.readiness - 0.1);
        for (const t of owned(s, b)) s.terr[t].gdp *= 0.99;
        result = 'Their networks go dark.';
        break;
      case 'election': {
        B.leader = makeLeader(s, b, B.gov, ['Diplomat', 'Pragmatist']);
        B.pers = personalityOf(B.leader.traits);
        addOpinion(s, b, a, 35);
        addInfluence(s, a, b, 15);
        news(s, `🗳️ Snap election in ${B.name}: ${B.leader.name} wins in a surprise landslide.`, { nations: [b] });
        result = 'Our candidate has won.';
        break;
      }
      case 'rebellion':
        revolution(s, b, 'Foreign-backed revolutionaries');
        result = 'The regime has fallen.';
        break;
      case 'coup': {
        B.leader = makeLeader(s, b, 'J', ['Pragmatist', 'Cautious']);
        B.gov = 'J'; B.title = null;
        B.pers = personalityOf(B.leader.traits);
        makePuppet(s, b, a);
        B.liberty = 35;
        B.stability = 35;
        news(s, `🎖️ Military coup in ${B.name}! General ${B.leader.name} seizes power.`, { type: 'major', nations: [b] });
        result = `${B.name} is now our puppet.`;
        break;
      }
    }
  }
  if (discovered) {
    const hit = op === 'coup' || op === 'rebellion' ? -60 : op === 'election' ? -45 : -25;
    addOpinion(s, b, a, hit);
    addTrust(s, b, a, hit / 2);
    remember(s, b, a, 'Caught running covert operations against us', hit);
    A.infamy += op === 'coup' || op === 'rebellion' ? 8 : 2;
    addNetwork(s, a, b, -30);
    for (const id of aliveIds(s)) if (id !== b && id !== a && borders(s, id, b)) addOpinion(s, id, a, hit * 0.2);
    news(s, `🕵️ ${B.name} exposes a ${A.name} intelligence operation (${o.name})!`, { type: 'bad', nations: [a, b] });
  }
  markDirty(s);
  return { ok: true, success, discovered, result };
}

// Shared by intel and events
export function revolution(s, nid, cause = 'Revolutionaries') {
  const n = s.nations[nid];
  const r = rng(s);
  const was = n.gov;
  const next = GOVS[was].democratic ? r.pick(['J', 'A', 'A', 'C', 'T']) : r.pick(['D', 'D', 'K', 'A', 'J']);
  n.gov = next;
  n.title = null;
  n.leader = makeLeader(s, nid, next);
  n.pers = personalityOf(n.leader.traits);
  n.army *= 0.7; n.air *= 0.85;
  n.stability = 35; n.approval = 50; n.lowStab = 0;
  n.nextElection = GOVS[next].democratic ? s.day + 360 * 2 : null;
  addMod(s, nid, 'growth', -0.02, 12, 'Revolutionary chaos');
  // New regimes rethink their alliances
  if (GOVS[next].democratic !== GOVS[was].democratic) {
    for (const b of s.blocs) if (b.members.includes(nid) && b.leader !== nid && r.chance(0.5)) b.members = b.members.filter((m) => m !== nid);
    s.treaties = s.treaties.filter((t) => !((t.a === nid || t.b === nid) && t.type === 'defense' && r.chance(0.5)));
  }
  if (n.overlord && r.chance(0.6)) {
    news(s, `${n.name}'s new regime repudiates its overlord ${nameOf(s, n.overlord)}.`, { nations: [nid, n.overlord] });
    n.overlord = null;
  }
  markDirty(s);
  news(s, `🔥 REVOLUTION in ${n.name}! ${cause} overthrow the ${GOVS[was].name.toLowerCase()}. ${n.leader.name} proclaims a ${GOVS[next].name.toLowerCase()}.`, { type: 'major', nations: [nid] });
}

export function intelMonth(s) {
  for (const k of Object.keys(s.spy)) {
    s.spy[k] -= 0.6;
    if (s.spy[k] <= 0.5) delete s.spy[k];
  }
}
