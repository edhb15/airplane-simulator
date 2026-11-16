// Economy: budgets, growth, resources, research, construction, stability.
import { TERR } from './world.js';
import { GOVS, OFFICIAL_TRAITS } from '../data/people.js';
import { TECHS, TECH_BY_ID, techCost } from '../data/techs.js';
import { DIFFICULTY } from './config.js';
import {
  clamp, rng, owned, controlled, nationGdp, nationPop, techMod, hasTech, news, markDirty,
  subjectsOf, warsOf, aliveIds, monthMemo, hasTreaty, sameBloc,
} from './state.js';

export const RESOURCES = {
  oil: { name: 'Oil', icon: '🛢️', value: 8, color: '#1f1f1f' },
  gas: { name: 'Natural Gas', icon: '🔥', value: 5, color: '#4fa3d1' },
  gold: { name: 'Gold & Gems', icon: '🪙', value: 4, color: '#e3b341' },
  uranium: { name: 'Uranium', icon: '☢️', value: 3, color: '#7bd64f' },
  rare: { name: 'Rare Minerals', icon: '💎', value: 6, color: '#b37feb' },
  iron: { name: 'Iron & Steel', icon: '⛓️', value: 3, color: '#9aa4ad' },
  food: { name: 'Food', icon: '🌾', value: 3, color: '#c9a227' },
};
export const RES_KEYS = Object.keys(RESOURCES);

// Annual upkeep and build cost in $B per point at full price
export const UNITS = {
  army: { name: 'Army', unit: 'divisions', icon: '🪖', build: 6, upkeep: 0.8, low: 0.05, oil: 0.004, days: 60 },
  navy: { name: 'Navy', unit: 'fleet strength', icon: '🚢', build: 9, upkeep: 1.2, low: 0.3, oil: 0.012, days: 240 },
  air: { name: 'Air Force', unit: 'air wings', icon: '✈️', build: 8, upkeep: 1.0, low: 0.3, oil: 0.012, days: 150 },
  missile: { name: 'Missiles', unit: 'batteries', icon: '🚀', build: 1.2, upkeep: 0.08, low: 0.4, oil: 0, days: 60 },
  nuke: { name: 'Nuclear Arsenal', unit: 'warheads', icon: '☢️', build: 25, upkeep: 0.6, low: 0.6, oil: 0, days: 360 },
};
const FIELD = { army: 'army', navy: 'navy', air: 'air', missile: 'missiles', nuke: 'nukes' };
export const unitField = (type) => FIELD[type];

export const BUILDINGS = {
  infra: { name: 'Infrastructure', icon: '🛣️', max: 10, days: 240, desc: '+0.15% growth per level, faster recovery, supply' },
  fac: { name: 'Factories', icon: '🏭', max: 30, days: 270, desc: '+0.04% growth, -1% unit cost each' },
  labs: { name: 'Research Labs', icon: '🔬', max: 30, days: 270, desc: '+3% research each' },
  forts: { name: 'Fortifications', icon: '🏰', max: 5, days: 150, desc: '+12% defense per level' },
  bases: { name: 'Military Bases', icon: '🎖️', max: 5, days: 180, desc: '+3 garrison, -3 unrest, +naval range' },
  mines: { name: 'Mines & Wells', icon: '⛏️', max: 3, days: 240, desc: '+25% resource output per level' },
};

export function buildCost(s, tid, type) {
  const t = s.terr[tid];
  const lvl = t[type];
  const base = { infra: 2 + t.gdp * 0.004, fac: 3 + t.gdp * 0.003, labs: 4 + t.gdp * 0.0025, forts: 2.5 + t.gdp * 0.001, bases: 3.5 + t.gdp * 0.001, mines: 4 + t.gdp * 0.002 }[type];
  const mod = 1 + techMod(s, t.owner, 'buildCost');
  return +(base * (1 + lvl * 0.12) * Math.max(0.4, mod)).toFixed(1);
}

// Cost multiplier for a nation's units: soldiers in poorer nations are cheaper to keep
export function costScale(s, nid, type) {
  const st = s.nations[nid].stats;
  const gdppc = st.gdppc ?? 20000;
  const u = UNITS[type];
  return u.low + (1 - u.low) * Math.min(1, gdppc / 60000);
}

export function unitUpkeep(s, nid) {
  const n = s.nations[nid];
  if (!n.stats.gdppc) {
    const pop = nationPop(s, nid);
    n.stats.gdppc = pop > 0 ? (nationGdp(s, nid) * 1000) / pop : 20000;
  }
  const mod = Math.max(0.4, 1 + techMod(s, nid, 'upkeep'));
  const out = { total: 0 };
  for (const type of Object.keys(UNITS)) {
    const v = n[FIELD[type]] * UNITS[type].upkeep * costScale(s, nid, type) * mod;
    out[type] = v;
    out.total += v;
  }
  return out;
}

export function unitBuildCost(s, nid, type) {
  const n = s.nations[nid];
  let mod = 1 + techMod(s, nid, 'unitCost');
  const fac = owned(s, nid).reduce((a, t) => a + s.terr[t].fac, 0);
  mod -= Math.min(0.3, fac * 0.01);
  mod -= Math.min(0.2, (n.stats.resProd?.iron || 0) * 0.04);
  return UNITS[type].build * costScale(s, nid, type) * Math.max(0.35, mod);
}

// Divisions a nation can field at its mobilisation level
export const MOBIL = [
  { name: 'Volunteer Army', rate: 0.6, growth: 0, stability: 0 },
  { name: 'Partial Mobilization', rate: 1.6, growth: -0.006, stability: -4 },
  { name: 'Total War', rate: 4.0, growth: -0.025, stability: -10 },
];
export function manpowerCap(s, nid) {
  const n = s.nations[nid];
  return (nationPop(s, nid) * MOBIL[n.mobil].rate) / Math.max(0.3, 1 + techMod(s, nid, 'manpower')) * (n.stats.integratedShare ?? 1);
}

export function resourceProduction(s, nid) {
  const out = Object.fromEntries(RES_KEYS.map((k) => [k, 0]));
  const mod = 1 + techMod(s, nid, 'resOut');
  for (const tid of controlled(s, nid)) {
    const t = s.terr[tid];
    const eff = mod * (1 + t.mines * 0.25) * (1 - t.devast / 150) * (1 - t.unrest / 250) * (t.owner === nid ? 1 : 0.6);
    for (const k of RES_KEYS) if (t.res[k]) out[k] += t.res[k] * eff;
  }
  return out;
}

export function resourceNeeds(s, nid) {
  const n = s.nations[nid];
  const noOil = techMod(s, nid, 'noOil') > 0;
  return {
    oil: noOil ? 0 : n.army * UNITS.army.oil + n.navy * UNITS.navy.oil + n.air * UNITS.air.oil,
    food: nationPop(s, nid) / 150,
    uranium: n.nukes > 0 || n.nukeBuild > 0 ? 0.3 : 0,
  };
}

export function interestRate(s, nid) {
  const n = s.nations[nid];
  const gdp = Math.max(0.1, n.stats.gdp || nationGdp(s, nid));
  const ratio = n.debt / gdp;
  return clamp((n.reserve ? 0.02 : 0.034) + Math.max(0, ratio - 1) * (n.reserve ? 0.006 : 0.016) + (n.stability < 30 ? 0.015 : 0) + techMod(s, nid, 'interest') + (s.world.cycle < -0.01 ? 0.005 : 0), 0.005, 0.15);
}

export function creditRating(s, nid) {
  const r = interestRate(s, nid);
  return r < 0.03 ? 'AAA' : r < 0.04 ? 'AA' : r < 0.05 ? 'A' : r < 0.065 ? 'BBB' : r < 0.085 ? 'BB' : r < 0.12 ? 'B' : 'CCC';
}

function tradeIncome(s, nid, gdp) {
  let v = 0;
  const mod = 1 + techMod(s, nid, 'trade');
  for (const t of s.treaties) {
    if (t.type !== 'trade' || (t.a !== nid && t.b !== nid)) continue;
    const other = t.a === nid ? t.b : t.a;
    if (!s.nations[other]?.alive) continue;
    v += 0.006 * Math.min(gdp, s.nations[other].stats.gdp || 0) * mod;
  }
  for (const b of s.blocs) {
    if (b.type !== 'economic' || !b.members.includes(nid)) continue;
    v += gdp * 0.004 * Math.min(1, b.members.length / 10) * mod;
  }
  const embargoed = s.embargo.filter((e) => e.b === nid).length;
  v -= gdp * 0.004 * embargoed;
  return v;
}

// Full annual budget for a nation ($B/yr)
export function budgetOf(s, nid) {
  const n = s.nations[nid];
  const gdp = nationGdp(s, nid);
  const gov = GOVS[n.gov];
  const isAi = nid !== s.player;
  const aiEco = isAi ? DIFFICULTY[s.difficulty].aiEco : 1;
  const taxEff = (gov.taxEff + techMod(s, nid, 'taxEff')) * (0.72 + 0.28 * n.stability / 100) * aiEco;
  const prod = n.stats.resProd || resourceProduction(s, nid);
  const need = resourceNeeds(s, nid);
  const price = s.market;
  let resIncome = 0, resImport = 0;
  for (const k of RES_KEYS) {
    const v = RESOURCES[k].value * price[k];
    const surplus = prod[k] - (need[k] || 0);
    if (surplus >= 0) resIncome += surplus * v;
    else resImport += -surplus * v * 1.25;
  }
  let tributeIn = 0;
  for (const sub of subjectsOf(s, nid)) tributeIn += s.nations[sub].stats.tributePaid || 0;
  const income = {
    taxes: gdp * (n.tax / 100) * taxEff,
    resources: resIncome,
    trade: tradeIncome(s, nid, gdp),
    tribute: tributeIn,
  };
  const upkeep = unitUpkeep(s, nid);
  const expense = {
    administration: gdp * 0.1,
    military: gdp * n.budget.mil / 100,
    research: gdp * n.budget.res / 100,
    infrastructure: gdp * n.budget.infra / 100,
    welfare: gdp * n.budget.welfare / 100,
    interest: n.debt * interestRate(s, nid),
    imports: resImport,
    tribute: 0,
  };
  if (n.overlord) {
    const pre = Object.values(income).reduce((a, b) => a + b, 0);
    expense.tribute = Math.max(0, pre * n.tribute);
  }
  const totalIn = Object.values(income).reduce((a, b) => a + b, 0);
  const totalOut = Object.values(expense).reduce((a, b) => a + b, 0);
  return { gdp, income, expense, totalIn, totalOut, balance: totalIn - totalOut, upkeep, prod, need };
}

export function researchPoints(s, nid) {
  const n = s.nations[nid];
  const gdp = n.stats.gdp || nationGdp(s, nid);
  const labs = owned(s, nid).reduce((a, t) => a + s.terr[t].labs, 0);
  let mult = 1 + labs * 0.03 + techMod(s, nid, 'research') + Math.min(0.25, (n.stats.resProd?.rare || 0) * 0.04);
  mult += s.treaties.filter((t) => t.type === 'research' && (t.a === nid || t.b === nid)).length * 0.08;
  mult *= 0.6 + 0.4 * n.stability / 100;
  if (nid === s.player) mult *= DIFFICULTY[s.difficulty].research;
  return 1.2 * Math.sqrt(Math.max(0, gdp * n.budget.res / 100)) * mult;
}

// Tech is cheaper once much of the world has it
export function effectiveTechCost(s, nid, tid) {
  const t = TECH_BY_ID[tid];
  const share = monthMemo(s, `techshare:${tid}`, () => {
    const ids = aliveIds(s);
    return ids.filter((id) => s.nations[id].techs.includes(tid)).length / Math.max(1, ids.length);
  });
  return techCost(t) * (1 - 0.6 * share);
}

export function availableTechs(s, nid) {
  const n = s.nations[nid];
  return TECHS.filter((t) => {
    if (n.techs.includes(t.id)) return false;
    const prev = TECHS.find((x) => x.branch === t.branch && x.tier === t.tier - 1);
    if (prev && !n.techs.includes(prev.id)) return false;
    return t.req.every((r) => n.techs.includes(r));
  });
}

export function completeTech(s, nid, tid) {
  const n = s.nations[nid];
  if (n.techs.includes(tid)) return;
  n.techs.push(tid);
  markDirty(s);
  const t = TECH_BY_ID[tid];
  if (nid === s.player) news(s, `Our scientists have completed ${t.name}. ${t.desc}.`, { type: 'good', player: true });
  else if (t.tier >= 5 || tid === 'str2') {
    const n2 = s.nations[nid];
    news(s, tid === 'str2' ? `☢️ ${n2.name} has tested its first nuclear weapon!` : `${n2.name} unveils ${t.name}.`, { type: tid === 'str2' ? 'major' : 'info', nations: [nid] });
  }
}

// Fill in derived statistics without advancing time (new games, loaded saves)
export function refreshStats(s) {
  for (const nid of aliveIds(s)) {
    const n = s.nations[nid];
    const pop = nationPop(s, nid);
    const gdp = nationGdp(s, nid);
    n.stats.gdppc = pop > 0 ? (gdp * 1000) / pop : 0;
    n.stats.resProd = resourceProduction(s, nid);
    n.stats.gdp = gdp;
    n.stats.pop = pop;
    n.stats.prevGdp ||= gdp;
  }
  for (const nid of aliveIds(s)) {
    const n = s.nations[nid];
    const b = budgetOf(s, nid);
    n.stats.budget = { income: b.income, expense: b.expense, totalIn: b.totalIn, totalOut: b.totalOut, balance: b.balance };
    n.stats.upkeep = b.upkeep.total;
    n.stats.tributePaid = b.expense.tribute;
    n.rp = researchPoints(s, nid);
  }
}

// ---------- Monthly tick ----------
export function economyMonth(s) {
  const r = rng(s);
  // Market drift
  for (const k of RES_KEYS) {
    const shock = s.world.shocks?.[k] || 0;
    const target = 1 + shock + (k === 'food' ? s.world.winter * 0.02 : 0);
    s.market[k] = clamp(s.market[k] + (target - s.market[k]) * 0.12 + r.gauss(0, 0.025), 0.3, 4);
    if (s.world.shocks?.[k]) s.world.shocks[k] *= 0.93;
  }
  // Global business cycle
  s.world.cycleTimer -= 1;
  if (s.world.cycleTimer <= 0) {
    s.world.cycle = r.chance(0.25) ? -r.range(0.01, 0.035) : r.range(-0.003, 0.012);
    s.world.cycleTimer = r.int(12, 48);
  }
  s.world.winter = Math.max(0, s.world.winter - 0.15);

  for (const nid of aliveIds(s)) nationMonth(s, nid);
  for (const tid of Object.keys(s.terr)) territoryMonth(s, tid);
}

function nationMonth(s, nid) {
  const n = s.nations[nid];
  const r = rng(s);
  const pop = nationPop(s, nid);
  const gdpBefore = n.stats.gdp || nationGdp(s, nid);
  n.stats.gdppc = pop > 0 ? (gdpBefore * 1000) / pop : 0;
  n.stats.resProd = resourceProduction(s, nid);
  const ownedList = owned(s, nid);
  const intPop = ownedList.reduce((a, t) => a + (s.terr[t].core === nid ? s.terr[t].pop : s.terr[t].pop * 0.3), 0);
  n.stats.integratedShare = pop > 0 ? intPop / pop : 1;
  const b = budgetOf(s, nid);
  n.stats.gdp = b.gdp;
  n.stats.pop = pop;
  n.stats.budget = { income: b.income, expense: b.expense, totalIn: b.totalIn, totalOut: b.totalOut, balance: b.balance };
  n.stats.upkeep = b.upkeep.total;
  n.stats.tributePaid = b.expense.tribute;

  // Treasury & debt
  n.treasury += b.balance / 12;
  if (n.treasury < 0) {
    n.debt += -n.treasury;
    n.treasury = 0;
  }
  // AI and well-run states pay down debt with spare cash
  if (nid !== s.player && n.treasury > b.gdp * 0.08 && n.debt > 0) {
    const pay = Math.min(n.debt, n.treasury - b.gdp * 0.05);
    n.debt -= pay; n.treasury -= pay;
  }

  // Military funding: readiness and automatic procurement
  const funds = b.expense.military;
  const upkeep = Math.max(0.01, b.upkeep.total);
  const fundRatio = funds / upkeep;
  const oilNeed = b.need.oil || 0;
  const oilShort = oilNeed > 0 && b.prod.oil < oilNeed && n.treasury <= 0 ? 0.25 : 0;
  const readyTarget = clamp(0.35 + 0.65 * Math.min(1.05, fundRatio), 0.3, 1.05) - oilShort;
  n.readiness = clamp(n.readiness + (readyTarget - n.readiness) * 0.15, 0.2, 1.05);
  const surplus = Math.max(0, funds - upkeep) / 12;
  if (surplus > 0.001) procure(s, nid, surplus);

  // Queued production
  if (n.prodQueue?.length) {
    n.prodQueue = n.prodQueue.filter((q) => {
      if (q.done > s.day) return true;
      n[FIELD[q.type]] += q.amount;
      if (nid === s.player) news(s, `${UNITS[q.type].icon} ${q.amount} new ${UNITS[q.type].unit} have entered service.`, { type: 'good', player: true });
      return false;
    });
  }
  if (n.nukeBuild > 0) {
    n.nukeBuild -= 1;
    if (n.nukeBuild <= 0) {
      n.nukes += 1;
      if (nid === s.player) news(s, '☢️ A new nuclear warhead is ready.', { type: 'good', player: true });
    }
  }

  // Research
  const rp = researchPoints(s, nid);
  n.rp = rp;
  if (!n.research && n.queue.length) n.research = { id: n.queue.shift(), prog: 0 };
  if (!n.research && nid !== s.player) {
    const pick = aiPickTech(s, nid);
    if (pick) n.research = { id: pick, prog: 0 };
  }
  if (n.research) {
    n.research.prog += rp + (n.rpBank || 0);
    n.rpBank = 0;
    const cost = effectiveTechCost(s, nid, n.research.id);
    if (n.research.prog >= cost) {
      const over = n.research.prog - cost;
      completeTech(s, nid, n.research.id);
      n.research = null;
      if (n.queue.length) n.research = { id: n.queue.shift(), prog: over };
      else n.rpBank = Math.min(over, rp * 3);
      if (nid === s.player && !n.research && availableTechs(s, nid).length) s.alerts.push({ day: s.day, text: 'Research idle — pick a new technology.', type: 'warn', action: 'research' });
    }
  } else {
    n.rpBank = Math.min((n.rpBank || 0) + rp, rp * 6);
  }

  // Approval and stability
  const growth = gdpBefore > 0 ? (b.gdp - (n.stats.prevGdp || b.gdp)) / Math.max(1, n.stats.prevGdp || b.gdp) * 12 : 0;
  n.stats.prevGdp = b.gdp;
  n.stats.growth = growth;
  const food = (b.prod.food || 0) - (b.need.food || 0);
  const gov = GOVS[n.gov];
  let approval = 50 + (n.budget.welfare - 6) * 2.6 - (n.tax - 25) * 1.1 + clamp(growth * 250, -15, 12)
    - n.warEx * 0.35 + (n.leader.traits.includes('Populist') ? 6 : 0) + clamp(food * 1.2, n.treasury > 0 ? 0 : -8, 5)
    + modSum(n, 'approval') - (b.balance < 0 && n.debt > b.gdp * 1.5 ? 8 : 0);
  if (n.mobil === 2) approval -= 6;
  n.approval = clamp(n.approval + (clamp(approval, 0, 100) - n.approval) * 0.2, 0, 100);
  let stabTarget = gov.stabilityBase + (n.approval - 50) * 0.55 + techMod(s, nid, 'stability') + gov.repression * 12
    - n.warEx * 0.25 + MOBIL[n.mobil].stability + modSum(n, 'stability');
  const unrestAvg = ownedList.length ? ownedList.reduce((a, t) => a + s.terr[t].unrest * s.terr[t].pop, 0) / Math.max(0.01, pop) : 0;
  stabTarget -= unrestAvg * 0.25;
  n.stability = clamp(n.stability + (clamp(stabTarget, 0, 100) - n.stability) * 0.1 + r.gauss(0, 0.6), 0, 100);
  n.lowStab = n.stability < 20 ? n.lowStab + 1 : 0;

  // War exhaustion
  const wars = warsOf(s, nid);
  if (wars.length) {
    const occ = ownedList.filter((t) => s.terr[t].ctrl !== nid).length / Math.max(1, ownedList.length);
    n.warEx = clamp(n.warEx + 0.6 + occ * 4, 0, 100);
  } else n.warEx = Math.max(0, n.warEx - 2.5);

  // Political capital & infamy
  const pcGain = gov.pc + techMod(s, nid, 'pc') + n.stability / 40 + (n.leader.traits.includes('Diplomat') ? 1 : 0);
  n.pc = clamp(n.pc + pcGain, 0, 500);
  n.infamy = Math.max(0, n.infamy - (0.35 + (n.leader.traits.includes('Diplomat') ? 0.25 : 0)));

  // Temporary modifiers expire
  if (n.mods?.length) n.mods = n.mods.filter((m) => m.until > s.day);

  // Subjects: liberty desire
  if (n.overlord) {
    const lord = s.nations[n.overlord];
    const ratio = (n.stats.power || 1) / Math.max(1, lord.stats.power || 1);
    const target = 15 + ratio * 120 + n.tribute * 80 - (s.rel[`${nid}>${n.overlord}`] || 0) * 0.15 + (lord.warEx * 0.2)
      - (n.loyaltyBonus || 0) - (hasTreaty(s, nid, n.overlord, 'trade') ? 5 : 0);
    n.liberty = clamp(n.liberty + (clamp(target, 0, 100) - n.liberty) * 0.08, 0, 100);
  }
}

function modSum(n, key) {
  let v = 0;
  for (const m of n.mods || []) if (m.key === key) v += m.value;
  return v;
}
export function addMod(s, nid, key, value, months, label) {
  const n = s.nations[nid];
  (n.mods ||= []).push({ key, value, until: s.day + months * 30, label });
}

function procure(s, nid, money) {
  const n = s.nations[nid];
  const mix = n.mix;
  const tot = mix.army + mix.navy + mix.air + mix.missile || 1;
  const cap = manpowerCap(s, nid);
  for (const type of ['army', 'navy', 'air', 'missile']) {
    let share = money * (mix[type] / tot);
    if (share <= 0) continue;
    if (type === 'navy' && !owned(s, nid).some((t) => TERR[t].coastal)) { n.treasury += share; continue; }
    if (type === 'missile' && !hasTech(s, nid, 'str1')) { n.treasury += share; continue; }
    let pts = share / unitBuildCost(s, nid, type);
    if (type === 'army') {
      const room = Math.max(0, cap - n.army);
      if (pts > room) { n.treasury += (pts - room) * unitBuildCost(s, nid, 'army'); pts = room; }
    }
    n[FIELD[type]] += pts;
  }
}

export function aiPickTech(s, nid) {
  const n = s.nations[nid];
  const avail = availableTechs(s, nid);
  if (!avail.length) return null;
  const p = n.pers;
  const atWar = warsOf(s, nid).length > 0;
  const weights = avail.map((t) => {
    let w = 10 / t.tier;
    if (t.branch === 'economy' || t.branch === 'industry') w *= 1 + p.economy * 1.5;
    if (t.branch === 'land' || t.branch === 'air') w *= 1 + p.aggression + p.paranoia + (atWar ? 1 : 0);
    if (t.branch === 'naval') w *= 0.5 + p.expansion + (n.navy > 20 ? 0.8 : 0);
    if (t.branch === 'strategic') w *= 0.4 + p.paranoia + p.aggression * 0.5;
    if (t.id === 'str2' && !(n.stats.resProd?.uranium > 0.2) && n.stats.gdp < 1000) w *= 0.2;
    if (t.branch === 'society') w *= 0.7 + p.science;
    if (t.branch === 'intel') w *= 0.5 + p.paranoia * 0.5;
    return w;
  });
  return rng(s).weighted(avail, weights).id;
}

function territoryMonth(s, tid) {
  const t = s.terr[tid];
  const n = s.nations[t.owner];
  if (!n) return;
  const r = rng(s);
  const gdppc = t.pop > 0 ? (t.gdp * 1000) / t.pop : 10000;
  const occupied = t.ctrl !== t.owner;
  let g = clamp(0.065 - 0.012 * Math.log(Math.max(1, gdppc / 1000)), 0.008, 0.07);
  g += 0.0015 * (t.infra - 5) + 0.0004 * t.fac + techMod(s, t.owner, 'growth') + s.world.cycle;
  g += (n.stability - 50) / 2500 - Math.max(0, n.tax - 30) * 0.0012 - t.devast * 0.0006 - t.unrest * 0.0003;
  g += MOBIL[n.mobil].growth + (warsOf(s, t.owner).length ? -0.008 : 0) + (occupied ? -0.06 : 0);
  g += (n.budget.infra - 3) * 0.0008 + modSum(n, 'growth');
  if (t.governor) g += (OFFICIAL_TRAITS[t.governor.trait]?.output || 0) * 0.05;
  g -= s.world.winter * 0.004;
  if (n.blockaded && TERR[tid].coastal) g -= 0.03;
  if (sameBloc(s, t.owner, t.owner, 'economic')) g += 0.002;
  g += r.gauss(0, 0.004);
  t.gdp = Math.max(0.05, t.gdp * (1 + g / 12));

  const popG = clamp(0.025 - 0.005 * Math.log(Math.max(1, gdppc / 1000)), -0.006, 0.03) + techMod(s, t.owner, 'popGrowth') - s.world.winter * 0.002;
  t.pop = Math.max(0.0005, t.pop * (1 + popG / 12));

  // Infrastructure investment & recovery
  t.infra = clamp(t.infra + n.budget.infra * 0.0035 * (t.infra < 10 ? 1 : 0) * (occupied ? 0 : 1), 0, 10);
  t.devast = Math.max(0, t.devast - (1 + t.infra * 0.25));

  // Unrest & integration
  const foreign = t.core !== t.owner;
  const gov = t.governor ? OFFICIAL_TRAITS[t.governor.trait] : null;
  let target = (foreign ? 45 * (1 - t.integ / 100) + (s.nations[t.core]?.alive ? 12 : 0) : 0)
    + Math.max(0, 50 - n.stability) * 0.4 + t.devast * 0.2 - t.bases * 3 + (occupied ? 25 : 0);
  target *= 1 + (gov?.unrest || 0) + techMod(s, t.owner, 'unrest');
  if (s.nations[t.core]?.alive && s.nations[t.core].overlord === t.owner) target *= 0.6;
  t.unrest = clamp(t.unrest + (clamp(target, 0, 100) - t.unrest) * 0.1, 0, 100);
  if (foreign && !occupied) {
    const rate = 1.1 * (1 + techMod(s, t.owner, 'integration')) * (gov?.integration || 1) * (0.5 + n.stability / 100);
    t.integ = clamp(t.integ + rate, 0, 100);
    if (t.integ >= 100) {
      t.core = t.owner;
      t.integ = 100;
      news(s, `${TERR[tid].name} is now fully integrated into ${n.name}.`, { nations: [t.owner], type: 'good' });
      markDirty(s);
    }
  }

  // Construction
  if (t.build.length) {
    t.build = t.build.filter((b) => {
      if (b.done > s.day) return true;
      if (t.owner === b.by && !occupied) {
        t[b.type] = Math.min(BUILDINGS[b.type].max, t[b.type] + 1);
        if (b.by === s.player) news(s, `${BUILDINGS[b.type].icon} ${BUILDINGS[b.type].name} completed in ${TERR[tid].name}.`, { type: 'good', player: true });
      }
      return false;
    });
  }
}

// Score used by AI and leaderboards: blends economy, military and reach
export function nationScore(s, nid) {
  const n = s.nations[nid];
  return Math.round((n.stats.gdp || 0) / 50 + (n.stats.power || 0) / 4 + owned(s, nid).length * 6 + n.techs.length * 2);
}
