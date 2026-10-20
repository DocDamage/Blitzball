/**
 * index.ts - Typed loader for the extracted game data in data/json.
 *
 * The JSON files are imported directly (resolveJsonModule + Vite fs.allow),
 * so nothing is copied into the game tree. loadGameData() is synchronous and
 * memoised; the returned objects are frozen and shared, so treat them as
 * read-only.
 */

import playersJson from "../../../data/json/players.json";
import rostersJson from "../../../data/json/rosters.json";
import teamsJson from "../../../data/json/teams.json";
import techniquesJson from "../../../data/json/techniques.json";
import { learnedTechniqueIds } from "./techniques";
import type {
  GameData,
  PlayerDef,
  PlayersFile,
  RawTechniqueEntry,
  RostersFile,
  TeamsFile,
  TechniqueDef,
  TechniqueKind,
} from "./types";

export * from "./stats";
export * from "./techniques";
export * from "./types";

const TECHNIQUE_KINDS: readonly TechniqueKind[] = ["none", "shot", "pass", "tackle", "evade", "guard", "passive"];

function normaliseTechnique(raw: RawTechniqueEntry): TechniqueDef {
  const kind = (raw.kind ?? "none") as TechniqueKind;
  if (!TECHNIQUE_KINDS.includes(kind)) throw new Error(`Unknown technique kind "${raw.kind}" (id ${raw.id})`);
  return {
    id: raw.id,
    name: raw.name,
    kind,
    hpCost: raw.hpCost ?? 0,
    statBoost: raw.statBoost ?? 0,
    chancePct: raw.chancePct ?? 0,
    flags: raw.flags ?? 0,
    description: raw.description ?? "",
  };
}

let cached: GameData | undefined;

/** Load and validate all four data files. Cheap after the first call. */
export function loadGameData(): GameData {
  if (cached) return cached;
  const players = (playersJson as PlayersFile).players;
  const techniques = (techniquesJson as RawTechniqueEntry[]).map(normaliseTechnique);
  const teams = teamsJson as TeamsFile;
  const rosters = rostersJson as RostersFile;

  players.forEach((p, i) => {
    if (p.id !== i) throw new Error(`players.json: id ${p.id} at index ${i}`);
    if (p.learnableTiers.length !== 4 || p.tierLevels.length !== 3)
      throw new Error(`players.json: bad tiers for ${p.name}`);
  });
  techniques.forEach((t, i) => {
    if (t.id !== i) throw new Error(`techniques.json: id ${t.id} at index ${i}`);
  });
  rosters.players.forEach((p, i) => {
    if (p.id !== i) throw new Error(`rosters.json: id ${p.id} at index ${i}`);
    if (p.equippedTechs.length !== 5)
      throw new Error(`rosters.json: player ${p.id} has ${p.equippedTechs.length} equip slots`);
  });

  cached = Object.freeze({ players, techniques, teams, rosters });
  return cached;
}

export function playerById(id: number, data: GameData = loadGameData()): PlayerDef {
  const p = data.players[id];
  if (!p) throw new RangeError(`no player with id ${id}`);
  return p;
}

export function techniqueById(id: number, data: GameData = loadGameData()): TechniqueDef {
  const t = data.techniques[id];
  if (!t) throw new RangeError(`no technique with id ${id}`);
  return t;
}

export function teamName(id: number, data: GameData = loadGameData()): string {
  const t = data.teams.teams[id];
  if (!t) throw new RangeError(`no team with id ${id}`);
  return t.name;
}

/**
 * Technique ids a roster player knows: the learned bitmask plus anything
 * equipped (the init script equips a few techniques without setting their
 * learned bit, e.g. Tidus' Sphere Shot).
 */
export function learnedTechniques(
  player: PlayerDef,
  state: { id?: number; learnedTechsPage1: number; learnedTechsPage2: number; equippedTechs: readonly number[] },
): number[] {
  if (state.id !== undefined && state.id !== player.id) {
    throw new Error(`state for player ${state.id} passed with definition of ${player.id}`);
  }
  const ids = new Set<number>(learnedTechniqueIds(state));
  for (const t of state.equippedTechs) if (t !== 0) ids.add(t);
  return [...ids].sort((a, b) => a - b);
}
