/**
 * stats.ts - Derive match statistics from the event log.
 *
 * Keeping stats as a pure function of the events (plus possession ticks from
 * the state) means the HUD, post-match screen and league layer all agree and
 * nothing extra has to be tracked inside the sim loop.
 */

import type { MatchEvent, MatchState, TeamDef } from "./types";

export interface TeamStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  passes: number;
  passesCompleted: number;
  interceptions: number;
  tackles: number;
  tacklesWon: number;
  breakthroughs: number;
  techniques: number;
  techcopies: number;
  /** Fraction 0..1 of carried-ball ticks. */
  possession: number;
}

export interface PlayerStats {
  id: string;
  goals: number;
  shots: number;
  passes: number;
  interceptions: number;
  tackles: number;
  saves: number;
  techniques: number;
}

export interface MatchStats {
  teams: [TeamStats, TeamStats];
  players: Record<string, PlayerStats>;
}

function emptyTeam(): TeamStats {
  return {
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    saves: 0,
    passes: 0,
    passesCompleted: 0,
    interceptions: 0,
    tackles: 0,
    tacklesWon: 0,
    breakthroughs: 0,
    techniques: 0,
    techcopies: 0,
    possession: 0,
  };
}

export function computeStats(events: readonly MatchEvent[], state: MatchState, teams: [TeamDef, TeamDef]): MatchStats {
  const t: [TeamStats, TeamStats] = [emptyTeam(), emptyTeam()];
  const players: Record<string, PlayerStats> = {};
  const pl = (id: string): PlayerStats => {
    players[id] ??= { id, goals: 0, shots: 0, passes: 0, interceptions: 0, tackles: 0, saves: 0, techniques: 0 };
    return players[id];
  };
  for (const team of teams) for (const p of team.players.slice(0, 6)) pl(p.id);
  const teamOf = (id: string): 0 | 1 => (teams[0].players.some((p) => p.id === id) ? 0 : 1);

  for (const e of events) {
    switch (e.kind) {
      case "goal":
        t[e.team].goals++;
        t[e.team].shotsOnTarget++;
        pl(e.by).goals++;
        break;
      case "shot":
        t[e.team].shots++;
        pl(e.by).shots++;
        break;
      case "save":
        t[e.team].saves++;
        t[1 - e.team].shotsOnTarget++;
        pl(e.keeper).saves++;
        break;
      case "pass":
        t[e.team].passes++;
        pl(e.from).passes++;
        break;
      case "pass-complete":
        t[e.team].passesCompleted++;
        break;
      case "pass-intercepted":
        t[e.team].interceptions++;
        pl(e.by).interceptions++;
        break;
      case "tackle":
        t[e.team].tackles++;
        t[e.team].tacklesWon++;
        pl(e.by).tackles++;
        break;
      case "breakthrough":
        t[teamOf(e.tackler)].tackles++;
        t[e.team].breakthroughs++;
        pl(e.tackler).tackles++;
        break;
      case "technique-used":
        t[e.team].techniques++;
        pl(e.by).techniques++;
        break;
      case "techcopy":
        t[e.team].techcopies++;
        break;
      default:
        break;
    }
  }
  const total = state.possessionTicks[0] + state.possessionTicks[1];
  t[0].possession = total ? state.possessionTicks[0] / total : 0.5;
  t[1].possession = total ? state.possessionTicks[1] / total : 0.5;
  return { teams: t, players };
}
