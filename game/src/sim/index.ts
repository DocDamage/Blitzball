/**
 * index.ts - Public entry point of the headless match simulation.
 *
 * Re-exports the sim API and provides simulateMatch(), which runs a complete
 * AI-vs-AI match from a seed and returns the score, the event log and derived
 * statistics. Nothing in sim/ touches the DOM, Three.js or any browser API.
 */

import { Match, type MatchOptions } from "./match";
import { computeStats, type MatchStats } from "./stats";
import type { MatchEvent, MatchState, TeamDef } from "./types";

export * from "./ai";
export * from "./constants";
export * from "./formations";
export * from "./input";
export { Match, type MatchOptions } from "./match";
export { Rng } from "./rng";
export * from "./sampleTeams";
export * from "./stats";
export * from "./techniques";
export * from "./types";
export * from "./vec";

export interface SimulationResult {
  score: [number, number];
  events: MatchEvent[];
  stats: MatchStats;
  state: MatchState;
}

/** Run a whole match headless with AI on both sides. */
export function simulateMatch(
  home: TeamDef,
  away: TeamDef,
  seed: number,
  opts: Omit<MatchOptions, "seed"> = {},
): SimulationResult {
  const match = new Match(home, away, { ...opts, seed });
  match.run();
  return {
    score: [...match.state.score],
    events: match.events,
    stats: computeStats(match.events, match.state, match.teams),
    state: match.state,
  };
}
