# WORLD DOMINATION

A real-time grand strategy game for the browser. You lead one nation in 2027 and try to bring every country on Earth under your control, either by ruling it directly or through puppet states that answer to you. Pause whenever you like.

## Running it

```bash
npm install
npm run dev:wd        # opens http://localhost:5173/world-domination/
```

`npm run build` puts it at `dist/world-domination/`. On GitHub Pages it's served at `https://<user>.github.io/<repo>/world-domination/`.

## The world

- **203 territories** with real Natural Earth borders, including all 194 sovereign states plus Taiwan, Palestine and Kosovo. Greenland, Puerto Rico, Hong Kong, Western Sahara, New Caledonia, French Polynesia and the Falklands are separate territories owned by their sovereign. Smaller dependencies are folded into their sovereign's territory. Tuvalu is the only UN member missing, because it's too small for the 1:50m map.
- **Every country** starts with its population, GDP, government type, active military, navy, air force, nuclear arsenal and resources (oil, gas, gold, uranium, rare minerals, iron, food), all approximating mid-2020s figures. The data is in `src/data/stats.js`.
- **Real blocs and rivalries** in Realistic mode: NATO, EU, CSTO, GCC, ASEAN, Mercosur, the Shanghai Pact, the Sahel Alliance, bilateral defense pacts, guarantees, trade deals and historical grudges.
- **Fictional leaders** are generated every game, with culturally appropriate names and 2–3 personality traits (Warmonger, Diplomat, Honorable, Treacherous, Paranoid, Scholar and more). The traits drive how the AI behaves.
- **Every playthrough differs:** the seed controls leaders, events and the course of history. *Shuffled* mode randomizes regimes, economies, armies and alliances. *World on Fire* makes leaders hyper-aggressive.

## Systems

| Area | What you can do |
| --- | --- |
| Economy | Taxes, defense, research, infrastructure and welfare budgets; national debt with interest that rises with your debt ratio and credit ratings; resource production, needs and world market prices; a global business cycle |
| Construction | Infrastructure, factories, research labs, fortifications, military bases and mines in each territory |
| Military | Army, navy, air force, missiles and nuclear warheads; a procurement mix that spends any defense budget beyond upkeep on new units; three mobilization laws; readiness, manpower and unit quality from technology |
| War | Land and amphibious offensives with live battle odds, garrisons, militia, fortifications and air superiority; naval blockades; missile strikes; nuclear strikes that trigger retaliation and nuclear winter; war score, capitulation, peace conferences (annex, puppet, reparations), calls to arms and separate peace deals |
| Diplomacy | Trade agreements, non-aggression pacts, defense pacts, research pacts, guarantees and blocs you can found, join or leave; improving relations, aid, investment, cultural exchange, denunciations, embargoes and ultimatums; protectorates. Every proposal shows its acceptance score and the reasons behind it |
| Influence | A sphere of influence in every nation, which great powers compete over; enough influence lets you absorb a nation peacefully |
| Espionage | Spy networks, propaganda, stealing technology, sabotage, funding the opposition, fabricating claims, cyber attacks, election interference, inciting revolutions and staging coups. Exposed operations cause diplomatic incidents |
| Empire | Integrating conquered land, unrest and separatist rebellions, governors with traits, releasing territories as client states, managing puppets (tribute, leader, government type, liberty desire, annexation) and wars of independence |
| Research | 48 technologies in 8 branches (economy, industry, land, naval, air, strategic weapons, intelligence, society). A tech gets cheaper as more nations know it |
| Politics | Stability, approval, war exhaustion, political capital, elections (lose them, or annul them), revolutions, coups, government reform, debt crises |

## The AI

Each AI nation reviews its situation once a month:

- It sets taxes and spending to balance its budget, arms up when threatened, and picks research that fits its leader's personality.
- It proposes treaties to the nations it likes, cancels them with nations it has come to hate, and competes for spheres of influence.
- It goes to war when it is strong enough to win against the target and the target's likely allies, when it has a claim or a grudge, and when its leader's personality wants war. Nuclear deterrence holds most leaders back.
- It answers or ignores calls to arms depending on honor, opinion and its odds.
- It makes peace when it is winning, exhausted or losing.

Nations remember what other nations did to them: broken treaties, abandoned allies, exposed spies and nuclear strikes. They trust the culprit less for years afterwards.

Conquest builds **infamy**. Once a nation's infamy is high enough, nearby countries that fear it form a **coalition**, which declares war when it thinks it can win. This applies to AI empires as well as to you, so the world tends to balance itself. Subject nations rebel when their overlord is weak.

## Interface

- An interactive map with pan, zoom and pinch. It has 10 map modes: political, relations, alliances, spheres, wealth, military, stability, government, resources and unrest. Occupied land is striped, borders redraw as empires change, and offensives are shown as animated arrows with progress rings.
- A management panel for each system, plus a country panel showing a nation's leader, its opinion of you broken down by cause, what it remembers about you, and actions in four tabs: diplomacy, espionage, war and management.
- A live news ticker, a news archive, toasts for important events, and decision events that pause the game until you choose.
- Statistics: your history charted over time, the rise and fall of the great powers, a global power ranking and a local Hall of Fame.
- Three save slots, a yearly autosave, and export or import of saves as files.
- Keyboard shortcuts: `Space` pauses, `1`–`5` set the speed, `Q`–`P` switch map modes, panel letters open panels (shown in the button tooltips), `H` jumps home and `Esc` closes things.

## Code layout

```
src/data/       static data: territory metadata (generated), country stats, people & traits, tech tree
src/engine/     the simulation; it has no DOM code, so it runs in Node for tests and balancing
  setup.js      new-game generation          economy.js   budgets, growth, resources, research
  military.js   power, wars, combat, peace   diplomacy.js proposals, influence, blocs, coalitions
  intel.js      espionage & revolutions      ai.js        AI decision-making
  events.js     random & decision events     sim.js       the clock, history, victory
  actions.js    every player command          save.js      save slots / files
src/ui/         canvas map, panels, dialogs, menus
```

Tools:

- `npm run wd:meta` regenerates `src/data/meta.json` (territory list, adjacency, centroids) from `world-atlas` and `world-countries`.
- `npx vite-node tools/wdSimReport.mjs <years> <ISO3> <seed> [mode]` runs a headless simulation for balancing.
- `node tools/wdE2E.mjs <url> <outDir>` and `node tools/wdWarE2E.mjs <url> <outDir>` are browser smoke tests that also save screenshots.
