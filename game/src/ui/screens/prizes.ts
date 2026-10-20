/**
 * prizes.ts - Rewards from the competition that just ended, plus the
 * prize inventory (Tech Find, reels) and gil.
 */

import { loadGameData } from "../../data";
import type { App } from "../app";
import { button, fmtGil, h, section } from "../dom";
import type { ScreenView } from "./index";

const PLACE = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

export function prizesScreen(app: App): ScreenView {
  const state = app.requireState();
  const names = loadGameData().teams.prizes;
  const comp = state.competition;
  const awards = app.lastPrizes;

  const el = h(
    "div",
    {},
    h("h1", { text: "Prizes" }),
    h("p", {
      class: "lede",
      text: comp?.finished
        ? `${comp.kind === "league" ? "League" : comp.kind === "tournament" ? "Tournament" : "Exhibition"} champion: ${comp.champion === null ? "-" : state.teams[comp.champion].name}`
        : "No competition has finished yet.",
    }),
    awards.length > 0
      ? section(
          "Awards",
          h(
            "table",
            { class: "table" },
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                h("th", { text: "Place" }),
                h("th", { text: "Team" }),
                h("th", { class: "num", text: "Gil" }),
                h("th", { text: "Prize" }),
              ),
            ),
            h(
              "tbody",
              {},
              ...awards.map((a) =>
                h(
                  "tr",
                  { class: a.teamId === state.playerTeam ? "me" : "" },
                  h("td", { text: PLACE[a.place] ?? `${a.place + 1}th` }),
                  h("td", { text: state.teams[a.teamId].name }),
                  h("td", { class: "num", text: a.gil.toLocaleString("en-US") }),
                  h("td", { text: a.prizeName ?? "-" }),
                ),
              ),
            ),
          ),
        )
      : null,
    comp?.finished && comp.placing.length > 0
      ? section(
          "Final placing",
          h(
            "ol",
            {},
            ...comp.placing.map((t) =>
              h("li", { class: t === state.playerTeam ? "accent" : "", text: state.teams[t].name }),
            ),
          ),
        )
      : null,
    section(
      "Your inventory",
      h("p", {}, h("b", { text: fmtGil(state.gil) })),
      state.prizes.length === 0
        ? h("p", { class: "muted", text: "No prize items yet. Win a league or tournament." })
        : h(
            "ul",
            { class: "event-list" },
            ...state.prizes.map((p) =>
              h("li", { text: `${names[p.prizeIndex] ?? `Prize ${p.prizeIndex}`} x${p.count}` }),
            ),
          ),
    ),
    h(
      "div",
      { class: "actions" },
      button("Competitions", () => app.go("hub"), { primary: true, focusId: "hub" }),
      button("Standings", () => app.go("standings")),
    ),
  );
  el.querySelector<HTMLElement>("[data-focus-id='hub']")?.setAttribute("data-autofocus", "");
  return { element: el };
}
