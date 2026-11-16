// Map modes (what the colors mean), nation labels and the war overlay.
import { TERRITORIES, TERR } from '../engine/world.js';
import { GOVS } from '../data/people.js';
import { RESOURCES } from '../engine/economy.js';
import { opinion, topOverlord, owned, aliveIds, atWar, allied, enemiesOf } from '../engine/state.js';
import { topInfluencer, influence } from '../engine/diplomacy.js';
import { scale, mixColor, opinionColor } from './fmt.js';

const NEUTRAL = '#3a4250';
const RED_GREEN = ['#d73a49', '#e36209', '#9aa4ad', '#7cb342', '#2ea043'];
const HEAT = ['#1f3a5f', '#2c6e8f', '#43a37f', '#b8c23a', '#f0b429', '#e8590c'];

export const MAP_MODES = {
  political: { name: 'Political', icon: '🗺️', key: 'Q' },
  diplomacy: { name: 'Relations', icon: '🤝', key: 'W' },
  alliances: { name: 'Alliances', icon: '🛡️', key: 'E' },
  spheres: { name: 'Spheres', icon: '🌐', key: 'R' },
  economy: { name: 'Wealth', icon: '💰', key: 'T' },
  military: { name: 'Military', icon: '⚔️', key: 'Y' },
  stability: { name: 'Stability', icon: '⚖️', key: 'U' },
  government: { name: 'Government', icon: '🏛️', key: 'I' },
  resources: { name: 'Resources', icon: '⛏️', key: 'O' },
  unrest: { name: 'Unrest', icon: '🔥', key: 'P' },
};

export function colorFor(s, mode, tid, opts = {}) {
  const t = s.terr[tid];
  const owner = s.nations[t.owner];
  const ctrl = s.nations[t.ctrl];
  const P = s.player;
  const occ = t.ctrl !== t.owner ? ctrl?.color : null;
  const wrap = (fill) => (occ && mode !== 'resources' ? { fill, hatch: occ } : fill);
  switch (mode) {
    case 'political': {
      if (!owner?.alive) return NEUTRAL;
      // subjects show in a tint of their overlord's colour
      const top = topOverlord(s, t.owner);
      const base = top !== t.owner ? mixColor(s.nations[top].color, owner.color, 0.35) : owner.color;
      return wrap(base);
    }
    case 'diplomacy': {
      const top = topOverlord(s, t.owner);
      if (top === P) return wrap('#e6c84a');
      if (atWar(s, P, t.owner)) return wrap('#b31d28');
      if (allied(s, P, t.owner)) return wrap('#2f81f7');
      const v = opinion(s, t.owner, P);
      return wrap(scale((v + 100) / 200, RED_GREEN));
    }
    case 'alliances': {
      const top = topOverlord(s, t.owner);
      const bloc = s.blocs.find((b) => b.type === 'military' && b.members.includes(top));
      if (bloc) return wrap(top === t.owner ? bloc.color : mixColor(bloc.color, '#000000', 0.25));
      const coal = s.coalitions.find((c) => c.members.includes(t.owner));
      if (coal) return wrap('#6e40c9');
      if (top !== t.owner) return wrap(mixColor(s.nations[top].color, '#222222', 0.4));
      return wrap(NEUTRAL);
    }
    case 'spheres': {
      const top = topOverlord(s, t.owner);
      if (top !== t.owner) return wrap(s.nations[top].color);
      const inf = topInfluencer(s, t.owner);
      if (inf && inf.value > 10) return wrap(mixColor(NEUTRAL, s.nations[inf.id].color, Math.min(1, inf.value / 70)));
      return wrap(mixColor(owner.color, NEUTRAL, 0.75));
    }
    case 'economy': {
      const gdppc = t.pop > 0 ? (t.gdp * 1000) / t.pop : 0;
      return wrap(scale(Math.log10(Math.max(500, gdppc) / 500) / 2.4, HEAT));
    }
    case 'military': {
      const p = owner?.stats.power || 0;
      return wrap(scale(Math.log10(1 + p) / 3.4, ['#22303f', '#3b5b7a', '#7a5ba8', '#c94f4f', '#ff7b39']));
    }
    case 'stability':
      return wrap(scale((owner?.stability ?? 50) / 100, RED_GREEN));
    case 'government':
      return wrap(GOVS[owner?.gov]?.color || NEUTRAL);
    case 'resources': {
      const r = opts.resource || 'oil';
      const v = t.res[r] || 0;
      return v > 0 ? scale(Math.min(1, v / 4), ['#3d3420', RESOURCES[r].color === '#1f1f1f' ? '#e0a020' : RESOURCES[r].color]) : '#262c35';
    }
    case 'unrest':
      return wrap(t.unrest > 1 ? scale(t.unrest / 100, ['#2d3b2d', '#b8a02a', '#d9480f', '#ff2d2d']) : '#2b3440');
    default:
      return NEUTRAL;
  }
}

export function legendFor(s, mode, opts = {}) {
  switch (mode) {
    case 'diplomacy': return [['#e6c84a', 'Your realm'], ['#2f81f7', 'Allied'], ['#2ea043', 'Friendly'], ['#9aa4ad', 'Neutral'], ['#e36209', 'Hostile'], ['#b31d28', 'At war']];
    case 'alliances': return s.blocs.filter((b) => b.type === 'military').map((b) => [b.color, b.name]).concat(s.coalitions.length ? [['#6e40c9', 'Coalition member']] : []);
    case 'economy': return [[HEAT[0], 'Poor'], [HEAT[2], 'Middle income'], [HEAT[5], 'Rich']];
    case 'military': return [['#22303f', 'Weak'], ['#7a5ba8', 'Strong'], ['#ff7b39', 'Superpower']];
    case 'stability': return [[RED_GREEN[0], 'Collapsing'], [RED_GREEN[2], 'Shaky'], [RED_GREEN[4], 'Stable']];
    case 'government': return Object.values(GOVS).map((g) => [g.color, g.name]);
    case 'resources': return [[RESOURCES[opts.resource || 'oil'].color === '#1f1f1f' ? '#e0a020' : RESOURCES[opts.resource || 'oil'].color, `${RESOURCES[opts.resource || 'oil'].name} deposits`]];
    case 'unrest': return [['#2b3440', 'Calm'], ['#b8a02a', 'Restless'], ['#ff2d2d', 'Rebellious']];
    case 'spheres': return [['#3a4250', 'Unaligned'], ['#888', 'Tinted by the dominant foreign influence']];
    default: return [];
  }
}

// One label per contiguous block of a nation's land
export function computeLabels(s, map) {
  const labels = [];
  for (const nid of aliveIds(s)) {
    const n = s.nations[nid];
    const list = owned(s, nid);
    if (!list.length) continue;
    const set = new Set(list);
    const seen = new Set();
    let best = null, bestArea = -1, capComp = null;
    const others = [];
    for (const t of list) {
      if (seen.has(t)) continue;
      const comp = [];
      const stack = [t];
      seen.add(t);
      while (stack.length) {
        const x = stack.pop();
        comp.push(x);
        for (const y of TERR[x].nb) if (set.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
      }
      const area = comp.reduce((a, x) => a + TERR[x].area, 0);
      if (comp.includes(n.capital)) capComp = { comp, area };
      others.push({ comp, area });
      if (area > bestArea) { bestArea = area; best = comp; }
    }
    // Label the homeland; big detached lands (Greenland, Alaska-style) get their own name
    if (capComp) { best = capComp.comp; bestArea = capComp.area; }
    for (const o of others) {
      if (o.comp === best || o.area < 250000) continue;
      const main = o.comp.reduce((a, x) => (TERR[x].area > TERR[a].area ? x : a));
      const c = map.centers[main];
      labels.push({ x: c[0], y: c[1], size: Math.max(2.2, Math.min(30, Math.sqrt(o.area) / 70)), text: o.comp.length === 1 ? TERR[main].name : n.name, upper: true, color: 'rgba(225,232,240,0.7)' });
    }
    // weighted centre of the block's main territories
    let sx = 0, sy = 0, sw = 0;
    for (const x of best) {
      const w = TERR[x].area;
      const b = map.bounds[x];
      const cx = map.centers[x][0], cy = map.centers[x][1];
      if (!b) continue;
      sx += cx * w; sy += cy * w; sw += w;
    }
    if (!sw) continue;
    const size = Math.max(2.2, Math.min(42, Math.sqrt(bestArea) / 55));
    const name = n.name.length > 18 && size < 10 ? n.id : n.name;
    labels.push({ x: sx / sw, y: sy / sw, size, text: name, upper: size > 6 });
  }
  return labels;
}

// War fronts, offensives and capitals drawn over the map
export function drawOverlay(s, ctx, map, px, time) {
  const P = s.player;
  const caps = new Set();
  for (const nid of aliveIds(s)) { const c = s.nations[nid].capital; if (c) caps.add(c); }
  // capitals
  for (const c of caps) {
    const p = map.centers[c];
    if (!p || map.view.z < 2.2) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.2 * px, 0, Math.PI * 2);
    ctx.fillStyle = '#f5f5f5';
    ctx.fill();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }
  // offensives
  for (const w of s.wars) {
    const mine = w.att.includes(P) || w.def.includes(P);
    for (const o of w.offs) {
      const a = map.centers[o.from], b = map.centers[o.target];
      if (!a || !b) continue;
      const color = o.by === P ? '#ffd33d' : mine ? '#ff5d5d' : 'rgba(255,140,90,0.8)';
      if (!mine && map.view.z < 1.5) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const cx = mx - (dy / len) * len * 0.18, cy = my + (dx / len) * len * 0.18;
      ctx.save();
      ctx.lineWidth = (mine ? 3 : 2) * px;
      ctx.strokeStyle = color;
      if (o.mode === 'naval') ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineDashOffset = -time * 20 * px;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(cx, cy, b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      // arrow head
      const ang = Math.atan2(b[1] - cy, b[0] - cx);
      const hs = 7 * px;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - hs * Math.cos(ang - 0.45), b[1] - hs * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - hs * Math.cos(ang + 0.45), b[1] - hs * Math.sin(ang + 0.45));
      ctx.fill();
      // progress ring
      const r = 6 * px;
      ctx.beginPath();
      ctx.arc(b[0], b[1] - 10 * px, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b[0], b[1] - 10 * px, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * o.prog) / 100);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      ctx.restore();
    }
  }
  map.pulse = map.pulse || s.wars.some((w) => w.offs.length);
}
