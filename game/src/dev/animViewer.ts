// Dev-only filmstrip of the Blitzball motions baked by tools/extract/blitz_motions.py into public/ffx/anim/<name>/.
// ?m=<name> picks the model folder, ?clip=N shows one clip as a filmstrip (default: the middle frame of every clip),
// ?frames=K sets the filmstrip length, ?angle=deg turns the model.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { actionClips, type ClipAction, type Manifest } from "../render/originalCharacters";

interface ClipInfo {
  index: number;
  kind: number;
  start: number;
  frames: number;
}

const SIZE = 300;
const params = new URLSearchParams(location.search);
const name = params.get("m") ?? "type0_mdl0000_0001";
const clipParam = params.get("clip");
const strip = Number(params.get("frames") ?? 8);
const angle = (Number(params.get("angle") ?? 30) * Math.PI) / 180;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(SIZE, SIZE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a3550);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 2, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const grid = document.getElementById("grid") as HTMLDivElement;
// ?rot=1 keeps only bone rotations, so a motion set made for one skeleton's proportions can drive another skeleton
// with the same topology; the motion also plays in place (the match simulation moves the players)
const rotOnly = params.get("rot") === "1";
function prepClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  if (!rotOnly) return clip;
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => t.name.endsWith(".quaternion"));
  return c;
}

async function main(): Promise<void> {
  // ?ms=a,b,c compares the same clip (default 0) across several model folders
  const many = params.get("ms");
  if (params.get("action")) {
    // ?action=swim[&models=2,3] : that action's clip, as used in matches, for each model in public/ffx/blitz
    await renderBlitzAction(params.get("action") ?? "swim", params.get("models"));
  } else if (params.get("score")) {
    // ?score=a,b,c: how much each motion set distorts each body (1 = keeps its bind-pose size)
    const out: Record<string, number> = {};
    for (const m of (params.get("score") ?? "").split(",")) out[m] = await score(m);
    (window as unknown as { scores: Record<string, number> }).scores = out;
  } else if (many) {
    for (const m of many.split(",")) await render(m, true);
  } else {
    await render(name, false);
  }
  document.title += " (done)";
}

async function renderBlitzAction(action: string, only: string | null): Promise<void> {
  // Same clips the match plays (own set, or retargeted from another model)
  const manifest = (await (await fetch("/ffx/blitz/manifest.json")).json()) as Manifest;
  const loader = new GLTFLoader();
  const keys = only ? only.split(",") : Object.keys(manifest.models);
  grid.style.gridTemplateColumns = `repeat(${strip}, 1fr)`;
  for (const k of keys) {
    const entry = manifest.models[k];
    if (!entry) continue;
    const gltf = await loader.loadAsync(`/ffx/blitz/${entry.path}`);
    const srcEntry = entry.retargetFrom !== undefined ? manifest.models[String(entry.retargetFrom)] : undefined;
    const src = srcEntry ? { gltf: await loader.loadAsync(`/ffx/blitz/${srcEntry.path}`), entry: srcEntry } : undefined;
    const clip = actionClips(gltf, entry, manifest.fps, src)[action as ClipAction];
    if (!clip) continue;
    const root = gltf.scene;
    root.rotation.set(Math.PI, angle, 0); // FFX model space is Y-down
    scene.add(root);
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    for (let i = 0; i < strip; i++) {
      const t = (clip.duration * i) / Math.max(1, strip);
      mixer.setTime(t);
      const box = skinnedBox(root, meshes);
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
      camera.position.set(centre.x, centre.y, centre.z + (radius / Math.tan((15 * Math.PI) / 180)) * 1.1);
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      camera.lookAt(centre);
      renderer.render(scene, camera);
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = renderer.domElement.toDataURL();
      const cap = document.createElement("figcaption");
      cap.textContent = `m${k} ${action} ${t.toFixed(1)}s${entry.retargetFrom !== undefined ? " rt" : ""}`;
      fig.append(img, cap);
      grid.append(fig);
    }
    scene.remove(root);
  }
}

/** World-space bounds of the posed (skinned) vertices; Box3.setFromObject only sees the bind pose. */
function skinnedBox(root: THREE.Object3D, meshes: THREE.SkinnedMesh[]): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      box.expandByPoint(v);
    }
  }
  return box;
}

/** Mean ratio of the skinned bounding-box diagonal (root motion removed) to the bind pose, sampled across all clips. */
async function score(name: string): Promise<number> {
  const base = `/ffx/anim/${name}`;
  try {
    const info = (await (await fetch(`${base}/clips.json`)).json()) as { fps: number; clips: ClipInfo[] };
    const gltf = await new GLTFLoader().loadAsync(`${base}/model.gltf`);
    const root = gltf.scene;
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    const measure = (): number => skinnedBox(root, meshes).getSize(new THREE.Vector3()).length();
    const bind = measure();
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(prepClip(gltf.animations[0])).play();
    let total = 0;
    let n = 0;
    for (const c of info.clips) {
      for (const f of [0.25, 0.5, 0.75]) {
        mixer.setTime((c.start + Math.floor(c.frames * f)) / info.fps);
        total += measure() / bind;
        n++;
      }
    }
    return Math.round((total / n) * 100) / 100;
  } catch {
    return -1;
  }
}

async function render(name: string, compare: boolean): Promise<void> {
  const base = `/ffx/anim/${name}`;
  const info = (await (await fetch(`${base}/clips.json`)).json()) as { fps: number; clips: ClipInfo[] };
  const gltf = await new GLTFLoader().loadAsync(`${base}/model.gltf`);
  const root = gltf.scene;
  root.rotation.set(Math.PI, angle, 0); // FFX model space is Y-down
  scene.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(prepClip(gltf.animations[0]));
  action.play();

  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  // Frame each shot on its posed body
  const frame = (): void => {
    const box = skinnedBox(root, meshes);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
    camera.position.set(centre.x, centre.y, centre.z + (radius / Math.tan((15 * Math.PI) / 180)) * 1.1);
    camera.near = radius / 100;
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(centre);
  };

  const shots: { label: string; frame: number }[] = [];
  if (compare) {
    const c = info.clips[Number(clipParam ?? 0)];
    shots.push({ label: `${name} clip ${c.index}`, frame: c.start + Math.floor(c.frames / 2) });
  } else if (clipParam !== null) {
    // ?clip=all lays every clip out as a filmstrip, one clip per row of `frames` cells
    // ?clip=1,4,7 picks several clips
    const chosen = clipParam === "all" ? info.clips : clipParam.split(",").map((n) => info.clips[Number(n)]);
    if (chosen.length > 1) grid.style.gridTemplateColumns = `repeat(${strip}, 1fr)`;
    for (const c of chosen)
      for (let i = 0; i < strip; i++) {
        const f = c.start + Math.floor(((c.frames - 1) * i) / Math.max(1, strip - 1));
        shots.push({ label: `clip ${c.index} f${f - c.start}/${c.frames}`, frame: f });
      }
  } else {
    for (const c of info.clips)
      shots.push({ label: `clip ${c.index} (${c.frames}f k${c.kind})`, frame: c.start + Math.floor(c.frames / 2) });
  }
  for (const s of shots) {
    mixer.setTime(s.frame / info.fps);
    frame();
    renderer.render(scene, camera);
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = renderer.domElement.toDataURL();
    const cap = document.createElement("figcaption");
    cap.textContent = s.label;
    fig.append(img, cap);
    grid.append(fig);
  }
  scene.remove(root);
}

void main();
