// Ocean and lake surfaces: PBR material reflecting the sky environment with
// animated multi-scale normals computed in world space.

import * as THREE from 'three';
import { waterNormalTexture } from '../render/textures.js';
import { LAKES } from './worldData.js';

export class Water {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 }, uWave: { value: 1 } };
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0b3a4c,
      roughness: 0.07,
      metalness: 0.0,
      normalMap: waterNormalTexture(),
      normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.0,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uWave = this.uniforms.uWave;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uWave;')
        .replace(
          '#include <normal_fragment_maps>',
          `
          float wDist = length(vWPos - cameraPosition);
          vec2 p = vWPos.xz;
          vec3 n1 = texture2D(normalMap, p * 0.011 + uTime * vec2(0.012, 0.007)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, p * 0.037 + uTime * vec2(-0.015, 0.011)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(normalMap, p * 0.0017 + uTime * vec2(0.0025, -0.0015)).xyz * 2.0 - 1.0;
          float amp = mix(1.0, 0.18, smoothstep(400.0, 25000.0, wDist)) * uWave;
          vec2 slope = (n1.xy + n2.xy * 0.6 * (1.0 - smoothstep(200.0, 3000.0, wDist)) + n3.xy * 0.9) * normalScale * amp;
          vec3 wn = normalize(vec3(slope.x, 1.0, slope.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          `
        );
    };
    mat.customProgramCacheKey = () => 'water-v1';
    this.material = mat;

    const geo = new THREE.PlaneGeometry(700000, 700000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.renderOrder = 1;
    this.ocean.frustumCulled = false;
    this.ocean.receiveShadow = true;
    scene.add(this.ocean);

    this.lakes = [];
    for (const l of LAKES) {
      const g = new THREE.CircleGeometry(l.r * 1.45, 64);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(l.x, l.level, l.z);
      m.renderOrder = 1;
      scene.add(m);
      this.lakes.push(m);
    }
  }

  update(dt, camera, weather) {
    this.uniforms.uTime.value += dt;
    const wind = weather ? weather.windSpeed || 0 : 3;
    this.uniforms.uWave.value = 0.6 + Math.min(1.6, wind / 8);
    this.ocean.position.set(Math.round(camera.position.x / 1000) * 1000, 0, Math.round(camera.position.z / 1000) * 1000);
  }
}
