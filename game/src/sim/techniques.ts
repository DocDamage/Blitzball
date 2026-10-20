/**
 * techniques.ts - Built-in technique library keyed by id.
 *
 * These are placeholders with FFX-flavoured numbers; the real table is loaded
 * from data/json later and can be merged in with registerTechniques().
 * Technique kinds decide when they fire: shot/pass/tackle techniques are chosen
 * explicitly by the acting player, block/catch techniques fire automatically
 * during the matching contest if usable, passive ones always apply their mods.
 */

import type { Technique } from "./types";

const BUILTIN: Technique[] = [
  // ---- shots
  {
    id: "sphere-shot",
    name: "Sphere Shot",
    kind: "shot",
    hpCost: 40,
    statMods: { sh: 3 },
    cooldown: 6,
    techcopy: true,
  },
  {
    id: "jecht-shot",
    name: "Jecht Shot",
    kind: "shot",
    hpCost: 120,
    statMods: { sh: 5 },
    cooldown: 12,
    techcopy: false,
  },
  {
    id: "venom-shot",
    name: "Venom Shot",
    kind: "shot",
    hpCost: 60,
    statMods: { sh: 2 },
    inflicts: { kind: "poison", duration: 20, chance: 0.6 },
    cooldown: 8,
    techcopy: true,
  },
  {
    id: "nap-shot",
    name: "Nap Shot",
    kind: "shot",
    hpCost: 60,
    statMods: { sh: 2 },
    inflicts: { kind: "sleep", duration: 6, chance: 0.5 },
    cooldown: 8,
    techcopy: true,
  },
  {
    id: "wither-shot",
    name: "Wither Shot",
    kind: "shot",
    hpCost: 60,
    statMods: { sh: 2 },
    inflicts: { kind: "wither", duration: 25, chance: 0.6 },
    cooldown: 8,
    techcopy: true,
  },
  // ---- passes
  {
    id: "venom-pass",
    name: "Venom Pass",
    kind: "pass",
    hpCost: 30,
    statMods: { pa: 3 },
    inflicts: { kind: "poison", duration: 20, chance: 0.6 },
    cooldown: 5,
    techcopy: true,
  },
  {
    id: "nap-pass",
    name: "Nap Pass",
    kind: "pass",
    hpCost: 30,
    statMods: { pa: 3 },
    inflicts: { kind: "nap", duration: 8, chance: 0.6 },
    cooldown: 5,
    techcopy: true,
  },
  {
    id: "wither-pass",
    name: "Wither Pass",
    kind: "pass",
    hpCost: 30,
    statMods: { pa: 3 },
    inflicts: { kind: "wither", duration: 25, chance: 0.6 },
    cooldown: 5,
    techcopy: true,
  },
  // ---- tackles
  {
    id: "venom-tackle",
    name: "Venom Tackle",
    kind: "tackle",
    hpCost: 30,
    statMods: { at: 3 },
    inflicts: { kind: "poison", duration: 20, chance: 0.7 },
    cooldown: 5,
    techcopy: true,
  },
  {
    id: "nap-tackle",
    name: "Nap Tackle",
    kind: "tackle",
    hpCost: 30,
    statMods: { at: 3 },
    inflicts: { kind: "sleep", duration: 5, chance: 0.5 },
    cooldown: 5,
    techcopy: true,
  },
  {
    id: "wither-tackle",
    name: "Wither Tackle",
    kind: "tackle",
    hpCost: 30,
    statMods: { at: 3 },
    inflicts: { kind: "wither", duration: 25, chance: 0.6 },
    cooldown: 5,
    techcopy: true,
  },
  // ---- block / catch (auto-fire during contests)
  {
    id: "tackle-slip",
    name: "Tackle Slip",
    kind: "block",
    hpCost: 20,
    statMods: { bl: 4 },
    cooldown: 6,
    techcopy: true,
  },
  {
    id: "super-goalie",
    name: "Super Goalie",
    kind: "catch",
    hpCost: 30,
    statMods: { ca: 4 },
    cooldown: 8,
    techcopy: true,
  },
  // ---- passive
  { id: "anti-venom", name: "Anti-Venom", kind: "passive", hpCost: 0, statMods: {}, cooldown: 0, techcopy: true },
];

const registry = new Map<string, Technique>();
for (const t of BUILTIN) registry.set(t.id, t);

/** Add or replace techniques (used by the data loader later). */
export function registerTechniques(list: Technique[]): void {
  for (const t of list) registry.set(t.id, t);
}

export function getTechnique(id: string): Technique | undefined {
  return registry.get(id);
}

export function allTechniques(): Technique[] {
  return [...registry.values()];
}

/** Passive immunities: technique id -> status kinds it blocks. */
export const PASSIVE_IMMUNITY: Record<string, readonly string[]> = {
  "anti-venom": ["poison"],
};
