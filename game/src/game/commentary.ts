/**
 * commentary.ts - Turn sim events into one-line ticker text for the HUD.
 * Pure: names come from a NameLookup built from the two TeamDefs.
 */

import { getTechnique } from "../sim/techniques";
import type { MatchEvent, TeamDef } from "../sim/types";

export interface NameLookup {
  player(id: string): string;
  team(team: 0 | 1): string;
  technique(id: number | undefined): string;
}

export function makeNameLookup(home: TeamDef, away: TeamDef): NameLookup {
  const names = new Map<string, string>();
  for (const p of home.players) names.set(p.id, p.name);
  for (const p of away.players) names.set(p.id, p.name);
  return {
    player: (id) => names.get(id) ?? id,
    team: (t) => (t === 0 ? home.name : away.name),
    technique: (id) => (id === undefined ? "" : (getTechnique(id)?.name ?? `technique ${id}`)),
  };
}

export type CommentaryTone = "neutral" | "good" | "bad" | "goal" | "whistle";

export interface CommentaryLine {
  text: string;
  tone: CommentaryTone;
  tick: number;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

/** Text for one event, or null when the event is not worth a line. `humanTeam` colours the tone. */
export function commentaryFor(e: MatchEvent, names: NameLookup, humanTeam: 0 | 1 | null = null): CommentaryLine | null {
  const n = names;
  const tone = (team: 0 | 1 | null, good: boolean): CommentaryTone => {
    if (humanTeam === null || team === null) return "neutral";
    return (team === humanTeam) === good ? "good" : "bad";
  };
  const line = (text: string, t: CommentaryTone = "neutral"): CommentaryLine => ({ text, tone: t, tick: e.tick });
  switch (e.kind) {
    case "kickoff":
      return line("Blitz off!", "whistle");
    case "pass":
      return line(
        e.techniqueId !== undefined
          ? `${n.player(e.from)} fires a ${n.technique(e.techniqueId)}!`
          : `${n.player(e.from)} throws a pass!`,
        tone(e.team, true),
      );
    case "pass-complete":
      return null;
    case "pass-intercepted":
      return line(`${n.player(e.by)} picks off the pass!`, tone(e.team, false));
    case "pass-fumbled":
      return line(`The pass to ${n.player(e.to)} runs out of steam.`, tone(e.team, false));
    case "shot":
      return line(
        e.techniqueId !== undefined
          ? `${n.technique(e.techniqueId)}! ${n.player(e.by)} shoots!`
          : `${n.player(e.by)} shoots!`,
        tone(e.team, true),
      );
    case "shot-blocked":
      return line(`${n.player(e.blocker)} blocks the shot!`, tone(e.team, false));
    case "save":
      return line(`${n.player(e.keeper)} catches it!`, tone(e.team, false));
    case "deflection":
      return line(`${n.player(e.keeper)} gets a hand on it!`, tone(e.team, false));
    case "goal":
      return line(`GOAL! ${n.player(e.by)} scores for ${n.team(e.team)}! ${e.score[0]} - ${e.score[1]}`, "goal");
    case "tackle":
      return line(
        e.techniqueId !== undefined
          ? `${n.player(e.by)} takes the ball with ${n.technique(e.techniqueId)}!`
          : `${n.player(e.by)} tackles ${n.player(e.on)} and takes the ball!`,
        tone(e.team, true),
      );
    case "tackle-miss":
      return line(`${n.player(e.by)} lunges... and misses.`, tone(e.team, false));
    case "tackle-evaded":
      return line(`${n.player(e.on)} slips the tackle!`, tone(e.team, false));
    case "breakthrough":
      return line(`${n.player(e.carrier)} breaks through ${n.player(e.tackler)}!`, tone(e.team, true));
    case "technique-used":
      return null;
    case "techcopy":
      return line(`${n.player(e.by)} learns ${n.technique(e.techniqueId)}!`, tone(e.team, true));
    case "techcopy-failed":
      return null;
    case "status-applied":
      return line(`${n.player(e.player)} is ${statusWord(e.status)}!`);
    case "status-resisted":
      return line(`${n.player(e.player)} shrugs off the ${e.status}!`);
    case "status-expired":
      return null;
    case "drain":
      return line(`${n.player(e.by)} drains ${e.amount} HP from ${n.player(e.on)}!`);
    case "wake-up":
      return line(`${n.player(e.player)} wakes up.`);
    case "good-morning":
      return line(`Good Morning! ${n.player(e.player)} is pumped!`);
    case "gamble":
      return line(`${n.player(e.player)} rolls the dice!`);
    case "half-time":
      return line(`Half time. ${e.score[0]} - ${e.score[1]}`, "whistle");
    case "overtime-start":
      return line(`Overtime! ${e.score[0]} - ${e.score[1]}`, "whistle");
    case "full-time":
      return line(`Full time! ${e.score[0]} - ${e.score[1]}`, "whistle");
    case "out-of-bounds-reset":
      return line(`Out of bounds. ${n.player(e.toPlayer)} restarts.`);
    case "pickup":
      return line(`${n.player(e.by)} grabs the loose ball.`, tone(e.team, true));
    default:
      return null;
  }
}

function statusWord(s: "poison" | "sleep" | "wither"): string {
  return s === "poison" ? "poisoned" : s === "sleep" ? "asleep" : "withered";
}

/** Convenience: lines for a batch of events, timestamped. */
export function commentaryForEvents(events: readonly MatchEvent[], names: NameLookup, humanTeam: 0 | 1 | null) {
  const out: (CommentaryLine & { stamp: string })[] = [];
  for (const e of events) {
    const l = commentaryFor(e, names, humanTeam);
    if (l) out.push({ ...l, stamp: clock(e.time) });
  }
  return out;
}
