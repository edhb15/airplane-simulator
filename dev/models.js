// Dev-only model viewer: renders aircraft with a given livery for visual checks.
// URL params: ?id=mj320&livery=aurelia&view=side|front|top|three&gear=1&flaps=20
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AIRCRAFT, getAircraft } from '../src/aircraft/aircraftData.js';
import { AircraftVisual } from '../src/aircraft/AircraftVisual.js';
import { AIRCRAFT_LIVERIES } from '../src/aircraft/Livery.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7c9);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.6));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x777b7f, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const id = params.get('id') || 'mj320';
const ids = id === 'all' ? AIRCRAFT.map((a) => a.id) : [id];
const visuals = [];
let x = 0;
for (const aid of ids) {
  const spec = getAircraft(aid);
  const livery = params.get('livery') || AIRCRAFT_LIVERIES[aid][0];
  const v = new AircraftVisual(spec, livery, { detail: params.get('detail') || 'high' });
  const gearY = Math.min(...spec.gear.points.map((g) => g.pos[1]));
  v.root.position.set(x, -gearY - (spec.gear.travel || 0.3) * 0.35, 0);
  x += spec.wing.span + 8;
  scene.add(v.root);
  visuals.push({ v, spec });
}
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 2000);
const span = Math.max(...visuals.map((o) => Math.max(o.spec.wing.span, o.spec.model.fuselage.tailZ - o.spec.model.fuselage.noseZ)));
const cx = (x - visuals[visuals.length - 1].spec.wing.span - 8) / 2;
const view = params.get('view') || 'three';
const d = ids.length > 1 ? x * 0.75 : span * 1.6;
if (view === 'side') camera.position.set(cx + d, 3, 0);
else if (view === 'front') camera.position.set(cx, 3, -d);
else if (view === 'top') camera.position.set(cx, d, 0.01);
else if (view === 'rear') camera.position.set(cx + d * 0.4, d * 0.25, d * 0.8);
else camera.position.set(cx + d * 0.6, d * 0.3, -d * 0.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(cx, 2, 0);
controls.update();
const state = { elevator: +(params.get('elev') || 0), aileron: +(params.get('ail') || 0), rudder: +(params.get('rud') || 0), flapsDeg: +(params.get('flaps') || 0), spoilers: +(params.get('spoilers') || 0), gearPos: +(params.get('gear') ?? 1), gear: [{}, {}, {}], engines: [{ rpm: +(params.get('rpm') || 0.6), afterburner: +(params.get('ab') || 0) }], lights: { nav: true, strobe: true, beacon: true, landing: true, taxi: true }, night: 0.2 };
let last = performance.now();
function loop() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  for (const o of visuals) o.v.update(dt, state);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__ready = true;
