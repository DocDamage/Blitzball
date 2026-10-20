import * as THREE from "three";
import { BallView } from "./ball";
import { type CameraMode, CameraRig } from "./camera";
import { OriginalCharacterSystem } from "./originalCharacters";
import { type PoolBounds, type RenderSnapshot, toWorld } from "./renderState";
import { createScene, createStadium, createWebGLRenderer, type Stadium } from "./scene";
import { Vfx } from "./vfx";

export type { CameraMode } from "./camera";
export * from "./renderState";

export interface BlitzRenderer {
  /** Draw one frame from a snapshot. `dt` is seconds since the previous update. */
  update(snapshot: RenderSnapshot, dt: number): void;
  setCamera(mode: CameraMode): void;
  getCamera(): CameraMode;
  /** Re-read the container size. Called automatically via ResizeObserver, but safe to call manually. */
  resize(): void;
  dispose(): void;
  vfx: Vfx;
  /** Underlying Three objects for debugging/integration. */
  three: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera };
}

const DEFAULT_POOL: PoolBounds = { minX: -30, maxX: 30, minY: -20, maxY: 20, minZ: 0, maxZ: 30 };

function poolKey(p: PoolBounds): string {
  return `${p.minX},${p.maxX},${p.minY},${p.maxY},${p.minZ},${p.maxZ}`;
}

export function createRenderer(container: HTMLElement, initialPool: PoolBounds = DEFAULT_POOL): BlitzRenderer {
  const renderer = createWebGLRenderer(container);
  const scene = createScene();
  const rig = new CameraRig(renderer.domElement, initialPool, aspectOf(container));
  const characters = new OriginalCharacterSystem();
  const ball = new BallView();
  const vfx = new Vfx(initialPool);
  scene.add(characters.group, ball.group, vfx.group);

  let stadium: Stadium = createStadium(initialPool);
  let currentPoolKey = poolKey(initialPool);
  scene.add(stadium.group);

  let contextLost = false;
  let disposed = false;
  let time = 0;

  const onLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
  };
  const onRestored = () => {
    contextLost = false;
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost, false);
  renderer.domElement.addEventListener("webglcontextrestored", onRestored, false);

  const focus = new THREE.Vector3();
  const ballWorld = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const tmp = { x: 0, y: 0, z: 0 };

  function resize(): void {
    if (disposed) return;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    rig.setAspect(w / h);
  }

  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  observer?.observe(container);
  window.addEventListener("resize", resize);

  function ensurePool(pool: PoolBounds): void {
    const key = poolKey(pool);
    if (key === currentPoolKey) return;
    currentPoolKey = key;
    stadium.dispose();
    stadium = createStadium(pool);
    scene.add(stadium.group);
    rig.setPool(pool);
    vfx.setPool(pool);
  }

  function update(snapshot: RenderSnapshot, dt: number): void {
    if (disposed) return;
    const safeDt = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 1 / 60;
    time += safeDt;
    ensurePool(snapshot.pool);

    stadium.update(time);
    characters.update(snapshot.players, safeDt, rig.camera, snapshot.selectedPlayerId, snapshot.ball.carrierId);
    const carrier = snapshot.ball.carrierId;
    const held = carrier !== null && characters.getHandWorldPosition(carrier, handPos) ? handPos : null;
    ball.update(snapshot.ball, safeDt, held);
    vfx.update(safeDt);

    // Camera focus: carrier if any, else ball; zoom on shoot/tackle
    toWorld(snapshot.ball.position, tmp);
    ballWorld.set(tmp.x, tmp.y, tmp.z);
    focus.copy(ballWorld);
    let zoom = false;
    for (const p of snapshot.players) {
      if (p.action === "shoot" || p.action === "tackle") {
        zoom = true;
        toWorld(p.position, tmp);
        focus.set(tmp.x, tmp.y, tmp.z).lerp(ballWorld, 0.4);
      }
    }
    if (!zoom && snapshot.ball.carrierId !== null) {
      for (const p of snapshot.players) {
        if (p.id === snapshot.ball.carrierId) {
          toWorld(p.position, tmp);
          focus.set(tmp.x, tmp.y, tmp.z);
          break;
        }
      }
    }
    rig.update(safeDt, { focus, ball: ballWorld, zoom });

    if (contextLost) return;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x < 1 || size.y < 1) return;
    try {
      renderer.render(scene, rig.camera);
    } catch (err) {
      // Keep the loop alive; a lost context or a transient shader error should not kill the app.
      console.error("[render] frame failed", err);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    renderer.domElement.removeEventListener("webglcontextlost", onLost);
    renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
    stadium.dispose();
    characters.dispose();
    ball.dispose();
    vfx.dispose();
    rig.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    update,
    setCamera: (mode) => rig.setMode(mode),
    getCamera: () => rig.getMode(),
    resize,
    dispose,
    vfx,
    three: { renderer, scene, camera: rig.camera },
  };
}

function aspectOf(container: HTMLElement): number {
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  return w / h;
}
