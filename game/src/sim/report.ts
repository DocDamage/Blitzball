/**
 * report.ts - MatchReport adapter: what a finished match tells the league.
 *
 * Everything is derived from the event log so the HUD, post-match screen and
 * league layer agree. Requires teams built from data (TeamDef.dataId and
 * PlayerDef.dataId), e.g. through teamFromData.ts. An assist is the last
 * completed pass to the scorer with no change of possession in between.
 */

import { emptyLine, type MatchReport, type PlayerMatchLine } from "../league/report";
import type { Match } from "./match";
import type { MatchEvent, TeamDef } from "./types";

function dataIdOf(team: TeamDef, playerId: string): number {
  const p = team.players.find((q) => q.id === playerId);
  if (!p || p.dataId === undefined)
    throw new Error(`player ${playerId} has no data id (build teams with teamFromData)`);
  return p.dataId;
}

export function matchReport(match: Match): MatchReport {
  const [home, away] = match.teams;
  if (home.dataId === undefined || away.dataId === undefined) {
    throw new Error("teams need data ids (build them with teamFromData)");
  }
  const lines = new Map<string, PlayerMatchLine>();
  const line = (id: string): PlayerMatchLine => {
    let l = lines.get(id);
    if (!l) {
      const p = match.player(id);
      l = emptyLine(dataIdOf(match.teams[p.team], id));
      lines.set(id, l);
    }
    return l;
  };
  for (const p of match.state.players) line(p.id).expGained = p.exp;

  let lastPass: { from: string; to: string } | null = null;
  const possessionChange: readonly MatchEvent["kind"][] = [
    "kickoff",
    "tackle",
    "pickup",
    "pass-intercepted",
    "pass-fumbled",
    "shot-blocked",
    "save",
    "deflection",
    "out-of-bounds-reset",
    "goal",
    "half-time",
  ];
  for (const e of match.events) {
    switch (e.kind) {
      case "goal":
        line(e.by).goals++;
        if (lastPass && lastPass.to === e.by && lastPass.from !== e.by) line(lastPass.from).assists++;
        break;
      case "pass-complete":
        line(e.from).passes++;
        lastPass = { from: e.from, to: e.to };
        continue;
      case "tackle":
        line(e.by).tackles++;
        break;
      case "save":
        line(e.keeper).shotsSaved++;
        break;
      case "technique-used":
        line(e.by).techniquesUsed.push(e.techniqueId);
        continue;
      case "techcopy":
        line(e.by).techcopyWitnessed.push(e.techniqueId);
        continue;
      default:
        break;
    }
    if (possessionChange.includes(e.kind)) lastPass = null;
  }
  return {
    homeTeam: home.dataId,
    awayTeam: away.dataId,
    score: [match.state.score[0], match.state.score[1]],
    perPlayer: [...lines.values()],
  };
}
