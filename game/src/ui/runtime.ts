/**
 * runtime.ts - Contract with the match runtime (src/game/matchRuntime.ts).
 *
 * The runtime is developed separately; the shell only depends on the shape
 * below and loads the module lazily through import.meta.glob, which yields
 * an empty map when the file does not exist yet. That keeps the shell
 * building and lets the UI show a "match runtime not available" notice
 * instead of crashing. Every type here mirrors the agreed contract.
 */

import type { KeyBindings } from "../input/bindings";
import type { MatchReport } from "../league/report";
import type { MatchEvent, TeamDef } from "../sim/types";
import type { ControlMode, Difficulty } from "./settings";

export interface MatchSettings {
  uiScale: number;
  screenShake: boolean;
  reducedFlash: boolean;
  colorblind: boolean;
  keyBindings?: Partial<KeyBindings>;
  // [audio hook] mirrors src/game/types.ts MatchSettings.audio (0..1).
  audio?: { master: number; sfx: number; music: number; muted: boolean };
}

export interface MatchOptions {
  home: TeamDef;
  away: TeamDef;
  seed: number;
  halfSeconds: number;
  overtime: boolean;
  difficulty: Difficulty;
  humanTeam: 0 | 1 | null;
  controlMode: ControlMode;
  camera: "broadcast" | "tactical";
  settings: MatchSettings;
  instant?: boolean;
}

export type MatchOutcome = MatchReport & { events: MatchEvent[]; score: [number, number]; abandoned?: boolean };

export interface MatchHandle {
  readonly promise: Promise<MatchOutcome>;
  pause(): void;
  resume(): void;
  skip(): void;
  dispose(): void;
}

export interface MatchRuntime {
  playMatch(container: HTMLElement, options: MatchOptions): MatchHandle;
  simulateInstant(options: MatchOptions): MatchReport & { events: MatchEvent[]; score: [number, number] };
}

const modules = import.meta.glob("../game/matchRuntime.ts");
let cached: Promise<MatchRuntime | null> | null = null;

/** The runtime module, or null when it has not been written yet / fails to load. */
export function loadRuntime(): Promise<MatchRuntime | null> {
  if (!cached) {
    const loader = modules["../game/matchRuntime.ts"];
    cached = loader
      ? loader()
          .then((m) => {
            const mod = m as Partial<MatchRuntime>;
            return typeof mod.playMatch === "function" && typeof mod.simulateInstant === "function"
              ? (mod as MatchRuntime)
              : null;
          })
          .catch((err) => {
            console.warn("match runtime failed to load", err);
            return null;
          })
      : Promise.resolve(null);
  }
  return cached;
}

/** Test seam: pretend a runtime is (not) installed. */
export function setRuntimeForTests(rt: MatchRuntime | null): void {
  cached = Promise.resolve(rt);
}
