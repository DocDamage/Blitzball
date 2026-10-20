/**
 * types.ts - Data definitions and runtime state types for the match simulation.
 *
 * Everything here is plain data: no classes, no Sets/Maps, so a MatchState can
 * be structured-cloned and deep-compared in replay tests. Player ids are
 * strings (unique within a match); `dataId` carries the numeric id from
 * data/json so a finished match can be reported back to the league layer.
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

/** The six stats that take part in contests (and can be withered / overridden). */
export type ContestStat = "en" | "pa" | "sh" | "at" | "bl" | "ca";
export const CONTEST_STATS: readonly ContestStat[] = ["en", "pa", "sh", "at", "bl", "ca"];

/** FFX field positions. The first six players of a TeamDef fill these in ROLE_ORDER. */
export type Role = "LF" | "RF" | "MF" | "LD" | "RD" | "GK";
export const ROLE_ORDER: readonly Role[] = ["LF", "RF", "MF", "LD", "RD", "GK"];

export interface PlayerDef {
  id: string;
  name: string;
  teamId: string;
  /** Numeric player id from data/json (needed for MatchReport). */
  dataId?: number;
  stats: Stats;
  level: number;
  /** Equipped technique ids (1..60) - the ones that matter for play. */
  techniques: number[];
  /**
   * Technique ids the player already knows (learned set, equipped or not).
   * A known technique is never offered for techcopy again.
   */
  keyTechniques?: number[];
  /** Four tiers of learnable technique ids (data/json players.learnableTiers). */
  learnableTiers?: number[][];
  /** Levels at which tiers 2..4 open (data/json players.tierLevels). */
  tierLevels?: number[];
}

export type FormationId = "standard" | "attack" | "defense" | "counter";
export type Personality = "aggressive" | "technical" | "physical" | "balanced";

export interface TeamDef {
  id: string;
  name: string;
  /** Numeric team id from data/json (needed for MatchReport). */
  dataId?: number;
  /** Starters are players[0..5] in ROLE_ORDER; extra players are bench. */
  players: PlayerDef[];
  formation: FormationId;
  /** Team personality used by the AI (defaults to "balanced"). */
  personality?: Personality;
  /** Mark Mode: per-role overrides of the formation's marking assignments (null = press the carrier). */
  marks?: MarkAssignments;
}

/** Which opposing role each of our roles marks when defending; roles left out use the formation preset. */
export type MarkAssignments = Partial<Record<Role, Role | null>>;

/** Runtime status kinds: Venom = poison, Nap = sleep, Wither halves a stat. Drain is instant. */
export type StatusKind = "poison" | "sleep" | "wither";

/** Technique status families (formulas.md section 5). */
export type StatusFamily = "venom" | "nap" | "wither" | "drain";

export type TechniqueKind = "shot" | "pass" | "tackle" | "evade" | "guard" | "passive";

export type PassiveKind =
  | "spinBall"
  | "gripGloves"
  | "eliteDefense"
  | "brawler"
  | "pileVenom"
  | "pileWither"
  | "regen"
  | "goodMorning"
  | "hiRisk"
  | "goldenArm"
  | "gamble"
  | "superGoalie";

export interface Technique {
  id: number;
  name: string;
  kind: TechniqueKind;
  /** HP spent on use (or at match start for passives). */
  hpCost: number;
  /** Added to SH / PA / AT for the contest (cap 99). */
  statBoost: number;
  /** Trigger chance in percent (status, evade, guard, passive triggers). */
  chancePct: number;
  flags: number;
  description: string;
  /** Status inflicted (shot/pass/tackle) or guarded against (Anti-*). */
  family?: StatusFamily;
  /** 1..3 for status techniques, 0 otherwise. */
  tier: number;
  /** EXP awarded to the user when the technique is used. */
  useExp: number;
  /** Passive behaviour, if any. */
  passive?: PassiveKind;
  /** Volley Shot family (flag 512): fires automatically on a loose ball. */
  volley: boolean;
  /** Jecht Shot 2 / Invisible Shot: replaces the goalie roll by an aimed shot. */
  aimed: boolean;
}

// ---------------------------------------------------------------- runtime state

export interface ChanceCost {
  chance: number;
  cost: number;
}

/** Passive technique effects resolved once at kickoff (formulas.md section 1). */
export interface Passives {
  eliteDefense: boolean;
  goldenArm: boolean;
  pileVenom: boolean;
  pileWither: boolean;
  hiRisk: boolean;
  regen: boolean;
  superGoalie: boolean;
  spinBall: boolean;
  gripGloves: boolean;
  goodMorning: boolean;
  gamble: boolean;
  brawler: ChanceCost | null;
  tackleSlip: ChanceCost | null;
  volley: ChanceCost | null;
  anti: Partial<Record<StatusFamily, ChanceCost>>;
}

export interface WitherInstance {
  /** Ticks remaining. */
  remaining: number;
  /** 2, or 4 after Pile Wither. */
  divisor: number;
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
  /** Level-derived HP (0040). */
  maxHp: number;
  /** HP after passive technique deductions (0080): the regen ceiling. */
  effectiveMaxHp: number;
  /** Pending match EXP (capped at EXP_CAP). */
  exp: number;
  passives: Passives;
  /** HP tick counter (formulas.md section 3). */
  hpCounter: number;
  /** HP lost per carrier tick: 1, 4 poisoned, x4 per Pile Venom stack. */
  drainPerTick: number;
  poisonTicks: number;
  sleepTicks: number;
  wither: Partial<Record<ContestStat, WitherInstance>>;
  /** Good Morning! stat override (99 decaying). */
  override: Partial<Record<ContestStat, number>>;
  overrideEveryTicks: number;
  overrideCounter: number;
  gambleTicks: number;
  gambleStats: Record<ContestStat, number> | null;
  /** Working EN of the current encounter chain (null outside an encounter). */
  contestEn: number | null;
  /** Equipped techniques (ids). */
  techniques: number[];
  /** Techniques learned by techcopy this match (committed to the roster by the league layer). */
  learned: number[];
  /** Ticks during which the player cannot tackle again. */
  tackleCooldown: number;
  /** Ticks during which the player cannot move or act. */
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
  /** Remaining PA' / SH' (decays in flight, reduced by blockers). */
  power: number;
  /** Players who already contested this flight and may not retry. */
  contested: string[];
  /** Aim point the ball was launched toward. */
  aim: Vec3;
  travelled: number;
  aimDistance: number;
  /** Last floor(distance / FLIGHT_DECAY_DISTANCE) seen (flight decay bookkeeping). */
  decayBucket: number;
  /** Technique used to launch, if any (its status payload applies on contest). */
  techniqueId?: number;
  /** Aimed shot (Jecht Shot 2 / Invisible Shot fired). */
  aimed: boolean;
  /** Goalie deflection window out of 10, fixed at launch (Spin Ball). */
  deflectWindow: number;
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
  /** Ticks of play elapsed in the current period (does not run during resets). */
  periodTicks: number;
  /** Game-seconds of play elapsed in the current period (FRAMES_PER_GAME_SECOND per second). */
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
  /** Mark Mode overrides per team (see TeamDef.marks). */
  marks: [MarkAssignments, MarkAssignments];
  players: PlayerState[];
  ball: BallState;
  rngState: number;
}

// ---------------------------------------------------------------- events

interface EventBase {
  tick: number;
  /** Period clock in game-seconds at the time of the event. */
  time: number;
  half: 1 | 2 | 3;
}

export type MatchEvent = EventBase &
  (
    | { kind: "kickoff" }
    | { kind: "pass"; from: string; to: string; team: 0 | 1; techniqueId?: number }
    | { kind: "pass-complete"; from: string; to: string; team: 0 | 1 }
    /** A blocker won the roll and grabbed the pass. */
    | { kind: "pass-intercepted"; from: string; to: string; by: string; team: 0 | 1 }
    /** The pass arrived with no power left. */
    | { kind: "pass-fumbled"; from: string; to: string; team: 0 | 1 }
    | { kind: "shot"; by: string; team: 0 | 1; power: number; techniqueId?: number; aimed: boolean }
    | { kind: "shot-blocked"; by: string; blocker: string; team: 0 | 1 }
    | { kind: "save"; keeper: string; shooter: string; team: 0 | 1 }
    /** The goalie got a hand on it: loose ball. */
    | { kind: "deflection"; keeper: string; shooter: string; team: 0 | 1 }
    | { kind: "goal"; by: string; team: 0 | 1; score: [number, number]; keeperInReach: boolean }
    | { kind: "tackle"; by: string; on: string; team: 0 | 1; techniqueId?: number }
    | { kind: "tackle-miss"; by: string; on: string; team: 0 | 1 }
    | { kind: "tackle-evaded"; by: string; on: string; team: 0 | 1 }
    | { kind: "breakthrough"; carrier: string; tackler: string; team: 0 | 1 }
    | { kind: "technique-used"; by: string; techniqueId: number; team: 0 | 1 }
    | { kind: "techcopy"; by: string; techniqueId: number; from: string; team: 0 | 1 }
    | { kind: "techcopy-failed"; by: string; techniqueId: number; from: string; team: 0 | 1 }
    | { kind: "status-applied"; player: string; status: StatusKind; duration: number; stat?: ContestStat }
    | { kind: "status-resisted"; player: string; status: StatusFamily; techniqueId: number }
    | { kind: "status-expired"; player: string; status: StatusKind; stat?: ContestStat }
    | { kind: "drain"; by: string; on: string; amount: number }
    | { kind: "wake-up"; player: string; by: string }
    | { kind: "good-morning"; player: string }
    | { kind: "gamble"; player: string }
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
