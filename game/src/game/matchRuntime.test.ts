import { describe, expect, it } from "vitest";
import { Match } from "../sim/match";
import { matchReport } from "../sim/report";
import { BESAID_AUROCHS, LUCA_GOERS } from "../sim/sampleTeams";
import { screenToPool } from "./control";
import { simulateInstant } from "./matchRuntime";
import type { MatchOptions } from "./types";

const options: MatchOptions = {
  home: BESAID_AUROCHS,
  away: LUCA_GOERS,
  seed: 11,
  halfSeconds: 60,
  overtime: false,
  difficulty: "normal",
  humanTeam: null,
  controlMode: "action",
  camera: "broadcast",
  settings: { uiScale: 1, screenShake: true, reducedFlash: false, colorblind: false },
  instant: true,
};

describe("simulateInstant", () => {
  it("returns the same report as matchReport() on an equivalent headless match", () => {
    const r = simulateInstant(options);
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, {
      seed: 11,
      halfSeconds: 60,
      overtime: false,
      difficulty: "normal",
    });
    m.run();
    const ref = matchReport(m);
    expect(r.homeTeam).toBe(ref.homeTeam);
    expect(r.awayTeam).toBe(ref.awayTeam);
    expect(r.score).toEqual(ref.score);
    expect(r.perPlayer).toEqual(ref.perPlayer);
    expect(r.events).toEqual(m.events);
    expect(r.events[r.events.length - 1]?.kind).toBe("full-time");
    expect(r.abandoned).toBeUndefined();
    const goals = r.events.filter((e) => e.kind === "goal").length;
    expect(r.score[0] + r.score[1]).toBe(goals);
    expect(r.perPlayer.reduce((n, l) => n + l.goals, 0)).toBe(goals);
  });

  it("is deterministic for a seed", () => {
    const a = simulateInstant(options);
    const b = simulateInstant(options);
    expect(a.score).toEqual(b.score);
    expect(a.events.length).toBe(b.events.length);
  });
});

describe("camera-relative movement", () => {
  it("maps screen axes through the basis and normalises diagonals", () => {
    const basis = { right: { x: 0, y: -1 }, forward: { x: 1, y: 0 } };
    expect(screenToPool({ x: 1, y: 0 }, basis)).toEqual({ x: 0, y: -1 });
    expect(screenToPool({ x: 0, y: 1 }, basis)).toEqual({ x: 1, y: 0 });
    const d = screenToPool({ x: 1, y: 1 }, basis);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });
});
