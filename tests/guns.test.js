// Cannon ballistics: gunsight geometry, hits on targets, terrain impacts.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The tracer glow texture needs a DOM canvas; not relevant to ballistics
vi.mock('../src/render/GlowPoints.js', () => ({ glowTexture: () => null }));
const { BulletManager, gunsightSolution, OWNER_PLAYER, OWNER_REMOTE } = await import('../src/combat/Guns.js');
const { terrainHeight } = await import('../src/world/terrainGen.js');

const gun = { muzzle: 1050, elev: 1.0 };
const fx = () => {
  const count = { smoke: 0, fire: 0 };
  return { count, smoke: { emit: () => count.smoke++ }, fire: { emit: () => count.fire++ } };
};

function target(pos, radius = 4) {
  const t = { alive: true, radius, hits: [], getPosition: (out) => out.copy(pos), onHit: (dmg) => t.hits.push(dmg) };
  return t;
}

const run = (bm, targets, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) bm.update(dt, targets);
};

describe('gunsight', () => {
  it('places the pipper above the boresight by the gun elevation minus gravity drop', () => {
    const s = gunsightSolution(new THREE.Quaternion(), gun, 600);
    const t = 600 / 1050;
    const dropDeg = Math.atan2(0.5 * 9.81 * t * t, 600) * (180 / Math.PI);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.y).toBeCloseTo(-1.0 + dropDeg, 1); // negative = above the boresight
  });

  it('drops the other way when inverted', () => {
    const inverted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    const upright = gunsightSolution(new THREE.Quaternion(), gun, 600);
    const s = gunsightSolution(inverted, gun, 600);
    expect(s.y).toBeLessThan(upright.y); // gravity now pulls rounds "up" in body axes
  });
});

describe('rounds', () => {
  const high = new THREE.Vector3(0, 4500, 0); // above every peak: no terrain checks

  it('hit a target on their path once and are consumed', () => {
    const bm = new BulletManager(new THREE.Scene(), fx());
    const tgt = target(new THREE.Vector3(1, 4500, -800));
    bm.fire(high, new THREE.Vector3(0, 0, -1000), OWNER_PLAYER, 34);
    run(bm, [tgt], 1.5);
    expect(tgt.hits).toEqual([34]);
    expect(bm.active).toBe(0);
  });

  it('miss targets outside the hit radius, accounting for gravity drop', () => {
    const bm = new BulletManager(new THREE.Scene(), fx());
    // after ~1.5 s a round has dropped ~11 m: a target on the original line is missed
    const tgt = target(new THREE.Vector3(0, 4500, -1500), 4);
    bm.fire(high, new THREE.Vector3(0, 0, -1000), OWNER_PLAYER, 34);
    run(bm, [tgt], 2);
    expect(tgt.hits).toEqual([]);
  });

  it("never score hits from other pilots' rounds", () => {
    const bm = new BulletManager(new THREE.Scene(), fx());
    const tgt = target(new THREE.Vector3(0, 4500, -500));
    bm.fire(high, new THREE.Vector3(0, 0, -1000), OWNER_REMOTE, 0);
    run(bm, [tgt], 1);
    expect(tgt.hits).toEqual([]);
  });

  it('hit fast crossing targets (swept test, no tunnelling)', () => {
    const bm = new BulletManager(new THREE.Scene(), fx());
    // round covers ~17 m per frame; target is only 4 m wide
    const tgt = target(new THREE.Vector3(0, 4500, -300), 2);
    bm.fire(high, new THREE.Vector3(0, 0, -1000), OWNER_PLAYER, 10);
    run(bm, [tgt], 0.5);
    expect(tgt.hits).toHaveLength(1);
  });

  it('impact the terrain and expire after their lifetime', () => {
    const effects = fx();
    const bm = new BulletManager(new THREE.Scene(), effects);
    const x = 20000,
      z = 20000;
    const ground = terrainHeight(x, z);
    bm.fire(new THREE.Vector3(x, ground + 300, z), new THREE.Vector3(0, -900, -300), OWNER_PLAYER, 34);
    bm.fire(new THREE.Vector3(x, 8000, z), new THREE.Vector3(0, 0, -1000), OWNER_PLAYER, 34, 1.0);
    run(bm, [], 0.6);
    expect(effects.count.smoke).toBeGreaterThan(0); // dust from the ground impact
    run(bm, [], 0.6);
    expect(bm.active).toBe(0); // the high round timed out
  });
});
