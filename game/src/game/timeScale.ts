/**
 * timeScale.ts - Pure decisions about how fast the sim runs for each control
 * mode (BLITZBALL_PLAN.md 5.3). The runtime feeds these the events of the
 * last tick and its own state; nothing here touches the DOM.
 *
 *   arcade   a SLOW_MO_WINDOW_SECONDS window at SLOW_MO_SCALE after a
 *            contested shot or tackle so the outcome can be read
 *   tactical the sim freezes (scale 0) while the radial menu is open
 *   action   never alters time
 */

import { type MatchEvent, type MatchEventKind, SLOW_MO_WINDOW_SECONDS } from "../sim";
import type { ControlMode } from "./types";

export const SLOW_MO_SCALE = 0.3;
export { SLOW_MO_WINDOW_SECONDS };

/** Events that mean "a contest just resolved" and deserve a slow-motion beat. */
export const CONTEST_EVENT_KINDS: readonly MatchEventKind[] = [
  "shot",
  "shot-blocked",
  "save",
  "deflection",
  "goal",
  "tackle",
  "tackle-miss",
  "tackle-evaded",
  "breakthrough",
  "pass-intercepted",
];

export function isContestEvent(e: MatchEvent): boolean {
  return CONTEST_EVENT_KINDS.includes(e.kind);
}

/** Does this batch of events (one tick) trigger the arcade slow-motion window? */
export function slowMoTriggered(events: readonly MatchEvent[]): boolean {
  return events.some(isContestEvent);
}

export interface TimeScaleContext {
  mode: ControlMode;
  /** Real seconds of slow motion still to run (arcade). */
  slowMoRemaining: number;
  /** Tactical radial menu open: the sim is frozen. */
  menuOpen: boolean;
  paused: boolean;
}

/** Multiplier applied to real time before it is fed to the fixed-step accumulator. */
export function decideTimeScale(ctx: TimeScaleContext): number {
  if (ctx.paused) return 0;
  switch (ctx.mode) {
    case "arcade":
      return ctx.slowMoRemaining > 0 ? SLOW_MO_SCALE : 1;
    case "tactical":
      return ctx.menuOpen ? 0 : 1;
    case "action":
      return 1;
  }
}

/**
 * Advance the slow-motion timer by `realDt` seconds and restart it when a
 * contest happened this tick (arcade only). Returns the new remaining time.
 */
export function nextSlowMoRemaining(
  mode: ControlMode,
  remaining: number,
  realDt: number,
  tickEvents: readonly MatchEvent[],
): number {
  if (mode !== "arcade") return 0;
  if (slowMoTriggered(tickEvents)) return SLOW_MO_WINDOW_SECONDS;
  return Math.max(0, remaining - realDt);
}
