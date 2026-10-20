/**
 * input.ts - Per-tick input contract between the outside world and the sim.
 *
 * The three control modes of the plan (arcade hybrid, tactical pause, pure
 * action) live entirely outside the sim: they only change how a TeamInput is
 * gathered and how often Match.step() is called (time scale). The sim consumes
 * one MatchInput per tick and never touches the DOM.
 */

import type { Vec3 } from "./vec";

export interface AiTeamInput {
  kind: "ai";
}

export interface HumanTeamInput {
  kind: "human";
  /** The player the human is steering; every other teammate is AI-driven. */
  controlledPlayerId: string;
  /** Desired movement direction (normalized or zero). */
  move: Vec3;
  sprint: boolean;
  /** Pass to this teammate (true = let the sim pick the best receiver). */
  pass?: string | true;
  shoot?: true;
  tackle?: true;
  /** Technique to use with the action this tick (or on its own for shot/pass/tackle kinds). */
  technique?: string;
}

export type TeamInput = AiTeamInput | HumanTeamInput;

export interface MatchInput {
  home: TeamInput;
  away: TeamInput;
}

export const AI_INPUT: Readonly<MatchInput> = Object.freeze({
  home: { kind: "ai" } as AiTeamInput,
  away: { kind: "ai" } as AiTeamInput,
});

/** Internal, per-player resolved intent used by both AI and human control. */
export interface PlayerAction {
  kind: "pass" | "shoot" | "tackle";
  /** Pass receiver id. */
  targetId?: string;
  /** Shot aim point in world space. */
  aim?: Vec3;
  techniqueId?: string;
}

export interface PlayerIntent {
  /** Move toward this world point (AI). */
  moveTo?: Vec3;
  /** Or move directly along this direction (human). */
  move?: Vec3;
  sprint: boolean;
  /** One-shot action, consumed on the tick it is resolved. */
  action?: PlayerAction;
}
