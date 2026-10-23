// Persistent user settings with graphics presets.
import { EventBus } from './EventBus.js';
import { load, save } from './storage.js';

export const GRAPHICS_PRESETS = {
  low: { resolutionScale: 0.75, shadows: 'off', terrainDetail: 'low', viewDistance: 'near', trees: 'low', buildings: 'low', clouds: 'low', bloom: false, antialias: false },
  medium: { resolutionScale: 1, shadows: 'low', terrainDetail: 'medium', viewDistance: 'normal', trees: 'medium', buildings: 'medium', clouds: 'medium', bloom: false, antialias: true },
  high: { resolutionScale: 1, shadows: 'high', terrainDetail: 'high', viewDistance: 'normal', trees: 'high', buildings: 'high', clouds: 'high', bloom: true, antialias: true },
  ultra: { resolutionScale: 1, shadows: 'ultra', terrainDetail: 'ultra', viewDistance: 'far', trees: 'ultra', buildings: 'ultra', clouds: 'ultra', bloom: true, antialias: true },
};

export const DEFAULT_BINDINGS = {
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ', 'Numpad0'],
  yawRight: ['KeyE', 'NumpadDecimal'],
  throttleUp: ['ShiftLeft', 'PageUp', 'Equal', 'NumpadAdd', 'F3'],
  throttleDown: ['ControlLeft', 'PageDown', 'Minus', 'NumpadSubtract', 'F2'],
  throttleFull: ['F4'],
  throttleCut: ['F1'],
  flapsDown: ['KeyF', 'BracketRight'],
  flapsUp: ['KeyV', 'BracketLeft'],
  gear: ['KeyG'],
  brakes: ['KeyB', 'Period'],
  parkingBrake: ['KeyK'],
  spoilers: ['Slash'],
  reverse: ['KeyR'],
  trimUp: ['End', 'Numpad1'],
  trimDown: ['Home', 'Numpad7'],
  autopilot: ['KeyZ'],
  autothrottle: ['KeyX'],
  engineStart: ['KeyI'],
  landingLights: ['KeyL'],
  navLights: ['KeyN'],
  strobes: ['KeyO'],
  camera: ['KeyC'],
  cameraCockpit: ['Digit1'],
  cameraCabin: ['Digit2'],
  cameraChase: ['Digit3'],
  cameraWing: ['Digit4'],
  cameraCinematic: ['Digit5'],
  cameraTower: ['Digit6'],
  cameraFree: ['Digit7'],
  lookBack: ['Numpad2'],
  lookLeft: ['Numpad4'],
  lookRight: ['Numpad6'],
  lookCenter: ['Numpad5', 'Space'],
  map: ['KeyM'],
  hud: ['KeyH'],
  atc: ['Tab'],
  chat: ['Enter'],
  pause: ['Escape', 'KeyP'],
  simRateUp: ['KeyT'],
  simRateDown: ['KeyY'],
  help: ['Backquote', 'F10'],
  dropSupplies: ['KeyJ'],
  smoke: ['KeyU'],
};

const DEFAULTS = {
  graphics: { preset: 'high', ...GRAPHICS_PRESETS.high, fpsCounter: false, dynamicResolution: true, fov: 60 },
  audio: { master: 0.8, engine: 0.9, environment: 0.7, radio: 0.8, ui: 0.6, voice: true },
  controls: {
    mouseYoke: false,
    sensitivity: 1,
    keyboardRate: 1,
    invertPitch: false,
    deadzone: 0.08,
    bindings: DEFAULT_BINDINGS,
    gamepad: { pitch: 1, roll: 0, yaw: 2, throttle: 3, invertPitch: false, invertThrottle: true, rudderOnBumpers: true },
    joystick: { pitch: 1, roll: 0, yaw: 5, throttle: 2, invertPitch: false, invertThrottle: true },
  },
  gameplay: {
    difficulty: 'intermediate',
    crashes: true,
    guidance: true,
    hints: true,
    unlimitedFuel: false,
    atcAutoTune: true,
    units: 'aviation',
    timeRate: 1,
    dynamicWeather: true,
    unlockAll: false,
    aiTraffic: 'normal',
    callsign: '',
  },
  hud: { mode: 'full', cockpitHud: 'minimal' },
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

export class Settings extends EventBus {
  constructor() {
    super();
    this.data = deepMerge(DEFAULTS, load('skyward.settings', {}));
    // ensure all bindings exist (new actions after upgrades)
    this.data.controls.bindings = { ...DEFAULT_BINDINGS, ...this.data.controls.bindings };
  }
  get(section) {
    return this.data[section];
  }
  set(section, key, value) {
    this.data[section][key] = value;
    if (section === 'graphics' && key !== 'preset' && key in GRAPHICS_PRESETS.high) this.data.graphics.preset = 'custom';
    this.persist();
    this.emit('change', { section, key, value });
  }
  applyPreset(name) {
    const p = GRAPHICS_PRESETS[name];
    if (!p) return;
    Object.assign(this.data.graphics, p, { preset: name });
    this.persist();
    this.emit('change', { section: 'graphics', key: 'preset', value: name });
  }
  resetBindings() {
    this.data.controls.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    this.persist();
    this.emit('change', { section: 'controls', key: 'bindings' });
  }
  reset() {
    this.data = deepMerge(DEFAULTS, {});
    this.persist();
    this.emit('change', { section: '*' });
  }
  persist() {
    save('skyward.settings', this.data);
  }
}
