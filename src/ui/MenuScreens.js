// Menu screens: main menu, free flight setup, hangar (aircraft selection,
// purchase & livery shop), career (job board, logbook, statistics), missions,
// flight school, multiplayer, settings and exit.

import { el, clear, row, select, slider, toggle, segmented, button, stars, keyCap } from './dom.js';
import { AIRCRAFT, CATEGORY_NAMES, getAircraft } from '../aircraft/aircraftData.js';
import { AIRCRAFT_LIVERIES, getLivery, TAIL_PATTERNS, STRIPE_STYLES } from '../aircraft/Livery.js';
import { AIRPORT_INFO, getAirport } from '../world/airportGeometry.js';
import { WEATHER_PRESETS, Weather } from '../world/Weather.js';
import { MISSIONS, MISSION_CATEGORIES, TUTORIALS } from '../missions/missions.js';
import { generateJobs, jobToMission } from '../missions/Career.js';
import { RANKS } from '../core/Profile.js';
import { GRAPHICS_PRESETS, DEFAULT_BINDINGS } from '../core/Settings.js';
import { fmtTime, fmtMoney, fmtDuration, fmtMass, escapeHtml } from '../core/format.js';

const WEATHER_LABELS = {
  clear: 'Clear',
  fewClouds: 'Few clouds',
  scattered: 'Scattered',
  broken: 'Broken',
  overcast: 'Overcast',
  rain: 'Rain',
  thunderstorm: 'Thunderstorm',
  fog: 'Fog',
  snow: 'Snow',
};

const AIRPORT_TYPES = { international: 'International', regional: 'Regional', ga: 'General aviation', military: 'Military air base', cargo: 'Cargo hub' };

export const ACTION_INFO = {
  pitchDown: ['Pitch down (nose down)', 'Flight controls'],
  pitchUp: ['Pitch up (nose up)', 'Flight controls'],
  rollLeft: ['Roll left', 'Flight controls'],
  rollRight: ['Roll right', 'Flight controls'],
  yawLeft: ['Rudder left / steer left', 'Flight controls'],
  yawRight: ['Rudder right / steer right', 'Flight controls'],
  trimUp: ['Elevator trim nose up', 'Flight controls'],
  trimDown: ['Elevator trim nose down', 'Flight controls'],
  throttleUp: ['Increase throttle', 'Engines & systems'],
  throttleDown: ['Decrease throttle', 'Engines & systems'],
  throttleFull: ['Full throttle', 'Engines & systems'],
  throttleCut: ['Throttle idle', 'Engines & systems'],
  reverse: ['Thrust reversers', 'Engines & systems'],
  engineStart: ['Engine auto-start', 'Engines & systems'],
  flapsDown: ['Flaps extend', 'Engines & systems'],
  flapsUp: ['Flaps retract', 'Engines & systems'],
  gear: ['Landing gear up/down', 'Engines & systems'],
  brakes: ['Wheel brakes (hold)', 'Engines & systems'],
  parkingBrake: ['Parking brake', 'Engines & systems'],
  spoilers: ['Speed brakes / arm spoilers', 'Engines & systems'],
  landingLights: ['Landing lights', 'Engines & systems'],
  navLights: ['Navigation lights', 'Engines & systems'],
  strobes: ['Strobe lights', 'Engines & systems'],
  dropSupplies: ['Drop supplies (rescue)', 'Engines & systems'],
  smoke: ['Smoke trail (air show)', 'Engines & systems'],
  autopilot: ['Autopilot engage/disengage', 'Autopilot'],
  autothrottle: ['Autothrottle on/off', 'Autopilot'],
  camera: ['Next camera', 'Camera'],
  cameraCockpit: ['Cockpit camera', 'Camera'],
  cameraCabin: ['Passenger cabin camera', 'Camera'],
  cameraChase: ['External camera', 'Camera'],
  cameraWing: ['Wing camera', 'Camera'],
  cameraCinematic: ['Cinematic camera', 'Camera'],
  cameraTower: ['Tower camera', 'Camera'],
  cameraFree: ['Fly-by camera', 'Camera'],
  lookLeft: ['Look left', 'Camera'],
  lookRight: ['Look right', 'Camera'],
  lookBack: ['Look back', 'Camera'],
  lookCenter: ['Centre view', 'Camera'],
  map: ['Map & flight plan', 'Interface'],
  hud: ['Cycle HUD mode', 'Interface'],
  atc: ['ATC radio menu', 'Interface'],
  chat: ['Multiplayer chat', 'Interface'],
  pause: ['Pause menu', 'Interface'],
  simRateUp: ['Simulation rate faster', 'Interface'],
  simRateDown: ['Simulation rate slower', 'Interface'],
  help: ['Controls help', 'Interface'],
};

export const TIPS = [
  'Press Tab in flight to open the ATC radio menu and request taxi, takeoff and landing clearances.',
  'Press M for the map: click an airport to set it as destination or choose an ILS approach.',
  'Airliners can land themselves: arm APPR on the autopilot panel when established on an ILS.',
  'Hold B to brake on the ground. Press K to set the parking brake.',
  'Use the mouse wheel to zoom the external camera, right-drag to look around.',
  'Click switches, knobs and levers in the cockpit — scroll over a knob to turn it.',
  'Aim for a landing rate under 200 feet per minute for a smooth touchdown.',
  'Thunderstorms bring strong downdrafts and turbulence — fly around the red cells on the weather radar.',
  'In Career Mode your pilot moves with every job — pick jobs that build towards bigger aircraft.',
  'Beginner difficulty adds stall protection and auto-coordination. Realistic removes all assists.',
];

function aircraftLiveries(profile, spec) {
  const ids = AIRCRAFT_LIVERIES[spec.id] || ['aurelia'];
  const list = ids.map((id) => getLivery(id)).filter(Boolean);
  for (const c of profile.data.customLiveries) if (c.aircraft === spec.id) list.push(c);
  return list;
}

function liveryId(l) {
  return typeof l === 'object' && l ? l.id : l;
}

function liverySwatch(l, selected, onClick) {
  const cols = l.camo ? l.camo.colors.slice(0, 3) : [l.base, (l.stripe && l.stripe.color) || l.base, (l.tail && l.tail.color) || l.base];
  return el(
    'div.swatch' + (selected ? '.selected' : ''),
    { onclick: onClick, title: l.name },
    el('div.chip', null, ...cols.map((c) => el('div', { style: { background: c } }))),
    el('div', null, l.name.length > 12 ? l.name.slice(0, 11) + '…' : l.name)
  );
}

function maxSpeedText(spec) {
  const s = spec.speeds;
  if (s.mmo >= 1.2) return `Mach ${s.mmo.toFixed(1)}`;
  if (s.vmo) return `${s.vmo} kt / M${s.mmo.toFixed(2)}`;
  return `${s.vne} kt`;
}

export class MenuScreens {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.ff = null;
    this.hangarSel = null;
    this.missionCat = 'passenger';
    this.missionSel = null;
    this.careerTab = 'jobs';
    this.settingsTab = 'graphics';
    this.jobs = null;
    this.jobsKey = '';
  }

  get profile() {
    return this.game.profile;
  }
  get settings() {
    return this.game.settings;
  }

  // Generic page with header & back button
  page(title, crumb, onBack, cls = '') {
    const body = el('div.page-body');
    const header = el(
      'div.page-header',
      null,
      el('button.back', { onclick: onBack, title: 'Back (Esc)' }, '←'),
      el('div', null, el('div.crumb', null, crumb), el('h1', null, title)),
      el('div.spacer')
    );
    const node = el('div.screen.page' + (cls ? '.' + cls : ''), null, header, body);
    node._back = onBack;
    return { node, body, header };
  }

  // =================================================================== MAIN
  main() {
    const g = this.game;
    const p = this.profile;
    const items = [
      ['Free Flight', 'Fly anywhere with any aircraft, weather and time of day', () => this.ui.showScreen('freeflight')],
      ['Career Mode', 'Fly paid jobs, earn credits and climb the ranks', () => this.ui.showScreen('career')],
      ['Missions', 'Passenger, cargo, emergency, rescue and military missions', () => this.ui.showScreen('missions')],
      ['Flight School', 'Step-by-step lessons from first flight to autoland', () => this.ui.showScreen('school')],
      ['Aircraft Selection', 'Hangar, aircraft purchases and the livery paint shop', () => this.ui.showScreen('hangar')],
      ['Multiplayer', 'Fly together with friends and chat', () => this.ui.showScreen('multiplayer')],
      ['Settings', 'Graphics, sound, controls and gameplay', () => this.ui.showScreen('settings')],
    ];
    const menu = el('div.menu');
    items.forEach(([label, sub, fn], i) => {
      if (i === 4 || i === 6) menu.appendChild(el('div.sep'));
      menu.appendChild(el('button', { onclick: () => (g.audio.uiClick(), fn()), onmouseenter: () => g.audio.uiHover() }, label, el('small', null, sub)));
    });
    menu.appendChild(el('button', { onclick: () => this.ui.confirmExit() }, 'Exit', el('small', null, 'Leave the simulator')));

    const rank = p.rank;
    const next = p.nextRank;
    const loc = getAirport(p.data.location);
    const card = el(
      'div.pilot-card.panel.interactive',
      null,
      el('div.who', null, el('div.pname', null, p.data.name), el('div.cs', null, p.data.callsign)),
      el('div.rank', null, `${rank.badge} ${rank.name}`),
      el('div.xpbar', null, el('div', { style: { width: `${Math.round(p.rankProgress * 100)}%` } })),
      el('div.muted', { style: { fontSize: '11px' } }, next ? `${p.data.xp.toLocaleString()} / ${next.xp.toLocaleString()} XP to ${next.name}` : `${p.data.xp.toLocaleString()} XP — highest rank`),
      el(
        'div.stats',
        null,
        el('div', null, el('span', null, 'Credits'), el('b', null, fmtMoney(p.data.credits))),
        el('div', null, el('span', null, 'Based at'), el('b', null, loc ? loc.icao : '—')),
        el('div', null, el('span', null, 'Flight hours'), el('b', null, p.data.stats.hours.toFixed(1))),
        el('div', null, el('span', null, 'Aircraft'), el('b', null, `${AIRCRAFT.filter((a) => p.isUnlocked(a.id)).length} / ${AIRCRAFT.length}`))
      )
    );
    const spec = g.showcaseSpec;
    const liv = getLivery(liveryId(p.liveryFor(spec ? spec.id : 'mj320'))) || p.liveryFor(spec ? spec.id : 'mj320');
    const cond = el(
      'div.conditions.panel.interactive',
      null,
      el('div.section-title', null, 'Meridian International'),
      el('div', null, `Local time ${fmtTime(g.world.time)} · ${WEATHER_LABELS[g.weather.state.name] || 'Fair'}`),
      el('div.mono', { style: { marginTop: '6px' } }, g.weather.metar('AXMI'))
    );
    return el(
      'div.screen.main',
      null,
      el('div.left', null, this.logo(), menu, el('div.footer', null, 'Skyward Flight Simulator · World of Aurelia · v1.0')),
      card,
      cond,
      el('div.showcase-label', null, el('div.t', null, spec ? spec.name : ''), el('div.s', null, `${spec ? spec.role : ''}${liv && liv.name ? ' · ' + liv.name : ''}`))
    );
  }

  logo() {
    return el(
      'div.logo',
      null,
      el('div.mark', {
        html: `<svg viewBox="0 0 64 64" width="54" height="54"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#f2b33d"/></linearGradient></defs><circle cx="32" cy="32" r="29" fill="none" stroke="url(#lg)" stroke-width="2.5"/><path d="M32 5 C34.6 5 35.6 8.5 35.6 12 L35.6 24 L57 36.5 L57 41.5 L35.6 35 L35.6 47.5 L42.5 52.5 L42.5 56.5 L32 54 L21.5 56.5 L21.5 52.5 L28.4 47.5 L28.4 35 L7 41.5 L7 36.5 L28.4 24 L28.4 12 C28.4 8.5 29.4 5 32 5 Z" fill="#fff" transform="rotate(45 32 32) translate(32 32) scale(0.72) translate(-32 -32)"/></svg>`,
      }),
      el('div.words', null, el('div.name', null, 'SKYWARD'), el('div.sub', null, 'Flight Simulator'))
    );
  }

  // =================================================================== FREE FLIGHT
  ffDefaults() {
    const p = this.profile;
    const owned = AIRCRAFT.filter((a) => p.isUnlocked(a.id));
    const ac = owned.find((a) => a.id === 'mj320') || owned[0];
    return {
      aircraftId: ac.id,
      livery: liveryId(p.liveryFor(ac.id)),
      airport: 'AXMI',
      spawn: 'runway',
      runway: 'auto',
      destination: '',
      time: 10,
      timeRate: 1,
      weather: 'fewClouds',
      windDir: 250,
      windSpeed: 5,
      dynamicWeather: false,
      fuel: 0.6,
      payload: 0.5,
      coldDark: false,
      altitudeFt: 5000,
    };
  }

  freeflight(opts = {}) {
    if (!this.ff) this.ff = this.ffDefaults();
    const ff = this.ff;
    const p = this.profile;
    if (opts.aircraftId) {
      ff.aircraftId = opts.aircraftId;
      ff.livery = liveryId(p.liveryFor(opts.aircraftId));
    }
    if (!p.isUnlocked(ff.aircraftId)) Object.assign(ff, { aircraftId: this.ffDefaults().aircraftId, livery: this.ffDefaults().livery });
    const { node, body } = this.page('Free Flight', 'Plan your flight', () => this.ui.showScreen('main'));
    const form = el('div.panel.scroll.interactive');
    const side = el('div.panel.scroll.interactive', { style: { display: 'flex', flexDirection: 'column' } });
    body.appendChild(el('div.ff-grid', null, form, side));
    const refresh = () => this.ffForm(form, side);
    this.ffRefresh = refresh;
    refresh();
    this.game.setupMenuScene(ff.aircraftId, this.resolveLiv(ff.aircraftId, ff.livery));
    return node;
  }

  resolveLiv(aircraftId, id) {
    const c = this.profile.data.customLiveries.find((l) => l.id === id);
    return c || id;
  }

  ffForm(form, side) {
    const ff = this.ff;
    const p = this.profile;
    const g = this.game;
    clear(form);
    const spec = getAircraft(ff.aircraftId);
    const ap = getAirport(ff.airport);
    const set = (k, rerender = false) => (v) => {
      ff[k] = v;
      if (rerender) this.ffRefresh();
      else this.ffSummary(side);
    };
    // Aircraft
    form.appendChild(el('div.section-title', null, 'Aircraft'));
    const acOpts = [];
    for (const cat of Object.keys(CATEGORY_NAMES))
      for (const a of AIRCRAFT.filter((x) => x.category === cat)) acOpts.push({ value: a.id, label: `${a.name} — ${CATEGORY_NAMES[cat].replace(/s$/, '')}${p.isUnlocked(a.id) ? '' : ' (locked)'}`, disabled: !p.isUnlocked(a.id) });
    form.appendChild(
      row(
        'Aircraft',
        select(acOpts, ff.aircraftId, (v) => {
          ff.aircraftId = v;
          ff.livery = liveryId(p.liveryFor(v));
          g.setupMenuScene(v, this.resolveLiv(v, ff.livery));
          this.ffRefresh();
        })
      )
    );
    const sw = el('div.swatches');
    for (const l of aircraftLiveries(p, spec))
      sw.appendChild(
        liverySwatch(l, l.id === ff.livery, () => {
          ff.livery = l.id;
          g.setupMenuScene(spec.id, l);
          this.ffRefresh();
        })
      );
    form.appendChild(row('Livery', sw));

    // Departure
    form.appendChild(el('div.section-title', null, 'Departure'));
    form.appendChild(
      row(
        'Airport',
        select(
          AIRPORT_INFO.map((a) => ({ value: a.icao, label: `${a.icao} — ${a.name}` })),
          ff.airport,
          (v) => {
            ff.airport = v;
            ff.runway = 'auto';
            if (ff.destination === v) ff.destination = '';
            this.ffRefresh();
          }
        )
      )
    );
    form.appendChild(
      row(
        'Start position',
        segmented(
          [
            { value: 'gate', label: 'Gate' },
            { value: 'runway', label: 'Runway' },
            { value: 'final', label: 'Final approach' },
            { value: 'air', label: 'In flight' },
          ],
          ff.spawn,
          set('spawn', true)
        )
      )
    );
    if (ff.spawn === 'runway' || ff.spawn === 'final') {
      const ends = ap.runwayObjs.flatMap((r) => r.ends.map((e) => ({ value: e.id, label: `RWY ${e.id} — ${Math.round(r.length)} m${e.ils ? ' · ILS' : ''}` })));
      form.appendChild(row('Runway', select([{ value: 'auto', label: 'Active runway (into wind)' }, ...ends], ff.runway, set('runway'))));
    }
    if (ff.spawn === 'air') {
      form.appendChild(row('Altitude', slider(1000, Math.min(spec.speeds.ceiling, 40000), 500, ff.altitudeFt, set('altitudeFt'), (v) => `${v.toLocaleString()} ft`)));
    }
    if (ff.spawn === 'gate') form.appendChild(row('Cold & dark', toggle(ff.coldDark, set('coldDark')), 'Start with everything switched off'));
    form.appendChild(
      row(
        'Destination',
        select([{ value: '', label: 'None — fly freely' }, ...AIRPORT_INFO.filter((a) => a.icao !== ff.airport).map((a) => ({ value: a.icao, label: `${a.icao} — ${a.name}` }))], ff.destination, set('destination')),
        'Creates a GPS flight plan'
      )
    );

    // Conditions
    form.appendChild(el('div.section-title', null, 'Time & Weather'));
    form.appendChild(row('Time of day', slider(0, 23.75, 0.25, ff.time, set('time'), (v) => fmtTime(v))));
    form.appendChild(
      row(
        'Time flow',
        segmented(
          [
            { value: 0, label: 'Frozen' },
            { value: 1, label: 'Real time' },
            { value: 10, label: '10×' },
            { value: 60, label: '60×' },
          ],
          ff.timeRate,
          set('timeRate')
        )
      )
    );
    form.appendChild(
      row(
        'Weather',
        segmented(
          Object.keys(WEATHER_PRESETS).map((k) => ({ value: k, label: WEATHER_LABELS[k] || k })),
          ff.weather,
          set('weather')
        )
      )
    );
    form.appendChild(row('Wind direction', slider(0, 350, 10, ff.windDir, set('windDir'), (v) => `${String(v || 360).padStart(3, '0')}°`)));
    form.appendChild(row('Wind speed', slider(0, 25, 1, ff.windSpeed, set('windSpeed'), (v) => `${Math.round(v * 1.944)} kt`)));
    form.appendChild(row('Dynamic weather', toggle(ff.dynamicWeather, set('dynamicWeather')), 'Weather evolves during the flight'));

    // Load
    form.appendChild(el('div.section-title', null, 'Fuel & Load'));
    form.appendChild(row('Fuel', slider(0.1, 1, 0.05, ff.fuel, set('fuel'), (v) => `${Math.round(v * 100)}% · ${fmtMass(v * spec.mass.maxFuel)}`)));
    form.appendChild(row(spec.mass.passengers > 0 && spec.category !== 'cargo' ? 'Passengers & cargo' : 'Payload', slider(0, 1, 0.05, ff.payload, set('payload'), (v) => `${Math.round(v * 100)}% · ${fmtMass(v * spec.mass.maxPayload)}`)));
    this.ffSummary(side);
  }

  ffSummary(side) {
    const ff = this.ff;
    const g = this.game;
    clear(side);
    const spec = getAircraft(ff.aircraftId);
    const ap = getAirport(ff.airport);
    const dest = ff.destination ? getAirport(ff.destination) : null;
    const wx = new Weather();
    wx.set(ff.weather, { windDir: ff.windDir, windSpeed: ff.windSpeed });
    side.appendChild(el('div.section-title', null, 'Flight summary'));
    side.appendChild(el('h2', { style: { margin: '0', fontFamily: 'var(--font-cond)', letterSpacing: '0.05em', fontSize: '26px' } }, spec.name));
    side.appendChild(el('div.muted', { style: { marginBottom: '10px' } }, `${spec.manufacturer} · ${spec.role}`));
    const lines = [
      ['Departure', `${ap.icao} ${ap.name}`],
      ['Elevation', `${Math.round(ap.elevation / 0.3048).toLocaleString()} ft`],
      ['Runways', ap.runwayObjs.map((r) => r.ends.map((e) => e.id).join('/')).join(', ')],
      ['Start', { gate: 'At the gate', runway: 'Lined up on the runway', final: 'Final approach, 10 NM', air: `In flight, ${ff.altitudeFt.toLocaleString()} ft` }[ff.spawn]],
      ['Destination', dest ? `${dest.icao} ${dest.name} · ${Math.round(Math.hypot(dest.x - ap.x, dest.z - ap.z) / 1852)} NM` : '—'],
      ['Local time', fmtTime(ff.time)],
      ['Fuel on board', fmtMass(ff.fuel * spec.mass.maxFuel)],
      ['Range (approx.)', `${Math.round(spec.rangeNm * ff.fuel)} NM`],
    ];
    for (const [k, v] of lines) side.appendChild(el('div.summary-line', null, el('span', null, k), el('span', null, v)));
    side.appendChild(el('div.section-title', null, 'Weather report'));
    side.appendChild(el('div.metar', null, wx.metar(ap.icao)));
    if (this.game.multiplayer.connected) side.appendChild(el('div.tag.green', { style: { marginTop: '12px', alignSelf: 'flex-start' } }, `Multiplayer · room ${this.game.multiplayer.room}`));
    side.appendChild(el('div', { style: { flex: '1' } }));
    side.appendChild(
      el(
        'div.actions',
        { style: { display: 'flex', gap: '10px', marginTop: '18px' } },
        button('Back', () => this.ui.showScreen('main'), 'ghost'),
        button(
          'Start flight',
          () => {
            const cfg = {
              aircraftId: ff.aircraftId,
              livery: this.resolveLiv(ff.aircraftId, ff.livery),
              airport: ff.airport,
              spawn: ff.spawn,
              runway: ff.runway === 'auto' ? null : ff.runway,
              destination: ff.destination || null,
              time: ff.time,
              timeRate: ff.timeRate,
              weather: ff.weather,
              wind: { dir: ff.windDir, speed: ff.windSpeed },
              dynamicWeather: ff.dynamicWeather,
              fuel: ff.fuel,
              payloadFrac: ff.payload,
              coldDark: ff.spawn === 'gate' && ff.coldDark,
              altitudeFt: ff.altitudeFt,
              callsign: this.callsign(spec),
            };
            g.startFlight(cfg);
          },
          'primary'
        )
      )
    );
  }

  callsign(spec) {
    const cs = this.settings.get('gameplay').callsign || this.profile.data.callsign;
    return cs || `${spec.callsignPrefix || 'SKY'} ${Math.floor(100 + Math.random() * 899)}`;
  }

  // =================================================================== HANGAR
  hangar(opts = {}) {
    const p = this.profile;
    if (opts.aircraftId) this.hangarSel = opts.aircraftId;
    if (!this.hangarSel) this.hangarSel = this.game.showcaseSpec ? this.game.showcaseSpec.id : 'mj320';
    const { node, body, header } = this.page('Aircraft Selection', 'Hangar', () => this.ui.showScreen('main'), 'hangar');
    header.appendChild(el('div.tag.gold', { style: { fontSize: '14px', padding: '6px 14px' } }, fmtMoney(p.data.credits)));
    const list = el('div.list.panel.scroll.interactive.col');
    const detail = el('div.detail.panel.scroll.interactive');
    body.appendChild(list);
    body.appendChild(el('div.spacer-col'));
    body.appendChild(detail);
    const render = () => {
      clear(list);
      for (const cat of Object.keys(CATEGORY_NAMES)) {
        list.appendChild(el('div.cat', null, CATEGORY_NAMES[cat]));
        for (const a of AIRCRAFT.filter((x) => x.category === cat)) {
          const owned = p.isUnlocked(a.id);
          const st = owned ? el('span.tag.green', null, 'Owned') : p.rankIndex < a.unlock.rank ? el('span.tag.red', null, `🔒 ${RANKS[a.unlock.rank].name}`) : el('span.tag.gold', null, fmtMoney(a.unlock.price));
          list.appendChild(
            el(
              'div.ac-item' + (a.id === this.hangarSel ? '.selected' : ''),
              {
                onclick: () => {
                  this.hangarSel = a.id;
                  this.game.setupMenuScene(a.id, p.liveryFor(a.id));
                  render();
                },
              },
              el('div', null, el('div.nm', null, a.name), el('div.rl', null, a.role)),
              el('div.st', null, st)
            )
          );
        }
      }
      this.hangarDetail(detail, render);
    };
    render();
    this.game.setupMenuScene(this.hangarSel, p.liveryFor(this.hangarSel));
    return node;
  }

  hangarDetail(detail, rerender) {
    const p = this.profile;
    const a = getAircraft(this.hangarSel);
    const owned = p.isUnlocked(a.id);
    clear(detail);
    detail.appendChild(el('div.tag', { style: { alignSelf: 'flex-start' } }, CATEGORY_NAMES[a.category]));
    detail.appendChild(el('h2', { style: { marginTop: '8px' } }, a.name));
    detail.appendChild(el('div.sub', null, `${a.manufacturer} · ${a.role}`));
    detail.appendChild(el('p', null, a.description));
    const eng = a.engine;
    const engText = `${eng.list.length} × ${eng.type === 'jet' ? (eng.abThrust ? 'afterburning turbofan' : 'turbofan') : eng.type === 'turboprop' ? 'turboprop' : 'piston'}`;
    const grid = el('div.spec-grid');
    const specs = [
      ['Max take-off weight', fmtMass(a.mass.maxTakeoff)],
      ['Engines', engText],
      ['Cruise speed', `${a.speeds.cruise} kt`],
      ['Max speed', maxSpeedText(a)],
      ['Service ceiling', `${a.speeds.ceiling.toLocaleString()} ft`],
      ['Range', `${a.rangeNm.toLocaleString()} NM`],
      [a.mass.passengers > 0 && a.category !== 'cargo' ? 'Passengers' : 'Max payload', a.mass.passengers > 0 && a.category !== 'cargo' ? a.mass.passengers : fmtMass(a.mass.maxPayload)],
      ['Wingspan', `${a.wing.span.toFixed(1)} m`],
      ['Cockpit', { airliner: 'Glass, fly-by-wire', ga: 'Analog gauges', fighter: 'HUD & MFDs' }[a.cockpit] || a.cockpit],
      ['Autopilot', a.autopilot.autoland ? 'With autoland' : a.autopilot.athr ? 'With autothrottle' : 'Basic'],
    ];
    for (const [k, v] of specs) grid.appendChild(el('div', null, el('span', null, k), el('b', null, v)));
    detail.appendChild(grid);
    // liveries
    detail.appendChild(el('div.section-title', null, 'Liveries'));
    const sw = el('div.swatches');
    const cur = liveryId(p.liveryFor(a.id));
    for (const l of aircraftLiveries(p, a))
      sw.appendChild(
        liverySwatch(l, l.id === cur, () => {
          p.setLivery(a.id, l.id);
          if (this.ff && this.ff.aircraftId === a.id) this.ff.livery = l.id;
          this.game.setupMenuScene(a.id, l);
          this.hangarDetail(detail, rerender);
        })
      );
    detail.appendChild(sw);
    const actions = el('div.actions');
    if (owned) {
      actions.appendChild(button('Paint shop', () => this.liveryEditor(a, () => this.hangarDetail(detail, rerender))));
      actions.appendChild(button('Fly this aircraft', () => this.ui.showScreen('freeflight', { aircraftId: a.id }), 'primary'));
    } else {
      const c = p.canPurchase(a.id);
      const b = button(`Purchase · ${fmtMoney(a.unlock.price)}`, () => {
        const r = p.purchase(a.id);
        if (r.ok) {
          this.game.audio.chime('mission');
          this.ui.toast(`${a.name} added to your hangar!`, 'success');
          this.ui.showScreen('hangar');
        } else this.ui.toast(r.reason, 'warn');
      }, 'primary');
      b.disabled = !c.ok;
      actions.appendChild(b);
      if (!c.ok) actions.appendChild(el('div.muted', { style: { alignSelf: 'center', fontSize: '13px' } }, c.reason));
      actions.appendChild(el('div.muted', { style: { width: '100%', fontSize: '12px' } }, `Unlock requirement: ${RANKS[a.unlock.rank].name} rank and ${fmtMoney(a.unlock.price)}. Enable “Unlock all aircraft” in Settings → Gameplay for sandbox play.`));
    }
    detail.appendChild(actions);
  }

  // Livery paint shop (modal)
  liveryEditor(spec, onDone) {
    const p = this.profile;
    const g = this.game;
    const fighter = spec.category === 'fighter';
    const base = (() => {
      const l = p.liveryFor(spec.id);
      const src = typeof l === 'object' ? l : getLivery(l) || getLivery('aurelia');
      return JSON.parse(JSON.stringify(src));
    })();
    const liv = {
      ...base,
      id: base.custom ? base.id : `custom-${Date.now().toString(36)}`,
      name: base.custom ? base.name : `My ${spec.name.split(' ').slice(-1)[0]} livery`,
      custom: true,
      aircraft: spec.id,
      for: [spec.category],
      stripe: { ...(base.stripe || { style: 'none', color: '#1c2a44', color2: '#c8102e' }) },
      tail: { ...(base.tail || { pattern: 'solid', color: '#1c2a44', color2: '#ffffff' }) },
      text: base.text || '',
      textColor: base.textColor || '#1c2a44',
      textStyle: base.textStyle || 'sans',
      engine: base.engine || base.base,
      wing: base.wing || '#c9ced6',
    };
    if (fighter) liv.camo = base.camo ? { ...base.camo, colors: [...base.camo.colors] } : null;
    let timer = null;
    const preview = () => {
      clearTimeout(timer);
      timer = setTimeout(() => g.setupMenuScene(spec.id, JSON.parse(JSON.stringify(liv))), 250);
    };
    const color = (obj, key) => {
      const i = el('input', { type: 'color' });
      i.value = obj[key] || '#ffffff';
      i.addEventListener('input', () => {
        obj[key] = i.value;
        preview();
      });
      return i;
    };
    const form = el('div.livery-editor.scroll', { style: { flex: '1', minHeight: '0' } });
    const nameIn = el('input', { type: 'text', maxLength: 32 });
    nameIn.value = liv.name;
    nameIn.addEventListener('input', () => (liv.name = nameIn.value || 'Custom'));
    form.appendChild(row('Name', nameIn));
    if (fighter) {
      const camoOpts = ['none', 'counter', 'splinter', 'blob', 'demo', 'tiger'];
      form.appendChild(
        row(
          'Camouflage',
          select(camoOpts, liv.camo ? liv.camo.pattern : 'none', (v) => {
            liv.camo = v === 'none' ? null : { pattern: v, colors: [liv.base, liv.belly || '#555555', liv.tail.color2 || '#333333', liv.wing || '#777777'] };
            preview();
          })
        )
      );
    }
    form.appendChild(row('Fuselage', el('div.colors', null, color(liv, 'base'), el('span.muted', null, 'belly'), color(liv, 'belly'))));
    form.appendChild(
      row(
        'Cheatline',
        el(
          'div.colors',
          null,
          select(STRIPE_STYLES, liv.stripe.style, (v) => {
            liv.stripe.style = v;
            preview();
          }),
          color(liv.stripe, 'color'),
          color(liv.stripe, 'color2')
        )
      )
    );
    form.appendChild(
      row(
        'Tail',
        el(
          'div.colors',
          null,
          select(TAIL_PATTERNS, liv.tail.pattern, (v) => {
            liv.tail.pattern = v;
            preview();
          }),
          color(liv.tail, 'color'),
          color(liv.tail, 'color2')
        )
      )
    );
    const txt = el('input', { type: 'text', maxLength: 18 });
    txt.value = liv.text;
    txt.addEventListener('input', () => {
      liv.text = txt.value.toUpperCase() === txt.value ? txt.value : txt.value;
      preview();
    });
    form.appendChild(row('Titles', el('div.colors', null, txt, color(liv, 'textColor'))));
    form.appendChild(
      row(
        'Lettering',
        segmented(['sans', 'serif', 'round', 'stencil'], liv.textStyle, (v) => {
          liv.textStyle = v;
          preview();
        })
      )
    );
    form.appendChild(row('Engines & wings', el('div.colors', null, color(liv, 'engine'), color(liv, 'wing'))));
    form.appendChild(row('Metallic finish', toggle(!!liv.metallic, (v) => ((liv.metallic = v), preview()))));
    const m = this.ui.openModal(
      el(
        'div.modal.panel',
        { style: { position: 'absolute', right: '30px', top: '30px', bottom: '30px', width: '470px', maxHeight: 'none' } },
        el('h2', null, 'Paint Shop'),
        el('div.muted', { style: { marginBottom: '10px', fontSize: '13px' } }, `Design a custom livery for the ${spec.name}. Changes preview live on the aircraft.`),
        form,
        el(
          'div.actions',
          { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
          button('Cancel', () => {
            this.ui.closeModal();
            g.setupMenuScene(spec.id, p.liveryFor(spec.id));
          }, 'ghost'),
          button('Save livery', () => {
            const saved = JSON.parse(JSON.stringify(liv));
            p.saveCustomLivery(saved);
            p.setLivery(spec.id, saved.id);
            this.ui.closeModal();
            g.setupMenuScene(spec.id, saved);
            this.ui.toast('Livery saved', 'success');
            onDone();
          }, 'primary')
        )
      ),
      { transparent: true }
    );
    void m;
  }

  // =================================================================== CAREER
  career() {
    const p = this.profile;
    const { node, body, header } = this.page('Career Mode', `${p.rank.badge} ${p.rank.name}`, () => this.ui.showScreen('main'));
    const loc = getAirport(p.data.location) || getAirport('AXMI');
    header.appendChild(
      el(
        'div',
        { style: { textAlign: 'right' } },
        el('div.tag.gold', { style: { fontSize: '14px', padding: '6px 14px' } }, fmtMoney(p.data.credits)),
        el('div.muted', { style: { fontSize: '12px', marginTop: '6px' } }, `Based at ${loc.icao} ${loc.name}`)
      )
    );
    const main = el('div.col', { style: { flex: '1', minWidth: '0' } });
    const detail = el('div.detail.panel.scroll.interactive');
    body.appendChild(main);
    body.appendChild(detail);
    const tabs = el('div.tabs.interactive');
    const content = el('div.panel.scroll.interactive', { style: { flex: '1', minHeight: '0', padding: '8px 14px' } });
    main.appendChild(tabs);
    main.appendChild(content);
    const tabDefs = [
      ['jobs', 'Job board'],
      ['logbook', 'Logbook'],
      ['stats', 'Pilot record'],
    ];
    const renderTabs = () => {
      clear(tabs);
      for (const [id, label] of tabDefs)
        tabs.appendChild(
          el(
            'button' + (this.careerTab === id ? '.active' : ''),
            {
              onclick: () => {
                this.careerTab = id;
                renderTabs();
                renderContent();
              },
            },
            label
          )
        );
    };
    const renderContent = () => {
      clear(content);
      clear(detail);
      if (this.careerTab === 'jobs') this.jobBoard(content, detail);
      else if (this.careerTab === 'logbook') this.logbook(content, detail);
      else this.pilotRecord(content, detail);
    };
    renderTabs();
    renderContent();
    return node;
  }

  jobBoard(content, detail) {
    const p = this.profile;
    const key = `${p.data.location}|${p.data.logbook.length}|${p.jobSeed || 0}|${p.data.unlocked.length}|${this.settings.get('gameplay').unlockAll}`;
    if (!this.jobs || this.jobsKey !== key) {
      this.jobs = generateJobs(p, 9);
      this.jobsKey = key;
      this.jobSel = this.jobs[0] || null;
    }
    const table = el('table.data');
    table.appendChild(el('thead', null, el('tr', null, ...['', 'Job', 'Route', 'Aircraft', 'Dist.', 'Weather', 'Pay'].map((h) => el('th', null, h)))));
    const tb = el('tbody');
    const drawDetail = () => this.jobDetail(detail);
    for (const j of this.jobs) {
      const tr = el(
        'tr.clickable' + (j === this.jobSel ? '.selected' : ''),
        {
          onclick: () => {
            this.jobSel = j;
            for (const r of tb.children) r.classList.remove('selected');
            tr.classList.add('selected');
            drawDetail();
          },
        },
        el('td', null, j.type === 'passenger' ? '🧳' : '📦'),
        el('td', null, j.title, j.urgent ? el('span.tag.red', { style: { marginLeft: '6px' } }, 'Urgent') : null),
        el('td.mono', null, `${j.from} → ${j.to}`),
        el('td', null, getAircraft(j.aircraft).name),
        el('td.num', null, `${j.distanceNm} NM`),
        el('td', null, WEATHER_LABELS[j.weather]),
        el('td.num', { style: { color: 'var(--accent-2)' } }, fmtMoney(j.reward.credits))
      );
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    if (!this.jobs.length) content.appendChild(el('p.muted', null, 'No suitable jobs at this airport for your aircraft. Purchase another aircraft or reposition to a larger airport.'));
    else content.appendChild(table);
    content.appendChild(
      el(
        'div',
        { style: { display: 'flex', gap: '10px', marginTop: '14px', alignItems: 'center', flexWrap: 'wrap' } },
        button('New jobs', () => {
          p.jobSeed = (p.jobSeed || 0) + 1;
          this.ui.showScreen('career');
        }, 'small'),
        el('span.muted', { style: { fontSize: '13px' } }, 'Reposition (₳ 1,500):'),
        select(
          [{ value: '', label: 'Choose airport…' }, ...AIRPORT_INFO.filter((a) => a.icao !== p.data.location).map((a) => ({ value: a.icao, label: `${a.icao} ${a.name}` }))],
          '',
          (v) => {
            if (!v) return;
            if (p.data.credits < 1500) return this.ui.toast('Not enough credits', 'warn');
            p.data.credits -= 1500;
            p.data.location = v;
            p.persist();
            this.ui.toast(`Repositioned to ${v}`, 'success');
            this.ui.showScreen('career');
          }
        )
      )
    );
    drawDetail();
  }

  jobDetail(detail) {
    clear(detail);
    const j = this.jobSel;
    if (!j) return;
    const spec = getAircraft(j.aircraft);
    const from = getAirport(j.from),
      to = getAirport(j.to);
    detail.appendChild(el('div', null, el('span.tag' + (j.type === 'cargo' ? '.gold' : ''), null, j.type === 'cargo' ? 'Cargo' : 'Passenger'), j.urgent ? el('span.tag.red', { style: { marginLeft: '6px' } }, 'Urgent') : null));
    detail.appendChild(el('h2', { style: { marginTop: '8px' } }, j.title));
    detail.appendChild(el('div.sub', null, `${from.icao} → ${to.icao} · ${j.distanceNm} NM`));
    const lines = [
      ['Aircraft', spec.name],
      ['Load', j.payload.passengers ? `${j.payload.passengers} passengers` : fmtMass(j.payload.cargoKg) + ' cargo'],
      ['Departure', `${from.name}, RWY ${j.departure || '—'}`],
      ['Arrival', `${to.name}, RWY ${j.approach || '—'}`],
      ['Departure time', fmtTime(j.time)],
      ['Weather', `${WEATHER_LABELS[j.weather]}, wind ${String(j.wind.dir).padStart(3, '0')}° ${Math.round(j.wind.speed * 1.944)} kt`],
      ['Time limit', j.timeLimit ? fmtDuration(j.timeLimit) : 'None'],
      ['Payment', `${fmtMoney(j.reward.credits)} + ${j.reward.xp} XP`],
    ];
    for (const [k, v] of lines) detail.appendChild(el('div.summary-line', null, el('span', null, k), el('span', null, v)));
    detail.appendChild(el('p', { style: { fontSize: '13px' } }, 'Start at the gate. Request pushback and taxi from ATC (Tab), follow the green taxi line, get takeoff clearance and fly to your destination. Payment depends on landing quality, passenger comfort and timeliness.'));
    detail.appendChild(
      el(
        'div.actions',
        null,
        button('Accept job', () => {
          const mission = jobToMission(j);
          this.game.startFlight({
            aircraftId: j.aircraft,
            livery: this.profile.liveryFor(j.aircraft),
            mission,
            job: j,
            airport: j.from,
            time: j.time,
            weather: j.weather,
            wind: j.wind,
            fuel: mission.fuel,
            callsign: this.callsign(spec),
            camera: 'cockpit',
          });
        }, 'primary')
      )
    );
  }

  logbook(content, detail) {
    const p = this.profile;
    if (!p.data.logbook.length) content.appendChild(el('p.muted', null, 'Your logbook is empty. Every flight you complete is recorded here.'));
    else {
      const t = el('table.data');
      t.appendChild(el('thead', null, el('tr', null, ...['Date', 'Flight', 'Aircraft', 'Route', 'Time', 'Landing', 'Score', 'Pay'].map((h) => el('th', null, h)))));
      const tb = el('tbody');
      for (const r of p.data.logbook.slice(0, 100)) {
        tb.appendChild(
          el(
            'tr',
            null,
            el('td.mono', null, new Date(r.date).toLocaleDateString()),
            el('td', null, r.title, r.crashed ? el('span.tag.red', { style: { marginLeft: '6px' } }, 'Crash') : !r.success ? el('span.tag.red', { style: { marginLeft: '6px' } }, 'Failed') : null),
            el('td', null, r.aircraft),
            el('td.mono', null, r.from && r.to ? `${r.from} → ${r.to}` : r.from || '—'),
            el('td.num', null, fmtDuration(r.duration || 0)),
            el('td.num', null, r.landingRate !== null && r.landingRate !== undefined ? `${r.landingRate} fpm` : '—'),
            el('td.num', null, r.score !== null && r.score !== undefined ? r.score : '—'),
            el('td.num', { style: { color: r.credits < 0 ? 'var(--red)' : 'var(--accent-2)' } }, r.credits ? fmtMoney(r.credits) : '—')
          )
        );
      }
      t.appendChild(tb);
      content.appendChild(t);
    }
    this.pilotCardDetail(detail);
  }

  pilotRecord(content, detail) {
    const p = this.profile;
    const st = p.data.stats;
    const grid = el('div.spec-grid', { style: { gridTemplateColumns: 'repeat(3, 1fr)' } });
    const items = [
      ['Flights', st.flights],
      ['Flight hours', st.hours.toFixed(1)],
      ['Landings', st.landings],
      ['Best landing', st.bestLanding !== null ? `${st.bestLanding} fpm` : '—'],
      ['Distance flown', `${Math.round(st.distanceNm).toLocaleString()} NM`],
      ['Crashes', st.crashes],
      ['Missions completed', st.missionsCompleted],
      ['Jobs completed', st.jobsCompleted],
      ['Total earned', fmtMoney(st.earned)],
    ];
    for (const [k, v] of items) grid.appendChild(el('div', null, el('span', null, k), el('b', null, v)));
    content.appendChild(el('div.section-title', null, 'Statistics'));
    content.appendChild(grid);
    content.appendChild(el('div.section-title', null, 'Ranks'));
    const rt = el('table.data');
    const tb = el('tbody');
    RANKS.forEach((r, i) => {
      const unlocks = AIRCRAFT.filter((a) => a.unlock.rank === i && (a.unlock.price > 0 || i > 0)).map((a) => a.name).join(', ');
      tb.appendChild(el('tr' + (i === p.rankIndex ? '.selected' : ''), null, el('td', null, `${r.badge} ${r.name}`), el('td.num', null, `${r.xp.toLocaleString()} XP`), el('td.muted', null, unlocks || '—')));
    });
    rt.appendChild(tb);
    content.appendChild(rt);
    content.appendChild(el('div.section-title', null, 'Profile'));
    content.appendChild(
      el(
        'div',
        { style: { display: 'flex', gap: '10px' } },
        button('Reset career', () => {
          this.ui.confirm('Reset career?', 'This deletes your credits, experience, purchased aircraft, liveries and logbook.', () => {
            p.reset();
            this.jobs = null;
            this.ui.showScreen('career');
          });
        }, 'danger small')
      )
    );
    this.pilotCardDetail(detail);
  }

  pilotCardDetail(detail) {
    const p = this.profile;
    clear(detail);
    detail.appendChild(el('div.section-title', null, 'Pilot'));
    const nameIn = el('input', { type: 'text', maxLength: 24 });
    nameIn.value = p.data.name;
    nameIn.addEventListener('change', () => {
      p.data.name = nameIn.value.trim() || 'Pilot';
      p.persist();
    });
    const csIn = el('input', { type: 'text', maxLength: 10 });
    csIn.value = p.data.callsign;
    csIn.addEventListener('change', () => {
      p.data.callsign = csIn.value.trim().toUpperCase() || p.data.callsign;
      csIn.value = p.data.callsign;
      p.persist();
    });
    detail.appendChild(row('Name', nameIn));
    detail.appendChild(row('Callsign', csIn));
    detail.appendChild(el('h2', { style: { marginTop: '16px' } }, `${p.rank.badge} ${p.rank.name}`));
    detail.appendChild(el('div.xpbar', null, el('div', { style: { width: `${Math.round(p.rankProgress * 100)}%` } })));
    detail.appendChild(el('div.muted', { style: { fontSize: '12px' } }, p.nextRank ? `${p.data.xp.toLocaleString()} / ${p.nextRank.xp.toLocaleString()} XP to ${p.nextRank.name}` : 'Highest rank reached'));
    detail.appendChild(el('div.section-title', null, 'Hangar'));
    for (const a of AIRCRAFT.filter((x) => p.isUnlocked(x.id))) detail.appendChild(el('div.summary-line', null, el('span', null, a.name), el('span', null, CATEGORY_NAMES[a.category].replace(/s$/, ''))));
  }

  // =================================================================== MISSIONS
  missions() {
    const p = this.profile;
    const { node, body } = this.page('Missions', 'Operations', () => this.ui.showScreen('main'));
    const main = el('div.col', { style: { flex: '1', minWidth: '0' } });
    const detail = el('div.detail.panel.scroll.interactive');
    body.appendChild(main);
    body.appendChild(detail);
    const tabs = el('div.tabs.interactive');
    const cardsWrap = el('div.scroll.interactive', { style: { flex: '1', minHeight: '0', paddingRight: '6px' } });
    main.appendChild(tabs);
    main.appendChild(cardsWrap);
    const render = () => {
      clear(tabs);
      for (const c of MISSION_CATEGORIES) {
        const done = MISSIONS.filter((m) => m.category === c.id && p.data.missions[m.id]).length;
        const total = MISSIONS.filter((m) => m.category === c.id).length;
        tabs.appendChild(
          el(
            'button' + (this.missionCat === c.id ? '.active' : ''),
            {
              onclick: () => {
                this.missionCat = c.id;
                this.missionSel = null;
                render();
              },
            },
            `${c.icon} ${c.name.split(' ')[0].replace(/-$/, '')} `,
            el('small.muted', null, `${done}/${total}`)
          )
        );
      }
      clear(cardsWrap);
      const cat = MISSION_CATEGORIES.find((c) => c.id === this.missionCat);
      cardsWrap.appendChild(el('p.muted', { style: { margin: '0 0 12px' } }, cat.desc));
      const cards = el('div.cards');
      const list = MISSIONS.filter((m) => m.category === this.missionCat);
      if (!this.missionSel || this.missionSel.category !== this.missionCat) this.missionSel = list[0];
      list.forEach((m, i) => {
        const rec = p.data.missions[m.id];
        const locked = (m.requiredRank || 0) > p.rankIndex && !this.settings.get('gameplay').unlockAll;
        const card = el(
          'div.card' + (m === this.missionSel ? '.selected' : '') + (locked ? '.locked' : ''),
          {
            style: { animationDelay: `${i * 0.04}s` },
            onclick: () => {
              this.missionSel = m;
              for (const c of cards.children) c.classList.remove('selected');
              card.classList.add('selected');
              this.missionDetail(detail);
            },
          },
          rec && !locked ? el('div.lock', null, stars(rec.stars)) : null,
          el('h3', null, m.title),
          el('div.meta', null, `${'●'.repeat(m.difficulty || 1)}${'○'.repeat(Math.max(0, 3 - (m.difficulty || 1)))}  ·  ${m.aircraft.map((a) => getAircraft(a).name.split(' ').slice(-1)[0]).join(' / ')}`),
          el('div.desc', null, m.briefing.length > 130 ? m.briefing.slice(0, 128) + '…' : m.briefing),
          el(
            'div.foot',
            null,
            el('span.reward', null, `${fmtMoney(m.reward.credits)} · ${m.reward.xp} XP`),
            locked ? el('span.tag.red', null, `🔒 ${RANKS[m.requiredRank].name}`) : rec ? el('span.tag.green', null, `Best ${rec.bestScore}`) : null
          )
        );
        cards.appendChild(card);
      });
      cardsWrap.appendChild(cards);
      this.missionDetail(detail);
    };
    render();
    return node;
  }

  missionDetail(detail) {
    const p = this.profile;
    const m = this.missionSel;
    clear(detail);
    if (!m) return;
    const locked = (m.requiredRank || 0) > p.rankIndex && !this.settings.get('gameplay').unlockAll;
    const cat = MISSION_CATEGORIES.find((c) => c.id === m.category);
    detail.appendChild(el('div.tag', { style: { alignSelf: 'flex-start' } }, `${cat.icon} ${cat.name}`));
    detail.appendChild(el('h2', { style: { marginTop: '8px' } }, m.title));
    detail.appendChild(el('div.sub', null, `Difficulty ${'●'.repeat(m.difficulty || 1)}${'○'.repeat(Math.max(0, 3 - (m.difficulty || 1)))}`));
    detail.appendChild(el('p', null, m.briefing));
    const start = m.start;
    const startText = start.airport ? `${getAirport(start.airport).name} — ${start.spawn === 'gate' ? 'gate' : `runway ${start.runway || ''}`}` : start.final ? `Final approach ${start.final.airport} ${start.final.runway}` : start.air ? `Airborne at ${start.air.altFt.toLocaleString()} ft` : 'Airborne';
    const lines = [
      ['Start', startText],
      ['Destination', m.destination ? `${m.destination} ${getAirport(m.destination).name}` : '—'],
      ['Time', fmtTime(m.time ?? 12)],
      ['Weather', WEATHER_LABELS[m.weather] || m.weather],
      ['Reward', `${fmtMoney(m.reward.credits)} + ${m.reward.xp} XP`],
      ['Time limit', m.timeLimit ? fmtDuration(m.timeLimit) : 'None'],
    ];
    for (const [k, v] of lines) detail.appendChild(el('div.summary-line', null, el('span', null, k), el('span', null, v)));
    if (!this.missionAc || !m.aircraft.includes(this.missionAc)) this.missionAc = m.aircraft.find((a) => p.isUnlocked(a)) || m.aircraft[0];
    if (m.aircraft.length > 1) {
      detail.appendChild(el('div.section-title', null, 'Aircraft'));
      detail.appendChild(
        segmented(
          m.aircraft.map((a) => ({ value: a, label: getAircraft(a).name })),
          this.missionAc,
          (v) => {
            this.missionAc = v;
            this.game.setupMenuScene(v, p.liveryFor(v));
          }
        )
      );
      detail.appendChild(el('div.muted', { style: { fontSize: '12px', marginTop: '6px' } }, 'Mission aircraft are provided by the operator.'));
    }
    const rec = p.data.missions[m.id];
    if (rec) detail.appendChild(el('div', { style: { marginTop: '12px' } }, el('span.muted', null, 'Best: '), stars(rec.stars), el('span.mono', { style: { marginLeft: '8px' } }, `${rec.bestScore} pts · completed ${rec.completed}×`)));
    const b = button(locked ? `Requires ${RANKS[m.requiredRank].name}` : 'Start mission', () => this.startMission(m), 'primary');
    b.disabled = locked;
    detail.appendChild(el('div.actions', null, b));
    this.game.setupMenuScene(this.missionAc, p.liveryFor(this.missionAc));
  }

  startMission(m) {
    const ac = this.missionAc && m.aircraft.includes(this.missionAc) ? this.missionAc : m.aircraft[0];
    const spec = getAircraft(ac);
    this.game.startFlight({
      aircraftId: ac,
      livery: this.profile.liveryFor(ac),
      mission: m,
      airport: m.start.airport,
      time: m.time ?? 12,
      weather: m.weather || 'fewClouds',
      wind: m.wind,
      fuel: m.fuel ?? 0.6,
      callsign: this.callsign(spec),
      camera: m.category === 'military' ? 'chase' : undefined,
    });
  }

  // =================================================================== FLIGHT SCHOOL
  school() {
    const p = this.profile;
    const { node, body } = this.page('Flight School', 'Learn to fly', () => this.ui.showScreen('main'));
    const main = el('div.col.scroll.interactive', { style: { flex: '1', minWidth: '0', paddingRight: '6px' } });
    const detail = el('div.detail.panel.scroll.interactive');
    body.appendChild(main);
    body.appendChild(detail);
    main.appendChild(el('div.section-title', null, 'Interactive lessons'));
    const cards = el('div.cards');
    if (!this.lessonSel) this.lessonSel = TUTORIALS.find((t) => !p.data.tutorials[t.id]) || TUTORIALS[0];
    TUTORIALS.forEach((t, i) => {
      const done = !!p.data.tutorials[t.id];
      const card = el(
        'div.card' + (t === this.lessonSel ? '.selected' : ''),
        {
          style: { animationDelay: `${i * 0.04}s` },
          onclick: () => {
            this.lessonSel = t;
            for (const c of cards.children) c.classList.remove('selected');
            card.classList.add('selected');
            this.lessonDetail(detail);
          },
        },
        done ? el('div.lock', null, el('span.tag.green', null, '✓ Passed')) : null,
        el('h3', null, t.title),
        el('div.meta', null, getAircraft(t.aircraft).name),
        el('div.desc', null, t.desc)
      );
      cards.appendChild(card);
    });
    main.appendChild(cards);
    main.appendChild(el('div.section-title', { style: { marginTop: '24px' } }, 'Pilot handbook'));
    const hb = el('div.cards');
    for (const [title, text] of HANDBOOK) hb.appendChild(el('div.card', { style: { cursor: 'default' } }, el('h3', null, title), el('div.desc', { html: text })));
    main.appendChild(hb);
    this.lessonDetail(detail);
    return node;
  }

  lessonDetail(detail) {
    const t = this.lessonSel;
    clear(detail);
    const spec = getAircraft(t.aircraft);
    detail.appendChild(el('div.tag.gold', { style: { alignSelf: 'flex-start' } }, 'Lesson'));
    detail.appendChild(el('h2', { style: { marginTop: '8px' } }, t.title.replace(/^\d+\.\s*/, '')));
    detail.appendChild(el('div.sub', null, spec.name));
    detail.appendChild(el('p', null, t.desc));
    detail.appendChild(el('div.section-title', null, `${t.steps.length} steps`));
    const ol = el('ol', { style: { paddingLeft: '18px', color: '#c5d3e4', fontSize: '13px', lineHeight: '1.5' } });
    for (const s of t.steps.slice(0, -1)) ol.appendChild(el('li', { style: { marginBottom: '6px' } }, s.text.length > 110 ? s.text.slice(0, 108) + '…' : s.text));
    detail.appendChild(ol);
    detail.appendChild(
      el(
        'div.actions',
        null,
        button('Start lesson', () => {
          this.game.startFlight({
            aircraftId: t.aircraft,
            livery: this.profile.liveryFor(t.aircraft),
            mission: t,
            tutorial: true,
            airport: t.start.airport,
            time: t.time ?? 11,
            weather: t.weather || 'clear',
            wind: t.wind,
            fuel: 0.55,
            camera: t.aircraft === 'fx16' ? 'chase' : 'cockpit',
            callsign: this.callsign(spec),
          });
        }, 'primary')
      )
    );
    this.game.setupMenuScene(t.aircraft, this.profile.liveryFor(t.aircraft));
  }

  // =================================================================== MULTIPLAYER
  multiplayer() {
    const g = this.game;
    const mp = g.multiplayer;
    const p = this.profile;
    const { node, body } = this.page('Multiplayer', 'Fly together', () => this.ui.showScreen('main'));
    const left = el('div.panel.scroll.interactive', { style: { width: '460px', flex: 'none', padding: '18px 22px' } });
    const right = el('div.panel.interactive.col', { style: { flex: '1', padding: '18px 22px', minWidth: '0' } });
    body.appendChild(left);
    body.appendChild(right);
    const cfg = (this.mpCfg = this.mpCfg || { mode: 'server', url: mp.defaultUrl(), room: 'public' });
    const status = el('div.muted', { style: { marginTop: '10px', fontSize: '13px' } }, mp.connected ? `Connected — room “${mp.room}”` : 'Not connected');
    const nameIn = el('input', { type: 'text', maxLength: 24 });
    nameIn.value = p.data.name;
    const csIn = el('input', { type: 'text', maxLength: 10 });
    csIn.value = p.data.callsign;
    const urlIn = el('input', { type: 'text' });
    urlIn.value = cfg.url;
    const roomIn = el('input', { type: 'text', maxLength: 24 });
    roomIn.value = cfg.room;
    left.appendChild(el('div.section-title', null, 'Pilot'));
    left.appendChild(row('Name', nameIn));
    left.appendChild(row('Callsign', csIn));
    left.appendChild(el('div.section-title', null, 'Session'));
    const urlRow = row('Server address', urlIn, 'Run “npm run server” to host');
    left.appendChild(
      row(
        'Connection',
        segmented(
          [
            { value: 'server', label: 'Online server' },
            { value: 'local', label: 'Local (browser tabs)' },
          ],
          cfg.mode,
          (v) => {
            cfg.mode = v;
            urlRow.classList.toggle('hidden', v === 'local');
          }
        )
      )
    );
    urlRow.classList.toggle('hidden', cfg.mode === 'local');
    left.appendChild(urlRow);
    left.appendChild(row('Room', roomIn, 'Pilots in the same room see each other'));
    const connectBtn = button(mp.connected ? 'Disconnect' : 'Connect', async () => {
      if (mp.connected) {
        mp.disconnect();
        this.ui.showScreen('multiplayer');
        return;
      }
      cfg.url = urlIn.value.trim();
      cfg.room = roomIn.value.trim() || 'public';
      p.data.name = nameIn.value.trim() || p.data.name;
      p.data.callsign = csIn.value.trim().toUpperCase() || p.data.callsign;
      p.persist();
      status.textContent = 'Connecting…';
      try {
        const spec = g.showcaseSpec || getAircraft('mj320');
        await mp.connect({ url: cfg.mode === 'local' ? 'local' : cfg.url, room: cfg.room, name: p.data.name, callsign: p.data.callsign, aircraft: spec.id, livery: p.liveryFor(spec.id) });
        this.ui.showScreen('multiplayer');
      } catch (e) {
        status.textContent = `Connection failed: ${e && e.message ? e.message : 'server unreachable'}. Start the server with “npm run server” or use Local mode.`;
      }
    }, mp.connected ? 'danger' : 'primary');
    left.appendChild(el('div', { style: { display: 'flex', gap: '10px', marginTop: '16px' } }, connectBtn, button('Choose aircraft & fly', () => this.ui.showScreen('freeflight'), mp.connected ? 'primary' : '')));
    left.appendChild(status);
    left.appendChild(el('div.section-title', null, 'How it works'));
    left.appendChild(
      el(
        'p.muted',
        { style: { fontSize: '13px', lineHeight: '1.55' } },
        'Online: everyone connects to the same relay server (included — “npm run server”, default port 8080) and joins the same room. Local: open the simulator in several browser tabs on this computer to test formation flying. In flight press Enter to chat; other pilots appear on your map, navigation display and TCAS.'
      )
    );

    right.appendChild(el('div.section-title', null, `Pilots in session (${mp.players.length + (mp.connected ? 1 : 0)})`));
    const pl = el('div.players-list');
    if (mp.connected) pl.appendChild(el('div.p', null, el('span', null, `${p.data.callsign} (you)`), el('span.muted', null, (g.showcaseSpec || {}).name || '')));
    for (const pi of mp.players) pl.appendChild(el('div.p', null, el('span', null, `${pi.callsign || ''} ${pi.name ? '· ' + pi.name : ''}`), el('span.muted', null, getAircraft(pi.aircraft).name)));
    if (!mp.connected) pl.appendChild(el('div.muted', { style: { fontSize: '13px' } }, 'Connect to see other pilots.'));
    right.appendChild(pl);
    right.appendChild(el('div.section-title', null, 'Chat'));
    const log = el('div.chat-log.scroll');
    for (const m of this.ui.chatHistory) log.appendChild(this.chatLine(m));
    right.appendChild(log);
    const chatIn = el('input', { type: 'text', placeholder: mp.connected ? 'Type a message and press Enter' : 'Connect to chat', maxLength: 240 });
    chatIn.disabled = !mp.connected;
    chatIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatIn.value.trim()) {
        mp.chat(chatIn.value);
        chatIn.value = '';
      }
      e.stopPropagation();
    });
    right.appendChild(el('div', { style: { marginTop: '8px' } }, chatIn));
    log.scrollTop = log.scrollHeight;
    this.mpLog = log;
    return node;
  }

  chatLine(m) {
    if (m.system) return el('div.sys', null, m.text);
    return el('div' + (m.mine ? '.mine' : ''), null, el('span.from', null, m.from || '?'), m.text);
  }

  // =================================================================== SETTINGS
  settingsScreen(opts = {}) {
    const inFlight = !!opts.inFlight;
    const { node, body } = this.page('Settings', 'Configuration', () => (inFlight ? this.ui.closeModal() : this.ui.showScreen('main')), 'settings');
    const wrap = el('div.col', { style: { flex: '1', minWidth: '0', maxWidth: '980px' } });
    body.appendChild(wrap);
    const tabs = el('div.tabs.interactive');
    const content = el('div.panel.scroll.interactive', { style: { flex: '1', minHeight: '0' } });
    wrap.appendChild(tabs);
    wrap.appendChild(content);
    const defs = [
      ['graphics', 'Graphics'],
      ['audio', 'Sound'],
      ['controls', 'Controls'],
      ['bindings', 'Key bindings'],
      ['gameplay', 'Gameplay'],
    ];
    const render = () => {
      clear(tabs);
      for (const [id, label] of defs)
        tabs.appendChild(
          el(
            'button' + (this.settingsTab === id ? '.active' : ''),
            {
              onclick: () => {
                this.settingsTab = id;
                render();
              },
            },
            label
          )
        );
      clear(content);
      if (this.axisTimer) {
        clearTimeout(this.axisTimer);
        this.axisTimer = null;
      }
      this['settings_' + this.settingsTab](content, render);
    };
    render();
    return node;
  }

  settings_graphics(c, rerender) {
    const s = this.settings;
    const gr = s.get('graphics');
    const set = (k) => (v) => s.set('graphics', k, v);
    c.appendChild(el('div.section-title', { style: { marginTop: '16px' } }, 'Quality preset'));
    c.appendChild(
      row(
        'Preset',
        segmented(
          [...Object.keys(GRAPHICS_PRESETS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), { value: 'custom', label: 'Custom' }],
          gr.preset,
          (v) => {
            if (v !== 'custom') s.applyPreset(v);
            rerender();
          }
        ),
        'Low for laptops, Ultra for high-end GPUs'
      )
    );
    c.appendChild(el('div.section-title', null, 'Display'));
    c.appendChild(row('Resolution scale', slider(0.5, 1.5, 0.05, gr.resolutionScale, set('resolutionScale'), (v) => `${Math.round(v * 100)}%`)));
    c.appendChild(row('Dynamic resolution', toggle(gr.dynamicResolution, set('dynamicResolution')), 'Lowers resolution automatically to keep the frame rate smooth'));
    c.appendChild(row('Field of view', slider(40, 95, 1, gr.fov, set('fov'), (v) => `${v}°`)));
    c.appendChild(row('Anti-aliasing', toggle(gr.antialias, set('antialias')), 'Takes effect after reloading the page'));
    c.appendChild(row('Bloom (light glow)', toggle(gr.bloom, set('bloom'))));
    c.appendChild(row('Frame-rate counter', toggle(gr.fpsCounter, set('fpsCounter'))));
    c.appendChild(el('div.section-title', null, 'World'));
    const seg = (k, opts) => segmented(opts.map((o) => ({ value: o, label: o[0].toUpperCase() + o.slice(1) })), gr[k], set(k));
    c.appendChild(row('Shadows', seg('shadows', ['off', 'low', 'high', 'ultra'])));
    c.appendChild(row('Terrain detail', seg('terrainDetail', ['low', 'medium', 'high', 'ultra'])));
    c.appendChild(row('View distance', seg('viewDistance', ['near', 'normal', 'far'])));
    c.appendChild(row('Trees & forests', seg('trees', ['off', 'low', 'medium', 'high', 'ultra'])));
    c.appendChild(row('Clouds', seg('clouds', ['low', 'medium', 'high', 'ultra'])));
    c.appendChild(row('City buildings', seg('buildings', ['low', 'medium', 'high', 'ultra']), 'Takes effect after reloading the page'));
    c.appendChild(el('div', { style: { padding: '14px 0' } }, button('Restore default settings', () => this.ui.confirm('Restore defaults?', 'All graphics, sound, control and gameplay settings will be reset.', () => (s.reset(), rerender())), 'small ghost')));
  }

  settings_audio(c) {
    const s = this.settings;
    const a = s.get('audio');
    const set = (k) => (v) => {
      s.set('audio', k, v);
      if (this.game.audio.applyVolumes) this.game.audio.applyVolumes();
    };
    const pct = (v) => `${Math.round(v * 100)}%`;
    c.appendChild(el('div.section-title', { style: { marginTop: '16px' } }, 'Volume'));
    c.appendChild(row('Master', slider(0, 1, 0.05, a.master, set('master'), pct)));
    c.appendChild(row('Engines', slider(0, 1, 0.05, a.engine, set('engine'), pct)));
    c.appendChild(row('Environment', slider(0, 1, 0.05, a.environment, set('environment'), pct), 'Wind, rain, thunder, rolling'));
    c.appendChild(row('Radio & warnings', slider(0, 1, 0.05, a.radio, set('radio'), pct)));
    c.appendChild(row('Interface', slider(0, 1, 0.05, a.ui, set('ui'), pct)));
    c.appendChild(el('div.section-title', null, 'Voice'));
    c.appendChild(row('Spoken ATC & callouts', toggle(a.voice, set('voice')), 'Uses your browser’s speech synthesis'));
    c.appendChild(el('div', { style: { padding: '14px 0' } }, button('Test sound', () => (this.game.audio.init(), this.game.audio.chime('apEngage'), this.game.audio.speak('Skyward one two three, cleared for takeoff', 'atc')), 'small')));
  }

  settings_controls(c) {
    const s = this.settings;
    const ct = s.get('controls');
    const set = (k) => (v) => s.set('controls', k, v);
    c.appendChild(el('div.section-title', { style: { marginTop: '16px' } }, 'Keyboard & mouse'));
    c.appendChild(row('Mouse yoke', toggle(ct.mouseYoke, set('mouseYoke')), 'Fly with the mouse position (hold right button to look around)'));
    c.appendChild(row('Control sensitivity', slider(0.4, 1.6, 0.05, ct.sensitivity, set('sensitivity'), (v) => `${Math.round(v * 100)}%`)));
    c.appendChild(row('Keyboard response', slider(0.4, 2, 0.05, ct.keyboardRate, set('keyboardRate'), (v) => `${Math.round(v * 100)}%`), 'How fast keys move the controls'));
    c.appendChild(row('Invert pitch', toggle(ct.invertPitch, set('invertPitch'))));
    c.appendChild(el('div.section-title', null, 'Controller & joystick'));
    c.appendChild(row('Dead zone', slider(0, 0.3, 0.01, ct.deadzone, set('deadzone'), (v) => `${Math.round(v * 100)}%`)));
    const gi = this.game.input.gamepadInfo;
    const devLine = el('div.mono', { style: { fontSize: '12px' } });
    c.appendChild(row('Detected device', devLine, 'Press a button on the device if it is not listed'));
    const axesBox = el('div.axes-grid');
    c.appendChild(row('Live axes', axesBox));
    const jm = { ...ct.joystick };
    const axisOpts = [{ value: -1, label: 'None' }, ...Array.from({ length: 8 }, (_, i) => ({ value: i, label: `Axis ${i}` }))];
    const setJ = (k) => (v) => {
      jm[k] = typeof jm[k] === 'boolean' ? v : Number(v);
      s.set('controls', 'joystick', { ...jm });
    };
    c.appendChild(el('div.section-title', null, 'Joystick / HOTAS axis mapping'));
    c.appendChild(row('Pitch axis', select(axisOpts, jm.pitch, setJ('pitch'))));
    c.appendChild(row('Roll axis', select(axisOpts, jm.roll, setJ('roll'))));
    c.appendChild(row('Rudder axis', select(axisOpts, jm.yaw, setJ('yaw'))));
    c.appendChild(row('Throttle axis', select(axisOpts, jm.throttle, setJ('throttle'))));
    c.appendChild(row('Invert joystick pitch', toggle(jm.invertPitch, setJ('invertPitch'))));
    c.appendChild(row('Invert throttle axis', toggle(jm.invertThrottle, setJ('invertThrottle'))));
    const gpm = { ...ct.gamepad };
    c.appendChild(el('div.section-title', null, 'Gamepad'));
    c.appendChild(row('Invert gamepad pitch', toggle(gpm.invertPitch, (v) => s.set('controls', 'gamepad', { ...gpm, invertPitch: v }))));
    c.appendChild(
      el(
        'div.muted',
        { style: { fontSize: '13px', lineHeight: '1.6', padding: '8px 0 16px' } },
        'Gamepad layout: left stick = pitch & roll · LT/RT = throttle · LB/RB = rudder · A = brakes · B = flaps up · X = flaps down · Y = gear · Back = camera · Start = pause · L3 = ATC · R3 = centre view · D-pad ↑↓ = trim, ← = autopilot, → = map · right stick = look around.'
      )
    );
    const tick = () => {
      devLine.textContent = gi.connected ? `${gi.type === 'gamepad' ? 'Gamepad' : 'Joystick'}: ${gi.id}` : 'No controller detected';
      clear(axesBox);
      (gi.axes || []).slice(0, 8).forEach((v, i) => {
        axesBox.appendChild(el('span', null, `Axis ${i}`));
        const pctL = 50 + Math.min(0, v) * 50,
          w = Math.abs(v) * 50;
        axesBox.appendChild(el('div.axis-meter', null, el('div', { style: { left: `${pctL}%`, width: `${w}%` } })));
        axesBox.appendChild(el('span', null, v.toFixed(2)));
      });
      if (!gi.connected) axesBox.appendChild(el('span.muted', { style: { gridColumn: '1 / 4' } }, '—'));
      if (c.isConnected) this.axisTimer = setTimeout(tick, 120);
    };
    tick();
  }

  settings_bindings(c, rerender) {
    const s = this.settings;
    const b = s.get('controls').bindings;
    const groups = {};
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
      const info = ACTION_INFO[action] || [action, 'Other'];
      (groups[info[1]] = groups[info[1]] || []).push(action);
    }
    c.appendChild(el('div.muted', { style: { fontSize: '13px', margin: '14px 0 4px' } }, 'Click a key to remove it, or “+ Add” and press a new key. Several keys can share an action.'));
    for (const [gname, actions] of Object.entries(groups)) {
      c.appendChild(el('div.section-title', null, gname));
      for (const action of actions) {
        const keys = el('div.keys');
        const r = el('div.bind-row', null, el('span', null, (ACTION_INFO[action] || [action])[0]), keys);
        for (const code of b[action] || [])
          keys.appendChild(
            el(
              'span.kbd',
              {
                title: 'Remove',
                onclick: () => {
                  const list = (b[action] || []).filter((x) => x !== code);
                  s.set('controls', 'bindings', { ...b, [action]: list });
                  rerender();
                },
              },
              keyCap(code)
            )
          );
        keys.appendChild(
          el(
            'button.btn.small.add',
            {
              onclick: (e) => {
                e.target.textContent = 'Press a key…';
                r.classList.add('capturing');
                this.game.input.captureKey((code) => {
                  if (code === 'Escape') return rerender();
                  const list = [...new Set([...(b[action] || []), code])];
                  s.set('controls', 'bindings', { ...b, [action]: list });
                  rerender();
                });
              },
            },
            '+ Add'
          )
        );
        c.appendChild(r);
      }
    }
    c.appendChild(el('div', { style: { padding: '16px 0' } }, button('Reset key bindings', () => (s.resetBindings(), rerender()), 'small ghost')));
  }

  settings_gameplay(c) {
    const s = this.settings;
    const gp = s.get('gameplay');
    const hud = s.get('hud');
    const set = (k) => (v) => s.set('gameplay', k, v);
    c.appendChild(el('div.section-title', { style: { marginTop: '16px' } }, 'Difficulty'));
    c.appendChild(
      row(
        'Flight assistance',
        segmented(
          [
            { value: 'beginner', label: 'Beginner', title: 'Stall & bank protection, auto-coordination, auto-trim' },
            { value: 'intermediate', label: 'Intermediate', title: 'Auto-trim and yaw damping' },
            { value: 'realistic', label: 'Realistic', title: 'No assists beyond the real aircraft systems' },
          ],
          gp.difficulty,
          set('difficulty')
        ),
        'Beginner adds envelope protection and auto-coordination'
      )
    );
    c.appendChild(row('Crashes & damage', toggle(gp.crashes, set('crashes')), 'When off, impacts are ignored'));
    c.appendChild(row('Unlimited fuel', toggle(gp.unlimitedFuel, set('unlimitedFuel'))));
    c.appendChild(row('Approach guidance', toggle(gp.guidance, set('guidance')), 'Green boxes along the final approach path'));
    c.appendChild(row('Hints', toggle(gp.hints, set('hints'))));
    c.appendChild(row('Unlock all aircraft', toggle(gp.unlockAll, set('unlockAll')), 'Sandbox mode — every aircraft available in Free Flight'));
    c.appendChild(el('div.section-title', null, 'World'));
    c.appendChild(row('AI air traffic', segmented(['off', 'low', 'normal', 'high'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), gp.aiTraffic, set('aiTraffic'))));
    c.appendChild(row('Dynamic weather in free flight', toggle(gp.dynamicWeather, set('dynamicWeather'))));
    c.appendChild(el('div.section-title', null, 'Interface'));
    c.appendChild(
      row(
        'Units',
        segmented(
          [
            { value: 'aviation', label: 'Aviation (kt, ft, NM)' },
            { value: 'metric', label: 'Metric (km/h, m, km)' },
          ],
          gp.units,
          set('units')
        )
      )
    );
    c.appendChild(row('External HUD', segmented(['full', 'minimal', 'off'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), hud.mode, (v) => s.set('hud', 'mode', v))));
    c.appendChild(row('Cockpit HUD', segmented(['full', 'minimal', 'off'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), hud.cockpitHud, (v) => s.set('hud', 'cockpitHud', v)), 'Overlay shown in the cockpit view'));
    const cs = el('input', { type: 'text', maxLength: 10, placeholder: this.profile.data.callsign });
    cs.value = gp.callsign || '';
    cs.addEventListener('change', () => s.set('gameplay', 'callsign', cs.value.trim().toUpperCase()));
    c.appendChild(row('Radio callsign', cs, 'Leave empty to use your pilot callsign'));
  }

  // =================================================================== EXIT
  exitScreen() {
    return el(
      'div.screen.exit',
      null,
      el(
        'div',
        null,
        this.logo(),
        el('h2', { style: { fontFamily: 'var(--font-cond)', letterSpacing: '0.1em', marginTop: '40px' } }, 'Thanks for flying with Skyward'),
        el('p.muted', null, 'Your progress has been saved. You can close this tab.'),
        el('div', { style: { marginTop: '24px' } }, button('Return to main menu', () => this.ui.showScreen('main'), 'primary'))
      )
    );
  }
}

const HANDBOOK = [
  ['Flight controls', 'Pitch with <kbd>W</kbd>/<kbd>S</kbd> (or arrows), roll with <kbd>A</kbd>/<kbd>D</kbd>, rudder with <kbd>Q</kbd>/<kbd>E</kbd>. Throttle: <kbd>Shift</kbd>/<kbd>Ctrl</kbd> or <kbd>=</kbd>/<kbd>-</kbd>, <kbd>F4</kbd> full, <kbd>F1</kbd> idle. Mouse yoke and controllers can be enabled in Settings.'],
  ['Takeoff', 'Release the parking brake (<kbd>K</kbd>), set takeoff flaps, apply full power and keep the centreline with the rudder. Rotate at V<sub>R</sub> (the “R” marker on the speed tape) to about 10–15° pitch. Gear up (<kbd>G</kbd>) when climbing, then retract flaps (<kbd>V</kbd>) as speed increases.'],
  ['Landing', 'Slow down, extend flaps progressively (<kbd>F</kbd>) and the gear. Fly a 3° glide path — the PAPI lights show two white and two red. Cross the threshold at V<sub>REF</sub>, reduce to idle and flare gently. Brake with <kbd>B</kbd> and use reversers (<kbd>R</kbd>).'],
  ['Autopilot', '<kbd>Z</kbd> engages the autopilot, <kbd>X</kbd> the autothrottle. On the HUD panel or cockpit FCU select speed, heading, altitude and vertical speed. HDG flies the selected heading, NAV follows the flight plan, LVL CHG climbs or descends to the selected altitude, APPR captures the ILS.'],
  ['ILS & autoland', 'Select an approach on the map (<kbd>M</kbd>) or request one from ATC. Fly towards the localizer and press APPR: LOC and G/S arm in blue and capture in green. Airliners with autoland will flare, retard the thrust and track the centreline automatically.'],
  ['Air traffic control', 'Press <kbd>Tab</kbd> for the radio menu. At the gate request pushback and taxi, follow the green taxi line to the holding point, report ready and wait for takeoff clearance. Inbound, request an approach — ATC gives vectors and landing clearance.'],
  ['Weather & navigation', 'The navigation display shows your route in magenta, other traffic and storm cells from the weather radar. Avoid red cells — they bring heavy turbulence and downdrafts. Crosswind landings need rudder to align with the runway just before touchdown.'],
  ['Cameras', '<kbd>1</kbd> cockpit · <kbd>2</kbd> cabin · <kbd>3</kbd> external · <kbd>4</kbd> wing · <kbd>5</kbd> cinematic · <kbd>6</kbd> tower · <kbd>7</kbd> fly-by. <kbd>C</kbd> cycles. Right-drag to look around, scroll to zoom. In the cockpit click switches and scroll over knobs.'],
];

export { WEATHER_LABELS, AIRPORT_TYPES, escapeHtml };
