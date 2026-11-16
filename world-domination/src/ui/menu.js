// Title screen and new-game setup.
import { TERR } from '../engine/world.js';
import { GOVS } from '../data/people.js';
import { newGame, DIFFICULTY, WORLD_MODES } from '../engine/setup.js';
import { owned, leaderTitle, nationGdp } from '../engine/state.js';
import { listSaves, loadGame, hallOfFame } from '../engine/save.js';
import { app, on, modal, closeModal, toast, hooks } from './core.js';
import { esc, money, num, pop, flag } from './fmt.js';
import { howToPlay } from './dialogs.js';
import { computeLabels } from './mapmodes.js';

const setup = { player: null, difficulty: 'normal', worldMode: 'realistic', seed: randomSeed(), filter: '', tier: 'all' };
function randomSeed() { return String(Math.floor(Math.random() * 900000) + 100000); }

function tierOf(n) {
  const g = n.stats.gdp || 0;
  if (g > 10000) return ['Superpower', 1];
  if (g > 1500) return ['Great Power', 2];
  if (g > 250) return ['Regional Power', 3];
  if (g > 25) return ['Minor Nation', 4];
  return ['Microstate', 5];
}
const stars = (k) => '★'.repeat(k) + '☆'.repeat(5 - k);

function preview() {
  const key = `${setup.seed}:${setup.worldMode}`;
  if (app.previewKey !== key) {
    app.s = newGame({ player: setup.player || 'USA', seed: setup.seed, worldMode: setup.worldMode, difficulty: setup.difficulty });
    app.previewKey = key;
    app.map.ownerRev = -1;
    hooks.refreshMap();
  }
  return app.s;
}

export function showMainMenu() {
  app.screen = 'menu';
  document.body.className = 'menu-mode';
  preview();
  app.map.fitAll();
  app.map.autoPan = true;
  const saves = listSaves();
  const last = saves[0];
  const el = document.getElementById('screen');
  el.hidden = false;
  el.innerHTML = `<div class="title-screen">
    <div class="logo"><div class="globe">🌍</div><h1>WORLD<br>DOMINATION</h1><p>Lead one nation. Rule them all.</p></div>
    <div class="menu-buttons">
      <button class="btn primary big" data-act="menu-new">New Campaign</button>
      ${last ? `<button class="btn big" data-act="menu-continue">Continue <small>${esc(last.flag || '')} ${esc(last.nation)} — ${esc(last.label)}</small></button>` : ''}
      ${saves.length ? `<button class="btn big" data-act="menu-load">Load Game</button>` : ''}
      <label class="btn big file">Import Save<input type="file" accept=".json,application/json" data-input="menu-import" hidden></label>
      <button class="btn big" data-act="menu-howto">How to Play</button>
      <button class="btn big" data-act="menu-hof">Hall of Fame</button>
    </div>
    <p class="credits">Borders: Natural Earth • 203 territories • every playthrough is different</p>
  </div>`;
}

function showSetup() {
  app.screen = 'setup';
  document.body.className = 'setup-mode';
  app.map.autoPan = false;
  preview();
  renderSetup();
}

function renderSetup() {
  const s = preview();
  const el = document.getElementById('screen');
  el.hidden = false;
  const f = setup.filter.toLowerCase();
  const ids = Object.keys(s.nations).filter((id) => s.nations[id].alive && (!f || s.nations[id].name.toLowerCase().includes(f)));
  const tiers = { all: 'All', 1: 'Superpowers', 2: 'Great', 3: 'Regional', 4: 'Minor', 5: 'Micro' };
  const list = ids.map((id) => ({ id, n: s.nations[id], t: tierOf(s.nations[id]) }))
    .filter((x) => setup.tier === 'all' || String(x.t[1]) === setup.tier)
    .sort((a, b) => (b.n.stats.gdp || 0) - (a.n.stats.gdp || 0));
  const sel = setup.player ? s.nations[setup.player] : null;
  el.innerHTML = `<div class="setup">
    <aside class="setup-side">
      <header><button class="btn small" data-act="menu-back">← Back</button><h2>Choose your nation</h2></header>
      <input type="search" placeholder="Search ${ids.length} nations…" data-input="setup-filter" value="${esc(setup.filter)}">
      <div class="seg tiers">${Object.entries(tiers).map(([k, v]) => `<button data-act="setup-tier" data-t="${k}" class="${setup.tier === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="nation-list">${list.map(({ id, n, t }) => `<button class="nation-row ${setup.player === id ? 'on' : ''}" data-act="setup-pick" data-n="${id}">${flag(n)}<span><b>${esc(n.name)}</b><small>${t[0]} • ${money(n.stats.gdp || 0)}</small></span><em title="Challenge">${stars(t[1])}</em></button>`).join('')}</div>
    </aside>
    <section class="setup-detail">
      ${sel ? nationCard(s, sel) : '<div class="card hint">Click a country on the map or pick one from the list.</div>'}
      <div class="card opts">
        <h3>Difficulty</h3><div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-act="setup-diff" data-v="${k}" class="${setup.difficulty === k ? 'on' : ''}">${d.name}</button>`).join('')}</div>
        <h3>World</h3><div class="seg">${Object.entries(WORLD_MODES).map(([k, m]) => `<button data-act="setup-mode" data-v="${k}" class="${setup.worldMode === k ? 'on' : ''}" title="${esc(m.desc)}">${m.name}</button>`).join('')}</div>
        <p class="muted small">${esc(WORLD_MODES[setup.worldMode].desc)}</p>
        <h3>Seed</h3><div class="seedrow"><input type="text" data-input="setup-seed" value="${esc(setup.seed)}" maxlength="24"><button class="btn small" data-act="setup-dice" title="New random world">🎲</button></div>
        <p class="muted small">Same seed + same choices = same world. Leaders, events and wars are different every seed.</p>
        <button class="btn primary big" data-act="setup-start" ${sel ? '' : 'disabled'}>${sel ? `Lead ${esc(sel.name)} →` : 'Select a nation'}</button>
      </div>
    </section>
  </div>`;
}

function nationCard(s, n) {
  const t = tierOf(n);
  const res = Object.entries(n.stats.resProd || {}).filter(([, v]) => v > 0.05).map(([k]) => k);
  const blocs = s.blocs.filter((b) => b.members.includes(n.id)).map((b) => b.name);
  return `<div class="card nation-card" style="--c:${n.color}">
    <div class="nc-head">${flag(n)}<div><h2>${esc(n.name)}</h2><div class="muted">${esc(GOVS[n.gov].name)} • ${esc(leaderTitle(n))} ${esc(n.leader.name)}</div></div></div>
    <div class="nc-stars">Challenge: <b>${stars(t[1])}</b> <span class="muted">${t[0]}</span></div>
    <dl class="kv">
      <dt>GDP</dt><dd>${money(n.stats.gdp || 0)}</dd>
      <dt>Population</dt><dd>${pop(n.stats.pop || 0)}</dd>
      <dt>Military power</dt><dd>${num(n.stats.power || 0)} <small class="muted">🪖${num(n.army, 0)} 🚢${num(n.navy, 0)} ✈️${num(n.air, 0)}${n.nukes ? ` ☢️${n.nukes}` : ''}</small></dd>
      <dt>Technologies</dt><dd>${n.techs.length}</dd>
      <dt>Territories</dt><dd>${owned(s, n.id).map((t) => esc(TERR[t].name)).join(', ')}</dd>
      <dt>Alliances</dt><dd>${blocs.length ? esc(blocs.join(', ')) : '<span class="muted">none</span>'}</dd>
      <dt>Leader traits</dt><dd>${n.leader.traits.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')}</dd>
    </dl>
  </div>`;
}

on('menu-new', () => showSetup());
on('menu-back', () => showMainMenu());
on('menu-howto', () => howToPlay());
on('menu-continue', () => { const last = listSaves()[0]; try { hooks.startGame(loadGame(last.slot)); } catch (e) { toast(e.message, 'bad'); } });
on('menu-load', () => {
  const saves = listSaves();
  modal(`<h2>Load Game</h2>${saves.map((x) => `<div class="row"><span>${esc(x.flag || '')} <b>${esc(x.nation)}</b> <span class="muted small">${esc(x.label)} • year ${Math.floor(x.day / 360) + (x.startYear || 2027)} • ${new Date(x.time).toLocaleString()}</span></span><button class="btn small" data-act="menu-load-slot" data-slot="${esc(x.slot)}">Load</button></div>`).join('')}`);
});
on('menu-load-slot', (d) => { closeModal(); try { hooks.startGame(loadGame(d.slot)); } catch (e) { toast(e.message, 'bad'); } });
on('menu-hof', () => {
  const hof = hallOfFame();
  modal(`<h2>🏆 Hall of Fame</h2>${hof.length ? `<table class="tbl"><tr><th>Nation</th><th>Result</th><th>Year</th><th>Difficulty</th><th>Score</th></tr>${hof.map((h) => `<tr><td>${esc(h.flag || '')} ${esc(h.nation)}</td><td>${esc(h.result)}</td><td>${h.year}</td><td>${esc(h.difficulty || '')}</td><td>${num(h.score)}</td></tr>`).join('')}</table>` : '<p class="muted">No finished campaigns yet. Conquer the world to get on the board.</p>'}`);
});
on('input:menu-import', (v, el, done) => {
  if (!done || !el.files?.[0]) return;
  import('../engine/save.js').then(({ deserialize }) => el.files[0].text().then((txt) => { try { hooks.startGame(deserialize(txt)); } catch (e) { toast(e.message, 'bad'); } }));
});
on('setup-pick', (d) => pickNation(d.n, true));
on('setup-tier', (d) => { setup.tier = d.t; renderSetup(); });
on('setup-diff', (d) => { setup.difficulty = d.v; renderSetup(); });
on('setup-mode', (d) => { setup.worldMode = d.v; renderSetup(); });
on('setup-dice', () => { setup.seed = randomSeed(); renderSetup(); });
on('input:setup-seed', (v, el, done) => { if (done) { setup.seed = v.trim() || randomSeed(); renderSetup(); } });
on('input:setup-filter', (v, el, done) => {
  if (done) return;
  setup.filter = v;
  renderSetup();
  const i = document.querySelector('[data-input="setup-filter"]');
  if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
});
on('setup-start', () => {
  if (!setup.player) return;
  const s = newGame({ player: setup.player, seed: setup.seed, worldMode: setup.worldMode, difficulty: setup.difficulty });
  app.previewKey = null;
  hooks.startGame(s, { intro: () => intro(s) });
});

function pickNation(nid, fly) {
  const s = preview();
  if (!s.nations[nid]?.alive) return;
  setup.player = nid;
  const cap = s.nations[nid].capital;
  app.map.selected = cap;
  app.map.highlight = owned(s, nid);
  app.map.highlightColor = 'rgba(255,230,140,0.8)';
  app.map.needsDraw = true;
  if (fly && cap) app.map.flyTo(cap, Math.min(6, app.map.view.z * 1.0 + 1.5));
  renderSetup();
}
app.onSetupPick = (tid) => { if (tid && app.s) pickNation(app.s.terr[tid].owner, false); };

function intro(s) {
  const P = s.nations[s.player];
  modal(`<div class="intro">
    <h2>${flag(P)} ${esc(P.name)}, ${s.startYear}</h2>
    <p>${esc(leaderTitle(P))} <b>${esc(P.leader.name)}</b>, the world awaits. ${Object.keys(s.nations).length} nations stand between you and total domination.</p>
    <ul>
      <li>⏸ The game is <b>paused</b>. Press <kbd>Space</kbd> or the speed buttons (top right) to let time flow.</li>
      <li>🗺️ Click any country to see its leader, what it thinks of you, and what you can do to it.</li>
      <li>💰 Check your budget first — then 🔬 pick a research project.</li>
      <li>🤝 Friends make conquest easier. ☠️ Infamy makes enemies of everyone.</li>
    </ul>
    <div class="choices"><button class="btn" data-act="howto">Full guide</button><button class="btn primary" data-act="close-modal">Begin</button></div>
  </div>`, { wide: false });
}
export { computeLabels };
