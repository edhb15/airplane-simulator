// World: owns every environmental system (sky, terrain, water, weather,
// airports, cities, vegetation) and provides ground queries for physics.

import * as THREE from 'three';
import { SkySystem } from './SkySystem.js';
import { Terrain } from './Terrain.js';
import { Water } from './Water.js';
import { terrainHeight, waterLevelAt, airportInfluence } from './terrainGen.js';
import { runwayAt } from './airportGeometry.js';

const _g = { h: 0, nx: 0, ny: 1, nz: 0, surface: 'grass', water: false };

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.renderer = game.renderer;
    this.time = 12; // hours
    this.timeRate = 1; // sim-time multiplier for the day/night cycle
    this.season = 'summer';
    this.sky = new SkySystem(this.renderer, this.scene);
    this.scene.fog = new THREE.FogExp2(0xa0b4c8, 0.00004);
    const q = game.settings.get('graphics');
    this.terrain = new Terrain(this.scene, { minSize: q.terrainDetail === 'ultra' ? 128 : q.terrainDetail === 'low' ? 512 : 256, lodFactor: q.viewDistance === 'far' ? 2.8 : q.viewDistance === 'near' ? 1.9 : 2.35 });
    this.water = new Water(this.scene);
    this.systems = [];
    this.weather = null; // assigned by Game (Weather system)
    this.paved = null; // function(x,z) -> bool, provided by Airports
  }

  addSystem(s) {
    this.systems.push(s);
    return s;
  }

  // Ground query for physics. y (optional) lets us skip normal estimation when far above ground.
  groundAt = (x, z, y) => {
    const g = _g;
    let h = terrainHeight(x, z);
    const wl = waterLevelAt(x, z);
    g.water = false;
    if (h < wl) {
      g.h = wl;
      g.water = true;
      g.nx = 0;
      g.ny = 1;
      g.nz = 0;
      g.surface = 'water';
      return g;
    }
    g.h = h;
    if (y !== undefined && y - h > 4) {
      g.nx = 0;
      g.ny = 1;
      g.nz = 0;
      g.surface = 'grass';
      return g;
    }
    const e = 2;
    const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
    const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
    const l = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
    g.nx = -hx / l;
    g.ny = (2 * e) / l;
    g.nz = -hz / l;
    const wet = this.weather && this.weather.state.precipitation > 0.2;
    const snow = this.weather && this.weather.state.precipType === 'snow' && this.weather.state.precipitation > 0.1;
    if (runwayAt(x, z, 2) || (this.paved && this.paved(x, z))) g.surface = snow ? 'snow' : wet ? 'wet' : 'asphalt';
    else g.surface = snow ? 'snow' : airportInfluence(x, z) > 0.5 ? 'grass' : 'dirt';
    return g;
  };

  heightAt(x, z) {
    return Math.max(terrainHeight(x, z), waterLevelAt(x, z));
  }

  update(dt, camera, focus) {
    this.time = (this.time + (dt * this.timeRate) / 3600 + 24) % 24;
    const ws = this.weather ? this.weather.state : { overcast: 0, visibility: 40000, precipitation: 0, windSpeed: 3 };
    this.sky.update(dt, this.time, ws, camera, focus);
    this.sky.updateCamera(camera);
    this.terrain.update(camera.position);
    this.water.update(dt, camera, ws);
    for (const s of this.systems) s.update(dt, camera, this);
  }

  get night() {
    return this.sky.night;
  }
}
