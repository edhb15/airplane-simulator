// Career mode: dynamic job board generated from the pilot's current airport.

import { AIRPORT_INFO, getAirport, bestRunwayEnd } from '../world/airportGeometry.js';
import { AIRCRAFT, getAircraft } from '../aircraft/aircraftData.js';
import { mulberry32 } from '../world/noise.js';

const MIN_RUNWAY = { k172: 600, lj45: 1300, rj900: 1600, mj320: 1900, mw350: 2500, t74f: 3000, ct130: 1000, fx16: 1500, ef2: 1500 };
const WEATHER_POOL = ['clear', 'fewClouds', 'fewClouds', 'scattered', 'scattered', 'broken', 'overcast', 'rain', 'fog', 'thunderstorm'];
const PAX_NAMES = ['Scheduled service', 'Holiday charter', 'Business shuttle', 'Sports team charter', 'Corporate flight', 'Wedding party', 'Medical team transfer'];
const CARGO_NAMES = ['Express parcels', 'Fresh seafood', 'Machine parts', 'Electronics', 'Mail run', 'Pharmaceuticals', 'Relief supplies', 'Flowers & produce'];

function longestRunway(ap) {
  return Math.max(...ap.runwayObjs.map((r) => r.length));
}

export function generateJobs(profile, count = 8) {
  const d = profile.data;
  const here = getAirport(d.location) || getAirport('AXMI');
  const owned = AIRCRAFT.filter((a) => profile.isUnlocked(a.id) && a.category !== 'fighter');
  const r = mulberry32((d.logbook.length + 1) * 7919 + d.location.charCodeAt(2) * 31 + (profile.jobSeed || 0));
  const jobs = [];
  const dests = AIRPORT_INFO.filter((a) => a.icao !== here.icao);
  let tries = 0;
  while (jobs.length < count && tries++ < 60) {
    const dest = dests[Math.floor(r() * dests.length)];
    const dist = Math.hypot(dest.x - here.x, dest.z - here.z) / 1852;
    const usable = owned.filter((a) => MIN_RUNWAY[a.id] <= Math.min(longestRunway(here), longestRunway(dest)) && a.rangeNm > dist * 1.5);
    if (!usable.length) continue;
    const ac = usable[Math.floor(r() * usable.length)];
    const cargo = ac.category === 'cargo' || (ac.mass.passengers === 0) || r() < 0.25;
    const pax = !cargo && ac.mass.passengers > 0;
    const load = 0.45 + r() * 0.5;
    const payload = pax ? { passengers: Math.max(1, Math.round(ac.mass.passengers * load)) } : { cargoKg: Math.round(ac.mass.maxPayload * load) };
    const size = ac.mass.maxTakeoff;
    const base = 900 + dist * (18 + Math.sqrt(size) * 0.12) * (pax ? 1 : 0.9);
    const weather = WEATHER_POOL[Math.floor(r() * WEATHER_POOL.length)];
    const wx = { thunderstorm: 1.5, rain: 1.25, fog: 1.35, overcast: 1.1, broken: 1.05 }[weather] || 1;
    const time = Math.round((5 + r() * 18) * 4) / 4;
    const night = time < 6 || time > 20 ? 1.15 : 1;
    const urgent = r() < 0.25;
    const credits = Math.round((base * wx * night * (urgent ? 1.3 : 1)) / 50) * 50;
    const windDir = Math.round(r() * 36) * 10;
    const windSpeed = 2 + Math.round(r() * 9);
    const end = bestRunwayEnd(dest, windDir, windSpeed, MIN_RUNWAY[ac.id]);
    const depEnd = bestRunwayEnd(here, windDir, windSpeed, MIN_RUNWAY[ac.id]);
    const name = pax ? PAX_NAMES[Math.floor(r() * PAX_NAMES.length)] : CARGO_NAMES[Math.floor(r() * CARGO_NAMES.length)];
    if (jobs.some((j) => j.to === dest.icao && j.aircraft === ac.id)) continue;
    jobs.push({
      id: `job-${here.icao}-${dest.icao}-${ac.id}-${jobs.length}`,
      title: `${name} to ${dest.name}`,
      type: pax ? 'passenger' : 'cargo',
      from: here.icao,
      to: dest.icao,
      aircraft: ac.id,
      payload,
      distanceNm: Math.round(dist),
      weather,
      time,
      wind: { dir: windDir, speed: windSpeed },
      urgent,
      timeLimit: urgent ? Math.round((dist / (ac.speeds.cruise * 0.55)) * 3600 + 900) : null,
      approach: end ? end.id : null,
      departure: depEnd ? depEnd.id : null,
      reward: { credits, xp: Math.round(120 + dist * 3.5 * wx) },
    });
  }
  return jobs;
}

// Convert a job into a mission definition consumable by MissionManager
export function jobToMission(job) {
  const ac = getAircraft(job.aircraft);
  return {
    id: job.id,
    category: job.type,
    title: job.title,
    aircraft: [job.aircraft],
    briefing: `${job.title}. ${job.payload.passengers ? `${job.payload.passengers} passengers` : `${Math.round(job.payload.cargoKg / 100) / 10} t of cargo`} from ${getAirport(job.from).name} to ${getAirport(job.to).name} (${job.distanceNm} NM). ${job.urgent ? 'URGENT: deliver within the time limit. ' : ''}Start at the gate: request taxi from ATC (Tab), take off from runway ${job.departure} and expect runway ${job.approach} at the destination.`,
    start: { airport: job.from, spawn: 'gate' },
    destination: job.to,
    approach: job.approach,
    time: job.time,
    weather: job.weather,
    wind: job.wind,
    payload: job.payload,
    fuel: Math.min(1, 0.25 + (job.distanceNm * 1.4) / ac.rangeNm),
    cruiseAlt: Math.min(ac.speeds.cruiseAlt, Math.max(4000, Math.round((job.distanceNm * 250) / 1000) * 1000)),
    timeLimit: job.timeLimit,
    objectives: [{ type: 'takeoff' }, { type: 'land', airport: job.to }, { type: 'stop' }],
    reward: job.reward,
  };
}
