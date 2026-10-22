// Dev-only world viewer. Params: x,z,y (camera), h (heading deg), p (pitch deg), t (time of day), oc (overcast)
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Settings } from '../src/core/Settings.js';
import { terrainHeight } from '../src/world/terrainGen.js';
import { Airports } from '../src/world/Airports.js';
import { Cities } from '../src/world/Cities.js';
import { Vegetation } from '../src/world/Vegetation.js';
import { Weather } from '../src/world/Weather.js';
import { Clouds } from '../src/world/Clouds.js';
import { Precipitation } from '../src/world/Precipitation.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 450000);
const game = { scene, renderer, settings: new Settings() };
const world = new World(game);
world.time = +(q.get('t') ?? 10);
world.timeRate = 0;
const weather = new Weather();
weather.set(q.get('wx') || 'scattered');
world.weather = weather;
const clouds = new Clouds(scene);
const precip = new Precipitation(scene);
const airports = world.addSystem(new Airports(scene));
world.addSystem(new Cities(scene));
world.addSystem(new Vegetation(scene, world.terrain));
const x = +(q.get('x') ?? 32000), z = +(q.get('z') ?? 74000);
const gh = Math.max(0, terrainHeight(x, z));
const y = q.get('y') ? +q.get('y') : gh + 300;
camera.position.set(x, y, z);
const hdg = (+(q.get('h') ?? 0)) * Math.PI / 180, pit = (+(q.get('p') ?? -10)) * Math.PI / 180;
camera.rotation.order = 'YXZ';
camera.rotation.set(pit, -hdg, 0);

let last = performance.now();
let frames = 0;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  weather.update(dt, camera.position);
  world.update(dt, camera, camera.position);
  clouds.update(dt, camera, world.sky, weather, precip.flash);
  precip.update(dt, camera, weather, null, (x, z) => terrainHeight(x, z));
  scene.fog.density = 1.978 / Math.max(50, weather.state.visibility * (1 - 0.97 * clouds.inCloud));
  renderer.render(scene, camera);
  frames++;
  document.getElementById('info').textContent = `tiles ${world.terrain.meshCount} sel ${world.terrain.selected.length} pending ${world.terrain.pendingCount(camera.position)} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
  requestAnimationFrame(loop);
}
loop();
