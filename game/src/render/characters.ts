import * as THREE from "three";
import { type PlayerAction, type PlayerState, toWorld } from "./renderState";

export const MAX_CHARACTERS = 16;

// Joint vector layout (radians unless stated)
const J_PITCH = 0; // forward lean: 0 upright, ~PI/2 prone
const J_TWIST = 1; // torso yaw around the spine
const J_BOB = 2; // vertical offset (pool units)
const J_SHL_SWING = 3; // left shoulder forward(+)/back(-)
const J_SHL_ABD = 4; // left shoulder abduction (0 down, PI up)
const J_SHR_SWING = 5;
const J_SHR_ABD = 6;
const J_ELL = 7; // elbow bend
const J_ELR = 8;
const J_HIPL = 9; // hip swing forward(+)
const J_HIPR = 10;
const J_KNEEL = 11; // knee bend
const J_KNEER = 12;
const J_HEAD = 13; // head counter-tilt
const JOINT_COUNT = 14;

const BLEND_SECONDS = 0.15;

const TEAM_COLOURS: { primary: number; accent: number; keeperPrimary: number; keeperAccent: number }[] = [
  { primary: 0x2f6df6, accent: 0xffd54a, keeperPrimary: 0x1dd3c0, keeperAccent: 0x102030 },
  { primary: 0xe23b3b, accent: 0xf5f5f5, keeperPrimary: 0xff8c1a, keeperAccent: 0x102030 },
];
const SKIN = 0xd9a877;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dampAngle = (current: number, target: number, lambda: number, dt: number) => {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + d * (1 - Math.exp(-lambda * dt));
};

/**
 * Fill `out` with the target joint vector for an action.
 * @param t seconds since the action started
 * @param phase accumulated stroke phase (radians)
 * @param speed 0..1
 */
function computePose(out: Float32Array, action: PlayerAction, t: number, phase: number, speed: number): void {
  out.fill(0);
  switch (action) {
    case "idle": {
      out[J_PITCH] = 0.1;
      out[J_BOB] = Math.sin(t * 2) * 0.12;
      const s = Math.sin(t * 2.2);
      out[J_SHL_ABD] = 1.1 + s * 0.25;
      out[J_SHR_ABD] = 1.1 - s * 0.25;
      out[J_SHL_SWING] = s * 0.3;
      out[J_SHR_SWING] = -s * 0.3;
      out[J_ELL] = 0.6;
      out[J_ELR] = 0.6;
      const k = Math.sin(t * 3.1);
      out[J_HIPL] = k * 0.4;
      out[J_HIPR] = -k * 0.4;
      out[J_KNEEL] = 0.5 + k * 0.2;
      out[J_KNEER] = 0.5 - k * 0.2;
      break;
    }
    case "swim":
    case "sprint": {
      const sprint = action === "sprint";
      out[J_PITCH] = Math.PI / 2 - 0.2 + (sprint ? 0.1 : 0);
      out[J_BOB] = Math.sin(phase) * 0.05;
      out[J_TWIST] = Math.sin(phase) * (sprint ? 0.25 : 0.15);
      // crawl stroke: continuous shoulder rotation, opposite arms
      out[J_SHL_SWING] = phase;
      out[J_SHR_SWING] = phase + Math.PI;
      out[J_SHL_ABD] = 0.35;
      out[J_SHR_ABD] = 0.35;
      out[J_ELL] = 0.5 + 0.5 * Math.max(0, Math.sin(phase));
      out[J_ELR] = 0.5 + 0.5 * Math.max(0, Math.sin(phase + Math.PI));
      const kick = Math.sin(phase * 2) * (0.3 + speed * 0.2);
      out[J_HIPL] = kick;
      out[J_HIPR] = -kick;
      out[J_KNEEL] = 0.35 + Math.max(0, -kick) * 0.6;
      out[J_KNEER] = 0.35 + Math.max(0, kick) * 0.6;
      out[J_HEAD] = -0.9;
      break;
    }
    case "pass":
    case "shoot": {
      const strong = action === "shoot";
      const windupEnd = strong ? 0.18 : 0.12;
      const throwEnd = windupEnd + (strong ? 0.22 : 0.2);
      let swing: number;
      if (t < windupEnd) swing = lerp(0.2, -2.3, smooth(t / windupEnd));
      else if (t < throwEnd) swing = lerp(-2.3, 1.3, smooth((t - windupEnd) / (throwEnd - windupEnd)));
      else swing = lerp(1.3, 0.6, smooth((t - throwEnd) / 0.4));
      const release = t < windupEnd ? 0 : t < throwEnd ? smooth((t - windupEnd) / (throwEnd - windupEnd)) : 1;
      out[J_PITCH] = 0.35 + release * (strong ? 0.4 : 0.2);
      out[J_TWIST] = lerp(-0.5, 0.6, release) * (strong ? 1.3 : 1);
      out[J_BOB] = strong ? Math.sin(release * Math.PI) * 0.25 : 0;
      out[J_SHR_SWING] = swing;
      out[J_SHR_ABD] = 0.5;
      out[J_ELR] = lerp(1.3, 0.15, release);
      if (strong) {
        out[J_SHL_SWING] = swing * 0.8;
        out[J_SHL_ABD] = 0.5;
        out[J_ELL] = lerp(1.2, 0.2, release);
      } else {
        out[J_SHL_SWING] = -0.3;
        out[J_SHL_ABD] = 0.9;
        out[J_ELL] = 0.8;
      }
      out[J_HIPL] = 0.3 - release * 0.5;
      out[J_HIPR] = -0.3 + release * 0.6;
      out[J_KNEEL] = 0.4;
      out[J_KNEER] = 0.4;
      break;
    }
    case "tackle": {
      const u = smooth(t / 0.25);
      out[J_PITCH] = lerp(0.8, 1.5, u);
      out[J_BOB] = -0.2 * u;
      out[J_SHL_SWING] = lerp(0.5, 2.7, u);
      out[J_SHR_SWING] = lerp(0.5, 2.7, u);
      out[J_SHL_ABD] = 0.35;
      out[J_SHR_ABD] = 0.35;
      out[J_ELL] = 0.2;
      out[J_ELR] = 0.2;
      const kick = Math.sin(t * 14) * 0.3;
      out[J_HIPL] = -0.3 + kick;
      out[J_HIPR] = -0.3 - kick;
      out[J_KNEEL] = 0.3;
      out[J_KNEER] = 0.3;
      out[J_HEAD] = -0.8;
      break;
    }
    case "block": {
      out[J_PITCH] = 0.05;
      out[J_BOB] = Math.sin(t * 6) * 0.06;
      out[J_SHL_ABD] = Math.PI * 0.86;
      out[J_SHR_ABD] = Math.PI * 0.86;
      out[J_SHL_SWING] = 0.15;
      out[J_SHR_SWING] = 0.15;
      out[J_ELL] = 0.15;
      out[J_ELR] = 0.15;
      out[J_HIPL] = 0.35;
      out[J_HIPR] = -0.35;
      out[J_KNEEL] = 0.6;
      out[J_KNEER] = 0.6;
      break;
    }
    case "catch": {
      out[J_PITCH] = 0.4;
      out[J_SHL_SWING] = 1.5;
      out[J_SHR_SWING] = 1.5;
      out[J_SHL_ABD] = 0.45;
      out[J_SHR_ABD] = 0.45;
      out[J_ELL] = 0.9;
      out[J_ELR] = 0.9;
      out[J_HIPL] = 0.2;
      out[J_HIPR] = -0.2;
      out[J_KNEEL] = 0.5;
      out[J_KNEER] = 0.5;
      break;
    }
    case "hit": {
      const decay = Math.exp(-t * 4);
      out[J_PITCH] = -0.55 * decay - 0.05;
      out[J_BOB] = 0.35 * decay;
      out[J_TWIST] = Math.sin(t * 25) * 0.25 * decay;
      out[J_SHL_SWING] = -1.0 * decay;
      out[J_SHR_SWING] = -1.0 * decay;
      out[J_SHL_ABD] = 1.3;
      out[J_SHR_ABD] = 1.3;
      out[J_ELL] = 0.4;
      out[J_ELR] = 0.4;
      out[J_HIPL] = 0.6 * decay;
      out[J_HIPR] = 0.6 * decay;
      out[J_KNEEL] = 0.2;
      out[J_KNEER] = 0.2;
      out[J_HEAD] = 0.5 * decay;
      break;
    }
    case "celebrate": {
      out[J_PITCH] = -0.05;
      out[J_BOB] = Math.abs(Math.sin(t * 6)) * 0.5;
      out[J_TWIST] = Math.sin(t * 4) * 0.3;
      out[J_SHL_ABD] = 2.6 + Math.sin(t * 8) * 0.4;
      out[J_SHR_ABD] = 2.6 - Math.sin(t * 8) * 0.4;
      out[J_ELL] = 0.5;
      out[J_ELR] = 0.5;
      out[J_HIPL] = Math.sin(t * 6) * 0.3;
      out[J_HIPR] = -Math.sin(t * 6) * 0.3;
      out[J_KNEEL] = 0.4;
      out[J_KNEER] = 0.4;
      break;
    }
  }
}

interface Part {
  leaf: THREE.Object3D;
  mesh: THREE.InstancedMesh;
  index: number;
  colour: THREE.Color;
}

interface Rig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  parts: Part[];
}

interface Slot {
  index: number;
  id: string | null;
  rig: Rig;
  action: PlayerAction;
  actionTime: number;
  phase: number;
  facing: number;
  pose: Float32Array;
  fromPose: Float32Array;
  target: Float32Array;
  blend: number;
  colourKey: string;
}

function makeIconTexture(kind: "poison" | "sleep" | "wither"): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const colours = { poison: "#5fe86a", sleep: "#5aa8ff", wither: "#b86bff" };
    ctx.fillStyle = colours[kind];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
    ctx.fillStyle = "#06101a";
    ctx.font = `bold ${size * 0.55}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const glyph = kind === "poison" ? "☠" : kind === "sleep" ? "Z" : "↓";
    ctx.fillText(glyph, size / 2, size / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();

export class CharacterSystem {
  readonly group = new THREE.Group();
  private readonly rigRoot = new THREE.Object3D();
  private readonly slots: Slot[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly hpBg: THREE.InstancedMesh;
  private readonly hpFill: THREE.InstancedMesh;
  private readonly statusMeshes: Record<"poison" | "sleep" | "wither", THREE.InstancedMesh>;
  private readonly ring: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;

  constructor() {
    const torsoGeo = new THREE.CapsuleGeometry(0.55, 1.1, 4, 10);
    const headGeo = new THREE.SphereGeometry(0.42, 12, 10);
    const capGeo = new THREE.SphereGeometry(0.46, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const shortsGeo = new THREE.CylinderGeometry(0.58, 0.5, 0.5, 10);
    const limbGeo = new THREE.CapsuleGeometry(0.17, 0.7, 3, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
    const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    this.disposables.push(torsoGeo, headGeo, capGeo, shortsGeo, limbGeo, bodyMat, skinMat);

    const N = MAX_CHARACTERS;
    const torso = new THREE.InstancedMesh(torsoGeo, bodyMat, N);
    const head = new THREE.InstancedMesh(headGeo, skinMat, N);
    const cap = new THREE.InstancedMesh(capGeo, bodyMat, N);
    const shorts = new THREE.InstancedMesh(shortsGeo, bodyMat, N);
    const limbs = new THREE.InstancedMesh(limbGeo, bodyMat, N * 8);
    this.meshes.push(torso, head, cap, shorts, limbs);
    for (const m of this.meshes) {
      m.frustumCulled = false;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, _hidden);
      this.group.add(m);
    }

    for (let i = 0; i < N; i++) {
      const rig = this.buildRig(i, { torso, head, cap, shorts, limbs });
      this.rigRoot.add(rig.root);
      this.slots.push({
        index: i,
        id: null,
        rig,
        action: "idle",
        actionTime: 0,
        phase: Math.random() * Math.PI * 2,
        facing: 0,
        pose: new Float32Array(JOINT_COUNT),
        fromPose: new Float32Array(JOINT_COUNT),
        target: new Float32Array(JOINT_COUNT),
        blend: 1,
        colourKey: "",
      });
    }

    // HP bars
    const barGeo = new THREE.PlaneGeometry(1, 1);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x101820, transparent: true, opacity: 0.75, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
    this.disposables.push(barGeo, bgMat, fillMat);
    this.hpBg = new THREE.InstancedMesh(barGeo, bgMat, N);
    this.hpFill = new THREE.InstancedMesh(barGeo, fillMat, N);
    this.hpBg.renderOrder = 30;
    this.hpFill.renderOrder = 31;
    this.hpBg.frustumCulled = false;
    this.hpFill.frustumCulled = false;
    for (let i = 0; i < N; i++) {
      this.hpBg.setMatrixAt(i, _hidden);
      this.hpFill.setMatrixAt(i, _hidden);
    }
    this.group.add(this.hpBg, this.hpFill);

    // Status icons
    const iconGeo = new THREE.PlaneGeometry(0.9, 0.9);
    this.disposables.push(iconGeo);
    const makeIconMesh = (kind: "poison" | "sleep" | "wither") => {
      const tex = makeIconTexture(kind);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      this.disposables.push(tex, mat);
      const mesh = new THREE.InstancedMesh(iconGeo, mat, N);
      mesh.renderOrder = 32;
      mesh.frustumCulled = false;
      // Unused slots would otherwise draw at the origin
      for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _hidden);
      this.group.add(mesh);
      return mesh;
    };
    this.statusMeshes = {
      poison: makeIconMesh("poison"),
      sleep: makeIconMesh("sleep"),
      wither: makeIconMesh("wither"),
    };

    // Selection ring
    const ringGeo = new THREE.TorusGeometry(1.5, 0.08, 6, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(ringGeo, ringMat);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private buildRig(
    index: number,
    meshes: {
      torso: THREE.InstancedMesh;
      head: THREE.InstancedMesh;
      cap: THREE.InstancedMesh;
      shorts: THREE.InstancedMesh;
      limbs: THREE.InstancedMesh;
    },
  ): Rig {
    const parts: Part[] = [];
    const leaf = (
      parent: THREE.Object3D,
      mesh: THREE.InstancedMesh,
      idx: number,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
    ) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      parent.add(o);
      parts.push({ leaf: o, mesh, index: idx, colour: new THREE.Color(0xffffff) });
      return o;
    };
    const node = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };

    const root = new THREE.Object3D();
    const body = node(root, 0, 0, 0);
    leaf(body, meshes.torso, index, 0, 0, 0);
    leaf(body, meshes.shorts, index, 0, -0.62, 0);
    const head = node(body, 0, 1.2, 0);
    leaf(head, meshes.head, index, 0, 0, 0);
    leaf(head, meshes.cap, index, 0, 0.02, 0, 1, 1.05, 1);

    let limb = index * 8;
    // Right side is +z, left is -z (model faces +x, up +y).
    const shoulderR = node(body, 0, 0.6, 0.65);
    leaf(shoulderR, meshes.limbs, limb++, 0, -0.42, 0, 1, 1, 1);
    const elbowR = node(shoulderR, 0, -0.82, 0);
    leaf(elbowR, meshes.limbs, limb++, 0, -0.38, 0, 0.85, 0.9, 0.85);
    const shoulderL = node(body, 0, 0.6, -0.65);
    leaf(shoulderL, meshes.limbs, limb++, 0, -0.42, 0, 1, 1, 1);
    const elbowL = node(shoulderL, 0, -0.82, 0);
    leaf(elbowL, meshes.limbs, limb++, 0, -0.38, 0, 0.85, 0.9, 0.85);
    const hipR = node(body, 0, -0.8, 0.28);
    leaf(hipR, meshes.limbs, limb++, 0, -0.48, 0, 1.15, 1.15, 1.15);
    const kneeR = node(hipR, 0, -0.95, 0);
    leaf(kneeR, meshes.limbs, limb++, 0, -0.42, 0, 0.95, 1.05, 0.95);
    const hipL = node(body, 0, -0.8, -0.28);
    leaf(hipL, meshes.limbs, limb++, 0, -0.48, 0, 1.15, 1.15, 1.15);
    const kneeL = node(hipL, 0, -0.95, 0);
    leaf(kneeL, meshes.limbs, limb++, 0, -0.42, 0, 0.95, 1.05, 0.95);

    return { root, body, head, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR, parts };
  }

  private applyColours(slot: Slot, team: 0 | 1, keeper: boolean): void {
    const key = `${team}:${keeper ? 1 : 0}`;
    if (slot.colourKey === key) return;
    slot.colourKey = key;
    const tc = TEAM_COLOURS[team];
    const primary = keeper ? tc.keeperPrimary : tc.primary;
    const accent = keeper ? tc.keeperAccent : tc.accent;
    const parts = slot.rig.parts;
    // part order: torso, shorts, head, cap, armR, foreR, armL, foreL, thighR, shinR, thighL, shinL
    const colours = [
      primary,
      accent,
      SKIN,
      accent,
      primary,
      accent,
      primary,
      accent,
      primary,
      primary,
      primary,
      primary,
    ];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      part.colour.setHex(colours[i]);
      part.mesh.setColorAt(part.index, part.colour);
      const ic = part.mesh.instanceColor;
      if (ic) ic.needsUpdate = true;
    }
  }

  private slotFor(id: string): Slot | null {
    for (const s of this.slots) if (s.id === id) return s;
    for (const s of this.slots) {
      if (s.id === null) {
        s.id = id;
        s.colourKey = "";
        s.blend = 1;
        s.actionTime = 0;
        return s;
      }
    }
    return null;
  }

  /** Where the carrier's "hands" are in world space, for ball attachment helpers. */
  getHandWorldPosition(id: string, out: THREE.Vector3): boolean {
    for (const s of this.slots) {
      if (s.id === id) {
        s.rig.elbowR.getWorldPosition(out);
        return true;
      }
    }
    return false;
  }

  update(
    players: readonly PlayerState[],
    dt: number,
    camera: THREE.Camera,
    selectedId: string | null | undefined,
    /** Players drawn by another system (e.g. the original models): keep their HP bar/status/ring, skip the body. */
    hideBodies?: ReadonlySet<string>,
  ): void {
    this.time += dt;
    const seen = new Set<string>();
    const w = { x: 0, y: 0, z: 0 };

    camera.updateMatrixWorld();
    _q.setFromRotationMatrix(camera.matrixWorld);
    _right.set(1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);

    for (const p of players) {
      const slot = this.slotFor(p.id);
      if (!slot) break;
      seen.add(p.id);
      this.applyColours(slot, p.team, p.isKeeper === true);

      if (p.action !== slot.action) {
        slot.fromPose.set(slot.pose);
        slot.action = p.action;
        slot.actionTime = 0;
        slot.blend = 0;
      }
      slot.actionTime += dt;
      const strokeRate = p.action === "sprint" ? 2.4 : p.action === "swim" ? 1.4 : 0.6;
      slot.phase += dt * Math.PI * 2 * (strokeRate * (0.35 + p.speed * 0.9));

      computePose(slot.target, p.action, slot.actionTime, slot.phase, p.speed);
      if (slot.blend < 1) {
        slot.blend = Math.min(1, slot.blend + dt / BLEND_SECONDS);
        const k = smooth(slot.blend);
        for (let j = 0; j < JOINT_COUNT; j++) slot.pose[j] = lerp(slot.fromPose[j], slot.target[j], k);
      } else {
        slot.pose.set(slot.target);
      }

      // Pose -> rig
      const r = slot.rig;
      const pose = slot.pose;
      toWorld(p.position, w);
      slot.facing = dampAngle(slot.facing, p.facing, 14, dt);
      r.root.position.set(w.x, w.y, w.z);
      r.root.rotation.set(0, slot.facing, -pose[J_PITCH], "YZX");
      r.body.position.y = pose[J_BOB];
      r.body.rotation.y = pose[J_TWIST];
      r.head.rotation.z = pose[J_HEAD] * -1;
      r.shoulderL.rotation.set(pose[J_SHL_ABD], 0, pose[J_SHL_SWING], "XZY");
      r.shoulderR.rotation.set(-pose[J_SHR_ABD], 0, pose[J_SHR_SWING], "XZY");
      r.elbowL.rotation.z = pose[J_ELL];
      r.elbowR.rotation.z = pose[J_ELR];
      r.hipL.rotation.z = pose[J_HIPL];
      r.hipR.rotation.z = pose[J_HIPR];
      r.kneeL.rotation.z = -pose[J_KNEEL];
      r.kneeR.rotation.z = -pose[J_KNEER];
      r.root.updateMatrixWorld(true);
      const hidden = hideBodies?.has(p.id) === true;
      for (const part of r.parts) part.mesh.setMatrixAt(part.index, hidden ? _hidden : part.leaf.matrixWorld);

      // HP bar (billboard)
      const barW = 2.2;
      _v.set(w.x, w.y + 2.4, w.z);
      _s.set(barW + 0.12, 0.32, 1);
      _m.compose(_v, _q, _s);
      this.hpBg.setMatrixAt(this.slotIndex(slot), _m);
      const hp = Math.min(1, Math.max(0, p.hp));
      _v.addScaledVector(_right, (-(1 - hp) * barW) / 2);
      _s.set(Math.max(0.0001, barW * hp), 0.2, 1);
      _m.compose(_v, _q, _s);
      this.hpFill.setMatrixAt(this.slotIndex(slot), _m);
      _col.setHSL(hp * 0.33, 0.9, 0.5);
      this.hpFill.setColorAt(this.slotIndex(slot), _col);

      // Status icons
      let iconSlot = 0;
      const active = { poison: false, sleep: false, wither: false };
      for (const st of p.statuses) {
        if (st === "poison" || st === "sleep" || st === "wither") active[st] = true;
      }
      const activeCount = (active.poison ? 1 : 0) + (active.sleep ? 1 : 0) + (active.wither ? 1 : 0);
      for (const kind of ["poison", "sleep", "wither"] as const) {
        const mesh = this.statusMeshes[kind];
        if (!active[kind]) {
          mesh.setMatrixAt(this.slotIndex(slot), _hidden);
          continue;
        }
        const offset = (iconSlot - (activeCount - 1) / 2) * 1.0;
        iconSlot++;
        _v.set(w.x, w.y + 3.1 + Math.sin(this.time * 3 + iconSlot) * 0.08, w.z);
        _v.addScaledVector(_right, offset);
        _s.set(1, 1, 1);
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(this.slotIndex(slot), _m);
      }

      if (selectedId && p.id === selectedId) {
        this.ring.visible = true;
        this.ring.position.set(w.x, w.y - 2.0, w.z);
        this.ring.rotation.z = this.time * 1.5;
        this.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.06);
      }
    }
    if (!selectedId || !seen.has(selectedId)) this.ring.visible = false;

    // Release slots for players that disappeared
    for (const slot of this.slots) {
      if (slot.id !== null && !seen.has(slot.id)) {
        slot.id = null;
        const i = this.slotIndex(slot);
        for (const part of slot.rig.parts) part.mesh.setMatrixAt(part.index, _hidden);
        this.hpBg.setMatrixAt(i, _hidden);
        this.hpFill.setMatrixAt(i, _hidden);
        for (const kind of ["poison", "sleep", "wither"] as const) this.statusMeshes[kind].setMatrixAt(i, _hidden);
      }
    }

    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.hpBg.instanceMatrix.needsUpdate = true;
    this.hpFill.instanceMatrix.needsUpdate = true;
    if (this.hpFill.instanceColor) this.hpFill.instanceColor.needsUpdate = true;
    for (const kind of ["poison", "sleep", "wither"] as const)
      this.statusMeshes[kind].instanceMatrix.needsUpdate = true;
  }

  private slotIndex(slot: Slot): number {
    return slot.index;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const m of this.meshes) m.dispose();
    this.hpBg.dispose();
    this.hpFill.dispose();
    for (const kind of ["poison", "sleep", "wither"] as const) this.statusMeshes[kind].dispose();
    this.group.removeFromParent();
  }
}
