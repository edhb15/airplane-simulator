// Interactive 3D cockpits (glass airliner, general aviation, fighter).
// Built procedurally in aircraft body coordinates around the pilot eye point.
// Controls are meshes with userData.control = { id, label, kind, state(), act(dir) }.

import * as THREE from 'three';
import { drawPFD, drawND, drawEngines, drawSystems, drawFCU, drawSixPack, drawGAEngine, drawFighterHUD, drawRadarMFD } from './Instruments.js';
import { KT, FT, FPM } from '../physics/atmosphere.js';

const DEG = Math.PI / 180;

function mat(color, opts = {}) {
  // Interior surfaces receive little sky light: keep the environment contribution low
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.15, envMapIntensity: 0.45, ...opts });
}

class Display {
  constructor(w, h, draw, rate = 20) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw = draw;
    this.interval = 1 / rate;
    this.t = Math.random() * this.interval;
  }
  update(dt, data, force = false) {
    this.t -= dt;
    if (this.t > 0 && !force) return;
    this.t = this.interval;
    this.draw(this.ctx, this.canvas.width, this.canvas.height, data);
    this.texture.needsUpdate = true;
  }
}

export class Cockpit {
  constructor(player) {
    this.player = player;
    this.sim = player.sim;
    this.spec = player.spec;
    this.type = this.spec.cockpit;
    this.group = new THREE.Group();
    this.group.name = 'cockpit';
    this.interactive = [];
    this.displays = [];
    this.animated = [];
    this.hovering = null;
    this.ndRange = 20;
    this.mats = {
      panel: mat(0x2c3036, { roughness: 0.85 }),
      panelLight: mat(0x3a3f46, { roughness: 0.8 }),
      dark: mat(0x15171a, { roughness: 0.9 }),
      frame: mat(0x41464d, { roughness: 0.6, metalness: 0.3 }),
      knob: mat(0x1b1c1e, { roughness: 0.4, metalness: 0.2 }),
      metal: mat(0xb8bcc2, { roughness: 0.3, metalness: 0.9 }),
      seat: mat(0x2e3440, { roughness: 0.95 }),
      seatFabric: mat(0x3b4a63, { roughness: 1 }),
      white: mat(0xe5e5e5, { roughness: 0.6 }),
      floor: mat(0x25282c, { roughness: 1 }),
      wall: mat(0xbfc3c7, { roughness: 0.9 }),
      wallDark: mat(0x59616b, { roughness: 0.9 }),
      gaPanel: mat(0x1d1f22, { roughness: 0.7 }),
      gaInterior: mat(0x8c8577, { roughness: 0.95 }),
      fighterPanel: mat(0x3b4045, { roughness: 0.85 }),
    };
    this.btnMats = new Map();
    this.flood = new THREE.PointLight(0xffd9a8, 0, 3.5, 1.5);
    const E = this.spec.eye;
    this.origin = new THREE.Vector3(0, E[1], E[2]);
    this.group.position.copy(this.origin);
    this.flood.position.set(0, 0.45, 0.2);
    this.group.add(this.flood);
    if (this.type === 'ga') this.buildGA();
    else if (this.type === 'fighter') this.buildFighter();
    else this.buildAirliner();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0.02;
    this.raycaster.far = 3;
  }

  // ---------------------------------------------------------------- helpers
  box(w, h, d, material, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  displayMesh(display, w, h, x, y, z, rx = 0, ry = 0, parent = this.group) {
    const bezel = this.box(w + 0.025, h + 0.025, 0.02, this.mats.dark, x, y, z, rx, ry, 0, parent);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }));
    screen.position.set(0, 0, 0.0105);
    bezel.add(screen);
    this.displays.push(display);
    return bezel;
  }

  // Register an interactive control mesh
  control(mesh, def) {
    mesh.userData.control = def;
    this.interactive.push(mesh);
    return mesh;
  }

  toggleSwitch(parent, x, y, z, label, get, set, opts = {}) {
    const base = this.box(0.03, 0.03, 0.01, this.mats.dark, x, y, z, 0, 0, 0, parent);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.03, 6), this.mats.metal);
    lever.position.set(0, 0, 0.012);
    lever.rotation.x = Math.PI / 2;
    base.add(lever);
    const hit = this.box(0.05, 0.06, 0.04, new THREE.MeshBasicMaterial({ visible: false }), 0, 0, 0.015, 0, 0, 0, base);
    this.control(hit, { label, kind: 'toggle', state: () => (get() ? 'ON' : 'OFF'), act: () => set(!get()) });
    this.animated.push(() => {
      lever.rotation.x = Math.PI / 2 + (get() ? -0.5 : 0.5);
      lever.position.y = get() ? 0.006 : -0.006;
    });
    if (opts.caption) this.caption(parent, opts.caption, x, y - 0.03, z + 0.006, 0.07);
    return base;
  }

  // Lit push button (e.g. AP1, A/THR, LOC)
  button(parent, x, y, z, w, h, label, isOn, act, color = 0x3cff4a, caption = null) {
    const key = color;
    if (!this.btnMats.has(key)) this.btnMats.set(key, { on: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(color), emissiveIntensity: 1.4 }), off: mat(0x2a2c2f, { roughness: 0.5 }) });
    const bm = this.btnMats.get(key);
    const b = this.box(w, h, 0.012, bm.off, x, y, z, 0, 0, 0, parent);
    this.control(b, { label, kind: 'button', state: () => (isOn() ? 'ON' : 'OFF'), act });
    this.animated.push(() => {
      b.material = isOn() ? bm.on : bm.off;
    });
    if (caption) this.caption(parent, caption, x, y + h / 2 + 0.012, z + 0.007, Math.max(0.05, w * 1.2));
    return b;
  }

  knob(parent, x, y, z, r, label, value, change, push = null) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.02, 16), this.mats.knob);
    k.rotation.x = Math.PI / 2;
    k.position.set(x, y, z + 0.01);
    parent.add(k);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 1.6, 0.004), this.mats.white);
    cap.position.set(0, 0.0105, 0);
    cap.rotation.x = -Math.PI / 2;
    k.add(cap);
    this.control(k, { label, kind: 'knob', state: value, act: (dir, shift) => (dir === 0 ? push && push() : change(dir, shift)) });
    let angle = 0;
    this.animated.push(() => {
      k.rotation.y = angle;
    });
    const orig = k.userData.control.act;
    k.userData.control.act = (dir, shift) => {
      angle -= dir * 0.2;
      orig(dir, shift);
    };
    return k;
  }

  caption(parent, txt, x, y, z, w = 0.08) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#d8d8d8';
    g.font = '600 18px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 64, 17);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // A lever moving between detents along a slot (local y axis)
  lever(parent, x, y, z, travel, label, getFrac, act, handleColor = 0xd8d8d8, handleSize = [0.05, 0.022, 0.03]) {
    const slot = this.box(0.012, travel + 0.03, 0.005, this.mats.dark, x, y, z, 0, 0, 0, parent);
    const arm = new THREE.Group();
    arm.position.set(x, y, z);
    parent.add(arm);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), this.mats.metal);
    stem.position.z = 0.035;
    arm.add(stem);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(...handleSize), mat(handleColor, { roughness: 0.4 }));
    handle.position.z = 0.075;
    arm.add(handle);
    this.control(handle, { label, kind: 'lever', state: () => '', act });
    this.animated.push(() => {
      arm.position.y = y + travel / 2 - travel * getFrac();
    });
    void slot;
    return arm;
  }

  // ---------------------------------------------------------------- airliner
  buildAirliner() {
    const M = this.mats;
    const sim = this.sim;
    const ap = sim.ap;
    const spec = this.spec;
    const ex = spec.eye[0]; // captain eye x (negative)
    const g = this.group;
    const wide = Math.abs(ex) * 2 + 0.4; // cockpit width-ish

    // Structure (all positions relative to the captain's eye height / station)
    const sideX = Math.abs(ex) + 0.55; // side wall / side window plane
    const postX = Math.abs(ex) + 0.4; // front windshield corner posts
    this.box(sideX * 2, 0.02, 2.4, M.floor, 0, -1.05, 0.2);
    for (const sx of [-1, 1]) {
      // Side wall below the side windows and side console
      this.box(0.05, 0.85, 1.9, M.wallDark, sx * sideX, -0.65, 0.15);
      this.box(0.22, 0.05, 1.3, M.panel, sx * (sideX - 0.12), -0.56, 0.05);
    }
    this.box(sideX * 2, 1.6, 0.05, M.wallDark, 0, -0.2, 1.3);
    // Main instrument panel, recessed under the glareshield and tilted towards the pilots
    const panel = new THREE.Group();
    panel.position.set(0, -0.52, -0.8);
    panel.rotation.x = -0.15;
    g.add(panel);
    this.box(wide + 0.55, 0.56, 0.04, M.panel, 0, 0, -0.02, 0, 0, 0, panel);
    // Glareshield hood (top ~0.2 m below eye level: ~15 deg over-the-nose view)
    this.box(postX * 2 + 0.05, 0.04, 0.24, M.dark, 0, -0.22, -0.67);
    this.box(postX * 2 + 0.05, 0.08, 0.02, M.panel, 0, -0.24, -0.555);
    // Windshield frame: sill, centre post, corner posts, header, side window frames
    const postM = M.frame;
    const baseY = -0.24,
      baseZ = -0.8,
      topY = 0.4,
      topZ = -0.46;
    const postLen = Math.hypot(topY - baseY, topZ - baseZ);
    const postTilt = Math.atan2(topZ - baseZ, topY - baseY);
    this.box(postX * 2 + 0.1, 0.05, 0.08, postM, 0, baseY, baseZ);
    this.box(0.06, postLen, 0.05, postM, 0, (baseY + topY) / 2, (baseZ + topZ) / 2, postTilt);
    this.box(postX * 2 + 0.1, 0.06, 0.08, postM, 0, topY, topZ);
    for (const sx of [-1, 1]) {
      this.box(0.09, postLen, 0.06, postM, sx * postX, (baseY + topY) / 2, (baseZ + topZ) / 2, postTilt, 0, sx * 0.06);
      // side windows: sill, top rail and the post between the sliding and fixed windows
      this.box(0.05, 0.05, 1.0, postM, sx * sideX, baseY + 0.02, -0.3);
      this.box(0.05, 0.05, 1.0, postM, sx * (sideX - 0.06), topY - 0.04, -0.15);
      this.box(0.05, 0.62, 0.07, postM, sx * sideX, 0.08, 0.2, 0.12);
      this.box(0.04, 0.9, 0.05, postM, sx * sideX, -0.15 + 0.35, 0.55);
      // Fill between the corner post and the side window
      this.box(Math.abs(sideX - postX) + 0.05, 0.05, 0.36, postM, sx * (postX + sideX) / 2, baseY, -0.66, 0, sx * 0.35, 0);
    }
    // Roof
    this.box(sideX * 2, 0.04, 1.9, M.wallDark, 0, topY + 0.2, 0.45);
    // Displays
    const data = () => this.player.flightData;
    const pfd = new Display(512, 512, (c, w, h) => drawPFD(c, w, h, data()), 24);
    const nd = new Display(512, 512, (c, w, h) => drawND(c, w, h, data(), { range: this.ndRange }), 12);
    const eng = new Display(512, 512, (c, w, h) => drawEngines(c, w, h, data()), 10);
    const sys = new Display(512, 512, (c, w, h) => drawSystems(c, w, h, data()), 6);
    const ds = 0.2;
    const dx = Math.max(0.24, Math.abs(ex) * 0.5);
    this.displayMesh(pfd, ds, ds, -dx - 0.24, 0.0, 0.005, 0, 0, panel);
    this.displayMesh(nd, ds, ds, -dx + 0.0, 0.0, 0.005, 0, 0, panel);
    this.displayMesh(eng, ds, ds, 0, 0.02, 0.005, 0, 0, panel);
    this.displayMesh(nd, ds, ds, dx - 0.0, 0.0, 0.005, 0, 0, panel);
    this.displayMesh(pfd, ds, ds, dx + 0.24, 0.0, 0.005, 0, 0, panel);
    // Standby + gear lever area on the panel
    const gearArm = this.lever(panel, dx * 0.5 + 0.08, -0.19, 0.0, 0.1, 'Landing gear lever', () => (sim.gearLever ? 1 : 0), () => sim.toggleGear(), 0xdddddd, [0.035, 0.035, 0.035]);
    void gearArm;
    this.caption(panel, 'GEAR', dx * 0.5 + 0.08, -0.265, 0.01, 0.06);
    // Gear position lights
    const gearLight = (ox, oy) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), new THREE.MeshBasicMaterial({ color: 0x113311 }));
      m.position.set(dx * 0.5 + 0.14 + ox, -0.17 + oy, 0.003);
      panel.add(m);
      this.animated.push(() => {
        const p = sim.gearPos;
        m.material.color.setHex(p > 0.99 ? 0x33ff44 : p > 0.01 ? 0xff2a1a : 0x112211);
      });
    };
    gearLight(0, 0.03);
    gearLight(-0.02, 0);
    gearLight(0.02, 0);
    // Autobrake buttons
    this.button(panel, -0.05, -0.2, 0.005, 0.03, 0.018, 'Autobrake', () => sim.autobrake !== 'OFF', () => sim.cycleAutobrake(), 0x3cff4a, 'A/BRK');

    // Master warning / caution lights on glareshield
    const mw = this.button(this.group, -0.42, -0.25, -0.54, 0.05, 0.03, 'Master warning (silence)', () => sim.masterWarning && Math.floor(performance.now() / 400) % 2 === 0, () => (this.player.silenced = true), 0xff2020);
    const mc = this.button(this.group, -0.36, -0.25, -0.54, 0.05, 0.03, 'Master caution (silence)', () => sim.masterCaution && !sim.masterWarning, () => (this.player.silenced = true), 0xffb000);
    void mw;
    void mc;

    // FCU (autopilot panel) on the glareshield face
    const fcu = new THREE.Group();
    fcu.position.set(0.02, -0.24, -0.543);
    g.add(fcu);
    this.box(0.62, 0.08, 0.012, M.panelLight, 0, 0, -0.006, 0, 0, 0, fcu);
    const fcuDisp = new Display(512, 64, (c, w, h) => drawFCU(c, w, h, data()), 10);
    const fd = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.0625), new THREE.MeshBasicMaterial({ map: fcuDisp.texture, toneMapped: false }));
    fd.position.set(0, 0.018, 0.001);
    fcu.add(fd);
    this.displays.push(fcuDisp);
    const ky = -0.022;
    this.knob(fcu, -0.2, ky, 0, 0.012, 'Speed knob (scroll)', () => `${ap.spd} kt`, (d, sh) => (ap.spd = Math.max(80, Math.min(400, ap.spd - d * (sh ? 10 : 1)))));
    this.knob(fcu, -0.1, ky, 0, 0.012, 'Heading knob (scroll, click = HDG)', () => `${ap.hdg}°`, (d, sh) => (ap.hdg = (ap.hdg - d * (sh ? 10 : 1) + 360) % 360), () => ap.modeHDG());
    this.knob(fcu, 0.03, ky, 0, 0.013, 'Altitude knob (scroll, click = level change)', () => `${ap.alt} ft`, (d, sh) => (ap.alt = Math.max(0, Math.min(45000, ap.alt - d * (sh ? 1000 : 100)))), () => ap.modeFLCH());
    this.knob(fcu, 0.17, ky, 0, 0.011, 'Vertical speed (scroll, click = V/S)', () => `${ap.vs} fpm`, (d, sh) => {
      if (ap.vert !== 'VS') ap.modeVS(0);
      ap.vs = Math.max(-6000, Math.min(6000, ap.vs - d * (sh ? 500 : 100)));
    }, () => ap.modeVS());
    const bw = 0.034,
      bh = 0.016;
    const by = -0.033;
    this.button(fcu, -0.27, by + 0.01, 0, bw, bh, 'Autopilot master', () => ap.engaged, () => this.player.toggleAP(), 0x3cff4a, 'AP1');
    this.button(fcu, 0.27, by + 0.01, 0, bw, bh, 'Autothrust', () => ap.athr, () => this.player.toggleATHR(), 0x3cff4a, 'A/THR');
    this.button(fcu, -0.05, by, 0, bw, bh, 'Lateral NAV', () => ap.lat === 'NAV', () => ap.modeNAV(), 0x3cff4a, 'NAV');
    this.button(fcu, 0.1, by, 0, bw, bh, 'Altitude hold', () => ap.vert === 'ALT', () => ap.modeALT(), 0x3cff4a, 'ALT');
    this.button(fcu, 0.23, by, 0, bw, bh, 'Approach (LOC + G/S)', () => ap.latArmed === 'LOC' || ap.lat === 'LOC', () => this.player.armApproach(), 0x3cff4a, 'APPR');
    this.button(fcu, -0.17, by, 0, bw, bh, 'Flight director', () => ap.fd, () => (ap.fd = !ap.fd), 0x3cff4a, 'FD');
    this.button(fcu, -0.32, ky, 0, 0.03, 0.016, 'ND range +', () => false, () => (this.ndRange = Math.min(160, this.ndRange * 2)), 0x2fe6ff, 'RNG+');
    this.button(fcu, -0.32, ky + 0.035, 0, 0.03, 0.016, 'ND range -', () => false, () => (this.ndRange = Math.max(5, this.ndRange / 2)), 0x2fe6ff, 'RNG-');

    // Pedestal with thrust levers, flaps, speedbrake, parking brake, engine masters, lower display
    const ped = new THREE.Group();
    ped.position.set(0, -0.62, -0.38);
    g.add(ped);
    this.box(0.36, 0.22, 0.75, M.panel, 0, -0.1, 0.05, 0, 0, 0, ped);
    this.displayMesh(sys, 0.17, 0.17, 0, 0.1, -0.33, -0.7, 0, ped);
    const top = new THREE.Group();
    top.position.set(0, 0.012, 0.02);
    top.rotation.x = -Math.PI / 2;
    ped.add(top);
    const ne = sim.engines.length;
    for (let i = 0; i < ne; i++) {
      const lx = -0.06 + (ne > 1 ? (i / (ne - 1)) * 0.12 : 0.06);
      this.lever(top, lx, 0.05, 0.0, 0.16, `Thrust lever ${i + 1} (scroll)`, () => 1 - sim.throttleLever, (d) => (sim.throttleLever = Math.max(0, Math.min(1, sim.throttleLever - (d || 1) * 0.05))), 0x2a2a2a, [0.03, 0.024, 0.035]);
    }
    this.lever(top, 0.13, 0.05, 0.0, 0.16, 'Flap lever (click/scroll)', () => sim.flapsIndex / (spec.flaps.length - 1), (d) => (d < 0 ? sim.flapsUp() : sim.flapsDown()), 0xe8e8e8, [0.04, 0.02, 0.025]);
    this.caption(top, 'FLAPS', 0.13, -0.05, 0.005, 0.06);
    this.lever(top, -0.13, 0.05, 0.0, 0.16, 'Speed brake (click/scroll)', () => (sim.spoilersArmed ? 0.05 : sim.spoilerLever), (d) => (d < 0 ? (sim.spoilerLever = 0, (sim.spoilersArmed = false)) : sim.toggleSpoilers()), 0x777777, [0.035, 0.018, 0.025]);
    this.caption(top, 'SPD BRK', -0.13, -0.05, 0.005, 0.06);
    // Engine master switches
    for (let i = 0; i < ne; i++) {
      const sx = -0.08 + (ne > 1 ? (i / (ne - 1)) * 0.16 : 0.08);
      const e = sim.engines[i];
      this.toggleSwitch(top, sx, -0.12, 0.0, `Engine ${i + 1} master / start`, () => e.running || e.starting, (on) => (on ? sim.startEngine(i) : sim.stopEngine(i)), { caption: `ENG ${i + 1}` });
    }
    this.button(top, 0, -0.2, 0.0, 0.05, 0.02, 'Parking brake', () => sim.parkingBrake, () => sim.toggleParkingBrake(), 0xffb000, 'PARK BRK');

    // Overhead panel
    const oh = new THREE.Group();
    oh.position.set(0, 0.52, -0.05);
    oh.rotation.x = Math.PI / 2 + 0.3;
    g.add(oh);
    this.box(wide + 0.1, 0.7, 0.04, M.panel, 0, 0, -0.02, 0, 0, 0, oh);
    const sw = sim.switches;
    const rowA = [
      ['battery', 'BAT'],
      ['avionics', 'AVIONICS'],
      ['fuelPumps', 'FUEL PUMPS'],
      ['apu', 'APU'],
      ['antiIce', 'ANTI-ICE'],
      ['pitotHeat', 'PROBE HEAT'],
    ];
    const rowB = [
      ['beacon', 'BEACON'],
      ['navLights', 'NAV'],
      ['strobeLights', 'STROBE'],
      ['landingLights', 'LAND'],
      ['taxiLights', 'TAXI'],
      ['logoLights', 'LOGO'],
      ['seatbelts', 'SEAT BELTS'],
      ['cabinLights', 'CABIN'],
    ];
    rowA.forEach(([k, label], i) => this.toggleSwitch(oh, -0.25 + i * 0.1, 0.2, 0.002, label, () => sw[k], (v) => sim.setSwitch(k, v), { caption: label }));
    rowB.forEach(([k, label], i) => this.toggleSwitch(oh, -0.3 + i * 0.085, 0.02, 0.002, label, () => sw[k], (v) => sim.setSwitch(k, v), { caption: label }));
    this.toggleSwitch(oh, -0.25, -0.16, 0.002, 'Alternate gear extension', () => sw.altGear, (v) => sim.setSwitch('altGear', v), { caption: 'ALT GEAR' });
    for (let i = 0; i < ne; i++) {
      const fx = -0.05 + i * 0.09;
      this.button(oh, fx, -0.16, 0.002, 0.06, 0.025, `Engine ${i + 1} fire handle (discharge)`, () => sim.engines[i].fire, () => sim.extinguish(i), 0xff2020, `FIRE ${i + 1}`);
    }

    // Side sticks or yokes
    if (spec.fcs.law === 'fbw') {
      for (const sx of [-1, 1]) {
        const st = new THREE.Group();
        st.position.set(sx * (Math.abs(ex) + 0.42), -0.55, -0.15);
        g.add(st);
        this.box(0.14, 0.06, 0.32, M.panel, 0, -0.05, 0, 0, 0, 0, st);
        const stick = new THREE.Group();
        st.add(stick);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.11, 10), M.dark);
        grip.position.y = 0.06;
        stick.add(grip);
        this.animated.push(() => {
          stick.rotation.x = -this.player.inputs.pitch * 0.3;
          stick.rotation.z = -this.player.inputs.roll * 0.3;
        });
      }
    } else {
      for (const sx of [-1, 1]) {
        const yokeG = new THREE.Group();
        yokeG.position.set(sx * Math.abs(ex), -0.52, -0.5);
        g.add(yokeG);
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), M.panel);
        col.position.y = -0.25;
        yokeG.add(col);
        const wheel = new THREE.Group();
        yokeG.add(wheel);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.03), M.dark);
        wheel.add(bar);
        for (const hx of [-1, 1]) {
          const h = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.035), M.dark);
          h.position.set(hx * 0.15, 0.04, 0);
          wheel.add(h);
        }
        this.animated.push(() => {
          wheel.rotation.z = -this.player.inputs.roll * 0.7;
          yokeG.position.z = -0.5 + this.player.inputs.pitch * 0.07;
          yokeG.position.y = -0.52;
        });
      }
    }
    // Seats
    for (const sx of [-1, 1]) {
      const seat = new THREE.Group();
      seat.position.set(sx * Math.abs(ex), -0.95, 0.42);
      g.add(seat);
      this.box(0.5, 0.12, 0.5, M.seatFabric, 0, 0.18, 0, 0, 0, 0, seat);
      this.box(0.5, 0.8, 0.12, M.seatFabric, 0, 0.6, 0.27, 0.12, 0, 0, seat);
      this.box(0.08, 0.06, 0.4, M.seat, -0.26, 0.38, 0, 0, 0, 0, seat);
      this.box(0.08, 0.06, 0.4, M.seat, 0.26, 0.38, 0, 0, 0, 0, seat);
    }
  }

  // ---------------------------------------------------------------- general aviation
  buildGA() {
    const M = this.mats;
    const sim = this.sim;
    const ap = sim.ap;
    const g = this.group;
    const ex = this.spec.eye[0];
    // Shell
    this.box(1.3, 0.02, 1.8, M.gaInterior, 0, -0.95, 0.2);
    for (const sx of [-1, 1]) {
      this.box(0.04, 0.55, 1.6, M.gaInterior, sx * 0.58, -0.68, 0.2);
      this.box(0.06, 0.6, 0.06, M.gaInterior, sx * 0.56, 0.05, -0.62, -0.45);
      this.box(0.05, 0.05, 1.3, M.gaInterior, sx * 0.56, 0.32, 0.0);
      this.box(0.05, 0.75, 0.06, M.gaInterior, sx * 0.57, -0.08, 0.32);
    }
    this.box(1.2, 0.06, 1.5, M.gaInterior, 0, 0.36, 0.1);
    this.box(1.2, 0.06, 0.08, M.gaInterior, 0, 0.3, -0.58, 0.4);
    // Panel
    const panel = new THREE.Group();
    panel.position.set(0, -0.35, -0.72);
    panel.rotation.x = -0.08;
    g.add(panel);
    this.box(1.12, 0.46, 0.05, M.gaPanel, 0, 0, -0.025, 0, 0, 0, panel);
    this.box(1.16, 0.06, 0.18, M.gaPanel, 0, 0.24, 0.05, 0, 0, 0, panel);
    const data = () => this.player.flightData;
    const six = new Display(1024, 512, (c, w, h) => drawSixPack(c, w, h, data()), 20);
    const engD = new Display(512, 256, (c, w, h) => drawGAEngine(c, w, h, data()), 8);
    this.displayMesh(six, 0.48, 0.24, ex + 0.02, 0.05, 0.003, 0, 0, panel);
    this.displayMesh(engD, 0.4, 0.2, 0.3, 0.06, 0.003, 0, 0, panel);
    // Switch row
    const sw = sim.switches;
    const row = [
      ['battery', 'MASTER'],
      ['avionics', 'AVIONICS'],
      ['fuelPumps', 'FUEL PUMP'],
      ['beacon', 'BCN'],
      ['landingLights', 'LAND'],
      ['taxiLights', 'TAXI'],
      ['navLights', 'NAV'],
      ['strobeLights', 'STROBE'],
      ['pitotHeat', 'PITOT'],
    ];
    row.forEach(([k, label], i) => this.toggleSwitch(panel, -0.5 + i * 0.065, -0.17, 0.003, label, () => sw[k], (v) => sim.setSwitch(k, v), { caption: label }));
    // Magneto / starter key
    this.button(panel, 0.2, -0.17, 0.003, 0.04, 0.03, 'Ignition / starter', () => sim.engines[0].running || sim.engines[0].starting, () => (sim.engines[0].running ? sim.stopEngine(0) : sim.startEngine(0)), 0xffb000, 'START');
    // Autopilot buttons
    const apy = 0.19;
    this.button(panel, 0.16, apy, 0.003, 0.035, 0.018, 'Autopilot', () => ap.engaged, () => this.player.toggleAP(), 0x3cff4a, 'AP');
    this.button(panel, 0.21, apy, 0.003, 0.035, 0.018, 'Heading mode', () => ap.engaged && ap.lat === 'HDG', () => ap.modeHDG(), 0x3cff4a, 'HDG');
    this.button(panel, 0.26, apy, 0.003, 0.035, 0.018, 'GPS navigation', () => ap.engaged && ap.lat === 'NAV', () => ap.modeNAV(), 0x3cff4a, 'NAV');
    this.button(panel, 0.31, apy, 0.003, 0.035, 0.018, 'Altitude hold', () => ap.engaged && ap.vert === 'ALT', () => ap.modeALT(), 0x3cff4a, 'ALT');
    this.button(panel, 0.36, apy, 0.003, 0.035, 0.018, 'Vertical speed', () => ap.engaged && ap.vert === 'VS', () => ap.modeVS(), 0x3cff4a, 'VS');
    this.button(panel, 0.41, apy, 0.003, 0.035, 0.018, 'Approach', () => ap.latArmed === 'LOC' || ap.lat === 'LOC', () => this.player.armApproach(), 0x3cff4a, 'APR');
    this.knob(panel, 0.48, apy, 0.003, 0.012, 'Heading bug', () => `${ap.hdg}°`, (d, sh) => (ap.hdg = (ap.hdg - d * (sh ? 10 : 1) + 360) % 360));
    this.knob(panel, 0.48, apy - 0.05, 0.003, 0.012, 'Altitude select', () => `${ap.alt} ft`, (d, sh) => (ap.alt = Math.max(0, ap.alt - d * (sh ? 1000 : 100))));
    // Throttle (push-pull)
    const thr = new THREE.Group();
    thr.position.set(0.05, -0.12, 0.0);
    panel.add(thr);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), M.metal);
    shaft.rotation.x = Math.PI / 2;
    thr.add(shaft);
    const knobT = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14), M.dark);
    knobT.rotation.x = Math.PI / 2;
    thr.add(knobT);
    this.control(knobT, { label: 'Throttle (scroll)', kind: 'lever', state: () => `${Math.round(sim.throttleLever * 100)}%`, act: (d) => (sim.throttleLever = Math.max(0, Math.min(1, sim.throttleLever - (d || 1) * 0.05))) });
    this.animated.push(() => {
      thr.position.z = 0.1 - sim.throttleLever * 0.09;
    });
    // Mixture knob (red)
    const mix = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 14), mat(0xb3261e, { roughness: 0.5 }));
    mix.rotation.x = Math.PI / 2;
    mix.position.set(0.11, -0.12, 0.03);
    panel.add(mix);
    this.control(mix, { label: 'Mixture (click = idle cutoff)', kind: 'lever', state: () => (sim.engines[0].mixture > 0.5 ? 'RICH' : 'CUTOFF'), act: () => (sim.engines[0].mixture = sim.engines[0].mixture > 0.5 ? 0 : 1) });
    // Flap switch
    this.lever(panel, 0.4, -0.12, 0.003, 0.08, 'Flaps (click/scroll)', () => sim.flapsIndex / (this.spec.flaps.length - 1), (d) => (d < 0 ? sim.flapsUp() : sim.flapsDown()), 0xffffff, [0.03, 0.015, 0.02]);
    this.caption(panel, 'FLAPS', 0.4, -0.2, 0.004, 0.05);
    // Parking brake
    this.button(panel, -0.42, -0.21, 0.003, 0.04, 0.018, 'Parking brake', () => sim.parkingBrake, () => sim.toggleParkingBrake(), 0xffb000, 'PARK');
    // Yokes
    for (const sx of [-1, 1]) {
      const yokeG = new THREE.Group();
      yokeG.position.set(sx * Math.abs(ex), -0.38, -0.5);
      g.add(yokeG);
      const shaftY = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8), M.metal);
      shaftY.rotation.x = Math.PI / 2;
      shaftY.position.z = -0.12;
      yokeG.add(shaftY);
      const wheel = new THREE.Group();
      yokeG.add(wheel);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.03), M.dark);
      wheel.add(bar);
      for (const hx of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.035), M.dark);
        h.position.set(hx * 0.13, 0.03, 0);
        wheel.add(h);
      }
      this.animated.push(() => {
        wheel.rotation.z = -this.player.inputs.roll * 0.8;
        yokeG.position.z = -0.5 + this.player.inputs.pitch * 0.06;
      });
    }
    // Seats
    for (const sx of [-1, 1]) {
      const seat = new THREE.Group();
      seat.position.set(sx * Math.abs(ex), -0.92, 0.25);
      g.add(seat);
      this.box(0.45, 0.1, 0.45, M.seatFabric, 0, 0.12, 0, 0, 0, 0, seat);
      this.box(0.45, 0.65, 0.1, M.seatFabric, 0, 0.45, 0.24, 0.15, 0, 0, seat);
    }
  }

  // ---------------------------------------------------------------- fighter
  buildFighter() {
    const M = this.mats;
    const sim = this.sim;
    const ap = sim.ap;
    const g = this.group;
    // Tub
    this.box(0.9, 0.02, 1.6, M.dark, 0, -0.85, 0.3);
    for (const sx of [-1, 1]) {
      this.box(0.04, 0.3, 1.4, M.fighterPanel, sx * 0.42, -0.42, 0.2);
      // Side consoles
      this.box(0.16, 0.05, 0.9, M.fighterPanel, sx * 0.34, -0.35, 0.15);
    }
    // Front panel
    const panel = new THREE.Group();
    panel.position.set(0, -0.36, -0.62);
    panel.rotation.x = -0.25;
    g.add(panel);
    this.box(0.72, 0.42, 0.04, M.fighterPanel, 0, 0, -0.02, 0, 0, 0, panel);
    const data = () => this.player.flightData;
    const mfdL = new Display(512, 512, (c, w, h) => drawRadarMFD(c, w, h, data()), 10);
    const mfdR = new Display(512, 512, (c, w, h) => drawND(c, w, h, data(), { range: this.ndRange }), 8);
    this.displayMesh(mfdL, 0.17, 0.17, -0.2, 0.0, 0.003, 0, 0, panel);
    this.displayMesh(mfdR, 0.17, 0.17, 0.2, 0.0, 0.003, 0, 0, panel);
    // Glareshield + HUD frame
    this.box(0.56, 0.05, 0.2, M.dark, 0, -0.12, -0.6);
    this.box(0.2, 0.012, 0.12, M.dark, 0, -0.085, -0.55);
    const combiner = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.16), new THREE.MeshStandardMaterial({ color: 0x88ff99, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.4, depthWrite: false }));
    combiner.position.set(0, 0.0, -0.56);
    combiner.rotation.x = -0.3;
    g.add(combiner);
    // HUD image plane (approximately conformal at 1.6 m)
    const hud = new Display(512, 512, (c, w, h) => drawFighterHUD(c, w, h, data(), { ppd: h / 26 }), 30);
    this.displays.push(hud);
    const D = 1.6;
    const size = 2 * D * Math.tan(13 * DEG);
    const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: hud.texture, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    hudMesh.position.set(0, 0.0, -D);
    hudMesh.renderOrder = 50;
    g.add(hudMesh);
    this.hudMesh = hudMesh;
    // Up-front controls
    this.button(panel, -0.02, 0.17, 0.003, 0.04, 0.02, 'Autopilot', () => ap.engaged, () => this.player.toggleAP(), 0x3cff4a, 'AP');
    this.button(panel, 0.03, 0.17, 0.003, 0.04, 0.02, 'Altitude hold', () => ap.engaged && ap.vert === 'ALT', () => ap.modeALT(), 0x3cff4a, 'ALT');
    this.button(panel, -0.07, 0.17, 0.003, 0.04, 0.02, 'Heading hold', () => ap.engaged && ap.lat === 'HDG', () => ap.modeHDG(), 0x3cff4a, 'HDG');
    this.button(panel, 0.08, 0.17, 0.003, 0.04, 0.02, 'Steer to waypoint', () => ap.engaged && ap.lat === 'NAV', () => ap.modeNAV(), 0x3cff4a, 'STPT');
    // Gear handle and lights
    this.lever(panel, -0.33, -0.08, 0.003, 0.1, 'Landing gear handle', () => (sim.gearLever ? 1 : 0), () => sim.toggleGear(), 0xffffff, [0.03, 0.03, 0.03]);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(0.01, 12), new THREE.MeshBasicMaterial({ color: 0x113311 }));
    gl.position.set(-0.29, -0.02, 0.003);
    panel.add(gl);
    this.animated.push(() => gl.material.color.setHex(sim.gearPos > 0.99 ? 0x33ff44 : sim.gearPos > 0.01 ? 0xff2a1a : 0x112211));
    // Master caution
    this.button(panel, 0.31, 0.15, 0.003, 0.05, 0.03, 'Master caution', () => (sim.masterWarning || sim.masterCaution) && Math.floor(performance.now() / 400) % 2 === 0, () => (this.player.silenced = true), 0xffb000, 'CAUTION');
    // Side stick (right) and throttle (left)
    const st = new THREE.Group();
    st.position.set(0.34, -0.32, -0.05);
    g.add(st);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 10), M.dark);
    grip.position.y = 0.06;
    st.add(grip);
    this.animated.push(() => {
      st.rotation.x = -this.player.inputs.pitch * 0.2;
      st.rotation.z = -this.player.inputs.roll * 0.2;
    });
    const thr = new THREE.Group();
    thr.position.set(-0.34, -0.3, 0.05);
    g.add(thr);
    const tg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), M.dark);
    tg.position.y = 0.05;
    thr.add(tg);
    this.control(tg, { label: 'Throttle (scroll) — past 92% engages afterburner', kind: 'lever', state: () => `${Math.round(sim.throttleLever * 100)}%`, act: (d) => (sim.throttleLever = Math.max(0, Math.min(1, sim.throttleLever - (d || 1) * 0.04))) });
    this.animated.push(() => {
      thr.position.z = 0.12 - sim.throttleLever * 0.2;
    });
    // Console switches
    const sw = sim.switches;
    const left = [
      ['navLights', 'POS LT'],
      ['strobeLights', 'ANTI-COL'],
      ['landingLights', 'LDG LT'],
      ['battery', 'MAIN PWR'],
    ];
    left.forEach(([k, label], i) => {
      const tsw = this.toggleSwitch(g, -0.34, -0.32, 0.25 + i * 0.09, label, () => sw[k], (v) => sim.setSwitch(k, v), {});
      tsw.rotation.x = -Math.PI / 2;
    });
    const jfs = this.button(g, 0.34, -0.322, 0.3, 0.05, 0.03, 'Engine start (JFS)', () => sim.engines[0].running || sim.engines[0].starting, () => sim.autoStart(), 0xffb000);
    jfs.rotation.x = -Math.PI / 2;
    // Canopy frame bow
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 6, 24, Math.PI), M.dark);
    bow.position.set(0, -0.15, 0.25);
    bow.rotation.y = Math.PI / 2;
    bow.scale.set(1, 1.25, 1);
    bow.rotation.set(0, 0, 0);
    g.add(bow);
    // Seat headrest
    this.box(0.4, 0.5, 0.12, M.seat, 0, -0.05, 0.55);
  }

  // ---------------------------------------------------------------- runtime
  setVisible(v) {
    this.group.visible = v;
  }

  // Raycast from the camera through the mouse position
  pick(camera, nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: -ny }, camera);
    const hits = this.raycaster.intersectObjects(this.interactive, false);
    return hits.length ? hits[0].object : null;
  }

  update(dt, night, active) {
    for (const a of this.animated) a();
    this.flood.intensity = active ? night * 1.3 : 0;
    if (!active) return;
    const data = this.player.flightData;
    for (const d of this.displays) d.update(dt, data);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map) o.material.map.dispose();
    });
    for (const d of this.displays) d.texture.dispose();
  }
}
