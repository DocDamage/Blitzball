/**
 * standings.ts - Competition table and stats leaders.
 */

import type { CareerStats } from "../../league";
import { standings, statsLeaders } from "../../league";
import type { App } from "../app";
import { button, h, section, select } from "../dom";
import type { ScreenView } from "./index";

let scope: "season" | "career" = "season";

const STATS: [keyof CareerStats, string][] = [
  ["goals", "Goals"],
  ["assists", "Assists"],
  ["passes", "Passes"],
  ["tackles", "Tackles"],
  ["shotsSaved", "Saves"],
];

export function standingsScreen(app: App): ScreenView {
  const state = app.requireState();
  const comp = state.competition ?? null;
  const table = standings(state, comp ?? state.competition);
  const source = comp
    ? `${comp.kind === "league" ? "League" : comp.kind === "tournament" ? "Tournament" : "Exhibition"}${comp.finished ? " (finished)" : `, round ${comp.round + 1}`}`
    : state.lastLeagueStandings
      ? "Last league"
      : "No competition yet";
  const rows = (comp ? table : (state.lastLeagueStandings ?? table)).map((s, i) =>
    h(
      "tr",
      { class: s.teamId === state.playerTeam ? "me" : "" },
      h("td", { text: String(i + 1) }),
      h("td", { text: state.teams[s.teamId].name }),
      h("td", { class: "num", text: String(s.played) }),
      h("td", { class: "num", text: String(s.won) }),
      h("td", { class: "num", text: String(s.drawn) }),
      h("td", { class: "num", text: String(s.lost) }),
      h("td", { class: "num", text: `${s.goalsFor}-${s.goalsAgainst}` }),
      h("td", { class: "num", text: String(s.points) }),
    ),
  );

  const leaders = STATS.map(([stat, label]) => {
    const list = statsLeaders(state, stat, 5, scope);
    return h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-title", text: label }),
      list.length === 0
        ? h("p", { class: "muted", text: "Nobody yet" })
        : h(
            "table",
            { class: "table" },
            h(
              "tbody",
              {},
              ...list.map((l) =>
                h(
                  "tr",
                  { class: l.teamId === state.playerTeam ? "me" : "" },
                  h("td", { text: l.name }),
                  h("td", { class: "muted", text: l.teamId === null ? "Free agent" : state.teams[l.teamId].name }),
                  h("td", { class: "num", text: String(l.value) }),
                ),
              ),
            ),
          ),
    );
  });

  const el = h(
    "div",
    {},
    h("h1", { text: "Standings" }),
    h("p", { class: "lede", text: source }),
    section(
      "Table",
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: "#" }),
            h("th", { text: "Team" }),
            h("th", { class: "num", text: "P" }),
            h("th", { class: "num", text: "W" }),
            h("th", { class: "num", text: "D" }),
            h("th", { class: "num", text: "L" }),
            h("th", { class: "num", text: "GF-GA" }),
            h("th", { class: "num", text: "Pts" }),
          ),
        ),
        h("tbody", {}, ...rows),
      ),
    ),
    h(
      "div",
      { class: "row", style: "margin-bottom:0.6em" },
      h("span", { text: "Stats leaders:" }),
      select(
        [
          { value: "season", label: "This season" },
          { value: "career", label: "Career" },
        ] as const,
        scope,
        (v) => {
          scope = v;
          app.refresh();
        },
        "scope",
      ),
    ),
    h("div", { class: "cols" }, ...leaders),
    h(
      "div",
      { class: "actions" },
      button("Back", () => app.back(), { primary: true }),
    ),
  );
  return { element: el };
}
