// Game orchestrator: renderer, world, player, systems, state machine and main loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { EventBus } from './EventBus.js';
import { Settings } from './Settings.js';
import { Profile } from './Profile.js';
import { Input } from './Input.js';
import { World } from '../world/World.js';
import { Weather } from '../world/Weather.js';
import { Clouds } from '../world/Clouds.js';
import { Precipitation } from '../world/Precipitation.js';
import { Airports } from '../world/Airports.js';
import { Cities } from '../world/Cities.js';
import { Vegetation } from '../world/Vegetation.js';
import { isPaved, layoutFor } from '../world/airportLayout.js';
import { getAirport, getRunwayEnd, AIRPORT_INFO } from '../world/airportGeometry.js';
import { terrainHeight } from '../world/terrainGen.js';
import { getAircraft } from '../aircraft/aircraftData.js';
import { AircraftVisual } from '../aircraft/AircraftVisual.js';
import { PlayerAircraft } from '../aircraft/PlayerAircraft.js';
import { CameraManager } from '../camera/CameraManager.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { AITraffic } from '../traffic/AITraffic.js';
import { ATC } from '../traffic/ATC.js';
import { MissionManager } from '../missions/MissionManager.js';
import { Multiplayer } from '../net/Multiplayer.js';
import { UIManager } from '../ui/UIManager.js';
import { KT, FT, NM, DEG } from '../physics/atmosphere.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.events = new EventBus();
    this.settings = new Settings();
    this.profile = new Profile(this.settings);
    this.state = 'boot';
    this.paused = false;
    this.player = null;
    this.flightConfig = null;
    this.dt = 0;
    this.frameTimes = [];
    this.fps = 60;
    this.pixelRatio = 1;
    this.atcStrict = false;
    window.__sim = this;
  }

  // ------------------------------------------------------------------ setup
  createRenderer() {
    const g = this.settings.get('graphics');
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !!g.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = g.shadows !== 'off';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2) * (g.resolutionScale || 1);
    this.pixelRatio = this.basePixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(g.fov || 60, window.innerWidth / window.innerHeight, 0.3, 450000);
    this.scene.add(this.camera);
    this.setupComposer();
    window.addEventListener('resize', () => this.onResize());
  }

  setupComposer() {
    const g = this.settings.get('graphics');
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!g.bloom) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: g.antialias ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  applyGraphicsSettings() {
    const g = this.settings.get('graphics');
    this.renderer.shadowMap.enabled = g.shadows !== 'off';
    const sz = { off: 512, low: 1024, high: 2048, ultra: 4096 }[g.shadows] || 2048;
    const sl = this.world.sky.sunLight;
    sl.castShadow = g.shadows !== 'off';
    if (sl.shadow.mapSize.x !== sz) {
      sl.shadow.mapSize.set(sz, sz);
      if (sl.shadow.map) {
        sl.shadow.map.dispose();
        sl.shadow.map = null;
      }
    }
    const t = this.world.terrain;
    t.setQuality(g.terrainDetail === 'ultra' ? 128 : g.terrainDetail === 'low' ? 512 : g.terrainDetail === 'medium' ? 256 : 256, g.viewDistance === 'far' ? 2.8 : g.viewDistance === 'near' ? 1.9 : 2.35);
    this.vegetation.setQuality(g.trees);
    this.clouds.setRadius({ low: 18000, medium: 26000, high: 34000, ultra: 45000 }[g.clouds] || 34000);
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2) * (g.resolutionScale || 1);
    this.pixelRatio = this.basePixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.camera.far = g.viewDistance === 'far' ? 600000 : 450000;
    this.cameras.baseFov = g.fov || 60;
    this.setupComposer();
    this.onResize();
  }

  async init() {
    this.createRenderer();
    this.input = new Input(this, this.canvas);
    this.audio = new AudioEngine(this.settings);
    this.ui = new UIManager(this, this.uiRoot);
    this.ui.showLoading('Initialising renderer', 0.05);
    await nextFrame();
    this.world = new World(this);
    this.weather = new Weather();
    this.world.weather = this.weather;
    this.weather.set('fewClouds', { windDir: 250, windSpeed: 4 });
    this.ui.showLoading('Building airports', 0.15);
    await nextFrame();
    this.airports = this.world.addSystem(new Airports(this.scene, { detail: this.settings.get('graphics').buildings === 'low' ? 'low' : 'high' }));
    this.world.airports = this.airports;
    this.world.paved = isPaved;
    this.ui.showLoading('Generating cities', 0.35);
    await nextFrame();
    const bd = { low: 0.45, medium: 0.75, high: 1, ultra: 1.25 }[this.settings.get('graphics').buildings] || 1;
    this.cities = this.world.addSystem(new Cities(this.scene, { density: bd }));
    this.ui.showLoading('Planting forests', 0.55);
    await nextFrame();
    this.vegetation = this.world.addSystem(new Vegetation(this.scene, this.world.terrain, { quality: this.settings.get('graphics').trees }));
    this.clouds = new Clouds(this.scene);
    this.precip = new Precipitation(this.scene);
    this.cameras = new CameraManager(this, this.camera);
    this.atc = new ATC(this);
    this.traffic = new AITraffic(this);
    this.missions = new MissionManager(this);
    this.multiplayer = new Multiplayer(this);
    this.ui.bindSystems();
    this.applyGraphicsSettings();
    this.settings.on('change', (e) => {
      if (e.section === 'graphics' || e.section === '*') this.applyGraphicsSettings();
      if (e.section === 'gameplay' && this.player) {
        const gp = this.settings.get('gameplay');
        this.player.sim.setAssist(gp.difficulty === 'beginner' ? 'beginner' : gp.difficulty === 'realistic' ? 'realistic' : 'intermediate');
        this.player.sim.fm.crashEnabled = gp.crashes;
        this.weather.dynamic = gp.dynamicWeather && !this.flightConfig?.mission;
      }
    });
    // Menu scene: showcase aircraft at Meridian at sunset
    this.ui.showLoading('Streaming terrain', 0.7);
    this.setupMenuScene();
    this.lastTime = performance.now();
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
    // Wait for the terrain around the menu camera
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      await new Promise((r) => setTimeout(r, 200));
      const pend = this.world.terrain.pendingCount(this.camera.position);
      this.ui.showLoading(`Streaming terrain (${pend} tiles)`, 0.7 + 0.3 * Math.max(0, 1 - pend / 60));
      if (pend < 4) break;
    }
    this.state = 'menu';
    this.ui.showScreen('main');
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'flying') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ------------------------------------------------------------------ menu scene
  setupMenuScene(aircraftId = null, livery = null) {
    const id = aircraftId || 'mj320';
    const spec = getAircraft(id);
    const L = layoutFor('AXMI');
    // Showcase stand: on the apron in front of the first hangar, nose pointing out
    const H = L.hangars[0];
    const out = Math.sign(H.laneV - H.v) || 1;
    const fus = spec.model.fuselage;
    const off = H.d / 2 + 16 + (fus.tailZ - fus.noseZ) * 0.55;
    const pA = L.world(H.u, H.v + out * off),
      pB = L.world(H.u, H.v + out * (off + 10));
    const gate = { x: pA.x, z: pA.z, heading: ((Math.atan2(pB.x - pA.x, -(pB.z - pA.z)) / DEG) + 360) % 360 };
    if (this.showcase) {
      this.scene.remove(this.showcase.root);
      this.showcase.dispose();
    }
    this.showcase = new AircraftVisual(spec, livery || this.profile.liveryFor(id), { detail: 'high' });
    const gy = terrainHeight(gate.x, gate.z);
    const gearY = -Math.min(...spec.gear.points.map((g) => g.pos[1])) - (spec.gear.travel || 0.3) * 0.35;
    this.showcase.root.position.set(gate.x, gy + gearY, gate.z);
    this.showcase.root.rotation.set(0, -gate.heading * DEG, 0);
    this.scene.add(this.showcase.root);
    this.showcaseSpec = spec;
    this.showcaseState = { gearPos: 1, lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: false }, engines: spec.engine.list.map(() => ({ rpm: 0.25 })), gear: spec.gear.points.map(() => ({ compression: (spec.gear.travel || 0.3) * 0.35 })) };
    if (!this.menuInit) {
      this.menuInit = true;
      this.world.time = 18.35;
      this.world.timeRate = 0;
      this.traffic.populate({ x: gate.x, y: 0, z: gate.z });
    }
  }

  removeShowcase() {
    if (this.showcase) {
      this.scene.remove(this.showcase.root);
      this.showcase.dispose();
      this.showcase = null;
    }
  }

  // ------------------------------------------------------------------ flights
  async startFlight(config) {
    this.audio.init();
    this.state = 'loading';
    this.paused = false;
    this.flightConfig = config;
    this.ui.showLoading('Preparing your flight', 0.1);
    await nextFrame();
    this.removeShowcase();
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    this.missions.cleanup();
    this.atc.reset();
    this.traffic.clear();
    const spec = getAircraft(config.aircraftId);
    const gp = this.settings.get('gameplay');
    // Environment
    this.world.time = config.time ?? 12;
    this.world.timeRate = config.timeRate ?? gp.timeRate ?? 1;
    this.weather.set(config.weather || 'fewClouds', config.wind ? { windDir: config.wind.dir, windSpeed: config.wind.speed } : {});
    this.weather.dynamic = config.dynamicWeather ?? (gp.dynamicWeather && !config.mission);
    this.atcStrict = !!config.job;
    // Player
    const livery = config.livery || this.profile.liveryFor(spec.id);
    this.player = new PlayerAircraft(this, spec, livery, { callsign: config.callsign });
    const sim = this.player.sim;
    const spawn = this.resolveSpawn(config, spec);
    sim.spawn({ ...spawn, fuelFrac: config.fuel ?? 0.6, payloadFrac: config.payloadFrac ?? this.payloadFraction(spec, config.mission) });
    if (spawn.mode === 'air' && spawn.gearDown) {
      sim.gearLever = 1;
      sim.gearPos = 1;
      sim.fm.controls.gear = 1;
      sim.setFlaps(Math.min(2, spec.flaps.length - 1));
      sim.fm.controls.flaps = spec.flaps[sim.flapsIndex].deg;
    }
    if (spawn.mode === 'air' && spec.autopilot.athr && (config.mission || config.spawn === 'final')) {
      sim.ap.engage();
      sim.ap.setAthr(true);
      sim.ap.spd = Math.round(sim.fm.ias / KT);
      sim.ap.modeALT();
    }
    if (config.coldDark) sim.spawn({ ...spawn, coldDark: true, fuelFrac: config.fuel ?? 0.6 });
    // Lessons start with the parking brake set so the student releases it
    if (config.tutorial && spawn.mode === 'runway') sim.parkingBrake = true;
    // Navigation for free flights
    const nav = sim.nav;
    if (!config.mission) {
      nav.clear();
      const ap = getAirport(spawn.airport || config.airport);
      if (ap) nav.origin = ap;
      if (config.destination) nav.setRoute(spawn.airport || config.airport, config.destination);
      if (spawn.approachEnd) nav.setApproach(spawn.approachEnd);
    }
    // Systems
    this.missions.begin(config.mission || null, { kind: config.tutorial ? 'tutorial' : config.mission ? 'mission' : 'free', job: config.job });
    if (spawn.approachEnd && !nav.approach) nav.setApproach(spawn.approachEnd);
    this.traffic.populate(sim.fm.position);
    this.cameras.setMode(config.camera || (config.tutorial ? 'cockpit' : 'chase'));
    if (this.multiplayer.connected) this.multiplayer.updateInfo(spec.id, livery);
    this.input.context = 'flight';
    // Wait for terrain tiles near the aircraft
    this.cameras.update(0.016);
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 150));
      this.cameras.update(0.016);
      const pend = this.world.terrain.pendingCount(this.camera.position);
      this.ui.showLoading(`Loading scenery (${pend} tiles)`, 0.3 + 0.7 * Math.max(0, 1 - pend / 80));
      if (pend < 3) break;
    }
    this.state = 'flying';
    this.ui.showFlight();
    if (config.tutorial && config.mission) this.ui.tutorialStep(config.mission.steps[0], 0, config.mission.steps.length);
    else if (config.mission) this.ui.toast(`Objective: ${this.missions.currentObjectiveText()}`, 'info', 6000);
    this.events.emit('flightStarted', config);
  }

  payloadFraction(spec, mission) {
    if (mission && mission.payload) {
      if (mission.payload.passengers && spec.mass.passengers) return Math.min(1, (mission.payload.passengers * 95) / spec.mass.maxPayload);
      if (mission.payload.cargoKg) return Math.min(1, mission.payload.cargoKg / Math.max(1, spec.mass.maxPayload));
    }
    return 0.5;
  }

  // Determine spawn position from a flight configuration
  resolveSpawn(config, spec) {
    const start = config.mission ? config.mission.start : null;
    if (start && (start.air || start.final || start.pattern)) {
      const s = MissionManager.spawnFor(start, spec);
      if (start.final) s.gearDown = start.final.nm < 9;
      return s;
    }
    const icao = (start && start.airport) || config.airport || 'AXMI';
    const ap = getAirport(icao);
    let mode = (start && start.spawn) || config.spawn || 'runway';
    const ws = this.weather.state;
    const minLen = spec.mass.maxTakeoff > 150000 ? 2400 : spec.mass.maxTakeoff > 30000 ? 1600 : 500;
    if (mode === 'gate') {
      const L = layoutFor(icao);
      const gates = L.gates.filter((g) => this.traffic.gateFits(g, spec));
      const gate = gates[Math.floor(Math.random() * gates.length)] || L.gates[0];
      this.traffic.reserveGate(gate);
      const gy = terrainHeight(gate.x, gate.z);
      return { mode: 'parked', x: gate.x, z: gate.z, heading: gate.heading * DEG, groundH: gy, airport: icao };
    }
    const rwy = (start && start.runway) || config.runway;
    if (mode === 'final') {
      const end = (rwy && getRunwayEnd(icao, rwy)) || this.atc.activeRunway(ap, minLen);
      const s = MissionManager.spawnFor({ final: { airport: icao, runway: end.id, nm: 10, altFt: 3000 } }, spec);
      s.gearDown = true;
      s.airport = icao;
      return s;
    }
    if (mode === 'air') {
      const hdg = config.heading ?? 90;
      return { mode: 'air', x: ap.x - Math.sin(hdg * DEG) * 8000, z: ap.z + Math.cos(hdg * DEG) * 8000, altitude: ap.elevation + (config.altitudeFt || 5000) * FT, heading: hdg * DEG, speed: Math.min(spec.speeds.cruise * 0.75, spec.speeds.vref * 1.7) * KT, airport: icao };
    }
    // runway
    const end = (rwy && getRunwayEnd(icao, rwy)) || this.atc.activeRunway(ap, minLen);
    const x = end.x + end.dirX * 25,
      z = end.z + end.dirZ * 25;
    this.atc.assignedEnd = end;
    this.atc.airport = ap;
    this.atc.clearances.takeoff = true;
    this.atc.state = 'clearedTakeoff';
    return { mode: 'runway', x, z, heading: end.heading * DEG, groundH: terrainHeight(x, z), airport: icao };
  }

  restartFlight() {
    if (this.flightConfig) this.startFlight(this.flightConfig);
  }

  endFlight(showDebrief = true) {
    if (!this.player) return this.toMenu();
    const ms = this.missions;
    let result;
    if (ms.kind === 'free' || !ms.mission) result = ms.freeFlightSummary();
    else if (!ms.done) {
      ms.finish(false, 'Flight abandoned');
      return;
    }
    if (result) this.onMissionFinished(result, showDebrief);
  }

  onMissionFinished(result, showDebrief = true) {
    const p = this.player;
    const td = result.touchdown;
    const rec = {
      title: result.title,
      aircraft: p ? p.spec.name : '',
      aircraftId: p ? p.spec.id : '',
      from: this.flightConfig?.mission?.start?.airport || this.flightConfig?.airport || '',
      to: result.success && this.missions.landedAt ? this.missions.landedAt : this.flightConfig?.job?.to || '',
      duration: result.duration,
      distanceNm: result.distanceNm,
      landed: !!td,
      landingRate: td ? Math.round(td.fpm) : null,
      score: result.score,
      stars: result.stars,
      credits: result.credits,
      xp: result.xp,
      success: result.success,
      crashed: p ? p.sim.crashed : false,
      missionId: result.kind === 'mission' || result.kind === 'tutorial' ? result.missionId : null,
      job: !!result.job,
    };
    if (result.job && result.success) rec.to = result.job.to;
    const { rankUp } = this.profile.addFlight(rec);
    if (result.kind === 'tutorial' && result.success) {
      this.profile.data.tutorials[result.missionId] = true;
      this.profile.persist();
    }
    result.rankUp = rankUp;
    this.audio.chime(result.success ? 'mission' : 'fail');
    if (showDebrief) {
      this.state = 'debrief';
      this.input.context = 'menu';
      this.audio.stopAllWarnings();
      this.ui.showDebrief(result);
    }
  }

  toMenu() {
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    this.missions.cleanup();
    this.atc.reset();
    this.traffic.clear();
    this.menuInit = false;
    this.setupMenuScene();
    this.state = 'menu';
    this.paused = false;
    this.input.context = 'menu';
    this.ui.showScreen('main');
  }

  onTouchdown(ev) {
    this.missions.onTouchdown(ev);
    this.events.emit('touchdown', ev);
  }
  onLiftoff(ev) {
    this.missions.onLiftoff(ev);
  }
  onCrash(reason) {
    this.missions.onCrash(reason);
    this.ui.showCrash(reason);
    this.audio.stopAllWarnings();
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.audio.stopAllWarnings();
  }

  teleport(x, z, altFt = null) {
    if (!this.player) return;
    const sim = this.player.sim;
    const g = Math.max(terrainHeight(x, z), 0);
    const alt = altFt !== null ? altFt * FT : Math.max(sim.fm.position.y, g + 600);
    const att = this.player.attitude;
    const spd = Math.max(sim.fm.tas, sim.spec.speeds.vref * 1.5 * KT);
    sim.fm.placeInAir(x, alt, z, att.heading, spd, 2 * DEG);
    sim.gearLever = 0;
    sim.gearPos = 0;
    sim.fcs.reset();
    sim.ap.syncTargets();
    this.traffic.populate(sim.fm.position);
  }

  trafficFor(pos) {
    const list = this.traffic.trafficFor(pos);
    if (this.multiplayer.connected) list.push(...this.multiplayer.trafficFor(pos));
    return list;
  }

  // ------------------------------------------------------------------ actions
  handleAction(a) {
    const p = this.player;
    const ui = this.ui;
    if (a === 'pause') {
      if (ui.modalOpen) ui.closeModal();
      else if (this.state === 'flying') {
        this.setPaused(!this.paused);
        if (this.paused) ui.showPause();
        else ui.hidePause();
      }
      return;
    }
    if (this.state !== 'flying' || !p) return;
    if (a === 'map') return ui.toggleMap();
    if (a === 'atc') return ui.toggleATC();
    if (a === 'chat') return ui.openChat();
    if (a === 'help') return ui.toggleHelp();
    if (a === 'hud') return ui.cycleHud();
    if (this.paused || ui.modalOpen) return;
    const sim = p.sim;
    switch (a) {
      case 'gear':
        sim.toggleGear();
        break;
      case 'flapsDown':
        sim.flapsDown();
        ui.toast(`Flaps ${p.spec.flaps[sim.flapsIndex].name}`, 'info', 1200);
        break;
      case 'flapsUp':
        sim.flapsUp();
        ui.toast(`Flaps ${p.spec.flaps[sim.flapsIndex].name}`, 'info', 1200);
        break;
      case 'spoilers':
        sim.toggleSpoilers();
        ui.toast(sim.spoilerLever > 0 ? 'Speed brakes extended' : sim.spoilersArmed ? 'Ground spoilers ARMED' : 'Speed brakes retracted', 'info', 1500);
        break;
      case 'parkingBrake':
        sim.toggleParkingBrake();
        ui.toast(`Parking brake ${sim.parkingBrake ? 'SET' : 'released'}`, 'info', 1200);
        break;
      case 'reverse':
        sim.toggleReverse();
        break;
      case 'autopilot':
        p.toggleAP();
        break;
      case 'autothrottle':
        p.toggleATHR();
        break;
      case 'engineStart': {
        const allRunning = sim.engines.every((e) => e.running);
        if (allRunning) ui.toast('Engines already running (use cockpit switches to shut down)', 'info');
        else {
          sim.autoStart(false);
          ui.toast('Auto-start: battery, fuel pumps and engine starters ON', 'info');
        }
        break;
      }
      case 'landingLights':
        sim.setSwitch('landingLights');
        break;
      case 'navLights':
        sim.setSwitch('navLights');
        break;
      case 'strobes':
        sim.setSwitch('strobeLights');
        break;
      case 'throttleFull':
        if (sim.ap.athr) sim.ap.setAthr(false);
        sim.throttleLever = 1;
        break;
      case 'throttleCut':
        if (sim.ap.athr) sim.ap.setAthr(false);
        sim.throttleLever = 0;
        break;
      case 'camera':
        this.cameras.cycle(1);
        ui.cameraLabel(this.cameras.mode);
        break;
      case 'cameraCockpit':
      case 'cameraCabin':
      case 'cameraChase':
      case 'cameraWing':
      case 'cameraCinematic':
      case 'cameraTower':
      case 'cameraFree': {
        const mode = { cameraCockpit: 'cockpit', cameraCabin: 'cabin', cameraChase: 'chase', cameraWing: 'wing', cameraCinematic: 'cinematic', cameraTower: 'tower', cameraFree: 'flyby' }[a];
        this.cameras.setMode(mode);
        ui.cameraLabel(this.cameras.mode);
        break;
      }
      case 'lookCenter':
        this.cameras.lookCenter();
        break;
      case 'simRateUp':
      case 'simRateDown': {
        const rates = [1, 2, 4, 8];
        let i = rates.indexOf(sim.simRate);
        i = Math.max(0, Math.min(rates.length - 1, i + (a === 'simRateUp' ? 1 : -1)));
        if (rates[i] > 1 && sim.fm.agl < 300 * FT) {
          ui.toast('Simulation rate is limited to 1× below 1,000 ft', 'warn');
          i = 0;
        }
        sim.simRate = rates[i];
        ui.toast(`Simulation rate ${sim.simRate}×`, 'info', 1500);
        break;
      }
      case 'dropSupplies':
        this.missions.dropSupplies();
        break;
      case 'smoke':
        p.effects.smokeOn = !p.effects.smokeOn;
        break;
    }
  }

  // ------------------------------------------------------------------ loop
  loop(t) {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.loop(tt));
    const rawDt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    const dt = Math.min(0.1, Math.max(0, rawDt));
    this.dt = dt;
    this.input.update(dt);
    for (const a of this.input.consume()) this.handleAction(a);
    try {
      if (this.state === 'flying' || this.state === 'debrief') this.updateFlight(dt);
      else this.updateMenu(dt);
    } catch (e) {
      console.error(e);
    }
    this.render();
    this.trackPerformance(rawDt);
  }

  updateMenu(dt) {
    const focus = this.showcase ? this.showcase.root.position : new THREE.Vector3(32000, 120, 70000);
    if (this.showcase) this.showcase.update(dt, { ...this.showcaseState, night: this.world.night });
    const span = this.showcaseSpec ? Math.max(this.showcaseSpec.wing.span, 30) : 40;
    const hangar = this.ui && this.ui.screen === 'hangar';
    this.cameras.menuOrbit(dt, _v.copy(focus).add(_v2.set(0, hangar ? 1 : 3, 0)), span * (hangar ? 1.15 : 1.6), span * (hangar ? 0.22 : 0.3), hangar ? 0.12 : 0.04);
    this.weather.update(dt, focus);
    this.traffic.update(dt);
    this.world.update(dt, this.camera, focus);
    this.clouds.update(dt, this.camera, this.world.sky, this.weather, this.precip.flash);
    this.precip.update(dt, this.camera, this.weather, null, (x, z) => this.world.heightAt(x, z));
    this.updateFog();
    this.multiplayer.update(dt);
  }

  updateFlight(dt) {
    const p = this.player;
    if (!p) return;
    const simRate = p.sim.simRate;
    // Keep simulating a crashed aircraft behind the debrief so fire & smoke stay alive
    const running = !this.paused && (this.state === 'flying' || (this.state === 'debrief' && p.sim.crashed));
    if (running) {
      p.update(dt, this.input);
      // Building collisions
      const fm = p.sim.fm;
      if (!fm.crashed && !fm.wow && fm.agl < 400) {
        const b = this.cities.collide(fm.position, p.spec.wing.span * 0.35);
        if (b) fm.crash('Collision with a building');
      }
      this.missions.update(dt);
      this.atc.update(dt);
      this.traffic.update(dt * simRate);
      this.weather.update(dt * simRate, fm.position);
      this.airports.setWind(this.weather.state.windDir, this.weather.state.windSpeed);
      for (const ev of this.precip.consumeEvents()) if (ev.type === 'thunder') this.audio.thunder(ev.distance);
    } else if (this.player) {
      // keep visuals alive while paused
      p.cockpit.update(dt, this.world.night, this.cameras.mode === 'cockpit');
    }
    this.multiplayer.update(dt);
    const wdt = running ? dt * simRate : 0;
    this.world.update(wdt || 0.0001, this.camera, p.position);
    this.clouds.update(dt, this.camera, this.world.sky, this.weather, this.precip.flash);
    this.precip.update(running ? dt : 0, this.camera, this.weather, p.sim.fm.velocity, (x, z) => this.world.heightAt(x, z));
    this.cameras.update(dt);
    this.world.sky.updateCamera(this.camera);
    this.updateFog();
    // Audio
    const fm = p.sim.fm;
    const camDist = this.camera.position.distanceTo(fm.position);
    const toCam = _v.subVectors(this.camera.position, fm.position).normalize();
    this.audio.update(dt, {
      engines: p.flightData.engines.map((e) => ({ rpm: e.n1 ?? e.rpm, n1: e.n1, afterburner: e.afterburner, throttle: p.sim.throttleLever })),
      tas: fm.tas,
      gs: fm.groundSpeed,
      onGround: fm.wow,
      inside: this.cameras.inside,
      cabin: this.cameras.mode === 'cabin',
      cameraDist: camDist,
      closingSpeed: fm.velocity.dot(toCam),
      precip: this.weather.state.precipitation * (this.camera.position.y < this.weather.state.cloudBase + 500 ? 1 : 0),
      stall: fm.stalled,
    });
    this.ui.update(dt);
  }

  updateFog() {
    const w = this.weather.state;
    const inCloud = this.clouds.inCloud;
    let vis = w.visibility;
    // Ground fog thins out above its top
    if (w.fog > 0.5 && this.camera.position.y > w.layerTop + 50) vis = Math.max(vis, 25000);
    vis = vis * (1 - 0.985 * Math.min(1, inCloud * 1.4));
    vis = Math.max(35, vis);
    this.scene.fog.density = 1.978 / vis;
    this.inCloud = inCloud;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  trackPerformance(rawDt) {
    this.frameTimes.push(rawDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / Math.max(1e-3, avg);
    const g = this.settings.get('graphics');
    if (g.dynamicResolution && this.frameTimes.length === 60) {
      this.perfTimer = (this.perfTimer || 0) + rawDt;
      if (this.perfTimer > 2) {
        this.perfTimer = 0;
        let pr = this.pixelRatio;
        if (avg > 1 / 40 && pr > this.basePixelRatio * 0.6) pr = Math.max(this.basePixelRatio * 0.6, pr - 0.1);
        else if (avg < 1 / 58 && pr < this.basePixelRatio) pr = Math.min(this.basePixelRatio, pr + 0.05);
        if (Math.abs(pr - this.pixelRatio) > 0.01) {
          this.pixelRatio = pr;
          this.renderer.setPixelRatio(pr);
          this.onResize();
        }
      }
    }
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
