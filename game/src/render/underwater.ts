import * as THREE from "three";

/**
 * Underwater light for the sphere pool: caustics on everything inside the water, sun shafts slanting down through
 * it, and the fog/colour shift while the camera is underwater.
 */

export interface UnderwaterUniforms {
  uTime: THREE.IUniform<number>;
  uSphereCenter: THREE.IUniform<THREE.Vector3>;
  uSphereRadius: THREE.IUniform<number>;
  uCausticStrength: THREE.IUniform<number>;
}

export function createUnderwaterUniforms(): UnderwaterUniforms {
  return {
    uTime: { value: 0 },
    uSphereCenter: { value: new THREE.Vector3() },
    uSphereRadius: { value: 1 },
    uCausticStrength: { value: 0.55 },
  };
}

/** Animated water caustics (an iterated-sine light web), tileable over uv. */
export const CAUSTIC_GLSL = /* glsl */ `
float uwCaustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

/** World units per caustic tile. */
const CAUSTIC_TILE = 22;

/**
 * Add caustic light to a standard/basic material: inside the sphere, a moving light web projected from above
 * brightens the surface (more on surfaces facing up).
 */
export function addCaustics(material: THREE.Material, u: UnderwaterUniforms): void {
  const kind = material as { isMeshStandardMaterial?: boolean; isMeshBasicMaterial?: boolean };
  if (!(kind.isMeshStandardMaterial || kind.isMeshBasicMaterial)) return;
  // materials are shared between model clones: inject once
  if (material.userData.uwCaustics) return;
  material.userData.uwCaustics = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uSphereCenter = u.uSphereCenter;
    shader.uniforms.uSphereRadius = u.uSphereRadius;
    shader.uniforms.uCausticStrength = u.uCausticStrength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vUwWorld;\nvarying vec3 vUwNormal;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 uwP = vec4(transformed, 1.0);
          vec3 uwN = normal; // the facing term only needs the rest normal
          #ifdef USE_INSTANCING
            uwP = instanceMatrix * uwP;
            uwN = mat3(instanceMatrix) * uwN;
          #endif
          vUwWorld = (modelMatrix * uwP).xyz;
          vUwNormal = normalize(mat3(modelMatrix) * uwN);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uSphereCenter;
        uniform float uSphereRadius;
        uniform float uCausticStrength;
        varying vec3 vUwWorld;
        varying vec3 vUwNormal;
        ${CAUSTIC_GLSL}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          float inside = 1.0 - smoothstep(uSphereRadius * 0.97, uSphereRadius * 1.02, length(vUwWorld - uSphereCenter));
          if (inside > 0.0) {
            vec2 uv = (vUwWorld.xz + vUwWorld.y * 0.25) / ${CAUSTIC_TILE.toFixed(1)};
            float c = uwCaustic(uv, uTime * 0.55) + 0.6 * uwCaustic(uv * 1.7 + 3.0, uTime * 0.4);
            float facing = 0.35 + 0.65 * max(dot(normalize(vUwNormal), vec3(0.0, 1.0, 0.0)), 0.0);
            outgoingLight += vec3(0.55, 0.85, 1.0) * c * facing * uCausticStrength * inside;
            // light falls off with depth below the top of the sphere
            float depth = clamp((uSphereCenter.y + uSphereRadius - vUwWorld.y) / (2.0 * uSphereRadius), 0.0, 1.0);
            outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.55, 0.78, 1.0), depth * 0.55 * inside);
          }
        }
        #include <opaque_fragment>`,
      );
  };
  material.needsUpdate = true;
}

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uSphereCenter;
uniform float uSphereRadius;
varying vec2 vUv;
varying vec3 vWorld;
float h(float n) { return fract(sin(n) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
void main() {
  // soft-edged beam, strongest at the top, flickering slowly
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float beam = pow(across, 2.2);
  // vUv.y is 1 at the top edge (the quad hangs down from it): fade in just below the surface, fade out with depth
  float along = smoothstep(1.0, 0.9, vUv.y);
  float fall = pow(vUv.y, 1.6);
  float flicker = 0.55 + 0.45 * n1(uTime * 0.35 + uSeed * 13.0 + vUv.x * 2.0);
  float inside = 1.0 - smoothstep(uSphereRadius * 0.9, uSphereRadius, length(vWorld - uSphereCenter));
  float a = beam * fall * along * flicker * inside * 0.16;
  gl_FragColor = vec4(vec3(0.62, 0.88, 1.0) * a, a);
}
`;

/**
 * Sun shafts: tall additive beams from the top of the sphere, tilted with the sun, each a pair of crossed quads.
 */
export function createLightShafts(centre: THREE.Vector3, radius: number, u: UnderwaterUniforms): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.translate(0, -0.5, 0); // hang from the top edge
  const count = 16;
  const tilt = new THREE.Euler(0.32, 0, 0.18);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: {
        uTime: u.uTime,
        uSeed: { value: Math.random() },
        uSphereCenter: u.uSphereCenter,
        uSphereRadius: u.uSphereRadius,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius * 0.6;
    const width = radius * (0.06 + Math.random() * 0.08);
    const length = radius * (1.3 + Math.random() * 0.5);
    for (const yaw of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(width, length, 1);
      m.position.set(centre.x + Math.cos(a) * r, centre.y + radius * 0.85, centre.z + Math.sin(a) * r);
      m.rotation.copy(tilt);
      m.rotateY(yaw);
      m.renderOrder = 15;
      m.frustumCulled = false;
      group.add(m);
    }
  }
  return group;
}

const FOG_ABOVE = new THREE.Color(0x04101c);
const FOG_BELOW = new THREE.Color(0x0b4a7c);

/**
 * Blend the scene fog between the stadium air and the water as the camera moves in and out of the sphere.
 * `amount` is smoothed state owned by the caller (0 = in air, 1 = underwater).
 */
export function updateUnderwaterFog(
  scene: THREE.Scene,
  camera: THREE.Camera,
  u: UnderwaterUniforms,
  amount: { value: number },
  dt: number,
): void {
  const inside = camera.position.distanceTo(u.uSphereCenter.value) < u.uSphereRadius.value ? 1 : 0;
  amount.value += (inside - amount.value) * (1 - Math.exp(-dt * 4));
  const fog = scene.fog as THREE.Fog | null;
  if (!fog) return;
  const k = amount.value;
  fog.color.copy(FOG_ABOVE).lerp(FOG_BELOW, k);
  fog.near = THREE.MathUtils.lerp(250, 25, k);
  fog.far = THREE.MathUtils.lerp(1400, 420, k);
  if (scene.background instanceof THREE.Color) scene.background.copy(fog.color);
}
