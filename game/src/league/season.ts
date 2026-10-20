/**
 * season.ts - Competitions, calendar, standings, prizes and stats leaders.
 *
 * Flow for one round of any competition:
 *   1. aiRosterPhase()           AI teams fill rosters from the free agents
 *   2. playerFixture()           the UI plays the player's match in sim/ ...
 *   3. recordResult(report)      ... and hands the MatchReport back, or
 *      resolveRound(resolver)    resolves every unplayed fixture (AI vs AI,
 *                                and the player's if not yet recorded) with
 *                                the injected MatchResolver, then advances.
 * When the last round finishes, prizes are awarded and the champion set.
 */

import { loadGameData } from "../data";
import { EXHIBITION_WIN_GIL, LEAGUE_GAMES_PER_TEAM, PRIZE_TABLE, TEAM_COUNT, TOURNAMENT_ROUNDS } from "./constants";
import { afterMatchContracts, aiRosterPhase, type ContractEvent, playerRating } from "./contracts";
import { applyMatchReport, type GrowthEvent } from "./growth";
import { type MatchReport, winnerOf } from "./report";
import { type MatchResolver, resolverTeam, statisticalResolver } from "./resolver";
import { mixSeed } from "./rng";
import {
  addPrize,
  type CareerStats,
  type Competition,
  type CompetitionKind,
  emptyCareer,
  type Fixture,
  type LeagueState,
  type Standing,
  teamPlayerIds,
  teamState,
} from "./state";

// ------------------------------------------------------------ construction

function fixtureSeed(state: LeagueState, kind: CompetitionKind, round: number, home: number, away: number): number {
  const kindId = kind === "league" ? 1 : kind === "tournament" ? 2 : 3;
  return mixSeed(state.seed, state.season, kindId, round, home, away);
}

function makeFixture(state: LeagueState, comp: Competition, round: number, home: number, away: number): Fixture {
  const f: Fixture = {
    id: comp.fixtures.length,
    round,
    home,
    away,
    seed: fixtureSeed(state, comp.kind, round, home, away),
    result: null,
  };
  comp.fixtures.push(f);
  return f;
}

function requireIdle(state: LeagueState): void {
  if (state.competition && !state.competition.finished) {
    throw new Error(`a ${state.competition.kind} is still in progress`);
  }
}

/** Reset per-season stats. Called by startLeague when a new season begins. */
export function startSeason(state: LeagueState): void {
  state.season++;
  state.lastLeagueStandings = null;
  for (const p of state.players) p.season = emptyCareer();
}

/** One friendly against `opponent`. */
export function startExhibition(state: LeagueState, opponent: number, playerIsHome = true): Competition {
  requireIdle(state);
  if (opponent === state.playerTeam || opponent < 0 || opponent >= TEAM_COUNT) throw new RangeError("bad opponent");
  const comp: Competition = {
    kind: "exhibition",
    season: state.season,
    fixtures: [],
    round: 0,
    rounds: 1,
    teams: [state.playerTeam, opponent],
    alive: [state.playerTeam, opponent],
    finished: false,
    champion: null,
    placing: [],
  };
  const [home, away] = playerIsHome ? [state.playerTeam, opponent] : [opponent, state.playerTeam];
  makeFixture(state, comp, 0, home, away);
  state.competition = comp;
  return comp;
}

/**
 * League: double round robin over the six teams by the circle method:
 * 5 rounds of 3 matches, then the same 5 rounds with home/away swapped,
 * so every team plays LEAGUE_GAMES_PER_TEAM (10) games.
 */
export function startLeague(state: LeagueState): Competition {
  requireIdle(state);
  // A league already completed this season means this is the next season.
  if (state.lastLeagueStandings !== null) startSeason(state);
  const teams = state.teams.map((t) => t.id);
  const comp: Competition = {
    kind: "league",
    season: state.season,
    fixtures: [],
    round: 0,
    rounds: LEAGUE_GAMES_PER_TEAM,
    teams,
    alive: teams.slice(),
    finished: false,
    champion: null,
    placing: [],
  };
  const n = teams.length; // 6
  const rotating = teams.slice(1);
  const singleRounds = n - 1;
  for (let r = 0; r < singleRounds; r++) {
    const order = [teams[0], ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      // Alternate home/away so each team gets a balanced mix.
      const [home, away] = (r + i) % 2 === 0 ? [a, b] : [b, a];
      makeFixture(state, comp, r, home, away);
      makeFixture(state, comp, r + singleRounds, away, home);
    }
    rotating.unshift(rotating.pop() as number);
  }
  comp.fixtures.sort((x, y) => x.round - y.round || x.id - y.id);
  comp.fixtures.forEach((f, i) => {
    f.id = i;
  });
  state.competition = comp;
  return comp;
}

/** Team strength for seeding when no league standings exist yet. */
export function teamRating(state: LeagueState, teamId: number): number {
  return teamPlayerIds(state, teamId)
    .slice(0, 6)
    .reduce((a, pid) => a + playerRating(state, pid), 0);
}

/** Seed order: last league standings if available, otherwise by team rating. */
export function tournamentSeeds(state: LeagueState): number[] {
  if (state.lastLeagueStandings) return state.lastLeagueStandings.map((s) => s.teamId);
  return state.teams.map((t) => t.id).sort((a, b) => teamRating(state, b) - teamRating(state, a) || a - b);
}

/**
 * Tournament: three knockout rounds. Seeds 1 and 2 skip the first round;
 * round 0 plays 3v6 and 4v5, round 1 the semi-finals, round 2 the final.
 * Later-round fixtures are created as winners are known.
 */
export function startTournament(state: LeagueState): Competition {
  requireIdle(state);
  const seeds = tournamentSeeds(state);
  const comp: Competition = {
    kind: "tournament",
    season: state.season,
    fixtures: [],
    round: 0,
    rounds: TOURNAMENT_ROUNDS,
    teams: seeds,
    alive: seeds.slice(),
    finished: false,
    champion: null,
    placing: [],
  };
  makeFixture(state, comp, 0, seeds[2], seeds[5]);
  makeFixture(state, comp, 0, seeds[3], seeds[4]);
  state.competition = comp;
  return comp;
}

// ------------------------------------------------------------------ queries

export function currentFixtures(state: LeagueState): Fixture[] {
  const c = state.competition;
  if (!c || c.finished) return [];
  return c.fixtures.filter((f) => f.round === c.round);
}

/** The player's unplayed fixture in the current round, if any. */
export function playerFixture(state: LeagueState): Fixture | null {
  const me = state.playerTeam;
  return currentFixtures(state).find((f) => f.result === null && (f.home === me || f.away === me)) ?? null;
}

export function roundComplete(state: LeagueState): boolean {
  return currentFixtures(state).every((f) => f.result !== null);
}

// ------------------------------------------------------------------ results

export interface ResultEvents {
  growth: GrowthEvent[];
  contracts: ContractEvent[];
}

/** Record a played fixture's report: history, growth, contracts. Does not advance the round. */
export function recordResult(state: LeagueState, fixtureId: number, report: MatchReport): ResultEvents {
  const c = state.competition;
  if (!c || c.finished) throw new Error("no competition in progress");
  const f = c.fixtures[fixtureId];
  if (!f || f.round !== c.round) throw new Error(`fixture ${fixtureId} is not in the current round`);
  if (f.result) throw new Error(`fixture ${fixtureId} already played`);
  if (report.homeTeam !== f.home || report.awayTeam !== f.away) throw new Error("report does not match fixture");
  f.result = report;
  state.history.push({ season: c.season, competition: c.kind, round: c.round, report });
  const growth = applyMatchReport(state, report);
  const contracts = afterMatchContracts(state, [f.home, f.away]);
  if (f.home === state.playerTeam || f.away === state.playerTeam) {
    state.day++;
    if (c.kind === "exhibition" && winnerOf(report) === state.playerTeam) state.gil += EXHIBITION_WIN_GIL;
  }
  return { growth, contracts };
}

// ---------------------------------------------------------------- standings

export function emptyStanding(teamId: number): Standing {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

/** Standings for a competition (default: the current one), sorted best first. */
export function standings(state: LeagueState, comp: Competition | null = state.competition): Standing[] {
  const table = new Map<number, Standing>();
  const teams = comp ? comp.teams : state.teams.map((t) => t.id);
  for (const id of teams) table.set(id, emptyStanding(id));
  const get = (id: number): Standing => {
    let s = table.get(id);
    if (!s) {
      s = emptyStanding(id);
      table.set(id, s);
    }
    return s;
  };
  for (const f of comp?.fixtures ?? []) {
    if (!f.result) continue;
    const [hg, ag] = f.result.score;
    const h = get(f.home);
    const a = get(f.away);
    h.played++;
    a.played++;
    h.goalsFor += hg;
    h.goalsAgainst += ag;
    a.goalsFor += ag;
    a.goalsAgainst += hg;
    if (hg > ag) {
      h.won++;
      a.lost++;
      h.points += 3;
    } else if (ag > hg) {
      a.won++;
      h.lost++;
      a.points += 3;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  return [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) ||
      y.goalsFor - x.goalsFor ||
      x.teamId - y.teamId,
  );
}

export interface Leader {
  playerId: number;
  name: string;
  teamId: number | null;
  value: number;
}

/** Top `n` players by a stat, this season (default) or career. */
export function statsLeaders(
  state: LeagueState,
  stat: keyof CareerStats,
  n = 5,
  scope: "season" | "career" = "season",
): Leader[] {
  const data = loadGameData();
  return state.players
    .map((p) => ({ playerId: p.id, name: data.players[p.id].name, teamId: p.team, value: p[scope][stat] }))
    .filter((l) => l.value > 0)
    .sort((a, b) => b.value - a.value || a.playerId - b.playerId)
    .slice(0, n);
}

// ------------------------------------------------------------------ prizes

export interface PrizeEvent {
  teamId: number;
  place: number;
  prizeIndex: number | null;
  prizeName: string | null;
  gil: number;
}

function awardPrizes(state: LeagueState, comp: Competition): PrizeEvent[] {
  const names = loadGameData().teams.prizes;
  const table = PRIZE_TABLE[comp.kind];
  const events: PrizeEvent[] = [];
  comp.placing.forEach((teamId, place) => {
    const award = table[place];
    if (!award) return;
    if (comp.kind === "exhibition" && place !== 0) return;
    if (teamId === state.playerTeam) {
      state.gil += award.gil;
      if (award.prizeIndex !== null) addPrize(state, award.prizeIndex);
    } else {
      teamState(state, teamId).gil += award.gil;
    }
    events.push({
      teamId,
      place,
      prizeIndex: award.prizeIndex,
      prizeName: award.prizeIndex === null ? null : (names[award.prizeIndex] ?? null),
      gil: award.gil,
    });
  });
  return events;
}

// ------------------------------------------------------------ progression

export interface RoundResult {
  round: number;
  reports: MatchReport[];
  events: ResultEvents[];
  rosterMoves: ContractEvent[];
  finished: boolean;
  prizes: PrizeEvent[];
}

function finishCompetition(state: LeagueState, comp: Competition): PrizeEvent[] {
  comp.finished = true;
  if (comp.kind === "league") {
    const table = standings(state, comp);
    comp.placing = table.map((s) => s.teamId);
    state.lastLeagueStandings = table;
  } else if (comp.kind === "exhibition") {
    const w = winnerOf(comp.fixtures[0].result as MatchReport);
    comp.placing = w === null ? [] : [w, ...comp.teams.filter((t) => t !== w)];
  }
  // Tournament placing is built as rounds resolve (see advanceTournament).
  comp.champion = comp.placing[0] ?? null;
  return awardPrizes(state, comp);
}

function advanceTournament(state: LeagueState, comp: Competition): void {
  const played = comp.fixtures.filter((f) => f.round === comp.round);
  const losers: number[] = [];
  const winners: number[] = [];
  for (const f of played) {
    const r = f.result as MatchReport;
    let w = winnerOf(r);
    // Knockouts cannot end level: the home side (higher seed) advances on a draw.
    if (w === null) w = f.home;
    winners.push(w);
    losers.push(w === f.home ? f.away : f.home);
  }
  // Losers of the same round share a placing block, better seed first.
  const seedOf = (t: number) => comp.teams.indexOf(t);
  losers.sort((a, b) => seedOf(a) - seedOf(b));
  comp.placing.unshift(...losers);
  comp.alive = comp.alive.filter((t) => !losers.includes(t));
  if (comp.round === 0) {
    // Semi-finals: seed 1 v winner(4v5), seed 2 v winner(3v6).
    const [w36, w45] = winners;
    makeFixture(state, comp, 1, comp.teams[0], w45);
    makeFixture(state, comp, 1, comp.teams[1], w36);
  } else if (comp.round === 1) {
    const [a, b] = winners;
    const [home, away] = seedOf(a) < seedOf(b) ? [a, b] : [b, a];
    makeFixture(state, comp, 2, home, away);
  } else {
    comp.placing.unshift(winners[0]);
  }
}

/**
 * Finish the current round: every unplayed fixture is resolved with
 * `resolver` (the player's included, so a season can be auto-played), then
 * the competition moves to the next round or finishes and pays prizes.
 */
export function resolveRound(state: LeagueState, resolver: MatchResolver = statisticalResolver): RoundResult {
  const comp = state.competition;
  if (!comp || comp.finished) throw new Error("no competition in progress");
  const rosterMoves = aiRosterPhase(state);
  const round = comp.round;
  const reports: MatchReport[] = [];
  const events: ResultEvents[] = [];
  for (const f of comp.fixtures.filter((x) => x.round === round)) {
    if (f.result === null) {
      const report = resolver(resolverTeam(state, f.home), resolverTeam(state, f.away), f.seed);
      events.push(recordResult(state, f.id, report));
    }
    reports.push(f.result as MatchReport);
  }
  if (comp.kind === "tournament") advanceTournament(state, comp);
  let prizes: PrizeEvent[] = [];
  if (round + 1 >= comp.rounds) {
    prizes = finishCompetition(state, comp);
  } else {
    comp.round = round + 1;
  }
  return { round, reports, events, rosterMoves, finished: comp.finished, prizes };
}

/** Resolve every remaining round of the current competition. */
export function resolveCompetition(state: LeagueState, resolver: MatchResolver = statisticalResolver): RoundResult[] {
  const out: RoundResult[] = [];
  while (state.competition && !state.competition.finished) out.push(resolveRound(state, resolver));
  return out;
}
