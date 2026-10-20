/**
 * tactics.ts - Formation mapping and per-team marking assignments.
 *
 * LeagueState stores the FFX formation index (teams.json formations, nine
 * names); the simulation knows four presets. This module maps one to the
 * other and keeps the player's marking assignments (which opposing role each
 * of ours marks) in localStorage, keyed by team, since LeagueState has no
 * field for them. The TeamDef handed to the match carries them as `marks`
 * so a runtime that understands marking can use them.
 */

import { loadGameData } from "../data";
import { FORMATIONS } from "../sim/formations";
import type { FormationId, Role } from "../sim/types";
import { ROLE_ORDER } from "../sim/types";

export const TACTICS_KEY = "blitzball.tactics";

/** teams.json formation index -> sim preset. */
const INDEX_TO_SIM: readonly FormationId[] = [
  "standard", // Normal
  "counter", // Counter
  "attack", // Center Attack
  "attack", // Right Side
  "attack", // Left Side
  "defense", // Flat Line
  "attack", // Double Sides
  "defense", // All-Out Defense
  "defense", // Mark Mode
];

export function simFormation(index: number): FormationId {
  return INDEX_TO_SIM[index] ?? "standard";
}

export function formationNames(): string[] {
  return loadGameData().teams.formations;
}

export type Marks = Record<Role, Role | null>;

export function defaultMarks(formation: FormationId): Marks {
  return { ...FORMATIONS[formation].marks };
}

const OUTFIELD: readonly Role[] = ["LF", "RF", "MF", "LD", "RD"];

export function markableRoles(): readonly Role[] {
  return OUTFIELD;
}

export function roleOrder(): readonly Role[] {
  return ROLE_ORDER;
}

type TacticsStore = Record<string, { marks: Partial<Marks> }>;

function read(): TacticsStore {
  try {
    const raw = localStorage.getItem(TACTICS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as TacticsStore) : {};
  } catch {
    return {};
  }
}

function write(store: TacticsStore): void {
  try {
    localStorage.setItem(TACTICS_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function loadMarks(teamId: number, formation: FormationId): Marks {
  const base = defaultMarks(formation);
  const saved = read()[String(teamId)]?.marks ?? {};
  for (const role of ROLE_ORDER) {
    const v = saved[role];
    if (v === null || (typeof v === "string" && ROLE_ORDER.includes(v))) base[role] = v;
  }
  return base;
}

export function saveMarks(teamId: number, marks: Marks): void {
  const store = read();
  store[String(teamId)] = { marks };
  write(store);
}

export function resetMarks(teamId: number): void {
  const store = read();
  delete store[String(teamId)];
  write(store);
}
