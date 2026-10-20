/**
 * types.ts - Typed shapes of the four extracted JSON files in data/json.
 *
 * The JSON is generated from the original disc by tools/extract and is the
 * single source of truth; nothing here is hand-edited game data.
 */

/** The eight blitzball stats, in the order the game lists them. */
export type StatName = "HP" | "AT" | "EN" | "PA" | "SH" | "BL" | "CA" | "SP";

export const STAT_NAMES: readonly StatName[] = ["HP", "AT", "EN", "PA", "SH", "BL", "CA", "SP"];

export type StatBlock = Record<StatName, number>;

/**
 * One stat growth curve. With x = level:
 *   mode 0: base + a*x
 *   mode 1: base + a*x^c
 *   mode 2: base + a*x - c*x^2
 *   mode 3: base + a*x + c*x^2
 * then floor and cap (9999 for HP, 99 otherwise). See statAt().
 */
export interface GrowthCurve {
  base: number;
  a: number;
  c: number;
  mode: number;
}

export interface PlayerDef {
  id: number;
  name: string;
  growth: Record<StatName, GrowthCurve>;
  statsLv1: StatBlock;
  statsLv99: StatBlock;
  modelIndex: number;
  /** Four tiers of technique ids. Tier 1 is always learnable; tiers 2..4 open at tierLevels[0..2]. */
  learnableTiers: number[][];
  /** Levels at which tiers 2, 3 and 4 open (not necessarily ascending in the data). */
  tierLevels: number[];
}

export interface PlayersFile {
  formula: string;
  players: PlayerDef[];
}

export type TechniqueKind = "none" | "shot" | "pass" | "tackle" | "evade" | "guard" | "passive";

export interface TechniqueDef {
  id: number;
  name: string;
  kind: TechniqueKind;
  hpCost: number;
  statBoost: number;
  chancePct: number;
  flags: number;
  description: string;
}

/** Raw JSON entry: id 0 ("(none)") has only id and name. */
export interface RawTechniqueEntry {
  id: number;
  name: string;
  kind?: string;
  hpCost?: number;
  statBoost?: number;
  chancePct?: number;
  flags?: number;
  description?: string;
}

export interface TeamDef {
  id: number;
  name: string;
}

export interface TeamsFile {
  teams: TeamDef[];
  formations: string[];
  prizes: string[];
}

/** New-game state of one player, straight from the game's init script. */
export interface RosterPlayerState {
  id: number;
  level: number;
  exp: number;
  /** Extra technique slots unlocked beyond the first. */
  techSlots: number;
  /** Games left on the contract; 255 means a permanent contract (Tidus). */
  contractGames: number;
  costPerGame: number;
  /** Five slots, technique id or 0 for empty. */
  equippedTechs: number[];
  /** Bit b (1..31) set = technique b learned. */
  learnedTechsPage1: number;
  /** Bit b set = technique 30+b learned (techniques 32..60). */
  learnedTechsPage2: number;
  team: number | null;
  teamSlot: number | null;
}

export interface RosterTeam {
  id: number;
  name: string;
  /** Eight slots of player id, null = empty. */
  players: (number | null)[];
}

export interface RostersFile {
  source: string;
  teams: RosterTeam[];
  players: RosterPlayerState[];
}

export interface GameData {
  players: PlayerDef[];
  techniques: TechniqueDef[];
  teams: TeamsFile;
  rosters: RostersFile;
}
