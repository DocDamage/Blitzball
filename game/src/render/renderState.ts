/**
 * Plain-data contract between the simulation and the 3D presentation layer.
 *
 * Coordinates are in "pool units", a right-handed box:
 *   x: goal to goal  (goals sit at minX and maxX, centred on y/z)
 *   y: side to side
 *   z: depth, 0 = pool floor, maxZ = top of the water volume
 *
 * The renderer maps this to Three.js world space as (x, z, -y) so that z is up.
 * The integrator produces one RenderSnapshot per frame from the sim; the
 * renderer never mutates it.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PoolBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type PlayerAction =
  | "idle"
  | "swim"
  | "sprint"
  | "pass"
  | "shoot"
  | "tackle"
  | "block"
  | "catch"
  | "hit"
  | "celebrate";

export const PLAYER_ACTIONS: readonly PlayerAction[] = [
  "idle",
  "swim",
  "sprint",
  "pass",
  "shoot",
  "tackle",
  "block",
  "catch",
  "hit",
  "celebrate",
];

/** Status names the renderer knows how to draw; others are ignored. */
export type KnownStatus = "poison" | "sleep" | "wither";

export interface BallState {
  position: Vec3;
  /** id of the player holding the ball, or null when it is loose / in flight. */
  carrierId: string | null;
}

export interface PlayerState {
  id: string;
  team: 0 | 1;
  position: Vec3;
  /** Yaw in radians in the x/y plane: 0 faces +x, PI/2 faces +y. */
  facing: number;
  /** 0 = stationary, 1 = top speed. Scales swim cycles. */
  speed: number;
  action: PlayerAction;
  /** 0..1 */
  hp: number;
  /** e.g. ["poison", "sleep", "wither"]; unknown names are ignored. */
  statuses: string[];
  /** Optional: goalkeeper gets a distinct colour scheme. */
  isKeeper?: boolean;
}

export interface RenderSnapshot {
  pool: PoolBounds;
  ball: BallState;
  players: PlayerState[];
  /** [team0, team1] */
  score: [number, number];
  /** Match clock in seconds. */
  clock: number;
  half: 1 | 2;
  /** Team in possession, or null when the ball is loose. */
  possession: 0 | 1 | null;
  /** Optional: player to draw the selection ring under. */
  selectedPlayerId?: string | null;
}

/** Goal frame dimensions in pool units (centred on the end wall). */
export const GOAL_WIDTH = 8;
export const GOAL_HEIGHT = 6;

/** Sim pool coordinates -> Three.js world coordinates (z up becomes y up). */
export function toWorld(p: Vec3, out: { x: number; y: number; z: number }): void {
  out.x = p.x;
  out.y = p.z;
  out.z = -p.y;
}

/** Sim facing yaw (x/y plane) -> Three.js rotation.y for an object modelled facing +x. */
export function facingToRotationY(facing: number): number {
  return facing;
}

export function poolCentreWorld(pool: PoolBounds): { x: number; y: number; z: number } {
  return {
    x: (pool.minX + pool.maxX) / 2,
    y: (pool.minZ + pool.maxZ) / 2,
    z: -(pool.minY + pool.maxY) / 2,
  };
}
