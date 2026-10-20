/**
 * team.ts - Team management: six starters (LF RF MF LD RD GK), two reserves.
 *
 * Slots swap by drag and drop or by selecting one slot then another
 * (keyboard / gamepad friendly). Selecting a filled slot also opens the
 * player's card below for technique equipping, contract extension, release.
 */

import { loadGameData } from "../../data";
import { expiringPlayers, playerState, swapSlots, teamState } from "../../league";
import type { App } from "../app";
import { button, fmtGil, h } from "../dom";
import { playerCard } from "../playerCard";
import type { ScreenView } from "./index";

const ROLES = ["LF", "RF", "MF", "LD", "RD", "GK", "Reserve", "Reserve"];

let selectedSlot: number | null = null;
let openPlayer: number | null = null;

export function teamScreen(app: App): ScreenView {
  const state = app.requireState();
  const data = loadGameData();
  const team = teamState(state, state.playerTeam);
  const expiring = new Set(expiringPlayers(state, 1));

  if (openPlayer !== null && !team.players.includes(openPlayer)) openPlayer = null;

  const doSwap = (a: number, b: number) => {
    if (a === b) return;
    selectedSlot = null;
    app.undoable(`Swapped ${ROLES[a]} and ${ROLES[b]}`, () => swapSlots(state, state.playerTeam, a, b));
  };

  const slots = team.players.map((pid, i) => {
    const filled = pid !== null;
    const p = filled ? playerState(state, pid) : null;
    const el = h(
      "div",
      {
        class: `slot${filled ? " filled" : ""}${selectedSlot === i ? " selected" : ""}`,
        tabIndex: 0,
        draggable: filled,
        dataset: { focusId: `slot-${i}`, slot: i },
        onClick: () => {
          if (selectedSlot === null) {
            selectedSlot = i;
            openPlayer = pid;
          } else if (selectedSlot === i) {
            selectedSlot = null;
          } else {
            doSwap(selectedSlot, i);
            return;
          }
          app.refresh();
        },
        onDragStart: (e) => {
          e.dataTransfer?.setData("text/plain", String(i));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e) => {
          e.preventDefault();
          el.classList.add("dragover");
        },
        onDrop: (e) => {
          e.preventDefault();
          el.classList.remove("dragover");
          const from = Number(e.dataTransfer?.getData("text/plain"));
          if (Number.isInteger(from)) doSwap(from, i);
        },
      },
      h("span", { class: "role", text: ROLES[i] }),
      filled && p
        ? [
            h("div", { class: "name", text: data.players[pid].name }),
            h("div", { class: "sub", text: `Lv ${p.level} · ${fmtGil(p.costPerGame)}/game` }),
            h("div", {
              class: `sub${expiring.has(pid) ? " expiring" : ""}`,
              text: p.contractGames >= 255 ? "Permanent" : `${p.contractGames} games left`,
            }),
          ]
        : h("div", { class: "sub", text: "Empty - sign a free agent in Scout" }),
    );
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    return el;
  });

  const hint =
    selectedSlot === null
      ? "Select a slot, then another to swap. Drag and drop works too."
      : `Swapping ${ROLES[selectedSlot]}: choose the other slot (or select it again to cancel).`;

  const starters = team.players.slice(0, 6).filter((p) => p !== null).length;

  const el = h(
    "div",
    {},
    h("h1", { text: team.name }),
    h("p", {
      class: "lede",
      text: `${starters}/6 starters · ${fmtGil(state.gil)} · ${expiring.size > 0 ? `${expiring.size} contract(s) end after the next match` : "no contracts ending"}`,
    }),
    h("section", { class: "panel" }, h("p", { class: "muted", text: hint }), h("div", { class: "roster" }, ...slots)),
    openPlayer !== null ? playerCard(app, openPlayer, { editable: true, focusPrefix: "open" }) : null,
    h(
      "div",
      { class: "actions" },
      button("Formation", () => app.go("formation"), { focusId: "formation" }),
      button("Scout free agents", () => app.go("scout"), { focusId: "scout" }),
      button("Competitions", () => app.go("hub"), { focusId: "hub" }),
    ),
  );
  if (selectedSlot !== null)
    el.querySelector<HTMLElement>(`[data-focus-id="slot-${selectedSlot}"]`)?.setAttribute("data-autofocus", "");
  return { element: el };
}
