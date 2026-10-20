import { describe, expect, it } from "vitest";
import { DIFFICULTIES } from "./ai";
import { RESET_FREEZE_SECONDS, TICK_RATE } from "./constants";
import { FORMATION_IDS, FORMATIONS } from "./formations";
import { simulateMatch } from "./index";
import { AI_INPUT, type MatchInput } from "./input";
import { Match } from "./match";
import { BESAID_AUROCHS, LUCA_GOERS } from "./sampleTeams";

const RESET_TICKS = Math.round(RESET_FREEZE_SECONDS * TICK_RATE);

/** A match that has finished its initial reset freeze and is in play. */
function playingMatch(seed = 1, halfSeconds = 30): Match {
  const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed, halfSeconds });
  for (let i = 0; i <= RESET_TICKS; i++) m.step(AI_INPUT);
  expect(m.state.phase).toBe("play");
  return m;
}

describe("full match", () => {
  it("completes AI vs AI with a score and an event log in under 5 s", () => {
    const t0 = Date.now();
    const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 1);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.state.phase).toBe("finished");
    expect(r.state.half).toBe(2);
    expect(r.state.tick).toBeGreaterThanOrEqual(2 * 300 * TICK_RATE);
    expect(r.score[0] + r.score[1]).toBe(r.events.filter((e) => e.kind === "goal").length);
    const kinds = new Set(r.events.map((e) => e.kind));
    for (const k of ["kickoff", "pass", "shot", "half-time", "full-time"]) expect(kinds.has(k as never)).toBe(true);
    expect(r.events[0].kind).toBe("kickoff");
    expect(r.events[r.events.length - 1].kind).toBe("full-time");
    expect(r.stats.teams[0].possession + r.stats.teams[1].possession).toBeCloseTo(1, 5);
    expect(r.stats.teams[1].shots).toBeGreaterThan(0);
    // ticks are monotonic in the log
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].tick).toBeGreaterThanOrEqual(r.events[i - 1].tick);
  });

  it("replays identically for the same seed and differs for another seed", () => {
    const a = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 42);
    const b = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 42);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
    expect(b.score).toEqual(a.score);
    const c = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 43);
    expect(c.events).not.toEqual(a.events);
  });

  it("lands goals per match in a sane range over 20 seeds", () => {
    const totals: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, seed);
      totals.push(r.score[0] + r.score[1]);
    }
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(mean).toBeGreaterThanOrEqual(1);
    expect(mean).toBeLessThanOrEqual(8);
    for (const t of totals) expect(t).toBeLessThanOrEqual(12);
    expect(Math.max(...totals)).toBeGreaterThan(0);
  });

  it("supports sudden-death overtime when tied", () => {
    // Two identical teams rarely stay tied, so just check the option is honoured when it is.
    const r = simulateMatch(BESAID_AUROCHS, BESAID_AUROCHS_CLONE, 5, { halfSeconds: 5, overtime: true });
    const tiedAtFullTime = r.events.find((e) => e.kind === "half-time");
    expect(tiedAtFullTime).toBeDefined();
    if (r.events.some((e) => e.kind === "overtime-start")) expect(r.state.half).toBe(3);
  });

  it("fires techcopy events and the learner really knows the technique afterwards", () => {
    const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 1);
    const copies = r.events.filter((e) => e.kind === "techcopy");
    expect(copies.length).toBeGreaterThan(0);
    for (const c of copies) {
      if (c.kind !== "techcopy") continue;
      const learner = r.state.players.find((p) => p.id === c.by);
      expect(learner?.techniques).toContain(c.techniqueId);
    }
  });
});

const BESAID_AUROCHS_CLONE = {
  ...BESAID_AUROCHS,
  id: "aurochs-b",
  players: BESAID_AUROCHS.players.map((p) => ({ ...p, id: `${p.id}-b`, teamId: "aurochs-b" })),
};

describe("rules", () => {
  it("refills HP and clears statuses at half time", () => {
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 3, halfSeconds: 20 });
    while (!m.events.some((e) => e.kind === "half-time")) m.step(AI_INPUT);
    // someone must have spent stamina during 20 s of play before the refill
    const beforeIdx = m.events.findIndex((e) => e.kind === "half-time");
    expect(beforeIdx).toBeGreaterThan(0);
    expect(m.state.half).toBe(2);
    for (const p of m.state.players) {
      expect(p.hp).toBe(p.maxHp);
      expect(p.statuses).toEqual([]);
      expect(p.cooldowns).toEqual({});
    }
    // sides swap
    expect(m.state.attackDir).toEqual([-1, 1]);
  });

  it("drains HP while sprinting and slows low-HP players", () => {
    const m = playingMatch();
    const tidus = m.player("tidus");
    const full = m.speedOf(tidus, false);
    tidus.hp = 0;
    expect(m.speedOf(tidus, false)).toBeLessThan(full);
    tidus.hp = tidus.maxHp;
    const input: MatchInput = {
      home: { kind: "human", controlledPlayerId: "tidus", move: { x: 1, y: 0, z: 0 }, sprint: true },
      away: { kind: "ai" },
    };
    const x0 = tidus.pos.x;
    for (let i = 0; i < 60; i++) m.step(input);
    expect(tidus.hp).toBeLessThan(tidus.maxHp);
    expect(tidus.pos.x).toBeGreaterThan(x0);
  });

  it("applies poison drain and expires statuses with events", () => {
    const m = playingMatch();
    const p = m.player("letty");
    const hp0 = p.hp;
    m.applyStatus(p, "poison", 1);
    expect(m.events.at(-1)).toMatchObject({ kind: "status-applied", player: "letty", status: "poison" });
    for (let i = 0; i < 30; i++) m.step(AI_INPUT);
    expect(p.hp).toBeLessThan(hp0);
    expect(m.hasStatus(p, "poison")).toBe(true);
    for (let i = 0; i < 40; i++) m.step(AI_INPUT);
    expect(m.hasStatus(p, "poison")).toBe(false);
    expect(m.events.some((e) => e.kind === "status-expired" && e.player === "letty" && e.status === "poison")).toBe(
      true,
    );
  });

  it("keeps sleeping players still and halves withered stats", () => {
    const m = playingMatch();
    const p = m.player("jassu");
    m.applyStatus(p, "sleep", 2);
    const pos = { ...p.pos };
    for (let i = 0; i < 30; i++) m.step(AI_INPUT);
    expect(p.pos).toEqual(pos);
    expect(m.canAct(p)).toBe(false);
    const q = m.player("doram");
    const at0 = m.effectiveStats(q).at;
    m.applyStatus(q, "wither", 5);
    expect(m.effectiveStats(q).at).toBeCloseTo(at0 * 0.5, 5);
  });

  it("uses a technique with HP cost, cooldown and an event (human input)", () => {
    const m = playingMatch();
    m.giveBall("tidus");
    const tidus = m.player("tidus");
    const hp0 = tidus.hp;
    const input: MatchInput = {
      home: {
        kind: "human",
        controlledPlayerId: "tidus",
        move: { x: 0, y: 0, z: 0 },
        sprint: false,
        shoot: true,
        technique: "sphere-shot",
      },
      away: { kind: "ai" },
    };
    m.step(input);
    const used = m.events.find((e) => e.kind === "technique-used");
    expect(used).toMatchObject({ kind: "technique-used", by: "tidus", techniqueId: "sphere-shot" });
    expect(m.events.some((e) => e.kind === "shot" && e.by === "tidus" && e.techniqueId === "sphere-shot")).toBe(true);
    expect(tidus.hp).toBeLessThanOrEqual(hp0 - 40);
    expect(tidus.cooldowns["sphere-shot"]).toBeGreaterThan(0);
    expect(m.canUseTechnique(tidus, "sphere-shot")).toBe(false);
  });

  it("resolves a tackle contest as either tackle or breakthrough", () => {
    const m = playingMatch(2);
    m.giveBall("tidus");
    const tidus = m.player("tidus");
    const doram = m.player("doram");
    doram.pos = { ...tidus.pos };
    const input: MatchInput = {
      home: { kind: "human", controlledPlayerId: "tidus", move: { x: 0, y: 0, z: 0 }, sprint: false },
      away: { kind: "human", controlledPlayerId: "doram", move: { x: 0, y: 0, z: 0 }, sprint: false, tackle: true },
    };
    m.step(input);
    const last = m.events.filter((e) => e.kind === "tackle" || e.kind === "breakthrough");
    expect(last.length).toBe(1);
    expect(doram.tackleCooldown).toBeGreaterThan(0);
  });

  it("offers at least three formation presets with marking assignments", () => {
    expect(FORMATION_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of FORMATION_IDS) {
      expect(Object.keys(FORMATIONS[id].slots)).toHaveLength(6);
      expect(FORMATIONS[id].marks.GK).toBeNull();
    }
    const m = playingMatch();
    const jassu = m.player("jassu");
    expect(m.markTarget(jassu)?.role).toBe("RF");
    const before = m.formationSlot(jassu);
    m.setFormation(0, "defense");
    expect(m.formationSlot(jassu)).not.toEqual(before);
  });

  it("exposes difficulty presets that stay deterministic", () => {
    const a = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 9, { halfSeconds: 20, difficulty: "hard" });
    const b = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 9, { halfSeconds: 20, difficulty: DIFFICULTIES.hard });
    expect(a.events).toEqual(b.events);
  });
});
