/**
 * snapshotAdapter.ts - Sim MatchState -> RenderSnapshot.
 *
 * Pure data mapping plus a small ActionTracker that turns one-shot sim events
 * (pass, shot, tackle, ...) into short-lived character actions the renderer
 * animates. Coordinates: the sim pool is centred on the origin with
 * z in [-POOL_HALF.z, POOL_HALF.z]; the renderer wants z in [0, depth], so
 * the adapter shifts z by POOL_HALF.z. x and y are shared.
 */

import type {
  PlayerAction,
  PoolBounds,
  PlayerState as RenderPlayer,
  RenderSnapshot,
  Vec3 as RenderVec3,
} from "../render/renderState";
import { POOL_HALF, SPEED_PER_SP, SPRINT_MULT, TICK_RATE } from "../sim/constants";
import type { MatchEvent, MatchState, PlayerState } from "../sim/types";

export const RENDER_POOL: Readonly<PoolBounds> = Object.freeze({
  minX: -POOL_HALF.x,
  maxX: POOL_HALF.x,
  minY: -POOL_HALF.y,
  maxY: POOL_HALF.y,
  minZ: 0,
  maxZ: 2 * POOL_HALF.z,
});

/** Fastest a player can move: SP 99 sprinting. Normalises RenderPlayer.speed. */
export const MAX_PLAYER_SPEED = 99 * SPEED_PER_SP * SPRINT_MULT;

const SWIM_THRESHOLD = 0.05;
const SPRINT_THRESHOLD = 0.62;

export function simToRenderPos(p: { x: number; y: number; z: number }): RenderVec3 {
  return { x: p.x, y: p.y, z: p.z + POOL_HALF.z };
}

export function renderToSimPos(p: { x: number; y: number; z: number }): RenderVec3 {
  return { x: p.x, y: p.y, z: p.z - POOL_HALF.z };
}

export function facingYaw(facing: { x: number; y: number }): number {
  if (facing.x === 0 && facing.y === 0) return 0;
  return Math.atan2(facing.y, facing.x);
}

export function statusesOf(p: PlayerState): string[] {
  const out: string[] = [];
  if (p.poisonTicks > 0) out.push("poison");
  if (p.sleepTicks > 0) out.push("sleep");
  if (Object.keys(p.wither).length > 0) out.push("wither");
  return out;
}

/** Durations (seconds) of the one-shot actions triggered by events. */
export const ACTION_SECONDS: Readonly<Record<Exclude<PlayerAction, "idle" | "swim" | "sprint">, number>> =
  Object.freeze({
    pass: 0.4,
    shoot: 0.6,
    tackle: 0.6,
    block: 0.5,
    catch: 0.45,
    hit: 0.7,
    celebrate: 2.5,
  });

interface ActiveAction {
  action: PlayerAction;
  untilTick: number;
}

/** Event -> (playerId, action) pairs; `teamOf` answers which players share a scorer's team. */
export function actionsForEvent(
  e: MatchEvent,
  teammatesOf: (team: 0 | 1) => readonly string[],
): [string, PlayerAction][] {
  switch (e.kind) {
    case "pass":
      return [[e.from, "pass"]];
    case "pass-complete":
    case "pickup":
      return [[e.kind === "pickup" ? e.by : e.to, "catch"]];
    case "pass-intercepted":
      return [[e.by, "block"]];
    case "shot":
      return [[e.by, "shoot"]];
    case "shot-blocked":
      return [[e.blocker, "block"]];
    case "save":
      return [[e.keeper, "catch"]];
    case "deflection":
      return [[e.keeper, "block"]];
    case "goal":
      return teammatesOf(e.team).map((id): [string, PlayerAction] => [id, "celebrate"]);
    case "tackle":
      return [
        [e.by, "tackle"],
        [e.on, "hit"],
      ];
    case "tackle-miss":
    case "tackle-evaded":
      return [[e.by, "tackle"]];
    case "breakthrough":
      return [[e.tackler, "hit"]];
    default:
      return [];
  }
}

/** Remembers short-lived actions per player, keyed on sim ticks. */
export class ActionTracker {
  private readonly active = new Map<string, ActiveAction>();

  ingest(events: readonly MatchEvent[], state: MatchState): void {
    const teammatesOf = (team: 0 | 1) => state.players.filter((p) => p.team === team).map((p) => p.id);
    for (const e of events) {
      for (const [id, action] of actionsForEvent(e, teammatesOf)) {
        if (action === "idle" || action === "swim" || action === "sprint") continue;
        const seconds = ACTION_SECONDS[action];
        const untilTick = e.tick + Math.round(seconds * TICK_RATE);
        const current = this.active.get(id);
        // Later / higher-priority events override, except a celebrate never pre-empts a fresh hit.
        if (current && current.untilTick > untilTick && current.action !== "celebrate") continue;
        this.active.set(id, { action, untilTick });
      }
    }
  }

  actionOf(id: string, tick: number): PlayerAction | null {
    const a = this.active.get(id);
    if (!a) return null;
    if (tick >= a.untilTick) {
      this.active.delete(id);
      return null;
    }
    return a.action;
  }

  clear(): void {
    this.active.clear();
  }
}

export function movementAction(speed01: number): PlayerAction {
  if (speed01 >= SPRINT_THRESHOLD) return "sprint";
  if (speed01 >= SWIM_THRESHOLD) return "swim";
  return "idle";
}

export interface AdapterOptions {
  selectedPlayerId?: string | null;
  tracker?: ActionTracker;
}

export function toRenderPlayer(p: PlayerState, tick: number, tracker?: ActionTracker): RenderPlayer {
  const speed = Math.min(1, Math.hypot(p.vel.x, p.vel.y, p.vel.z) / MAX_PLAYER_SPEED);
  const forced = tracker?.actionOf(p.id, tick) ?? null;
  const action: PlayerAction = forced ?? (p.sleepTicks > 0 || p.stun > 0 ? "idle" : movementAction(speed));
  return {
    id: p.id,
    team: p.team,
    position: simToRenderPos(p.pos),
    facing: facingYaw(p.facing),
    speed,
    action,
    hp: p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0,
    statuses: statusesOf(p),
    isKeeper: p.role === "GK",
  };
}

/** Build the renderer's snapshot from the sim state. Never mutates the state. */
export function toRenderSnapshot(state: MatchState, opts: AdapterOptions = {}): RenderSnapshot {
  const players = state.players.map((p) => toRenderPlayer(p, state.tick, opts.tracker));
  return {
    pool: RENDER_POOL,
    ball: { position: simToRenderPos(state.ball.pos), carrierId: state.ball.carrier },
    players,
    score: [state.score[0], state.score[1]],
    clock: state.time,
    half: state.half === 1 ? 1 : 2,
    possession: state.possession,
    selectedPlayerId: opts.selectedPlayerId ?? null,
  };
}
