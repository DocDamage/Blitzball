/**
 * matchFlow.ts - From league fixture to played match and back.
 *
 * Builds sim TeamDefs from LeagueState (current rosters, levels, equipped
 * techniques, formation), launches the runtime's playMatch into the shell's
 * full-screen container or resolves instantly, records the result through
 * the league layer, finishes the round (AI fixtures use the same simulation
 * through `makeResolver`), autosaves and shows the results screen.
 */

import { learnedTechniques, loadGameData } from "../data";
import type { Fixture, LeagueState, MatchReport, MatchResolver } from "../league";
import {
  aiRosterPhase,
  equipCapacity,
  playerFixture,
  playerState,
  recordResult,
  resolveRound,
  resolverTeam,
  STARTERS,
  startExhibition,
  statisticalResolver,
  teamPlayerIds,
} from "../league";
import { Match } from "../sim/match";
import { matchReport } from "../sim/report";
import { type RosterPlayerSpec, teamDefFromPlayers } from "../sim/teamFromData";
import type { MatchEvent, TeamDef } from "../sim/types";
import type { App } from "./app";
import { button, empty, h } from "./dom";
import { loadRuntime, type MatchHandle, type MatchOptions, type MatchOutcome, type MatchRuntime } from "./runtime";
import { formationEditor } from "./screens/formation";
import { type KeyBindings, type Settings, toRuntimeBindings } from "./settings";
import { loadMarks, simFormation } from "./tactics";

/** Sim TeamDef for a team as it stands in the league right now. */
export function buildTeamDef(state: LeagueState, teamId: number): TeamDef {
  const data = loadGameData();
  const team = state.teams[teamId];
  const specs: RosterPlayerSpec[] = teamPlayerIds(state, teamId).map((pid) => {
    const p = playerState(state, pid);
    return {
      id: pid,
      level: p.level,
      techniques: p.equippedTechs.slice(0, equipCapacity(p)).filter((t) => t !== 0),
      learned: learnedTechniques(data.players[pid], p),
    };
  });
  const formation = simFormation(team.formation);
  const def: TeamDef = teamDefFromPlayers(data, teamId, specs, { formation });
  def.marks = loadMarks(teamId, formation);
  return def;
}

export function hasFullSquad(state: LeagueState, teamId: number): boolean {
  return teamPlayerIds(state, teamId).length >= STARTERS;
}

export function matchOptions(
  settings: Settings,
  bindings: KeyBindings | null,
  home: TeamDef,
  away: TeamDef,
  seed: number,
  humanTeam: 0 | 1 | null,
  instant = false,
): MatchOptions {
  return {
    home,
    away,
    seed,
    halfSeconds: settings.halfMinutes * 60,
    overtime: settings.overtime,
    difficulty: settings.difficulty,
    humanTeam,
    controlMode: settings.controlMode,
    camera: settings.camera,
    settings: {
      uiScale: settings.uiScale,
      screenShake: settings.screenShake,
      reducedFlash: settings.reducedFlash,
      colorblind: settings.colorblind,
      keyBindings: bindings ? toRuntimeBindings(bindings) : undefined,
      // [audio hook] settings sliders are 0..100; the audio layer takes 0..1.
      audio: {
        master: settings.masterVolume / 100,
        sfx: settings.sfxVolume / 100,
        music: settings.musicVolume / 100,
        muted: settings.audioMuted,
      },
    },
    instant,
  };
}

/** Keep only the league-facing part of an outcome (events are not saved). */
export function stripReport(r: MatchReport): MatchReport {
  return { homeTeam: r.homeTeam, awayTeam: r.awayTeam, score: [r.score[0], r.score[1]], perPlayer: r.perPlayer };
}

/**
 * League resolver backed by the match simulation. Uses the runtime's
 * simulateInstant when present, otherwise runs sim/ Match headless directly,
 * so AI-vs-AI fixtures always use the same rules as the player's matches.
 */
export function makeResolver(state: LeagueState, settings: Settings, runtime: MatchRuntime | null): MatchResolver {
  return (home, away, seed) => {
    // A team that cannot field six (free agent pool exhausted) falls back to the statistical model.
    if (!hasFullSquad(state, home.id) || !hasFullSquad(state, away.id)) return statisticalResolver(home, away, seed);
    const h = buildTeamDef(state, home.id);
    const a = buildTeamDef(state, away.id);
    if (runtime) {
      return stripReport(runtime.simulateInstant(matchOptions(settings, null, h, a, seed, null, true)));
    }
    const m = new Match(h, a, {
      seed,
      halfSeconds: settings.halfMinutes * 60,
      overtime: settings.overtime,
      difficulty: settings.difficulty,
    });
    m.run();
    return matchReport(m);
  };
}

/** Resolver that ignores the runtime (used by tests and as a fallback). */
export function simResolver(state: LeagueState, settings: Settings): MatchResolver {
  return makeResolver(state, settings, null);
}

// ------------------------------------------------------------ flow

export interface LiveMatch {
  handle: MatchHandle;
  fixture: Fixture;
  paused: boolean;
  abandoned: boolean;
}

function teamNames(state: LeagueState, f: Fixture): [string, string] {
  return [state.teams[f.home].name, state.teams[f.away].name];
}

/** Record the player's result, finish the round with the sim resolver, autosave, show results. */
export async function finishPlayerMatch(
  app: App,
  fixture: Fixture,
  outcome: MatchReport & { events?: MatchEvent[] },
  runtime: MatchRuntime | null,
): Promise<void> {
  const state = app.requireState();
  const report = stripReport(outcome);
  const events = recordResult(state, fixture.id, report);
  const round = resolveRound(state, makeResolver(state, app.settings, runtime));
  if (round.finished) app.lastPrizes = round.prizes;
  app.lastResult = {
    kind: state.competition?.kind ?? "exhibition",
    report,
    events: outcome.events ?? [],
    growth: events.growth,
    contracts: events.contracts,
    round,
    teamNames: teamNames(state, fixture),
  };
  await app.autosave();
  app.replace("results");
}

/** Resolve the current round when the player has no fixture in it (bye / eliminated). */
export async function advanceRound(app: App): Promise<void> {
  const state = app.requireState();
  if (!state.competition || state.competition.finished) return;
  const runtime = await loadRuntime();
  const round = resolveRound(state, makeResolver(state, app.settings, runtime));
  if (round.finished) app.lastPrizes = round.prizes;
  app.lastResult = {
    kind: state.competition.kind,
    report: null,
    events: [],
    growth: [],
    contracts: [],
    round,
    teamNames: ["", ""],
  };
  await app.autosave();
  app.replace("results");
}

/** Instantly simulate the player's fixture (same simulation as live play). */
export async function simulatePlayerFixture(app: App): Promise<void> {
  const state = app.requireState();
  const fixture = playerFixture(state);
  if (!fixture) {
    app.toast("No fixture to play");
    return;
  }
  aiRosterPhase(state);
  if (!hasFullSquad(state, state.playerTeam)) {
    app.toast("You need six players to field a team");
    app.go("team");
    return;
  }
  const runtime = await loadRuntime();
  const resolver = makeResolver(state, app.settings, runtime);
  const report = resolver(resolverTeam(state, fixture.home), resolverTeam(state, fixture.away), fixture.seed);
  await finishPlayerMatch(app, fixture, report, runtime);
}

/** Play the player's fixture live in the 3D runtime. */
export async function playPlayerFixture(app: App): Promise<void> {
  const state = app.requireState();
  const fixture = playerFixture(state);
  if (!fixture) {
    app.toast("No fixture to play");
    return;
  }
  aiRosterPhase(state);
  if (!hasFullSquad(state, state.playerTeam)) {
    app.toast("You need six players to field a team");
    app.go("team");
    return;
  }
  const runtime = await loadRuntime();
  if (!runtime) {
    app.toast("Match runtime not available - use Simulate instead", { ms: 4000 });
    return;
  }
  const home = buildTeamDef(state, fixture.home);
  const away = buildTeamDef(state, fixture.away);
  const human: 0 | 1 = fixture.home === state.playerTeam ? 0 : 1;
  const options = matchOptions(app.settings, app.bindings, home, away, fixture.seed, human);

  app.go("match");
  empty(app.matchHost);
  let handle: MatchHandle;
  try {
    handle = runtime.playMatch(app.matchHost, options);
  } catch (err) {
    console.error("playMatch failed", err);
    app.toast("Match runtime failed to start");
    app.go("hub");
    return;
  }
  const live: LiveMatch = { handle, fixture, paused: false, abandoned: false };
  const bar = matchBar(app, live, home, away);
  app.matchHost.append(bar);

  // Half-time hook: a runtime that dispatches this on its container gets the formation overlay.
  const onHalfTime = () => openHalfTimeOverlay(app, live, human === 0 ? fixture.home : fixture.away);
  app.matchHost.addEventListener("blitzball:half-time", onHalfTime);

  let outcome: MatchOutcome | null = null;
  try {
    outcome = await handle.promise;
  } catch (err) {
    console.error("match failed", err);
    app.toast("The match ended with an error");
  } finally {
    app.matchHost.removeEventListener("blitzball:half-time", onHalfTime);
    try {
      handle.dispose();
    } catch {
      // already disposed
    }
    empty(app.matchHost);
  }
  if (live.abandoned) return;
  if (!outcome || outcome.abandoned) {
    if (outcome?.abandoned) app.toast("Match abandoned");
    app.go("hub");
    return;
  }
  await finishPlayerMatch(app, fixture, outcome, runtime);
}

/** Set up and play/simulate an exhibition against `opponent`. */
export async function startExhibitionMatch(app: App, opponent: number, mode: "play" | "simulate"): Promise<void> {
  const state = app.requireState();
  try {
    startExhibition(state, opponent, true);
  } catch (err) {
    app.toast(err instanceof Error ? err.message : String(err));
    return;
  }
  if (mode === "play") await playPlayerFixture(app);
  else await simulatePlayerFixture(app);
}

// ------------------------------------------------------------ in-match UI

function matchBar(app: App, live: LiveMatch, home: TeamDef, away: TeamDef): HTMLElement {
  const pauseBtn = button(
    "Pause",
    () => {
      live.paused = !live.paused;
      if (live.paused) live.handle.pause();
      else live.handle.resume();
      const label = pauseBtn.querySelector(".btn-label");
      if (label) label.textContent = live.paused ? "Resume" : "Pause";
    },
    { class: "small" },
  );
  const bar = h(
    "div",
    { class: "match-bar" },
    h("span", { class: "keycap", text: `${home.name} v ${away.name}` }),
    pauseBtn,
    button("Skip", () => live.handle.skip(), { class: "small", hint: "to full time" }),
    button(
      "Abandon",
      () => {
        live.abandoned = true;
        live.handle.dispose();
        empty(app.matchHost);
        app.toast("Match abandoned (no result recorded)");
        app.go("hub");
      },
      { class: "small btn-danger" },
    ),
  );
  return bar;
}

function openHalfTimeOverlay(app: App, live: LiveMatch, teamId: number): void {
  live.handle.pause();
  const overlay = h("div", { class: "overlay" });
  const close = () => {
    overlay.remove();
    live.handle.resume();
  };
  const editor = formationEditor(app, teamId, {
    compact: true,
    onChange: () => {
      const def = buildTeamDef(app.requireState(), teamId);
      app.matchHost.dispatchEvent(new CustomEvent("blitzball:formation", { detail: { teamId, team: def } }));
    },
  });
  overlay.append(
    h(
      "div",
      { class: "card" },
      h("h3", { text: "Half time" }),
      editor,
      h("div", { class: "actions" }, button("Continue", close, { primary: true })),
    ),
  );
  overlay.querySelector<HTMLElement>("button")?.focus();
  app.matchHost.append(overlay);
}
