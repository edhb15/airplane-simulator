// Modal dialogs: decisions, peace conferences, victory/defeat and help.
import { TERR } from '../engine/world.js';
import { TREATY_INFO } from '../engine/diplomacy.js';
import { DECISIONS } from '../engine/events.js';
import { owned, nameOf, fmtDate, enemySide } from '../engine/state.js';
import { warScore, peaceAcceptance, termsCost, territoryValue, capitulated, makePeace } from '../engine/military.js';
import { domination, leaderboard } from '../engine/sim.js';
import { recordResult } from '../engine/save.js';
import * as A from '../engine/actions.js';
import { app, on, modal, closeModal, result, toast, hooks } from './core.js';
import { esc, money, pct, flag, signed, num } from './fmt.js';

const choiceBtn = (i, label, desc, cls = '') => `<button class="choice ${cls}" data-act="answer" data-i="${i}"><b>${esc(label)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</button>`;

export function showPending(app) {
  const s = app.s;
  const p = s.pending[0];
  if (!p) return;
  if (app.settings.pauseOnEvents) hooks.setSpeed(0);
  const N = (id) => s.nations[id];
  let html = '';
  switch (p.kind) {
    case 'event': {
      const def = DECISIONS[p.id];
      html = `<h2>${esc(def.title)}</h2><p>${esc(def.text(s, p.data))}</p><div class="choices">${def.choices.map((c, i) => choiceBtn(i, c.label, c.desc)).join('')}</div>`;
      break;
    }
    case 'callToArms':
      html = `<h2>⚔️ Call to Arms</h2><p>${flag(N(p.ally))} <b>${esc(nameOf(s, p.ally))}</b> has been attacked by ${flag(N(p.enemy))} <b>${esc(nameOf(s, p.enemy))}</b> and invokes our obligations.</p><div class="choices">${choiceBtn(0, 'Honor our word', 'Join the war in their defense')}${choiceBtn(1, 'Abandon them', 'They — and everyone watching — will remember. The treaty is void.', 'danger')}</div>`;
      break;
    case 'joinOffensive':
      html = `<h2>⚔️ An Ally Goes to War</h2><p>${flag(N(p.ally))} <b>${esc(nameOf(s, p.ally))}</b> has attacked ${flag(N(p.enemy))} <b>${esc(nameOf(s, p.enemy))}</b> and asks us to join.</p><div class="choices">${choiceBtn(0, 'Join the attack', '')}${choiceBtn(1, 'Stay out', 'No penalty — it is an offensive war')}</div>`;
      break;
    case 'proposal':
      html = `<h2>${TREATY_INFO[p.treaty].icon} Diplomatic Proposal</h2><p>${flag(N(p.from))} <b>${esc(nameOf(s, p.from))}</b> proposes a <b>${TREATY_INFO[p.treaty].name}</b>. ${esc(TREATY_INFO[p.treaty].desc)}</p><div class="choices">${choiceBtn(0, 'Accept', '')}${choiceBtn(1, 'Decline', 'Slightly offends them')}</div>`;
      break;
    case 'peaceDemand':
      html = `<h2>🏳️ Peace Demands</h2><p>${flag(N(p.from))} <b>${esc(nameOf(s, p.from))}</b> offers to end the war if we accept:</p>${termsList(s, p.terms, p.from, s.player)}<div class="choices">${choiceBtn(0, 'Accept their terms', '')}${choiceBtn(1, 'Fight on', '')}</div>`;
      break;
    case 'peaceOffer':
      html = `<h2>🕊️ Peace Offer</h2><p>${flag(N(p.from))} <b>${esc(nameOf(s, p.from))}</b> wants to end the war and offers:</p>${termsList(s, p.terms, s.player, p.from) || '<p>A white peace — everything returns to how it was.</p>'}<div class="choices">${choiceBtn(0, 'Accept', '')}${choiceBtn(1, 'Refuse', 'Continue the war')}</div>`;
      break;
    case 'ultimatum':
      html = `<h2>⚠️ Ultimatum</h2><p>${flag(N(p.from))} <b>${esc(nameOf(s, p.from))}</b> demands that we hand over <b>${esc(TERR[p.terr].name)}</b> — or face war.</p><div class="choices">${choiceBtn(0, 'Give in', `Lose ${TERR[p.terr].name}, -10 stability`)}${choiceBtn(1, 'Defy them', 'They will most likely attack', 'danger')}</div>`;
      break;
    case 'retaliate':
      html = `<h2>☢️ NUCLEAR ATTACK</h2><p>${flag(N(p.enemy))} <b>${esc(nameOf(s, p.enemy))}</b> has used nuclear weapons against us or our allies. Our warheads are ready. Do we retaliate against their capital?</p><div class="choices">${choiceBtn(0, 'Retaliate', 'Mutually assured destruction', 'danger')}${choiceBtn(1, 'Hold fire', 'Show restraint')}</div>`;
      break;
    case 'dictate': {
      closeModal();
      s.pending.shift();
      const w = s.wars.find((x) => x.id === p.war);
      if (w && N(p.loser)?.alive && enemySide(w, s.player).includes(p.loser)) peaceDialog(app, w.id, p.loser, true);
      return;
    }
    case 'surrender':
      html = `<h2>🏳️ We Have Capitulated</h2><p>Our armies are broken. ${flag(N(p.winner))} <b>${esc(nameOf(s, p.winner))}</b> has imposed peace:</p>${termsList(s, p.terms, p.winner, s.player) || '<p>A white peace.</p>'}<div class="choices">${choiceBtn(0, 'Accept our fate', '')}</div>`;
      break;
    default:
      s.pending.shift();
      return;
  }
  modal(`<div class="decision">${html}</div>`, { dismissible: false });
  app.pendingAnswer = p;
}

function termsList(s, terms, winner, loser) {
  if (!terms) return '';
  const items = [];
  if (terms.annex?.length) items.push(`${esc(nameOf(s, winner))} annexes ${terms.annex.map((t) => esc(TERR[t].name)).join(', ')}`);
  if (terms.puppet) items.push(`${esc(nameOf(s, loser))} becomes a puppet of ${esc(nameOf(s, winner))}`);
  if (terms.reparations) items.push(`${esc(nameOf(s, loser))} pays war reparations`);
  return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
}

on('answer', (d) => {
  const s = app.s;
  const p = app.pendingAnswer;
  const idx = s.pending.indexOf(p);
  closeModal();
  if (p?.kind === 'surrender') { s.pending.splice(idx, 1); hooks.refreshAll(true); return; }
  if (idx >= 0) result(A.answer(s, idx, +d.i));
});

// ---------- Peace conference ----------
export function peaceDialog(app, warId, enemy, dictate = false) {
  const s = app.s;
  const w = s.wars.find((x) => x.id === warId);
  if (!w) return;
  hooks.setSpeed(0);
  const st = { annex: new Set(), puppet: false, reparations: false, concede: false };
  const render = () => {
    const score = warScore(s, w, s.player, enemy);
    const E = s.nations[enemy];
    const occupied = owned(s, enemy).filter((t) => s.terr[t].ctrl === s.player);
    const theirOccupation = owned(s, s.player).filter((t) => s.terr[t].ctrl === enemy);
    const terms = { annex: [...st.annex], puppet: st.puppet, reparations: st.reparations };
    let verdictHtml;
    if (!st.concede) {
      const acc = peaceAcceptance(s, w, s.player, enemy, terms);
      verdictHtml = `<div class="verdict-box ${acc.accept ? 'good' : 'bad'}"><b>${acc.accept ? '✔ They will accept' : '✘ They will refuse'}</b> <span>(${signed(acc.total)})</span><div class="small">${acc.parts.map(([l, v]) => `${esc(l)} ${signed(v)}`).join(' • ')}</div></div>`;
    } else {
      const theirScore = warScore(s, w, enemy, s.player);
      const cost = termsCost(s, w, enemy, s.player, terms);
      const want = theirScore - E.warEx * 0.4 - 5;
      verdictHtml = `<div class="verdict-box ${cost >= want ? 'good' : 'bad'}"><b>${cost >= want ? '✔ They will accept' : '✘ Not enough for them'}</b> <span>(offering ${cost} • they expect ~${Math.max(0, Math.round(want))})</span></div>`;
    }
    const cost = termsCost(s, w, s.player, enemy, terms);
    const box = modal(`<div class="peace">
      <h2>🕊️ Peace with ${flag(E)} ${esc(E.name)}</h2>
      <p class="muted">${esc(w.name)} • War score <b class="${score >= 0 ? 'good' : 'bad'}">${signed(score)}</b>${capitulated(s, enemy) ? ' • <b class="good">They have capitulated</b>' : ''}${dictate ? ' • You dictate the terms' : ''}</p>
      <div class="seg">${'<button data-act="pd-mode" data-v="0" class="' + (!st.concede ? 'on' : '') + '">Our demands</button>'}${dictate ? '' : '<button data-act="pd-mode" data-v="1" class="' + (st.concede ? 'on' : '') + '">Concessions we offer</button>'}</div>
      ${!st.concede ? `
        <h4>Annex occupied territory</h4>${occupied.length ? occupied.map((t) => `<label class="check"><input type="checkbox" data-act="pd-annex" data-t="${t}" ${st.annex.has(t) ? 'checked' : ''}> ${esc(TERR[t].name)} <span class="muted small">cost ${Math.max(4, Math.round((territoryValue(s, t) / Math.max(1, nationValueOf(s, enemy))) * 100))}</span></label>`).join('') : '<p class="muted small">We occupy none of their land.</p>'}
        <label class="check"><input type="checkbox" data-act="pd-puppet" ${st.puppet ? 'checked' : ''}> 👑 Install a puppet government (they become our subject)</label>
        <label class="check"><input type="checkbox" data-act="pd-rep" ${st.reparations ? 'checked' : ''}> 💰 War reparations</label>
        <p class="muted small">Total demands: ${cost} points. Annexation adds infamy; puppets avoid unrest and still count toward domination.</p>`
      : `
        <h4>Territory we cede</h4>${theirOccupation.length ? theirOccupation.map((t) => `<label class="check"><input type="checkbox" data-act="pd-annex" data-t="${t}" ${st.annex.has(t) ? 'checked' : ''}> ${esc(TERR[t].name)}</label>`).join('') : '<p class="muted small">They occupy none of our land.</p>'}
        <label class="check"><input type="checkbox" data-act="pd-rep" ${st.reparations ? 'checked' : ''}> 💰 We pay reparations</label>`}
      ${verdictHtml}
      <div class="choices">${choiceBtn2('Send proposal', 'pd-send', 'primary')}${dictate ? '' : choiceBtn2('Close', 'close-modal')}</div>
    </div>`, { wide: true, dismissible: !dictate });
    void box;
  };
  app.peace = { st, render, warId, enemy, dictate };
  render();
}
const choiceBtn2 = (label, act, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
function nationValueOf(s, nid) {
  return owned(s, nid).reduce((a, t) => a + territoryValue(s, t), 0);
}
on('pd-mode', (d) => { const p = app.peace; p.st.concede = d.v === '1'; p.st.annex.clear(); p.st.puppet = false; p.st.reparations = false; p.render(); });
on('pd-annex', (d, el) => { const p = app.peace; el.checked ? p.st.annex.add(d.t) : p.st.annex.delete(d.t); p.render(); });
on('pd-puppet', (d, el) => { app.peace.st.puppet = el.checked; app.peace.render(); });
on('pd-rep', (d, el) => { app.peace.st.reparations = el.checked; app.peace.render(); });
on('pd-send', () => {
  const p = app.peace;
  const terms = { annex: [...p.st.annex], puppet: p.st.puppet, reparations: p.st.reparations };
  let r;
  if (p.dictate) {
    // a capitulated enemy accepts anything
    const w = app.s.wars.find((x) => x.id === p.warId);
    if (w) { makePeace(app.s, w, app.s.player, p.enemy, terms); r = { ok: true, msg: 'Peace dictated' }; }
  } else r = A.proposePeace(app.s, p.warId, p.enemy, terms, p.st.concede);
  if (r?.ok) { closeModal(); result(r); } else if (r) toast(r.msg, 'bad');
});

// ---------- Victory / defeat ----------
export function showOutcome(app) {
  const s = app.s;
  const o = s.outcome;
  const P = s.nations[s.player];
  const d = domination(s);
  const years = (s.day / 360).toFixed(1);
  const score = Math.round(d.terr * 10000 + (o.type === 'victory' ? Math.max(0, 200 - s.day / 360) * 100 : 0) * ({ easy: 0.5, normal: 1, hard: 1.5, brutal: 2 }[s.difficulty]));
  recordResult({ nation: P.name, flag: P.flag, result: o.type === 'victory' ? 'World Domination' : `Defeat (${pct(d.terr, 0)})`, year: s.startYear + Math.floor(s.day / 360), score, difficulty: s.difficulty, time: Date.now() });
  modal(`<div class="outcome ${o.type}">
    <div class="big">${o.type === 'victory' ? '👑' : '💀'}</div>
    <h1>${o.type === 'victory' ? 'WORLD DOMINATION' : 'DEFEAT'}</h1>
    <p>${esc(o.reason)}</p>
    <dl class="kv"><dt>Nation</dt><dd>${flag(P)} ${esc(P.name)}</dd><dt>Date</dt><dd>${fmtDate(s)} (${years} years)</dd><dt>World controlled</dt><dd>${pct(d.terr, 1)}</dd><dt>Difficulty</dt><dd>${esc(s.difficulty)}</dd><dt>Score</dt><dd>${num(score)}</dd><dt>Nuclear weapons used</dt><dd>${s.world.nukesUsed}</dd></dl>
    <div class="choices">${o.type === 'victory' ? '<button class="btn primary" data-act="continue-game">Keep ruling</button>' : ''}<button class="btn" data-act="quit-now">Main menu</button></div>
  </div>`, { dismissible: false, wide: true });
}
on('continue-game', () => { app.s.continued = true; closeModal(); });
on('quit-now', () => location.reload());

// ---------- Help ----------
export function howToPlay() {
  modal(`<div class="help">
    <h2>📖 How to Play WORLD DOMINATION</h2>
    <p><b>Goal:</b> bring every territory on Earth under your control — directly, or through puppet states that answer to you. The 🌍 Domination meter at the top tracks your progress.</p>
    <h3>Time</h3><p>Press <kbd>Space</kbd> to pause/unpause and <kbd>1</kbd>–<kbd>5</kbd> to change speed. The world keeps moving: AI nations trade, scheme, hold elections, fall to revolutions and wage their own wars.</p>
    <h3>The map</h3><p>Drag to pan, scroll or pinch to zoom, click a country to open its panel. Map modes (bottom-left, keys <kbd>Q</kbd>–<kbd>P</kbd>) show relations, alliances, spheres of influence, wealth, military might, stability, governments, resources and unrest. Striped land is occupied.</p>
    <h3>Economy</h3><p>Set taxes and spending in 💰 Economy. Money funds construction, units and diplomacy; defense budget beyond upkeep buys units automatically. Watch your debt — markets punish reckless borrowing. Resources matter: oil fuels armies, rare minerals speed research, uranium builds warheads.</p>
    <h3>Diplomacy</h3><p>Every proposal shows whether they'll accept and why. Opinion, trust, fear and influence all count. Nations <b>remember</b> broken treaties, abandoned allies and exposed spies. Build influence (investment, aid, propaganda) and offer protectorates to absorb nations peacefully.</p>
    <h3>War</h3><p>Declare war from a country's ⚔️ tab — with a justification (claim, refused ultimatum) to avoid heavy penalties. Then select enemy territories and launch offensives by land or sea. Higher odds advance faster. Occupy their capital and most of their land to force a capitulation, then dictate terms: annex land, install a puppet, or take reparations.</p>
    <h3>Infamy & coalitions</h3><p>Conquest raises infamy. When it grows too high, neighbours form a coalition and will attack together when you look vulnerable. Puppets, influence and patience are quieter paths to power.</p>
    <h3>Ruling an empire</h3><p>Conquered land is restless until integrated. Appoint governors, build bases, or release territories as loyal client states. Keep your own people happy — low stability brings protests, revolutions and, eventually, your downfall.</p>
    <h3>Shortcuts</h3><p><kbd>N</kbd> Nation • <kbd>B</kbd> Economy • <kbd>M</kbd> Military • <kbd>X</kbd> Research • <kbd>D</kbd> Diplomacy • <kbd>J</kbd> Intelligence • <kbd>L</kbd> Empire • <kbd>A</kbd> Wars • <kbd>G</kbd> World • <kbd>S</kbd> Statistics • <kbd>Z</kbd> News • <kbd>H</kbd> Home • <kbd>Esc</kbd> close</p>
  </div>`, { wide: true });
}
