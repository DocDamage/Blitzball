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
    const input = h("input", { type: "range", min, max, step, dataset: { focusId: id } }) as HTMLInputElement;
    input.value = String(value); // set after min/max so the browser does not clamp it to the default range
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

  // [audio hook] Sliders drive app.audio live while dragging and persist on release.
  const live = (patch: Partial<{ master: number; sfx: number; music: number }>) => app.audio.setVolumes(patch);
  const volume = (
    label: string,
    key: "masterVolume" | "musicVolume" | "sfxVolume",
    bus: "master" | "music" | "sfx",
  ) => {
    const row = slider(label, s[key], 0, 100, 1, (v) => set({ [key]: v }), bus);
    row.querySelector("input")?.addEventListener("input", (e) => {
      live({ [bus]: Number((e.target as HTMLInputElement).value) / 100 });
      if (bus !== "music") app.audio.play("ui-click");
    });
    return row;
  };
  const musicFile = h("input", { type: "file", dataset: { focusId: "musicFile" } });
  musicFile.setAttribute("accept", "audio/*");
  musicFile.addEventListener("change", () => {
    const file = musicFile.files?.[0] ?? null;
    app.audio.setUserMusic(file);
    app.userMusicName = file?.name ?? null;
    app.refresh();
  });
  const audio = section(
    "Audio",
    toggle("Mute all", s.audioMuted, (v) => set({ audioMuted: v }), "muted"),
    volume("Master volume", "masterVolume", "master"),
    volume("Music", "musicVolume", "music"),
    volume("Effects", "sfxVolume", "sfx"),
    h("p", { class: "muted", text: "Sounds and the menu track are generated in the browser - no audio files." }),
    labelled("Your own music", musicFile),
    h(
      "div",
      { class: "row between" },
      h("span", { class: "muted", text: app.userMusicName ? `Playing: ${app.userMusicName}` : "Procedural track" }),
      app.userMusicName
        ? button(
            "Use procedural track",
            () => {
              app.audio.setUserMusic(null);
              app.userMusicName = null;
              app.refresh();
            },
            { class: "small", focusId: "clearMusic" },
          )
        : null,
    ),
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
