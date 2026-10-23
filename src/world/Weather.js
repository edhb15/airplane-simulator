// Weather state: presets, smooth transitions, dynamic evolution and
// thunderstorm cell placement. Rendering is handled by Clouds / Precipitation.

import { mulberry32 } from './noise.js';

export const WEATHER_PRESETS = {
  clear: {
    label: 'Clear Skies', icon: '☀', cloudCover: 0.04, cloudBase: 1600, cloudDepth: 500, overcast: 0, layer: 0, layerBase: 2500, layerTop: 3000,
    visibility: 70000, precipitation: 0, precipType: 'rain', windSpeed: 3, gust: 0, turbulence: 0.02, lightning: 0, tempOffset: 0, fog: 0,
  },
  fewClouds: {
    label: 'Few Clouds', icon: '🌤', cloudCover: 0.22, cloudBase: 1300, cloudDepth: 700, overcast: 0.02, layer: 0, layerBase: 2500, layerTop: 3000,
    visibility: 55000, precipitation: 0, precipType: 'rain', windSpeed: 5, gust: 2, turbulence: 0.08, lightning: 0, tempOffset: 0, fog: 0,
  },
  scattered: {
    label: 'Scattered Clouds', icon: '⛅', cloudCover: 0.45, cloudBase: 1100, cloudDepth: 900, overcast: 0.12, layer: 0, layerBase: 2500, layerTop: 3000,
    visibility: 40000, precipitation: 0, precipType: 'rain', windSpeed: 6, gust: 3, turbulence: 0.12, lightning: 0, tempOffset: -1, fog: 0,
  },
  broken: {
    label: 'Broken Clouds', icon: '🌥', cloudCover: 0.72, cloudBase: 900, cloudDepth: 1100, overcast: 0.4, layer: 0.3, layerBase: 2600, layerTop: 3200,
    visibility: 28000, precipitation: 0, precipType: 'rain', windSpeed: 8, gust: 4, turbulence: 0.18, lightning: 0, tempOffset: -2, fog: 0,
  },
  overcast: {
    label: 'Overcast', icon: '☁', cloudCover: 0.5, cloudBase: 700, cloudDepth: 700, overcast: 0.82, layer: 1, layerBase: 900, layerTop: 2100,
    visibility: 16000, precipitation: 0, precipType: 'rain', windSpeed: 7, gust: 3, turbulence: 0.15, lightning: 0, tempOffset: -3, fog: 0,
  },
  rain: {
    label: 'Rain', icon: '🌧', cloudCover: 0.6, cloudBase: 500, cloudDepth: 900, overcast: 0.95, layer: 1, layerBase: 650, layerTop: 2600,
    visibility: 6000, precipitation: 0.65, precipType: 'rain', windSpeed: 10, gust: 6, turbulence: 0.3, lightning: 0, tempOffset: -4, fog: 0.2,
  },
  thunderstorm: {
    label: 'Thunderstorms', icon: '⛈', cloudCover: 0.65, cloudBase: 600, cloudDepth: 1400, overcast: 1, layer: 1, layerBase: 800, layerTop: 3500,
    visibility: 3500, precipitation: 0.95, precipType: 'rain', windSpeed: 13, gust: 10, turbulence: 0.5, lightning: 1, tempOffset: -2, fog: 0.2,
  },
  fog: {
    label: 'Fog', icon: '🌫', cloudCover: 0.0, cloudBase: 1200, cloudDepth: 400, overcast: 0.55, layer: 0.5, layerBase: 20, layerTop: 220,
    visibility: 450, precipitation: 0, precipType: 'rain', windSpeed: 1, gust: 0, turbulence: 0.0, lightning: 0, tempOffset: -2, fog: 1,
  },
  snow: {
    label: 'Snow', icon: '🌨', cloudCover: 0.6, cloudBase: 500, cloudDepth: 900, overcast: 0.92, layer: 1, layerBase: 600, layerTop: 2400,
    visibility: 2500, precipitation: 0.7, precipType: 'snow', windSpeed: 6, gust: 4, turbulence: 0.15, lightning: 0, tempOffset: -22, fog: 0.4,
  },
};

const NUMERIC = ['cloudCover', 'cloudBase', 'cloudDepth', 'overcast', 'layer', 'layerBase', 'layerTop', 'visibility', 'precipitation', 'windSpeed', 'gust', 'turbulence', 'lightning', 'tempOffset', 'fog'];

// Plausible next weather from the current one (dynamic weather Markov chain)
const NEXT = {
  clear: ['clear', 'fewClouds', 'fewClouds', 'scattered'],
  fewClouds: ['clear', 'fewClouds', 'scattered', 'scattered'],
  scattered: ['fewClouds', 'scattered', 'broken', 'broken'],
  broken: ['scattered', 'broken', 'overcast', 'rain'],
  overcast: ['broken', 'overcast', 'rain', 'fog'],
  rain: ['overcast', 'rain', 'thunderstorm', 'broken'],
  thunderstorm: ['rain', 'rain', 'overcast'],
  fog: ['overcast', 'scattered', 'fewClouds'],
  snow: ['snow', 'overcast', 'broken'],
};

export class Weather {
  constructor() {
    this.preset = 'fewClouds';
    this.state = { ...WEATHER_PRESETS.fewClouds, windDir: 250, storms: [], seed: 1 };
    this.from = null;
    this.to = null;
    this.t = 1;
    this.duration = 1;
    this.dynamic = false;
    this.nextChange = 900;
    this.rand = mulberry32(Date.now() & 0xffff);
    this.windDirTarget = 250;
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  // Instantly set a preset (with optional overrides)
  set(name, overrides = {}, center = null) {
    const p = WEATHER_PRESETS[name] || WEATHER_PRESETS.clear;
    this.preset = name;
    Object.assign(this.state, p, overrides);
    this.state.windDir = overrides.windDir ?? this.state.windDir;
    this.windDirTarget = this.state.windDir;
    this.from = null;
    this.t = 1;
    this.placeStorms(center);
    this.state.seed = Math.floor(this.rand() * 100000);
    for (const f of this.listeners) f(this.state);
  }

  // Smoothly transition to another preset over `seconds`.
  transitionTo(name, seconds = 180, center = null) {
    const p = WEATHER_PRESETS[name];
    if (!p) return;
    this.from = {};
    for (const k of NUMERIC) this.from[k] = this.state[k];
    this.to = p;
    this.t = 0;
    this.duration = seconds;
    this.preset = name;
    this.state.precipType = p.precipType;
    if (p.lightning > 0) this.placeStorms(center);
  }

  placeStorms(center) {
    const s = this.state;
    s.storms = [];
    if (!(s.lightning > 0)) return;
    const cx = center ? center.x : 0,
      cz = center ? center.z : 0;
    const r = mulberry32((Date.now() & 0xfff) + 7);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = 6000 + r() * 30000;
      s.storms.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, r: 2500 + r() * 2500, intensity: 0.6 + r() * 0.4, top: 9000 + r() * 4000, vx: 4, vz: 2 });
    }
  }

  setWind(dir, speed, gust = null) {
    this.state.windDir = dir;
    this.windDirTarget = dir;
    this.state.windSpeed = speed;
    if (gust !== null) this.state.gust = gust;
  }

  update(dt, focus) {
    const s = this.state;
    if (this.from && this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = this.t * this.t * (3 - 2 * this.t);
      for (const key of NUMERIC) s[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
      if (this.t >= 1) this.from = null;
    }
    if (this.dynamic) {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        const opts = NEXT[this.preset] || ['clear'];
        const next = opts[Math.floor(this.rand() * opts.length)];
        this.nextChange = 600 + this.rand() * 900;
        if (next !== this.preset) this.transitionTo(next, 240, focus);
        this.windDirTarget = (s.windDir + (this.rand() - 0.5) * 60 + 360) % 360;
      }
      // slowly veer the wind
      let d = ((this.windDirTarget - s.windDir + 540) % 360) - 180;
      s.windDir = (s.windDir + Math.sign(d) * Math.min(Math.abs(d), dt * 0.05) + 360) % 360;
    }
    // Storm cells drift with the wind
    const wr = ((s.windDir + 180) * Math.PI) / 180;
    for (const st of s.storms) {
      st.x += Math.sin(wr) * s.windSpeed * 0.5 * dt;
      st.z += -Math.cos(wr) * s.windSpeed * 0.5 * dt;
    }
    // Keep storms around the player: respawn ones that drift far away
    if (focus && s.storms.length) {
      for (const st of s.storms) {
        if (Math.hypot(st.x - focus.x, st.z - focus.z) > 60000) {
          const a = this.rand() * Math.PI * 2;
          st.x = focus.x + Math.cos(a) * 30000;
          st.z = focus.z + Math.sin(a) * 30000;
        }
      }
    }
  }

  // Description for ATIS/briefings
  metar(stationName = 'AXMI') {
    const s = this.state;
    const wd = Math.round(s.windDir / 10) * 10;
    const ws = Math.round(s.windSpeed * 1.944);
    const gust = s.gust > 2 ? `G${Math.round((s.windSpeed + s.gust) * 1.944)}` : '';
    const vis = s.visibility >= 9999 ? '9999' : String(Math.round(s.visibility / 100) * 100).padStart(4, '0');
    let wx = '';
    if (s.precipitation > 0.1) wx = s.precipType === 'snow' ? ' SN' : s.lightning > 0.5 ? ' +TSRA' : s.precipitation > 0.6 ? ' +RA' : ' RA';
    if (s.fog > 0.6) wx += ' FG';
    const ft = (m) => String(Math.round(m / 30.48)).padStart(3, '0');
    let clouds = '';
    if (s.layer > 0.6) clouds = `OVC${ft(s.layerBase)}`;
    else if (s.cloudCover > 0.6) clouds = `BKN${ft(s.cloudBase)}`;
    else if (s.cloudCover > 0.3) clouds = `SCT${ft(s.cloudBase)}`;
    else if (s.cloudCover > 0.1) clouds = `FEW${ft(s.cloudBase)}`;
    else clouds = 'SKC';
    if (s.lightning > 0.5) clouds += ` ${'BKN'}${ft(s.cloudBase)}CB`;
    const t = Math.round(15 + s.tempOffset);
    return `${stationName} ${String(wd).padStart(3, '0')}${String(ws).padStart(2, '0')}${gust}KT ${vis}${wx} ${clouds} ${t < 0 ? 'M' + String(-t).padStart(2, '0') : String(t).padStart(2, '0')}/${String(Math.max(-30, t - 4)).padStart(2, '0')} Q1013`;
  }
}
