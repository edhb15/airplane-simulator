// Builds a fresh world for a new game.
import { TERRITORIES, TERR, continentOf } from './world.js';
import { STATS, NUKES, MIL_SPEND, MIL_TECH_BONUS } from '../data/stats.js';
import { GOVS, TITLE_OVERRIDES, randomLeaderName, randomTraits, personalityOf } from '../data/people.js';
import { TECHS } from '../data/techs.js';
import { hashSeed } from './rng.js';
import { clamp, rng, addOpinion, addTreaty, touch, news, owned, nationGdp } from './state.js';
import { unitUpkeep, refreshStats } from './economy.js';
import { updatePower } from './military.js';

export { DIFFICULTY, WORLD_MODES } from './config.js';
import { DIFFICULTY, WORLD_MODES } from './config.js';

const SPECIAL_COLORS = {
  USA: '#2f6fd6', CHN: '#d24b3e', RUS: '#4f8f4c', IND: '#e08a2e', GBR: '#b0315f', FRA: '#2b8fbd', DEU: '#8a6d3b',
  JPN: '#d8c3a5', BRA: '#2fa84f', TUR: '#c0563a', IRN: '#3f9b8a', SAU: '#6d8f2d', AUS: '#d4a72c', CAN: '#c44d4d',
  ITA: '#5aa36b', ESP: '#e0b23a', MEX: '#7c5cbf', IDN: '#c4485f', KOR: '#4f7bd9', PAK: '#3a7d44', EGY: '#c9a066',
  NGA: '#3f8f6f', ZAF: '#d9773a', ARG: '#76b5e0', ISR: '#5d8ecf', UKR: '#e6c84a', POL: '#cc5b6e',
};

const BLOCS = [
  { id: 'NATO', name: 'NATO', type: 'military', leader: 'USA', color: '#3d7be0', members: 'USA CAN GBR FRA DEU ITA ESP PRT NLD BEL LUX DNK NOR ISL POL CZE SVK HUN ROU BGR GRC TUR ALB HRV SVN MNE MKD EST LVA LTU FIN SWE' },
  { id: 'EU', name: 'European Union', type: 'economic', leader: 'DEU', color: '#f2c94c', members: 'DEU FRA ITA ESP PRT NLD BEL LUX DNK IRL AUT FIN SWE POL CZE SVK HUN SVN HRV ROU BGR GRC CYP MLT EST LVA LTU' },
  { id: 'CSTO', name: 'Collective Security Treaty', type: 'military', leader: 'RUS', color: '#c0392b', members: 'RUS BLR KAZ KGZ TJK ARM' },
  { id: 'GCC', name: 'Gulf Cooperation Council', type: 'military', leader: 'SAU', color: '#27ae60', members: 'SAU ARE QAT KWT BHR OMN' },
  { id: 'ASEAN', name: 'ASEAN', type: 'economic', leader: 'IDN', color: '#e67e22', members: 'IDN MYS SGP THA PHL VNM KHM LAO MMR BRN' },
  { id: 'MERCOSUR', name: 'Mercosur', type: 'economic', leader: 'BRA', color: '#16a085', members: 'BRA ARG URY PRY BOL' },
  { id: 'SCO', name: 'Shanghai Pact', type: 'economic', leader: 'CHN', color: '#8e44ad', members: 'CHN RUS KAZ KGZ TJK UZB PAK IND IRN BLR' },
  { id: 'AES', name: 'Sahel Alliance', type: 'military', leader: 'MLI', color: '#a0522d', members: 'MLI BFA NER' },
];
const DEFENSE_PACTS = 'USA-JPN USA-KOR USA-AUS AUS-NZL USA-PHL CHN-PRK RUS-PRK SAU-PAK TUR-AZE RUS-BLR GBR-FRA';
const GUARANTEES = 'USA>TWN USA>ISR RUS>SYR FRA>DJI CHN>PAK IND>BTN TUR>XKX';
const TRADE = 'USA-MEX USA-CAN CAN-MEX CHN-PAK CHN-AUS JPN-AUS KOR-USA GBR-JPN DEU-JPN CHN-KOR AUS-NZL IND-ARE CHN-SAU USA-ISR GBR-AUS CHN-BRA';
const RIVALRIES = `USA-RUS:-45 USA-CHN:-30 USA-IRN:-75 USA-PRK:-85 USA-CUB:-40 USA-VEN:-45 ISR-IRN:-95 IND-PAK:-75 CHN-TWN:-70
CHN-IND:-30 CHN-JPN:-30 KOR-PRK:-90 RUS-UKR:-95 ARM-AZE:-75 GRC-TUR:-30 SAU-IRN:-55 MAR-DZA:-45 ETH-ERI:-45 SRB-XKX:-75
ISR-PSE:-90 ISR-LBN:-60 ISR-SYR:-70 RUS-POL:-50 RUS-EST:-45 RUS-LVA:-45 RUS-LTU:-45 RUS-GBR:-40 RUS-GEO:-55 CHN-PHL:-35
CHN-VNM:-20 JPN-PRK:-70 PAK-AFG:-35 IND-CHN:-25 EGY-ETH:-35 SDN-SSD:-40 COL-VEN:-30 VEN-GUY:-50 TUR-CYP:-55 KOR-JPN:-10
USA-GBR:55 USA-ISR:50 USA-JPN:45 USA-CAN:50 USA-AUS:50 GBR-AUS:45 GBR-CAN:45 FRA-DEU:45 CHN-PRK:35 RUS-BLR:60 CHN-RUS:35
CHN-PAK:55 RUS-IRN:30 RUS-SYR:40 IND-RUS:25 SAU-ARE:40 SAU-EGY:30 TUR-AZE:60 USA-KOR:40 USA-TWN:40 JPN-TWN:25 IND-JPN:20
AUS-NZL:60 DEU-AUT:40 SWE-FIN:50 NOR-DNK:40 BRA-ARG:15 CUB-VEN:45 RUS-PRK:35 ARM-RUS:10 IRN-SYR:45 USA-POL:40 USA-UKR:30`;

function nationColor(r, id, i) {
  if (SPECIAL_COLORS[id]) return SPECIAL_COLORS[id];
  const hue = (i * 137.508 + r.range(-12, 12)) % 360;
  const sat = r.range(38, 62), light = r.range(42, 58);
  return hslToHex(hue, sat, light);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function makeLeader(s, nid, gov, extraTraits) {
  const r = rng(s);
  const t = TERR[nid] || TERR[s.nations[nid]?.capital] || TERRITORIES[0];
  const traits = extraTraits || randomTraits(r, gov, r.chance(0.35) ? 3 : 2);
  return { name: randomLeaderName(r, nid, t.subregion), traits, since: s.day, age: r.int(42, 74) };
}

export function techTierFor(gdppc) {
  return gdppc >= 45000 ? 4 : gdppc >= 20000 ? 3 : gdppc >= 8000 ? 2 : gdppc >= 3000 ? 1 : 0;
}

export function newGame(opts) {
  const seedStr = String(opts.seed ?? Math.floor(Math.random() * 1e9));
  const diff = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
  const mode = WORLD_MODES[opts.worldMode] ? opts.worldMode : 'realistic';
  const s = {
    version: 1,
    seed: seedStr,
    rngState: hashSeed(seedStr),
    startYear: 2027,
    day: 0,
    rev: 0,
    player: opts.player,
    difficulty: diff,
    worldMode: mode,
    ironman: !!opts.ironman,
    nations: {},
    terr: {},
    rel: {},
    trust: {},
    memory: {},
    treaties: [],
    blocs: [],
    coalitions: [],
    wars: [],
    embargo: [],
    spy: {},
    influence: {},
    market: { oil: 1, gas: 1, gold: 1, uranium: 1, rare: 1, iron: 1, food: 1 },
    world: { cycle: 0, cycleTimer: 0, nukesUsed: 0, winter: 0, warId: 1, tension: 20 },
    news: [],
    alerts: [],
    pending: [], // decisions awaiting the player
    history: { player: [], top: [], milestones: [] },
    flags: {},
    outcome: null,
  };
  const r = rng(s);
  const shuffled = mode !== 'realistic';

  // ---- Territories ----
  for (const m of TERRITORIES) {
    const st = STATS[m.id] || { pop: 0.05, gdp: 0.5, gov: 'D', mil: 0, navy: null, air: null, res: {} };
    const jitter = shuffled ? r.range(0.7, 1.35) : r.range(0.97, 1.03);
    const gdp = Math.max(0.1, st.gdp * jitter);
    const gdppc = (gdp * 1000) / Math.max(0.001, st.pop);
    const res = { ...st.res };
    if (shuffled) {
      for (const k of Object.keys(res)) if (r.chance(0.25)) res[k] = clamp(res[k] + r.pick([-1, 1]), 0, 3);
      if (r.chance(0.12)) res[r.pick(['oil', 'gas', 'gold', 'uranium', 'rare', 'iron', 'food'])] = r.int(1, 2);
    }
    // deposits scale with the size of the economy so microstates don't become petro-giants
    const scale = clamp(Math.pow(gdp / 500, 0.5), 0.15, 1.8);
    for (const k of Object.keys(res)) res[k] = +(res[k] * scale).toFixed(2);
    s.terr[m.id] = {
      id: m.id,
      owner: m.owner,
      ctrl: m.owner,
      core: m.owner === m.id ? m.id : m.owner,
      pop: st.pop,
      gdp,
      res,
      infra: clamp(Math.round(1 + Math.log2(Math.max(1, gdppc / 1000)) * 1.2), 1, 9),
      fac: clamp(Math.round(Math.sqrt(gdp) / 6), 0, 30),
      labs: clamp(Math.round((Math.sqrt(gdp) / 10) * (gdppc > 30000 ? 1.5 : 1)), 0, 30),
      forts: m.id === 'ISR' || m.id === 'KOR' || m.id === 'TWN' || m.id === 'PRK' ? 3 : st.mil > 300 ? 2 : st.mil > 50 ? 1 : 0,
      bases: st.mil > 500 ? 3 : st.mil > 100 ? 2 : st.mil > 20 ? 1 : 0,
      mines: 0,
      unrest: 0,
      integ: 100,
      devast: 0,
      governor: null,
      build: [],
    };
  }

  // ---- Nations ----
  const ids = [...new Set(TERRITORIES.map((t) => t.owner))].sort();
  ids.forEach((id, i) => {
    const m = TERR[id];
    const st = STATS[id];
    let gov = st.gov;
    if (shuffled && r.chance(0.18)) gov = r.pick(['D', 'D', 'K', 'M', 'C', 'A', 'A', 'J', 'T']);
    const n = makeNation(s, id, m.name, gov, nationColor(r, id, i), m.flag);
    n.capital = id;
    s.nations[id] = n;
  });
  touch(s);

  // ---- Economy, military, technology ----
  for (const id of ids) {
    const n = s.nations[id];
    const st = STATS[id];
    const gdp = nationGdp(s, id);
    const pop = owned(s, id).reduce((a, t) => a + s.terr[t].pop, 0);
    const gdppc = (gdp * 1000) / Math.max(0.001, pop);
    const mj = shuffled ? r.range(0.5, 1.6) : r.range(0.95, 1.05);
    const coastal = TERR[id].coastal;
    n.army = Math.max(0.3, (st.mil / 10) * mj);
    const derivedNavy = coastal ? Math.sqrt(st.mil) * Math.pow(gdp / 1000, 0.3) * 0.5 : 0;
    const derivedAir = Math.sqrt(st.mil) * Math.pow(gdp / 1000, 0.35) * 0.7;
    n.navy = Math.max(0, (st.navy ?? derivedNavy) * mj);
    n.air = Math.max(0, (st.air ?? derivedAir) * mj);
    n.nukes = NUKES[id] || 0;
    if (shuffled && !n.nukes && gdp > 800 && r.chance(0.12)) n.nukes = r.int(1, 3);
    n.missiles = Math.round(n.army * 0.15 + (MIL_TECH_BONUS[id] || 0) * 10);

    // technology
    const base = techTierFor(gdppc);
    const milBonus = MIL_TECH_BONUS[id] || 0;
    const tiers = {
      economy: base, industry: base, society: base, intel: Math.max(0, base - 1 + (milBonus > 1 ? 1 : 0)),
      land: clamp(base - 1 + milBonus, 0, 4), naval: clamp(base - 1 + milBonus, 0, 4), air: clamp(base - 1 + milBonus, 0, 4),
      strategic: n.nukes ? (n.nukes >= 3 ? 3 : 2) : milBonus ? 1 : 0,
    };
    if (id === 'USA' || id === 'RUS' || id === 'ISR') tiers.strategic = 4;
    if (gdp > 1500) tiers.industry = Math.max(tiers.industry, 3);
    for (const t of TECHS) if (t.tier <= tiers[t.branch]) n.techs.push(t.id);
    if (n.nukes && !n.techs.includes('str2')) n.techs.push('str1', 'str2');

    // budget: tax set so the starting budget is roughly balanced
    n.budget.mil = clamp(MIL_SPEND[id] ?? r.range(1.0, 2.0), 0.5, 25);
    if (shuffled) n.budget.mil = clamp(n.budget.mil * r.range(0.6, 1.6), 0.5, 25);
    const upkeep = unitUpkeep(s, id).total;
    n.budget.mil = clamp(Math.max(n.budget.mil, (upkeep / Math.max(gdp, 0.1)) * 100 * 0.95), 0.5, 25);
    n.budget.welfare = gdppc > 30000 ? r.range(9, 13) : gdppc > 10000 ? r.range(6, 9) : r.range(3, 6);
    n.budget.res = gdppc > 30000 ? r.range(2, 3) : gdppc > 10000 ? r.range(1, 1.8) : r.range(0.3, 0.9);
    n.budget.infra = r.range(2, 4);
    n.debt = 0; // set below; needed for the interest estimate

    const debtRatio = { USA: 1.2, JPN: 2.5, ITA: 1.4, GRC: 1.6, FRA: 1.1, GBR: 1.0, CAN: 1.05, ESP: 1.05, BEL: 1.05, SGP: 1.6, CHN: 0.8, BRA: 0.85, IND: 0.82, ARG: 0.9, EGY: 0.9, LBN: 1.5, VEN: 1.5, SDN: 1.8, RUS: 0.2, SAU: 0.25, NOR: 0.4, DEU: 0.63, KOR: 0.55, AUS: 0.5 }[id];
    n.debt = gdp * (debtRatio ?? r.range(0.25, 0.8));
    n.reserve = id === 'USA' || id === 'JPN' || id === 'CHE' || id === 'GBR';
    // Taxes set so the starting budget runs a small surplus
    const ratio = n.debt / Math.max(0.1, gdp);
    const interestPct = ((n.reserve ? 0.02 : 0.034) + Math.max(0, ratio - 1) * (n.reserve ? 0.006 : 0.016)) * ratio * 100;
    const spend = 10 + n.budget.mil + n.budget.welfare + n.budget.res + n.budget.infra + interestPct;
    const eff = GOVS[n.gov].taxEff * (0.72 + 0.28 * 0.6);
    n.tax = clamp(Math.round(spend / eff + r.range(0.5, 2)), 8, 65);
    n.treasury = gdp * r.range(0.02, 0.05);
    n.mobil = n.army > pop * 0.9 ? 2 : n.army > pop * 0.4 ? 1 : 0;
    n.readiness = 0.85;
    n.stability = clamp(GOVS[n.gov].stabilityBase + (gdppc > 20000 ? 10 : gdppc < 3000 ? -10 : 0) + r.range(-8, 8), 15, 90);
    if (['SDN', 'SSD', 'SOM', 'HTI', 'YEM', 'SYR', 'LBY', 'MMR', 'AFG', 'COD', 'CAF', 'MLI', 'BFA', 'LBN'].includes(id)) n.stability = r.range(12, 25);
    n.approval = n.stability;
    n.pc = 25;
    if (GOVS[n.gov].democratic) n.nextElection = r.int(60, 360 * 4);
  }

  // ---- Blocs, treaties, relations ----
  if (mode === 'realistic') {
    for (const b of BLOCS) s.blocs.push({ ...b, members: b.members.split(' ').filter((x) => s.nations[x]) });
    for (const p of DEFENSE_PACTS.split(' ')) { const [a, b] = p.split('-'); addTreaty(s, 'defense', a, b); }
    for (const p of GUARANTEES.split(' ')) { const [a, b] = p.split('>'); addTreaty(s, 'guarantee', a, b); }
    for (const p of TRADE.split(' ')) { const [a, b] = p.split('-'); addTreaty(s, 'trade', a, b); }
    for (const tok of RIVALRIES.split(/\s+/)) {
      const [pair, v] = tok.split(':');
      const [a, b] = pair.split('-');
      addOpinion(s, a, b, +v);
      addOpinion(s, b, a, +v);
    }
  } else {
    // Random blocs: keep some real ones with random survivors, and invent a few
    for (const b of BLOCS) {
      if (r.chance(0.45)) continue;
      const members = b.members.split(' ').filter((x) => s.nations[x] && r.chance(0.7));
      if (members.length >= 2) s.blocs.push({ ...b, members, leader: members.includes(b.leader) ? b.leader : members[0] });
    }
    const majors = ids.filter((id) => nationGdp(s, id) > 300);
    for (let i = 0; i < 2; i++) {
      const leader = r.pick(majors);
      if (s.blocs.some((b) => b.members.includes(leader) && b.type === 'military')) continue;
      const near = ids.filter((id) => id !== leader && continentOf(id) === continentOf(leader) && r.chance(0.25)).slice(0, 7);
      if (near.length) s.blocs.push({ id: 'PACT' + i, name: `${s.nations[leader].name} Pact`, type: 'military', leader, color: s.nations[leader].color, members: [leader, ...near].filter((m) => !s.blocs.some((bl) => bl.type === 'military' && bl.members.includes(m))) });
    }
    for (let i = 0; i < 60; i++) {
      const a = r.pick(ids), b = r.pick(s.nations[a] ? TERR[a].nb.length ? TERR[a].nb.map((t) => s.terr[t].owner) : ids : ids);
      if (!b || a === b) continue;
      const v = r.chance(0.6) ? -r.range(20, 80) : r.range(20, 60);
      addOpinion(s, a, b, v); addOpinion(s, b, a, v);
    }
  }

  // ---- AI ambitions ----
  for (const id of ids) pickAmbition(s, id);

  // ---- Player bonuses ----
  const P = s.nations[s.player];
  const d = DIFFICULTY[diff];
  P.treasury *= d.playerBonus;
  P.pc = 60 * d.playerBonus;
  P.isPlayer = true;

  if (mode === 'chaos') {
    for (const id of ids) {
      const n = s.nations[id];
      if (r.chance(0.3) && !n.leader.traits.includes('Warmonger')) n.leader.traits[0] = r.pick(['Warmonger', 'Expansionist', 'Opportunist']);
      n.pers = personalityOf(n.leader.traits);
    }
  }

  refreshStats(s);
  updatePower(s);
  news(s, `The year is ${s.startYear}. ${P.name} ${P.leader ? 'under ' + P.leader.name : ''} sets out to reshape the world.`, { type: 'major' });
  s.alerts = [];
  return s;
}

export function makeNation(s, id, name, gov, color, flag) {
  const leader = makeLeader(s, id, gov);
  return {
    id, name, color, flag: flag || '', alive: true, gov,
    title: TITLE_OVERRIDES[id] && (gov === 'D' || gov === 'K' || gov === 'M' || gov === 'C' || gov === 'T') ? TITLE_OVERRIDES[id] : null,
    leader, pers: personalityOf(leader.traits),
    capital: null,
    treasury: 0, debt: 0, tax: 25,
    budget: { mil: 2, res: 1, infra: 3, welfare: 6 },
    mix: { army: 40, navy: 20, air: 25, missile: 15 },
    mobil: 0, stability: 50, approval: 50, warEx: 0, pc: 20, infamy: 0,
    army: 1, navy: 0, air: 0, missiles: 0, nukes: 0, readiness: 0.8, nukeBuild: 0,
    techs: [], research: null, queue: [], rp: 0,
    overlord: null, liberty: 0, subjectSince: 0, tribute: 0.15,
    claims: [],
    lowStab: 0, nextElection: null,
    ai: { ambition: 'defensive', rival: null, focus: null, lastWar: -9999, nextThink: 0 },
    stats: {},
  };
}

export function pickAmbition(s, id) {
  const r = rng(s);
  const n = s.nations[id];
  const p = n.pers;
  const gdp = nationGdp(s, id);
  const options = ['defensive', 'economic'];
  const weights = [1 + p.caution, 1 + p.economy];
  if (gdp > 50) { options.push('regional'); weights.push(0.4 + p.expansion * 1.6 + p.aggression); }
  if (gdp > 1500) { options.push('global'); weights.push(0.3 + p.expansion + p.diplomacy * 0.5); }
  n.ai.ambition = r.weighted(options, weights);
  // rival: least liked significant neighbour or power
  let worst = null, wv = 15;
  for (const other of Object.keys(s.nations)) {
    if (other === id) continue;
    const v = -(s.rel[`${id}>${other}`] || 0) + (TERR[id].nb.includes(other) ? 5 : 0);
    if (v > wv) { wv = v; worst = other; }
  }
  n.ai.rival = worst;
}
