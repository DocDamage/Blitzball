import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type BallState, toWorld } from "./renderState";
import { addCaustics, type UnderwaterUniforms } from "./underwater";

export const BALL_RADIUS = 0.65;
const TRAIL_POINTS = 28;
const ORIGINAL_BALL_URL = "/ffx/models/type4/mdl0025/model.gltf";

function makeBallTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // base: cream with a faint blue vignette near the poles
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#b9c7d6");
    grad.addColorStop(0.25, "#efe9db");
    grad.addColorStop(0.75, "#efe9db");
    grad.addColorStop(1, "#b9c7d6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // panel tint stripes
    ctx.fillStyle = "rgba(30, 70, 140, 0.18)";
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h / 2 + Math.sin((x / w) * Math.PI * 2 * 2 + (k * Math.PI) / 2) * 58;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let x = w; x >= 0; x -= 8) {
        const y = h / 2 + Math.sin((x / w) * Math.PI * 2 * 2 + (k * Math.PI) / 2) * 58 + 26;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (k % 2 === 0) ctx.fill();
    }

    // seams
    const seam = (fn: (x: number) => number) => {
      ctx.strokeStyle = "#1b2a44";
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = fn(x);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // stitches perpendicular to the seam
      ctx.strokeStyle = "#e9eef5";
      ctx.lineWidth = 2;
      for (let x = 6; x < w; x += 16) {
        const y = fn(x);
        const dy = (fn(x + 4) - fn(x - 4)) / 8;
        const nx = -dy;
        const ny = 1;
        const len = 1 / Math.hypot(nx, ny);
        ctx.beginPath();
        ctx.moveTo(x - nx * len * 5, y - ny * len * 5);
        ctx.lineTo(x + nx * len * 5, y + ny * len * 5);
        ctx.stroke();
      }
    };
    for (let k = 0; k < 4; k++) {
      seam((x) => h / 2 + Math.sin((x / w) * Math.PI * 2 * 2 + (k * Math.PI) / 2) * 58);
    }
    // polar caps
    ctx.strokeStyle = "#1b2a44";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(w, 22);
    ctx.moveTo(0, h - 22);
    ctx.lineTo(w, h - 22);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const _w = { x: 0, y: 0, z: 0 };
const _vel = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class BallView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly trailPositions: Float32Array;
  private readonly trailColours: Float32Array;
  private readonly prev = new THREE.Vector3();
  private hasPrev = false;
  private wasCarried = true;
  private readonly disposables: { dispose(): void }[] = [];

  private disposed = false;

  constructor(private readonly underwater?: UnderwaterUniforms) {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 18);
    const tex = makeBallTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 });
    this.disposables.push(geo, tex, mat);
    if (underwater) addCaustics(mat, underwater);
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    // soft glow halo so the ball reads through the water
    const haloGeo = new THREE.SphereGeometry(BALL_RADIUS * 1.6, 12, 10);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(haloGeo, haloMat);
    this.mesh.add(new THREE.Mesh(haloGeo, haloMat));

    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    this.trailColours = new Float32Array(TRAIL_POINTS * 3);
    const base = new THREE.Color(0x8fe4ff);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const f = (i / (TRAIL_POINTS - 1)) ** 1.5;
      this.trailColours[i * 3] = base.r * f;
      this.trailColours[i * 3 + 1] = base.g * f;
      this.trailColours[i * 3 + 2] = base.b * f;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(this.trailColours, 3));
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(trailGeo, trailMat);
    this.trail = new THREE.Line(trailGeo, trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.group.add(this.trail);
    this.loadOriginalModel();
  }

  /**
   * Swap the procedural sphere for the game's own blitzball (Wakka's starting ball, type4 model 25 extracted from
   * the disc) when the extracted asset is present; the sphere stays as the fallback.
   */
  private loadOriginalModel(): void {
    new GLTFLoader().load(
      `${ORIGINAL_BALL_URL}`,
      (gltf) => {
        if (this.disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const k = (2 * BALL_RADIUS) / Math.max(size.x, size.y, size.z, 1e-6);
        const holder = new THREE.Group();
        model.position.sub(centre);
        holder.scale.setScalar(k);
        holder.add(model);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          this.disposables.push(m.geometry);
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            this.disposables.push(mat);
            if (this.underwater) addCaustics(mat, this.underwater);
          }
        });
        (this.mesh.material as THREE.Material).visible = false;
        this.mesh.add(holder);
      },
      undefined,
      () => undefined, // asset absent: keep the procedural ball
    );
  }

  /** `held`: where the carrier's hand is, when the character renderer knows it. */
  update(ball: BallState, dt: number, held?: THREE.Vector3 | null): void {
    toWorld(ball.position, _w);
    const pos = this.mesh.position;
    if (held && ball.carrierId !== null) pos.copy(held);
    else pos.set(_w.x, _w.y, _w.z);
    const carried = ball.carrierId !== null;

    if (this.hasPrev && dt > 0) {
      _vel.subVectors(pos, this.prev).divideScalar(dt);
      const speed = _vel.length();
      if (speed > 0.05) {
        _axis.crossVectors(_up, _vel).normalize();
        if (_axis.lengthSq() > 0.5) {
          this.mesh.rotateOnWorldAxis(_axis, (speed * dt) / BALL_RADIUS);
        }
      } else {
        this.mesh.rotation.y += dt * 0.8;
      }
    }
    this.prev.copy(pos);
    this.hasPrev = true;

    if (carried) {
      if (!this.wasCarried) this.trail.visible = false;
    } else {
      if (this.wasCarried) {
        // reset trail to current position
        for (let i = 0; i < TRAIL_POINTS; i++) {
          this.trailPositions[i * 3] = pos.x;
          this.trailPositions[i * 3 + 1] = pos.y;
          this.trailPositions[i * 3 + 2] = pos.z;
        }
        this.trail.visible = true;
      }
      this.trailPositions.copyWithin(0, 3);
      const last = (TRAIL_POINTS - 1) * 3;
      this.trailPositions[last] = pos.x;
      this.trailPositions[last + 1] = pos.y;
      this.trailPositions[last + 2] = pos.z;
      const attr = this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
    this.wasCarried = carried;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
