import { describe, expect, it } from "vitest";
import { PLAYER_ACTIONS } from "../render/renderState";
import { POOL_HALF } from "../sim/constants";
import { AI_INPUT } from "../sim/input";
import { Match } from "../sim/match";
import { BESAID_AUROCHS, LUCA_GOERS } from "../sim/sampleTeams";
import type { MatchEvent } from "../sim/types";
import {
  ActionTracker,
  actionsForEvent,
  facingYaw,
  movementAction,
  RENDER_POOL,
  renderToSimPos,
  simToRenderPos,
  toRenderSnapshot,
} from "./snapshotAdapter";

function playedMatch(ticks = 600): Match {
  const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 3, halfSeconds: 30 });
  for (let i = 0; i < ticks; i++) m.step(AI_INPUT);
  return m;
}

describe("snapshot adapter", () => {
  it("maps every player and the ball inside the render pool with valid fields", () => {
    const m = playedMatch();
    const snap = toRenderSnapshot(m.state, { selectedPlayerId: "tidus" });
    expect(snap.pool).toEqual(RENDER_POOL);
    expect(snap.players).toHaveLength(m.state.players.length);
    const ids = new Set(snap.players.map((p) => p.id));
    expect(ids.size).toBe(snap.players.length);
    for (const p of snap.players) {
      expect(p.position.x).toBeGreaterThanOrEqual(RENDER_POOL.minX - 1e-6);
      expect(p.position.x).toBeLessThanOrEqual(RENDER_POOL.maxX + 1e-6);
      expect(p.position.y).toBeGreaterThanOrEqual(RENDER_POOL.minY - 1e-6);
      expect(p.position.y).toBeLessThanOrEqual(RENDER_POOL.maxY + 1e-6);
      expect(p.position.z).toBeGreaterThanOrEqual(RENDER_POOL.minZ - 1e-6);
      expect(p.position.z).toBeLessThanOrEqual(RENDER_POOL.maxZ + 1e-6);
      expect(p.hp).toBeGreaterThanOrEqual(0);
      expect(p.hp).toBeLessThanOrEqual(1);
      expect(p.speed).toBeGreaterThanOrEqual(0);
      expect(p.speed).toBeLessThanOrEqual(1);
      expect(PLAYER_ACTIONS).toContain(p.action);
      expect(Number.isFinite(p.facing)).toBe(true);
      expect(p.team === 0 || p.team === 1).toBe(true);
    }
    expect(snap.players.filter((p) => p.isKeeper)).toHaveLength(2);
    expect(snap.ball.carrierId).toBe(m.state.ball.carrier);
    expect(snap.selectedPlayerId).toBe("tidus");
    expect(snap.score).toEqual(m.state.score);
    expect(snap.clock).toBe(m.state.time);
    expect(snap.half === 1 || snap.half === 2).toBe(true);
    expect(snap.possession).toBe(m.state.possession);
  });

  it("shifts z by the pool half depth and round-trips", () => {
    const p = { x: 3, y: -4, z: 0 };
    const r = simToRenderPos(p);
    expect(r).toEqual({ x: 3, y: -4, z: POOL_HALF.z });
    expect(renderToSimPos(r)).toEqual(p);
  });

  it("does not mutate the sim state", () => {
    const m = playedMatch(120);
    const before = JSON.stringify(m.state);
    toRenderSnapshot(m.state, { tracker: new ActionTracker() });
    expect(JSON.stringify(m.state)).toBe(before);
  });

  it("derives facing yaw and movement actions", () => {
    expect(facingYaw({ x: 1, y: 0 })).toBe(0);
    expect(facingYaw({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    expect(facingYaw({ x: 0, y: 0 })).toBe(0);
    expect(movementAction(0)).toBe("idle");
    expect(movementAction(0.3)).toBe("swim");
    expect(movementAction(0.9)).toBe("sprint");
  });

  it("turns events into short-lived actions that expire", () => {
    const m = playedMatch(60);
    const tracker = new ActionTracker();
    const tick = m.state.tick;
    const pass: MatchEvent = { kind: "pass", from: "tidus", to: "letty", team: 0, tick, time: 0, half: 1 };
    const tackle: MatchEvent = { kind: "tackle", by: "bickson", on: "tidus", team: 1, tick, time: 0, half: 1 };
    expect(actionsForEvent(pass, () => [])).toEqual([["tidus", "pass"]]);
    expect(actionsForEvent(tackle, () => [])).toEqual([
      ["bickson", "tackle"],
      ["tidus", "hit"],
    ]);
    tracker.ingest([pass], m.state);
    expect(tracker.actionOf("tidus", tick)).toBe("pass");
    expect(tracker.actionOf("tidus", tick + 10)).toBe("pass");
    expect(tracker.actionOf("tidus", tick + 600)).toBeNull();
    const snap = toRenderSnapshot(m.state, { tracker: new ActionTracker() });
    expect(snap.players.find((p) => p.id === "tidus")?.action).not.toBe("pass");
  });

  it("makes the whole scoring team celebrate", () => {
    const m = playedMatch(10);
    const goal: MatchEvent = {
      kind: "goal",
      by: "tidus",
      team: 0,
      score: [1, 0],
      keeperInReach: true,
      tick: m.state.tick,
      time: 1,
      half: 1,
    };
    const tracker = new ActionTracker();
    tracker.ingest([goal], m.state);
    const snap = toRenderSnapshot(m.state, { tracker });
    for (const p of snap.players) if (p.team === 0) expect(p.action).toBe("celebrate");
    expect(snap.players.filter((p) => p.action === "celebrate")).toHaveLength(6);
  });
});
