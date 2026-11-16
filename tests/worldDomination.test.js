import { describe, it, expect } from 'vitest';
import { newGame } from '../world-domination/src/engine/setup.js';
import { advanceDay, domination } from '../world-domination/src/engine/sim.js';
import { aliveIds, owned, atWar } from '../world-domination/src/engine/state.js';
import { serialize, deserialize } from '../world-domination/src/engine/save.js';
import { evaluate } from '../world-domination/src/engine/diplomacy.js';
import { budgetOf, availableTechs } from '../world-domination/src/engine/economy.js';
import * as A from '../world-domination/src/engine/actions.js';
import { makePeace } from '../world-domination/src/engine/military.js';
import { TERRITORIES } from '../world-domination/src/engine/world.js';

function finiteState(s) {
  const bad = [];
  for (const n of Object.values(s.nations)) {
    for (const k of ['treasury', 'debt', 'army', 'navy', 'air', 'missiles', 'stability', 'approval', 'pc', 'infamy', 'readiness']) {
      if (!Number.isFinite(n[k])) bad.push(`${n.id}.${k}=${n[k]}`);
    }
  }
  for (const t of Object.values(s.terr)) {
    for (const k of ['gdp', 'pop', 'unrest', 'integ', 'devast', 'infra']) if (!Number.isFinite(t[k])) bad.push(`${t.id}.${k}=${t[k]}`);
  }
  return bad;
}

describe('WORLD DOMINATION world setup', () => {
  it('creates every nation and territory with sane numbers', () => {
    const s = newGame({ player: 'USA', seed: 'unit', difficulty: 'normal' });
    expect(TERRITORIES.length).toBeGreaterThan(200);
    expect(aliveIds(s).length).toBeGreaterThan(190);
    expect(finiteState(s)).toEqual([]);
    expect(s.nations.USA.stats.gdp).toBeGreaterThan(20000);
    expect(s.nations.USA.nukes).toBeGreaterThan(0);
    expect(owned(s, 'DNK')).toContain('GRL');
    expect(s.blocs.find((b) => b.id === 'NATO').members).toContain('POL');
    // starting budgets roughly balance so the player isn't instantly broke
    const b = budgetOf(s, 'FRA');
    expect(b.balance).toBeGreaterThan(-b.gdp * 0.02);
  });

  it('shuffled worlds differ by seed', () => {
    const a = newGame({ player: 'BRA', seed: 'one', worldMode: 'shuffled' });
    const b = newGame({ player: 'BRA', seed: 'two', worldMode: 'shuffled' });
    expect(a.nations.CHN.leader.name === b.nations.CHN.leader.name && a.nations.CHN.army === b.nations.CHN.army).toBe(false);
  });
});

describe('WORLD DOMINATION simulation', () => {
  it('runs five years of AI-driven history without breaking', () => {
    const s = newGame({ player: 'IND', seed: 'history', difficulty: 'hard' });
    const seen = new Set();
    for (let d = 0; d < 360 * 5; d++) {
      advanceDay(s);
      s.pending = [];
      for (const w of s.wars) seen.add(w.id);
    }
    expect(finiteState(s)).toEqual([]);
    expect(seen.size).toBeGreaterThan(2);
    expect(aliveIds(s).length).toBeGreaterThan(150);
    expect(s.history.player.length).toBeGreaterThan(50);
    expect(s.news.length).toBeGreaterThan(50);
  }, 60000);

  it('saves and loads without losing anything', () => {
    const s = newGame({ player: 'JPN', seed: 'save' });
    for (let d = 0; d < 400; d++) advanceDay(s);
    const copy = deserialize(serialize(s));
    expect(JSON.parse(serialize(copy))).toEqual(JSON.parse(serialize(s)));
    for (let d = 0; d < 100; d++) advanceDay(copy);
    expect(copy.day).toBe(500);
    expect(finiteState(copy)).toEqual([]);
  }, 30000);
});

describe('WORLD DOMINATION player actions', () => {
  it('lets the player conquer a neighbour and annex it', () => {
    const s = newGame({ player: 'RUS', seed: 'war' });
    const r = A.declareWarOn(s, 'GEO');
    expect(r.ok).toBe(true);
    expect(atWar(s, 'RUS', 'GEO')).toBe(true);
    const off = A.offensive(s, 'GEO', 60);
    expect(off.ok).toBe(true);
    let dictated = false;
    for (let d = 0; d < 360 && !dictated; d++) {
      advanceDay(s);
      const p = s.pending.find((x) => x.kind === 'dictate');
      if (p) {
        const w = s.wars.find((x) => x.id === p.war);
        makePeace(s, w, 'RUS', 'GEO', { annex: ['GEO'] });
        dictated = true;
      }
      s.pending = s.pending.filter((x) => x.kind === 'dictate');
    }
    expect(dictated).toBe(true);
    expect(s.terr.GEO.owner).toBe('RUS');
    expect(s.nations.GEO.alive).toBe(false);
    expect(s.nations.RUS.infamy).toBeGreaterThan(10);
    expect(domination(s).terrCount).toBe(owned(s, 'RUS').length);
  });

  it('explains every diplomatic verdict', () => {
    const s = newGame({ player: 'DEU', seed: 'diplo' });
    const ev = evaluate(s, 'DEU', 'FRA', 'trade');
    expect(ev.parts.length).toBeGreaterThan(1);
    expect(typeof ev.accept).toBe('boolean');
    const cur = s.nations.DEU.pc;
    const res = A.propose(s, 'FRA', 'research');
    expect(s.nations.DEU.pc).toBeLessThan(cur);
    expect(typeof res.ok).toBe('boolean');
  });

  it('runs covert operations, construction and research', () => {
    const s = newGame({ player: 'CHN', seed: 'ops' });
    s.nations.CHN.treasury = 500;
    expect(A.covertOp(s, 'TWN', 'network').msg).toBeTruthy();
    expect(A.build(s, 'CHN', 'labs').ok).toBe(true);
    const tech = availableTechs(s, 'CHN')[0];
    expect(A.research(s, tech.id).ok).toBe(true);
    expect(s.nations.CHN.research.id).toBe(tech.id);
    expect(A.recruit(s, 'army', 5).ok).toBe(true);
  });
});
