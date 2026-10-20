import * as THREE from "three";

/**
 * Retargets a motion from one FFX skeleton to another by joint position, not bone index.
 *
 * The team models were built on several different generic bodies, but the match motion pack only carries motions
 * for a few of them, and Noesis binds motion channels by bone index. So instead each target joint is paired with
 * the source joint nearest to it in the (height-normalised) bind pose, and every frame the source bone's rotation
 * away from its bind pose, measured in model space, is applied to the paired target bone. Both rigs are authored in
 * the same model space and bind pose (T-pose), which is what makes the world-space delta transferable.
 *
 * Both `source` and `target` must be untransformed glTF scenes in their bind pose.
 */
export function retargetClip(
  source: THREE.Object3D,
  sourceClip: THREE.AnimationClip,
  target: THREE.Object3D,
  name: string,
  fps: number,
): THREE.AnimationClip {
  const src = rig(source);
  const dst = rig(target);
  const pairs = matchJoints(src, dst);

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(sourceClip);
  action.play();

  const frames = Math.max(1, Math.round(sourceClip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const values = dst.bones.map(() => new Float32Array(frames * 4));
  const delta = new THREE.Quaternion();
  const world = new Map<THREE.Object3D, THREE.Quaternion>();
  const q = new THREE.Quaternion();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(f / fps, sourceClip.duration);
    times[f] = t;
    mixer.setTime(t);
    source.updateMatrixWorld(true);
    world.clear();
    // Target bones are ordered parents-first, so each parent's posed world rotation is known before its children
    dst.bones.forEach((bone, i) => {
      const parentWorld = parentRotation(bone, dst.root, world);
      const s = pairs[i];
      let posedWorld: THREE.Quaternion;
      if (s) {
        // delta = posed * bind^-1 for the source joint, applied to the target joint's bind rotation
        s.getWorldQuaternion(q);
        delta.copy(q).multiply(src.bindWorld.get(s)?.clone().invert() ?? new THREE.Quaternion());
        posedWorld = delta.clone().multiply(dst.bindWorld.get(bone) ?? new THREE.Quaternion());
      } else {
        // Unpaired joints keep their bind pose relative to their parent
        posedWorld = parentWorld.clone().multiply(bone.quaternion);
      }
      world.set(bone, posedWorld);
      const local = parentWorld.clone().invert().multiply(posedWorld);
      local.toArray(values[i], f * 4);
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(source);
  source.updateMatrixWorld(true);

  const tracks = dst.bones.map(
    (bone, i) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[i]),
  );
  return new THREE.AnimationClip(name, sourceClip.duration, tracks);
}

interface Rig {
  root: THREE.Object3D;
  /** Skin joints and their bone ancestors, parents before children. */
  bones: THREE.Object3D[];
  /** Joints that deform the mesh (only these are matched as sources). */
  joints: Set<THREE.Object3D>;
  bindWorld: Map<THREE.Object3D, THREE.Quaternion>;
  /** Bind positions relative to the skeleton root, divided by the skeleton height. */
  normalised: Map<THREE.Object3D, THREE.Vector3>;
}

function rig(root: THREE.Object3D): Rig {
  root.updateMatrixWorld(true);
  const joints = new Set<THREE.Object3D>();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) for (const b of m.skeleton.bones) joints.add(b);
  });
  // Joints plus any ancestors between them and the scene root
  const set = new Set<THREE.Object3D>();
  for (const j of joints) {
    let o: THREE.Object3D | null = j;
    while (o && o !== root && !(o as THREE.Mesh).isMesh) {
      set.add(o);
      o = o.parent;
    }
  }
  const bones: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (set.has(o)) bones.push(o);
  });
  const bindWorld = new Map<THREE.Object3D, THREE.Quaternion>();
  const pos = new Map<THREE.Object3D, THREE.Vector3>();
  const rootInv = root.matrixWorld.clone().invert();
  const rootQInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const b of bones) {
    bindWorld.set(b, rootQInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    pos.set(b, b.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv));
  }
  const box = new THREE.Box3();
  for (const j of joints) box.expandByPoint(pos.get(j) ?? new THREE.Vector3());
  const height = Math.max(1e-6, box.max.y - box.min.y);
  const origin = box.getCenter(new THREE.Vector3());
  const normalised = new Map<THREE.Object3D, THREE.Vector3>();
  for (const b of bones)
    normalised.set(b, (pos.get(b) ?? new THREE.Vector3()).clone().sub(origin).divideScalar(height));
  return { root, bones, joints, bindWorld, normalised };
}

/** For each target bone, the nearest deforming source joint (null when nothing is close). */
function matchJoints(src: Rig, dst: Rig): (THREE.Object3D | null)[] {
  const candidates = [...src.joints];
  return dst.bones.map((b) => {
    if (!dst.joints.has(b)) return null;
    const p = dst.normalised.get(b) ?? new THREE.Vector3();
    let best: THREE.Object3D | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const d = p.distanceToSquared(src.normalised.get(c) ?? new THREE.Vector3());
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD < 0.15 * 0.15 ? best : null;
  });
}

function parentRotation(
  bone: THREE.Object3D,
  root: THREE.Object3D,
  posed: Map<THREE.Object3D, THREE.Quaternion>,
): THREE.Quaternion {
  const p = bone.parent;
  if (!p || p === root) return new THREE.Quaternion();
  const known = posed.get(p);
  if (known) return known;
  // A non-bone ancestor: its rest rotation relative to the scene root
  const rootQInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return rootQInv.multiply(p.getWorldQuaternion(new THREE.Quaternion()));
}
