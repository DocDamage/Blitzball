/**
 * rules.ts - Pure contest formulas from the original match script
 * (tools/docs/formulas.md section 2 and 5). Each takes the match Rng so the
 * rolls stay deterministic per seed and are unit-testable in isolation.
 * Divisions are integer divisions, as in the original.
 */

import {
  FLIGHT_DECAY_DIVISOR,
  GOLDEN_ARM_DECAY_DIVISOR,
  TECHCOPY_EQUAL_LEVEL_OUT_OF_10,
  TECHCOPY_LOWER_LEVEL_OUT_OF_10,
} from "./constants";
/** Anything that can produce rand(n) in [0, n-1] (the match Rng, or a stub in tests). */
export interface RandSource {
  rand(n: number): number;
}

export interface Roll {
  /** AT'/2 + rand(AT') (tackle, goalie) or BL/2 + rand(BL + 1) (block). */
  value: number;
  /** The random part; 0 means the attempt missed / could not block. */
  random: number;
}

/** Tackle roll: r = AT'/2 + rand(AT'), random part 0 = " misses!". */
export function tackleRoll(rng: RandSource, at: number): Roll {
  const random = rng.rand(at);
  return { value: Math.floor(at / 2) + random, random };
}

/** Block roll of a defender against a pass or shot: r = BL/2 + rand(BL + 1), random 0 = " can't block it!". */
export function blockRoll(rng: RandSource, bl: number): Roll {
  const random = rng.rand(bl + 1);
  return { value: Math.floor(bl / 2) + random, random };
}

/** Goalie roll: g = CA'/2 + rand(CA'); the shot scores when g < SH'. */
export function goalieRoll(rng: RandSource, ca: number): number {
  return Math.floor(ca / 2) + rng.rand(ca);
}

/** One flight-decay step: stat -= max(1, stat / 5) (/ 10 with Golden Arm), floored at 0. */
export function flightDecay(stat: number, goldenArm: boolean): number {
  const divisor = goldenArm ? GOLDEN_ARM_DECAY_DIVISOR : FLIGHT_DECAY_DIVISOR;
  return Math.max(0, stat - Math.max(1, Math.floor(stat / divisor)));
}

/** Techcopy success threshold out of 10 by level relation: lower 2, equal 5, higher 10 (always). */
export function techcopyThreshold(copierLevel: number, userLevel: number): number {
  if (copierLevel < userLevel) return TECHCOPY_LOWER_LEVEL_OUT_OF_10;
  if (copierLevel === userLevel) return TECHCOPY_EQUAL_LEVEL_OUT_OF_10;
  return 10;
}

export function techcopyRoll(rng: RandSource, copierLevel: number, userLevel: number): boolean {
  return rng.rand(10) < techcopyThreshold(copierLevel, userLevel);
}

/** Stat boost capped at 99 (formulas.md: AT' = min(99, AT + statBoost) etc.). */
export function boosted(stat: number, boost: number): number {
  return Math.min(99, stat + boost);
}

/**
 * CPU shot range (formulas.md section 8): d = dist / 100 original units;
 * if SH/10 != 0 then d *= SH/10; out of range when d > SH.
 */
export function shotInRange(sh: number, distOrigUnits: number): boolean {
  let d = Math.floor(distOrigUnits / 100);
  const tens = Math.floor(sh / 10);
  if (tens !== 0) d *= tens;
  return d <= sh;
}
