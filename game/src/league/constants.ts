/**
 * constants.ts - Tunables for the league layer.
 *
 * PLACEHOLDER WARNING: tools/docs/formulas.md (experience, level and slot
 * rules from the decompiled game script) did not exist when this was written.
 * Everything marked PLACEHOLDER below is a stand-in chosen to be consistent
 * with the new-game roster data and should be replaced once the real formulas
 * are documented. Keep all such numbers in this file.
 */

export const MAX_LEVEL = 99;

/**
 * PLACEHOLDER: cumulative EXP needed to be at level L.
 * A quadratic fitted through (3, 13), (4, 22) and (7, 56) so that it is
 * consistent with every level/exp pair in rosters.json (level 2 @ 11,
 * level 3 @ 13..20, level 4 @ 22, level 5 @ 32..33, level 7 @ 56..57).
 * Level 1 needs 0. Replace with the real table from the game script.
 */
export function expForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor((7 * level * level + 59 * level) / 12) - 7;
}

/** Level reached with a cumulative EXP total (never above MAX_LEVEL). */
export function levelForExp(exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && exp >= expForLevel(level + 1)) level++;
  return level;
}

/** PLACEHOLDER: EXP awarded per match action. */
export const EXP_PER_ACTION = {
  goal: 10,
  assist: 5,
  pass: 2,
  tackle: 3,
  shotSaved: 4,
  techniqueUsed: 1,
  /** Awarded to every player who took part in a match. */
  appearance: 3,
  /** Bonus to every player on the winning team. */
  win: 5,
} as const;

/** Maximum technique slots a player can equip (five in the original). */
export const MAX_TECH_SLOTS = 5;

/**
 * PLACEHOLDER: chance of unlocking an extra technique slot on each level-up
 * while below MAX_TECH_SLOTS. In the original the slot count is tied to the
 * level table; until that is extracted a 20% roll per level is used.
 */
export const TECH_SLOT_UNLOCK_CHANCE = 0.2;

/** Contract length that means "permanent" in the game's data (Tidus). */
export const PERMANENT_CONTRACT = 255;

/** Starting gil for the player's team (PLACEHOLDER; the original starts at 0 but earns prize gil). */
export const STARTING_GIL = 1000;

/** Default games requested when an AI team signs a player. */
export const AI_CONTRACT_GAMES = { min: 5, max: 20 } as const;

/** Chance an AI team re-signs a player whose contract just expired. */
export const AI_RESIGN_CHANCE = 0.6;

/** Chance per expired-contract check that an AI team poaches a free agent that fits. */
export const AI_POACH_CHANCE = 0.35;

/** Competition sizes. */
export const LEAGUE_GAMES_PER_TEAM = 10;
export const TOURNAMENT_ROUNDS = 3;
export const TEAM_COUNT = 6;
export const STARTERS = 6;
export const ROSTER_SIZE = 8;

/**
 * Prize tables. Indices refer to teams.json "prizes" (0 Tech Find,
 * 1 Attack Reels, 2 Status Reels, 3 Aurochs Reels). The gil amounts are
 * PLACEHOLDER values.
 */
export interface PrizeAward {
  /** Index into teams.json prizes, or null for gil only. */
  prizeIndex: number | null;
  gil: number;
}

export const PRIZE_TABLE: Record<"league" | "tournament" | "exhibition", PrizeAward[]> = {
  // [1st, 2nd, 3rd, ...]
  league: [
    { prizeIndex: 1, gil: 3000 },
    { prizeIndex: 0, gil: 1500 },
    { prizeIndex: null, gil: 500 },
  ],
  tournament: [
    { prizeIndex: 2, gil: 2000 },
    { prizeIndex: 0, gil: 1000 },
  ],
  exhibition: [{ prizeIndex: null, gil: 200 }],
};

/** PLACEHOLDER: an exhibition win against each team earns this much gil on top of PRIZE_TABLE. */
export const EXHIBITION_WIN_GIL = 100;
