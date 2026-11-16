// Right-hand panel for the selected country / territory.
import { TERR } from '../engine/world.js';
import { GOVS, TRAITS, OFFICIAL_TRAITS } from '../data/people.js';
import {
  owned, nameOf, fmtMonth, opinionBreakdown, trust, atWar, hasTreaty, blocsOf, topOverlord, warsOf, subjectsOf,
  leaderTitle, enemySide, coBelligerents, hasTech,
} from '../engine/state.js';
import { RESOURCES, RES_KEYS, BUILDINGS, buildCost } from '../engine/economy.js';
import {
  powerOf, canAttack, freeArmy, defenseStrength, attackStrength, hasClaim, canDeclare, maxNavalLift, interceptChance,
  garrison, territoryValue, nationValue,
} from '../engine/military.js';
import { evaluate, TREATY_INFO, influence, topInfluencer } from '../engine/diplomacy.js';
import { OPS, network, canRunOp, opChance, networkCost } from '../engine/intel.js';
import * as A from '../engine/actions.js';
import { app, on, result, toast, hooks } from './core.js';
import { esc, money, num, pct, pop, flag, bar, opinionColor, signed } from './fmt.js';
import { peaceDialog } from './dialogs.js';

const btn = (label, act, data = {}, opts = {}) => `<button class="btn ${opts.cls || ''}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${opts.disabled ? 'disabled' : ''} title="${esc(opts.title || '')}">${label}</button>`;
const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('')}</dl>`;

function verdict(ev) {
  const cls = ev.accept ? 'good' : 'bad';
  return `<details class="verdict"><summary class="${cls}">${ev.accept ? '✔ Likely to accept' : '✘ Will refuse'} (${signed(ev.total)})</summary>${ev.parts.map(([l, v]) => `<div class="row small"><span>${esc(l)}</span><b class="${v >= 0 ? 'good' : 'bad'}">${signed(v)}</b></div>`).join('')}</details>`;
}

export function renderCountry(app) {
  const el = document.getElementById('country');
  const s = app.s;
  if (!s || app.screen !== 'game' || !app.selected) { el.hidden = true; return; }
  const tid = app.selected;
  const t = s.terr[tid];
  const nid = t.owner;
  const n = s.nations[nid];
  const isMe = nid === s.player;
  const mySubject = topOverlord(s, nid) === s.player && !isMe;
  const tabs = [['overview', '📋', 'Overview']];
  if (!isMe) tabs.push(['diplo', '🤝', 'Diplomacy'], ['spy', '🕵️', 'Espionage']);
  tabs.push(['war', '⚔️', 'War']);
  if (isMe || mySubject) tabs.push(['manage', '🏗️', 'Manage']);
  let tab = app.countryTab || 'overview';
  if (!tabs.some(([k]) => k === tab)) tab = 'overview';
  const scroll = el.querySelector('.panel-body')?.scrollTop || 0;
  const same = el.dataset.t === tid && el.dataset.tab === tab;
  el.dataset.t = tid; el.dataset.tab = tab;
  let body = '';
  try { body = BODY[tab](s, tid, nid); } catch (err) { console.error(err); body = `<p class="bad">${esc(err.message)}</p>`; }
  const terrLine = TERR[tid].name !== n.name ? `<div class="muted">${esc(TERR[tid].name)} — part of ${esc(n.name)}</div>` : '';
  const occ = t.ctrl !== nid ? `<div class="bad">⚠️ Occupied by ${flag(s.nations[t.ctrl])} ${esc(nameOf(s, t.ctrl))}</div>` : '';
  const sub = n.overlord ? `<div class="muted">👑 Subject of ${esc(nameOf(s, n.overlord))}</div>` : '';
  el.hidden = false;
  el.innerHTML = `<header class="country-head" style="--c:${n.color}">
      <div class="ch-title">${flag(n)}<div><h2>${esc(n.name)}${isMe ? ' <span class="chip gold">YOU</span>' : ''}</h2>${terrLine}${sub}${occ}</div></div>
      <button class="x" data-act="close-country" aria-label="Close">✕</button>
    </header>
    <nav class="ctabs">${tabs.map(([k, i, l]) => `<button data-act="ctab" data-t="${k}" class="${tab === k ? 'on' : ''}">${i} ${l}</button>`).join('')}</nav>
    <div class="panel-body">${body}</div>`;
  if (same) el.querySelector('.panel-body').scrollTop = scroll;
}

const BODY = {
  overview(s, tid, nid) {
    const n = s.nations[nid];
    const t = s.terr[tid];
    const pw = powerOf(s, nid);
    const isMe = nid === s.player;
    const ob = isMe ? null : opinionBreakdown(s, nid, s.player);
    const mem = s.memory[`${nid}>${s.player}`] || [];
    const res = RES_KEYS.filter((k) => t.res[k] > 0);
    const blocs = blocsOf(s, nid);
    const subs = subjectsOf(s, nid);
    const inf = topInfluencer(s, nid);
    const wars = warsOf(s, nid);
    const coal = s.coalitions.find((c) => c.members.includes(nid) && c.target === s.player);
    return `<section class="card">
      <div class="leader"><div><b>${esc(leaderTitle(n))} ${esc(n.leader.name)}</b><div class="muted">${esc(GOVS[n.gov].name)}${n.leader.age ? ` • age ${n.leader.age}` : ''}</div><div>${n.leader.traits.map((x) => `<span class="chip" title="${esc(TRAITS[x]?.desc || '')}">${esc(x)}</span>`).join('')}</div>${!isMe ? `<div class="muted small">Ambition: ${esc(n.ai.ambition)}${n.ai.rival ? ` • Rival: ${esc(nameOf(s, n.ai.rival))}` : ''}</div>` : ''}</div></div>
      ${kv([
        ['GDP', `${money(n.stats.gdp || 0)} <small class="muted">($${num(n.stats.gdppc || 0)}/person)</small>`],
        ['Population', pop(n.stats.pop || 0)],
        ['Military power', `<b>${num(pw.total)}</b> <small class="muted">🪖${num(n.army, 0)} 🚢${num(n.navy, 0)} ✈️${num(n.air, 0)}${n.nukes ? ` ☢️${n.nukes}` : ''}</small>`],
        ['Stability', bar(n.stability, 100, n.stability < 30 ? 'var(--bad)' : 'var(--good)', `${Math.round(n.stability)}%`)],
        ['Technologies', `${n.techs.length} / 48`],
        ['Territories', `${owned(s, nid).length}${subs.length ? ` • ${subs.length} subjects` : ''}`],
        ['Infamy', Math.round(n.infamy), n.infamy > 40 ? 'bad' : ''],
        blocs.length ? ['Blocs', blocs.map((b) => `<span class="chip" style="border-color:${b.color}">${esc(b.name)}</span>`).join(' ')] : null,
        wars.length ? ['At war', wars.map((w) => esc(w.name)).join(', '), 'bad'] : null,
        inf ? ['Most influence', `${esc(nameOf(s, inf.id))} (${Math.round(inf.value)})`] : null,
      ])}</section>
      ${!isMe ? `<section class="card"><h3>Relations with us</h3>
        <div class="opinion-big" style="color:${opinionColor(ob.total)}">${signed(ob.total)}</div>
        <details><summary>Why?</summary>${ob.parts.map(([l, v]) => `<div class="row small"><span>${esc(l)}</span><b class="${v >= 0 ? 'good' : 'bad'}">${signed(v)}</b></div>`).join('')}</details>
        ${kv([
          ['Trust in us', bar(trust(s, nid, s.player), 100, 'var(--accent)', Math.round(trust(s, nid, s.player)))],
          ['Our influence', bar(influence(s, s.player, nid), 100, 'var(--gold)', Math.round(influence(s, s.player, nid)))],
          ['Our spy network', bar(network(s, s.player, nid), 100, 'var(--purple)', Math.round(network(s, s.player, nid)))],
          ['Treaties', ['trade', 'nap', 'defense', 'research'].filter((x) => hasTreaty(s, nid, s.player, x)).map((x) => TREATY_INFO[x].icon + ' ' + TREATY_INFO[x].name).join('<br>') || '<span class="muted">none</span>'],
          coal ? ['Coalition', '<span class="bad">Member of the coalition against you</span>'] : null,
        ])}
        ${mem.length ? `<h4>They remember…</h4>${mem.map((m) => `<div class="row small"><span>${esc(m.text)}</span><span class="muted">${fmtMonth(s, m.day)}</span></div>`).join('')}` : ''}
      </section>` : ''}
      <section class="card"><h3>${esc(TERR[tid].name)}</h3>${kv([
        ['Capital', esc(TERR[tid].capital || '—')],
        ['Population', pop(t.pop)],
        ['Output', money(t.gdp)],
        ['Infrastructure', `${t.infra.toFixed(1)} / 10`],
        ['Buildings', `🏭${t.fac} 🔬${t.labs} 🏰${t.forts} 🎖️${t.bases}${t.mines ? ` ⛏️${t.mines}` : ''}`],
        ['Resources', res.length ? res.map((k) => `${RESOURCES[k].icon}${t.res[k].toFixed(1)}`).join(' ') : '<span class="muted">none</span>'],
        t.unrest > 1 ? ['Unrest', bar(t.unrest, 100, 'var(--bad)', `${Math.round(t.unrest)}%`)] : null,
        t.core !== t.owner ? ['Integration', bar(t.integ, 100, 'var(--accent)', `${Math.round(t.integ)}% • homeland of ${esc(nameOf(s, t.core))}`)] : null,
        t.devast > 1 ? ['Devastation', `${Math.round(t.devast)}%`, 'bad'] : null,
        t.governor ? ['Governor', `${esc(t.governor.name)} <span class="chip">${esc(t.governor.trait)}</span>`] : null,
      ])}</section>`;
  },

  diplo(s, tid, nid) {
    const n = s.nations[nid];
    const me = s.nations[s.player];
    const proposal = (kind, label, extra = {}) => {
      if (kind !== 'joinBloc' && kind !== 'protectorate' && hasTreaty(s, s.player, nid, kind)) return `<div class="prop"><div><b>${label}</b> <span class="good small">✔ in force</span></div>${btn('Cancel', 'cancel-treaty', { n: nid, type: kind }, { cls: 'small' })}</div>`;
      const ev = evaluate(s, s.player, nid, kind, extra);
      const cost = kind === 'joinBloc' ? 20 : kind === 'protectorate' ? 40 : TREATY_INFO[kind]?.pc || 10;
      return `<div class="prop"><div><b>${label}</b> <span class="muted small">${cost} PC</span>${verdict(ev)}</div>${btn('Propose', 'propose', { n: nid, k: kind, ...(extra.bloc ? { b: extra.bloc } : {}) }, { disabled: me.pc < cost || ev.total <= -900 })}</div>`;
    };
    const myBlocs = s.blocs.filter((b) => b.leader === s.player && !b.members.includes(nid));
    const atWarNow = atWar(s, s.player, nid);
    const guaranteed = hasTreaty(s, s.player, nid, 'guarantee');
    const embargoed = s.embargo.some((e) => e.a === s.player && e.b === nid);
    const border = owned(s, nid).filter((t) => TERR[t].nb.some((x) => s.terr[x].owner === s.player));
    const ultTarget = border.length ? border.reduce((a, b) => (territoryValue(s, a) < territoryValue(s, b) ? a : b)) : null;
    if (n.overlord === s.player) return `<section class="card"><p>${esc(n.name)} is our subject. Manage it from the 🏗️ Manage tab.</p></section>`;
    if (atWarNow) return `<section class="card"><p class="bad">We are at war with ${esc(n.name)}.</p>${btn('🕊️ Negotiate peace', 'peace-with', { n: nid })}</section>`;
    return `<section class="card"><h3>Treaties</h3>
        ${proposal('trade', '🤝 Trade agreement')}
        ${proposal('research', '🔬 Research pact')}
        ${proposal('nap', '🕊️ Non-aggression pact')}
        ${proposal('defense', '🛡️ Defense pact')}
        ${myBlocs.map((b) => proposal('joinBloc', `🏳️ Invite to ${esc(b.name)}`, { bloc: b.id })).join('')}
        ${influence(s, s.player, nid) >= 40 ? proposal('protectorate', '👑 Offer protectorate (become our subject)') : `<p class="muted small">👑 Protectorates become possible once our influence here reaches 40.</p>`}
      </section>
      <section class="card"><h3>Influence & Relations</h3>
        <div class="acts">
          ${btn(`📈 Improve relations <small>15 PC</small>`, 'improve', { n: nid }, { disabled: me.pc < 15 || (me.improving || []).some((x) => x.target === nid), title: 'Diplomats work for a year to raise their opinion of us' })}
          ${btn(`💵 Invest <small>${money(1 + (n.stats.gdp || 0) * 0.02)}</small>`, 'invest', { n: nid }, { title: 'Buy influence with investment' })}
          ${btn('🎭 Cultural exchange <small>12 PC</small>', 'culture', { n: nid }, { disabled: me.pc < 12 })}
          ${btn(`🎁 Send aid <small>${money(Math.max(0.5, (n.stats.gdp || 1) * 0.01))}</small>`, 'aid', { n: nid, v: Math.max(0.5, (n.stats.gdp || 1) * 0.01) })}
          ${btn(guaranteed ? '🛡️ Revoke guarantee' : '🛡️ Guarantee independence <small>20 PC</small>', 'guarantee', { n: nid })}
          ${btn('📣 Denounce', 'denounce', { n: nid })}
          ${btn(embargoed ? '🚢 Lift embargo' : '⛔ Embargo', 'embargo', { n: nid })}
        </div>
      </section>
      <section class="card"><h3>Coercion</h3>
        ${ultTarget ? `<div class="prop"><div><b>Demand ${esc(TERR[ultTarget].name)}</b> <span class="muted small">30 PC</span>${verdict(evaluate(s, s.player, nid, 'ultimatum', { terr: ultTarget }))}</div>${btn('Ultimatum', 'ultimatum', { n: nid, t: ultTarget }, { cls: 'danger', disabled: me.pc < 30 })}</div>` : '<p class="muted small">Territorial demands need a shared border.</p>'}
        <div class="prop"><div><b>Demand submission (vassalage)</b> <span class="muted small">30 PC</span>${verdict(evaluate(s, s.player, nid, 'ultimatum', { vassal: true }))}</div>${btn('Ultimatum', 'ultimatum', { n: nid, v: 1 }, { cls: 'danger', disabled: me.pc < 30 })}</div>
        <p class="muted small">A refused ultimatum gives you a justification for war.</p>
      </section>`;
  },

  spy(s, tid, nid) {
    const net = network(s, s.player, nid);
    return `<section class="card"><h3>Spy Network ${bar(net, 100, 'var(--purple)', Math.round(net))}</h3>
      ${Object.entries(OPS).map(([k, o]) => {
        const chk = canRunOp(s, s.player, nid, k);
        const ch = opChance(s, s.player, nid, k);
        return `<div class="prop"><div><b>${o.icon} ${o.name}</b>${k === 'network' ? ` <span class="muted small">${money(networkCost(s, nid))}</span>` : o.pc ? ` <span class="muted small">${o.pc} PC</span>` : ''}<div class="muted small">${o.desc}</div><div class="small ${chk.ok ? '' : 'bad'}">${chk.ok ? `Success ${Math.round(ch * 100)}% • exposure risk ${Math.round(o.risk * 100)}%` : esc(chk.why)}</div></div>${btn('Run', 'op', { n: nid, op: k, t: tid }, { disabled: !chk.ok, cls: k === 'coup' || k === 'rebellion' ? 'danger' : '' })}</div>`;
      }).join('')}</section>`;
  },

  war(s, tid, nid) {
    const t = s.terr[tid];
    const me = s.nations[s.player];
    const ctrl = t.ctrl;
    const parts = [];
    if (ctrl !== s.player && atWar(s, s.player, ctrl)) {
      const chk = canAttack(s, s.player, tid);
      const free = freeArmy(s, s.player);
      const { d, g } = defenseStrength(s, tid, s.player);
      const def = app.offDivs ?? Math.max(1, Math.round(free * 0.5));
      const divs = Math.min(def, chk.mode === 'naval' ? maxNavalLift(s, s.player) : free);
      const att = chk.ok ? attackStrength(s, s.player, divs, tid, chk.mode) : 0;
      const odds = att / Math.max(0.001, att + d);
      parts.push(`<section class="card"><h3>⚔️ Attack ${esc(TERR[tid].name)}</h3>
        ${kv([
          ['Enemy garrison', `${num(g, 1)} divisions + militia`],
          ['Defense strength', num(d, 1)],
          ['Route', chk.ok ? (chk.mode === 'naval' ? '⚓ Amphibious landing' : '🪖 Over land') : `<span class="bad">${esc(chk.why)}</span>`],
          ['Free divisions', `${num(free, 1)}${chk.mode === 'naval' ? ` (sealift max ${num(maxNavalLift(s, s.player), 0)})` : ''}`],
        ])}
        ${chk.ok ? `<label class="slider"><span>Commit</span><input type="range" data-input="off-divs" min="0.5" max="${Math.max(1, free).toFixed(1)}" step="0.5" value="${Math.min(def, free)}"><b data-out="off-divs">${num(divs, 1)} div</b></label>
        <div class="odds">Battle odds: <b class="${odds > 0.55 ? 'good' : odds > 0.42 ? 'warn' : 'bad'}">${Math.round(odds * 100)}%</b> <span class="muted small">(above ~42% we advance)</span></div>
        ${btn('🚩 Launch offensive', 'attack', { t: tid }, { cls: 'primary' })}` : ''}
      </section>`);
      parts.push(`<section class="card"><h3>Strategic Strikes</h3>
        <div class="prop"><div><b>🚀 Missile strike</b><div class="muted small">${Math.floor(me.missiles)} batteries available • enemy shield ${Math.round(interceptChance(s, s.player, ctrl) * 100)}%</div></div>${btn('Fire 10', 'missile', { t: tid, v: 10 }, { disabled: !hasTech(s, s.player, 'str1') || me.missiles < 1 })}${btn('Fire all', 'missile', { t: tid, v: Math.floor(me.missiles) }, { disabled: !hasTech(s, s.player, 'str1') || me.missiles < 1 })}</div>
        <div class="prop"><div><b>☢️ Nuclear strike</b><div class="muted small">${me.nukes} warheads. Kills millions, shatters armies — and the whole world will never forgive you. Expect retaliation from nuclear powers.</div></div>${btn('Launch', 'nuke', { t: tid }, { cls: 'danger', disabled: me.nukes < 1 || !hasTech(s, s.player, 'str2') })}</div>
      </section>`);
      parts.push(`<section class="card">${btn('🕊️ Negotiate peace', 'peace-with', { n: ctrl })}</section>`);
    } else if (nid !== s.player && topOverlord(s, nid) !== s.player) {
      const chk = canDeclare(s, s.player, nid);
      const cb = hasClaim(s, s.player, nid);
      const theirAllies = new Set([...(s.treaties.filter((x) => x.type === 'defense' && (x.a === nid || x.b === nid)).map((x) => (x.a === nid ? x.b : x.a))), ...blocsOf(s, nid).filter((b) => b.type === 'military').flatMap((b) => b.members), ...s.treaties.filter((x) => x.type === 'guarantee' && x.b === nid).map((x) => x.a)]);
      theirAllies.delete(nid); theirAllies.delete(s.player);
      const pw = (id) => s.nations[id].stats.power || 0;
      const allyPow = [...theirAllies].reduce((a, x) => a + pw(x), 0);
      parts.push(`<section class="card"><h3>Declare War on ${esc(s.nations[nid].name)}</h3>
        ${kv([
          ['Justification', cb ? `<span class="good">${esc(cb)}</span>` : '<span class="bad">None — costs 25 PC, stability and heavy infamy</span>'],
          ['Their power', `${num(pw(nid))} vs our ${num(pw(s.player))}`],
          ['Likely allies', theirAllies.size ? `${theirAllies.size} nations (${num(allyPow)} power): ${[...theirAllies].slice(0, 10).map((x) => s.nations[x].flag || x).join(' ')}` : 'None', theirAllies.size ? 'warn' : ''],
          hasTreaty(s, s.player, nid, 'nap') ? ['Treaty', '<span class="bad">Breaks our non-aggression pact — a betrayal the world will remember</span>'] : null,
        ])}
        ${btn('⚔️ Declare war', 'declare', { n: nid }, { cls: 'danger', disabled: !chk.ok })}
        ${!cb ? `<p class="muted small">Tip: use 🕵️ Fabricate Claim or a refused ultimatum to get a justification first.</p>` : ''}</section>`);
    } else if (nid === s.player && ctrl !== s.player) {
      parts.push(`<section class="card"><p class="bad">This territory of ours is occupied. Launch an offensive from neighbouring land to liberate it.</p></section>`);
      if (atWar(s, s.player, ctrl)) return BODY.war(s, tid, ctrl === nid ? nid : ctrl);
    } else {
      parts.push(`<section class="card"><p class="muted">${nid === s.player ? 'This is our territory.' : 'This nation is part of our realm.'} Garrison here: ${num(garrison(s, tid), 1)} divisions + militia.</p></section>`);
    }
    return parts.join('');
  },

  manage(s, tid, nid) {
    const t = s.terr[tid];
    const n = s.nations[nid];
    const me = s.nations[s.player];
    const out = [];
    if (nid === s.player) {
      out.push(`<section class="card"><h3>🏗️ Construction in ${esc(TERR[tid].name)}</h3>${Object.entries(BUILDINGS).map(([k, b]) => {
        const queued = t.build.filter((x) => x.type === k);
        const cost = buildCost(s, tid, k);
        const maxed = t[k] + queued.length >= b.max;
        return `<div class="prop"><div><b>${b.icon} ${b.name}</b> <span class="muted small">level ${k === 'infra' ? t[k].toFixed(1) : t[k]}/${b.max}${queued.length ? ` • +${queued.length} building` : ''}</span><div class="muted small">${b.desc}</div></div>${btn(maxed ? 'Max' : `Build ${money(cost)}`, 'build', { t: tid, k }, { disabled: maxed || me.treasury < cost || t.ctrl !== s.player })}</div>`;
      }).join('')}</section>`);
      const cands = A.candidates(s, tid);
      out.push(`<section class="card"><h3>👤 Governor</h3>${t.governor ? `<p>${esc(t.governor.name)} <span class="chip">${esc(t.governor.trait)}</span> <span class="muted small">${esc(OFFICIAL_TRAITS[t.governor.trait].desc)}</span></p>` : '<p class="muted">No governor appointed.</p>'}
        <h4>Candidates</h4>${cands.map((c, i) => `<div class="prop"><div><b>${esc(c.name)}</b> <span class="chip">${esc(c.trait)}</span><div class="muted small">${esc(OFFICIAL_TRAITS[c.trait].desc)} • age ${c.age}</div></div>${btn('Appoint', 'governor', { t: tid, i }, { disabled: me.pc < 10 })}</div>`).join('')}</section>`);
      if (t.core !== s.player || s.nations[tid]) {
        if (tid !== me.capital) out.push(`<section class="card"><h3>🏳️ Establish a client state</h3><p class="muted small">Hand ${esc(TERR[tid].name)} back to a native government loyal to us. It becomes our puppet: no unrest for us, tribute flows in, and it still counts toward world domination.</p>${btn('Release as puppet', 'release', { t: tid })}</section>`);
      }
    }
    if (n.overlord === s.player) {
      const cands = A.candidates(s, nid);
      const years = (s.day - n.subjectSince) / 360;
      out.push(`<section class="card"><h3>👑 ${esc(n.name)} — our subject</h3>
        ${kv([
          ['Liberty desire', bar(n.liberty, 100, n.liberty > 60 ? 'var(--bad)' : 'var(--warn)', `${Math.round(n.liberty)}%`)],
          ['Leader', `${esc(n.leader.name)} ${n.leader.official ? `<span class="chip">${esc(n.leader.official)}</span>` : ''}`],
          ['Government', esc(GOVS[n.gov].name)],
          ['Subject for', `${years.toFixed(1)} years`],
          ['Tribute paid', `${money(n.stats.tributePaid || 0)}/yr`],
        ])}
        <label class="slider"><span>Tribute</span><input type="range" data-input="tribute" data-n="${nid}" min="0" max="0.5" step="0.05" value="${n.tribute}"><b data-out="tribute">${Math.round(n.tribute * 100)}%</b></label>
        <p class="muted small">Higher tribute raises liberty desire. Above ~75% they may rise up, especially while we are at war.</p></section>`);
      out.push(`<section class="card"><h3>Appoint a leader <small class="muted">25 PC</small></h3>${cands.map((c, i) => `<div class="prop"><div><b>${esc(c.name)}</b> <span class="chip">${esc(c.trait)}</span><div class="muted small">${esc(OFFICIAL_TRAITS[c.trait].desc)}</div></div>${btn('Install', 'puppet-leader', { n: nid, i }, { disabled: me.pc < 25 })}</div>`).join('')}</section>`);
      out.push(`<section class="card"><h3>Establish government <small class="muted">30 PC</small></h3><div class="grid2">${Object.entries(GOVS).map(([k, g]) => `<button class="opt ${n.gov === k ? 'on' : ''}" data-act="subject-gov" data-n="${nid}" data-g="${k}" ${n.gov === k || me.pc < 30 ? 'disabled' : ''}><b style="color:${g.color}">${g.name}</b></button>`).join('')}</div><p class="muted small">Autocratic puppets are more loyal; democracies are more stable but drift away.</p></section>`);
      out.push(`<section class="card"><h3>Fate of ${esc(n.name)}</h3><div class="btns">${btn(`Annex fully <small>${A.integrationCost(s, nid)} PC</small>`, 'integrate', { n: nid }, { disabled: years < 5 || n.liberty > 50, title: 'Requires 5 years as a subject and liberty desire below 50%' })}${btn('Grant independence', 'free-subject', { n: nid })}</div></section>`);
    }
    return out.join('');
  },
};

// ---------- Handlers ----------
on('propose', (d) => {
  const r = A.propose(app.s, d.n, d.k, d.b ? { bloc: d.b } : {});
  result(r);
});
on('improve', (d) => result(A.improveRelations(app.s, d.n)));
on('invest', (d) => result(A.investIn(app.s, d.n)));
on('culture', (d) => result(A.culturalExchange(app.s, d.n)));
on('aid', (d) => result(A.sendAid(app.s, d.n, +d.v)));
on('guarantee', (d) => result(A.guarantee(app.s, d.n)));
on('denounce', (d) => result(A.denounce(app.s, d.n)));
on('embargo', (d) => result(A.toggleEmbargo(app.s, d.n)));
on('ultimatum', (d) => { if (confirm('Issue the ultimatum? Refusal sours relations badly.')) result(A.ultimatum(app.s, d.n, d.t, !!d.v)); });
on('op', (d) => result(A.covertOp(app.s, d.n, d.op, { terr: d.t })));
on('declare', (d) => { if (confirm(`Declare war on ${app.s.nations[d.n].name}?`)) result(A.declareWarOn(app.s, d.n)); });
on('input:off-divs', (v, el) => { app.offDivs = +v; const o = document.querySelector('[data-out="off-divs"]'); if (o) o.textContent = `${(+v).toFixed(1)} div`; void el; });
on('attack', (d) => { const r = A.offensive(app.s, d.t, app.offDivs ?? freeArmy(app.s, app.s.player) * 0.5); result(r); });
on('missile', (d) => result(A.fireMissiles(app.s, d.t, +d.v)));
on('nuke', (d) => {
  if (!confirm('☢️ Launch a nuclear strike? Millions will die. Every nation will remember this, and nuclear powers may retaliate.')) return;
  result(A.launchNuke(app.s, d.t));
});
on('peace-with', (d) => {
  const w = warsOf(app.s, app.s.player).find((x) => enemySide(x, app.s.player).includes(d.n));
  if (w) peaceDialog(app, w.id, d.n);
  else toast('Not at war with them directly', 'bad');
});
on('build', (d) => result(A.build(app.s, d.t, d.k)));
on('governor', (d) => result(A.appointGovernor(app.s, d.t, +d.i)));
on('release', (d) => { if (confirm('Release this territory as a puppet state?')) result(A.releaseAsPuppet(app.s, d.t)); });
on('puppet-leader', (d) => result(A.appointPuppetLeader(app.s, d.n, +d.i)));
on('subject-gov', (d) => result(A.setSubjectGov(app.s, d.n, d.g)));
on('input:tribute', (v, el, done) => { A.setTribute(app.s, el.dataset.n, +v); const o = document.querySelector('[data-out="tribute"]'); if (o) o.textContent = `${Math.round(v * 100)}%`; if (done) hooks.refreshAll(true); });
on('integrate', (d) => { if (confirm('Annex this subject into your nation?')) result(A.integrateSubject(app.s, d.n)); });
on('free-subject', (d) => { if (confirm('Grant full independence?')) result(A.freeSubject(app.s, d.n)); });
