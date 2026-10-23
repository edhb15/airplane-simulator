// Static description of the Aurelia region: geography, airports, cities and airlines.
// Coordinates are meters. +X = east, +Z = south, +Y = up. Heading 0 = north (-Z).

export const WORLD = {
  name: 'Aurelia',
  seed: 20251,
  // Geographic reference for GPS read-outs.
  originLat: 37.5,
  originLon: -30.0,
  // Extent of the generated landmass region (beyond is open ocean).
  halfSize: 230000,
};

// Main continent is an ellipse with a noisy, domain-warped coastline.
export const CONTINENT = { cx: 0, cz: -15000, rx: 168000, rz: 128000 };

// Mountain ranges are polylines (meters) with a half width and peak height.
export const MOUNTAIN_RANGES = [
  {
    name: 'Spine Range',
    points: [
      [-135000, -72000],
      [-80000, -54000],
      [-25000, -76000],
      [30000, -64000],
      [92000, -88000],
      [140000, -66000],
    ],
    width: 24000,
    peak: 3700,
  },
  {
    name: 'Eastern Highlands',
    points: [
      [52000, 8000],
      [88000, 22000],
      [126000, 12000],
    ],
    width: 15000,
    peak: 1500,
  },
  {
    name: 'Western Hills',
    points: [
      [-152000, -28000],
      [-118000, -10000],
      [-96000, 8000],
    ],
    width: 14000,
    peak: 1100,
  },
];

export const ISLANDS = [
  { name: 'Coral Island', x: 135000, z: 116000, r: 12000, h: 160 },
  { name: 'Palm Cay', x: 166000, z: 90000, r: 5000, h: 90 },
  { name: 'Seal Rock', x: 92000, z: 152000, r: 4200, h: 240 },
  { name: 'Westward Isle', x: -152000, z: 118000, r: 9000, h: 420 },
];

// Bays carve water into the continent.
export const BAYS = [
  { name: 'Meridian Bay', x: 2000, z: 108000, r: 21000 },
  { name: 'Gull Inlet', x: -96000, z: 96000, r: 12000 },
];

// Inland lakes have their own water surface at `level`.
export const LAKES = [
  { name: 'Silver Lake', x: -44000, z: 12000, r: 6500, level: 48 },
  { name: 'Mirror Lake', x: 46000, z: 30000, r: 3800, level: 58 },
];

export const CITIES = [
  { name: 'Port Meridian', x: 2000, z: 82000, r: 9500, core: 2600, maxHeight: 330, density: 1.0 },
  { name: 'Northgate', x: -57000, z: -4000, r: 3600, core: 900, maxHeight: 90, density: 0.7 },
  { name: 'Eastport', x: 112000, z: 70000, r: 5000, core: 1400, maxHeight: 160, density: 0.85 },
  { name: 'Westhaven', x: -116000, z: 52000, r: 3200, core: 700, maxHeight: 60, density: 0.6 },
  { name: 'Pine Valley', x: -31000, z: 38000, r: 1700, core: 300, maxHeight: 25, density: 0.45 },
  { name: 'Eagle Peak', x: 11500, z: -51000, r: 1500, core: 300, maxHeight: 22, density: 0.45 },
  { name: 'Coral Town', x: 141500, z: 123500, r: 1900, core: 350, maxHeight: 35, density: 0.5 },
  { name: 'Ironwood', x: 64000, z: -14000, r: 1700, core: 350, maxHeight: 30, density: 0.5 },
  { name: 'Lakeside', x: -36000, z: 3500, r: 2000, core: 400, maxHeight: 30, density: 0.5 },
];

// Airports. Runway headings are true headings; offsets are meters along/right of the
// airport's primary heading from the airport reference point.
export const AIRPORTS = [
  {
    icao: 'AXMI',
    name: 'Meridian International',
    city: 'Port Meridian',
    type: 'international',
    x: 32000,
    z: 70000,
    elevation: 120,
    heading: 90,
    terminalSide: 1,
    freq: { atis: 127.85, ground: 121.9, tower: 118.7, approach: 119.45 },
    runways: [
      { ids: ['09L', '27R'], along: 0, right: -760, length: 3800, width: 60, ils: [true, true] },
      { ids: ['09R', '27L'], along: 400, right: 760, length: 3300, width: 45, ils: [true, true] },
    ],
  },
  {
    icao: 'AXNG',
    name: 'Northgate Regional',
    city: 'Northgate',
    type: 'regional',
    x: -72000,
    z: -16000,
    elevation: 108,
    heading: 160,
    terminalSide: 1,
    freq: { atis: 126.2, ground: 121.75, tower: 119.1, approach: 124.3 },
    runways: [{ ids: ['16', '34'], along: 0, right: 0, length: 2700, width: 45, ils: [true, true] }],
  },
  {
    icao: 'AXPV',
    name: 'Pine Valley Airfield',
    city: 'Pine Valley',
    type: 'ga',
    x: -24000,
    z: 30000,
    elevation: 58,
    heading: 40,
    terminalSide: -1,
    freq: { atis: 128.4, ground: 121.6, tower: 122.8, approach: 124.3 },
    runways: [{ ids: ['04', '22'], along: 0, right: 0, length: 1250, width: 25, ils: [false, false] }],
  },
  {
    icao: 'AXEP',
    name: 'Eagle Peak Mountain',
    city: 'Eagle Peak',
    type: 'regional',
    x: 5000,
    z: -57000,
    elevation: 930,
    heading: 130,
    terminalSide: -1,
    freq: { atis: 127.0, ground: 121.8, tower: 118.3, approach: 126.65 },
    runways: [{ ids: ['13', '31'], along: 0, right: 0, length: 2100, width: 45, ils: [true, false] }],
  },
  {
    icao: 'AXCI',
    name: 'Coral Island International',
    city: 'Coral Town',
    type: 'regional',
    x: 133000,
    z: 114000,
    elevation: 22,
    heading: 70,
    terminalSide: 1,
    freq: { atis: 126.9, ground: 121.85, tower: 118.9, approach: 120.4 },
    runways: [{ ids: ['07', '25'], along: 0, right: 0, length: 2600, width: 45, ils: [true, true] }],
  },
  {
    icao: 'AXIW',
    name: 'Ironwood Air Force Base',
    city: 'Ironwood',
    type: 'military',
    x: 76000,
    z: -24000,
    elevation: 86,
    heading: 180,
    terminalSide: 1,
    freq: { atis: 128.75, ground: 121.7, tower: 126.2, approach: 125.8 },
    runways: [{ ids: ['18', '36'], along: 0, right: 0, length: 3100, width: 45, ils: [true, true] }],
  },
  {
    icao: 'AXEC',
    name: 'Eastport Cargo Hub',
    city: 'Eastport',
    type: 'cargo',
    x: 98000,
    z: 52000,
    elevation: 108,
    heading: 120,
    terminalSide: -1,
    freq: { atis: 127.6, ground: 121.95, tower: 119.9, approach: 120.95 },
    runways: [{ ids: ['12', '30'], along: 0, right: 0, length: 3400, width: 60, ils: [true, true] }],
  },
  {
    icao: 'AXWH',
    name: 'Westhaven Coastal',
    city: 'Westhaven',
    type: 'regional',
    x: -126000,
    z: 40000,
    elevation: 64,
    heading: 100,
    terminalSide: 1,
    freq: { atis: 126.55, ground: 121.65, tower: 118.45, approach: 119.75 },
    runways: [{ ids: ['10', '28'], along: 0, right: 0, length: 2300, width: 45, ils: [true, true] }],
  },
  {
    icao: 'AXAS',
    name: 'Alpine Strip',
    city: 'Frost Pass',
    type: 'ga',
    x: -76000,
    z: -52000,
    elevation: 1300,
    heading: 90,
    terminalSide: 1,
    noCorridor: true,
    freq: { atis: 128.1, ground: 122.9, tower: 122.9, approach: 126.65 },
    runways: [{ ids: ['09', '27'], along: 0, right: 0, length: 1000, width: 22, ils: [false, false] }],
  },
];

export const AIRLINES = [
  { code: 'AUR', callsign: 'AURELIA', name: 'Aurelia Airways', livery: 'aurelia' },
  { code: 'CST', callsign: 'COASTAL', name: 'Coastal Air', livery: 'coastal' },
  { code: 'NST', callsign: 'NORTHSTAR', name: 'Northstar', livery: 'northstar' },
  { code: 'SCX', callsign: 'SKYCARGO', name: 'SkyCargo Express', livery: 'skycargo' },
  { code: 'MER', callsign: 'MERIDIAN', name: 'Meridian Air', livery: 'meridian' },
  { code: 'ISL', callsign: 'ISLANDER', name: 'Island Hopper', livery: 'islander' },
];

export function airportByIcao(icao) {
  return AIRPORTS.find((a) => a.icao === icao) || null;
}
