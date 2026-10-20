/**
 * app.ts - Application shell: router + screen host + persistence.
 *
 * One App instance owns the in-memory LeagueState, the user settings, the
 * save adapter and the DOM root. Screens are plain functions that build an
 * element from the App; every state change calls `refresh()` which rebuilds
 * the active screen (menus are small, so a full rebuild is well under the
 * 100 ms transition budget) while keeping keyboard focus on the element with
 * the same data-focus-id.
 */

// [audio hook]
import { type BlitzAudio, createAudio } from "../audio";
import type { ContractEvent, GrowthEvent, LeagueState, MatchReport, PrizeEvent, RoundResult } from "../league";
import { autosave, createDefaultAdapter, type SaveAdapter } from "../league";
import type { MatchEvent } from "../sim/types";
import { button, empty, fmtGil, h } from "./dom";
import { attach as attachFocus } from "./focus";
import {
  back,
  createRouter,
  current,
  go,
  type RouterState,
  replace,
  SCREEN_TITLES,
  type ScreenId,
  setHasGame,
} from "./router";
import type { Screen } from "./screens";
import { SCREENS } from "./screens";
import { type KeyBindings, loadBindings, loadSettings, type Settings, saveBindings, saveSettings } from "./settings";

export interface MatchResultData {
  kind: "exhibition" | "league" | "tournament";
  /** The player's match (null when the round was simulated without the player playing). */
  report: MatchReport | null;
  events: MatchEvent[];
  /** Growth + contract events of the player's own match. */
  growth: GrowthEvent[];
  contracts: ContractEvent[];
  /** The round the match belonged to, after resolveRound. */
  round: RoundResult | null;
  /** Human-readable names of both teams, [home, away]. */
  teamNames: [string, string];
}

export interface ToastOptions {
  undo?: () => void;
  ms?: number;
}

export class App {
  readonly root: HTMLElement;
  readonly shell: HTMLElement;
  readonly screenHost: HTMLElement;
  readonly topbar: HTMLElement;
  /** Full-screen container handed to the match runtime / demo scene. */
  readonly matchHost: HTMLElement;
  readonly toastHost: HTMLElement;
  readonly adapter: SaveAdapter;
  /** [audio hook] Shell audio: UI blips + menu music (the match runtime owns its own instance). */
  readonly audio: BlitzAudio;
  /** [audio hook] Name of the user-supplied music file, for the Settings screen (not persisted). */
  userMusicName: string | null = null;

  state: LeagueState | null = null;
  settings: Settings;
  bindings: KeyBindings;
  router: RouterState;
  lastResult: MatchResultData | null = null;
  lastPrizes: PrizeEvent[] = [];
  /** Set by the match / demo screens while they own the input. */
  inputLocked = false;
  private wasFullscreen = false;
  /** Called when the active screen is torn down (screens register cleanup). */
  private cleanup: (() => void) | null = null;
  private detachFocus: (() => void) | null = null;
  private pendingUndo: (() => void) | null = null;

  constructor(root: HTMLElement, adapter: SaveAdapter = createDefaultAdapter()) {
    this.root = root;
    this.adapter = adapter;
    this.settings = loadSettings();
    this.bindings = loadBindings();
    this.router = createRouter(false);
    this.topbar = h("div", { class: "topbar" });
    this.screenHost = h("div", { class: "screen", tabIndex: -1 });
    this.shell = h("div", { class: "shell" }, this.topbar, this.screenHost);
    this.matchHost = h("div", { class: "match-container hidden" });
    this.toastHost = h("div", { class: "toast-host" });
    empty(root);
    root.append(this.shell, this.matchHost, this.toastHost);
    this.audio = createAudio(this.audioSettings()); // [audio hook]
    this.applySettings();
  }

  start(): void {
    this.detachFocus = attachFocus({
      root: () => this.screenHost,
      back: () => {
        this.audio.play("ui-back"); // [audio hook]
        this.back();
      },
      inputLocked: () => this.inputLocked,
    });
    this.attachUiSounds(); // [audio hook]
    this.audio.startMusic(); // [audio hook] starts once the first gesture unlocks the context
    this.render();
  }

  destroy(): void {
    this.cleanup?.();
    this.detachFocus?.();
    this.detachUiSounds?.(); // [audio hook]
    this.audio.dispose(); // [audio hook]
  }

  // ------------------------------------------------------------ audio hook

  private detachUiSounds: (() => void) | null = null;

  /** Volumes as the audio layer wants them (0..1). */
  audioSettings(): { master: number; sfx: number; music: number; muted: boolean } {
    const s = this.settings;
    return { master: s.masterVolume / 100, sfx: s.sfxVolume / 100, music: s.musicVolume / 100, muted: s.audioMuted };
  }

  /** Focus move -> click, button activation -> confirm (the topbar Back button -> back). */
  private attachUiSounds(): void {
    let lastFocus: string | null = null;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el === this.screenHost) return;
      const id = el.dataset.focusId ?? null;
      if (id !== null && id === lastFocus) return; // same control re-focused after a refresh
      lastFocus = id;
      this.audio.play("ui-click");
    };
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest("button");
      if (!btn || btn.disabled) return;
      this.audio.play(btn.closest(".topbar") ? "ui-back" : "ui-confirm");
    };
    this.shell.addEventListener("focusin", onFocus);
    this.shell.addEventListener("click", onClick, true);
    this.detachUiSounds = () => {
      this.shell.removeEventListener("focusin", onFocus);
      this.shell.removeEventListener("click", onClick, true);
    };
  }

  // ------------------------------------------------------------ navigation

  get screen(): ScreenId {
    return current(this.router);
  }

  go(to: ScreenId): void {
    this.router = go(this.router, to);
    this.render();
  }

  replace(to: ScreenId): void {
    this.router = replace(this.router, to);
    this.render();
  }

  back(): void {
    if (this.screen === "match" || this.screen === "demo") return; // those screens handle their own exit
    if (this.router.stack.length <= 1) return;
    this.router = back(this.router);
    this.render();
  }

  /** Rebuild the current screen (after a state change). */
  refresh(): void {
    this.render();
  }

  setState(state: LeagueState | null): void {
    this.state = state;
    this.router = setHasGame(this.router, state !== null);
  }

  /** The league state, for screens that the router guarantees have one. */
  requireState(): LeagueState {
    if (!this.state) throw new Error("no game loaded");
    return this.state;
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.applySettings();
  }

  updateBindings(b: KeyBindings): void {
    this.bindings = b;
    saveBindings(b);
  }

  applySettings(): void {
    const s = this.settings;
    this.root.style.setProperty("--ui-scale", String(s.uiScale));
    document.documentElement.dataset.colorblind = String(s.colorblind);
    this.root.classList.toggle("reduced-flash", s.reducedFlash);
    this.audio.setVolumes(this.audioSettings()); // [audio hook]
  }

  // ------------------------------------------------------------ persistence

  async autosave(): Promise<void> {
    if (!this.state) return;
    try {
      await autosave(this.adapter, this.state);
    } catch (err) {
      console.warn("autosave failed", err);
      this.toast("Autosave failed");
    }
  }

  /**
   * Mutate state with an undoable action: snapshot, apply, toast with Undo.
   * This is how destructive actions avoid confirmation screens.
   */
  undoable(label: string, fn: () => void): void {
    const state = this.requireState();
    const snapshot = structuredClone(state);
    fn();
    this.toast(label, {
      undo: () => {
        this.setState(snapshot);
        this.refresh();
      },
    });
    this.refresh();
  }

  // ------------------------------------------------------------ feedback

  toast(message: string, opts: ToastOptions = {}): void {
    const el = h("div", { class: "toast" }, h("span", { text: message }));
    const remove = () => {
      el.remove();
      if (this.pendingUndo === opts.undo) this.pendingUndo = null;
    };
    if (opts.undo) {
      const undo = opts.undo;
      this.pendingUndo = undo;
      el.append(
        button(
          "Undo",
          () => {
            undo();
            remove();
          },
          { class: "small", primary: true },
        ),
      );
    }
    this.toastHost.append(el);
    while (this.toastHost.children.length > 3) this.toastHost.firstElementChild?.remove();
    setTimeout(remove, opts.ms ?? (opts.undo ? 6000 : 2500));
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    this.cleanup?.();
    this.cleanup = null;
    const id = this.screen;
    const screen: Screen | undefined = SCREENS[id];
    const focused = document.activeElement as HTMLElement | null;
    const focusId = focused?.dataset.focusId;

    const fullscreen = id === "match" || id === "demo";
    this.shell.classList.toggle("hidden", fullscreen);
    this.matchHost.classList.toggle("hidden", !fullscreen);
    this.inputLocked = fullscreen;
    if (fullscreen !== this.wasFullscreen) {
      // the match runtime plays its own music; menus get theirs back afterwards
      if (fullscreen) this.audio.stopMusic();
      else this.audio.startMusic("menu");
      this.wasFullscreen = fullscreen;
    }

    this.renderTopbar(id);
    empty(this.screenHost);
    if (!screen) {
      this.screenHost.append(h("p", { text: `Unknown screen ${id}` }));
      return;
    }
    const view = screen(this);
    this.screenHost.append(view.element);
    this.cleanup = view.dispose ?? null;
    this.screenHost.scrollTop = 0;

    if (!fullscreen) {
      const target =
        (focusId ? this.screenHost.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) : null) ??
        this.screenHost.querySelector<HTMLElement>("[data-autofocus]") ??
        this.screenHost.querySelector<HTMLElement>("button:not([disabled]), [tabindex='0']");
      target?.focus({ preventScroll: focusId !== undefined });
    }
  }

  private renderTopbar(id: ScreenId): void {
    empty(this.topbar);
    const crumbs = this.router.stack.map((s, i) =>
      i === this.router.stack.length - 1
        ? h("b", { text: SCREEN_TITLES[s] })
        : h("span", {}, h("span", { text: SCREEN_TITLES[s] }), h("span", { text: "  /  " })),
    );
    this.topbar.append(h("div", { class: "crumb" }, ...crumbs), h("div", { class: "spacer" }));
    if (this.state) {
      const me = this.state.teams[this.state.playerTeam];
      this.topbar.append(
        h(
          "div",
          { class: "status" },
          h("b", { text: me.name }),
          h("span", { text: `  ·  Season ${this.state.season}  ·  Day ${this.state.day}  ·  ` }),
          h("b", { text: fmtGil(this.state.gil) }),
        ),
      );
    }
    if (id !== "main" && id !== "match" && id !== "demo") {
      this.topbar.append(button("Back", () => this.back(), { class: "small", hint: "Esc" }));
    }
  }
}
