/**
 * stats.ts - Stat growth curves. The formula is the one documented in
 * players.json ("formula"), validated by the extractor against community
 * level-99 tables and reproducing every statsLv1 / statsLv99 value exactly.
 */

import { type PlayerDef, STAT_NAMES, type StatBlock, type StatName } from "./types";

export const MAX_LEVEL = 99;
export const MIN_LEVEL = 1;

export function statCap(stat: StatName): number {
  return stat === "HP" ? 9999 : 99;
}

/** Value of one stat at a level, floored and capped. */
export function statAt(player: PlayerDef, stat: StatName, level: number): number {
  const x = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
  const { base, a, c, mode } = player.growth[stat];
  let v: number;
  switch (mode) {
    case 0:
      v = base + a * x;
      break;
    case 1:
      v = base + a * x ** c;
      break;
    case 2:
      v = base + a * x - c * x * x;
      break;
    case 3:
      v = base + a * x + c * x * x;
      break;
    default:
      throw new Error(`Unknown growth mode ${mode} for ${player.name} ${stat}`);
  }
  return Math.max(0, Math.min(statCap(stat), Math.floor(v)));
}

/** All eight stats at a level. */
export function statsAt(player: PlayerDef, level: number): StatBlock {
  const out = {} as StatBlock;
  for (const s of STAT_NAMES) out[s] = statAt(player, s, level);
  return out;
}
