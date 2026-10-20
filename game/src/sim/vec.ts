/**
 * vec.ts - Minimal immutable 3D vector helpers for the sphere pool.
 *
 * Axes: x runs goal to goal (the long axis), y is across the pool, z is depth.
 * All helpers return new objects; nothing here mutates its inputs, which keeps
 * the sim state easy to snapshot and compare in replay tests.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function len(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

/** Unit vector, or zero if the input is (near) zero length. */
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function isZero(a: Vec3): boolean {
  return Math.abs(a.x) < 1e-9 && Math.abs(a.y) < 1e-9 && Math.abs(a.z) < 1e-9;
}

/** Clamp every component into [-half, +half] of the given box. */
/** Pull a point back inside a sphere of radius r centred on the origin. */
export function clampSphere(a: Vec3, r: number): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return l > r ? { x: (a.x * r) / l, y: (a.y * r) / l, z: (a.z * r) / l } : a;
}

export function clampBox(a: Vec3, half: Vec3): Vec3 {
  return {
    x: Math.max(-half.x, Math.min(half.x, a.x)),
    y: Math.max(-half.y, Math.min(half.y, a.y)),
    z: Math.max(-half.z, Math.min(half.z, a.z)),
  };
}

/**
 * Distance from point p to the segment a-b, and the parameter t in [0,1] of the
 * closest point along the segment. Used for pass-lane and shot-lane checks.
 */
export function distToSegment(p: Vec3, a: Vec3, b: Vec3): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return { d: dist(p, a), t: 0 };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: dist(p, add(a, scale(ab, t))), t };
}
