// Random national and world events. Events aimed at the player pause the game
// and offer choices; AI nations resolve them automatically.
import { TERR, continentOf } from './world.js';
import { GOVS, personalityOf } from '../data/people.js';
import { TECH_BY_ID } from '../data/techs.js';
import {
  clamp, rng, owned, news, nameOf, aliveIds, warsOf, neighborsOf, addOpinion, addTrust, remember, worldRemembers,
  opinion, enemiesOf, markDirty, touch, capitalOf, nationGdp, subjectsOf, atWar, fmtDate,
} from './state.js';
import { addMod, RES_KEYS, RESOURCES, effectiveTechCost } from './economy.js';
import { revolution } from './intel.js';
import { makeLeader, pickAmbition } from './setup.js';
import { declareWar, militia } from './military.js';
import { addInfluence } from './diplomacy.js';

const DISASTERS = {
  'South-Eastern Asia': ['typhoon', 'earthquake', 'tsunami'], 'Eastern Asia': ['earthquake', 'typhoon', 'flood'],
  'Southern Asia': ['flood', 'cyclone', 'heatwave'], 'Caribbean': ['hurricane'], 'Central America': ['hurricane', 'earthquake'],
  'Northern America': ['hurricane', 'wildfire', 'earthquake'], 'South America': ['earthquake', 'flood', 'drought'],
  'Northern Africa': ['drought', 'earthquake'], 'Western Africa': ['drought', 'flood'], 'Eastern Africa': ['drought', 'locust swarm'],
  'Middle Africa': ['flood', 'epidemic'], 'Southern Africa': ['drought', 'cyclone'], 'Western Asia': ['earthquake', 'drought'],
  'Central Asia': ['earthquake', 'drought'], 'Australia and New Zealand': ['wildfire', 'cyclone', 'earthquake'],
};
const disasterFor = (s, tid) => rng(s).pick(DISASTERS[TERR[tid].subregion] || ['flood', 'storm', 'wildfire', 'heatwave']);

// ---------- Player decision events ----------
// Each: title, text(s, data) and choices [{ label, desc, apply(s, data) }]
export const DECISIONS = {
  protests: {
    title: 'Mass Protests',
    text: (s) => `Hundreds of thousands march in the streets of ${s.nations[s.player].capital ? TERR[capitalOf(s, s.player)].capital || 'the capital' : 'the capital'}, demanding change. Stability is crumbling.`,
    choices: [
      { label: 'Crack down', desc: '+10 stability now, -12 approval, democracies disapprove', apply: (s) => { const P = s.nations[s.player]; P.stability += 10; P.approval -= 12; for (const id of aliveIds(s)) if (GOVS[s.nations[id].gov].democratic) addOpinion(s, id, s.player, -6); } },
      { label: 'Make concessions', desc: 'Costs 3% of GDP, +8 stability, +10 approval, -1% tax', apply: (s) => { const P = s.nations[s.player]; P.treasury -= P.stats.gdp * 0.03; P.stability += 8; P.approval += 10; P.tax = Math.max(5, P.tax - 1); } },
      { label: 'Ignore them', desc: '-6 stability', apply: (s) => { s.nations[s.player].stability -= 6; } },
    ],
  },
  revolution: {
    title: 'Revolution!',
    text: () => 'Revolutionaries have seized government buildings and parts of the army have defected. The regime is in mortal danger.',
    choices: [
      { label: 'Crush the uprising', desc: 'Lose 20% of the army, stability set to 35, -20 approval, +6 infamy', apply: (s) => { const P = s.nations[s.player]; P.army *= 0.8; P.stability = 35; P.approval -= 20; P.infamy += 6; P.lowStab = 0; } },
      { label: 'Accept a new constitution', desc: 'Change of government type, lose half your political capital, stability set to 45', apply: (s) => {
        const P = s.nations[s.player]; P.gov = GOVS[P.gov].democratic ? 'A' : 'D'; P.title = null; P.pc *= 0.5; P.stability = 45; P.lowStab = 0;
        P.nextElection = GOVS[P.gov].democratic ? s.day + 360 * 4 : null; news(s, `${P.name} adopts a new constitution and becomes a ${GOVS[P.gov].name.toLowerCase()}.`, { type: 'major', nations: [s.player] });
      } },
    ],
  },
  electionLost: {
    title: 'Election Defeat',
    text: (s, d) => `The opposition has won the general election with ${d.share}% of the vote. ${d.winner} is ready to take office.`,
    choices: [
      { label: 'Concede gracefully', desc: 'New leader with new traits, lose 40% political capital, approval resets to 55', apply: (s, d) => { const P = s.nations[s.player]; P.leader = makeLeader(s, s.player, P.gov); P.leader.name = d.winner; P.pers = personalityOf(P.leader.traits); P.pc *= 0.6; P.approval = 55; } },
      { label: 'Annul the election', desc: 'Become an authoritarian regime: -25 stability, +10 infamy, democracies furious', apply: (s) => { const P = s.nations[s.player]; P.gov = 'A'; P.title = null; P.nextElection = null; P.stability -= 25; P.infamy += 10; for (const id of aliveIds(s)) if (GOVS[s.nations[id].gov].democratic) { addOpinion(s, id, s.player, -25); remember(s, id, s.player, 'Overthrew its own democracy', -25); } news(s, `${P.name}'s leadership annuls the election results and rules by decree.`, { type: 'major', nations: [s.player] }); } },
    ],
  },
  disaster: {
    title: 'Natural Disaster',
    text: (s, d) => `A devastating ${d.kind} has struck ${TERR[d.terr].name}. Thousands are homeless and infrastructure is in ruins.`,
    choices: [
      { label: 'Massive relief effort', desc: 'Costs 1.5% of GDP, +6 approval, faster recovery', apply: (s, d) => { const P = s.nations[s.player]; P.treasury -= P.stats.gdp * 0.015; P.approval += 6; s.terr[d.terr].devast = Math.max(0, s.terr[d.terr].devast - 15); } },
      { label: 'Minimal response', desc: '-8 approval, -4 stability', apply: (s) => { const P = s.nations[s.player]; P.approval -= 8; P.stability -= 4; } },
      { label: 'Accept foreign aid', desc: 'Free, but the largest donor gains influence over us', apply: (s) => { const donor = richestOther(s); if (donor) { addInfluence(s, donor, s.player, 10); addOpinion(s, s.player, donor, 10); } } },
    ],
  },
  scandal: {
    title: 'Government Scandal',
    text: (s) => `Leaked documents implicate senior ministers in ${rng(s).pick(['a bribery scheme', 'an embezzlement ring', 'illegal surveillance of journalists', 'a defense procurement fraud'])}.`,
    choices: [
      { label: 'Sack the ministers', desc: '-15 political capital, -3 approval', apply: (s) => { const P = s.nations[s.player]; P.pc = Math.max(0, P.pc - 15); P.approval -= 3; } },
      { label: 'Deny everything', desc: '-12 approval, -4 stability', apply: (s) => { const P = s.nations[s.player]; P.approval -= 12; P.stability -= 4; } },
    ],
  },
  refugees: {
    title: 'Refugee Crisis',
    text: (s, d) => `War in ${nameOf(s, d.from)} has sent a wave of refugees to our borders.`,
    choices: [
      { label: 'Open the borders', desc: '+0.5% population, -4 stability, the world approves', apply: (s, d) => { const cap = capitalOf(s, s.player); s.terr[cap].pop *= 1.005; s.nations[s.player].stability -= 4; addOpinion(s, d.from, s.player, 15); for (const id of aliveIds(s)) addOpinion(s, id, s.player, 2); } },
      { label: 'Close the borders', desc: '+2 approval, opinion of us drops', apply: (s, d) => { s.nations[s.player].approval += 2; addOpinion(s, d.from, s.player, -12); } },
    ],
  },
  debtCrisis: {
    title: 'Debt Crisis',
    text: (s) => `Bond markets panic: our debt has reached ${Math.round((s.nations[s.player].debt / s.nations[s.player].stats.gdp) * 100)}% of GDP and nobody wants to lend to us.`,
    choices: [
      { label: 'Austerity', desc: '-3% welfare, +3% tax, -15 approval', apply: (s) => { const P = s.nations[s.player]; P.budget.welfare = Math.max(0, P.budget.welfare - 3); P.tax += 3; P.approval -= 15; } },
      { label: 'Foreign bailout', desc: 'Debt cut by 25%, the lender gains 25 influence over us', apply: (s) => { const P = s.nations[s.player]; P.debt *= 0.75; const donor = richestOther(s); if (donor) addInfluence(s, donor, s.player, 25); } },
      { label: 'Default', desc: 'Debt halved, -2% growth for two years, everyone trusts us less', apply: (s) => { const P = s.nations[s.player]; P.debt *= 0.5; addMod(s, s.player, 'growth', -0.02, 24, 'Sovereign default'); for (const id of aliveIds(s)) addTrust(s, id, s.player, -10); news(s, `${P.name} defaults on its sovereign debt!`, { type: 'major', nations: [s.player] }); } },
    ],
  },
  defector: {
    title: 'Defecting Scientist',
    text: (s, d) => `A leading weapons scientist from ${nameOf(s, d.from)} has asked for asylum at our embassy.`,
    choices: [
      { label: 'Grant asylum', desc: 'Big research boost, they will be furious', apply: (s, d) => { const P = s.nations[s.player]; P.rpBank = (P.rpBank || 0) + (P.rp || 5) * 6; addOpinion(s, d.from, s.player, -25); remember(s, d.from, s.player, 'Harboured our defector', -20); } },
      { label: 'Send them back', desc: '+15 opinion with their government', apply: (s, d) => { addOpinion(s, d.from, s.player, 15); } },
    ],
  },
  generals: {
    title: 'The Generals Grow Restless',
    text: () => 'Our high command argues the army has grown soft in peacetime and demands a larger budget and live-fire exercises.',
    choices: [
      { label: 'Fund the exercises', desc: 'Costs 0.5% of GDP, readiness +15%', apply: (s) => { const P = s.nations[s.player]; P.treasury -= P.stats.gdp * 0.005; P.readiness = Math.min(1.05, P.readiness + 0.15); } },
      { label: 'Refuse', desc: '-4 stability', apply: (s) => { s.nations[s.player].stability -= 4; } },
    ],
  },
  armsDeal: {
    title: 'Arms Dealer’s Offer',
    text: (s, d) => `A shadowy broker offers ${d.amount} surplus air wings for $${d.cost}B, no questions asked.`,
    choices: [
      { label: 'Buy', desc: 'Instant air power', apply: (s, d) => { const P = s.nations[s.player]; if (P.treasury >= d.cost) { P.treasury -= d.cost; P.air += d.amount; } } },
      { label: 'Decline', desc: 'Nothing happens', apply: () => {} },
    ],
  },
  discovery: {
    title: 'Resource Discovery',
    text: (s, d) => `Geologists have found major ${RESOURCES[d.res].name.toLowerCase()} deposits in ${TERR[d.terr].name}!`,
    choices: [
      { label: 'Nationalize it', desc: 'Full deposit, +5 approval', apply: (s, d) => { s.terr[d.terr].res[d.res] = (s.terr[d.terr].res[d.res] || 0) + d.amount; s.nations[s.player].approval += 5; } },
      { label: 'Sell rights to foreign firms', desc: 'Half the deposit plus an immediate cash payment', apply: (s, d) => { s.terr[d.terr].res[d.res] = (s.terr[d.terr].res[d.res] || 0) + d.amount * 0.5; s.nations[s.player].treasury += d.amount * RESOURCES[d.res].value * 4; } },
    ],
  },
  separatists: {
    title: 'Separatist Uprising',
    text: (s, d) => `Separatists in ${TERR[d.terr].name} demand independence. Unrest there has reached ${Math.round(s.terr[d.terr].unrest)}%.`,
    choices: [
      { label: 'Send in the troops', desc: 'Unrest -30, -5% army, +3 infamy', apply: (s, d) => { s.terr[d.terr].unrest -= 30; s.nations[s.player].army *= 0.95; s.nations[s.player].infamy += 3; } },
      { label: 'Grant autonomy', desc: 'Unrest -40, -25% output there for two years', apply: (s, d) => { const t = s.terr[d.terr]; t.unrest -= 40; t.gdp *= 0.85; t.integ = Math.min(100, t.integ + 10); } },
      { label: 'Let them go', desc: 'They become an independent nation', apply: (s, d) => { rebelIndependence(s, d.terr, true); } },
    ],
  },
};

function richestOther(s) {
  let best = null, bv = 0;
  for (const id of aliveIds(s)) if (id !== s.player && (s.nations[id].stats.gdp || 0) > bv) { bv = s.nations[id].stats.gdp; best = id; }
  return best;
}

export function queueDecision(s, id, data = {}) {
  if (s.pending.some((p) => p.kind === 'event' && p.id === id)) return;
  s.pending.push({ kind: 'event', id, data, day: s.day });
}
export function resolveDecision(s, pending, choiceIdx) {
  const def = DECISIONS[pending.id];
  def.choices[choiceIdx]?.apply(s, pending.data);
  const P = s.nations[s.player];
  P.stability = clamp(P.stability, 0, 100);
  P.approval = clamp(P.approval, 0, 100);
  P.treasury = Math.max(P.treasury, -P.stats.gdp);
  if (P.treasury < 0) { P.debt -= P.treasury; P.treasury = 0; }
  markDirty(s);
}

// ---------- Rebellion of conquered lands ----------
export function rebelIndependence(s, tid, peaceful = false) {
  const t = s.terr[tid];
  const owner = t.owner;
  const coreId = s.nations[t.core] ? t.core : s.nations[tid] ? tid : null;
  if (!coreId || coreId === owner) return;
  const R = s.nations[coreId];
  const wasAlive = R.alive;
  R.alive = true;
  R.overlord = null;
  R.capital = tid;
  R.stability = 45; R.warEx = 0; R.infamy = 0;
  R.leader = makeLeader(s, coreId, R.gov);
  R.pers = personalityOf(R.leader.traits);
  R.treasury = Math.max(R.treasury, t.gdp * 0.03);
  if (!wasAlive) { R.debt = 0; R.navy = 0; R.air = 0; R.missiles = 0; R.nukes = 0; }
  R.army = Math.max(R.army, militia(s, tid) * 3 + Math.sqrt(t.pop) * 0.6);
  if (peaceful) {
    t.owner = coreId; t.ctrl = coreId; t.core = coreId; t.integ = 100; t.unrest = 5;
    touch(s); markDirty(s);
    news(s, `🎉 ${R.name} regains its independence from ${nameOf(s, owner)} peacefully.`, { type: 'major', nations: [coreId, owner] });
    addOpinion(s, coreId, owner, 30);
    return;
  }
  t.ctrl = coreId;
  t.unrest = 30;
  touch(s); markDirty(s);
  const war = declareWar(s, coreId, owner, { independence: true, cb: 'War of Independence' });
  war.name = `${R.name} War of Independence`;
  war.goal = tid;
  news(s, `🔥 Rebellion! ${TERR[tid].name} rises against ${nameOf(s, owner)} — ${R.name} ${wasAlive ? 'fights for its freedom' : 'is reborn'}.`, { type: 'major', nations: [coreId, owner] });
}

// ---------- Monthly roll ----------
export function eventsMonth(s) {
  const r = rng(s);
  const P = s.player;
  for (const nid of aliveIds(s)) {
    const n = s.nations[nid];
    const isP = nid === P;
    // Elections
    if (GOVS[n.gov].democratic && n.nextElection != null && s.day >= n.nextElection) {
      n.nextElection = s.day + 360 * GOVS[n.gov].electionYears;
      const winChance = clamp(0.15 + n.approval / 100 + (n.leader.traits.includes('Populist') ? 0.1 : 0) - (s.day - n.leader.since > 360 * 8 ? 0.25 : 0), 0.05, 0.92);
      if (r.chance(winChance)) {
        if (isP) news(s, `🗳️ ${n.leader.name} wins re-election with ${Math.round(48 + n.approval / 5)}% of the vote.`, { type: 'good', player: true });
        else if ((n.stats.gdp || 0) > 300) news(s, `🗳️ ${n.leader.name} is re-elected in ${n.name}.`, { nations: [nid] });
      } else if (isP) {
        const winner = makeLeader(s, nid, n.gov).name;
        queueDecision(s, 'electionLost', { winner, share: Math.round(51 + r.range(0, 9)) });
      } else {
        const old = n.leader.name;
        n.leader = makeLeader(s, nid, n.gov);
        n.pers = personalityOf(n.leader.traits);
        pickAmbition(s, nid);
        if ((n.stats.gdp || 0) > 150 || s.nations[P] && opinion(s, nid, P) < -30) news(s, `🗳️ ${n.leader.name} defeats ${old} in ${n.name}'s election. New leader: ${n.leader.traits.join(', ')}.`, { nations: [nid] });
      }
    }
    // Leaders age out of office in non-democracies
    if (!GOVS[n.gov].democratic && s.day % 360 === 0) {
      n.leader.age += 1;
      if (n.leader.age > 70 && r.chance((n.leader.age - 70) * 0.03)) {
        const old = n.leader.name;
        n.leader = makeLeader(s, nid, n.gov);
        n.pers = isP ? n.pers : personalityOf(n.leader.traits);
        if (!isP) pickAmbition(s, nid);
        news(s, `${old}, leader of ${n.name}, has died. ${n.leader.name} succeeds.`, { nations: [nid], player: isP });
      }
    }
    // Revolution
    if (n.lowStab >= 3 && r.chance(0.12 + n.lowStab * 0.02)) {
      if (isP) {
        if (n.lowStab >= 14) { s.outcome = { type: 'defeat', reason: 'Your government was overthrown after years of chaos.', day: s.day }; return; }
        queueDecision(s, 'revolution');
      } else revolution(s, nid);
      continue;
    }
    if (isP && n.stability < 35 && r.chance(0.06)) queueDecision(s, 'protests');
    // Debt crisis
    const gdp = n.stats.gdp || 1;
    if (!n.reserve && n.debt > gdp * 1.5 && r.chance(0.03)) {
      if (isP) queueDecision(s, 'debtCrisis');
      else {
        n.stability -= 12; n.debt *= 0.7; n.tax = Math.min(55, n.tax + 3);
        addMod(s, nid, 'growth', -0.025, 18, 'Debt crisis');
        if (gdp > 100) news(s, `💸 Debt crisis in ${n.name}: markets crash, the government imposes austerity.`, { type: 'bad', nations: [nid] });
      }
    }
    // Small random national events
    if (r.chance(isP ? 0.07 : 0.02)) nationalEvent(s, nid);
  }
  // Rebellions in restless territories
  for (const t of Object.values(s.terr)) {
    if (t.unrest < 70 || t.ctrl !== t.owner) continue;
    if (!r.chance((t.unrest - 65) * 0.004)) continue;
    if (t.core === t.owner) {
      s.nations[t.owner].stability -= 5;
      continue;
    }
    if (t.owner === P && r.chance(0.6)) queueDecision(s, 'separatists', { terr: t.id });
    else rebelIndependence(s, t.id);
  }
  if (r.chance(0.08)) worldEvent(s);
  // Recurring flavour for the player
  const PN = s.nations[P];
  if (PN?.alive) {
    if (!warsOf(s, P).length && s.day - PN.ai.lastWar > 720 && r.chance(0.015)) queueDecision(s, 'generals');
    if (r.chance(0.008)) queueDecision(s, 'armsDeal', { amount: Math.max(2, Math.round((PN.air || 5) * 0.1)), cost: Math.round(Math.max(2, (PN.air || 5) * 0.1) * 5) });
    for (const nb of neighborsOf(s, P)) {
      if (warsOf(s, nb).length && !atWar(s, nb, P) && r.chance(0.01)) { queueDecision(s, 'refugees', { from: nb }); break; }
    }
  }
}

function nationalEvent(s, nid) {
  const r = rng(s);
  const n = s.nations[nid];
  const isP = nid === s.player;
  const list = owned(s, nid);
  const tid = r.pick(list);
  const big = (n.stats.gdp || 0) > 200;
  const roll = r.next();
  if (roll < 0.22) {
    const kind = disasterFor(s, tid);
    const t = s.terr[tid];
    t.devast = clamp(t.devast + r.range(15, 40), 0, 100);
    t.gdp *= r.range(0.96, 0.99);
    if (isP) queueDecision(s, 'disaster', { terr: tid, kind });
    else if (big) news(s, `🌪️ A ${kind} devastates ${TERR[tid].name}.`, { nations: [nid], terr: tid });
  } else if (roll < 0.34) {
    addMod(s, nid, 'growth', 0.012, 12, 'Economic boom');
    if (isP || big) news(s, `📈 ${n.name} enjoys an economic boom.`, { type: 'good', nations: [nid] });
  } else if (roll < 0.44) {
    addMod(s, nid, 'growth', -0.015, 12, 'Recession');
    if (isP || big) news(s, `📉 ${n.name} slides into recession.`, { type: 'bad', nations: [nid] });
  } else if (roll < 0.54) {
    const res = r.pick(['oil', 'gas', 'gold', 'rare', 'uranium', 'iron']);
    const amount = +(r.range(0.4, 1.4)).toFixed(2);
    if (isP) queueDecision(s, 'discovery', { terr: tid, res, amount });
    else {
      s.terr[tid].res[res] = (s.terr[tid].res[res] || 0) + amount;
      news(s, `⛏️ Major ${RESOURCES[res].name.toLowerCase()} discovery in ${TERR[tid].name}.`, { nations: [nid], terr: tid });
    }
  } else if (roll < 0.64) {
    if (isP) queueDecision(s, 'scandal');
    else { n.approval -= 10; if (big) news(s, `📰 Scandal rocks the government of ${n.name}.`, { nations: [nid] }); }
  } else if (roll < 0.72) {
    if (n.research) {
      n.research.prog += effectiveTechCost(s, nid, n.research.id) * 0.4;
      if (isP) news(s, `💡 Breakthrough! Our ${TECH_BY_ID[n.research.id].name} programme leaps ahead.`, { type: 'good', player: true });
    }
  } else if (roll < 0.8) {
    // Border incident between rivals
    const nb = neighborsOf(s, nid).find((x) => opinion(s, nid, x) < -20 && !atWar(s, nid, x));
    if (nb) {
      addOpinion(s, nid, nb, -15); addOpinion(s, nb, nid, -15);
      const claimT = owned(s, nb).find((x) => TERR[x].nb.some((y) => s.terr[y].owner === nid));
      if (claimT && !n.claims.includes(claimT) && r.chance(0.5)) n.claims.push(claimT);
      news(s, `💥 Border clash between ${n.name} and ${nameOf(s, nb)}. Tensions soar.`, { type: 'war', nations: [nid, nb] });
    }
  } else if (roll < 0.86) {
    if (isP) {
      const enemies = [...enemiesOf(s, nid)];
      const from = r.pick(enemies.length ? enemies : aliveIds(s).filter((x) => x !== nid && opinion(s, x, nid) < 0));
      if (from) queueDecision(s, 'defector', { from });
    } else n.readiness = Math.min(1.05, n.readiness + 0.05);
  } else if (roll < 0.93) {
    // Peace summit
    const rival = n.ai.rival;
    if (rival && s.nations[rival]?.alive && !atWar(s, nid, rival) && n.pers.diplomacy > 0.5) {
      addOpinion(s, nid, rival, 25); addOpinion(s, rival, nid, 25);
      news(s, `🤝 Historic summit: ${n.name} and ${nameOf(s, rival)} pledge a new era of cooperation.`, { type: 'peace', nations: [nid, rival] });
    }
  } else {
    if (!isP && !GOVS[n.gov].democratic && n.stability < 40 && r.chance(0.5)) {
      const old = n.leader.name;
      n.gov = 'J'; n.title = null;
      n.leader = makeLeader(s, nid, 'J');
      n.pers = personalityOf(n.leader.traits);
      pickAmbition(s, nid);
      n.stability = 40;
      news(s, `🎖️ Coup in ${n.name}! The military ousts ${old}; General ${n.leader.name} takes over.`, { type: 'major', nations: [nid] });
    }
  }
}

function worldEvent(s) {
  const r = rng(s);
  const roll = r.next();
  if (roll < 0.16) {
    s.world.shocks ||= {};
    s.world.shocks.oil = (s.world.shocks.oil || 0) + r.range(0.6, 1.4);
    news(s, `🛢️ OIL SHOCK: crude prices soar as ${r.pick(['OPEC slashes output', 'tankers are attacked in the Strait of Hormuz', 'a pipeline network is sabotaged', 'refineries shut down'])}.`, { type: 'major' });
  } else if (roll < 0.28) {
    s.world.cycle = -r.range(0.02, 0.04);
    s.world.cycleTimer = r.int(12, 24);
    news(s, '📉 GLOBAL RECESSION: markets crash worldwide as credit dries up.', { type: 'major' });
  } else if (roll < 0.38) {
    for (const id of aliveIds(s)) {
      const n = s.nations[id];
      const protectedBy = n.techs.includes('soc2') ? 0.5 : 1;
      addMod(s, id, 'growth', -0.02 * protectedBy, 12, 'Pandemic');
      addMod(s, id, 'stability', -6 * protectedBy, 12, 'Pandemic');
    }
    news(s, `🦠 PANDEMIC: a new ${r.pick(['influenza', 'coronavirus', 'hemorrhagic fever'])} strain spreads around the globe.`, { type: 'major' });
  } else if (roll < 0.5) {
    const res = r.pick(['gold', 'rare', 'uranium', 'gas', 'food', 'iron']);
    s.world.shocks ||= {};
    s.world.shocks[res] = (s.world.shocks[res] || 0) + r.range(0.5, 1.2) * (r.chance(0.7) ? 1 : -0.6);
    news(s, `${RESOURCES[res].icon} Commodity markets in turmoil: ${RESOURCES[res].name} prices swing wildly.`, { type: 'info' });
  } else if (roll < 0.62) {
    // UN condemnation of the most infamous nation
    const worst = aliveIds(s).reduce((a, b) => (s.nations[a].infamy > s.nations[b].infamy ? a : b));
    if (s.nations[worst].infamy > 35) {
      for (const id of aliveIds(s)) if (id !== worst) addOpinion(s, id, worst, -10);
      news(s, `🇺🇳 The UN General Assembly condemns ${nameOf(s, worst)} for its aggression.`, { type: 'major', nations: [worst] });
    }
  } else if (roll < 0.72) {
    s.world.cycle = r.range(0.01, 0.02);
    s.world.cycleTimer = r.int(12, 30);
    news(s, '📈 A global tech boom lifts economies everywhere.', { type: 'good' });
  } else if (roll < 0.82) {
    // A small nation finds new purpose
    const small = aliveIds(s).filter((id) => (s.nations[id].stats.gdp || 0) > 20 && (s.nations[id].stats.gdp || 0) < 400 && !s.nations[id].overlord);
    const id = r.pick(small);
    if (id) {
      const n = s.nations[id];
      n.leader = makeLeader(s, id, n.gov, ['Reformer', r.pick(['Industrialist', 'Expansionist', 'Scholar'])]);
      n.pers = personalityOf(n.leader.traits);
      addMod(s, id, 'growth', 0.025, 60, 'Economic miracle');
      pickAmbition(s, id);
      news(s, `🚀 Visionary leader ${n.leader.name} launches ${n.name} on a path of rapid modernization.`, { nations: [id] });
    }
  } else {
    const ids = aliveIds(s).filter((id) => (s.nations[id].stats.gdp || 0) > 400);
    const a = r.pick(ids);
    if (a) {
      const t = r.pick(owned(s, a));
      s.terr[t].devast += 20; s.terr[t].gdp *= 0.97;
      news(s, `🌋 Catastrophic ${disasterFor(s, t)} strikes ${TERR[t].name}.`, { nations: [a], terr: t });
    }
  }
}
