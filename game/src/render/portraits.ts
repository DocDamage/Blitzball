import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Player portraits rendered from the original FFX Blitzball models (the baked set in public/ffx/blitz).
 * The disc's own 2D portrait art for the Blitzball roster was not found (see tools/docs/models.md), so a head-and-
 * shoulders view of each player's real model, lit like a menu illustration, stands in. Free agents have no model
 * of their own and get no portrait. Without the extracted assets every call resolves to null.
 */

const BASE = "/ffx/blitz/";

/** Models baked in a bent-over bind pose (two of the Guado blitzers): the head cannot be framed, so no portrait. */
const BENT_MODELS = new Set([25, 26]);

interface PortraitManifest {
  models: Record<string, { path: string }>;
  players: Record<string, number>;
}

export interface PortraitOptions {
  size?: number;
  /** Camera side: the models face +z when true. */
  facePositiveZ?: boolean;
}

let manifestPromise: Promise<PortraitManifest | null> | null = null;
const cache = new Map<number, Promise<string | null>>();
let renderer: THREE.WebGLRenderer | null = null;
let queue: Promise<unknown> = Promise.resolve();

function loadManifest(): Promise<PortraitManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PortraitManifest>) : null))
      .catch(() => null);
  }
  return manifestPromise;
}

/** The model index that draws this player, or null when the player has no model of their own. */
export async function portraitModelOf(playerId: number): Promise<number | null> {
  const m = await loadManifest();
  if (!m) return null;
  const idx = m.players[String(playerId)];
  return idx !== undefined && m.models[String(idx)] ? idx : null;
}

/** PNG data URL of the player's portrait, or null. Renders are cached and serialised. */
export async function portraitFor(playerId: number, opts: PortraitOptions = {}): Promise<string | null> {
  const idx = await portraitModelOf(playerId);
  if (idx === null) return null;
  let p = cache.get(idx);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      queue = queue.then(() => renderModel(idx, opts).then(resolve, () => resolve(null)));
    });
    cache.set(idx, p);
  }
  return p;
}

async function renderModel(modelIndex: number, opts: PortraitOptions): Promise<string | null> {
  const m = await loadManifest();
  const path = m?.models[String(modelIndex)]?.path;
  if (!path || BENT_MODELS.has(modelIndex)) return null;
  const size = opts.size ?? 192;
  if (!renderer) {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setSize(size, size, false);

  const gltf = await new GLTFLoader().loadAsync(`${BASE}${path}`);
  const scene = new THREE.Scene();
  const model = gltf.scene;
  model.rotation.x = Math.PI; // FFX models are Y-down
  scene.add(model);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      mat.alphaTest = 0.5;
      mat.transparent = false;
      mat.side = THREE.DoubleSide;
    }
  });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  // head and shoulders: the head is where the vertex mass is near the top of the body (a bent model, like the
  // Ronso, carries it well forward of the bounding box, and an extended arm can poke above it)
  const top = box.max.y;
  const pts: THREE.Vector3[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 2) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  });
  pts.sort((a, b) => b.y - a.y);
  const head = pts.slice(Math.floor(pts.length * 0.02), Math.floor(pts.length * 0.12));
  const med = (f: (v: THREE.Vector3) => number) => {
    const a = head.map(f).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 0;
  };
  const cy = head.length ? med((v) => v.y) : top - h * 0.1;
  const focus = new THREE.Vector3(med((v) => v.x), cy - h * 0.02, med((v) => v.z));
  const view = h * 0.27;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.01, h * 20);
  const dist = view / 2 / Math.tan((24 * Math.PI) / 360);
  const side = opts.facePositiveZ === false ? -1 : 1;
  camera.position.set(focus.x + dist * 0.18, focus.y + view * 0.04, focus.z + side * dist);
  camera.lookAt(focus);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const key = new THREE.DirectionalLight(0xfff2dd, 1.8);
  key.position.set(1.5, 2, side * 2.5);
  scene.add(key);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
  return url;
}
