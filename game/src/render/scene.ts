import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadOriginalStadium } from "./originalStadium";
import { GOAL_HEIGHT, GOAL_WIDTH, type PoolBounds, poolCentreWorld } from "./renderState";
import { CAUSTIC_GLSL } from "./underwater";

export const FOG_COLOR = 0x04101c;
export const WATER_SHALLOW = new THREE.Color(0x3fb8ff);
export const WATER_DEEP = new THREE.Color(0x0a2e66);

export interface Stadium {
  group: THREE.Group;
  /** Advance animated materials (water caustics, bubbles, crowd sway). */
  update(time: number): void;
  dispose(): void;
}

export function createWebGLRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  // The original stadium is several hundred units across around the sphere
  scene.fog = new THREE.Fog(FOG_COLOR, 250, 1400);

  const hemi = new THREE.HemisphereLight(0x5a8fd6, 0x07101c, 0.9);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dc, 2.2);
  key.position.set(30, 70, 40);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x3f7fff, 0.8);
  fill.position.set(-40, 30, -50);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.5);
  rim.position.set(0, 10, -80);
  scene.add(rim);

  return scene;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uBaseAlpha;
uniform float uFresnelAlpha;
uniform vec3 uCentre;
varying vec3 vWorldPos;
varying vec3 vNormal;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
// a few octaves of drifting noise: the height of the surface ripples
float ripples(vec2 p, float t) {
  float h = noise(p * 0.11 + vec2(t * 0.07, t * 0.05)) * 0.55;
  h += noise(p * 0.23 - vec2(t * 0.11, -t * 0.09)) * 0.3;
  h += noise(p * 0.51 + vec2(-t * 0.19, t * 0.17)) * 0.15;
  return h;
}
${CAUSTIC_GLSL}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormal);
  bool fromInside = !gl_FrontFacing;
  if (fromInside) N = -N;
  // perturb the surface normal with the ripple slope (surface coordinates from the sphere's lat/long)
  vec3 d = normalize(vWorldPos - uCentre);
  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 60.0;
  float e = 0.6;
  float h0 = ripples(sp, uTime);
  vec2 slope = vec2(ripples(sp + vec2(e, 0.0), uTime) - h0, ripples(sp + vec2(0.0, e), uTime) - h0) / e;
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(1e-4));
  vec3 B = normalize(cross(d, T));
  N = normalize(N + (T * slope.x + B * slope.y) * 2.2);

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  float c = uwCaustic(sp / 40.0, uTime * 0.5);
  vec3 col;
  float a;
  if (fromInside) {
    // Snell's window: inside ~48 degrees of the normal you see out; beyond it the surface mirrors the water
    float window = smoothstep(0.62, 0.72, ndv);
    vec3 mirror = mix(uDeep, uShallow, 0.55 + 0.45 * h0) + vec3(0.7, 0.9, 1.0) * c * 0.35;
    vec3 through = uShallow * 0.35;
    col = mix(mirror, through, window);
    a = mix(uBaseAlpha + 0.55, uBaseAlpha * 0.6, window) + c * 0.12;
  } else {
    col = mix(uDeep, uShallow, 0.35 + fres * 0.65) + vec3(0.8, 0.95, 1.0) * c * 0.25;
    a = uBaseAlpha + fres * uFresnelAlpha + c * 0.1;
  }
  // bright meniscus where the surface turns away from the eye
  col += vec3(0.6, 0.9, 1.0) * pow(1.0 - abs(dot(normalize(vNormal), V)), 6.0) * 0.6;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
}
`;

function makeWaterMaterial(side: THREE.Side, uTime: THREE.IUniform<number>, baseAlpha: number, centre: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime,
      uShallow: { value: WATER_SHALLOW },
      uDeep: { value: WATER_DEEP },
      uBaseAlpha: { value: baseAlpha },
      uFresnelAlpha: { value: side === THREE.BackSide ? 0.35 : 0.6 },
      uCentre: { value: centre },
    },
    transparent: true,
    depthWrite: false,
    side,
  });
}

const BUBBLE_VERT = /* glsl */ `
attribute float aOffset;
attribute float aSpeed;
attribute float aSize;
uniform float uTime;
uniform float uHeight;
uniform float uBottom;
varying float vFade;
void main() {
  vec3 p = position;
  float h = mod(aOffset + uTime * aSpeed, uHeight);
  p.y = uBottom + h;
  p.x += sin(uTime * 1.3 + aOffset * 7.0) * 0.4;
  p.z += cos(uTime * 1.1 + aOffset * 5.0) * 0.4;
  vFade = smoothstep(0.0, 0.08, h / uHeight) * (1.0 - smoothstep(0.85, 1.0, h / uHeight));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * (160.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const BUBBLE_FRAG = /* glsl */ `
varying float vFade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float ring = smoothstep(0.5, 0.35, r) * (0.35 + 0.65 * smoothstep(0.2, 0.42, r));
  gl_FragColor = vec4(0.75, 0.92, 1.0, ring * vFade * 0.55);
}
`;

// ---------------------------------------------------------------------------
// Stadium
// ---------------------------------------------------------------------------

export function createStadium(pool: PoolBounds): Stadium {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const uTime: THREE.IUniform<number> = { value: 0 };

  const c = poolCentreWorld(pool);
  const W = pool.maxX - pool.minX;
  const H = pool.maxZ - pool.minZ;
  const D = pool.maxY - pool.minY;
  const poolRadius = Math.max(W, D) / 2;
  /** The play volume is a sphere (the sim clips it with the goal planes); its radius is half the pool depth. */
  const sphereRadius = H / 2;

  // --- water volume -------------------------------------------------------
  const waterGeo = new THREE.SphereGeometry(sphereRadius + 1, 96, 64);
  disposables.push(waterGeo);
  const centre = new THREE.Vector3(c.x, c.y, c.z);
  const backMat = makeWaterMaterial(THREE.BackSide, uTime, 0.15, centre);
  const frontMat = makeWaterMaterial(THREE.FrontSide, uTime, 0.09, centre);
  disposables.push(backMat, frontMat);
  const waterBack = new THREE.Mesh(waterGeo, backMat);
  const waterFront = new THREE.Mesh(waterGeo, frontMat);
  waterBack.renderOrder = 20;
  waterFront.renderOrder = 21;
  waterBack.position.set(c.x, c.y, c.z);
  waterFront.position.set(c.x, c.y, c.z);
  group.add(waterBack, waterFront);

  // --- edge glow: equator ring + meridian ribs --------------------------
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x6fd6ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(glowMat);
  const ringGeo = new THREE.TorusGeometry(1, 0.004, 6, 160);
  disposables.push(ringGeo);
  const equator = new THREE.Mesh(ringGeo, glowMat);
  equator.rotation.x = Math.PI / 2;
  equator.scale.setScalar(sphereRadius + 1.2);
  equator.position.set(c.x, c.y, c.z);
  group.add(equator);
  for (const rot of [0, Math.PI / 2]) {
    const rib = new THREE.Mesh(ringGeo, glowMat);
    rib.rotation.y = rot;
    rib.scale.setScalar(sphereRadius + 1.2);
    rib.position.set(c.x, c.y, c.z);
    group.add(rib);
  }

  // --- bubbles ------------------------------------------------------------
  const bubbleCount = 500;
  const bPos = new Float32Array(bubbleCount * 3);
  const bOff = new Float32Array(bubbleCount);
  const bSpd = new Float32Array(bubbleCount);
  const bSize = new Float32Array(bubbleCount);
  for (let i = 0; i < bubbleCount; i++) {
    bPos[i * 3] = pool.minX + Math.random() * W;
    bPos[i * 3 + 1] = 0;
    bPos[i * 3 + 2] = -(pool.minY + Math.random() * D);
    bOff[i] = Math.random() * H;
    bSpd[i] = 1.2 + Math.random() * 2.2;
    bSize[i] = 0.5 + Math.random() * 1.6;
  }
  const bubbleGeo = new THREE.BufferGeometry();
  bubbleGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
  bubbleGeo.setAttribute("aOffset", new THREE.BufferAttribute(bOff, 1));
  bubbleGeo.setAttribute("aSpeed", new THREE.BufferAttribute(bSpd, 1));
  bubbleGeo.setAttribute("aSize", new THREE.BufferAttribute(bSize, 1));
  bubbleGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.x, c.y, c.z), poolRadius * 1.5);
  const bubbleMat = new THREE.ShaderMaterial({
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    uniforms: { uTime, uHeight: { value: H }, uBottom: { value: pool.minZ } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(bubbleGeo, bubbleMat);
  const bubbles = new THREE.Points(bubbleGeo, bubbleMat);
  bubbles.frustumCulled = false;
  bubbles.renderOrder = 10;
  group.add(bubbles);

  // --- goals --------------------------------------------------------------
  const goalMat = new THREE.MeshStandardMaterial({
    color: 0xf2f6ff,
    emissive: 0x4fb0ff,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.6,
  });
  const netMat = new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.45 });
  disposables.push(goalMat, netMat);
  const goalParts: THREE.BufferGeometry[] = [];
  const postGeo = new THREE.CylinderGeometry(0.35, 0.35, GOAL_HEIGHT, 8);
  const barGeo = new THREE.CylinderGeometry(0.35, 0.35, GOAL_WIDTH, 8);
  barGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const gx = side < 0 ? pool.minX : pool.maxX;
    const depth = 1.6 * side; // net goes outward
    const p1 = postGeo.clone().translate(gx, c.y, c.z + GOAL_WIDTH / 2);
    const p2 = postGeo.clone().translate(gx, c.y, c.z - GOAL_WIDTH / 2);
    const top = barGeo.clone().translate(gx, c.y + GOAL_HEIGHT / 2, c.z);
    const bottom = barGeo.clone().translate(gx, c.y - GOAL_HEIGHT / 2, c.z);
    goalParts.push(p1, p2, top, bottom);
    // net lines
    const pts: number[] = [];
    const nx = gx + depth;
    for (let i = 0; i <= GOAL_WIDTH; i++) {
      const z = c.z - GOAL_WIDTH / 2 + i;
      pts.push(gx, c.y - GOAL_HEIGHT / 2, z, nx, c.y - GOAL_HEIGHT / 2, z);
      pts.push(nx, c.y - GOAL_HEIGHT / 2, z, nx, c.y + GOAL_HEIGHT / 2, z);
      pts.push(nx, c.y + GOAL_HEIGHT / 2, z, gx, c.y + GOAL_HEIGHT / 2, z);
    }
    for (let j = 0; j <= GOAL_HEIGHT; j++) {
      const y = c.y - GOAL_HEIGHT / 2 + j;
      pts.push(nx, y, c.z - GOAL_WIDTH / 2, nx, y, c.z + GOAL_WIDTH / 2);
      pts.push(gx, y, c.z - GOAL_WIDTH / 2, nx, y, c.z - GOAL_WIDTH / 2);
      pts.push(gx, y, c.z + GOAL_WIDTH / 2, nx, y, c.z + GOAL_WIDTH / 2);
    }
    const netGeo = new THREE.BufferGeometry();
    netGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    disposables.push(netGeo);
    group.add(new THREE.LineSegments(netGeo, netMat));
  }
  postGeo.dispose();
  barGeo.dispose();
  const goalsGeo = mergeGeometries(goalParts, false);
  for (const g of goalParts) g.dispose();
  if (goalsGeo) {
    disposables.push(goalsGeo);
    group.add(new THREE.Mesh(goalsGeo, goalMat));
  }

  // --- centre markings ----------------------------------------------------
  const markMat = new THREE.MeshBasicMaterial({
    color: 0x7fe0ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(markMat);
  const centreRingGeo = new THREE.TorusGeometry(Math.min(H, D) * 0.2, 0.12, 6, 64);
  disposables.push(centreRingGeo);
  const centreRing = new THREE.Mesh(centreRingGeo, markMat);
  centreRing.rotation.y = Math.PI / 2;
  centreRing.position.set(c.x, c.y, c.z);
  group.add(centreRing);
  // (the halfway plane is marked by the meridian rib of the sphere)

  // --- procedural stadium (stands in until / unless the original map loads) --
  const fallback = new THREE.Group();
  group.add(fallback);

  // --- stadium bowl (single lathe mesh) -------------------------------------
  const bowlProfile: THREE.Vector2[] = [];
  const innerR = poolRadius + 14;
  const baseY = pool.minZ - 14;
  bowlProfile.push(new THREE.Vector2(innerR - 6, baseY - 6));
  bowlProfile.push(new THREE.Vector2(innerR, baseY));
  const tiers = 14;
  for (let i = 0; i < tiers; i++) {
    const r0 = innerR + i * 3.4;
    const y0 = baseY + i * 2.6;
    bowlProfile.push(new THREE.Vector2(r0, y0));
    bowlProfile.push(new THREE.Vector2(r0 + 3.4, y0));
  }
  const topR = innerR + tiers * 3.4;
  const topY = baseY + tiers * 2.6;
  bowlProfile.push(new THREE.Vector2(topR + 2, topY + 6));
  bowlProfile.push(new THREE.Vector2(topR + 6, topY + 6));
  bowlProfile.push(new THREE.Vector2(topR + 6, baseY - 30));
  const bowlGeo = new THREE.LatheGeometry(bowlProfile, 64);
  bowlGeo.computeVertexNormals();
  disposables.push(bowlGeo);
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x0c1a2c, roughness: 0.95, metalness: 0.05 });
  disposables.push(bowlMat);
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);
  bowl.position.set(c.x, 0, c.z);
  fallback.add(bowl);

  // Tier rim lights (one merged line set)
  const rimPts: number[] = [];
  for (let i = 0; i < tiers; i += 2) {
    const r = innerR + i * 3.4 + 0.2;
    const y = baseY + i * 2.6 + 0.15;
    const segs = 96;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      rimPts.push(c.x + Math.cos(a0) * r, y, c.z + Math.sin(a0) * r, c.x + Math.cos(a1) * r, y, c.z + Math.sin(a1) * r);
    }
  }
  const rimGeo = new THREE.BufferGeometry();
  rimGeo.setAttribute("position", new THREE.Float32BufferAttribute(rimPts, 3));
  const rimMat = new THREE.LineBasicMaterial({ color: 0x2a6fcf, transparent: true, opacity: 0.35 });
  disposables.push(rimGeo, rimMat);
  fallback.add(new THREE.LineSegments(rimGeo, rimMat));

  // Floodlight masts (merged into one geometry per material)
  const mastParts: THREE.BufferGeometry[] = [];
  const lampParts: THREE.BufferGeometry[] = [];
  const mastGeo = new THREE.CylinderGeometry(0.6, 0.9, 40, 6);
  const lampGeo = new THREE.SphereGeometry(2.2, 10, 8);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const r = topR + 4;
    mastParts.push(mastGeo.clone().translate(c.x + Math.cos(a) * r, topY + 20, c.z + Math.sin(a) * r));
    lampParts.push(lampGeo.clone().translate(c.x + Math.cos(a) * (r - 2), topY + 41, c.z + Math.sin(a) * (r - 2)));
  }
  mastGeo.dispose();
  lampGeo.dispose();
  const mastMerged = mergeGeometries(mastParts, false);
  const lampMerged = mergeGeometries(lampParts, false);
  for (const g of mastParts) g.dispose();
  for (const g of lampParts) g.dispose();
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x1a2a40, roughness: 0.8 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  disposables.push(mastMat, lampMat);
  if (mastMerged) {
    disposables.push(mastMerged);
    fallback.add(new THREE.Mesh(mastMerged, mastMat));
  }
  if (lampMerged) {
    disposables.push(lampMerged);
    fallback.add(new THREE.Mesh(lampMerged, lampMat));
  }

  // --- crowd impostors (single instanced draw) ------------------------------
  const seatGeo = new THREE.BoxGeometry(0.85, 1.6, 0.6);
  seatGeo.translate(0, 0.75, 0);
  const crowdMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  crowdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
        transformed.y += step(0.9, position.y) * 0.18 * sin(uTime * 3.0 + seed);
      #endif`,
    );
  };
  disposables.push(seatGeo, crowdMat);
  const crowdPositions: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < tiers; i++) {
    const r = innerR + i * 3.4 + 1.7;
    const y = baseY + i * 2.6;
    const count = Math.floor((2 * Math.PI * r) / 1.05);
    for (let s = 0; s < count; s++) {
      if (Math.random() < 0.08) continue;
      const a = (s / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.01;
      dummy.position.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
      dummy.rotation.set(0, -a + Math.PI / 2, 0);
      const sc = 0.85 + Math.random() * 0.3;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      crowdPositions.push(dummy.matrix.clone());
    }
  }
  const crowd = new THREE.InstancedMesh(seatGeo, crowdMat, crowdPositions.length);
  const palette = [0x2f6df6, 0xe23b3b, 0xffd54a, 0xf0f0f0, 0x6fe0c8, 0x202a3a, 0x8a5cff, 0xff8c1a];
  const col = new THREE.Color();
  for (let i = 0; i < crowdPositions.length; i++) {
    crowd.setMatrixAt(i, crowdPositions[i]);
    col.setHex(palette[Math.floor(Math.random() * palette.length)]);
    col.multiplyScalar(0.35 + Math.random() * 0.5);
    crowd.setColorAt(i, col);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.frustumCulled = false;
  fallback.add(crowd);

  // --- ground haze disc under the pool -------------------------------------
  const hazeGeo = new THREE.CircleGeometry(innerR, 48);
  const hazeMat = new THREE.MeshBasicMaterial({
    color: 0x1b4f9a,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(hazeGeo, hazeMat);
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.rotation.x = -Math.PI / 2;
  haze.position.set(c.x, baseY - 5.5, c.z);
  fallback.add(haze);

  // --- the original Luca stadium, when extracted ------------------------------
  let disposed = false;
  let original: Awaited<ReturnType<typeof loadOriginalStadium>> = null;
  loadOriginalStadium(new THREE.Vector3(c.x, c.y, c.z), sphereRadius)
    .then((st) => {
      if (!st) return;
      if (disposed) {
        st.dispose();
        return;
      }
      original = st;
      group.add(st.root);
      fallback.visible = false;
    })
    .catch((err) => console.warn("original stadium failed to load", err));

  return {
    group,
    update(time) {
      uTime.value = time;
    },
    dispose() {
      disposed = true;
      original?.dispose();
      for (const d of disposables) d.dispose();
      crowd.dispose();
      group.removeFromParent();
    },
  };
}
