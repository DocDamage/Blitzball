/**
 * techniques.ts - Learned-technique bitmask helpers and tier rules.
 *
 * The game stores learned techniques in two 32-bit pages:
 *   page1 bit b (1..31) = technique b
 *   page2 bit b (2..30) = technique 30+b  (techniques 32..60)
 * Technique 0 is "(none)". All masks are handled as unsigned 32-bit values.
 */

import type { PlayerDef } from "./types";

export const TECHNIQUE_COUNT = 60;
export const EQUIP_SLOTS = 5;

export interface LearnedMasks {
  learnedTechsPage1: number;
  learnedTechsPage2: number;
}

function bitOf(techId: number): { page: 1 | 2; bit: number } {
  if (!Number.isInteger(techId) || techId < 1 || techId > TECHNIQUE_COUNT) {
    throw new RangeError(`technique id out of range: ${techId}`);
  }
  return techId <= 31 ? { page: 1, bit: techId } : { page: 2, bit: techId - 30 };
}

export function hasLearned(masks: LearnedMasks, techId: number): boolean {
  if (techId === 0) return false;
  const { page, bit } = bitOf(techId);
  const mask = page === 1 ? masks.learnedTechsPage1 : masks.learnedTechsPage2;
  return ((mask >>> bit) & 1) === 1;
}

/** Returns new masks with the technique set (does not mutate). */
export function withLearned(masks: LearnedMasks, techId: number): LearnedMasks {
  const { page, bit } = bitOf(techId);
  const flag = (1 << bit) >>> 0;
  return page === 1
    ? { learnedTechsPage1: (masks.learnedTechsPage1 | flag) >>> 0, learnedTechsPage2: masks.learnedTechsPage2 }
    : { learnedTechsPage1: masks.learnedTechsPage1, learnedTechsPage2: (masks.learnedTechsPage2 | flag) >>> 0 };
}

/** Ascending list of learned technique ids. */
export function learnedTechniqueIds(masks: LearnedMasks): number[] {
  const out: number[] = [];
  for (let t = 1; t <= TECHNIQUE_COUNT; t++) if (hasLearned(masks, t)) out.push(t);
  return out;
}

/** Build masks from a list of technique ids. */
export function masksFromIds(ids: Iterable<number>): LearnedMasks {
  let m: LearnedMasks = { learnedTechsPage1: 0, learnedTechsPage2: 0 };
  for (const id of ids) if (id !== 0) m = withLearned(m, id);
  return m;
}

/** Tier index (0..3) a technique sits in for this player, or -1 if the player can never learn it. */
export function techniqueTier(player: PlayerDef, techId: number): number {
  return player.learnableTiers.findIndex((tier) => tier.includes(techId));
}

/** Whether a tier (0..3) is open at a level. Tier 0 is always open. */
export function tierOpenAt(player: PlayerDef, tier: number, level: number): boolean {
  if (tier === 0) return true;
  const need = player.tierLevels[tier - 1];
  return need !== undefined && level >= need;
}

/** Can this player learn the technique at this level (ignoring whether already known)? */
export function canLearnAt(player: PlayerDef, techId: number, level: number): boolean {
  const tier = techniqueTier(player, techId);
  return tier >= 0 && tierOpenAt(player, tier, level);
}

/** Every technique id the player could learn at this level, ascending. */
export function learnableAt(player: PlayerDef, level: number): number[] {
  const out: number[] = [];
  player.learnableTiers.forEach((tier, i) => {
    if (tierOpenAt(player, i, level)) out.push(...tier);
  });
  return out.sort((a, b) => a - b);
}
