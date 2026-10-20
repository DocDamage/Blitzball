/**
 * mainMenu.ts - Title screen: New game, Continue, Load, Settings, Stadium demo.
 */

import { listSaves, loadGame, type SaveSummary } from "../../league";
import type { App } from "../app";
import { button, fmtDate, h } from "../dom";
import type { ScreenView } from "./index";

export function mainMenuScreen(app: App): ScreenView {
  const menu = h("div", { class: "main-menu" });
  menu.append(
    h("div", { class: "logo", text: "Blitzball" }),
    h("div", { class: "tag", text: "Real-time underwater football" }),
  );

  const continueBtn = button("Continue", () => {}, {
    hint: "Looking for saves...",
    disabled: true,
    focusId: "continue",
  });
  menu.append(
    button("New game", () => app.go("new-game"), { hint: "Start a career", focusId: "new", primary: true }),
    continueBtn,
    button("Load game", () => app.go("load"), { hint: "Slots 1-3 and autosave", focusId: "load" }),
    button("Settings", () => app.go("settings"), { hint: "Controls, difficulty, display", focusId: "settings" }),
    button("Stadium demo", () => app.go("demo"), { hint: "Scripted scene, no simulation", focusId: "demo" }),
  );
  if (app.state) {
    menu.append(
      button("Back to competitions", () => app.go("hub"), {
        hint: `${app.state.teams[app.state.playerTeam].name} - season ${app.state.season}`,
        focusId: "resume",
      }),
    );
  }
  menu.querySelector<HTMLElement>("[data-focus-id='new']")?.setAttribute("data-autofocus", "");

  let cancelled = false;
  listSaves(app.adapter)
    .then((saves) => {
      if (cancelled) return;
      const latest = saves.slice().sort((a, b) => b.savedAt - a.savedAt)[0] as SaveSummary | undefined;
      const hint = continueBtn.querySelector(".btn-hint");
      if (!latest) {
        if (hint) hint.textContent = "No saves yet";
        return;
      }
      continueBtn.disabled = false;
      if (hint)
        hint.textContent = `${latest.slot === "auto" ? "Autosave" : `Slot ${latest.slot + 1}`} · ${fmtDate(latest.savedAt)}`;
      continueBtn.addEventListener("click", async () => {
        const state = await loadGame(app.adapter, latest.slot);
        if (!state) {
          app.toast("Save could not be read");
          return;
        }
        app.setState(state);
        app.go("hub");
      });
    })
    .catch(() => {
      const hint = continueBtn.querySelector(".btn-hint");
      if (hint) hint.textContent = "Saves unavailable";
    });

  return {
    element: menu,
    dispose: () => {
      cancelled = true;
    },
  };
}
