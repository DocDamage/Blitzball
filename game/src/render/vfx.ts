import * as THREE from "three";
import { type PoolBounds, poolCentreWorld, toWorld, type Vec3 } from "./renderState";

const MAX_PARTICLES = 3000;

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vColor = color;
  vAlpha = aAlpha;
  vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (220.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a;
  if (vShape > 0.5) {
    // five-point star
    float ang = atan(d.y, d.x);
    float star = 0.55 + 0.45 * cos(ang * 5.0);
    a = smoothstep(star, star - 0.25, r);
  } else {
    a = smoothstep(1.0, 0.0, r);
    a = a * a;
  }
  gl_FragColor = vec4(vColor, a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}
`;

interface EmitSpec {
  count: number;
  colours: number[];
  /** base outward speed, pool units/s */
  speed: number;
  speedJitter: number;
  /** upward bias added to velocity */
  lift: number;
  gravity: number;
  drag: number;
  /** tangential swirl around the local vertical (radians/s) */
  swirl: number;
  life: number;
  lifeJitter: number;
  size: number;
  sizeJitter: number;
  star: boolean;
  /** radius of the spawn volume */
  radius: number;
  /** flatten spawn direction into a horizontal disc */
  disc: boolean;
}

const BURST: EmitSpec = {
  count: 60,
  colours: [0x9fe8ff, 0xffffff],
  speed: 8,
  speedJitter: 4,
  lift: 1,
  gravity: -2,
  drag: 2,
  swirl: 0,
  life: 0.8,
  lifeJitter: 0.4,
  size: 1.2,
  sizeJitter: 0.8,
  star: false,
  radius: 0.4,
  disc: false,
};

const TECHNIQUE_SPECS: { match: string[]; spec: EmitSpec }[] = [
  {
    match: ["jecht"],
    spec: {
      ...BURST,
      count: 140,
      colours: [0xff9a2e, 0xffd166, 0xff4d1f],
      speed: 6,
      speedJitter: 3,
      lift: 0,
      gravity: 0,
      drag: 1.2,
      swirl: 9,
      life: 0.9,
      lifeJitter: 0.4,
      size: 1.5,
      sizeJitter: 1,
      radius: 0.3,
      disc: true,
    },
  },
  {
    match: ["sphere"],
    spec: {
      ...BURST,
      count: 90,
      colours: [0xffffff, 0xfff1b0, 0xbfe9ff],
      speed: 1.5,
      speedJitter: 1.5,
      lift: 0.4,
      gravity: 0,
      drag: 0.6,
      swirl: 1.5,
      life: 1.4,
      lifeJitter: 0.6,
      size: 2.4,
      sizeJitter: 1.4,
      radius: 1.2,
      disc: false,
    },
  },
  {
    match: ["venom", "poison"],
    spec: {
      ...BURST,
      count: 110,
      colours: [0x3dff6e, 0x0f9b3c, 0xb6ff8a],
      speed: 2,
      speedJitter: 2,
      lift: 1.5,
      gravity: 0.3,
      drag: 1.5,
      swirl: 2,
      life: 1.3,
      lifeJitter: 0.8,
      size: 1.6,
      sizeJitter: 1,
      radius: 0.8,
      disc: false,
    },
  },
  {
    match: ["nap", "sleep"],
    spec: {
      ...BURST,
      count: 70,
      colours: [0x5aa8ff, 0xa9d4ff, 0xffffff],
      speed: 1.2,
      speedJitter: 1,
      lift: 2.5,
      gravity: 0.5,
      drag: 1.0,
      swirl: 1,
      life: 1.6,
      lifeJitter: 0.8,
      size: 1.8,
      sizeJitter: 1.2,
      star: true,
      radius: 1.0,
      disc: false,
    },
  },
  {
    match: ["wither", "drain"],
    spec: {
      ...BURST,
      count: 90,
      colours: [0xb86bff, 0x6a2fc9, 0xe9c6ff],
      speed: 2,
      speedJitter: 1.5,
      lift: -1.5,
      gravity: -1,
      drag: 1.2,
      swirl: 3,
      life: 1.2,
      lifeJitter: 0.5,
      size: 1.5,
      sizeJitter: 1,
      radius: 0.9,
      disc: false,
    },
  },
];

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Flash {
  sprite: THREE.Sprite;
  t: number;
  duration: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
}

const _w = { x: 0, y: 0, z: 0 };
const _c = new THREE.Color();

export class Vfx {
  readonly group = new THREE.Group();
  private pool: PoolBounds;
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly shape: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly swirl: Float32Array;
  private readonly originX: Float32Array;
  private readonly originZ: Float32Array;
  private cursor = 0;
  private readonly glowTex: THREE.CanvasTexture;
  private readonly flashes: Flash[] = [];
  private readonly spritePool: THREE.Sprite[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(pool: PoolBounds) {
    this.pool = pool;
    const n = MAX_PARTICLES;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.swirl = new Float32Array(n);
    this.originX = new Float32Array(n);
    this.originZ = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aShape", new THREE.BufferAttribute(this.shape, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(geo, mat);
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
    this.group.add(this.points);

    this.glowTex = makeGlowTexture();
    this.disposables.push(this.glowTex);
  }

  setPool(pool: PoolBounds): void {
    this.pool = pool;
  }

  /** Bright flash + burst at a goal. `goalEnd` is the sign of the goal's x (-1 or +1); omit for pool centre. */
  spawnGoalFlash(goalEnd?: -1 | 1): void {
    const c = poolCentreWorld(this.pool);
    const x = goalEnd === undefined ? c.x : goalEnd < 0 ? this.pool.minX : this.pool.maxX;
    const p = new THREE.Vector3(x, c.y, c.z);
    this.flash(p, 0xffffff, 0.55, 6, 40, 1.0);
    this.flash(p, 0xffd66b, 1.2, 2, 22, 0.8);
    this.emit(p, {
      ...BURST,
      count: 260,
      colours: [0xffffff, 0xffd66b, 0x9fe8ff],
      speed: 14,
      speedJitter: 8,
      lift: 2,
      gravity: -4,
      drag: 1.6,
      life: 1.2,
      lifeJitter: 0.6,
      size: 1.8,
      sizeJitter: 1.4,
      star: true,
      radius: 1.5,
    });
    this.emit(p, {
      ...BURST,
      count: 120,
      colours: [0x9fe8ff, 0x4fb0ff],
      speed: 5,
      swirl: 6,
      life: 1.6,
      disc: true,
      radius: 3,
    });
  }

  /** Technique effect at a pool-space position. Name is matched loosely (e.g. "Jecht Shot", "Sphere Shot", "Venom Pass", "Nap Shot"). */
  spawnTechniqueEffect(name: string, position: Vec3): void {
    toWorld(position, _w);
    const p = new THREE.Vector3(_w.x, _w.y, _w.z);
    const lower = name.toLowerCase();
    let spec: EmitSpec | null = null;
    for (const entry of TECHNIQUE_SPECS) {
      if (entry.match.some((m) => lower.includes(m))) {
        spec = entry.spec;
        break;
      }
    }
    if (!spec) spec = BURST;
    this.emit(p, spec);
    if (lower.includes("sphere")) this.flash(p, 0xfff1b0, 1.0, 1.5, 12, 0.9);
    else if (lower.includes("jecht")) this.flash(p, 0xff9a2e, 0.5, 1, 9, 0.9);
    else this.flash(p, spec.colours[0], 0.4, 1, 5, 0.6);
  }

  /** Generic burst at a pool-space position in a given colour. */
  spawnBurst(position: Vec3, colour: number, count = 40): void {
    toWorld(position, _w);
    this.emit(new THREE.Vector3(_w.x, _w.y, _w.z), { ...BURST, count, colours: [colour, 0xffffff] });
  }

  private flash(
    p: THREE.Vector3,
    colour: number,
    duration: number,
    startScale: number,
    endScale: number,
    opacity: number,
  ): void {
    let sprite = this.spritePool.pop();
    if (!sprite) {
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.disposables.push(mat);
      sprite = new THREE.Sprite(mat);
    }
    sprite.material.color.setHex(colour);
    sprite.material.opacity = opacity;
    sprite.position.copy(p);
    sprite.scale.setScalar(startScale);
    sprite.renderOrder = 16;
    this.group.add(sprite);
    this.flashes.push({ sprite, t: 0, duration, startScale, endScale, startOpacity: opacity });
  }

  private emit(p: THREE.Vector3, spec: EmitSpec): void {
    for (let k = 0; k < spec.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      // random direction
      let dx = Math.random() * 2 - 1;
      let dy = spec.disc ? (Math.random() - 0.5) * 0.2 : Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      const sp = spec.speed + (Math.random() - 0.5) * 2 * spec.speedJitter;
      const r = Math.random() * spec.radius;
      this.pos[i * 3] = p.x + dx * r;
      this.pos[i * 3 + 1] = p.y + dy * r;
      this.pos[i * 3 + 2] = p.z + dz * r;
      this.vel[i * 3] = dx * sp;
      this.vel[i * 3 + 1] = dy * sp + spec.lift;
      this.vel[i * 3 + 2] = dz * sp;
      _c.setHex(spec.colours[Math.floor(Math.random() * spec.colours.length)]);
      this.col[i * 3] = _c.r;
      this.col[i * 3 + 1] = _c.g;
      this.col[i * 3 + 2] = _c.b;
      this.size[i] = spec.size + Math.random() * spec.sizeJitter;
      this.shape[i] = spec.star ? 1 : 0;
      this.maxLife[i] = spec.life + Math.random() * spec.lifeJitter;
      this.life[i] = this.maxLife[i];
      this.alpha[i] = 1;
      this.gravity[i] = spec.gravity;
      this.drag[i] = spec.drag;
      this.swirl[i] = spec.swirl;
      this.originX[i] = p.x;
      this.originZ[i] = p.z;
    }
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= step;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const ix = i * 3;
      const dragK = Math.max(0, 1 - this.drag[i] * step);
      this.vel[ix] *= dragK;
      this.vel[ix + 1] = this.vel[ix + 1] * dragK + this.gravity[i] * step;
      this.vel[ix + 2] *= dragK;
      if (this.swirl[i] !== 0) {
        // rotate the horizontal offset from the origin around the vertical axis
        const ox = this.pos[ix] - this.originX[i];
        const oz = this.pos[ix + 2] - this.originZ[i];
        const a = this.swirl[i] * step;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        this.pos[ix] = this.originX[i] + ox * ca - oz * sa;
        this.pos[ix + 2] = this.originZ[i] + ox * sa + oz * ca;
      }
      this.pos[ix] += this.vel[ix] * step;
      this.pos[ix + 1] += this.vel[ix + 1] * step;
      this.pos[ix + 2] += this.vel[ix + 2] * step;
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = f < 0.3 ? f / 0.3 : 1;
    }
    const geo = this.points.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aShape") as THREE.BufferAttribute).needsUpdate = true;

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.t += dt;
      const u = Math.min(1, fl.t / fl.duration);
      const eased = 1 - (1 - u) * (1 - u);
      fl.sprite.scale.setScalar(THREE.MathUtils.lerp(fl.startScale, fl.endScale, eased));
      fl.sprite.material.opacity = fl.startOpacity * (1 - u);
      if (u >= 1) {
        this.group.remove(fl.sprite);
        this.spritePool.push(fl.sprite);
        this.flashes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
