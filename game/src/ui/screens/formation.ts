/**
 * formation.ts - Formation preset and marking assignments.
 *
 * The nine FFX formation names (teams.json) are offered; each maps to one of
 * the simulation's presets, drawn on a little pitch. Marking assignments
 * (which opposing role each outfield player follows when defending) are
 * kept per team in localStorage (tactics.ts). `formationEditor` is reused by
 * the half-time overlay during a live match.
 */

import { loadGameData } from "../../data";
import { teamPlayerIds, teamState } from "../../league";
import { FORMATIONS } from "../../sim/formations";
import type { Role } from "../../sim/types";
import type { App } from "../app";
import { button, h, select } from "../dom";
import {
  defaultMarks,
  formationNames,
  loadMarks,
  type Marks,
  markableRoles,
  resetMarks,
  roleOrder,
  saveMarks,
  simFormation,
} from "../tactics";
import type { ScreenView } from "./index";

export interface EditorOptions {
  compact?: boolean;
  onChange?: () => void;
}

export function formationEditor(app: App, teamId: number, opts: EditorOptions = {}): HTMLElement {
  const state = app.requireState();
  const data = loadGameData();
  const team = teamState(state, teamId);
  const names = formationNames();
  const container = h("div", {});

  function render(): void {
    const simId = simFormation(team.formation);
    const preset = FORMATIONS[simId];
    const marks = loadMarks(teamId, simId);
    const ids = teamPlayerIds(state, teamId);
    const nameOf = (role: Role) => {
      const idx = roleOrder().indexOf(role);
      const pid = ids[idx];
      return pid === undefined ? "-" : data.players[pid].name;
    };

    const pitch = h(
      "div",
      { class: "pitch" },
      h("div", { class: "goal own" }),
      h("div", { class: "goal opp" }),
      ...roleOrder().map((role) => {
        const s = preset.slots[role];
        const left = 50 + s.x * 46;
        const top = 50 - s.y * 42;
        return h(
          "div",
          { class: "dot", style: `left:${left}%;top:${top}%`, title: nameOf(role) },
          h("span", { text: role }),
          h("small", { text: nameOf(role) }),
        );
      }),
    );

    const presetSelect = select(
      names.map((n, i) => ({ value: i, label: `${n}  (${FORMATIONS[simFormation(i)].name})` })),
      team.formation,
      (v) => {
        const previous = team.formation;
        team.formation = v;
        app.toast(`Formation: ${names[v]}`, {
          undo: () => {
            team.formation = previous;
            render();
            opts.onChange?.();
          },
        });
        render();
        opts.onChange?.();
      },
      "formation-select",
    );

    const markRows = markableRoles().map((role) =>
      h(
        "span",
        { style: "display:contents" },
        h("span", {}, h("b", { text: role }), h("span", { class: "muted", text: ` ${nameOf(role)} marks` })),
        select(
          [
            { value: "none", label: "Press the carrier (no fixed mark)" },
            ...markableRoles().map((r) => ({ value: r, label: `${r}` })),
          ],
          marks[role] ?? "none",
          (v) => {
            marks[role] = v === "none" ? null : (v as Role);
            saveMarks(teamId, marks);
            opts.onChange?.();
          },
          `mark-${role}`,
        ),
      ),
    );

    container.replaceChildren(
      h(
        "div",
        { class: opts.compact ? "" : "cols" },
        h(
          "div",
          {},
          h(
            "section",
            { class: "panel" },
            h("h2", { class: "panel-title", text: "Formation" }),
            h("div", { class: "row" }, presetSelect),
            h("p", {
              class: "muted",
              text: `Attack shift ${preset.attackShift}, defence shift ${preset.defenseShift}. Starters fill LF, RF, MF, LD, RD, GK in roster order.`,
            }),
            pitch,
          ),
        ),
        h(
          "div",
          {},
          h(
            "section",
            { class: "panel" },
            h("h2", { class: "panel-title", text: "Marking" }),
            h("div", { class: "marks" }, ...markRows),
            h(
              "div",
              { class: "actions" },
              button(
                "Reset marks to preset",
                () => {
                  const previous: Marks = { ...marks };
                  resetMarks(teamId);
                  app.toast("Marks reset", {
                    undo: () => {
                      saveMarks(teamId, previous);
                      render();
                    },
                  });
                  render();
                  opts.onChange?.();
                },
                {
                  class: "small",
                  hint: Object.entries(defaultMarks(simId))
                    .map(([k, v]) => `${k}>${v ?? "-"}`)
                    .join(" "),
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
  render();
  return container;
}

export function formationScreen(app: App): ScreenView {
  const state = app.requireState();
  const el = h(
    "div",
    {},
    h("h1", { text: "Formation" }),
    h("p", {
      class: "lede",
      text: "Pick a preset and tell each outfield player whom to mark. Changes apply to the next match (and at half time).",
    }),
    formationEditor(app, state.playerTeam),
    h(
      "div",
      { class: "actions" },
      button("Done", () => app.back(), { primary: true }),
    ),
  );
  return { element: el };
}
