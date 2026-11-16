// AI leaders: budgets, war, peace, diplomacy, spheres of influence and ambitions.
import { TERR, distance } from './world.js';
import { DIFFICULTY } from './config.js';
import {
  clamp, rng, owned, controlled, opinion, trust, hasTreaty, news, nameOf, atWar, warsOf, enemySide, friendSide,
  borders, neighborsOf, aliveIds, subjectsOf, topOverlord, defenders, allied, capitalOf, proximity, enemiesOf,
  addOpinion, hasTech, blocsOf, sameBloc, monthMemo,
} from './state.js';
import {
  convPower, freeArmy, canAttack, launchOffensive, defenseStrength, qLand, territoryValue, warScore, aiTerms,
  peaceAcceptance, makePeace, declareWar, capitulated, nukeStrike, missileStrike, reach, hasClaim, navalRange,
} from './military.js';
import { evaluate, signTreaty, breakTreaty, addInfluence, influence, protectorate, joinBloc, TREATY_INFO } from './diplomacy.js';
import { runOp, canRunOp, network } from './intel.js';
import { manpowerCap, MOBIL } from './economy.js';

const realmPower = (s, nid) => convPower(s, nid) + subjectsOf(s, nid).reduce((a, x) => a + convPower(s, x) * 0.7, 0);

// The handful of nations that matter to everyone: the strongest militaries
export function greatPowers(s) {
  return monthMemo(s, 'greatPowers', () => [...aliveIds(s)].sort((a, b) => convPower(s, b) - convPower(s, a)).slice(0, 15));
}
export function threatLevel(s, nid) {
  let worst = 0;
  const mine = convPower(s, nid) + 1;
  const pool = new Set([...neighborsOf(s, nid), ...greatPowers(s), ...enemiesOf(s, nid)]);
  for (const o of pool) {
    if (o === nid || allied(s, nid, o)) continue;
    const op = opinion(s, nid, o);
    if (op > 0 && !atWar(s, nid, o)) continue;
    const prox = proximity(s, nid, o);
    if (prox < 0.3 && !atWar(s, nid, o)) continue;
    const v = ((convPower(s, o) + 1) / mine) * prox * (atWar(s, nid, o) ? 2 : (-op + 20) / 100);
    if (v > worst) worst = v;
  }
  return clamp(worst, 0, 5);
}

export function aiMonth(s, nid) {
  const n = s.nations[nid];
  if (!n.alive || nid === s.player) return;
  aiBudget(s, nid);
  if (n.overlord) { aiSubject(s, nid); return; }
  if (warsOf(s, nid).length) aiWar(s, nid);
  aiDiplomacy(s, nid);
  aiConsiderWar(s, nid);
}

function aiBudget(s, nid) {
  const n = s.nations[nid];
  const p = n.pers;
  const atWarNow = warsOf(s, nid).length > 0;
  const threat = threatLevel(s, nid);
  const gdp = n.stats.gdp || 1;
  const bal = n.stats.budget?.balance ?? 0;
  const debtRatio = n.debt / gdp;
  let milTarget = 1.2 + p.paranoia * 2 + p.aggression * 2.2 + Math.min(4, threat * 1.6) + (atWarNow ? 5 : 0) + (n.ai.ambition === 'regional' ? 1 : 0);
  if (debtRatio > 1.2 && !atWarNow) milTarget *= 0.8;
  const upkeepPct = ((n.stats.upkeep || 0) / gdp) * 100;
  if (atWarNow) milTarget = Math.max(milTarget, upkeepPct * 1.05);
  milTarget = clamp(milTarget, 0.5, atWarNow ? 25 : 10);
  n.budget.mil += (milTarget - n.budget.mil) * 0.25;
  const gdppc = n.stats.gdppc || 5000;
  const resTarget = clamp((gdppc > 30000 ? 1.8 : gdppc > 10000 ? 1.1 : 0.5) + p.science * 1.5, 0.2, 5);
  n.budget.res += (resTarget - n.budget.res) * 0.2;
  const welfareCap = gdppc > 30000 ? 16 : gdppc > 10000 ? 11 : 7;
  if (n.approval < 40 && bal > -gdp * 0.03) n.budget.welfare = clamp(n.budget.welfare + 0.3, 1, welfareCap);
  else if ((n.approval > 65 && bal < 0) || n.budget.welfare > welfareCap) n.budget.welfare = clamp(n.budget.welfare - 0.3, 1, 25);
  // Taxes balance the books
  const balPct = (bal / gdp) * 100;
  if (balPct < -2 || (debtRatio > 1.5 && balPct < 0)) {
    // Cut spending before squeezing taxpayers further
    if (n.tax > 40 && n.budget.mil > 2 && !atWarNow) n.budget.mil -= 0.3;
    else n.tax = clamp(n.tax + 1, 8, 55);
  } else if (balPct > 1.5 && (n.approval < 60 || n.tax > 35)) n.tax = clamp(n.tax - 1, 8, 55);
  if (n.treasury < 0.01 && balPct < -6) { n.budget.infra = clamp(n.budget.infra - 0.5, 0.5, 8); n.budget.welfare = clamp(n.budget.welfare - 0.3, 1, 25); }
  // Procurement mix
  const coastal = owned(s, nid).some((t) => TERR[t].coastal);
  const island = owned(s, nid).every((t) => TERR[t].nb.length === 0 || TERR[t].nb.every((x) => s.terr[x].owner === nid));
  n.mix.navy = coastal ? (island ? 35 : 15 + p.expansion * 15) : 0;
  n.mix.army = island ? 25 : 45;
  n.mix.air = 25 + p.paranoia * 10;
  n.mix.missile = hasTech(s, nid, 'str1') ? 8 + p.paranoia * 10 : 0;
  // Mobilization
  if (atWarNow) {
    const losing = warsOf(s, nid).some((w) => warScore(s, w, nid, enemySide(w, nid)[0]) < -20);
    n.mobil = losing ? 2 : Math.max(n.mobil, 1);
  } else if (n.mobil > 0 && s.day - n.ai.lastWar > 180) n.mobil = threat > 1.5 ? 1 : 0;
  // Nuclear program
  if (hasTech(s, nid, 'str2') && n.nukeBuild <= 0 && n.nukes < 3 + p.paranoia * 10 && n.treasury > 30 && rng(s).chance(0.05)) {
    n.treasury -= 25; n.nukeBuild = 12;
  }
}

function aiSubject(s, nid) {
  const n = s.nations[nid];
  const lord = s.nations[n.overlord];
  const r = rng(s);
  if (n.liberty > 72 && r.chance(n.liberty > 88 || warsOf(s, n.overlord).length ? 0.12 : 0.03)) {
    const lordId = n.overlord;
    n.overlord = null;
    const war = declareWar(s, nid, lordId, { independence: true, cb: 'War of Independence' });
    war.name = `${n.name} War of Independence`;
    news(s, `🔥 ${n.name} rises up against ${lord.name} and declares independence!`, { type: 'major', nations: [nid, lordId] });
  }
}

// ---------- War conduct ----------
function aiWar(s, nid) {
  const n = s.nations[nid];
  const r = rng(s);
  const reserveFrac = 0.25 + n.pers.caution * 0.25;
  let free = freeArmy(s, nid) - n.army * reserveFrac;
  // Launch offensives against the best-value, weakest targets
  const targets = [];
  for (const w of warsOf(s, nid)) {
    for (const e of enemySide(w, nid)) {
      for (const tid of controlled(s, e)) {
        const chk = canAttack(s, nid, tid);
        if (!chk.ok) continue;
        const { d } = defenseStrength(s, tid, nid);
        const homeland = s.terr[tid].owner === nid || friendSide(w, nid).includes(s.terr[tid].owner);
        targets.push({ tid, d, score: (territoryValue(s, tid) * (homeland ? 3 : 1) * (s.terr[tid].core === e && capitalOf(s, e) === tid ? 1.5 : 1)) / (d + 1), mode: chk.mode });
      }
    }
  }
  targets.sort((a, b) => b.score - a.score);
  for (const t of targets.slice(0, 4)) {
    if (free < 0.5) break;
    const q = qLand(s, nid) * n.readiness * (t.mode === 'naval' ? 0.5 : 1);
    const need = (t.d / Math.max(0.1, q)) * 1.6 + 0.5;
    const divs = Math.min(free, need);
    if (divs < need * 0.55 && t.d > 2) continue;
    const res = launchOffensive(s, nid, t.tid, divs);
    if (res.ok) free -= divs;
  }
  // Missiles
  if (n.missiles >= 3 && hasTech(s, nid, 'str1') && r.chance(0.35)) {
    const enemyTargets = [];
    for (const w of warsOf(s, nid)) for (const o of w.offs) if (o.by === nid) enemyTargets.push(o.target);
    if (enemyTargets.length) missileStrike(s, nid, r.pick(enemyTargets), Math.ceil(n.missiles * 0.4));
  }
  // Nuclear first use: only when facing annihilation, and only the most ruthless
  if (n.nukes >= 1 && hasTech(s, nid, 'str2')) {
    const cap = capitalOf(s, nid);
    const desperate = cap && s.terr[cap].ctrl !== nid;
    if (desperate && n.pers.aggression + (1 - n.pers.caution) > 1.1 && r.chance(0.2 * DIFFICULTY[s.difficulty].aiAggro)) {
      const enemy = s.terr[cap].ctrl;
      const tgt = capitalOf(s, enemy);
      if (tgt) nukeStrike(s, nid, cap === tgt ? cap : r.chance(0.5) ? tgt : cap);
    }
  }
  // Peace
  for (const w of warsOf(s, nid)) {
    if (!s.wars.includes(w)) continue;
    const leader = w.attLead === nid || w.defLead === nid;
    for (const e of [...enemySide(w, nid)]) {
      if (!s.wars.includes(w) || !enemySide(w, nid).includes(e)) continue;
      const enemyLeader = e === w.attLead || e === w.defLead;
      if (!leader && !enemyLeader) continue;
      const score = warScore(s, w, nid, e);
      const age = s.day - w.start;
      if (score >= 25 || (score > 8 && age > 720)) {
        const terms = aiTerms(s, w, nid, e);
        if (e === s.player) {
          offerToPlayer(s, { kind: 'peaceDemand', war: w.id, from: nid, terms });
        } else if (peaceAcceptance(s, w, nid, e, terms).accept) {
          makePeace(s, w, nid, e, terms);
        }
      } else if ((score <= -25 && n.warEx > 30) || (Math.abs(score) < 15 && age > 900 && n.warEx > 45)) {
        // Sue for peace: offer what the enemy currently holds
        if (e === s.player) {
          const give = score <= -40 ? owned(s, nid).filter((t) => s.terr[t].ctrl === e) : [];
          offerToPlayer(s, { kind: 'peaceOffer', war: w.id, from: nid, terms: { annex: give, reparations: score <= -55 } });
        } else {
          const terms = aiTerms(s, w, e, nid);
          const E = s.nations[e];
          if (warScore(s, w, e, nid) < 30 || E.warEx > 40 || r.chance(0.3)) makePeace(s, w, e, nid, terms);
        }
      }
    }
  }
}

function offerToPlayer(s, offer) {
  const key = `offer:${offer.kind}:${offer.from}`;
  if ((s.flags[key] || -999) > s.day - 150) return;
  if (offer.kind === 'proposal') {
    // Only nations that matter to us bother the player, and not too often
    const F = s.nations[offer.from];
    if ((s.flags.lastProposal || -999) > s.day - 120) return;
    if ((F.stats.gdp || 0) < 60 && !borders(s, offer.from, s.player)) return;
    s.flags.lastProposal = s.day;
  }
  if (s.pending.some((p) => p.kind === offer.kind && p.from === offer.from)) return;
  s.flags[key] = s.day;
  s.pending.push({ ...offer, day: s.day });
}

// ---------- Diplomacy ----------
function aiDiplomacy(s, nid) {
  const n = s.nations[nid];
  const r = rng(s);
  const p = n.pers;
  const gdp = n.stats.gdp || 0;
  // Treaties
  if (r.chance(0.18 + p.diplomacy * 0.2)) {
    const pool = r.chance(0.5) ? neighborsOf(s, nid) : r.chance(0.5) ? greatPowers(s) : aliveIds(s);
    const cands = pool.filter((x) => x !== nid && !s.nations[x].overlord && !atWar(s, nid, x));
    const target = r.pick(cands);
    const count = (type) => s.treaties.filter((t) => t.type === type && (t.a === nid || t.b === nid)).length;
    if (target) {
      const op = opinion(s, nid, target);
      let kind = null;
      if (op > 10 && !hasTreaty(s, nid, target, 'trade') && count('trade') < 4 + gdp / 1500) kind = 'trade';
      else if (op > 35 && !hasTreaty(s, nid, target, 'defense') && proximity(s, nid, target) > 0.35 && threatLevel(s, nid) > 0.6 && count('defense') < 3) kind = 'defense';
      else if (op > 20 && !hasTreaty(s, nid, target, 'research') && p.science > 0.5 && count('research') < 2) kind = 'research';
      else if (op > -20 && borders(s, nid, target) && !hasTreaty(s, nid, target, 'nap') && p.caution > 0.55 && count('nap') < 3) kind = 'nap';
      if (kind) {
        if (target === s.player) {
          if (r.chance(0.35)) offerToPlayer(s, { kind: 'proposal', treaty: kind, from: nid });
        } else if (evaluate(s, nid, target, kind).accept) signTreaty(s, kind, nid, target);
      }
    }
  }
  // Break treaties with nations we've come to hate
  if (r.chance(0.08)) {
    for (const t of s.treaties) {
      if (t.a !== nid && t.b !== nid) continue;
      const other = t.a === nid ? t.b : t.a;
      if (opinion(s, nid, other) < -35 - p.honor * 30 && t.type !== 'guarantee') { breakTreaty(s, t.type, nid, other); break; }
    }
  }
  // Spheres of influence: big powers court their smaller neighbours
  if (gdp > 600 && (n.ai.ambition === 'global' || n.ai.ambition === 'regional' || n.ai.ambition === 'economic') && n.pc > 20 && r.chance(0.5)) {
    const pool = aliveIds(s).filter((x) => x !== nid && !s.nations[x].overlord && (s.nations[x].stats.gdp || 0) < gdp / 6
      && (proximity(s, nid, x) > 0.45 || n.ai.ambition === 'global') && !atWar(s, nid, x));
    if (pool.length) {
      const t = pool.reduce((a, b) => (influence(s, nid, a) * 1.5 + opinion(s, a, nid) > influence(s, nid, b) * 1.5 + opinion(s, b, nid) ? a : b));
      addInfluence(s, nid, t, 1.5 + p.diplomacy * 2);
      n.pc -= 8;
      const subs = subjectsOf(s, nid).length;
      const allowed = 1 + Math.floor(s.day / 1440) + (n.ai.ambition === 'global' ? 2 : 0);
      if (subs < allowed && influence(s, nid, t) > 75 && evaluate(s, nid, t, 'protectorate').accept && r.chance(0.12)) protectorate(s, nid, t);
    }
  }
  // Bloc leaders recruit
  for (const b of s.blocs) {
    if (b.leader !== nid || !r.chance(0.1)) continue;
    const cand = neighborsOf(s, nid).concat(aliveIds(s).filter((x) => opinion(s, nid, x) > 40)).filter((x) => !b.members.includes(x) && !s.nations[x].overlord && x !== s.player && proximity(s, nid, x) > 0.45);
    const t = r.pick(cand);
    if (t && opinion(s, nid, t) > 15 && evaluate(s, nid, t, 'joinBloc', { bloc: b.id }).accept) joinBloc(s, b.id, t);
  }
  // Leave blocs whose leader we despise
  for (const b of blocsOf(s, nid)) {
    if (b.leader !== nid && opinion(s, nid, b.leader) < -40 && r.chance(0.2)) {
      b.members = b.members.filter((m) => m !== nid);
      news(s, `${n.name} quits ${b.name} in protest.`, { nations: [nid, b.leader] });
      if (b.members.length < 2) s.blocs = s.blocs.filter((x) => x !== b);
    }
  }
  // Espionage against rivals
  if (p.paranoia + p.aggression > 0.7 && r.chance(0.12)) {
    const rival = n.ai.rival && s.nations[n.ai.rival]?.alive ? n.ai.rival : null;
    if (rival) {
      const ops = ['network', 'network', 'propaganda', 'steal', 'destabilize', 'claim', 'sabotage'];
      const op = r.pick(ops);
      if (canRunOp(s, nid, rival, op).ok) runOp(s, nid, rival, op);
      else if (canRunOp(s, nid, rival, 'network').ok) runOp(s, nid, rival, 'network');
    }
  }
}

// ---------- Going to war ----------
function aiConsiderWar(s, nid) {
  const n = s.nations[nid];
  const r = rng(s);
  const p = n.pers;
  const d = DIFFICULTY[s.difficulty];
  if (warsOf(s, nid).length > (p.aggression > 0.6 ? 1 : 0)) return;
  if (s.day - n.ai.lastWar < 360 * (1.5 - p.aggression)) return;
  if (n.stability < 25 || n.warEx > 30) return;
  const appetite = (0.15 + p.aggression * 1.1 + p.expansion * 0.8 + (n.ai.ambition === 'regional' ? 0.3 : 0) + (n.ai.ambition === 'global' ? 0.2 : 0)) * d.aiAggro;
  // ~6%/yr for a placid leader, ~45%/yr for a warmonger
  if (!r.chance(0.004 + appetite * 0.012)) return;
  const my = realmPower(s, nid);
  const cands = new Set(neighborsOf(s, nid).map((x) => topOverlord(s, x)));
  if (n.ai.rival && s.nations[n.ai.rival]?.alive) cands.add(topOverlord(s, n.ai.rival));
  if (n.navy > 20) {
    for (const x of aliveIds(s)) {
      const cap = capitalOf(s, x);
      const myCap = capitalOf(s, nid);
      if (cap && myCap && distance(cap, myCap) < navalRange(s, nid) && TERR[cap].coastal) cands.add(topOverlord(s, x));
    }
  }
  // The player draws extra attention as their infamy grows (after an opening grace period)
  const grace = s.day < d.grace && s.nations[s.player]?.infamy < 15;
  if (grace) cands.delete(s.player);
  else if (s.nations[s.player]?.alive && (borders(s, nid, s.player) || proximity(s, nid, s.player) > 0.6)) cands.add(s.player);
  let best = null, bestScore = 0;
  for (const c of cands) {
    if (c === nid || !s.nations[c]?.alive || allied(s, nid, c) || atWar(s, nid, c)) continue;
    if (grace && topOverlord(s, c) === s.player) continue;
    if (hasTreaty(s, nid, c, 'nap') && p.honor > 0.35) continue;
    const C = s.nations[c];
    const op = opinion(s, nid, c);
    if (op > 25) continue;
    const allies = defenders(s, c);
    let theirs = realmPower(s, c);
    for (const a of allies) theirs += convPower(s, a) * (0.4 + 0.4 * proximity(s, a, c));
    const ratio = my / Math.max(1, theirs);
    const need = clamp(1.9 - p.aggression * 0.7 - p.expansion * 0.3, 1.1, 2.2);
    if (ratio < need) continue;
    // Nuclear deterrence
    const nukeSide = C.nukes > 0 || allies.some((a) => s.nations[a].nukes > 0);
    if (nukeSide && !(n.nukes > 0 && p.aggression > 0.7) && p.caution > 0.2) continue;
    // Must be able to reach them
    if (!owned(s, c).some((t) => reach(s, nid, t))) continue;
    let score = Math.sqrt(owned(s, c).reduce((a, t) => a + territoryValue(s, t), 0)) * Math.min(3, ratio / need);
    score *= 1 + Math.max(0, -op) / 60;
    if (hasClaim(s, nid, c)) score *= 1.6;
    if (c === n.ai.rival) score *= 1.5;
    if (c === s.player) score *= 1 + s.nations[s.player].infamy / 60;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return;
  // Honorable leaders want a pretext first
  if (!hasClaim(s, nid, best) && p.honor > 0.55) {
    if (canRunOp(s, nid, best, 'claim').ok) runOp(s, nid, best, 'claim');
    else if (canRunOp(s, nid, best, 'network').ok) runOp(s, nid, best, 'network');
    return;
  }
  n.ai.lastWar = s.day;
  declareWar(s, nid, best);
}

// Occasional AI ultimatums to the player
export function aiUltimatums(s) {
  const r = rng(s);
  const P = s.nations[s.player];
  if (!P?.alive || !r.chance(0.03)) return;
  for (const nb of neighborsOf(s, s.player)) {
    const N = s.nations[nb];
    if (!N.alive || N.overlord || atWar(s, nb, s.player) || allied(s, nb, s.player)) continue;
    if (realmPower(s, nb) > realmPower(s, s.player) * 2.5 && N.pers.aggression > 0.5 && opinion(s, nb, s.player) < -10) {
      const border = owned(s, s.player).filter((t) => TERR[t].nb.some((x) => s.terr[x].owner === nb));
      if (!border.length) continue;
      const tid = border.reduce((a, b) => (territoryValue(s, a) < territoryValue(s, b) ? a : b));
      offerToPlayer(s, { kind: 'ultimatum', from: nb, terr: tid });
      return;
    }
  }
}
