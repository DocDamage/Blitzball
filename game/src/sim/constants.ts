/**
 * constants.ts - Every tunable number of the match simulation in one place.
 *
 * The contest rules come from the decompiled original match script (see
 * tools/docs/formulas.md); anything quoted in "frames" or "original units"
 * there is converted through the three mapping constants below:
 *   ORIGINAL_FPS               the original script waited one frame per loop
 *                              iteration; we assume 60 of them per second
 *   ORIG_UNITS_PER_POOL_UNIT   the original pool was measured in units where
 *                              an encounter radius was 130 and a shot decayed
 *                              every 100; our pool is a sphere (POOL_RADIUS)
 *   FRAMES_PER_GAME_SECOND     the match clock advanced one game-second every
 *                              ~19 frames (formulas.md section 7)
 * Units: pool distances are "pool units", speeds are pool units per second,
 * times are seconds unless a name ends in TICKS or FRAMES.
 */

// ---------------------------------------------------------------- time
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Frame rate the original script is assumed to have run at (formulas.md: UNCERTAIN, 60 or 30). */
export const ORIGINAL_FPS = 60;
/** Original frames -> sim ticks (never below one tick). */
export function framesToTicks(frames: number): number {
  return Math.max(1, Math.round((frames * TICK_RATE) / ORIGINAL_FPS));
}
/**
 * Ticks per game-second of the clock. The original ticked one game-second per ~19 frames (its 5:00 halves ran
 * about three times faster than real time, with the clock paused during encounters). This real-time game runs
 * the clock in real seconds; the original rate is kept for reference as ORIGINAL_FRAMES_PER_GAME_SECOND.
 */
export const FRAMES_PER_GAME_SECOND = 60;
export const ORIGINAL_FRAMES_PER_GAME_SECOND = 19;
/** Real seconds per half by default (3:00; 1, 3 and 5 minute options in settings). */
export const DEFAULT_HALF_SECONDS = 180;
export const DEFAULT_OVERTIME_SECONDS = 300;
/** Suggested slow-motion window for contested shots/tackles (presentation hint only). */
export const SLOW_MO_WINDOW_SECONDS = 0.4;
/** Freeze (real seconds) after a goal / at kickoff before play resumes; the clock does not run. */
export const RESET_FREEZE_SECONDS = 3.0;

// ---------------------------------------------------------------- pool
/**
 * The pool is a sphere of water, as in the original. FIELD_SCALE sizes it against the players (1 = the earlier
 * 60 x 40 x 30 box game; at 2.3 the sphere is ~33 player heights across, with the original Luca stadium around it).
 * Contact distances (encounters, catches, pickups, blocks) stay player-sized; field-sized distances scale.
 */
export const FIELD_SCALE = 2.3;
/** Swim and ball speeds scale less than the field so the bigger sphere still plays at a match pace. */
export const SPEED_SCALE = 1.6;
export const POOL_RADIUS = 30 * FIELD_SCALE;
/** The goal mouth grows less than the field (a bigger mouth makes keepers far easier to beat). */
export const GOAL_SCALE = 1.3;
/** Goal mouth half extents on the goal planes. */
export const GOAL_HALF_HEIGHT = 7 * GOAL_SCALE; // along y
export const GOAL_HALF_DEPTH = 5 * GOAL_SCALE; // along z
/** The goal planes sit where the goal mouth's corners touch the sphere. */
export const GOAL_X = Math.sqrt(POOL_RADIUS ** 2 - GOAL_HALF_HEIGHT ** 2 - GOAL_HALF_DEPTH ** 2);
/** Bounding half extents of the play volume (sphere clipped by the goal planes). */
export const POOL_HALF = Object.freeze({ x: GOAL_X, y: POOL_RADIUS, z: POOL_RADIUS });
/** Original script distance units per pool unit (encounter radius 130 -> 3.25 pool units). */
export const ORIG_UNITS_PER_POOL_UNIT = 50;
export function origUnits(u: number): number {
  return u / ORIG_UNITS_PER_POOL_UNIT;
}
/** The keeper may not leave this strip in front of its own goal. */
export const KEEPER_ZONE_DEPTH = 9 * GOAL_SCALE;
export const PLAYER_RADIUS = 0.8;
/** Formation slots in team-local [-1,1] coordinates are scaled by these. */
export const FORMATION_SCALE = Object.freeze({ x: 27 * FIELD_SCALE, y: 17 * FIELD_SCALE, z: 11 * FIELD_SCALE });
/** At kickoff every outfield player is pulled back to at least this local x. */
export const KICKOFF_MAX_LOCAL_X = -0.15;

// ---------------------------------------------------------------- movement
/** Movement speed is the SP stat used directly in the original; here SP * SPEED_PER_SP pool units/s. */
export const SPEED_PER_SP = 0.03 * SPEED_SCALE; // with SPEED_BASE: SP 40 -> 3.8, SP 60 -> 4.8, SP 99 -> 6.7 units/s
/** Base swim speed added to SP * SPEED_PER_SP: compresses SP differences so slow teams stay playable in real time. */
export const SPEED_BASE = 1.2 * SPEED_SCALE;
/** Sprint is a sim extension (no sprint in the original): faster, costs HP. */
export const SPRINT_MULT = 1.35;
export const SPRINT_HP_PER_SECOND = 1.5;
export const CARRY_SPEED_MULT = 0.95;
export const ARRIVE_RADIUS = 0.4;
export const CARRY_OFFSET = 0.7;

// ---------------------------------------------------------------- encounters (formulas.md section 2)
/** Opponents within this radius of the carrier form the encounter (original 130 units). */
export const ENCOUNTER_RADIUS = origUnits(130);
/** Brawler adds this much to the encounter radius when it fires (original +120). */
export const BRAWLER_EXTRA_RADIUS = origUnits(120);
/** At most this many defenders take part in one encounter. */
export const MAX_ENCOUNTER_DEFENDERS = 5;
/** A defender locks onto the carrier below this distance (original 290, +100 with Elite Defense). */
export const DEFENDER_LOCK_RADIUS = origUnits(290) * SPEED_SCALE;
export const ELITE_DEFENSE_EXTRA_RADIUS = origUnits(100);
/** Stun applied to a player who loses the ball to a tackle / block (original 100 frames). */
export const BALL_LOST_STUN_FRAMES = 100;
/** Sim extension: a tackler may not tackle again for this long (one attempt per encounter in the original). */
export const TACKLE_COOLDOWN_SECONDS = 0.6;
/** Sim extension: a tackler who misses or is evaded is frozen briefly. */
export const TACKLE_WHIFF_STUN_SECONDS = 0.6;

// ---------------------------------------------------------------- flight (passes and shots)
export const PASS_BASE_SPEED = 9 * SPEED_SCALE;
export const PASS_SPEED_PER_PA = 0.25 * SPEED_SCALE;
export const SHOT_BASE_SPEED = 12 * SPEED_SCALE;
export const SHOT_SPEED_PER_SH = 0.25 * SPEED_SCALE;
/** Flight decay: every time the distance to the receiver / goal crosses a multiple of this, stat -= max(1, stat/5). */
export const FLIGHT_DECAY_DISTANCE = origUnits(100) * SPEED_SCALE;
export const FLIGHT_DECAY_DIVISOR = 5;
export const GOLDEN_ARM_DECAY_DIVISOR = 10;
export const CATCH_RADIUS = 1.7;
export const PASS_OVERSHOOT = 2.5;
/** Pass "leads" the receiver by this many seconds of their current velocity. */
export const PASS_LEAD_SECONDS = 0.35;
/** Sim extension: a defender the ball flies past may try one block roll if within this reach. */
export const BLOCK_REACH_BASE = 0.6;
export const BLOCK_REACH_PER_BL = 0.05;
/** A pass cannot be lane-blocked until it has travelled this far from the passer. */
export const PASS_CONTEST_MIN_TRAVEL = 1.5;
/** Shots are aimed at the goal mouth with a small random scatter (the original always reached the goalie). */
export const SHOT_MISS_SPREAD = 0.6;
export const SHOT_ACCURACY_BASE = 8;
/** Aimed shots (Jecht Shot 2 / Invisible Shot): caught when the keeper is within this of the crossing point (original 56 px). */
export const AIMED_SHOT_CATCH_RADIUS = 1.4;
/** Goalie deflection window base out of 10 (formulas.md: W = 4 + 3*SpinBall - 3*GripGloves). */
export const DEFLECT_WINDOW_BASE = 4;
/** Super Goalie / Spin Ball / Grip Gloves all need and cost this much HP. */
export const GOALIE_PASSIVE_HP = 30;
export const SUPER_GOALIE_CHANCE = 60;
export const SUPER_GOALIE_BONUS = 10;
export const KEEPER_HOLD_SECONDS = 2.0;
export const KEEPER_MAX_HOLD_SECONDS = 4.0;

// ---------------------------------------------------------------- HP tick (formulas.md section 3)
export const HP_TICK_EVERY_FRAMES = 3;
export const HP_TICK_CARRIER_STEP = 2;
export const HP_TICK_CARRIER_STEP_POISONED = 8;
export const HP_TICK_REGEN_BONUS = 3;
export const HP_TICK_LIMIT = 16;
export const POISON_DRAIN = 4;
export const PILE_VENOM_CAP = 1000;

// ---------------------------------------------------------------- statuses (formulas.md section 4)
export const VENOM_FRAMES = 500;
export const NAP_FRAMES = 800;
export const WITHER_FRAMES = 500;
export const GAMBLE_FRAMES = 400;
export const GOOD_MORNING_HP = 180;
export const GOOD_MORNING_CHANCE = 50;
export const GAMBLE_HP = 300;
export const GAMBLE_CHANCE = 50;

// ---------------------------------------------------------------- experience (formulas.md section 6)
export const EXP_CAP = 250;
export const EXP_GOALIE_START = 2;
export const EXP_TACKLE_MISSED = 1;
export const EXP_BREAKTHROUGH = 1;
export const EXP_RESIST = 1;
export const EXP_PASS_COMPLETE = 1;
export const EXP_BLOCK = 3;
export const EXP_GOAL = 2;
export const EXP_GOALIE_CATCH = 2;
export const EXP_AIMED_CATCH = 4;
export const EXP_GOOD_MORNING = 4;
export const EXP_GAMBLE = 4;
export const EXP_SUPER_GOALIE = 2;
export const EXP_VOLLEY = 3;

// ---------------------------------------------------------------- techcopy (formulas.md section 5)
export const TECHCOPY_LOWER_LEVEL_OUT_OF_10 = 2;
export const TECHCOPY_EQUAL_LEVEL_OUT_OF_10 = 5;

// ---------------------------------------------------------------- loose ball
export const PICKUP_RADIUS = 1.3;
export const LOOSE_DRAG_PER_TICK = 0.97;
export const WALL_BOUNCE = 0.5;
export const DEFLECT_SPEED = 5;
export const FUMBLE_SPEED = 2;

// ---------------------------------------------------------------- AI (formulas.md section 8)
/** Minimum ticks a receiver keeps the ball before acting again when not pressured. */
export const AI_MIN_HOLD_TICKS = 150;
/** Even under pressure a CPU carrier keeps the ball at least this long before passing or shooting. */
export const AI_PRESSURED_MIN_HOLD_TICKS = 120;
/** After holding the ball this long the AI carrier forces a shot or pass (no parking). */
export const AI_MAX_HOLD_TICKS = 420;
/** Per decision, chance (%) that an unpressured CPU carrier acts, by zone 0..6 (original per waypoint). */
export const AI_ACT_PCT_BY_ZONE: readonly number[] = [10, 30, 50, 70, 80, 90, 100];
/** Scale of AI_ACT_PCT_BY_ZONE per decision tick (decisions are far more frequent than waypoints). */
export const AI_ACT_PCT_SCALE = 0.008;
/** Chance (%) to keep dribbling when every defender could be broken, by zone. */
export const AI_DRIBBLE_PCT_BY_ZONE: readonly number[] = [70, 60, 60, 50, 50, 40, 0];
/** Shoot weight multiplier of SH by zone: shoot if rand(PA + w) < w. */
export const AI_SHOT_WEIGHT_BY_ZONE: readonly number[] = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 9];
/** The AI only shoots when its estimated chance of beating the goalie roll is at least this. */
export const AI_SHOT_MIN_CHANCE = 0.08;
/** Supporting teammates offer themselves this far ahead / beside the carrier. */
export const AI_SUPPORT_AHEAD = 4 * SPEED_SCALE;
export const AI_SUPPORT_SIDE = 3.5 * SPEED_SCALE;
/** AI aims this far inside the goal corners (y / z). */
export const AI_SHOT_CORNER_INSET_Y = 2.5 * GOAL_SCALE;
export const AI_SHOT_CORNER_INSET_Z = 2.0 * GOAL_SCALE;
export const AI_MARK_OFFSET = 2.5;
export const AI_LANE_CLEAR_DIST = 4;
/** Keeper follows the ball's y/z by this factor, clamped to +-AI_KEEPER_TRACK_CLAMP units. */
export const AI_KEEPER_TRACK = 0.4;
export const AI_KEEPER_TRACK_CLAMP = 3 * GOAL_SCALE;
/** Forwards' runs toward goal: this far out from the goal, this far off centre (y, z). */
export const AI_RUN_DEPTH = 10 * FIELD_SCALE;
export const AI_RUN_SIDE_Y = 6 * FIELD_SCALE;
export const AI_RUN_SIDE_Z = 3 * FIELD_SCALE;
/** A marker only shadows its man while the ball is within this distance of him. */
export const AI_MARK_RANGE = 28 * FIELD_SCALE;
/** Markers sprint to their position when further than this. */
export const AI_MARK_SPRINT_DIST = 8 * SPEED_SCALE;
