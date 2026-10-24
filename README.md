# Skyward Flight Simulator

A 3D flight simulator that runs in the browser. Fly airliners, fighter jets, private aircraft and cargo planes over **Aurelia**, a procedurally generated island continent with mountains, forests, lakes, coastline, cities and nine detailed airports. Everything — terrain, aircraft models, liveries, cockpit instruments, sounds and radio voices — is generated in code; there are no binary assets.

Built with [three.js](https://threejs.org) and [Vite](https://vitejs.dev). The multiplayer relay server is a small Node.js/WebSocket app.

## Quick start

Requirements: Node.js 18+ and a desktop browser with WebGL 2 (Chrome, Edge, Firefox or Safari 15+). A dedicated GPU is recommended for the High/Ultra presets.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build + multiplayer server on one port:

```bash
npm start            # builds dist/ and serves it on http://localhost:8080 (WebSocket at /ws)
PORT=9000 npm run server   # serve an existing build on another port
```

For multiplayer while developing, run `npm run dev` and `npm run server` side by side; the client connects to `ws://<host>:8080/ws` by default.

### GitHub Pages

The game must be served from the Vite build (`dist/`), not from the source files. The workflow in `.github/workflows/deploy-pages.yml` builds, tests and publishes it on every push to `main`:

1. In the repository go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
2. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually from the Actions tab).
3. The site is published at `https://<user>.github.io/<repo>/`.

GitHub Pages only hosts static files, so on Pages the Multiplayer screen starts in *Local (browser tabs)* mode. To fly online, host `npm run server` somewhere reachable and enter its `wss://…/ws` address.

## Features

### Aircraft
| Aircraft | Category | Notes |
| --- | --- | --- |
| Kestrel K-172 | Private | Four-seat trainer, analog six-pack cockpit, fixed gear |
| Lyra LJ-45 | Private | Light business jet with glass cockpit and autothrottle |
| Meridian MJ-320 | Commercial | Narrow-body fly-by-wire airliner with envelope protection and autoland |
| Vireo RJ-900 | Commercial | Regional jet |
| Meridian MW-350 | Commercial | Long-haul wide-body twinjet |
| Talon FX-16 | Fighter | Fly-by-wire fighter, afterburner, 9 g limiter, HUD and radar MFD |
| Tempest EF-2 | Fighter | Canard-delta air superiority fighter |
| Titan T-74F | Cargo | Heavy four-engine freighter |
| Mule CT-130 | Cargo | Four-turboprop tactical transport |

Four aircraft (one per category) are available from the start; the rest are bought in the hangar with credits earned in Career Mode and Missions once you reach the required rank. The **paint shop** lets you design and save custom liveries (fuselage, cheatline, tail art, titles, camouflage for fighters). *Settings → Gameplay → Unlock all aircraft* enables a sandbox mode.

### Flight model
- 6-degree-of-freedom rigid-body simulation at 240 Hz with stability-derivative aerodynamics, non-linear lift and stall, induced and wave drag, ground effect and flap/gear/spoiler effects.
- ISA atmosphere, jet engines (spool-up, N1/N2, EGT, afterburner, reversers, start sequence), piston and turboprop engines with propeller thrust and torque.
- Spring-damper landing gear with tyre friction, steering and brakes (including autobrake and brake heating), tail strikes, overstress and crash detection.
- Wind, gusts, turbulence and thunderstorm downdrafts/outflow.
- Flight control laws: direct (GA), fly-by-wire with protections (airliners) and fighter g-command; three assistance levels (Beginner, Intermediate, Realistic).
- Autopilot with HDG, NAV (GPS flight plan), LOC/G-S approach, ALT, V/S and level-change modes, autothrust and CAT III autoland with flare, retard and rollout.

### Cockpits & instruments
- Interactive 3D cockpits for each class: airliner glass cockpit (PFD, ND with weather radar and TCAS traffic, engine and systems displays, FCU autopilot panel, overhead switches, thrust/flap/speedbrake levers), GA steam gauges with a GPS, and a fighter cockpit with HUD and radar MFD.
- Click switches, buttons and levers; scroll over knobs and levers. Hovering shows the control name and its state.
- GPWS and warning callouts (pull up, sink rate, glideslope, altitude callouts, retard), master warning/caution, stall and overspeed warnings.

### World
- Quadtree terrain LOD streamed from Web Workers, mountains with snow and rock, forests, farmland, lakes and an ocean with coastline islands.
- Cities with instanced buildings and lit windows at night, landmark towers and a stadium.
- Nine airports (international, regional, GA, military, cargo, mountain strip) with runways, markings, taxiways, aprons, terminals and piers, jet bridges, control towers, hangars, fuel farms, approach/runway/taxiway lighting, PAPI, windsocks and moving ground vehicles.
- Dynamic sky with sun, moon and stars, day/night cycle with time acceleration, volumetric-looking cumulus, stratus layers, storm towers, rain, snow, fog and lightning with thunder. Weather can evolve during flight.

### Game modes
- **Free Flight** — any owned aircraft, any airport, gate/runway/final approach/in-flight start, time, weather, wind, fuel and payload, optional GPS destination.
- **Career Mode** — a job board of passenger and cargo flights from your current base, paid by landing quality, passenger comfort and punctuality. Seven pilot ranks, a logbook and statistics.
- **Missions** — 20 missions in six categories: passenger, cargo, emergency landings (engine failure, fire, glider, gear failure, fuel leak), search & rescue (find and supply drops), long-distance and military (canyon rings, intercept, air show).
- **Flight School** — six interactive lessons from basic controls to ILS autoland and fighter handling, plus a pilot handbook.
- **Multiplayer** — fly with other pilots in shared rooms with chat; other aircraft appear in the world, on the map, the navigation display and TCAS. A *Local* mode links several browser tabs without a server.

### Air traffic control & traffic
- AI airliners, business jets, cargo and GA traffic push back, taxi along the taxiway network, take off, fly between airports, fly circuits, land and park at gates.
- ATC radio menu (Tab) with spoken replies: pushback and taxi with a green taxi-route line, takeoff and landing clearances, ATIS, ILS/visual approach vectors, altitude changes, direct-to, flight following and emergencies.

### Cameras
Cockpit, passenger cabin (window seat looking out at the wing), external chase, wing, cinematic, tower and fly-by.

### Interface
Main menu with Free Flight, Career Mode, Missions, Flight School, Aircraft Selection, Multiplayer, Settings and Exit; in-flight dashboard (mini PFD/ND, airspeed, altitude, heading, vertical speed, G, fuel and endurance, engines, gear, flaps, spoilers, brakes, trim, next waypoint, GPS position) with a clickable autopilot panel; world map with flight-plan editing and approach selection; pause menu with weather & time controls; debriefs with scoring and landing analysis.

### Graphics, sound and performance
- ACES tone mapping, image-based lighting, shadows, bloom, fog matched to the sky and cloud layers.
- Procedural Web Audio engine sounds (fan/turbine, propeller, afterburner rumble), wind, rain, thunder, gear and flap motors, touchdown chirps and cockpit chimes; ATC and callouts via the Web Speech API.
- Quality presets (Low/Medium/High/Ultra) and per-feature settings, dynamic resolution that keeps the frame rate smooth, instanced rendering, worker-generated terrain and vegetation, distance-based LOD.

## Controls

All keys can be rebound in *Settings → Key bindings*. Press `` ` `` or F10 in flight for the full list.

| Action | Keys |
| --- | --- |
| Pitch down / up | W / S or ↑ / ↓ |
| Roll left / right | A / D or ← / → |
| Rudder / nose-wheel steering | Q / E |
| Throttle up / down | Shift / Ctrl, = / -, Page Up / Page Down |
| Full throttle / idle | F4 / F1 |
| Flaps extend / retract | F / V |
| Landing gear | G |
| Brakes (hold) / parking brake | B / K |
| Speed brakes, arm ground spoilers | / |
| Thrust reversers | R |
| Autopilot / autothrottle | Z / X |
| Engine auto-start | I |
| Lights: landing / nav / strobe | L / N / O |
| Elevator trim | Home / End |
| Cameras | 1 cockpit · 2 cabin · 3 external · 4 wing · 5 cinematic · 6 tower · 7 fly-by · C cycle |
| Look around / zoom | right-drag / mouse wheel |
| Map · ATC · chat · HUD | M · Tab · Enter · H |
| Simulation rate | T faster · Y slower |
| Pause menu | Esc or P |

**Gamepad** (standard mapping): left stick pitch/roll, LT/RT throttle, LB/RB rudder, A brakes, B/X flaps, Y gear, D-pad trim/autopilot/map, right stick look. **Joysticks and HOTAS** are detected automatically; map the pitch, roll, rudder and throttle axes in *Settings → Controls*. **Mouse yoke** flying can be enabled in the same place.

## First flight in an airliner

1. Free Flight → Meridian MJ-320 → *Runway* start at AXMI, destination AXNG.
2. Release the parking brake (K), press F4 for take-off thrust, rotate at the “R” speed with S.
3. Gear up (G), retract flaps (V) as you accelerate, then Z for the autopilot and X for autothrust.
4. On the autopilot panel set an altitude and press LVL CHG, then NAV to follow the route.
5. Near the destination open the map (M), click the airport, choose an ILS runway and press APPR. The aircraft captures the localizer and glideslope; extend flaps and gear and it lands itself.

## Project layout

```
src/
  core/       game loop, settings, profile, input, formatting
  physics/    atmosphere, engines, 6-DOF flight model, flight controls, wind
  aircraft/   aircraft data, simulation, autopilot, navigation, procedural models, liveries, effects
  cockpit/    3D cockpits, canvas instruments, cabin interior
  world/      terrain generation & LOD, sky, water, weather, clouds, precipitation, cities, vegetation, airports
  traffic/    AI traffic and air traffic control
  missions/   missions, tutorials, career jobs and scoring
  net/        multiplayer client (WebSocket / BroadcastChannel)
  audio/      procedural sound engine
  camera/     camera modes
  ui/         menus, HUD, map, styles
server/       static file + WebSocket relay server
tests/        flight-model tests (vitest)
tools/        headless test and debugging scripts
dev/          model and world viewers for development
```

## Testing

```bash
npm test                         # flight model: takeoff for every aircraft, altitude hold, crash detection, autoland
node tools/flows.mjs             # in-browser smoke test of all missions, tutorials, career, ATC, crash/debrief, multiplayer
node tools/e2e.mjs               # menus + a flight with screenshots (needs the dev server and Playwright)
node tools/views.mjs URL out mj320,k172 cockpit,cabin   # camera view screenshots
node tools/autolandTest.mjs      # headless autoland runs for the airliners
```

The browser scripts expect Playwright with Chromium (installed globally or locally) and a running dev server.
