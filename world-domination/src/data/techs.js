// Technology tree. Each branch has six tiers; tier N requires tier N-1 of the same branch
// (and sometimes a tech from another branch). Effects are additive modifiers.

export const BRANCHES = {
  economy: { name: 'Economy', icon: '💹', color: '#e3b341' },
  industry: { name: 'Industry', icon: '🏭', color: '#d9822b' },
  land: { name: 'Land Warfare', icon: '🪖', color: '#7a9a3a' },
  naval: { name: 'Naval Warfare', icon: '⚓', color: '#3b7dd8' },
  air: { name: 'Air Power', icon: '✈️', color: '#5bc0de' },
  strategic: { name: 'Strategic Weapons', icon: '☢️', color: '#e5534b' },
  intel: { name: 'Intelligence & Cyber', icon: '🛰️', color: '#a371f7' },
  society: { name: 'Society', icon: '🏛️', color: '#3fb950' },
};

const T = (id, branch, tier, name, desc, effects, req = []) => ({ id, branch, tier, name, desc, effects, req });

export const TECHS = [
  T('eco1', 'economy', 1, 'Modern Banking', '+0.3% GDP growth, +5% tax efficiency', { growth: 0.003, taxEff: 0.05 }),
  T('eco2', 'economy', 2, 'Digital Economy', '+0.4% GDP growth', { growth: 0.004 }),
  T('eco3', 'economy', 3, 'Global Finance Hub', '+10% trade income, -1% interest on debt', { trade: 0.1, interest: -0.01 }),
  T('eco4', 'economy', 4, 'Algorithmic Markets', '+0.5% GDP growth, +5% tax efficiency', { growth: 0.005, taxEff: 0.05 }),
  T('eco5', 'economy', 5, 'AI-Managed Economy', '+0.7% GDP growth, +10% research', { growth: 0.007, research: 0.1 }),
  T('eco6', 'economy', 6, 'Post-Scarcity Economics', '+1% GDP growth, +10 stability', { growth: 0.01, stability: 10 }, ['ind6']),

  T('ind1', 'industry', 1, 'Industrial Modernization', '-10% construction cost', { buildCost: -0.1 }),
  T('ind2', 'industry', 2, 'Advanced Manufacturing', '+15% resource output, +0.2% growth', { resOut: 0.15, growth: 0.002 }),
  T('ind3', 'industry', 3, 'Industrial Robotics', '-15% unit cost, -10% construction cost', { unitCost: -0.15, buildCost: -0.1 }),
  T('ind4', 'industry', 4, 'Additive Fabrication', '-10% unit upkeep, +0.3% growth', { upkeep: -0.1, growth: 0.003 }),
  T('ind5', 'industry', 5, 'Nanomaterials', '+25% resource output, -10% unit cost', { resOut: 0.25, unitCost: -0.1 }),
  T('ind6', 'industry', 6, 'Fusion Power', '+0.8% GDP growth, oil no longer needed by the military', { growth: 0.008, noOil: 1 }),

  T('lan1', 'land', 1, 'Modern Infantry', '+12% army quality', { land: 0.12 }),
  T('lan2', 'land', 2, 'Main Battle Tanks', '+15% army quality', { land: 0.15 }),
  T('lan3', 'land', 3, 'Network-Centric Warfare', '+18% army quality, +10% supply', { land: 0.18, supply: 0.1 }),
  T('lan4', 'land', 4, 'Powered Exoskeletons', '+20% army quality', { land: 0.2 }),
  T('lan5', 'land', 5, 'Autonomous Ground Units', '+25% army quality, -15% manpower use', { land: 0.25, manpower: -0.15 }),
  T('lan6', 'land', 6, 'Robotic Legions', '+35% army quality, -30% manpower use', { land: 0.35, manpower: -0.3 }, ['ind5']),

  T('nav1', 'naval', 1, 'Missile Frigates', '+12% navy quality', { naval: 0.12 }),
  T('nav2', 'naval', 2, 'Fleet Carriers', '+18% navy quality, +20% naval range', { naval: 0.18, range: 0.2 }),
  T('nav3', 'naval', 3, 'Nuclear Submarines', '+20% navy quality', { naval: 0.2 }),
  T('nav4', 'naval', 4, 'Stealth Destroyers', '+20% navy quality, +20% naval range', { naval: 0.2, range: 0.2 }),
  T('nav5', 'naval', 5, 'Railgun Battle Groups', '+25% navy quality', { naval: 0.25 }),
  T('nav6', 'naval', 6, 'Autonomous Drone Fleets', '+35% navy quality, +30% naval range', { naval: 0.35, range: 0.3 }),

  T('air1', 'air', 1, '4th-Generation Fighters', '+12% air quality', { air: 0.12 }),
  T('air2', 'air', 2, 'Precision-Guided Munitions', '+18% air quality', { air: 0.18 }),
  T('air3', 'air', 3, 'Stealth Aircraft', '+20% air quality', { air: 0.2 }),
  T('air4', 'air', 4, 'Drone Swarms', '+22% air quality, -10% upkeep', { air: 0.22, upkeep: -0.05 }),
  T('air5', 'air', 5, '6th-Generation Fighters', '+25% air quality', { air: 0.25 }),
  T('air6', 'air', 6, 'Hypersonic Bombers', '+35% air quality', { air: 0.35 }),

  T('str1', 'strategic', 1, 'Ballistic Missiles', 'Unlocks missile strikes', { missiles: 1 }),
  T('str2', 'strategic', 2, 'Nuclear Weapons', 'Unlocks nuclear warheads (needs uranium)', { nukes: 1 }, ['ind2']),
  T('str3', 'strategic', 3, 'ICBMs', 'Nuclear strikes reach anywhere, +20% missile damage', { icbm: 1, missileDmg: 0.2 }),
  T('str4', 'strategic', 4, 'Missile Defense Shield', 'Intercepts 30% of incoming missiles & nukes', { abm: 0.3 }),
  T('str5', 'strategic', 5, 'Hypersonic Missiles', '+40% missile damage, ignores 50% of enemy shields', { missileDmg: 0.4, pierce: 0.5 }),
  T('str6', 'strategic', 6, 'Orbital Defense Network', 'Intercepts another 35% of missiles & nukes', { abm: 0.35 }, ['int5']),

  T('int1', 'intel', 1, 'Signals Intelligence', '+15% espionage, +10% counter-intelligence', { spy: 0.15, counter: 0.1 }),
  T('int2', 'intel', 2, 'Cyber Warfare', '+20% espionage, unlocks cyber attacks', { spy: 0.2, cyber: 1 }),
  T('int3', 'intel', 3, 'Spy Satellites', '+15% espionage, +10% to all military quality', { spy: 0.15, allMil: 0.1 }),
  T('int4', 'intel', 4, 'Quantum Encryption', '+30% counter-intelligence', { counter: 0.3 }),
  T('int5', 'intel', 5, 'AI Intelligence Analysis', '+30% espionage, +10% research', { spy: 0.3, research: 0.1 }),
  T('int6', 'intel', 6, 'Total Information Awareness', '+40% espionage, +40% counter-intelligence, +5 stability', { spy: 0.4, counter: 0.4, stability: 5 }),

  T('soc1', 'society', 1, 'Universal Education', '+10% research, +0.1% growth', { research: 0.1, growth: 0.001 }),
  T('soc2', 'society', 2, 'Modern Healthcare', '+5 stability, +0.2% population growth', { stability: 5, popGrowth: 0.002 }),
  T('soc3', 'society', 3, 'Mass Media Mastery', '+1 political capital per month, +10% influence', { pc: 1, influence: 0.1 }),
  T('soc4', 'society', 4, 'Smart Cities', '+0.3% growth, faster integration of conquered land', { growth: 0.003, integration: 0.5 }),
  T('soc5', 'society', 5, 'Cultural Hegemony', '+25% influence gain, -20% unrest', { influence: 0.25, unrest: -0.2 }),
  T('soc6', 'society', 6, 'Global Citizenship', '+2 political capital, conquered land integrates twice as fast', { pc: 2, integration: 1 }),
];

export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

// Research points needed for a tier (tier 6 ~ 7x tier 1)
export function techCost(tech) {
  return Math.round(60 * Math.pow(1.48, tech.tier - 1));
}
