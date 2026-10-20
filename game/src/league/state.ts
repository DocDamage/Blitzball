/**
 * state.ts - The persistent league state and newGame().
 *
 * Everything is plain JSON-serialisable data (no classes, Maps or Sets) so a
 * LeagueState can be structured-cloned and written to a save slot as-is.
 * Functions in league/ mutate the state they are given and return it, unless
 * documented otherwise.
 */

import { loadGameData } from "../data";
import { ROSTER_SIZE, STARTING_GIL, TEAM_COUNT } from "./constants";
import type { MatchReport } from "./report";
import { LeagueRng } from "./rng";

export const LEAGUE_STATE_VERSION = 1;

export interface CareerStats {
  games: number;
  goals: number;
  assists: number;
  passes: number;
  tackles: number;
  shotsSaved: number;
}

export interface LeaguePlayerState {
  id: number;
  level: number;
  exp: number;
  /** Extra equip slots beyond the first (as in rosters.json). Capacity = techSlots + 1. */
  techSlots: number;
  /** Five slots, technique id or 0. */
  equippedTechs: number[];
  learnedTechsPage1: number;
  learnedTechsPage2: number;
  /** Games left; PERMANENT_CONTRACT (255) never counts down. 0 = free agent. */
  contractGames: number;
  costPerGame: number;
  team: number | null;
  teamSlot: number | null;
  career: CareerStats;
  /** Stats in the current season only (reset by startSeason). */
  season: CareerStats;
}

export interface LeagueTeamState {
  id: number;
  name: string;
  /** Eight slots of player id, null = empty. Slots 0..5 are the starters. */
  players: (number | null)[];
  /** Index into teams.json formations. */
  formation: number;
  gil: number;
}

export interface Standing {
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export type CompetitionKind = "exhibition" | "league" | "tournament";

export interface Fixture {
  id: number;
  /** 0-based round within the competition. */
  round: number;
  home: number;
  away: number;
  /** Seed handed to the match resolver / simulation. */
  seed: number;
  /** Set once the match has been played. */
  result: MatchReport | null;
}

export interface Competition {
  kind: CompetitionKind;
  /** Season this competition belongs to. */
  season: number;
  fixtures: Fixture[];
  /** Round currently being played. */
  round: number;
  /** Total number of rounds. */
  rounds: number;
  /** Participants in seed order (tournaments) or team order (league). */
  teams: number[];
  /** Teams still alive (tournament) or all teams (league). */
  alive: number[];
  finished: boolean;
  champion: number | null;
  /** Final placing, best first, filled when finished. */
  placing: number[];
}

export interface MatchRecord {
  season: number;
  competition: CompetitionKind;
  round: number;
  report: MatchReport;
}

export interface PrizeInventoryEntry {
  /** Index into teams.json prizes. */
  prizeIndex: number;
  count: number;
}

export interface LeagueState {
  version: number;
  /** Seed the game was created with. */
  seed: number;
  /** Current RNG state (advanced by every league-layer random decision). */
  rngState: number;
  season: number;
  /** Matches the player's team has played in total. */
  day: number;
  playerTeam: number;
  teams: LeagueTeamState[];
  players: LeaguePlayerState[];
  gil: number;
  prizes: PrizeInventoryEntry[];
  competition: Competition | null;
  history: MatchRecord[];
  /** Standings of the last finished league, used to seed tournaments. */
  lastLeagueStandings: Standing[] | null;
}

export interface NewGameOptions {
  seed?: number;
  /** Team the player controls; defaults to Besaid Aurochs (5). */
  playerTeam?: number;
}

export function emptyCareer(): CareerStats {
  return { games: 0, goals: 0, assists: 0, passes: 0, tackles: 0, shotsSaved: 0 };
}

/** Fresh state matching the game's new-game init (rosters.json). */
export function newGame(opts: NewGameOptions = {}): LeagueState {
  const data = loadGameData();
  const seed = (opts.seed ?? 0x5eed) >>> 0;
  const playerTeam = opts.playerTeam ?? 5;
  if (playerTeam < 0 || playerTeam >= TEAM_COUNT) throw new RangeError(`bad player team ${playerTeam}`);

  const teams: LeagueTeamState[] = data.rosters.teams.map((t) => {
    const players = t.players.slice();
    while (players.length < ROSTER_SIZE) players.push(null);
    return { id: t.id, name: t.name, players, formation: 0, gil: 0 };
  });

  const players: LeaguePlayerState[] = data.rosters.players.map((p) => ({
    id: p.id,
    level: p.level,
    exp: p.exp,
    techSlots: p.techSlots,
    equippedTechs: p.equippedTechs.slice(),
    learnedTechsPage1: p.learnedTechsPage1,
    learnedTechsPage2: p.learnedTechsPage2,
    contractGames: p.contractGames,
    costPerGame: p.costPerGame,
    team: p.team,
    teamSlot: p.teamSlot,
    career: emptyCareer(),
    season: emptyCareer(),
  }));

  return {
    version: LEAGUE_STATE_VERSION,
    seed,
    rngState: new LeagueRng(seed).state,
    season: 1,
    day: 0,
    playerTeam,
    teams,
    players,
    gil: STARTING_GIL,
    prizes: [],
    competition: null,
    history: [],
    lastLeagueStandings: null,
  };
}

/** Run fn with the state's RNG and store the advanced RNG state. */
export function withRng<T>(state: LeagueState, fn: (rng: LeagueRng) => T): T {
  const rng = LeagueRng.fromState(state.rngState);
  try {
    return fn(rng);
  } finally {
    state.rngState = rng.state;
  }
}

export function playerState(state: LeagueState, playerId: number): LeaguePlayerState {
  const p = state.players[playerId];
  if (!p) throw new RangeError(`no player ${playerId}`);
  return p;
}

export function teamState(state: LeagueState, teamId: number): LeagueTeamState {
  const t = state.teams[teamId];
  if (!t) throw new RangeError(`no team ${teamId}`);
  return t;
}

/** Player ids on a team, starters first (slots 0..5), bench after. */
export function teamPlayerIds(state: LeagueState, teamId: number): number[] {
  return teamState(state, teamId).players.filter((p): p is number => p !== null);
}

export function starterIds(state: LeagueState, teamId: number): number[] {
  return teamState(state, teamId)
    .players.slice(0, 6)
    .filter((p): p is number => p !== null);
}

export function freeAgentIds(state: LeagueState): number[] {
  return state.players.filter((p) => p.team === null).map((p) => p.id);
}

export function addPrize(state: LeagueState, prizeIndex: number, count = 1): void {
  const entry = state.prizes.find((p) => p.prizeIndex === prizeIndex);
  if (entry) entry.count += count;
  else state.prizes.push({ prizeIndex, count });
}
