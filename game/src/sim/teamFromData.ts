/**
 * teamFromData.ts - Build sim TeamDefs from the extracted game data.
 *
 * teamDefFromRoster() takes a team id from data/json and the per-player
 * level / equipped techniques (defaulting to the new-game roster state) and
 * returns a TeamDef whose six starters sit in the sim's ROLE_ORDER
 * (LF, RF, MF, LD, RD, GK = roster slots 0..5). Stats come from statAt().
 */

import {
  canLearnAt,
  type PlayerDef as DataPlayerDef,
  type GameData,
  learnedTechniques,
  type RosterPlayerState,
  statsAt,
} from "../data";
import type { FormationId, Personality, PlayerDef, Stats, TeamDef } from "./types";

export interface RosterPlayerSpec {
  /** Numeric player id from data/json. */
  id: number;
  level: number;
  /** Equipped technique ids (0 omitted). */
  techniques: number[];
  /** Known technique ids (learned set); defaults to the equipped list. */
  learned?: number[];
}

export interface TeamFromDataOptions {
  formation?: FormationId;
  personality?: Personality;
  /** Override the level per player id. */
  levels?: Record<number, number>;
  /** Override the equipped techniques per player id. */
  equipped?: Record<number, number[]>;
}

/** Default personalities by data team id (Goers aggressive, Psyches technical, Fangs physical). */
const PERSONALITY_BY_TEAM: Record<number, Personality> = {
  0: "aggressive",
  2: "technical",
  3: "physical",
};

/** Stable string id for a data player: lowercase name with non-alphanumerics collapsed ("tidus", "ropp"). */
export function playerSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function teamSlug(name: string): string {
  return playerSlug(name);
}

function toStats(def: DataPlayerDef, level: number): Stats {
  const s = statsAt(def, level);
  return { hp: s.HP, en: s.EN, at: s.AT, pa: s.PA, bl: s.BL, sh: s.SH, ca: s.CA, sp: s.SP };
}

/** Equipped technique ids that count: only the first techSlots + 1 entries of the roster list. */
export function equippedFromRoster(state: RosterPlayerState): number[] {
  return state.equippedTechs.slice(0, state.techSlots + 1).filter((t) => t !== 0);
}

/** One sim PlayerDef from a data player at a level with an equipped list. */
export function playerDefFromData(data: GameData, teamId: string, spec: RosterPlayerSpec): PlayerDef {
  const def = data.players[spec.id];
  if (!def) throw new RangeError(`no player with id ${spec.id}`);
  const level = Math.max(1, Math.min(99, Math.floor(spec.level)));
  const techniques = spec.techniques.filter((t) => t !== 0 && canLearnAt(def, t, 99) !== undefined);
  const learned = new Set<number>([...(spec.learned ?? []), ...techniques]);
  return {
    id: playerSlug(def.name),
    name: def.name,
    teamId,
    dataId: def.id,
    stats: toStats(def, level),
    level,
    techniques,
    keyTechniques: [...learned].sort((a, b) => a - b),
    learnableTiers: def.learnableTiers,
    tierLevels: def.tierLevels,
  };
}

/** TeamDef from explicit player specs (starters first, in roster slot order). */
export function teamDefFromPlayers(
  data: GameData,
  teamId: number,
  players: RosterPlayerSpec[],
  opts: TeamFromDataOptions = {},
): TeamDef {
  const team = data.teams.teams[teamId];
  if (!team) throw new RangeError(`no team with id ${teamId}`);
  if (players.length < 6) throw new Error(`team ${team.name} needs 6 starters, got ${players.length}`);
  const id = teamSlug(team.name);
  return {
    id,
    name: team.name,
    dataId: teamId,
    formation: opts.formation ?? "standard",
    personality: opts.personality ?? PERSONALITY_BY_TEAM[teamId] ?? "balanced",
    players: players.map((spec) =>
      playerDefFromData(data, id, {
        ...spec,
        level: opts.levels?.[spec.id] ?? spec.level,
        techniques: opts.equipped?.[spec.id] ?? spec.techniques,
      }),
    ),
  };
}

/**
 * TeamDef for a data team at its new-game roster state (levels, equipped and
 * learned techniques from rosters.json), with optional overrides.
 */
export function teamDefFromRoster(data: GameData, teamId: number, opts: TeamFromDataOptions = {}): TeamDef {
  const roster = data.rosters.teams[teamId];
  if (!roster) throw new RangeError(`no roster for team ${teamId}`);
  const specs: RosterPlayerSpec[] = [];
  for (const pid of roster.players) {
    if (pid === null) continue;
    const state = data.rosters.players[pid];
    specs.push({
      id: pid,
      level: state.level,
      techniques: equippedFromRoster(state),
      learned: learnedTechniques(data.players[pid], state),
    });
  }
  return teamDefFromPlayers(data, teamId, specs, opts);
}
