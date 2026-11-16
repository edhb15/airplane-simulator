// Left-hand management panels.
import { TERR } from '../engine/world.js';
import { GOVS, TRAITS, OFFICIAL_TRAITS } from '../data/people.js';
import { TECHS, BRANCHES, TECH_BY_ID } from '../data/techs.js';
import {
  owned, nameOf, fmtDate, fmtMonth, warsOf, enemySide, friendSide, opinion, trust, aliveIds, treatiesOf, blocsOf,
  subjectsOf, defenders, leaderTitle, atWar, hasTreaty,
} from '../engine/state.js';
import {
  RESOURCES, RES_KEYS, UNITS, BUILDINGS, MOBIL, budgetOf, interestRate, creditRating, manpowerCap, unitBuildCost,
  availableTechs, effectiveTechCost, researchPoints, resourceNeeds,
} from '../engine/economy.js';
import { powerOf, qLand, qNaval, qAir, warScore, committed, freeArmy } from '../engine/military.js';
import { TREATY_INFO, influence } from '../engine/diplomacy.js';
import { OPS, network } from '../engine/intel.js';
import { domination, leaderboard } from '../engine/sim.js';
import { listSaves, saveGame, loadGame, deleteSave, exportFile, deserialize, hallOfFame } from '../engine/save.js';
import * as A from '../engine/actions.js';
import { app, on, result, toast, modal, closeModal, hooks, saveSettings } from './core.js';
import { esc, money, num, pct, pop, flag, bar, opinionColor, signed } from './fmt.js';
import { lineChart } from './charts.js';
import { peaceDialog, howToPlay } from './dialogs.js';

export const TABS = [
  { id: 'nation', name: 'Nation', icon: '🏛️', key: 'N' },
  { id: 'economy', name: 'Economy', icon: '💰', key: 'B' },
  { id: 'military', name: 'Military', icon: '🪖', key: 'M' },
  { id: 'research', name: 'Research', icon: '🔬', key: 'X' },
  { id: 'diplomacy', name: 'Diplomacy', icon: '🤝', key: 'D' },
  { id: 'intel', name: 'Intelligence', icon: '🕵️', key: 'J' },
  { id: 'territories', name: 'Empire', icon: '🗺️', key: 'L' },
  { id: 'wars', name: 'Wars', icon: '⚔️', key: 'A' },
  { id: 'world', name: 'World', icon: '🌍', key: 'G' },
  { id: 'stats', name: 'Statistics', icon: '📈', key: 'S' },
  { id: 'news', name: 'News', icon: '📰', key: 'Z' },
  { id: 'menu', name: 'Menu', icon: '☰', key: null },
];

const P = () => app.s.nations[app.s.player];

export function renderPanel(app) {
  const nav = document.getElementById('nav');
  const panel = document.getElementById('panel');
  if (!app.s || app.screen !== 'game') { nav.innerHTML = ''; panel.hidden = true; return; }
  const s = app.s;
  const pend = s.pending.length;
  const wars = warsOf(s, s.player).length;
  nav.innerHTML = TABS.map((t) => `<button data-act="tab" data-tab="${t.id}" class="${app.tab === t.id ? 'on' : ''}" title="${t.name}${t.key ? ` (${t.key})` : ''}">${t.icon}<span>${t.name}</span>${t.id === 'wars' && wars ? `<em>${wars}</em>` : ''}${t.id === 'research' && !P().research && availableTechs(s, s.player).length ? '<em>!</em>' : ''}</button>`).join('');
  if (!app.tab) { panel.hidden = true; document.body.classList.remove('has-panel'); return; }
  document.body.classList.add('has-panel');
  const tab = TABS.find((t) => t.id === app.tab);
  const scroll = panel.querySelector('.panel-body')?.scrollTop || 0;
  const sameTab = panel.dataset.tab === app.tab;
  panel.hidden = false;
  panel.dataset.tab = app.tab;
  let body = '';
  try { body = RENDER[app.tab](s); } catch (err) { console.error(err); body = `<p class="bad">Panel error: ${esc(err.message)}</p>`; }
  panel.innerHTML = `<header><h2>${tab.icon} ${tab.name}</h2><button class="x" data-act="close-panel" aria-label="Close">✕</button></header><div class="panel-body">${body}</div>`;
  if (sameTab) panel.querySelector('.panel-body').scrollTop = scroll;
  AFTER[app.tab]?.(s, panel);
  void pend;
}

const section = (title, html, extra = '') => `<section class="card"><h3>${title}${extra}</h3>${html}</section>`;
const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('')}</dl>`;
const btn = (label, act, data = {}, opts = {}) => `<button class="btn ${opts.cls || ''}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${opts.disabled ? 'disabled' : ''} title="${esc(opts.title || '')}">${label}</button>`;
const slider = (id, label, value, min, max, step, right) => `<label class="slider"><span>${label}</span><input type="range" data-input="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><b data-out="${id}">${right}</b></label>`;
const traitChips = (traits) => traits.map((t) => `<span class="chip" title="${esc(TRAITS[t]?.desc || OFFICIAL_TRAITS[t]?.desc || '')}">${esc(t)}</span>`).join('');

const RENDER = {
  // ---------------- NATION ----------------
  nation(s) {
    const n = P();
    const d = domination(s);
    const coal = s.coalitions.find((c) => c.target === s.player);
    const mods = (n.mods || []).filter((m) => m.until > s.day);
    return section('Leadership', `
      <div class="leader">${flag(n)}<div><b>${esc(leaderTitle(n))} ${esc(n.leader.name)}</b><div class="muted">${esc(GOVS[n.gov].name)} • in office since ${fmtMonth(s, n.leader.since)}</div><div>${traitChips(n.leader.traits)}</div></div></div>
      ${kv([
        ['Stability', bar(n.stability, 100, n.stability < 30 ? 'var(--bad)' : 'var(--good)', `${Math.round(n.stability)}%`)],
        ['Approval', bar(n.approval, 100, 'var(--accent)', `${Math.round(n.approval)}%`)],
        ['War exhaustion', bar(n.warEx, 100, 'var(--warn)', `${Math.round(n.warEx)}%`)],
        ['Infamy', bar(n.infamy, 100, 'var(--bad)', `${Math.round(n.infamy)}`)],
        ['Political capital', `${Math.floor(n.pc)} <span class="muted">(+${(GOVS[n.gov].pc + n.stability / 40).toFixed(1)}/mo)</span>`],
        GOVS[n.gov].democratic && n.nextElection ? ['Next election', fmtMonth(s, n.nextElection)] : null,
      ])}`)
      + section('World Domination', `
      <div class="dom-big">${pct(d.terr, 1)}</div>
      ${bar(d.terr * 100, 100, 'linear-gradient(90deg,#e6c84a,#ff7b39)', `${d.terrCount} / ${d.total} territories`)}
      ${kv([['World population', pct(d.pop, 1)], ['World GDP', pct(d.gdp, 1)], ['Subject nations', subjectsOf(s, s.player).length]])}
      <div class="milestones">${s.history.milestones.map((m) => `<span class="chip gold" title="${esc(m.desc)}">🏆 ${esc(m.name)} <small>${fmtMonth(s, m.day)}</small></span>`).join('') || '<span class="muted">No milestones yet — first is at 5% of the world.</span>'}</div>`)
      + (n.overlord ? section('👑 We Are a Subject', `<p class="bad">${esc(nameOf(s, n.overlord))} controls our foreign policy and takes ${Math.round(n.tribute * 100)}% of our income as tribute. We cannot expand while we are someone else's puppet.</p>${btn('🔥 Declare independence', 'independence', {}, { cls: 'danger' })}`) : '')
      + section('Threats', coal ? `<p class="bad">⚠️ A coalition of ${coal.members.length} nations has formed against you. They will attack if you look weak or keep expanding.</p><div class="flags">${coal.members.map((m) => `<button class="nlink" data-act="select-nation" data-n="${m}">${flag(s.nations[m])} ${esc(s.nations[m].name)}</button>`).join('')}</div>`
        : `<p class="muted">No coalition against you. Infamy above ~${Math.round(20 * ({ easy: 1.6, normal: 1, hard: 0.8, brutal: 0.6 }[s.difficulty]))} makes your neighbours band together.</p>`)
      + section('Mobilization Law', MOBIL.map((m, i) => `<button class="opt ${n.mobil === i ? 'on' : ''}" data-act="mobil" data-v="${i}"><b>${m.name}</b><small>${m.rate}% of population can serve${m.growth ? ` • ${(m.growth * 100).toFixed(1)}% growth` : ''}${m.stability ? ` • ${m.stability} stability` : ''}</small></button>`).join(''))
      + section('Government', `<p class="muted">Reforming the state costs 100 political capital and 15 stability. Democracies hold elections; autocracies generate more political capital and resist unrest but anger democracies.</p>
        <div class="grid2">${Object.entries(GOVS).map(([k, g]) => `<button class="opt ${n.gov === k ? 'on' : ''}" data-act="gov-reform" data-g="${k}" ${n.gov === k ? 'disabled' : ''}><b style="color:${g.color}">${g.name}</b><small>+${g.pc} PC/mo • tax eff. ${Math.round(g.taxEff * 100)}%</small></button>`).join('')}</div>`)
      + (mods.length ? section('Active Effects', mods.map((m) => `<div class="row"><span>${esc(m.label || m.key)}</span><span class="${m.value > 0 ? 'good' : 'bad'}">${m.key === 'growth' ? signed(m.value * 100, 1) + '% growth' : signed(m.value) + ' ' + m.key}</span><span class="muted">until ${fmtMonth(s, m.until)}</span></div>`).join('')) : '');
  },

  // ---------------- ECONOMY ----------------
  economy(s) {
    const n = P();
    const b = budgetOf(s, s.player);
    const gdp = b.gdp;
    const growth = n.stats.growth || 0;
    const need = resourceNeeds(s, s.player);
    const prod = n.stats.resProd || {};
    const rows = (obj, sign) => Object.entries(obj).filter(([, v]) => Math.abs(v) > 0.005).map(([k, v]) => `<div class="row"><span>${k[0].toUpperCase() + k.slice(1)}</span><b class="${sign}">${money(v)}</b></div>`).join('');
    return section('Overview', kv([
      ['GDP', `${money(gdp)} <span class="${growth >= 0 ? 'good' : 'bad'}">${signed(growth * 100, 1)}%/yr</span>`],
      ['Population', pop(n.stats.pop || 0)],
      ['GDP per capita', `$${num(n.stats.gdppc || 0)}`],
      ['Research', `${(n.rp || 0).toFixed(1)} pts/month`],
    ]))
      + section('Budget <small class="muted">(% of GDP per year)</small>', `
        ${slider('tax', 'Taxes', n.tax, 5, 70, 1, `${n.tax}% • ${money(b.income.taxes)}`)}
        ${slider('budget-mil', 'Defense', n.budget.mil, 0, 30, 0.1, `${n.budget.mil.toFixed(1)}% • ${money(b.expense.military)}`)}
        ${slider('budget-res', 'Research', n.budget.res, 0, 8, 0.1, `${n.budget.res.toFixed(1)}% • ${money(b.expense.research)}`)}
        ${slider('budget-infra', 'Infrastructure', n.budget.infra, 0, 10, 0.1, `${n.budget.infra.toFixed(1)}% • ${money(b.expense.infrastructure)}`)}
        ${slider('budget-welfare', 'Welfare', n.budget.welfare, 0, 25, 0.1, `${n.budget.welfare.toFixed(1)}% • ${money(b.expense.welfare)}`)}
        <div class="balance ${b.balance >= 0 ? 'good' : 'bad'}">Balance: <b>${money(b.balance, true)}/yr</b> (${money(b.balance / 12, true)}/month)</div>
        <p class="muted small">Taxes above 30% slow growth and anger voters. Welfare buys approval. Defense money beyond upkeep automatically buys new units. Infrastructure raises growth everywhere.</p>`)
      + section('Income & Expenses <small class="muted">per year</small>', `<div class="cols"><div><h4>Income</h4>${rows(b.income, 'good')}<div class="row total"><span>Total</span><b>${money(b.totalIn)}</b></div></div><div><h4>Expenses</h4>${rows(b.expense, 'bad')}<div class="row total"><span>Total</span><b>${money(b.totalOut)}</b></div></div></div>`)
      + section('National Debt', `${kv([
        ['Debt', `${money(n.debt)} <span class="muted">(${pct(n.debt / Math.max(1, gdp))} of GDP)</span>`],
        ['Interest rate', `${(interestRate(s, s.player) * 100).toFixed(1)}% • rating <b>${creditRating(s, s.player)}</b>${n.reserve ? ' • reserve currency' : ''}`],
        ['Treasury', money(n.treasury)],
      ])}<div class="btns">${btn(`Borrow ${money(gdp * 0.01)}`, 'borrow', { v: gdp * 0.01 })}${btn(`Borrow ${money(gdp * 0.05)}`, 'borrow', { v: gdp * 0.05 })}${btn('Repay 25%', 'repay', { v: n.treasury * 0.25 })}${btn('Repay max', 'repay', { v: n.treasury })}</div>`)
      + section('Strategic Resources', `<table class="tbl"><tr><th></th><th>Output</th><th>Need</th><th>Price</th><th>Net $/yr</th></tr>${RES_KEYS.map((k) => {
        const r = RESOURCES[k]; const pr = prod[k] || 0; const nd = need[k] || 0; const net = (pr - nd) * r.value * s.market[k] * (pr >= nd ? 1 : 1.25);
        return `<tr><td>${r.icon} ${r.name}</td><td>${pr.toFixed(1)}</td><td>${nd ? nd.toFixed(1) : '—'}</td><td class="${s.market[k] > 1.15 ? 'good' : s.market[k] < 0.85 ? 'bad' : ''}">${s.market[k].toFixed(2)}×</td><td class="${net >= 0 ? 'good' : 'bad'}">${money(net, true)}</td></tr>`;
      }).join('')}</table><p class="muted small">Oil fuels your military (shortfalls are imported at a premium). Rare minerals boost research, iron cuts unit costs, uranium is needed for warheads, food keeps people content. Conquer or befriend producers to profit.</p>`);
  },

  // ---------------- MILITARY ----------------
  military(s) {
    const n = P();
    const pw = powerOf(s, s.player);
    const cap = manpowerCap(s, s.player);
    const upkeep = n.stats.upkeep || 0;
    const funds = (n.stats.gdp || 0) * n.budget.mil / 100;
    const queue = n.prodQueue || [];
    const unitRow = (type) => {
      const u = UNITS[type];
      const field = { army: 'army', navy: 'navy', air: 'air', missile: 'missiles', nuke: 'nukes' }[type];
      const cost = unitBuildCost(s, s.player, type);
      const amounts = type === 'army' ? [1, 5, 20] : type === 'missile' ? [5, 20, 50] : [1, 5, 10];
      return `<div class="unit"><div><b>${u.icon} ${u.name}</b><small>${num(n[field], 1)} ${u.unit} • ${money(cost)} each • ${u.days} days</small></div><div class="btns">${amounts.map((a) => btn(`+${a}`, 'recruit', { type, v: a }, { title: money(cost * a) })).join('')}</div></div>`;
    };
    const offs = [];
    for (const w of warsOf(s, s.player)) for (const o of w.offs) if (o.by === s.player) offs.push(o);
    return section('Armed Forces', `
      ${kv([
        ['Total power', `<b>${num(pw.total)}</b>`],
        ['Army', `${num(n.army, 1)} divisions × ${qLand(s, s.player).toFixed(2)} quality = ${num(pw.land)}`],
        ['Navy', `${num(n.navy, 1)} × ${qNaval(s, s.player).toFixed(2)} = ${num(pw.naval)}`],
        ['Air force', `${num(n.air, 1)} × ${qAir(s, s.player).toFixed(2)} = ${num(pw.air)}`],
        ['Missiles', `${Math.floor(n.missiles)} batteries`],
        ['Nuclear warheads', `${n.nukes}${n.nukeBuild > 0 ? ` <span class="muted">(+1 in ${n.nukeBuild} months)</span>` : ''}`],
        ['Readiness', bar(n.readiness * 100, 105, n.readiness < 0.6 ? 'var(--bad)' : 'var(--good)', `${Math.round(n.readiness * 100)}%`)],
        ['Manpower', `${num(n.army, 1)} / ${num(cap, 1)} divisions`],
        ['Upkeep vs budget', `<span class="${funds < upkeep ? 'bad' : 'good'}">${money(upkeep)} / ${money(funds)} per year</span>`],
        ['Committed to offensives', `${num(committed(s, s.player), 1)} div • ${num(freeArmy(s, s.player), 1)} free`],
      ])}
      ${funds < upkeep ? '<p class="bad small">Your defense budget does not cover upkeep — readiness will fall. Raise it in the Economy panel.</p>' : '<p class="muted small">Budget beyond upkeep buys new units automatically, split by the procurement mix below.</p>'}`)
      + section('Procurement Mix', ['army', 'navy', 'air', 'missile'].map((k) => slider(`mix-${k}`, UNITS[k].icon + ' ' + UNITS[k].name, n.mix[k], 0, 100, 1, `${n.mix[k]}`)).join(''))
      + section('Order Units <small class="muted">(paid from treasury)</small>', ['army', 'navy', 'air', 'missile'].map(unitRow).join('')
        + `<div class="unit"><div><b>☢️ Nuclear Warhead</b><small>${n.techs.includes('str2') ? `${money(unitBuildCost(s, s.player, 'nuke'))} • 12 months • needs uranium` : 'Requires the Nuclear Weapons technology'}</small></div><div class="btns">${btn('Build', 'build-nuke', {}, { disabled: !n.techs.includes('str2') || n.nukeBuild > 0 })}</div></div>`
        + (queue.length ? `<h4>In production</h4>${queue.map((q) => `<div class="row"><span>${UNITS[q.type].icon} ${q.amount} ${UNITS[q.type].unit}</span><span class="muted">${fmtDate(s, q.done)}</span></div>`).join('')}` : ''))
      + section('Active Offensives', offs.length ? offs.map((o) => `<div class="off"><button class="nlink" data-act="select" data-t="${o.target}">${o.mode === 'naval' ? '⚓' : '🪖'} ${esc(TERR[o.target].name)}</button>${bar(o.prog, 100, 'var(--gold)', `${Math.round(o.prog)}% • ${num(o.divs, 1)} div • odds ${Math.round((o.ratio || 0.5) * 100)}%`)}${btn('Halt', 'halt-off', { t: o.target }, { cls: 'small' })}</div>`).join('') : '<p class="muted">No offensives. Select an enemy territory on the map and open its ⚔️ War tab to attack.</p>');
  },

  // ---------------- RESEARCH ----------------
  research(s) {
    const n = P();
    const avail = new Set(availableTechs(s, s.player).map((t) => t.id));
    const cur = n.research;
    const rp = researchPoints(s, s.player);
    const head = cur
      ? `<div class="cur-research"><b>${esc(TECH_BY_ID[cur.id].name)}</b>${bar(cur.prog, effectiveTechCost(s, s.player, cur.id), 'var(--accent)', `${Math.floor(cur.prog)} / ${Math.round(effectiveTechCost(s, s.player, cur.id))} • ~${Math.max(0, Math.ceil((effectiveTechCost(s, s.player, cur.id) - cur.prog) / Math.max(0.1, rp)))} months`)}</div>`
      : `<p class="warn">No active research — pick a technology below.${n.rpBank ? ` (${Math.floor(n.rpBank)} banked points)` : ''}</p>`;
    const queue = n.queue.length ? `<div class="queue">Queue: ${n.queue.map((q) => `<span class="chip">${esc(TECH_BY_ID[q].name)} <button class="mini" data-act="unqueue" data-t="${q}">✕</button></span>`).join('')}</div>` : '';
    const tree = Object.entries(BRANCHES).map(([bk, br]) => `<div class="branch"><div class="bname" style="color:${br.color}">${br.icon} ${br.name}</div><div class="techs">${TECHS.filter((t) => t.branch === bk).map((t) => {
      const done = n.techs.includes(t.id);
      const state = done ? 'done' : cur?.id === t.id ? 'active' : n.queue.includes(t.id) ? 'queued' : avail.has(t.id) ? 'avail' : 'locked';
      return `<button class="tech ${state}" data-act="research" data-t="${t.id}" ${done || state === 'locked' ? 'disabled' : ''} title="${esc(t.desc)}${t.req.length ? ' • Requires ' + t.req.map((r) => TECH_BY_ID[r].name).join(', ') : ''}"><small>T${t.tier}</small><b>${esc(t.name)}</b><span>${done ? '✓' : Math.round(effectiveTechCost(s, s.player, t.id)) + ' pts'}</span></button>`;
    }).join('')}</div></div>`).join('');
    return section(`Research <small class="muted">${rp.toFixed(1)} pts/month</small>`, head + queue + '<p class="muted small">Click an available tech to research it, or to queue it. Technologies many nations already know are cheaper. Raise the research budget, build labs and secure rare minerals to go faster.</p>') + `<section class="card tree">${tree}</section>`;
  },

  // ---------------- DIPLOMACY ----------------
  diplomacy(s) {
    const myBlocs = blocsOf(s, s.player);
    const leads = s.blocs.filter((b) => b.leader === s.player);
    const treaties = treatiesOf(s, s.player);
    const filter = (app.dipFilter || '').toLowerCase();
    const sort = app.dipSort || 'opinion';
    let list = aliveIds(s).filter((id) => id !== s.player && (!filter || s.nations[id].name.toLowerCase().includes(filter)));
    const key = { opinion: (id) => -opinion(s, id, s.player), power: (id) => -(s.nations[id].stats.power || 0), gdp: (id) => -(s.nations[id].stats.gdp || 0), name: (id) => s.nations[id].name };
    list.sort((a, b) => { const x = key[sort](a), y = key[sort](b); return x < y ? -1 : x > y ? 1 : 0; });
    list = list.slice(0, filter ? 80 : 60);
    return section('Alliances & Blocs', `
      ${myBlocs.length ? myBlocs.map((b) => `<div class="bloc"><span class="dot" style="background:${b.color}"></span><b>${esc(b.name)}</b> <span class="muted">${b.type} • ${b.members.length} members • led by ${esc(nameOf(s, b.leader))}</span>${btn('Leave', 'leave-bloc', { b: b.id }, { cls: 'small' })}</div>`).join('') : '<p class="muted">You are not in any bloc.</p>'}
      <div class="btns">${!leads.some((b) => b.type === 'military') ? btn('Found military alliance (50 PC)', 'found-bloc', { type: 'military' }) : ''}${!leads.some((b) => b.type === 'economic') ? btn('Found economic union (50 PC)', 'found-bloc', { type: 'economic' }) : ''}</div>
      <details><summary>Other blocs (${s.blocs.length - myBlocs.length})</summary>${s.blocs.filter((b) => !b.members.includes(s.player)).map((b) => `<div class="bloc"><span class="dot" style="background:${b.color}"></span><b>${esc(b.name)}</b> <span class="muted">${b.type} • ${b.members.length} • ${esc(nameOf(s, b.leader))}</span>${btn('Apply', 'join-bloc', { b: b.id }, { cls: 'small' })}</div>`).join('')}</details>
      <p class="muted small">Invite nations into a bloc you lead from their country panel.</p>`)
      + section('Your Treaties', treaties.length ? treaties.map((t) => {
        const other = t.a === s.player ? t.b : t.a;
        const label = t.type === 'guarantee' ? (t.a === s.player ? 'We guarantee' : 'Guarantees us') : TREATY_INFO[t.type].name;
        return `<div class="row"><button class="nlink" data-act="select-nation" data-n="${other}">${flag(s.nations[other])} ${esc(nameOf(s, other))}</button><span>${TREATY_INFO[t.type]?.icon || '🛡️'} ${label}</span>${t.type === 'guarantee' && t.b === s.player ? '' : btn('Cancel', 'cancel-treaty', { n: other, type: t.type }, { cls: 'small' })}</div>`;
      }).join('') : '<p class="muted">No treaties. Select a country to propose one.</p>')
      + section('Nations', `<div class="filters"><input type="search" placeholder="Search nations…" data-input="dip-filter" value="${esc(app.dipFilter || '')}"><select data-input="dip-sort">${['opinion', 'power', 'gdp', 'name'].map((k) => `<option value="${k}" ${sort === k ? 'selected' : ''}>Sort: ${k}</option>`).join('')}</select></div>
        <table class="tbl nations"><tr><th>Nation</th><th title="Their opinion of us">Opinion</th><th title="Trust in us">Trust</th><th title="Our influence">Infl.</th><th></th></tr>${list.map((id) => {
          const n = s.nations[id]; const op = Math.round(opinion(s, id, s.player));
          const icons = ['trade', 'nap', 'defense', 'research'].filter((t) => hasTreaty(s, id, s.player, t)).map((t) => TREATY_INFO[t].icon).join('') + (atWar(s, id, s.player) ? '⚔️' : '') + (n.overlord === s.player ? '👑' : '');
          return `<tr data-act="select-nation" data-n="${id}"><td>${flag(n)} ${esc(n.name)}</td><td style="color:${opinionColor(op)}">${op}</td><td>${Math.round(trust(s, id, s.player))}</td><td>${Math.round(influence(s, s.player, id))}</td><td>${icons}</td></tr>`;
        }).join('')}</table>`);
  },

  // ---------------- INTELLIGENCE ----------------
  intel(s) {
    const nets = Object.entries(s.spy).filter(([k]) => k.startsWith(s.player + '>')).map(([k, v]) => [k.split('>')[1], v]).sort((a, b) => b[1] - a[1]);
    const foreign = Object.entries(s.spy).filter(([k, v]) => k.endsWith('>' + s.player) && v > 25).map(([k, v]) => [k.split('>')[0], v]);
    return section('Our Spy Networks', nets.length ? nets.map(([id, v]) => `<div class="row"><button class="nlink" data-act="select-nation" data-n="${id}">${flag(s.nations[id])} ${esc(nameOf(s, id))}</button>${bar(v, 100, 'var(--purple)', Math.round(v))}</div>`).join('') : '<p class="muted">No networks yet. Select a country, open its 🕵️ Espionage tab and expand a network there.</p>')
      + section('Covert Operations', Object.entries(OPS).map(([, o]) => `<div class="row op"><span>${o.icon} <b>${o.name}</b></span><span class="muted small">${o.desc}${o.net ? ` Needs network ${o.net}.` : ''}${o.pc ? ` ${o.pc} PC.` : ''}${o.maxStab ? ` Target stability < ${o.maxStab}.` : ''}</span></div>`).join('') + '<p class="muted small">Exposed operations anger the target and damage your reputation. Networks decay slowly over time.</p>')
      + section('Counter-Intelligence', foreign.length ? `<p class="warn">Our security services detect foreign activity:</p>${foreign.map(([id, v]) => `<div class="row"><span>${flag(s.nations[id])} ${esc(nameOf(s, id))}</span>${bar(v, 100, 'var(--bad)', Math.round(v))}</div>`).join('')}` : '<p class="muted">No significant foreign spy networks detected.</p>');
  },

  // ---------------- TERRITORIES / EMPIRE ----------------
  territories(s) {
    const list = owned(s, s.player).sort((a, b) => s.terr[b].gdp - s.terr[a].gdp);
    const subs = subjectsOf(s, s.player);
    return section(`Territories (${list.length})`, `<table class="tbl"><tr><th>Territory</th><th>GDP</th><th>Pop</th><th>Unrest</th><th>Integr.</th><th>Gov.</th></tr>${list.map((tid) => {
      const t = s.terr[tid];
      return `<tr data-act="select" data-t="${tid}"><td>${t.ctrl !== s.player ? '⚠️ ' : ''}${esc(TERR[tid].name)}${t.build.length ? ' 🏗️' : ''}</td><td>${money(t.gdp)}</td><td>${pop(t.pop)}</td><td class="${t.unrest > 50 ? 'bad' : t.unrest > 25 ? 'warn' : ''}">${Math.round(t.unrest)}%</td><td>${t.core === s.player ? '—' : Math.round(t.integ) + '%'}</td><td>${t.governor ? '👤' : ''}</td></tr>`;
    }).join('')}</table><p class="muted small">Select a territory to build, appoint a governor, or release it as a puppet state. Conquered land is restless until integrated.</p>`)
      + section(`Subject Nations (${subs.length})`, subs.length ? subs.map((id) => {
        const n = s.nations[id];
        return `<div class="sub"><button class="nlink" data-act="select-nation" data-n="${id}">${flag(n)} <b>${esc(n.name)}</b></button><span class="muted small">${esc(GOVS[n.gov].name)} • ${esc(n.leader.name)}</span>${bar(n.liberty, 100, n.liberty > 60 ? 'var(--bad)' : 'var(--warn)', `Liberty desire ${Math.round(n.liberty)}%`)}<span class="muted small">Tribute ${Math.round(n.tribute * 100)}% • ${money(n.stats.tributePaid || 0)}/yr • ${owned(s, id).length} territories</span></div>`;
      }).join('') : '<p class="muted">No subjects. Win wars, stage coups or build influence to create puppet states.</p>');
  },

  // ---------------- WARS ----------------
  wars(s) {
    const wars = warsOf(s, s.player);
    if (!wars.length) return section('At Peace', '<p class="muted">We are not at war. To start one, select a nation and use the ⚔️ War tab. Wars without a justification cost political capital, stability and infamy — fabricate a claim with espionage or issue an ultimatum first.</p>');
    return wars.map((w) => {
      const mine = friendSide(w, s.player), theirs = enemySide(w, s.player);
      const myAllies = defenders(s, s.player).filter((a) => !mine.includes(a) && !theirs.includes(a));
      const enemyRows = theirs.map((e) => {
        const sc = warScore(s, w, s.player, e);
        return `<div class="row"><button class="nlink" data-act="select-nation" data-n="${e}">${flag(s.nations[e])} ${esc(nameOf(s, e))}</button><span class="${sc >= 0 ? 'good' : 'bad'}">War score ${signed(sc)}</span>${btn('Negotiate', 'peace', { w: w.id, e }, { cls: 'small' })}</div>`;
      }).join('');
      const offs = w.offs.filter((o) => mine.includes(o.by) || theirs.includes(o.by));
      return section(`⚔️ ${esc(w.name)}`, `
        <p class="muted small">Since ${fmtDate(s, w.start)} • ${esc(w.cb)}</p>
        <div class="sides"><div><h4>Our side</h4>${mine.map((m) => `<div>${flag(s.nations[m])} ${esc(nameOf(s, m))}</div>`).join('')}</div><div><h4>Enemies</h4>${theirs.map((m) => `<div>${flag(s.nations[m])} ${esc(nameOf(s, m))}</div>`).join('')}</div></div>
        <h4>Peace</h4>${enemyRows}
        ${myAllies.length ? `<h4>Call allies</h4>${myAllies.map((a) => `<div class="row"><span>${flag(s.nations[a])} ${esc(nameOf(s, a))}</span>${btn('Call to arms', 'call-ally', { w: w.id, a }, { cls: 'small' })}</div>`).join('')}` : ''}
        <h4>Fronts</h4>${offs.length ? offs.map((o) => `<div class="off"><button class="nlink" data-act="select" data-t="${o.target}">${o.by === s.player ? '🟡' : mine.includes(o.by) ? '🔵' : '🔴'} ${esc(nameOf(s, o.by))} → ${esc(TERR[o.target].name)}</button>${bar(o.prog, 100, mine.includes(o.by) ? 'var(--gold)' : 'var(--bad)', `${Math.round(o.prog)}% • ${num(o.divs, 1)} div`)}</div>`).join('') : '<p class="muted">No active offensives.</p>'}`);
    }).join('');
  },

  // ---------------- WORLD ----------------
  world(s) {
    const lb = leaderboard(s).slice(0, 25);
    const allWars = s.wars;
    return section('Global Power Ranking', `<table class="tbl"><tr><th>#</th><th>Realm</th><th>Score</th><th>GDP</th><th>Power</th><th>Terr.</th></tr>${lb.map((r, i) => `<tr data-act="select-nation" data-n="${r.id}" class="${r.id === s.player ? 'me' : ''}"><td>${i + 1}</td><td>${flag(s.nations[r.id])} ${esc(s.nations[r.id].name)}${r.subjects ? ` <small class="muted">+${r.subjects}</small>` : ''}</td><td>${num(r.score)}</td><td>${money(r.gdp)}</td><td>${num(r.power)}</td><td>${r.terr}</td></tr>`).join('')}</table>`)
      + section(`Wars Around the World (${allWars.length})`, allWars.length ? allWars.map((w) => `<div class="row war"><span>⚔️ <b>${esc(w.name)}</b></span><span class="muted small">${w.att.map((x) => s.nations[x].flag || x).join(' ')} vs ${w.def.map((x) => s.nations[x].flag || x).join(' ')} • since ${fmtMonth(s, w.start)}</span></div>`).join('') : '<p class="muted">The world is at peace — for now.</p>')
      + section('Coalitions', s.coalitions.length ? s.coalitions.map((c) => `<div class="row"><span>🛡️ Against <b>${esc(nameOf(s, c.target))}</b></span><span class="muted small">${c.members.length} members: ${c.members.slice(0, 12).map((m) => s.nations[m].flag || m).join(' ')}</span></div>`).join('') : '<p class="muted">No coalitions.</p>')
      + section('Blocs', s.blocs.map((b) => `<div class="row"><span><span class="dot" style="background:${b.color}"></span> <b>${esc(b.name)}</b></span><span class="muted small">${b.type} • ${b.members.length} members • ${esc(nameOf(s, b.leader))}</span></div>`).join(''))
      + section('World Markets', `<table class="tbl"><tr><th>Commodity</th><th>Price</th></tr>${RES_KEYS.map((k) => `<tr><td>${RESOURCES[k].icon} ${RESOURCES[k].name}</td><td class="${s.market[k] > 1.15 ? 'good' : s.market[k] < 0.85 ? 'bad' : ''}">${s.market[k].toFixed(2)}×</td></tr>`).join('')}</table>
        ${kv([['Global economy', s.world.cycle < -0.01 ? '<span class="bad">Recession</span>' : s.world.cycle > 0.008 ? '<span class="good">Boom</span>' : 'Normal'], ['Nuclear weapons used', s.world.nukesUsed], ['Nations remaining', aliveIds(s).length]])}`);
  },

  // ---------------- STATISTICS ----------------
  stats(s) {
    const hof = hallOfFame();
    return section('Your Empire Over Time', `<h4>World domination %</h4><canvas class="chart" id="ch-dom"></canvas><h4>GDP ($B)</h4><canvas class="chart" id="ch-gdp"></canvas><h4>Military power</h4><canvas class="chart" id="ch-pow"></canvas><h4>Treasury & debt ($B)</h4><canvas class="chart" id="ch-money"></canvas>`)
      + section('Rise and Fall of the Great Powers', '<canvas class="chart tall" id="ch-top"></canvas>')
      + section('Hall of Fame', hof.length ? `<table class="tbl"><tr><th>Nation</th><th>Result</th><th>Year</th><th>Score</th></tr>${hof.slice(0, 15).map((h) => `<tr><td>${esc(h.flag || '')} ${esc(h.nation)}</td><td>${esc(h.result)}</td><td>${h.year}</td><td>${num(h.score)}</td></tr>`).join('')}</table>` : '<p class="muted">Finished campaigns are recorded here.</p>');
  },

  // ---------------- NEWS ----------------
  news(s) {
    const f = app.newsFilter || 'all';
    const items = s.news.filter((n) => f === 'all' || (f === 'mine' && n.n.includes(s.player)) || (f === 'war' && (n.type === 'war' || n.type === 'peace' || n.type === 'nuke')) || (f === 'major' && (n.type === 'major' || n.type === 'nuke'))).slice(0, 200);
    return `<div class="filters">${['all', 'mine', 'war', 'major'].map((k) => `<button class="opt small ${f === k ? 'on' : ''}" data-act="news-filter" data-f="${k}">${{ all: 'All', mine: 'Our nation', war: 'Wars', major: 'Major' }[k]}</button>`).join('')}</div>
      <div class="newslist">${items.map((n) => `<div class="news ${n.type}"><small>${fmtDate(s, n.day)}</small> ${esc(n.text)}</div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>`;
  },

  // ---------------- MENU ----------------
  menu(s) {
    const saves = listSaves();
    return section('Save Game', `<div class="btns">${['slot1', 'slot2', 'slot3'].map((k, i) => btn(`💾 Slot ${i + 1}`, 'save', { slot: k })).join('')}${btn('⬇️ Export file', 'export')}</div>`)
      + section('Load Game', `${saves.length ? saves.map((x) => `<div class="row"><span>${esc(x.flag || '')} <b>${esc(x.nation)}</b> <span class="muted small">${esc(x.label)} • ${esc(fmtDate({ startYear: x.startYear || 2027 }, x.day))} • ${new Date(x.time).toLocaleString()}</span></span><span>${btn('Load', 'load', { slot: x.slot }, { cls: 'small' })}${btn('🗑', 'delete-save', { slot: x.slot }, { cls: 'small' })}</span></div>`).join('') : '<p class="muted">No saved games.</p>'}<label class="btn file">⬆️ Import file<input type="file" accept=".json,application/json" data-input="import" hidden></label>`)
      + section('Settings', `
        <label class="check"><input type="checkbox" data-input="set-labels" ${app.settings.labels ? 'checked' : ''}> Show nation names on the map</label>
        <label class="check"><input type="checkbox" data-input="set-autosave" ${app.settings.autosave ? 'checked' : ''}> Autosave every year</label>
        <label class="check"><input type="checkbox" data-input="set-pause" ${app.settings.pauseOnEvents ? 'checked' : ''}> Pause when a decision is needed</label>
        <p class="muted small">Seed <code>${esc(s.seed)}</code> • ${esc(s.difficulty)} • ${esc(s.worldMode)}</p>`)
      + section('Game', `<div class="btns">${btn('📖 How to play', 'howto')}${btn('🏠 Quit to main menu', 'quit', {}, { cls: 'danger' })}</div>`);
  },
};

const AFTER = {
  stats(s) {
    const H = s.history.player;
    const x = (r) => r.d;
    const xfmt = (d) => String(s.startYear + Math.floor(d / 360));
    const draw = (id, series, opts = {}) => { const c = document.getElementById(id); if (c) lineChart(c, series, { xfmt, ...opts }); };
    draw('ch-dom', [{ points: H.map((r) => [x(r), r.dom]), color: '#e6c84a' }], { fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + '%' });
    draw('ch-gdp', [{ points: H.map((r) => [x(r), r.gdp]), color: '#3fb950' }], { fmt: (v) => money(v) });
    draw('ch-pow', [{ points: H.map((r) => [x(r), r.power]), color: '#f85149' }]);
    draw('ch-money', [{ points: H.map((r) => [x(r), r.treasury]), color: '#e3b341', label: 'Treasury' }, { points: H.map((r) => [x(r), r.debt]), color: '#8b949e', label: 'Debt' }], { fmt: (v) => money(v) });
    const T = s.history.top;
    const ids = new Set();
    for (const row of T.slice(-1)) row.top.slice(0, 7).forEach(([id]) => ids.add(id));
    ids.add(s.player);
    draw('ch-top', [...ids].map((id) => ({ points: T.map((row) => [row.d, (row.top.find(([k]) => k === id) || [0, null])[1]]).filter((p) => p[1] != null), color: s.nations[id].color, label: s.nations[id].flag || id, width: id === s.player ? 3 : 1.5 })));
  },
};

// ---------- Handlers ----------
const refreshNoPanel = () => hooks.refreshAll(true);
on('input:tax', (v, el, done) => { A.setTax(app.s, +v); liveBudget(el); if (done) refreshNoPanel(); });
for (const k of ['mil', 'res', 'infra', 'welfare']) on(`input:budget-${k}`, (v, el, done) => { A.setBudget(app.s, k, +v); liveBudget(el); if (done) refreshNoPanel(); });
for (const k of ['army', 'navy', 'air', 'missile']) on(`input:mix-${k}`, (v, el, done) => { A.setMix(app.s, k, +v); const o = el.parentElement.querySelector('b'); if (o) o.textContent = v; if (done) refreshNoPanel(); });
function liveBudget(el) {
  const s = app.s, n = P();
  const b = budgetOf(s, s.player);
  const set = (id, txt) => { const o = document.querySelector(`[data-out="${id}"]`); if (o) o.textContent = txt; };
  set('tax', `${n.tax}% • ${money(b.income.taxes)}`);
  set('budget-mil', `${n.budget.mil.toFixed(1)}% • ${money(b.expense.military)}`);
  set('budget-res', `${n.budget.res.toFixed(1)}% • ${money(b.expense.research)}`);
  set('budget-infra', `${n.budget.infra.toFixed(1)}% • ${money(b.expense.infrastructure)}`);
  set('budget-welfare', `${n.budget.welfare.toFixed(1)}% • ${money(b.expense.welfare)}`);
  const bal = document.querySelector('.balance');
  if (bal) { bal.className = `balance ${b.balance >= 0 ? 'good' : 'bad'}`; bal.innerHTML = `Balance: <b>${money(b.balance, true)}/yr</b> (${money(b.balance / 12, true)}/month)`; }
  void el;
}
on('mobil', (d) => result(A.setMobil(app.s, +d.v)));
on('independence', () => { if (confirm('Declare independence? Our overlord will fight to keep us.')) result(A.declareIndependence(app.s)); });
on('gov-reform', (d) => { if (confirm(`Reform the state into a ${GOVS[d.g].name}? Costs 100 political capital and 15 stability.`)) result(A.changeGovernment(app.s, d.g)); });
on('borrow', (d) => result(A.borrow(app.s, +d.v)));
on('repay', (d) => result(A.repay(app.s, +d.v)));
on('recruit', (d) => result(A.recruit(app.s, d.type, +d.v)));
on('build-nuke', () => result(A.buildNuke(app.s)));
on('halt-off', (d) => result(A.haltOffensive(app.s, d.t)));
on('research', (d) => result(A.research(app.s, d.t)));
on('unqueue', (d) => result(A.unqueue(app.s, d.t)));
on('found-bloc', (d) => {
  const name = prompt(`Name your ${d.type === 'military' ? 'military alliance' : 'economic union'}:`, `${P().name} ${d.type === 'military' ? 'Pact' : 'Economic Union'}`);
  if (name !== null) result(A.createBloc(app.s, name.trim().slice(0, 40), d.type));
});
on('join-bloc', (d) => result(A.requestJoinBloc(app.s, d.b)));
on('leave-bloc', (d) => result(A.quitBloc(app.s, d.b)));
on('cancel-treaty', (d) => { if (confirm('Cancel this treaty? They will remember it.')) result(A.cancelTreaty(app.s, d.n, d.type)); });
on('input:dip-filter', (v, el, done) => { if (done) return; app.dipFilter = v; renderPanel(app); const i = document.querySelector('[data-input="dip-filter"]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } void el; });
on('input:dip-sort', (v, el, done) => { if (done) { app.dipSort = v; renderPanel(app); } });
on('peace', (d) => peaceDialog(app, +d.w, d.e));
on('call-ally', (d) => result(A.callAlly(app.s, +d.w, d.a)));
on('news-filter', (d) => { app.newsFilter = d.f; renderPanel(app); });
on('save', (d) => { const r = saveGame(app.s, d.slot, `Slot ${d.slot.slice(-1)}`); toast(r.msg, r.ok ? 'good' : 'bad'); renderPanel(app); });
on('export', () => exportFile(app.s));
on('load', (d) => { try { hooks.startGame(loadGame(d.slot)); toast('Game loaded', 'good'); } catch (e) { toast(e.message, 'bad'); } });
on('delete-save', (d) => { if (confirm('Delete this save?')) { deleteSave(d.slot); renderPanel(app); } });
on('input:import', (v, el, done) => {
  if (!done || !el.files?.[0]) return;
  el.files[0].text().then((txt) => { try { hooks.startGame(deserialize(txt)); toast('Game imported', 'good'); } catch (e) { toast(e.message, 'bad'); } });
});
on('input:set-labels', (v, el, done) => { if (done) { app.settings.labels = el.checked; saveSettings(); hooks.refreshAll(false); } });
on('input:set-autosave', (v, el, done) => { if (done) { app.settings.autosave = el.checked; saveSettings(); } });
on('input:set-pause', (v, el, done) => { if (done) { app.settings.pauseOnEvents = el.checked; saveSettings(); } });
on('howto', () => howToPlay(app));
on('quit', () => { if (confirm('Quit to the main menu? Unsaved progress since the last autosave is lost.')) { app.s && saveGame(app.s, 'autosave', 'Autosave'); location.reload(); } });
