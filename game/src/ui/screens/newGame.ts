/**
 * newGame.ts - Seed and team choice, then straight into the hub.
 */

import { loadGameData } from "../../data";
import { newGame } from "../../league";
import type { App } from "../app";
import { button, h, select } from "../dom";
import type { ScreenView } from "./index";

function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function newGameScreen(app: App): ScreenView {
  const data = loadGameData();
  let seed = randomSeed();
  let team = 5;

  const seedInput = h("input", {
    class: "input",
    type: "text",
    value: String(seed),
    dataset: { focusId: "seed" },
    onInput: () => {
      const v = Number.parseInt(seedInput.value, 10);
      if (Number.isFinite(v)) seed = v >>> 0;
    },
  });
  const teamSelect = select(
    data.teams.teams.map((t) => ({ value: t.id, label: t.name })),
    team,
    (v) => {
      team = v;
    },
    "team",
  );

  const el = h(
    "div",
    {},
    h("h1", { text: "New game" }),
    h("p", { class: "lede", text: "Pick your team and a seed. The seed decides every fixture draw and AI decision." }),
    h(
      "section",
      { class: "panel" },
      h(
        "div",
        { class: "row" },
        h("label", { text: "Seed", for: "seed-input" }),
        seedInput,
        button(
          "Random",
          () => {
            seed = randomSeed();
            seedInput.value = String(seed);
          },
          { class: "small" },
        ),
      ),
      h("div", { class: "row", style: "margin-top:0.8em" }, h("label", { text: "Your team" }), teamSelect),
      h("p", {
        class: "muted",
        text: "Besaid Aurochs is the classic start: Tidus on a permanent contract, everyone else cheap.",
      }),
    ),
    h(
      "div",
      { class: "actions" },
      button(
        "Start career",
        () => {
          app.setState(newGame({ seed, playerTeam: team }));
          app.lastResult = null;
          app.lastPrizes = [];
          app.toast(`New game: ${data.teams.teams[team].name}, seed ${seed}`);
          app.go("hub");
        },
        { primary: true, focusId: "start" },
      ),
      button("Cancel", () => app.back()),
    ),
  );
  seedInput.id = "seed-input";
  el.querySelector<HTMLElement>("[data-focus-id='start']")?.setAttribute("data-autofocus", "");
  return { element: el };
}
