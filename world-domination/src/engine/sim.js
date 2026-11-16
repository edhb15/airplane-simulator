// Main simulation clock: days, weeks and months.
import { TERR_IDS } from './world.js';
import { aliveIds, topOverlord, owned, news, nationPop, nationGdp, realm, subjectsOf, markDirty } from './state.js';
import { economyMonth, nationScore } from './economy.js';
import { combatWeek, updatePower, convPower } from './military.js';
import { diplomacyMonth } from './diplomacy.js';
import { intelMonth } from './intel.js';
import { eventsMonth } from './events.js';
import { aiMonth, aiUltimatums } from './ai.js';

const slotCache = {};
function slotOf(id) {
  if (slotCache[id] === undefined) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
    slotCache[id] = h % 30;
  }
  return slotCache[id];
}

export function advanceDay(s) {
  if (s.outcome && !s.continued) return;
  s.day += 1;
  if (s.day % 7 === 0) combatWeek(s);
  if (s.day % 30 === 0) monthTick(s);
  const slot = s.day % 30;
  for (const id of aliveIds(s)) if (slotOf(id) === slot) aiMonth(s, id);
}

export function monthTick(s) {
  updatePower(s);
  economyMonth(s);
  updatePower(s);
  diplomacyMonth(s);
  intelMonth(s);
  eventsMonth(s);
  aiUltimatums(s);
  recordHistory(s);
  checkVictory(s);
  markDirty(s);
}

// Share of the world under the player's control or influence
export function domination(s, nid = s.player) {
  let terr = 0, pop = 0, gdp = 0, totPop = 0, totGdp = 0;
  for (const id of TERR_IDS) {
    const t = s.terr[id];
    totPop += t.pop; totGdp += t.gdp;
    if (s.nations[t.owner]?.alive && topOverlord(s, t.owner) === nid) { terr++; pop += t.pop; gdp += t.gdp; }
  }
  return { terr: terr / TERR_IDS.length, terrCount: terr, total: TERR_IDS.length, pop: pop / totPop, gdp: gdp / totGdp };
}

const MILESTONES = [
  [0.05, 'Regional Power', 'Your realm spans 5% of the world.'],
  [0.1, 'Great Power', 'A tenth of the world answers to you.'],
  [0.25, 'Superpower', 'A quarter of the planet flies your flag.'],
  [0.5, 'Hegemon', 'Half the world is yours. The rest is terrified.'],
  [0.75, 'World Empire', 'Three quarters of humanity lives under your rule.'],
  [0.9, 'Master of the Earth', 'Only scattered holdouts remain.'],
];

export function checkVictory(s) {
  const P = s.nations[s.player];
  if (!P?.alive) {
    if (!s.outcome) s.outcome = { type: 'defeat', reason: `${P.name} has fallen.`, day: s.day };
    return;
  }
  const d = domination(s);
  for (const [th, name, desc] of MILESTONES) {
    if (d.terr >= th && !s.history.milestones.some((m) => m.name === name)) {
      s.history.milestones.push({ name, day: s.day, desc });
      news(s, `🏆 Milestone reached: ${name}! ${desc}`, { type: 'good', player: true });
      s.alerts.push({ day: s.day, text: `🏆 ${name}: ${desc}`, type: 'milestone' });
    }
  }
  if (d.terrCount >= d.total && !s.outcome) {
    s.outcome = { type: 'victory', reason: 'Every nation on Earth is under your control or influence.', day: s.day };
    news(s, `👑 ${P.name} has achieved total WORLD DOMINATION!`, { type: 'major', player: true });
  }
}

export function leaderboard(s) {
  const rows = [];
  for (const id of aliveIds(s)) {
    const n = s.nations[id];
    if (n.overlord) continue;
    const members = realm(s, id);
    let gdp = 0, pop = 0, power = 0, terr = 0;
    for (const m of members) {
      gdp += s.nations[m].stats.gdp || 0;
      pop += s.nations[m].stats.pop || 0;
      power += s.nations[m].stats.power || 0;
      terr += owned(s, m).length;
    }
    rows.push({ id, gdp, pop, power, terr, subjects: members.length - 1, score: Math.round(gdp / 50 + power / 4 + terr * 6 + n.techs.length * 2) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

function recordHistory(s) {
  const P = s.nations[s.player];
  if (!P) return;
  const d = domination(s);
  s.history.player.push({
    d: s.day, gdp: Math.round(P.stats.gdp || 0), pop: +(P.stats.pop || 0).toFixed(1), power: Math.round(P.stats.power || 0),
    terr: d.terrCount, dom: +(d.terr * 100).toFixed(1), treasury: Math.round(P.treasury), debt: Math.round(P.debt),
    stab: Math.round(P.stability), army: Math.round(P.army), techs: P.techs.length,
  });
  if (s.history.player.length > 1200) s.history.player.splice(0, s.history.player.length - 1200);
  if (Math.floor(s.day / 30) % 3 === 0) {
    const top = leaderboard(s).slice(0, 10).map((r) => [r.id, r.score]);
    s.history.top.push({ d: s.day, top });
    if (s.history.top.length > 400) s.history.top.shift();
  }
}
