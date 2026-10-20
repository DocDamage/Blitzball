/**
 * techniques.ts - Technique registry built from the extracted techniques.json.
 *
 * Every technique the sim knows comes from data/json through src/data
 * (ids 1..60: names, kinds, hpCost, statBoost, chancePct, flags, descriptions).
 * This module only adds the rule metadata formulas.md section 5 derives from
 * the id ranges: status family and tier, EXP for use, passive behaviour,
 * Volley flag and the two aimed shots. Nothing here is hand-tuned gameplay.
 */

import { loadGameData } from "../data";
import type { PassiveKind, StatusFamily, Technique, TechniqueKind } from "./types";

/** Flag bits of techniques.json (formulas.md section 1). */
export const TECH_FLAG = Object.freeze({
  antiVenom: 2,
  antiNap: 4,
  antiWither: 8,
  antiDrain: 16,
  tackleSlip: 128,
  volley: 512,
  eliteDefense: 1024,
  brawler: 2048,
});

/** Status family by id range: Venom 5-7 / 14-16 / 26-28, Nap 8-10 / 17-19 / 29-31, Wither 11-13 / 20-22 / 32-34, Drain 35-37. */
function familyOf(id: number): { family?: StatusFamily; tier: number } {
  const ranges: [number, number, StatusFamily][] = [
    [5, 7, "venom"],
    [8, 10, "nap"],
    [11, 13, "wither"],
    [14, 16, "venom"],
    [17, 19, "nap"],
    [20, 22, "wither"],
    [26, 28, "venom"],
    [29, 31, "nap"],
    [32, 34, "wither"],
    [35, 37, "drain"],
  ];
  for (const [lo, hi, family] of ranges) if (id >= lo && id <= hi) return { family, tier: id - lo + 1 };
  // Anti-* guards: 40/41 venom, 42/43 nap, 44/45 wither, 46/47 drain
  if (id === 40 || id === 41) return { family: "venom", tier: id - 39 };
  if (id === 42 || id === 43) return { family: "nap", tier: id - 41 };
  if (id === 44 || id === 45) return { family: "wither", tier: id - 43 };
  if (id === 46 || id === 47) return { family: "drain", tier: id - 45 };
  return { tier: 0 };
}

const PASSIVE_BY_ID: Record<number, PassiveKind> = {
  48: "spinBall",
  49: "gripGloves",
  50: "eliteDefense",
  51: "brawler",
  52: "pileVenom",
  53: "pileWither",
  54: "regen",
  55: "goodMorning",
  56: "hiRisk",
  57: "goldenArm",
  58: "gamble",
  59: "superGoalie",
};

/** EXP for using a technique (formulas.md section 5): tiers 1/2/3 -> 1/2/3, shots as listed. */
function useExpOf(id: number, kind: TechniqueKind, tier: number): number {
  const fixed: Record<number, number> = { 1: 2, 2: 5, 3: 1, 4: 2, 60: 5 };
  if (fixed[id] !== undefined) return fixed[id];
  if (kind === "shot" || kind === "pass" || kind === "tackle") return tier > 0 ? tier : 1;
  return 0;
}

function build(): Map<number, Technique> {
  const out = new Map<number, Technique>();
  for (const raw of loadGameData().techniques) {
    if (raw.id === 0) continue;
    const { family, tier } = familyOf(raw.id);
    // Aurochs Spirit (60) is listed as passive in the data but the match script
    // treats it as a shot technique (+SH, EXP 5): formulas.md section 5.
    const kind: TechniqueKind = raw.id === 60 ? "shot" : raw.kind === "none" ? "passive" : raw.kind;
    out.set(raw.id, {
      id: raw.id,
      name: raw.name,
      kind,
      hpCost: raw.hpCost,
      statBoost: raw.statBoost,
      chancePct: raw.chancePct,
      flags: raw.flags,
      description: raw.description,
      family,
      tier: raw.id >= 23 && raw.id <= 25 ? raw.id - 22 : raw.id === 38 || raw.id === 39 ? raw.id - 37 : tier,
      useExp: useExpOf(raw.id, kind, tier),
      passive: PASSIVE_BY_ID[raw.id],
      volley: (raw.flags & TECH_FLAG.volley) !== 0,
      aimed: raw.id === 2 || raw.id === 4,
    });
  }
  return out;
}

let registry: Map<number, Technique> | undefined;

function reg(): Map<number, Technique> {
  registry ??= build();
  return registry;
}

export function getTechnique(id: number): Technique | undefined {
  return reg().get(id);
}

/** Throws for unknown ids (use when the id came from validated data). */
export function techniqueOrThrow(id: number): Technique {
  const t = reg().get(id);
  if (!t) throw new RangeError(`unknown technique id ${id}`);
  return t;
}

export function allTechniques(): Technique[] {
  return [...reg().values()];
}

/** Passive techniques that pay their hpCost once at match start (formulas.md section 1). */
export const START_COST_PASSIVES: readonly Exclude<PassiveKind, "brawler">[] = [
  "eliteDefense",
  "goldenArm",
  "pileVenom",
  "pileWither",
  "hiRisk",
  "regen",
];

/** Technique id by name, for tests and tooling. */
export function techniqueIdByName(name: string): number {
  for (const t of reg().values()) if (t.name === name) return t.id;
  throw new RangeError(`unknown technique "${name}"`);
}
