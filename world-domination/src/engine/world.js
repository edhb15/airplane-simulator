// Static geography: territories, adjacency and distances. Never saved.
import META from '../data/meta.json';

export const TERRITORIES = META;
export const TERR = Object.fromEntries(META.map((t) => [t.id, t]));
export const TERR_IDS = META.map((t) => t.id);

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const distCache = new Map();
export function distance(a, b) {
  if (a === b) return 0;
  const k = a < b ? a + b : b + a;
  let d = distCache.get(k);
  if (d === undefined) {
    const A = TERR[a], B = TERR[b];
    const dLat = rad(B.lat - A.lat), dLng = rad(B.lng - A.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLng / 2) ** 2;
    d = 2 * R * Math.asin(Math.sqrt(h));
    distCache.set(k, d);
  }
  return d;
}

export function isNeighbor(a, b) {
  return TERR[a].nb.includes(b);
}

// Continent groupings used for regional goals and AI ambitions
export const CONTINENTS = {
  'North America': ['Northern America', 'Central America', 'Caribbean'],
  'South America': ['South America'],
  Europe: ['Northern Europe', 'Western Europe', 'Southern Europe', 'Eastern Europe', 'Central Europe', 'Southeast Europe'],
  Africa: ['Northern Africa', 'Western Africa', 'Eastern Africa', 'Middle Africa', 'Southern Africa'],
  'Middle East': ['Western Asia'],
  Asia: ['Central Asia', 'Southern Asia', 'Eastern Asia', 'South-Eastern Asia'],
  Oceania: ['Australia and New Zealand', 'Melanesia', 'Polynesia', 'Micronesia'],
};
const SUB_TO_CONT = {};
for (const [c, subs] of Object.entries(CONTINENTS)) for (const s of subs) SUB_TO_CONT[s] = c;
export function continentOf(tid) {
  return SUB_TO_CONT[TERR[tid].subregion] || 'Europe';
}
