// Pilot profile: credits, experience & rank, unlocked aircraft, liveries,
// logbook, statistics and mission progress. Persisted in localStorage.

import { load, save } from './storage.js';
import { AIRCRAFT, getAircraft } from '../aircraft/aircraftData.js';
import { AIRCRAFT_LIVERIES } from '../aircraft/Livery.js';

export const RANKS = [
  { name: 'Student Pilot', xp: 0, badge: '◇' },
  { name: 'Private Pilot', xp: 600, badge: '◆' },
  { name: 'Commercial Pilot', xp: 2000, badge: '✦' },
  { name: 'First Officer', xp: 4500, badge: '✦✦' },
  { name: 'Captain', xp: 9000, badge: '✦✦✦' },
  { name: 'Senior Captain', xp: 16000, badge: '★★★' },
  { name: 'Chief Pilot', xp: 28000, badge: '★★★★' },
];

const DEFAULT = {
  name: 'New Pilot',
  callsign: '',
  credits: 20000,
  xp: 0,
  location: 'AXMI',
  unlocked: AIRCRAFT.filter((a) => a.unlock.rank === 0 && a.unlock.price === 0).map((a) => a.id),
  liveries: {},
  customLiveries: [],
  logbook: [],
  stats: { flights: 0, hours: 0, landings: 0, bestLanding: null, distanceNm: 0, crashes: 0, missionsCompleted: 0, jobsCompleted: 0, earned: 0 },
  missions: {},
  tutorials: {},
  created: Date.now(),
};

export class Profile {
  constructor(settings) {
    this.settings = settings;
    this.data = { ...DEFAULT, ...load('skyward.profile', {}) };
    this.data.stats = { ...DEFAULT.stats, ...(this.data.stats || {}) };
    if (!this.data.callsign) this.data.callsign = `SKY${Math.floor(100 + Math.random() * 899)}`;
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  persist() {
    save('skyward.profile', this.data);
    for (const fn of this.listeners) fn(this.data);
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULT));
    this.data.callsign = `SKY${Math.floor(100 + Math.random() * 899)}`;
    this.persist();
  }

  get rankIndex() {
    let r = 0;
    for (let i = 0; i < RANKS.length; i++) if (this.data.xp >= RANKS[i].xp) r = i;
    return r;
  }
  get rank() {
    return RANKS[this.rankIndex];
  }
  get nextRank() {
    return RANKS[this.rankIndex + 1] || null;
  }
  get rankProgress() {
    const n = this.nextRank;
    if (!n) return 1;
    const c = this.rank;
    return (this.data.xp - c.xp) / (n.xp - c.xp);
  }

  isUnlocked(id) {
    return this.settings.get('gameplay').unlockAll || this.data.unlocked.includes(id);
  }

  canPurchase(id) {
    const a = getAircraft(id);
    if (this.isUnlocked(id)) return { ok: false, reason: 'Owned' };
    if (this.rankIndex < a.unlock.rank) return { ok: false, reason: `Requires ${RANKS[a.unlock.rank].name}` };
    if (this.data.credits < a.unlock.price) return { ok: false, reason: 'Not enough credits' };
    return { ok: true };
  }

  purchase(id) {
    const c = this.canPurchase(id);
    if (!c.ok) return c;
    const a = getAircraft(id);
    this.data.credits -= a.unlock.price;
    this.data.unlocked.push(id);
    this.persist();
    return { ok: true };
  }

  liveryFor(id) {
    const sel = this.data.liveries[id];
    if (sel && typeof sel === 'object') return sel;
    if (sel) {
      const custom = this.data.customLiveries.find((l) => l.id === sel);
      if (custom) return custom;
      return sel;
    }
    return AIRCRAFT_LIVERIES[id] ? AIRCRAFT_LIVERIES[id][0] : 'aurelia';
  }

  setLivery(id, livery) {
    this.data.liveries[id] = typeof livery === 'object' ? livery.id : livery;
    this.persist();
  }

  saveCustomLivery(liv) {
    const i = this.data.customLiveries.findIndex((l) => l.id === liv.id);
    if (i >= 0) this.data.customLiveries[i] = liv;
    else this.data.customLiveries.push(liv);
    this.persist();
  }

  // Record a flight in the logbook and update statistics. Returns rank-up info.
  addFlight(rec) {
    const before = this.rankIndex;
    const st = this.data.stats;
    st.flights++;
    st.hours += (rec.duration || 0) / 3600;
    st.distanceNm += rec.distanceNm || 0;
    if (rec.landed) {
      st.landings++;
      if (rec.landingRate !== null && rec.landingRate !== undefined && (st.bestLanding === null || Math.abs(rec.landingRate) < Math.abs(st.bestLanding))) st.bestLanding = rec.landingRate;
    }
    if (rec.crashed) st.crashes++;
    if (rec.credits) {
      this.data.credits += rec.credits;
      st.earned += Math.max(0, rec.credits);
    }
    if (rec.xp) this.data.xp += rec.xp;
    if (rec.missionId && rec.success) {
      const m = this.data.missions[rec.missionId] || { completed: 0, bestScore: 0, stars: 0 };
      m.completed++;
      m.bestScore = Math.max(m.bestScore, rec.score || 0);
      m.stars = Math.max(m.stars, rec.stars || 0);
      this.data.missions[rec.missionId] = m;
      st.missionsCompleted++;
    }
    if (rec.job && rec.success) {
      st.jobsCompleted++;
      if (rec.to) this.data.location = rec.to;
    }
    this.data.logbook.unshift({ ...rec, date: Date.now() });
    if (this.data.logbook.length > 200) this.data.logbook.length = 200;
    this.persist();
    return { rankUp: this.rankIndex > before ? RANKS[this.rankIndex] : null };
  }
}
