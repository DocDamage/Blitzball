/**
 * types.ts - Data definitions (loaded from data/json later) and runtime state
 * types for the match simulation. Everything here is plain data: no classes,
 * no Sets/Maps, so a MatchState can be structured-cloned and deep-compared in
 * replay tests.
 */

import type { Vec3 } from "./vec";

// ---------------------------------------------------------------- definitions

/** FFX blitzball stats. All integers. */
export interface Stats {
  hp: number;
  en: number;
  at: number;
  pa: number;
  bl: number;
  sh: number;
  ca: number;
  sp: number;
}

export type StatKey = keyof Stats;

/** FFX field positions. The first six players of a TeamDef fill these in ROLE_ORDER. */
export type Role = "LF" | "RF" | "MF" | "LD" | "RD" | "GK";
export const ROLE_ORDER: readonly Role[] = ["LF", "RF", "MF", "LD", "RD", "GK"];

export interface PlayerDef {
  id: string;
  name: string;
  teamId: string;
  stats: Stats;
  level: number;
  /** Technique ids this player knows at kickoff (see techniques.ts). */
  techniques: string[];
}

export type FormationId = "standard" | "attack" | "defense" | "counter";
export type Personality = "aggressive" | "technical" | "physical" | "balanced";

export interface TeamDef {
  id: string;
  name: string;
  /** Starters are players[0..5] in ROLE_ORDER; extra players are bench. */
  players: PlayerDef[];
  formation: FormationId;
  /** Team personality used by the AI (defaults to "balanced"). */
  personality?: Personality;
}

export type StatusKind = "poison" | "sleep" | "wither" | "nap";

export type TechniqueKind = "shot" | "pass" | "tackle" | "block" | "catch" | "passive";

export interface StatusInflict {
  kind: StatusKind;
  /** Seconds. */
  duration: number;
  /** 0..1 chance applied when the technique's contest is won. */
  chance: number;
}

export interface Technique {
  id: string;
  name: string;
  kind: TechniqueKind;
  /** HP (stamina) spent on use; a player needs at least this much HP to use it. */
  hpCost: number;
  /** Additive stat bonuses applied for the contest this technique is used in. */
  statMods: Partial<Stats>;
  /** Status inflicted on the contest loser (keeper for shots, interceptor for passes, carrier for tackles). */
  inflicts?: StatusInflict;
  /** Seconds before the technique can be used again. */
  cooldown: number;
  /** Can be learned by witnesses (techcopy). */
  techcopy: boolean;
}

// ---------------------------------------------------------------- runtime state

export interface StatusInstance {
  kind: StatusKind;
  /** Ticks remaining. */
  remaining: number;
}

export interface PlayerState {
  id: string;
  teamId: string;
  /** 0 = home, 1 = away. */
  team: 0 | 1;
  role: Role;
  def: PlayerDef;
  pos: Vec3;
  vel: Vec3;
  facing: Vec3;
  hp: number;
  maxHp: number;
  statuses: StatusInstance[];
  /** technique id -> ticks remaining. */
  cooldowns: Record<string, number>;
  /** Techniques known now (grows through techcopy). */
  techniques: string[];
  /** Ticks during which the player cannot tackle again. */
  tackleCooldown: number;
  /** Ticks during which the player cannot move (just tackled / whiffed a tackle). */
  stun: number;
  hasBall: boolean;
  /** Tick at which the player last received the ball (AI hold timing). */
  receivedTick: number;
}

export interface BallFlight {
  kind: "pass" | "shot";
  from: string;
  /** Receiver for passes; undefined for shots. */
  to?: string;
  team: 0 | 1;
  /** Remaining pass/shot power (PA or SH based), decays in flight. */
  power: number;
  /** Players who already contested this flight and may not retry. */
  contested: string[];
  /** Aim point the ball was launched toward. */
  aim: Vec3;
  travelled: number;
  aimDistance: number;
  /** Technique used to launch, if any (its status payload applies on contest). */
  techniqueId?: string;
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Player id holding the ball, or null when loose or in flight. */
  carrier: string | null;
  flight: BallFlight | null;
  /** Team that last touched the ball (for possession and reset rules). */
  lastTouch: 0 | 1 | null;
}

export type MatchPhase = "reset" | "play" | "finished";

export interface MatchState {
  tick: number;
  /** Seconds of play elapsed in the current period (does not run during resets). */
  time: number;
  /** 1, 2, or 3 for overtime. */
  half: 1 | 2 | 3;
  phase: MatchPhase;
  /** Ticks left in the current reset freeze. */
  resetTicks: number;
  score: [number, number];
  /** Team (0/1) in possession, or null when the ball is loose / in flight. */
  possession: 0 | 1 | null;
  possessionTicks: [number, number];
  /** +1 or -1: the x direction each team attacks toward in the current period. */
  attackDir: [1 | -1, 1 | -1];
  formations: [FormationId, FormationId];
  players: PlayerState[];
  ball: BallState;
  rngState: number;
}

// ---------------------------------------------------------------- events

interface EventBase {
  tick: number;
  /** Period clock in seconds at the time of the event. */
  time: number;
  half: 1 | 2 | 3;
}

export type MatchEvent = EventBase &
  (
    | { kind: "kickoff" }
    | { kind: "pass"; from: string; to: string; team: 0 | 1; techniqueId?: string }
    | { kind: "pass-complete"; from: string; to: string; team: 0 | 1 }
    | { kind: "pass-intercepted"; from: string; to: string; by: string; team: 0 | 1 }
    | { kind: "shot"; by: string; team: 0 | 1; power: number; techniqueId?: string }
    | { kind: "shot-blocked"; by: string; blocker: string; team: 0 | 1 }
    | { kind: "save"; keeper: string; shooter: string; team: 0 | 1 }
    | { kind: "goal"; by: string; team: 0 | 1; score: [number, number]; keeperInReach: boolean }
    | { kind: "tackle"; by: string; on: string; team: 0 | 1; techniqueId?: string }
    | { kind: "breakthrough"; carrier: string; tackler: string; team: 0 | 1 }
    | { kind: "technique-used"; by: string; techniqueId: string; team: 0 | 1 }
    | { kind: "techcopy"; by: string; techniqueId: string; from: string; team: 0 | 1 }
    | { kind: "status-applied"; player: string; status: StatusKind; duration: number }
    | { kind: "status-expired"; player: string; status: StatusKind }
    | { kind: "half-time"; score: [number, number] }
    | { kind: "overtime-start"; score: [number, number] }
    | { kind: "full-time"; score: [number, number] }
    | { kind: "out-of-bounds-reset"; toTeam: 0 | 1; toPlayer: string }
    | { kind: "pickup"; by: string; team: 0 | 1 }
  );

export type MatchEventKind = MatchEvent["kind"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event without its timing fields (what Match.emit fills in). */
export type MatchEventPayload = DistributiveOmit<MatchEvent, "tick" | "time" | "half">;
