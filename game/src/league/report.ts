/**
 * report.ts - MatchReport: what a finished match tells the league layer.
 *
 * The simulation (sim/) produces one of these at full time; the league layer
 * consumes it for standings, experience, technique learning and contracts.
 * The type lives here so sim/ can import it without league/ depending on sim/.
 * Player and team ids are the numeric ids from data/json.
 */

export interface PlayerMatchLine {
  playerId: number;
  goals: number;
  assists: number;
  passes: number;
  tackles: number;
  shotsSaved: number;
  /** Technique ids used during the match (one entry per use). */
  techniquesUsed: number[];
  /** Technique ids this player witnessed with a successful techcopy roll. */
  techcopyWitnessed: number[];
  /** EXP awarded by the simulation using the original per-action table (section 6 of formulas.md). */
  expGained?: number;
}

export interface MatchReport {
  homeTeam: number;
  awayTeam: number;
  /** [home, away] goals. */
  score: [number, number];
  perPlayer: PlayerMatchLine[];
}

export function emptyLine(playerId: number): PlayerMatchLine {
  return {
    playerId,
    goals: 0,
    assists: 0,
    passes: 0,
    tackles: 0,
    shotsSaved: 0,
    techniquesUsed: [],
    techcopyWitnessed: [],
  };
}

export function winnerOf(report: MatchReport): number | null {
  if (report.score[0] > report.score[1]) return report.homeTeam;
  if (report.score[1] > report.score[0]) return report.awayTeam;
  return null;
}
