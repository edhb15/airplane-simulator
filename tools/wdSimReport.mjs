// Headless WORLD DOMINATION run for balancing: npx vite-node tools/wdSimReport.mjs [years] [player] [seed] [mode]
import { newGame } from '../world-domination/src/engine/setup.js';
import { advanceDay, domination, leaderboard } from '../world-domination/src/engine/sim.js';
import { aliveIds, fmtDate } from '../world-domination/src/engine/state.js';

const years = +(process.argv[2] || 20);
const player = process.argv[3] || 'FRA';
const s = newGame({ player, seed: process.argv[4] || 'test', difficulty: 'normal', worldMode: process.argv[5] || 'realistic' });
const t0 = Date.now();
let wars = 0;
const seen = new Set();
for (let d = 0; d < years * 360; d++) {
  advanceDay(s);
  s.pending = [];
  for (const w of s.wars) if (!seen.has(w.id)) { seen.add(w.id); wars++; }
  if (d % 1800 === 1799) {
    const lb = leaderboard(s).slice(0, 8).map((r) => `${r.id}:${r.score}(${r.terr}t,${r.subjects}s)`).join(' ');
    console.log(fmtDate(s), `alive=${aliveIds(s).length} wars=${s.wars.length} totalWars=${wars} coalitions=${s.coalitions.length} nukes=${s.world.nukesUsed}`);
    console.log('   top:', lb);
    const P = s.nations[player];
    console.log(`   player ${player}: gdp=${P.stats.gdp?.toFixed(0)} treasury=${P.treasury.toFixed(0)} debt=${P.debt.toFixed(0)} stab=${P.stability.toFixed(0)} army=${P.army.toFixed(1)} navy=${P.navy.toFixed(1)} air=${P.air.toFixed(1)} techs=${P.techs.length} pow=${P.stats.power?.toFixed(0)}`);
  }
}
let bad = [];
for (const id of Object.keys(s.nations)) {
  const n = s.nations[id];
  for (const k of ['treasury', 'debt', 'army', 'navy', 'air', 'stability', 'pc']) if (!Number.isFinite(n[k])) bad.push(id + '.' + k);
}
for (const t of Object.values(s.terr)) for (const k of ['gdp', 'pop', 'unrest', 'integ']) if (!Number.isFinite(t[k])) bad.push(t.id + '.' + k);
console.log('NaN check:', bad.slice(0, 20));
console.log('time', Date.now() - t0, 'ms; news sample:');
console.log(s.news.slice(0, 25).map((n) => fmtDate(s, n.day) + ' ' + n.text).join('\n'));
const debt = Object.values(s.nations).filter((n) => n.alive && n.stats.gdp > 200).map((n) => `${n.id}:${(n.debt / n.stats.gdp).toFixed(2)}/${n.tax}%/s${n.stability.toFixed(0)}`);
console.log('debt ratios:', debt.join(' '));
console.log('treaties', s.treaties.length, 'blocs', s.blocs.map((b) => b.id + ':' + b.members.length).join(' '));
