import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CharacterSystem } from "./characters";
import { type PlayerAction, type PlayerState, toWorld } from "./renderState";
import { retargetClip } from "./retarget";
import { addCaustics, type UnderwaterUniforms } from "./underwater";

/**
 * Draws players with the original FFX Blitzball models and match motions extracted from the disc
 * (tools/extract/blitz_assets.py -> public/ffx/blitz). Disc assets are never committed, so when they are missing,
 * or a model is still loading, the procedural figures of CharacterSystem stand in. HP bars, status icons and the
 * selection ring always come from CharacterSystem.
 */

export type ClipAction =
  | "idle"
  | "swim"
  | "carry"
  | "pass"
  | "shoot"
  | "tackle"
  | "block"
  | "catch"
  | "hit"
  | "celebrate";

interface ClipRange {
  start: number;
  frames: number;
}

export interface ManifestModel {
  path: string;
  actions: Record<ClipAction, ClipRange>;
  /** Take the motions of this model index, retargeted by joint position, instead of the model's own baked set. */
  retargetFrom?: number;
}

export interface Manifest {
  fps: number;
  models: Record<string, ManifestModel>;
  /** data/json player id -> modelIndex */
  players: Record<string, number>;
  /** data/json team id -> modelIndex list (uniforms for players without their own model) */
  uniforms: Record<string, number[]>;
}

interface Template {
  scene: THREE.Object3D;
  clips: Record<ClipAction, THREE.AnimationClip>;
  /** Name of the bone the ball sits in while the player carries it. */
  hand: string | null;
}

interface Instance {
  modelIndex: number;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipAction, THREE.AnimationAction>;
  current: ClipAction | null;
  facing: number;
  hand: THREE.Object3D | null;
}

/** World units per FFX model unit: a human blitzer (0.6 tall) comes out about as tall as the procedural figure. */
const MODEL_SCALE = 7;
/** Noesis bakes the motions at 20 fps; the PS2 plays them at 30. */
const PLAYBACK_RATE = 1.5;
const FADE_SECONDS = 0.15;
const LOOPING: ReadonlySet<ClipAction> = new Set(["idle", "swim", "carry"]);
/** Side 0 / side 1 uniforms when a match carries no data ids (dev matches): Aurochs vs Luca Goers. */
const DEFAULT_TEAM: [number, number] = [5, 0];

const ACTION_CLIP: Record<PlayerAction, ClipAction> = {
  idle: "idle",
  swim: "swim",
  sprint: "swim",
  pass: "pass",
  shoot: "shoot",
  tackle: "tackle",
  block: "block",
  catch: "catch",
  hit: "hit",
  celebrate: "celebrate",
};

export class OriginalCharacterSystem {
  readonly group = new THREE.Group();
  private readonly fallback = new CharacterSystem();
  private readonly loader = new GLTFLoader();
  private manifest: Manifest | null = null;
  private readonly templates = new Map<number, Template>();
  private readonly loading = new Set<number>();
  private readonly raw = new Map<number, Promise<GLTF>>();
  private readonly instances = new Map<string, Instance>();
  private readonly drawn = new Set<string>();
  private disposed = false;

  constructor(
    private readonly underwater?: UnderwaterUniforms,
    private readonly baseUrl = "/ffx/blitz/",
  ) {
    this.group.add(this.fallback.group);
    fetch(`${baseUrl}manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .then((m) => {
        if (!this.disposed) this.manifest = m;
      })
      .catch(() => {
        // No extracted assets: keep the procedural figures
      });
  }

  update(
    players: readonly PlayerState[],
    dt: number,
    camera: THREE.Camera,
    selectedId: string | null | undefined,
    carrierId?: string | null,
  ): void {
    this.drawn.clear();
    const seen = new Set<string>();
    const w = { x: 0, y: 0, z: 0 };
    for (const p of players) {
      seen.add(p.id);
      const modelIndex = this.modelFor(p);
      if (modelIndex === null) continue;
      const template = this.templates.get(modelIndex);
      if (!template) {
        this.load(modelIndex);
        continue;
      }
      let inst = this.instances.get(p.id);
      if (!inst || inst.modelIndex !== modelIndex) {
        if (inst) this.removeInstance(p.id);
        inst = this.createInstance(modelIndex, template, p.facing);
        this.instances.set(p.id, inst);
      }
      const clip =
        p.id === carrierId && (p.action === "swim" || p.action === "sprint") ? "carry" : ACTION_CLIP[p.action];
      this.play(inst, clip);
      const rate = clip === "swim" || clip === "carry" ? 0.6 + p.speed * (p.action === "sprint" ? 1.4 : 0.9) : 1;
      inst.mixer.timeScale = PLAYBACK_RATE * rate;
      inst.mixer.update(dt);

      toWorld(p.position, w);
      inst.root.position.set(w.x, w.y, w.z);
      inst.facing = dampAngle(inst.facing, p.facing, 14, dt);
      // Pool yaw 0 faces +x; the flipped model faces +z, so turn a quarter more
      inst.root.rotation.set(0, inst.facing + Math.PI / 2, 0);
      this.drawn.add(p.id);
    }
    for (const id of [...this.instances.keys()]) if (!seen.has(id)) this.removeInstance(id);
    this.fallback.update(players, dt, camera, selectedId, this.drawn);
  }

  /** Approximate hand position (in front of the chest) for ball attachment helpers. */
  /** Where a carried ball goes: the player's hand bone, as currently posed. */
  getHandWorldPosition(id: string, out: THREE.Vector3): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;
    if (inst.hand) {
      inst.root.updateMatrixWorld(true);
      inst.hand.getWorldPosition(out);
    } else {
      out.set(0, 0.6, 1.2).applyEuler(inst.root.rotation).add(inst.root.position);
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.instances.keys()]) this.removeInstance(id);
    for (const t of this.templates.values()) disposeTree(t.scene);
    this.templates.clear();
    this.fallback.dispose();
    this.group.removeFromParent();
  }

  private modelFor(p: PlayerState): number | null {
    const m = this.manifest;
    if (!m) return null;
    if (p.dataId !== undefined) {
      const own = m.players[String(p.dataId)];
      if (own !== undefined && m.models[String(own)]) return own;
    }
    const team = p.teamDataId ?? DEFAULT_TEAM[p.team];
    const uniforms = m.uniforms[String(team)];
    if (!uniforms || uniforms.length === 0) return null;
    const slot = p.slot ?? hashId(p.id);
    const pick = uniforms[slot % uniforms.length];
    return m.models[String(pick)] ? pick : null;
  }

  private load(modelIndex: number): void {
    const m = this.manifest;
    if (!m || this.loading.has(modelIndex)) return;
    const entry = m.models[String(modelIndex)];
    if (!entry) return;
    this.loading.add(modelIndex);
    const from = entry.retargetFrom;
    const source = from !== undefined && m.models[String(from)] ? from : undefined;
    Promise.all([this.loadRaw(modelIndex), source !== undefined ? this.loadRaw(source) : Promise.resolve(null)])
      .then(([gltf, src]) => {
        if (this.disposed) return;
        const srcEntry = source !== undefined ? m.models[String(source)] : undefined;
        const clips = actionClips(gltf, entry, m.fps, src && srcEntry ? { gltf: src, entry: srcEntry } : undefined);
        this.templates.set(modelIndex, buildTemplate(cloneSkinned(gltf.scene), clips, this.underwater));
      })
      .catch((err) => console.warn(`blitz model ${modelIndex} failed to load`, err));
  }

  /** The untouched glTF of a model (shared as a retarget source). */
  private loadRaw(modelIndex: number): Promise<GLTF> {
    let p = this.raw.get(modelIndex);
    if (!p) {
      const entry = this.manifest?.models[String(modelIndex)];
      p = entry ? this.loader.loadAsync(`${this.baseUrl}${entry.path}`) : Promise.reject(new Error("no model"));
      this.raw.set(modelIndex, p);
    }
    return p;
  }

  private createInstance(modelIndex: number, template: Template, facing: number): Instance {
    const body = cloneSkinned(template.scene);
    const root = new THREE.Group();
    root.add(body);
    this.group.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const actions = {} as Record<ClipAction, THREE.AnimationAction>;
    for (const [name, clip] of Object.entries(template.clips) as [ClipAction, THREE.AnimationClip][]) {
      const a = mixer.clipAction(clip);
      if (!LOOPING.has(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions[name] = a;
    }
    const hand = template.hand ? (body.getObjectByName(template.hand) ?? null) : null;
    return { modelIndex, root, mixer, actions, current: null, facing, hand };
  }

  private play(inst: Instance, clip: ClipAction): void {
    if (inst.current === clip) return;
    const next = inst.actions[clip];
    next.reset().play();
    if (inst.current) inst.actions[inst.current].crossFadeTo(next, FADE_SECONDS, false);
    inst.current = clip;
  }

  private removeInstance(id: string): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.mixer.stopAllAction();
    inst.root.removeFromParent();
    this.instances.delete(id);
  }
}

function buildTemplate(
  scene: THREE.Object3D,
  clips: Record<ClipAction, THREE.AnimationClip>,
  underwater?: UnderwaterUniforms,
): Template {
  // FFX model space is Y-down; centre the body on the player's position
  const body = new THREE.Group();
  scene.rotation.x = Math.PI;
  scene.scale.setScalar(MODEL_SCALE);
  body.add(scene);
  body.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3());
  scene.position.sub(centre);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // skinned bounds do not follow the animation
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      mat.alphaTest = 0.5;
      mat.transparent = false;
      mat.side = THREE.DoubleSide;
      if (underwater) addCaustics(mat, underwater);
    }
  });
  return { scene: body, clips, hand: findHand(scene) };
}

/** The right hand: in the bind T-pose, the skin joint furthest out along the arm axis. */
function findHand(scene: THREE.Object3D): string | null {
  scene.updateMatrixWorld(true);
  const inv = scene.matrixWorld.clone().invert();
  let best: THREE.Object3D | null = null;
  let bestX = Number.NEGATIVE_INFINITY;
  const p = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    for (const b of m.skeleton.bones) {
      b.getWorldPosition(p).applyMatrix4(inv);
      if (p.x > bestX) {
        bestX = p.x;
        best = b;
      }
    }
  });
  return (best as THREE.Object3D | null)?.name ?? null;
}

/** Rotations only: the motions play in place (the simulation moves the players). */
function rotationsOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => t.name.endsWith(".quaternion"));
  return c;
}

/**
 * The per-action clips of a model as matches play them: cut from the model's own baked motion set, or, when the
 * manifest says so, cut from another model's set and retargeted onto this skeleton by joint position.
 */
export function actionClips(
  model: GLTF,
  entry: ManifestModel,
  fps: number,
  source?: { gltf: GLTF; entry: ManifestModel },
): Record<ClipAction, THREE.AnimationClip> {
  const clips = {} as Record<ClipAction, THREE.AnimationClip>;
  if (source) {
    const from = rotationsOnly(source.gltf.animations[0]);
    const srcScene = bindPoseCopy(source.gltf.scene);
    const dstScene = bindPoseCopy(model.scene);
    for (const [name, range] of Object.entries(source.entry.actions) as [ClipAction, ClipRange][]) {
      const cut = THREE.AnimationUtils.subclip(from, name, range.start, range.start + range.frames - 1, fps);
      clips[name] = retargetClip(srcScene, cut, dstScene, name, fps);
    }
    return clips;
  }
  const own = rotationsOnly(model.animations[0]);
  for (const [name, range] of Object.entries(entry.actions) as [ClipAction, ClipRange][]) {
    clips[name] = THREE.AnimationUtils.subclip(own, name, range.start, range.start + range.frames - 1, fps);
  }
  return clips;
}

/** A clone of a glTF scene with an identity root, in its bind pose. */
function bindPoseCopy(scene: THREE.Object3D): THREE.Object3D {
  const c = cloneSkinned(scene);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.scale.set(1, 1, 1);
  c.updateMatrixWorld(true);
  return c;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + d * (1 - Math.exp(-lambda * dt));
}
