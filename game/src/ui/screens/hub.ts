/**
 * hub.ts - Competitions hub: start an exhibition / league / tournament,
 * see the calendar for the current round, play or simulate your fixture.
 */

import { loadGameData } from "../../data";
import {
  currentFixtures,
  expiringPlayers,
  type Fixture,
  playerFixture,
  startLeague,
  startTournament,
} from "../../league";
import type { App } from "../app";
import { button, h, section, select } from "../dom";
import { advanceRound, playPlayerFixture, simulatePlayerFixture, startExhibitionMatch } from "../matchFlow";
import type { ScreenView } from "./index";

let exhibitionOpponent: number | null = null;
let busy = false;

function guard(app: App, fn: () => Promise<void>): void {
  if (busy) return;
  busy = true;
  fn()
    .catch((err) => {
      console.error(err);
      app.toast(err instanceof Error ? err.message : String(err));
    })
    .finally(() => {
      busy = false;
    });
}

export function hubScreen(app: App): ScreenView {
  const state = app.requireState();
  const data = loadGameData();
  const comp = state.competition;
  const me = state.playerTeam;
  const teamName = (id: number) => state.teams[id].name;
  if (exhibitionOpponent === null || exhibitionOpponent === me)
    exhibitionOpponent = state.teams.find((t) => t.id !== me)?.id ?? 0;

  const expiring = expiringPlayers(state, 1);
  const warnings = expiring.length
    ? h("p", {
        class: "warn",
        text: `Contracts ending after the next match: ${expiring.map((id) => data.players[id].name).join(", ")}. Extend them in Team management.`,
      })
    : null;

  const fixtureRow = (f: Fixture) => {
    const mine = f.home === me || f.away === me;
    const score = f.result ? `${f.result.score[0]} - ${f.result.score[1]}` : "v";
    return h(
      "div",
      { class: `fixture${mine ? " mine" : ""}` },
      h("span", { class: `team home${f.home === me ? " me" : ""}`, text: teamName(f.home) }),
      h("span", { class: "score", text: score }),
      h("span", { class: `team${f.away === me ? " me" : ""}`, text: teamName(f.away) }),
    );
  };

  const el = h("div", {}, h("h1", { text: "Competitions" }), warnings);

  if (comp && !comp.finished) {
    const fx = playerFixture(state);
    const fixtures = currentFixtures(state);
    const label = comp.kind === "league" ? "League" : comp.kind === "tournament" ? "Tournament" : "Exhibition";
    const roundName =
      comp.kind === "tournament"
        ? ["Quarter-finals", "Semi-finals", "Final"][comp.round]
        : `Round ${comp.round + 1} of ${comp.rounds}`;
    const actions: HTMLElement[] = [];
    if (fx) {
      actions.push(
        button("Play match", () => guard(app, () => playPlayerFixture(app)), {
          primary: true,
          focusId: "play",
          hint: `${teamName(fx.home)} v ${teamName(fx.away)} - live 3D`,
        }),
        button("Simulate", () => guard(app, () => simulatePlayerFixture(app)), {
          focusId: "simulate",
          hint: "Instant result, same simulation",
        }),
      );
    } else {
      actions.push(
        button("Resolve round", () => guard(app, () => advanceRound(app)), {
          primary: true,
          focusId: "resolve",
          hint:
            comp.kind === "tournament" && !comp.alive.includes(me)
              ? "You are out; watch the rest"
              : "No fixture for you this round",
        }),
      );
    }
    el.append(
      section(
        `${label} - ${roundName}`,
        h("div", {}, ...fixtures.map(fixtureRow)),
        h("div", { class: "actions" }, ...actions),
      ),
    );
  } else {
    if (comp?.finished) {
      el.append(
        section(
          `Last ${comp.kind}: finished`,
          h(
            "p",
            {},
            h("span", { text: "Champion: " }),
            h("b", {
              class: comp.champion === me ? "good" : "",
              text: comp.champion === null ? "-" : teamName(comp.champion),
            }),
          ),
          h(
            "div",
            { class: "actions" },
            button("Prizes", () => app.go("prizes"), { class: "small" }),
            button("Standings", () => app.go("standings"), { class: "small" }),
          ),
        ),
      );
    }
    const opponentSelect = select(
      state.teams.filter((t) => t.id !== me).map((t) => ({ value: t.id, label: t.name })),
      exhibitionOpponent,
      (v) => {
        exhibitionOpponent = v;
      },
      "opponent",
    );
    el.append(
      h(
        "div",
        { class: "cols" },
        section(
          "Exhibition",
          h("p", {
            class: "muted",
            text: "A friendly at home. Winning pays a little gil; everyone still earns experience.",
          }),
          h("div", { class: "row" }, opponentSelect),
          h(
            "div",
            { class: "actions" },
            button("Play", () => guard(app, () => startExhibitionMatch(app, exhibitionOpponent ?? 0, "play")), {
              primary: true,
              focusId: "exh-play",
            }),
            button("Simulate", () => guard(app, () => startExhibitionMatch(app, exhibitionOpponent ?? 0, "simulate")), {
              focusId: "exh-sim",
            }),
          ),
        ),
        section(
          "League",
          h("p", {
            class: "muted",
            text: "Ten rounds, every team twice. Top three take prizes; the table seeds the next tournament.",
          }),
          h(
            "div",
            { class: "actions" },
            button(
              `Start league${state.lastLeagueStandings ? ` (season ${state.season + 1})` : ""}`,
              () => {
                startLeague(state);
                app.toast("League started");
                app.refresh();
              },
              { primary: true, focusId: "league" },
            ),
          ),
        ),
        section(
          "Tournament",
          h("p", { class: "muted", text: "Three knockout rounds. The top two seeds skip the first round." }),
          h(
            "div",
            { class: "actions" },
            button(
              "Start tournament",
              () => {
                startTournament(state);
                app.toast("Tournament started");
                app.refresh();
              },
              { primary: true, focusId: "tournament" },
            ),
          ),
        ),
      ),
    );
  }

  el.append(
    h(
      "div",
      { class: "actions" },
      button("Team management", () => app.go("team"), { focusId: "team" }),
      button("Formation", () => app.go("formation"), { focusId: "formation" }),
      button("Scout", () => app.go("scout"), { focusId: "scout" }),
      button("Standings & leaders", () => app.go("standings"), { focusId: "standings" }),
      button("Save / Load", () => app.go("load"), { focusId: "save" }),
      button("Settings", () => app.go("settings"), { focusId: "settings" }),
      button("Main menu", () => app.go("main"), { focusId: "main" }),
    ),
  );
  return { element: el };
}
