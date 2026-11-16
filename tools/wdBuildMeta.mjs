// Generates world-domination/src/data/meta.json from Natural Earth (world-atlas)
// and world-countries: one record per playable territory with its map geometry
// indices, land neighbours, centroid, area and coastline flag.
//   node tools/wdBuildMeta.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as topojson from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');
const wc = require('world-countries/countries.json');

const byNum = new Map(wc.map((c) => [c.ccn3, c]));
const byIso = new Map(wc.map((c) => [c.cca3, c]));

// Small dependencies folded into their sovereign's territory
const MERGE = {
  MNP: 'USA', VIR: 'USA', GUM: 'USA', ASM: 'USA',
  SGS: 'GBR', IOT: 'GBR', SHN: 'GBR', PCN: 'GBR', AIA: 'GBR', CYM: 'GBR', BMU: 'GBR', VGB: 'GBR',
  TCA: 'GBR', MSR: 'GBR', JEY: 'GBR', GGY: 'GBR', IMN: 'GBR',
  NIU: 'NZL', COK: 'NZL', ABW: 'NLD', CUW: 'NLD', SXM: 'NLD',
  SPM: 'FRA', WLF: 'FRA', MAF: 'FRA', BLM: 'FRA', ATF: 'FRA',
  ALA: 'FIN', FRO: 'DNK', MAC: 'CHN', HMD: 'AUS', NFK: 'AUS',
};
// Dependencies kept as their own territory, owned by a sovereign
const DEPENDENCY = { GRL: 'DNK', PRI: 'USA', ESH: 'MAR', NCL: 'FRA', PYF: 'FRA', FLK: 'GBR', HKG: 'CHN' };
// Disputed areas without an ISO code in Natural Earth
const UNNAMED = { Somaliland: 'SOM', Kosovo: 'XKX', 'N. Cyprus': 'CYP', 'Indian Ocean Ter.': 'AUS', 'Siachen Glacier': 'IND' };
const SKIP = new Set(['ATA']);
// Short display names where the common name is long or awkward
const NAMES = {
  USA: 'United States', GBR: 'United Kingdom', COD: 'DR Congo', COG: 'Congo', CAF: 'Central African Rep.',
  ARE: 'UAE', BIH: 'Bosnia', DOM: 'Dominican Rep.', PRK: 'North Korea', KOR: 'South Korea',
  VCT: 'St. Vincent', KNA: 'St. Kitts & Nevis', LCA: 'St. Lucia', STP: 'São Tomé', FSM: 'Micronesia',
  ATG: 'Antigua & Barbuda', TTO: 'Trinidad & Tobago', XKX: 'Kosovo', PSE: 'Palestine', CIV: "Côte d'Ivoire",
  GNQ: 'Eq. Guinea', SLB: 'Solomon Is.', MHL: 'Marshall Is.', FLK: 'Falklands', PYF: 'French Polynesia',
  ESH: 'Western Sahara', VAT: 'Vatican', CZE: 'Czechia', MKD: 'North Macedonia', SWZ: 'Eswatini',
};
// Sea crossings treated as land links (bridges, tunnels, narrow straits)
const EXTRA_LINKS = [
  ['GBR', 'FRA'], ['DNK', 'SWE'], ['ESP', 'MAR'], ['TUR', 'GRC'], ['ITA', 'TUN'], ['SAU', 'BHR'],
  ['MYS', 'SGP'], ['YEM', 'DJI'], ['RUS', 'JPN'], ['KOR', 'JPN'], ['LKA', 'IND'], ['IDN', 'MYS'],
  ['EST', 'FIN'], ['GBR', 'IRL'], ['CHN', 'TWN'], ['DNK', 'DEU'], ['IDN', 'PNG'], ['AUS', 'PNG'],
  ['PHL', 'MYS'], ['ITA', 'MLT'], ['TUR', 'CYP'], ['EGY', 'SAU'], ['IRN', 'ARE'], ['IRN', 'OMN'],
  ['QAT', 'BHR'], ['TTO', 'VEN'], ['CUB', 'USA'], ['BHS', 'USA'], ['HTI', 'CUB'], ['JAM', 'CUB'],
  ['GRL', 'CAN'], ['ISL', 'GRL'], ['DOM', 'PRI'], ['NZL', 'AUS'], ['MDG', 'MOZ'], ['COM', 'MOZ'],
  ['TLS', 'IDN'], ['BRN', 'MYS'], ['SWE', 'FIN'], ['NOR', 'GBR'], ['RUS', 'USA'], ['HKG', 'CHN'],
];

const geoms = topo.objects.countries.geometries;
const groups = new Map(); // territory id -> geometry indices
geoms.forEach((g, i) => {
  let iso = g.id ? byNum.get(g.id)?.cca3 : UNNAMED[g.properties.name];
  if (!iso || SKIP.has(iso)) return;
  if (MERGE[iso]) iso = MERGE[iso];
  if (!groups.has(iso)) groups.set(iso, []);
  groups.get(iso).push(i);
});

const ids = [...groups.keys()];
const idOf = new Map();
ids.forEach((id) => groups.get(id).forEach((gi) => idOf.set(gi, id)));

// Shared-arc neighbours from the topology
const nbIdx = topojson.neighbors(geoms);
const nb = new Map(ids.map((id) => [id, new Set()]));
nbIdx.forEach((list, i) => {
  const a = idOf.get(i);
  if (!a) return;
  list.forEach((j) => { const b = idOf.get(j); if (b && b !== a) { nb.get(a).add(b); nb.get(b).add(a); } });
});
for (const [a, b] of EXTRA_LINKS) {
  if (nb.has(a) && nb.has(b)) { nb.get(a).add(b); nb.get(b).add(a); }
}

const FIX = { XKX: { coastal: false, capital: 'Pristina', flag: '🇽🇰' } };
const r1 = (x) => Math.round(x * 10) / 10;
const out = ids.map((id) => {
  const gi = groups.get(id);
  const merged = topojson.merge(topo, gi.map((i) => geoms[i]));
  // Centroid of the biggest polygon so overseas islands don't drag it into the sea
  let best = null, bestA = -1, total = 0;
  for (const poly of merged.coordinates) {
    const f = { type: 'Polygon', coordinates: poly };
    const a = geoArea(f);
    total += a;
    if (a > bestA) { bestA = a; best = f; }
  }
  const [lng, lat] = geoCentroid(best);
  const c = byIso.get(id);
  const areaKm = c?.area > 0 ? c.area : total * 6371 * 6371;
  const sovereign = DEPENDENCY[id] || id;
  return {
    id,
    name: NAMES[id] || c?.name.common || id,
    owner: sovereign,
    geo: gi,
    nb: [...nb.get(id)].sort(),
    lat: r1(lat), lng: r1(lng),
    area: Math.round(areaKm),
    coastal: c ? !c.landlocked : true,
    capital: c?.capital?.[0] || '',
    region: c?.region || 'Europe',
    subregion: c?.subregion || 'Southeast Europe',
    flag: c?.flag || '',
    ...FIX[id],
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const path = new URL('../world-domination/src/data/meta.json', import.meta.url);
writeFileSync(path, JSON.stringify(out));
console.log(`${out.length} territories, ${out.reduce((s, t) => s + t.nb.length, 0) / 2} links -> ${path.pathname}`);
