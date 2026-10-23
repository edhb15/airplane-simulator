// Aircraft specifications.
// Body frame (three.js): +X right, +Y up, +Z aft (nose points to -Z). Origin = centre of gravity.
// Masses in kg, lengths in metres, forces in N, power in W, speeds in knots unless noted.
// Control derivatives are per unit of normalised control command (-1..1).

const STABILITY = {
  ga: {
    Cma: -0.9, Cmq: -12, Cme: 0.55, Cm0: 0.02, CmFlap: -0.06, Cmtrim: 0.3,
    CYb: -0.35, CYr: -0.1,
    Clb: -0.09, Clp: -0.47, Clr: 0.1, Cla: 0.045, Clr_rud: -0.004,
    Cnb: 0.07, Cnr: -0.1, Cnp: -0.03, Cna: -0.006, Cnr_rud: 0.03,
  },
  jet: {
    Cma: -1.1, Cmq: -18, Cme: 0.6, Cm0: 0.03, CmFlap: -0.08, Cmtrim: 0.35,
    CYb: -0.7, CYr: -0.14,
    Clb: -0.16, Clp: -0.45, Clr: 0.12, Cla: 0.05, Clr_rud: -0.006,
    Cnb: 0.14, Cnr: -0.25, Cnp: -0.03, Cna: -0.004, Cnr_rud: 0.05,
  },
  heavy: {
    Cma: -1.25, Cmq: -22, Cme: 0.62, Cm0: 0.03, CmFlap: -0.08, Cmtrim: 0.35,
    CYb: -0.8, CYr: -0.14,
    Clb: -0.2, Clp: -0.45, Clr: 0.12, Cla: 0.045, Clr_rud: -0.006,
    Cnb: 0.16, Cnr: -0.3, Cnp: -0.03, Cna: -0.004, Cnr_rud: 0.055,
  },
  fighter: {
    Cma: -0.22, Cmq: -6, Cme: 0.32, Cm0: 0.0, CmFlap: -0.02, Cmtrim: 0.15,
    CYb: -0.9, CYr: -0.15,
    Clb: -0.08, Clp: -0.32, Clr: 0.05, Cla: 0.05, Clr_rud: -0.004,
    Cnb: 0.18, Cnr: -0.35, Cnp: -0.02, Cna: -0.004, Cnr_rud: 0.045,
  },
};

function aero(base, overrides) {
  return { ...STABILITY[base], ...overrides };
}

const FLAPS_GA = [
  { name: 'UP', deg: 0, dCL: 0, dCD: 0, dStall: 0 },
  { name: '10°', deg: 10, dCL: 0.25, dCD: 0.01, dStall: -1 },
  { name: '20°', deg: 20, dCL: 0.45, dCD: 0.03, dStall: -2 },
  { name: '30°', deg: 30, dCL: 0.6, dCD: 0.06, dStall: -3 },
];

const FLAPS_AIRLINER = [
  { name: 'UP', deg: 0, dCL: 0, dCD: 0, dStall: 0 },
  { name: '1', deg: 5, dCL: 0.32, dCD: 0.012, dStall: 3 },
  { name: '2', deg: 15, dCL: 0.6, dCD: 0.025, dStall: 2 },
  { name: '3', deg: 20, dCL: 0.82, dCD: 0.042, dStall: 1 },
  { name: 'FULL', deg: 35, dCL: 1.1, dCD: 0.075, dStall: 0 },
];

const FLAPS_BIZ = [
  { name: 'UP', deg: 0, dCL: 0, dCD: 0, dStall: 0 },
  { name: '8°', deg: 8, dCL: 0.3, dCD: 0.012, dStall: 0 },
  { name: '20°', deg: 20, dCL: 0.6, dCD: 0.03, dStall: -1 },
  { name: '40°', deg: 40, dCL: 0.9, dCD: 0.07, dStall: -2 },
];

const FLAPS_FIGHTER = [
  { name: 'AUTO', deg: 0, dCL: 0, dCD: 0, dStall: 0 },
  { name: 'LDG', deg: 20, dCL: 0.25, dCD: 0.03, dStall: 0 },
];

const FLAPS_CARGO_PROP = [
  { name: 'UP', deg: 0, dCL: 0, dCD: 0, dStall: 0 },
  { name: '50%', deg: 18, dCL: 0.5, dCD: 0.03, dStall: -1 },
  { name: '100%', deg: 36, dCL: 0.95, dCD: 0.075, dStall: -2 },
];

export const AIRCRAFT = [
  // -------------------------------------------------------------------------
  {
    id: 'k172',
    name: 'Kestrel K-172',
    manufacturer: 'Kestrel Aero',
    category: 'private',
    role: 'Single-engine high-wing trainer',
    description:
      'The classic four-seat trainer. Forgiving, slow and stable — the perfect aircraft to learn the basics of flight, traffic patterns and short-field landings.',
    unlock: { rank: 0, price: 0 },
    cockpit: 'ga',
    callsignPrefix: 'N',
    mass: { empty: 770, maxTakeoff: 1157, maxFuel: 145, maxPayload: 320, reference: 1050, passengers: 3 },
    wing: { area: 16.2, span: 11.0, chord: 1.5 },
    aero: aero('ga', {
      CL0: 0.31, CLa: 4.8, alphaStall: 15.5, alphaStallNeg: -12, CD0: 0.026, e: 0.75,
      gearCD: 0, spoilerCL: 0, spoilerCD: 0, Mcrit: 0.6,
    }),
    inertia: [1285, 1825, 2667],
    flaps: FLAPS_GA,
    flapRate: 4,
    engine: {
      type: 'piston', maxPower: 134000, maxRPM: 2700, idleRPM: 650, propDiameter: 1.93, blades: 2,
      efficiency: 0.8, vKnee: 40, bsfc: 0.25, startTime: 3,
      list: [{ pos: [0, 0.05, -2.95] }],
    },
    gear: {
      retractable: false,
      travel: 0.25,
      points: [
        { name: 'nose', pos: [0, -1.15, -1.75], steer: true, brake: false },
        { name: 'left', pos: [-1.25, -1.15, 0.35], steer: false, brake: true },
        { name: 'right', pos: [1.25, -1.15, 0.35], steer: false, brake: true },
      ],
    },
    fcs: { law: 'direct', maxPitchRate: 18, maxRollRate: 45, nzMax: 3.8, nzMin: -1.5, bankLimit: 60, yawDamper: false },
    autopilot: { athr: false, app: true, autoland: false },
    speeds: { vs: 48, vr: 55, vy: 74, vref: 65, vfe: 85, vno: 129, vne: 163, mmo: 0.3, cruise: 122, cruiseAlt: 8000, ceiling: 14000 },
    rangeNm: 640,
    eye: [-0.3, 0.55, -0.55],
    cabinEye: [0.3, 0.5, 0.45],
    model: {
      style: 'ga',
      fuselage: { noseZ: -2.95, tailZ: 5.3, width: 1.12, height: 1.38, centerY: 0.12 },
      wing: { mount: 'high', y: 0.86, rootLE: -0.48, rootChord: 1.63, tipChord: 1.13, span: 11.0, sweep: 0, dihedral: 1.7, thickness: 0.14, strut: true },
      htail: { y: 0.15, rootLE: 4.0, rootChord: 1.2, tipChord: 0.8, span: 3.45, sweep: 6, dihedral: 0 },
      vtail: { y: 0.4, rootLE: 3.75, rootChord: 1.55, tipChord: 0.72, height: 1.45, sweep: 35 },
      engines: [{ type: 'cowl', pos: [0, 0.05, -2.2], length: 1.5, radius: 0.5 }],
      props: [{ pos: [0, 0.05, -2.98], diameter: 1.93, blades: 2, dir: 1 }],
      gearFixed: true,
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'lj45',
    name: 'Lyra LJ-45',
    manufacturer: 'Lyra Aerospace',
    category: 'private',
    role: 'Light business jet',
    description:
      'A fast, elegant twin-engine business jet. Climbs like a rocket and cruises at Mach 0.8 above the weather — ideal for executive charters between regional airports.',
    unlock: { rank: 1, price: 25000 },
    cockpit: 'airliner',
    callsignPrefix: 'N',
    mass: { empty: 6200, maxTakeoff: 9750, maxFuel: 2700, maxPayload: 1100, reference: 8500, passengers: 8 },
    wing: { area: 29.0, span: 14.6, chord: 2.1 },
    aero: aero('jet', {
      CL0: 0.3, CLa: 5.0, alphaStall: 14, alphaStallNeg: -10, CD0: 0.022, e: 0.78,
      gearCD: 0.02, spoilerCL: -0.35, spoilerCD: 0.04, Mcrit: 0.79,
      Cla: 0.035, Clp: -0.45,
    }),
    inertia: [30000, 75000, 100000],
    flaps: FLAPS_BIZ,
    flapRate: 5,
    engine: {
      type: 'jet', maxThrust: 16500, idleN1: 0.22, spoolUp: 3.2, startTime: 18, tsfc: 1.95e-5,
      densityExp: 0.85, machLapse: -0.3,
      list: [{ pos: [-1.35, 0.35, 5.2] }, { pos: [1.35, 0.35, 5.2] }],
    },
    gear: {
      retractable: true,
      retractTime: 6,
      travel: 0.3,
      points: [
        { name: 'nose', pos: [0, -1.45, -6.0], steer: true, brake: false },
        { name: 'left', pos: [-1.3, -1.45, 0.6], steer: false, brake: true },
        { name: 'right', pos: [1.3, -1.45, 0.6], steer: false, brake: true },
      ],
    },
    fcs: { law: 'direct', maxPitchRate: 10, maxRollRate: 30, nzMax: 3.0, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: false },
    speeds: { vs: 98, vr: 120, v2: 128, vref: 128, vfe: 200, vmo: 330, mmo: 0.81, cruise: 450, cruiseAlt: 41000, ceiling: 51000 },
    rangeNm: 2000,
    eye: [-0.36, 0.38, -5.9],
    cabinEye: [0.45, 0.25, -1.6],
    model: {
      style: 'bizjet',
      fuselage: { noseZ: -8.3, tailZ: 9.6, radius: 0.82, noseLength: 3.2, tailLength: 5.9, tailUp: 0.45, centerY: 0 },
      wing: { mount: 'low', y: -0.55, rootLE: -1.3, rootChord: 2.9, tipChord: 1.0, span: 14.6, sweep: 15, dihedral: 3, thickness: 0.12, winglet: 'small' },
      htail: { tTail: true, y: 3.25, rootLE: 7.6, rootChord: 1.3, tipChord: 0.7, span: 4.6, sweep: 30, dihedral: 0 },
      vtail: { y: 0.7, rootLE: 6.4, rootChord: 2.8, tipChord: 1.4, height: 2.6, sweep: 40 },
      engines: [
        { type: 'pod', pos: [-1.38, 0.35, 5.2], length: 2.8, radius: 0.43 },
        { type: 'pod', pos: [1.38, 0.35, 5.2], length: 2.8, radius: 0.43 },
      ],
      paxWindows: { from: -4.0, to: 2.0, spacing: 0.9, y: 0.15, size: 0.32, oval: true },
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'rj900',
    name: 'Vireo RJ-900',
    manufacturer: 'Vireo Aircraft',
    category: 'commercial',
    role: 'Regional jet airliner',
    description:
      'A 90-seat regional workhorse with rear-mounted engines and a T-tail. Quick turnarounds, short sectors and challenging mountain airports are its home.',
    unlock: { rank: 2, price: 60000 },
    cockpit: 'airliner',
    callsignPrefix: 'COASTAL',
    mass: { empty: 21800, maxTakeoff: 38300, maxFuel: 7000, maxPayload: 10200, reference: 32000, passengers: 90 },
    wing: { area: 70.6, span: 24.9, chord: 3.1 },
    aero: aero('jet', {
      CL0: 0.25, CLa: 5.0, alphaStall: 13, alphaStallNeg: -10, CD0: 0.021, e: 0.78,
      gearCD: 0.018, spoilerCL: -0.4, spoilerCD: 0.045, Mcrit: 0.79, Cla: 0.035,
    }),
    inertia: [6.5e5, 1.6e6, 2.2e6],
    flaps: FLAPS_AIRLINER,
    flapRate: 3.5,
    engine: {
      type: 'jet', maxThrust: 64500, idleN1: 0.22, spoolUp: 4.0, startTime: 25, tsfc: 1.85e-5,
      densityExp: 0.85, machLapse: -0.33,
      list: [{ pos: [-2.4, 0.45, 9.5] }, { pos: [2.4, 0.45, 9.5] }],
    },
    gear: {
      retractable: true,
      retractTime: 7,
      travel: 0.35,
      points: [
        { name: 'nose', pos: [0, -2.45, -14.0], steer: true, brake: false },
        { name: 'left', pos: [-2.0, -2.45, 1.2], steer: false, brake: true },
        { name: 'right', pos: [2.0, -2.45, 1.2], steer: false, brake: true },
      ],
    },
    fcs: { law: 'direct', maxPitchRate: 6, maxRollRate: 18, nzMax: 2.5, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: true },
    speeds: { vs: 108, vr: 135, v2: 142, vref: 138, vfe: 230, vmo: 335, mmo: 0.85, cruise: 447, cruiseAlt: 36000, ceiling: 41000 },
    rangeNm: 1550,
    eye: [-0.5, 0.58, -14.25],
    cabinEye: [1.05, 0.3, -2.0],
    model: {
      style: 'airliner',
      fuselage: { noseZ: -16.5, tailZ: 19.7, radius: 1.35, noseLength: 4.2, tailLength: 12.0, tailUp: 0.8, centerY: 0 },
      wing: { mount: 'low', y: -0.8, rootLE: -2.0, rootChord: 4.8, tipChord: 1.3, span: 24.9, sweep: 28, dihedral: 3.5, thickness: 0.12, winglet: 'blended' },
      htail: { tTail: true, y: 5.45, rootLE: 16.0, rootChord: 2.3, tipChord: 1.1, span: 8.5, sweep: 32, dihedral: 0 },
      vtail: { y: 1.0, rootLE: 12.6, rootChord: 4.6, tipChord: 2.6, height: 4.5, sweep: 40 },
      engines: [
        { type: 'pod', pos: [-2.42, 0.45, 9.5], length: 3.6, radius: 0.7 },
        { type: 'pod', pos: [2.42, 0.45, 9.5], length: 3.6, radius: 0.7 },
      ],
      paxWindows: { from: -11.5, to: 7.0, spacing: 0.8, y: 0.25, size: 0.26 },
      doors: [-12.8, 6.6],
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'mj320',
    name: 'Meridian MJ-320',
    manufacturer: 'Meridian Aerospace',
    category: 'commercial',
    role: 'Narrow-body twinjet airliner',
    description:
      'The best-selling single-aisle airliner of Aurelia. Fly-by-wire controls with flight envelope protection, full autopilot with autothrust, ILS approaches and autoland.',
    unlock: { rank: 0, price: 0 },
    cockpit: 'airliner',
    callsignPrefix: 'AURELIA',
    mass: { empty: 44300, maxTakeoff: 79000, maxFuel: 18700, maxPayload: 20000, reference: 65000, passengers: 180 },
    wing: { area: 122.6, span: 35.8, chord: 4.29 },
    aero: aero('jet', {
      CL0: 0.25, CLa: 5.2, alphaStall: 13, alphaStallNeg: -10, CD0: 0.0195, e: 0.8,
      gearCD: 0.018, spoilerCL: -0.45, spoilerCD: 0.045, Mcrit: 0.79,
    }),
    inertia: [1.6e6, 3.6e6, 5.0e6],
    flaps: FLAPS_AIRLINER,
    flapRate: 3,
    engine: {
      type: 'jet', maxThrust: 120000, idleN1: 0.21, spoolUp: 4.5, startTime: 30, tsfc: 1.75e-5,
      densityExp: 0.85, machLapse: -0.35,
      list: [{ pos: [-5.75, -2.0, -6.2] }, { pos: [5.75, -2.0, -6.2] }],
    },
    gear: {
      retractable: true,
      retractTime: 8,
      travel: 0.4,
      points: [
        { name: 'nose', pos: [0, -3.6, -12.5], steer: true, brake: false },
        { name: 'left', pos: [-3.8, -3.6, 1.3], steer: false, brake: true },
        { name: 'right', pos: [3.8, -3.6, 1.3], steer: false, brake: true },
      ],
    },
    fcs: { law: 'fbw', maxPitchRate: 6, maxRollRate: 15, nzMax: 2.5, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: true },
    speeds: { vs: 112, vr: 145, v2: 152, vref: 138, vfe: 230, vmo: 350, mmo: 0.82, cruise: 450, cruiseAlt: 36000, ceiling: 39800 },
    rangeNm: 3400,
    eye: [-0.55, 0.78, -15.4],
    cabinEye: [1.45, 0.45, -1.2],
    model: {
      style: 'airliner',
      fuselage: { noseZ: -17.0, tailZ: 20.6, radius: 1.98, noseLength: 5.0, tailLength: 11.3, tailUp: 1.25, centerY: 0 },
      wing: { mount: 'low', y: -1.05, rootLE: -4.0, rootChord: 6.1, tipChord: 1.5, span: 34.1, sweep: 27, dihedral: 5, thickness: 0.12, winglet: 'sharklet' },
      htail: { y: 0.45, rootLE: 14.6, rootChord: 3.4, tipChord: 1.2, span: 12.45, sweep: 30, dihedral: 6 },
      vtail: { y: 1.7, rootLE: 11.6, rootChord: 5.5, tipChord: 1.9, height: 5.9, sweep: 37 },
      engines: [
        { type: 'turbofan', pos: [-5.75, -2.0, -6.2], length: 4.4, radius: 1.05 },
        { type: 'turbofan', pos: [5.75, -2.0, -6.2], length: 4.4, radius: 1.05 },
      ],
      paxWindows: { from: -12.0, to: 10.5, spacing: 0.53, y: 0.4, size: 0.23 },
      doors: [-13.6, 11.6],
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'mw350',
    name: 'Meridian MW-350',
    manufacturer: 'Meridian Aerospace',
    category: 'commercial',
    role: 'Long-haul wide-body twinjet',
    description:
      'A carbon-composite long-haul flagship carrying 320 passengers over 8,000 nautical miles. Fly-by-wire, autoland and an ultra-efficient wing for intercontinental flights.',
    unlock: { rank: 4, price: 200000 },
    cockpit: 'airliner',
    callsignPrefix: 'AURELIA',
    mass: { empty: 142000, maxTakeoff: 280000, maxFuel: 110000, maxPayload: 53000, reference: 220000, passengers: 320 },
    wing: { area: 443, span: 64.75, chord: 8.0 },
    aero: aero('heavy', {
      CL0: 0.26, CLa: 5.4, alphaStall: 12.5, alphaStallNeg: -10, CD0: 0.017, e: 0.82,
      gearCD: 0.016, spoilerCL: -0.45, spoilerCD: 0.04, Mcrit: 0.85,
    }),
    inertia: [2.4e7, 3.2e7, 5.4e7],
    flaps: FLAPS_AIRLINER,
    flapRate: 2.5,
    engine: {
      type: 'jet', maxThrust: 380000, idleN1: 0.2, spoolUp: 5.5, startTime: 40, tsfc: 1.6e-5,
      densityExp: 0.85, machLapse: -0.35,
      list: [{ pos: [-10.0, -2.7, -11.5] }, { pos: [10.0, -2.7, -11.5] }],
    },
    gear: {
      retractable: true,
      retractTime: 10,
      travel: 0.5,
      points: [
        { name: 'nose', pos: [0, -5.3, -25.5], steer: true, brake: false },
        { name: 'left', pos: [-5.4, -5.3, 2.5], steer: false, brake: true },
        { name: 'right', pos: [5.4, -5.3, 2.5], steer: false, brake: true },
      ],
    },
    fcs: { law: 'fbw', maxPitchRate: 5, maxRollRate: 12, nzMax: 2.5, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: true },
    speeds: { vs: 118, vr: 152, v2: 160, vref: 145, vfe: 240, vmo: 340, mmo: 0.89, cruise: 488, cruiseAlt: 39000, ceiling: 43100 },
    rangeNm: 8100,
    eye: [-0.62, 1.25, -26.8],
    cabinEye: [2.45, 0.9, -4.0],
    model: {
      style: 'airliner',
      fuselage: { noseZ: -30.0, tailZ: 36.8, radius: 3.0, noseLength: 7.2, tailLength: 21.5, tailUp: 2.0, centerY: 0 },
      wing: { mount: 'low', y: -1.65, rootLE: -8.0, rootChord: 11.5, tipChord: 2.3, span: 64.75, sweep: 33, dihedral: 6, thickness: 0.11, winglet: 'curved' },
      htail: { y: 0.8, rootLE: 28.0, rootChord: 6.5, tipChord: 2.0, span: 18.8, sweep: 35, dihedral: 6 },
      vtail: { y: 2.6, rootLE: 22.0, rootChord: 10.0, tipChord: 3.5, height: 9.5, sweep: 40 },
      engines: [
        { type: 'turbofan', pos: [-10.0, -2.7, -11.5], length: 7.0, radius: 1.65, chevrons: true },
        { type: 'turbofan', pos: [10.0, -2.7, -11.5], length: 7.0, radius: 1.65, chevrons: true },
      ],
      paxWindows: { from: -23.0, to: 22.0, spacing: 0.62, y: 0.8, size: 0.3 },
      doors: [-25.0, -12.5, 6.0, 21.0],
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'fx16',
    name: 'Talon FX-16',
    manufacturer: 'Talon Defense',
    category: 'fighter',
    role: 'Lightweight multirole fighter',
    description:
      'A nimble single-engine fighter with a bubble canopy and a fly-by-wire system pulling up to 9 g. Afterburner, supersonic speed and a full HUD.',
    unlock: { rank: 0, price: 0 },
    cockpit: 'fighter',
    callsignPrefix: 'VIPER',
    mass: { empty: 8570, maxTakeoff: 19200, maxFuel: 3200, maxPayload: 0, reference: 11500, passengers: 0 },
    wing: { area: 27.87, span: 9.45, chord: 3.45 },
    aero: aero('fighter', {
      CL0: 0.06, CLa: 3.7, alphaStall: 28, alphaStallNeg: -18, CD0: 0.019, e: 0.85,
      gearCD: 0.03, spoilerCL: -0.05, spoilerCD: 0.07, Mcrit: 0.9, supersonic: true, waveDrag: 0.034,
    }),
    inertia: [12875, 75674, 85552],
    flaps: FLAPS_FIGHTER,
    flapRate: 20,
    engine: {
      type: 'jet', maxThrust: 79000, abThrust: 48000, idleN1: 0.25, spoolUp: 2.0, startTime: 15, tsfc: 2.2e-5, abTsfc: 5.5e-5,
      densityExp: 0.72, machLapse: 0.38,
      list: [{ pos: [0, 0, 6.2] }],
    },
    gear: {
      retractable: true,
      retractTime: 4,
      travel: 0.25,
      points: [
        { name: 'nose', pos: [0, -1.65, -4.5], steer: true, brake: false },
        { name: 'left', pos: [-1.18, -1.65, 0.6], steer: false, brake: true },
        { name: 'right', pos: [1.18, -1.65, 0.6], steer: false, brake: true },
      ],
    },
    fcs: { law: 'fighter', maxPitchRate: 26, maxRollRate: 240, nzMax: 9, nzMin: -3, alphaLimit: 25, bankLimit: 180, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: false },
    speeds: { vs: 125, vr: 150, vref: 150, vfe: 300, vmo: 800, mmo: 2.0, cruise: 480, cruiseAlt: 30000, ceiling: 50000 },
    rangeNm: 2000,
    eye: [0, 0.78, -5.3],
    cabinEye: [0, 0.85, -4.4],
    model: {
      style: 'fighter',
      fuselage: { noseZ: -8.5, tailZ: 6.5, radius: 0.66, noseLength: 4.0, tailLength: 1.5, centerY: 0 },
      wing: { mount: 'mid', y: -0.12, rootLE: -1.6, rootChord: 4.6, tipChord: 1.05, span: 9.45, sweep: 40, dihedral: 0, thickness: 0.05, lex: { fromZ: -5.6 }, tipRails: true },
      htail: { y: -0.12, rootLE: 3.7, rootChord: 2.35, tipChord: 0.85, span: 5.6, sweep: 40, dihedral: -10, allMoving: true },
      vtail: { y: 0.55, rootLE: 2.1, rootChord: 3.6, tipChord: 1.15, height: 2.9, sweep: 47 },
      engines: [{ type: 'internal', pos: [0, 0, 6.2], radius: 0.55, intake: { z: -3.6, y: -0.72, width: 0.95, height: 0.62 } }],
      canopy: { fromZ: -6.4, toZ: -3.0, y: 0.5, height: 0.6, width: 0.82 },
      ventralFins: true,
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'ef2',
    name: 'Tempest EF-2',
    manufacturer: 'Tempest Consortium',
    category: 'fighter',
    role: 'Twin-engine canard-delta air superiority fighter',
    description:
      'An agile canard-delta fighter with twin engines, supercruise capability and blistering acceleration. The fastest aircraft in the Aurelian inventory.',
    unlock: { rank: 3, price: 120000 },
    cockpit: 'fighter',
    callsignPrefix: 'TEMPEST',
    mass: { empty: 11000, maxTakeoff: 23500, maxFuel: 4500, maxPayload: 0, reference: 15500, passengers: 0 },
    wing: { area: 51.2, span: 10.95, chord: 4.6 },
    aero: aero('fighter', {
      CL0: 0.05, CLa: 3.5, alphaStall: 30, alphaStallNeg: -18, CD0: 0.018, e: 0.8,
      gearCD: 0.03, spoilerCL: -0.05, spoilerCD: 0.08, Mcrit: 0.92, supersonic: true, waveDrag: 0.026,
      Cla: 0.04,
    }),
    inertia: [22000, 160000, 175000],
    flaps: FLAPS_FIGHTER,
    flapRate: 20,
    engine: {
      type: 'jet', maxThrust: 60000, abThrust: 30000, idleN1: 0.25, spoolUp: 1.8, startTime: 15, tsfc: 2.1e-5, abTsfc: 5.2e-5,
      densityExp: 0.7, machLapse: 0.42,
      list: [{ pos: [-0.55, 0, 6.6] }, { pos: [0.55, 0, 6.6] }],
    },
    gear: {
      retractable: true,
      retractTime: 4,
      travel: 0.28,
      points: [
        { name: 'nose', pos: [0, -1.6, -5.0], steer: true, brake: false },
        { name: 'left', pos: [-1.6, -1.6, 0.8], steer: false, brake: true },
        { name: 'right', pos: [1.6, -1.6, 0.8], steer: false, brake: true },
      ],
    },
    fcs: { law: 'fighter', maxPitchRate: 28, maxRollRate: 250, nzMax: 9, nzMin: -3, alphaLimit: 26, bankLimit: 180, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: false },
    speeds: { vs: 120, vr: 145, vref: 145, vfe: 300, vmo: 800, mmo: 2.0, cruise: 520, cruiseAlt: 35000, ceiling: 55000 },
    rangeNm: 1800,
    eye: [0, 0.9, -6.1],
    cabinEye: [0, 0.95, -5.2],
    model: {
      style: 'fighter',
      fuselage: { noseZ: -9.0, tailZ: 7.0, radius: 0.72, noseLength: 4.5, tailLength: 1.2, centerY: 0 },
      wing: { mount: 'mid', y: -0.2, rootLE: -2.6, rootChord: 8.0, tipChord: 1.0, span: 10.95, sweep: 53, dihedral: -2, thickness: 0.045, delta: true },
      canard: { y: 0.05, rootLE: -6.2, rootChord: 1.6, tipChord: 0.55, span: 4.4, sweep: 50 },
      vtail: { y: 0.65, rootLE: 1.5, rootChord: 4.6, tipChord: 1.2, height: 3.0, sweep: 50 },
      engines: [
        { type: 'internal', pos: [-0.55, -0.05, 6.6], radius: 0.47, intake: { z: -3.8, y: -0.85, width: 1.4, height: 0.68 } },
        { type: 'internal', pos: [0.55, -0.05, 6.6], radius: 0.47 },
      ],
      canopy: { fromZ: -7.2, toZ: -4.2, y: 0.55, height: 0.6, width: 0.85 },
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 't74f',
    name: 'Titan T-74F',
    manufacturer: 'Titan Heavy Industries',
    category: 'cargo',
    role: 'Heavy four-engine freighter',
    description:
      'The queen of freighters: four engines, a hinged nose cargo door and 134 tonnes of payload. Long take-off rolls and heavy, deliberate handling.',
    unlock: { rank: 4, price: 220000 },
    cockpit: 'airliner',
    callsignPrefix: 'SKYCARGO',
    mass: { empty: 197000, maxTakeoff: 447000, maxFuel: 150000, maxPayload: 134000, reference: 360000, passengers: 0 },
    wing: { area: 554, span: 68.4, chord: 8.3 },
    aero: aero('heavy', {
      CL0: 0.26, CLa: 5.3, alphaStall: 12.5, alphaStallNeg: -10, CD0: 0.018, e: 0.8,
      gearCD: 0.016, spoilerCL: -0.45, spoilerCD: 0.04, Mcrit: 0.86,
    }),
    inertia: [4.5e7, 6.5e7, 1.05e8],
    flaps: FLAPS_AIRLINER,
    flapRate: 2.2,
    engine: {
      type: 'jet', maxThrust: 296000, idleN1: 0.2, spoolUp: 6, startTime: 45, tsfc: 1.62e-5,
      densityExp: 0.85, machLapse: -0.35,
      list: [{ pos: [-21.0, -2.0, -7.0] }, { pos: [-12.0, -2.9, -14.0] }, { pos: [12.0, -2.9, -14.0] }, { pos: [21.0, -2.0, -7.0] }],
    },
    gear: {
      retractable: true,
      retractTime: 11,
      travel: 0.55,
      points: [
        { name: 'nose', pos: [0, -5.6, -29.0], steer: true, brake: false },
        { name: 'left', pos: [-5.6, -5.6, 2.5], steer: false, brake: true },
        { name: 'right', pos: [5.6, -5.6, 2.5], steer: false, brake: true },
      ],
    },
    fcs: { law: 'direct', maxPitchRate: 4.5, maxRollRate: 10, nzMax: 2.5, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: true },
    speeds: { vs: 125, vr: 165, v2: 172, vref: 152, vfe: 250, vmo: 365, mmo: 0.9, cruise: 490, cruiseAlt: 35000, ceiling: 43100 },
    rangeNm: 4400,
    eye: [-0.62, 3.75, -29.5],
    cabinEye: [0.0, 3.6, -25.0],
    model: {
      style: 'airliner',
      fuselage: { noseZ: -34.0, tailZ: 42.3, radius: 3.25, noseLength: 7.5, tailLength: 26.0, tailUp: 2.3, centerY: 0, hump: { fromZ: -31.5, toZ: -14.0, height: 2.35 } },
      wing: { mount: 'low', y: -1.5, rootLE: -9.0, rootChord: 14.5, tipChord: 3.4, span: 68.4, sweep: 39, dihedral: 7, thickness: 0.1, winglet: 'raked' },
      htail: { y: 0.8, rootLE: 33.0, rootChord: 8.0, tipChord: 2.5, span: 22.2, sweep: 37, dihedral: 7 },
      vtail: { y: 2.8, rootLE: 27.0, rootChord: 11.5, tipChord: 4.0, height: 10.5, sweep: 45 },
      engines: [
        { type: 'turbofan', pos: [-21.0, -2.0, -7.0], length: 6.2, radius: 1.55, chevrons: true },
        { type: 'turbofan', pos: [-12.0, -2.9, -14.0], length: 6.2, radius: 1.55, chevrons: true },
        { type: 'turbofan', pos: [12.0, -2.9, -14.0], length: 6.2, radius: 1.55, chevrons: true },
        { type: 'turbofan', pos: [21.0, -2.0, -7.0], length: 6.2, radius: 1.55, chevrons: true },
      ],
      paxWindows: null,
      upperWindows: { from: -29.0, to: -16.0, spacing: 0.7, size: 0.3 },
      doors: [-27.0],
      freighter: true,
    },
  },
  // -------------------------------------------------------------------------
  {
    id: 'ct130',
    name: 'Mule CT-130',
    manufacturer: 'Mule Aircraft Co.',
    category: 'cargo',
    role: 'Tactical four-turboprop transport',
    description:
      'Rugged high-wing transport with four six-bladed turboprops and a rear loading ramp. Short rough-field performance makes it ideal for rescue and relief missions.',
    unlock: { rank: 0, price: 0 },
    cockpit: 'airliner',
    callsignPrefix: 'RESCUE',
    mass: { empty: 34300, maxTakeoff: 70300, maxFuel: 20000, maxPayload: 19000, reference: 55000, passengers: 0 },
    wing: { area: 162.1, span: 40.4, chord: 4.16 },
    aero: aero('jet', {
      CL0: 0.35, CLa: 5.2, alphaStall: 15, alphaStallNeg: -11, CD0: 0.025, e: 0.8,
      gearCD: 0.012, spoilerCL: 0, spoilerCD: 0, Mcrit: 0.62,
      Cnb: 0.12,
    }),
    inertia: [1.0e6, 1.3e6, 2.1e6],
    flaps: FLAPS_CARGO_PROP,
    flapRate: 3,
    engine: {
      type: 'turboprop', maxPower: 3460000, maxRPM: 1020, idleRPM: 720, propDiameter: 4.11, blades: 6,
      efficiency: 0.82, vKnee: 50, bsfc: 0.3, spoolUp: 2.5, startTime: 30,
      list: [{ pos: [-10.0, 1.4, -5.8] }, { pos: [-5.2, 1.4, -5.8] }, { pos: [5.2, 1.4, -5.8] }, { pos: [10.0, 1.4, -5.8] }],
    },
    gear: {
      retractable: true,
      retractTime: 9,
      travel: 0.35,
      points: [
        { name: 'nose', pos: [0, -2.75, -10.5], steer: true, brake: false },
        { name: 'left', pos: [-2.2, -2.75, 0.3], steer: false, brake: true },
        { name: 'right', pos: [2.2, -2.75, 0.3], steer: false, brake: true },
      ],
    },
    fcs: { law: 'direct', maxPitchRate: 7, maxRollRate: 18, nzMax: 3.0, nzMin: -1.0, bankLimit: 67, yawDamper: true },
    autopilot: { athr: true, app: true, autoland: false },
    speeds: { vs: 90, vr: 105, v2: 115, vref: 120, vfe: 180, vmo: 300, mmo: 0.6, cruise: 320, cruiseAlt: 26000, ceiling: 33000 },
    rangeNm: 2800,
    eye: [-0.58, 0.98, -11.6],
    cabinEye: [1.2, 0.6, -4.5],
    model: {
      style: 'cargo',
      fuselage: { noseZ: -13.5, tailZ: 16.3, radius: 2.15, noseLength: 3.6, tailLength: 12.5, tailUp: 2.0, centerY: 0, flatBottom: true },
      wing: { mount: 'high', y: 1.95, rootLE: -2.2, rootChord: 4.9, tipChord: 2.7, span: 40.4, sweep: 3, dihedral: 2.5, thickness: 0.15 },
      htail: { y: 1.6, rootLE: 12.2, rootChord: 3.8, tipChord: 2.0, span: 16.0, sweep: 10, dihedral: 0 },
      vtail: { y: 2.0, rootLE: 10.2, rootChord: 6.0, tipChord: 2.6, height: 6.5, sweep: 25 },
      engines: [
        { type: 'turboprop', pos: [-10.0, 1.45, -3.4], length: 5.4, radius: 0.62 },
        { type: 'turboprop', pos: [-5.2, 1.45, -3.4], length: 5.4, radius: 0.62 },
        { type: 'turboprop', pos: [5.2, 1.45, -3.4], length: 5.4, radius: 0.62 },
        { type: 'turboprop', pos: [10.0, 1.45, -3.4], length: 5.4, radius: 0.62 },
      ],
      props: [
        { pos: [-10.0, 1.4, -5.95], diameter: 4.11, blades: 6, dir: 1 },
        { pos: [-5.2, 1.4, -5.95], diameter: 4.11, blades: 6, dir: 1 },
        { pos: [5.2, 1.4, -5.95], diameter: 4.11, blades: 6, dir: 1 },
        { pos: [10.0, 1.4, -5.95], diameter: 4.11, blades: 6, dir: 1 },
      ],
      paxWindows: { from: -7.0, to: 2.0, spacing: 1.6, y: 0.5, size: 0.28 },
      sponsons: true,
      doors: [-9.2],
    },
  },
];

export const CATEGORY_NAMES = {
  commercial: 'Commercial Airliners',
  fighter: 'Fighter Jets',
  private: 'Private Aircraft',
  cargo: 'Cargo Aircraft',
};

export function getAircraft(id) {
  return AIRCRAFT.find((a) => a.id === id) || AIRCRAFT[0];
}

// Structural contact points used for crash detection (not landing gear).
export function structuralContacts(spec) {
  const m = spec.model;
  const f = m.fuselage;
  const w = m.wing;
  const r = f.radius || Math.max(f.width || 1, f.height || 1) / 2;
  const half = w.span / 2;
  const dih = Math.tan(((w.dihedral || 0) * Math.PI) / 180);
  const tipLE = w.rootLE + Math.tan(((w.sweep || 0) * Math.PI) / 180) * half;
  const pts = [
    { name: 'nose', type: 'nose', pos: [0, f.centerY - r * 0.55, f.noseZ + 0.4] },
    { name: 'belly', type: 'belly', pos: [0, f.centerY - r * 0.98, 0] },
    { name: 'tail', type: 'tail', pos: [0, f.centerY - r * 0.97, f.tailZ - (f.tailLength || 2)] },
    { name: 'tailTip', type: 'tail', pos: [0, f.centerY + (f.tailUp || 0) - r * 0.15, f.tailZ] },
    { name: 'leftWingtip', type: 'wingtip', pos: [-half, w.y + dih * half, tipLE + w.tipChord * 0.5] },
    { name: 'rightWingtip', type: 'wingtip', pos: [half, w.y + dih * half, tipLE + w.tipChord * 0.5] },
  ];
  for (const e of m.engines || []) {
    if (e.type === 'turbofan' || e.type === 'turboprop')
      pts.push({ name: 'engine', type: 'engine', pos: [e.pos[0], e.pos[1] - e.radius, e.pos[2]] });
  }
  for (const p of m.props || []) {
    pts.push({ name: 'propeller', type: 'engine', pos: [p.pos[0], p.pos[1] - p.diameter / 2, p.pos[2]] });
  }
  return pts;
}
