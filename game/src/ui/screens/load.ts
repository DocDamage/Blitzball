/**
 * load.ts - Save / load slots 1-3 plus the autosave. Saving over a slot is
 * undoable (the previous envelope is restored by Undo), so no confirmation.
 */

import {
  deleteSave,
  listSaves,
  loadGame,
  SAVE_SLOTS,
  type SaveSlot,
  type SaveSummary,
  saveGame,
  slotKey,
} from "../../league";
import type { App } from "../app";
import { button, fmtDate, h } from "../dom";
import type { ScreenView } from "./index";

export function loadScreen(app: App): ScreenView {
  const list = h("div", { class: "row vertical" }, h("p", { class: "muted", text: "Reading saves..." }));
  const el = h(
    "div",
    {},
    h("h1", { text: "Save / Load" }),
    h("p", { class: "lede", text: "Three manual slots and an autosave written after every match." }),
    list,
  );

  let cancelled = false;
  const teamName = (id: number) => app.state?.teams[id]?.name ?? `Team ${id + 1}`;

  async function refresh(): Promise<void> {
    let saves: SaveSummary[] = [];
    try {
      saves = await listSaves(app.adapter);
    } catch {
      list.replaceChildren(h("p", { class: "bad", text: "Saves are unavailable in this browser." }));
      return;
    }
    if (cancelled) return;
    list.replaceChildren();
    const slots: SaveSlot[] = [...SAVE_SLOTS, "auto"];
    for (const slot of slots) {
      const s = saves.find((x) => x.slot === slot);
      const label = slot === "auto" ? "Autosave" : `Slot ${slot + 1}`;
      const desc = s ? `${teamName(s.playerTeam)} · season ${s.season}, day ${s.day} · ${fmtDate(s.savedAt)}` : "Empty";
      const row = h(
        "div",
        { class: "panel row between" },
        h("div", {}, h("b", { text: label }), h("div", { class: "muted", text: desc })),
        h(
          "div",
          { class: "row" },
          button(
            "Load",
            async () => {
              const state = await loadGame(app.adapter, slot).catch(() => null);
              if (!state) {
                app.toast("That save could not be read");
                return;
              }
              app.setState(state);
              app.toast(`Loaded ${label}`);
              app.go("hub");
            },
            { disabled: !s, focusId: `load-${slot}`, primary: !!s },
          ),
          slot !== "auto"
            ? button(
                "Save here",
                async () => {
                  const state = app.state;
                  if (!state) return;
                  const previous = await app.adapter.get(slotKey(slot));
                  await saveGame(app.adapter, slot, state, label);
                  app.toast(`Saved to ${label}`, {
                    undo: async () => {
                      if (previous === null) await deleteSave(app.adapter, slot);
                      else await app.adapter.set(slotKey(slot), previous);
                      refresh();
                    },
                  });
                  refresh();
                },
                { disabled: !app.state, focusId: `save-${slot}` },
              )
            : null,
          s
            ? button(
                "Delete",
                async () => {
                  const previous = await app.adapter.get(slotKey(slot));
                  await deleteSave(app.adapter, slot);
                  app.toast(`Deleted ${label}`, {
                    undo: async () => {
                      if (previous !== null) await app.adapter.set(slotKey(slot), previous);
                      refresh();
                    },
                  });
                  refresh();
                },
                { class: "btn-danger", focusId: `del-${slot}` },
              )
            : null,
        ),
      );
      list.append(row);
    }
    if (!app.state) list.append(h("p", { class: "muted", text: "Start or load a game to enable saving." }));
    const focusId = (document.activeElement as HTMLElement | null)?.dataset.focusId;
    const target =
      (focusId ? list.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`) : null) ??
      list.querySelector<HTMLElement>("button:not([disabled])");
    target?.focus();
  }
  refresh();

  return {
    element: el,
    dispose: () => {
      cancelled = true;
    },
  };
}
