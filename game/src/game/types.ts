/**
 * types.ts - The contract between the app shell and the playable match.
 *
 * The shell builds a MatchOptions (teams from sim/teamFromData, settings from
 * its menus) and calls playMatch() / simulateInstant() in matchRuntime.ts.
 */

import type { KeyBindings } from "../input/bindings";
import type { MatchReport } from "../league/report";
import type { MatchEvent, TeamDef } from "../sim/types";

export type ControlMode = "arcade" | "tactical" | "action";

export interface MatchSettings {
  /** 1 = default HUD size; applied as the --hud-scale CSS variable. */
  uiScale: number;
  screenShake: boolean;
  /** No white goal flash. */
  reducedFlash: boolean;
  /** Colourblind-safe team palette for the HUD. */
  colorblind: boolean;
  keyBindings?: Partial<KeyBindings>;
  // [audio hook] Volumes 0..1 for src/audio; omitted = defaults.
  audio?: { master: number; sfx: number; music: number; muted: boolean };
}

export interface MatchOptions {
  home: TeamDef;
  away: TeamDef;
  seed: number;
  halfSeconds: number;
  overtime: boolean;
  difficulty: "easy" | "normal" | "hard";
  /** null = watch AI vs AI. */
  humanTeam: 0 | 1 | null;
  controlMode: ControlMode;
  camera: "broadcast" | "tactical";
  settings: MatchSettings;
  /** Simulate instantly with no rendering (AI vs AI league matches). */
  instant?: boolean;
}

export type MatchResult = MatchReport & {
  events: MatchEvent[];
  score: [number, number];
  /** Set when the player quit from the pause menu before full time. */
  abandoned?: boolean;
};

export interface MatchHandle {
  readonly promise: Promise<MatchResult>;
  pause(): void;
  resume(): void;
  /** Fast-forward: simulate every remaining tick instantly and resolve. */
  skip(): void;
  dispose(): void;
}
