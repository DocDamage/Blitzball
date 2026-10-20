/**
 * settings.ts (screen) - Every option applies immediately and persists.
 * Key rebinding: click an action, press the new key; Escape cancels.
 */

import type { App } from "../app";
import { button, h, section, select, toggle } from "../dom";
import { BINDING_ACTIONS, type BindingAction, defaultBindings, keyLabel } from "../settings";
import type { ScreenView } from "./index";

export function settingsScreen(app: App): ScreenView {
  const s = app.settings;
  const set = (patch: Parameters<App["updateSettings"]>[0]) => {
    app.updateSettings(patch);
    app.refresh();
  };

  const labelled = (label: string, control: HTMLElement) =>
    h("div", { class: "row between" }, h("span", { text: label }), control);

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    on: (v: number) => void,
    id: string,
  ) => {
    const input = h("input", { type: "range", min, max, step, value, dataset: { focusId: id } });
    const out = h("span", { class: "muted", text: String(value) });
    input.addEventListener("input", () => {
      out.textContent = input.value;
    });
    input.addEventListener("change", () => on(Number(input.value)));
    return labelled(label, h("span", { class: "row" }, input, out));
  };

  const gameplay = section(
    "Gameplay",
    labelled(
      "Control mode",
      select(
        [
          { value: "arcade", label: "Arcade - direct control" },
          { value: "tactical", label: "Tactical - pick plays, pause on possession" },
          { value: "action", label: "Action - real-time with technique menus" },
        ] as const,
        s.controlMode,
        (v) => set({ controlMode: v }),
        "controlMode",
      ),
    ),
    labelled(
      "Difficulty",
      select(
        [
          { value: "easy", label: "Easy" },
          { value: "normal", label: "Normal" },
          { value: "hard", label: "Hard" },
        ] as const,
        s.difficulty,
        (v) => set({ difficulty: v }),
        "difficulty",
      ),
    ),
    labelled(
      "Half length",
      select(
        [
          { value: 1, label: "1 minute" },
          { value: 3, label: "3 minutes" },
          { value: 5, label: "5 minutes (original)" },
        ] as const,
        s.halfMinutes,
        (v) => set({ halfMinutes: v }),
        "half",
      ),
    ),
    toggle("Overtime when level at full time", s.overtime, (v) => set({ overtime: v }), "overtime"),
    labelled(
      "Camera",
      select(
        [
          { value: "broadcast", label: "Broadcast" },
          { value: "tactical", label: "Tactical (top-down)" },
        ] as const,
        s.camera,
        (v) => set({ camera: v }),
        "camera",
      ),
    ),
  );

  const display = section(
    "Display and accessibility",
    slider("UI scale", s.uiScale, 0.8, 1.4, 0.05, (v) => set({ uiScale: v }), "uiScale"),
    toggle("Colourblind palette", s.colorblind, (v) => set({ colorblind: v }), "colorblind"),
    toggle("Screen shake", s.screenShake, (v) => set({ screenShake: v }), "shake"),
    toggle("Reduced flashing", s.reducedFlash, (v) => set({ reducedFlash: v }), "flash"),
  );

  const audio = section(
    "Audio (placeholders - no audio engine yet)",
    slider("Master volume", s.masterVolume, 0, 100, 1, (v) => set({ masterVolume: v }), "master"),
    slider("Music", s.musicVolume, 0, 100, 1, (v) => set({ musicVolume: v }), "music"),
    slider("Effects", s.sfxVolume, 0, 100, 1, (v) => set({ sfxVolume: v }), "sfx"),
  );

  // ---- key bindings
  let listening: BindingAction | null = null;
  const bindingRows = h("div", {});
  function renderBindings(): void {
    bindingRows.replaceChildren(
      ...BINDING_ACTIONS.map(([action, label]) => {
        const key = app.bindings[action];
        const conflict = BINDING_ACTIONS.some(([other]) => other !== action && app.bindings[other] === key);
        const btn = button(
          listening === action ? "Press a key..." : keyLabel(key),
          () => {
            listening = listening === action ? null : action;
            renderBindings();
          },
          { class: `small inline${listening === action ? " listening" : ""}`, focusId: `bind-${action}` },
        );
        return h(
          "div",
          { class: "binding-row" },
          h(
            "span",
            {},
            h("span", { text: label }),
            conflict ? h("span", { class: " warn", text: "  (also used elsewhere)" }) : null,
          ),
          btn,
        );
      }),
    );
    if (listening) bindingRows.querySelector<HTMLElement>(`[data-focus-id="bind-${listening}"]`)?.focus();
  }
  renderBindings();

  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== "Escape") app.updateBindings({ ...app.bindings, [listening]: e.code });
    listening = null;
    renderBindings();
  };
  window.addEventListener("keydown", onKey, true);

  const bindings = section(
    "Key bindings",
    h("p", { class: "muted", text: "Stored as { action: key } in localStorage (blitzball.bindings)." }),
    bindingRows,
    h(
      "div",
      { class: "actions" },
      button(
        "Reset to defaults",
        () => {
          const previous = app.bindings;
          app.updateBindings(defaultBindings());
          renderBindings();
          app.toast("Bindings reset", {
            undo: () => {
              app.updateBindings(previous);
              renderBindings();
            },
          });
        },
        { class: "small" },
      ),
    ),
  );

  const el = h(
    "div",
    {},
    h("h1", { text: "Settings" }),
    h("p", { class: "lede", text: "Changes apply immediately and are kept between sessions." }),
    h("div", { class: "cols" }, h("div", {}, gameplay, display), h("div", {}, audio, bindings)),
    h(
      "div",
      { class: "actions" },
      button("Done", () => app.back(), { primary: true }),
    ),
  );
  return { element: el, dispose: () => window.removeEventListener("keydown", onKey, true) };
}
