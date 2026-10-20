import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type PoolBounds, poolCentreWorld } from "./renderState";

export type CameraMode = "broadcast" | "tactical" | "orbit";

export interface CameraContext {
  /** World-space point of interest (ball or carrier). */
  focus: THREE.Vector3;
  /** World-space ball position. */
  ball: THREE.Vector3;
  /** True while a shoot/tackle is in progress: eases in a tighter framing. */
  zoom: boolean;
}

const BROADCAST_FOV = 48;
const ZOOM_FOV = 34;

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "broadcast";
  private readonly controls: OrbitControls;
  private readonly centre = new THREE.Vector3();
  private pool: PoolBounds;
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private zoomAmount = 0;
  private initialised = false;

  constructor(domElement: HTMLElement, pool: PoolBounds, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BROADCAST_FOV, aspect, 0.5, 600);
    this.pool = pool;
    const c = poolCentreWorld(pool);
    this.centre.set(c.x, c.y, c.z);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this.centre);
    this.controls.minDistance = 10;
    this.controls.maxDistance = 250;
    this.controls.enabled = false;
    this.camera.position.set(c.x, c.y + 20, c.z + 70);
    this.camera.lookAt(this.centre);
  }

  setPool(pool: PoolBounds): void {
    this.pool = pool;
    const c = poolCentreWorld(pool);
    this.centre.set(c.x, c.y, c.z);
    this.controls.target.copy(this.centre);
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "orbit") {
      this.controls.target.copy(this.lookTarget.lengthSq() > 0 ? this.lookTarget : this.centre);
      this.controls.update();
    }
    if (mode === "tactical") {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, ctx: CameraContext): void {
    const safeDt = Math.min(0.1, Math.max(0, dt));
    const p = this.pool;
    const c = this.centre;
    const W = p.maxX - p.minX;
    const D = p.maxY - p.minY;
    const H = p.maxZ - p.minZ;

    switch (this.mode) {
      case "broadcast": {
        this.zoomAmount = damp(this.zoomAmount, ctx.zoom ? 1 : 0, ctx.zoom ? 5 : 2.5, safeDt);
        const z = this.zoomAmount;
        // Sideline rig on the +z side, following the x of the action, slightly above the pool.
        const fx = THREE.MathUtils.clamp(ctx.focus.x, p.minX, p.maxX);
        const trackX = c.x + (fx - c.x) * 0.8;
        const sideDist = D / 2 + W * 0.62 * (1 - 0.3 * z);
        const height = p.maxZ + H * 0.38 * (1 - 0.35 * z);
        this.desiredPos.set(trackX, height, c.z + sideDist);
        this.desiredLook.set(
          THREE.MathUtils.lerp(c.x, fx, 0.85),
          THREE.MathUtils.lerp(c.y, ctx.focus.y, 0.5 + 0.4 * z),
          THREE.MathUtils.lerp(c.z, ctx.focus.z, 0.45 + 0.4 * z),
        );
        if (!this.initialised) {
          this.camera.position.copy(this.desiredPos);
          this.lookTarget.copy(this.desiredLook);
          this.initialised = true;
        }
        const k = 1 - Math.exp(-safeDt * 3.2);
        this.camera.position.lerp(this.desiredPos, k);
        this.lookTarget.lerp(this.desiredLook, 1 - Math.exp(-safeDt * 4.5));
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(this.lookTarget);
        const fov = THREE.MathUtils.lerp(BROADCAST_FOV, ZOOM_FOV, z);
        if (Math.abs(fov - this.camera.fov) > 0.01) {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
        break;
      }
      case "tactical": {
        this.desiredPos.set(c.x, p.maxZ + Math.max(W, D) * 1.15, c.z + 0.01);
        this.desiredLook.copy(c);
        const k = 1 - Math.exp(-safeDt * 4);
        this.camera.position.lerp(this.desiredPos, k);
        this.lookTarget.lerp(this.desiredLook, k);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(this.lookTarget);
        break;
      }
      case "orbit": {
        this.camera.up.set(0, 1, 0);
        this.controls.update();
        this.lookTarget.copy(this.controls.target);
        break;
      }
    }
  }

  dispose(): void {
    this.controls.dispose();
  }
}
