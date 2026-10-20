import { describe, expect, it } from "vitest";
import type { MatchEvent } from "../sim/types";
import {
  CONTEST_EVENT_KINDS,
  decideTimeScale,
  isContestEvent,
  nextSlowMoRemaining,
  SLOW_MO_SCALE,
  SLOW_MO_WINDOW_SECONDS,
  slowMoTriggered,
} from "./timeScale";

const base = { tick: 1, time: 0, half: 1 as const };
const shot: MatchEvent = { ...base, kind: "shot", by: "tidus", team: 0, power: 10, aimed: false };
const pass: MatchEvent = { ...base, kind: "pass", from: "tidus", to: "letty", team: 0 };
const tackle: MatchEvent = { ...base, kind: "tackle", by: "bickson", on: "tidus", team: 1 };

describe("time scale decisions", () => {
  it("classifies contest events", () => {
    expect(isContestEvent(shot)).toBe(true);
    expect(isContestEvent(tackle)).toBe(true);
    expect(isContestEvent(pass)).toBe(false);
    expect(slowMoTriggered([pass])).toBe(false);
    expect(slowMoTriggered([pass, shot])).toBe(true);
    expect(CONTEST_EVENT_KINDS).toContain("goal");
  });

  it("arcade slows to SLOW_MO_SCALE only while the window runs", () => {
    expect(decideTimeScale({ mode: "arcade", slowMoRemaining: 0, menuOpen: false, paused: false })).toBe(1);
    expect(decideTimeScale({ mode: "arcade", slowMoRemaining: 0.2, menuOpen: false, paused: false })).toBe(
      SLOW_MO_SCALE,
    );
    expect(decideTimeScale({ mode: "arcade", slowMoRemaining: 0.2, menuOpen: true, paused: false })).toBe(
      SLOW_MO_SCALE,
    );
  });

  it("tactical freezes while the radial menu is open and ignores slow motion", () => {
    expect(decideTimeScale({ mode: "tactical", slowMoRemaining: 0.4, menuOpen: false, paused: false })).toBe(1);
    expect(decideTimeScale({ mode: "tactical", slowMoRemaining: 0, menuOpen: true, paused: false })).toBe(0);
  });

  it("action never alters time", () => {
    expect(decideTimeScale({ mode: "action", slowMoRemaining: 0.4, menuOpen: true, paused: false })).toBe(1);
  });

  it("pause wins in every mode", () => {
    for (const mode of ["arcade", "tactical", "action"] as const) {
      expect(decideTimeScale({ mode, slowMoRemaining: 0.4, menuOpen: false, paused: true })).toBe(0);
    }
  });

  it("restarts the arcade window on a contest and counts it down otherwise", () => {
    expect(nextSlowMoRemaining("arcade", 0, 0.016, [shot])).toBe(SLOW_MO_WINDOW_SECONDS);
    expect(nextSlowMoRemaining("arcade", 0.3, 0.1, [pass])).toBeCloseTo(0.2);
    expect(nextSlowMoRemaining("arcade", 0.05, 0.1, [])).toBe(0);
    expect(nextSlowMoRemaining("tactical", 0.3, 0.016, [shot])).toBe(0);
    expect(nextSlowMoRemaining("action", 0.3, 0.016, [shot])).toBe(0);
  });
});
