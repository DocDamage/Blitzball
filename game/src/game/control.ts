/**
 * control.ts - Human control: which player is steered and how one polled
 * InputState becomes the sim's HumanTeamInput for a tick.
 *
 * Movement is camera-relative: the runtime supplies a CameraBasis (screen
 * right / screen up projected onto the pool's x/y plane) and the controller
 * maps the stick / WASD vector through it; ascend / descend drive pool z.
 * Everything here is pure so it can be unit-tested without a renderer.
 */

import type { InputState } from "../input/inputManager";
import { ENCOUNTER_RADIUS } from "../sim/constants";
import type { HumanTeamInput } from "../sim/input";
import type { Match } from "../sim/match";
import { getTechnique } from "../sim/techniques";
import type { PlayerState, Technique } from "../sim/types";
import { dist } from "../sim/vec";

export interface CameraBasis {
  /** Pool-space (x, y) direction that screen-right maps to. */
  right: { x: number; y: number };
  /** Pool-space (x, y) direction that screen-up maps to. */
  forward: { x: number; y: number };
}

/** Default basis for a broadcast camera on the -y sideline looking toward +y: right = +x, up = +y. */
export const DEFAULT_BASIS: Readonly<CameraBasis> = Object.freeze({
  right: { x: 1, y: 0 },
  forward: { x: 0, y: 1 },
});

/** A one-shot action chosen outside the per-tick input (tactical radial menu). */
export interface PendingAction {
  pass?: string | true;
  shoot?: true;
  tackle?: true;
  technique?: number;
}

export interface ControlState {
  controlledId: string | null;
  /** Set by a manual switch; cleared when the ball changes hands. */
  manual: boolean;
  lastCarrier: string | null;
  /** Cycled pass target (null = let the sim pick). */
  passTargetId: string | null;
  pending: PendingAction | null;
}

export function initialControlState(): ControlState {
  return { controlledId: null, manual: false, lastCarrier: null, passTargetId: null, pending: null };
}

function byDistanceToBall(match: Match, team: 0 | 1): PlayerState[] {
  const ball = match.state.ball.pos;
  return match
    .playersOf(team)
    .slice()
    .sort((a, b) => dist(a.pos, ball) - dist(b.pos, ball));
}

/** Carrier if on the human team, else the nearest outfield teammate to the ball. */
export function autoControlled(match: Match, team: 0 | 1): string | null {
  const carrier = match.state.ball.carrier;
  if (carrier) {
    const c = match.player(carrier);
    if (c.team === team) return c.id;
  }
  const sorted = byDistanceToBall(match, team);
  const outfield = sorted.find((p) => p.role !== "GK" && p.sleepTicks <= 0);
  return outfield?.id ?? sorted[0]?.id ?? null;
}

/** Re-evaluate the controlled player after a tick (keeps manual picks until possession changes). */
export function updateControlled(match: Match, team: 0 | 1, state: ControlState): ControlState {
  const carrier = match.state.ball.carrier;
  const carrierChanged = carrier !== state.lastCarrier;
  let { controlledId, manual, passTargetId } = state;
  if (carrierChanged) {
    manual = false;
    passTargetId = null;
  }
  const carrierIsOurs = carrier !== null && match.player(carrier).team === team;
  if (carrierIsOurs) controlledId = carrier;
  else if (!manual || controlledId === null) controlledId = autoControlled(match, team);
  return { ...state, controlledId, manual, lastCarrier: carrier, passTargetId };
}

/** Switch to the next teammate by distance to the ball (wraps). */
export function cycleControlled(match: Match, team: 0 | 1, state: ControlState): ControlState {
  const sorted = byDistanceToBall(match, team).filter((p) => p.role !== "GK" || p.hasBall);
  if (sorted.length === 0) return state;
  const i = sorted.findIndex((p) => p.id === state.controlledId);
  const next = sorted[(i + 1) % sorted.length];
  return { ...state, controlledId: next.id, manual: true };
}

/** Teammates of the controlled player, nearest to the facing direction first. */
export function passCandidates(match: Match, controlledId: string): PlayerState[] {
  const p = match.player(controlledId);
  const f = p.facing;
  return match
    .playersOf(p.team)
    .filter((t) => t.id !== p.id && t.role !== "GK")
    .map((t) => {
      const dx = t.pos.x - p.pos.x;
      const dy = t.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      const align = (dx * f.x + dy * f.y) / d;
      return { t, score: align - d / 60 };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

export function cyclePassTarget(match: Match, state: ControlState): ControlState {
  if (!state.controlledId) return state;
  const cands = passCandidates(match, state.controlledId);
  if (cands.length === 0) return state;
  const i = cands.findIndex((c) => c.id === state.passTargetId);
  return { ...state, passTargetId: cands[(i + 1) % cands.length].id };
}

/** Equipped techniques of a player in hotbar order (max five). */
export function hotbarOf(p: PlayerState): (Technique | null)[] {
  const out: (Technique | null)[] = [];
  for (const id of p.techniques.slice(0, 5)) out.push(getTechnique(id) ?? null);
  while (out.length < 5) out.push(null);
  return out;
}

/** Opponents inside the encounter radius of the player (the "contested" condition). */
export function contestedBy(match: Match, p: PlayerState): PlayerState[] {
  return match.opponentsOf(p.team).filter((o) => dist(o.pos, p.pos) <= ENCOUNTER_RADIUS + 0.5);
}

export function screenToPool(move: { x: number; y: number }, basis: CameraBasis): { x: number; y: number } {
  let x = basis.right.x * move.x + basis.forward.x * move.y;
  let y = basis.right.y * move.x + basis.forward.y * move.y;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y };
}

export interface HumanInputResult {
  input: HumanTeamInput;
  state: ControlState;
}

/**
 * Build the sim input for this tick. `pressed` edges are consumed here, so the
 * caller must only pass them for the first tick of a frame.
 */
export function buildHumanInput(
  match: Match,
  team: 0 | 1,
  state: ControlState,
  input: InputState,
  basis: CameraBasis,
  consumeEdges: boolean,
): HumanInputResult {
  let s = state;
  if (!s.controlledId) s = updateControlled(match, team, s);
  const id = s.controlledId;
  if (!id) {
    return {
      state: s,
      input: { kind: "human", controlledPlayerId: "", move: { x: 0, y: 0, z: 0 }, sprint: false },
    };
  }
  const p = match.player(id);
  const xy = screenToPool(input.move, basis);
  const hi: HumanTeamInput = {
    kind: "human",
    controlledPlayerId: id,
    move: { x: xy.x, y: xy.y, z: input.vertical },
    sprint: input.held.has("sprint"),
  };

  if (consumeEdges) {
    if (input.pressed.has("switch") && !p.hasBall) s = cycleControlled(match, team, s);
    if (input.pressed.has("cycleTarget") && p.hasBall) s = cyclePassTarget(match, s);

    const pending = s.pending;
    if (pending) {
      Object.assign(hi, pending);
      s = { ...s, pending: null };
    } else {
      const techKeys = ["tech1", "tech2", "tech3", "tech4", "tech5"] as const;
      for (let i = 0; i < techKeys.length; i++) {
        if (input.pressed.has(techKeys[i])) {
          const t = hotbarOf(p)[i];
          if (t && match.canUseTechnique(p, t.id)) hi.technique = t.id;
        }
      }
      if (input.pressed.has("shoot") || input.pointer.clicked === 2) {
        if (p.hasBall) hi.shoot = true;
        else hi.tackle = true;
      }
      if (input.pressed.has("tackle") && !p.hasBall) hi.tackle = true;
      if ((input.pressed.has("pass") || input.pointer.clicked === 0) && p.hasBall) {
        hi.pass = s.passTargetId ?? passCandidates(match, id)[0]?.id ?? true;
      }
    }
    if (hi.pass !== undefined && typeof hi.pass === "string") {
      const t = match.player(hi.pass);
      if (t.team !== team || t.id === id) hi.pass = true;
    }
  }
  hi.controlledPlayerId = s.controlledId ?? id;
  return { input: hi, state: s };
}
