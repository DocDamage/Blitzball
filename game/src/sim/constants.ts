/**
 * constants.ts - Every tunable number of the match simulation in one place.
 *
 * Units: pool distances are abstract "units" (the pool is 60 x 40 x 30),
 * speeds are units per second, times are seconds unless a name ends in TICKS.
 * FFX stats map to real-time play as described in BLITZBALL_PLAN.md 5.2:
 *   HP = stamina pool (sprint / tackles / techniques drain it, low HP slows)
 *   EN = breakthrough resistance against AT when tackled while carrying
 *   AT = tackle strength
 *   PA = pass speed + accuracy, contested by defender BL on interceptions
 *   BL = interception reach and strength
 *   SH = shot speed + power, contested by keeper CA (and blockers' BL)
 *   CA = keeper save radius and strength
 *   SP = swim speed
 * Contests are instant FFX-style comparisons: stat * seeded spread vs stat * spread.
 */

// ---------------------------------------------------------------- time
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const DEFAULT_HALF_SECONDS = 300;
export const DEFAULT_OVERTIME_SECONDS = 120;
/** Suggested slow-motion window for contested shots/tackles (presentation hint only). */
export const SLOW_MO_WINDOW_SECONDS = 0.4;
/** Freeze after a goal / at kickoff before play resumes (clock does not run). */
export const RESET_FREEZE_SECONDS = 1.5;

// ---------------------------------------------------------------- pool
/** Half extents of the axis-aligned pool box: 60 long (x), 40 across (y), 30 deep (z). */
export const POOL_HALF = Object.freeze({ x: 30, y: 20, z: 15 });
/** Goal mouth half extents on the x = +-POOL_HALF.x planes. */
export const GOAL_HALF_HEIGHT = 7; // along y
export const GOAL_HALF_DEPTH = 5; // along z
/** The keeper may not leave this strip in front of its own goal. */
export const KEEPER_ZONE_DEPTH = 9;
export const PLAYER_RADIUS = 0.8;
/** Formation slots in team-local [-1,1] coordinates are scaled by these. */
export const FORMATION_SCALE = Object.freeze({ x: 27, y: 17, z: 11 });
/** At kickoff every outfield player is pulled back to at least this local x. */
export const KICKOFF_MAX_LOCAL_X = -0.15;

// ---------------------------------------------------------------- movement
export const BASE_SPEED = 2.0;
export const SPEED_PER_SP = 0.1; // SP 60 -> 8 units/s
export const SPRINT_MULT = 1.4;
export const CARRY_SPEED_MULT = 0.92;
/** Speed multiplier at 0 HP (linear up to 1.0 at full HP). */
export const LOW_HP_SPEED_FLOOR = 0.5;
export const SPRINT_HP_PER_SECOND = 2.0;
export const ARRIVE_RADIUS = 0.4;
export const CARRY_OFFSET = 0.7;

// ---------------------------------------------------------------- passing
export const PASS_BASE_SPEED = 11;
export const PASS_SPEED_PER_PA = 0.5;
/** Pass power fades linearly with distance travelled down to PASS_MIN_POWER_FRAC. */
export const PASS_RANGE_FULL = 36;
export const PASS_MIN_POWER_FRAC = 0.3;
/** Lateral miss at the target = rnd(-1..1) * SPREAD * distance / (PA + BASE). */
export const PASS_MISS_SPREAD = 0.5;
export const PASS_ACCURACY_BASE = 5;
export const CATCH_RADIUS = 1.7;
export const PASS_OVERSHOOT = 2.5;
export const BLOCK_REACH_BASE = 1.3;
export const BLOCK_REACH_PER_BL = 0.12;
/** Pass "leads" the receiver by this many seconds of their current velocity. */
export const PASS_LEAD_SECONDS = 0.35;

// ---------------------------------------------------------------- tackling
export const TACKLE_RANGE = 1.9;
export const TACKLE_HP_COST = 3;
export const BREAKTHROUGH_HP_COST = 2;
export const TACKLE_COOLDOWN_SECONDS = 1.0;
export const TACKLED_STUN_SECONDS = 0.45;
export const TACKLE_WHIFF_STUN_SECONDS = 0.7;

// ---------------------------------------------------------------- shooting
export const SHOT_BASE_SPEED = 15;
export const SHOT_SPEED_PER_SH = 0.35;
export const SHOT_MAX_RANGE = 24;
export const SHOT_POWER_DECAY_PER_UNIT = 0.12;
/** Each blocker in reach subtracts BL * spread * this from the shot power. */
export const SHOT_BLOCK_FACTOR = 0.45;
export const SHOT_MISS_SPREAD = 0.55;
export const SHOT_ACCURACY_BASE = 6;
export const SAVE_RADIUS_BASE = 2.5;
export const SAVE_RADIUS_PER_CA = 0.3;
/** Keeper CA is multiplied by this in the save contest. */
export const KEEPER_SAVE_MULT = 1.0;
export const KEEPER_HOLD_SECONDS = 0.8;
export const KEEPER_MAX_HOLD_SECONDS = 3.0;

// ---------------------------------------------------------------- contests
export const CONTEST_SPREAD_MIN = 0.75;
export const CONTEST_SPREAD_MAX = 1.25;

// ---------------------------------------------------------------- statuses
export const POISON_HP_PER_SECOND = 2.0;
export const WITHER_STAT_MULT = 0.5;
export const NAP_SPEED_MULT = 0.5;

// ---------------------------------------------------------------- techcopy
export const TECHCOPY_CHANCE = 0.12;
export const TECHCOPY_RADIUS = 30;

// ---------------------------------------------------------------- loose ball
export const PICKUP_RADIUS = 1.3;
export const LOOSE_DRAG_PER_TICK = 0.97;
export const WALL_BOUNCE = 0.5;
export const TACKLE_KNOCK_SPEED = 6;

// ---------------------------------------------------------------- AI
/** Minimum ticks a receiver keeps the ball before passing it on again. */
export const AI_MIN_HOLD_TICKS = 24;
export const AI_PRESS_DISTANCE = 12;
export const AI_MARK_OFFSET = 2.5;
export const AI_ATTACK_SHIFT = 0.35;
export const AI_DEFENSE_SHIFT = -0.3;
export const AI_LANE_CLEAR_DIST = 4;
