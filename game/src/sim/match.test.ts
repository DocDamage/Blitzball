import { describe, expect, it } from "vitest";
import { DIFFICULTIES } from "./ai";
import {
  DEFAULT_HALF_SECONDS,
  EXP_CAP,
  FRAMES_PER_GAME_SECOND,
  framesToTicks,
  RESET_FREEZE_SECONDS,
  SPEED_BASE,
  SPEED_PER_SP,
  TICK_RATE,
} from "./constants";
import { FORMATION_IDS, FORMATIONS } from "./formations";
import { simulateMatch } from "./index";
import { AI_INPUT, type MatchInput } from "./input";
import { Match } from "./match";
import { BESAID_AUROCHS, LUCA_GOERS } from "./sampleTeams";
import { techniqueIdByName } from "./techniques";
import type { TeamDef } from "./types";

const RESET_TICKS = Math.round(RESET_FREEZE_SECONDS * TICK_RATE);
const SPHERE_SHOT = techniqueIdByName("Sphere Shot");

/** A match that has finished its initial reset freeze and is in play. */
function playingMatch(seed = 1, halfSeconds = 30): Match {
  const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed, halfSeconds });
  for (let i = 0; i <= RESET_TICKS; i++) m.step(AI_INPUT);
  expect(m.state.phase).toBe("play");
  return m;
}

/** Put every opponent of `team` to sleep so nothing interferes with a scenario. */
function freezeOpponents(m: Match, team: 0 | 1): void {
  for (const q of m.opponentsOf(team)) q.sleepTicks = 1_000_000;
}

const HOLD_TIDUS: MatchInput = {
  home: { kind: "human", controlledPlayerId: "tidus", move: { x: 0, y: 0, z: 0 }, sprint: false },
  away: { kind: "ai" },
};

describe("full match", () => {
  it("completes AI vs AI with a score and an event log in under 0.5 s", () => {
    const t0 = Date.now();
    const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 1);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.state.phase).toBe("finished");
    expect(r.state.half).toBe(2);
    expect(r.state.tick).toBeGreaterThanOrEqual(2 * DEFAULT_HALF_SECONDS * FRAMES_PER_GAME_SECOND);
    expect(r.score[0] + r.score[1]).toBe(r.events.filter((e) => e.kind === "goal").length);
    const kinds = new Set(r.events.map((e) => e.kind));
    for (const k of ["kickoff", "pass", "shot", "tackle", "half-time", "full-time"]) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(r.events[0].kind).toBe("kickoff");
    expect(r.events[r.events.length - 1].kind).toBe("full-time");
    expect(r.stats.teams[0].possession + r.stats.teams[1].possession).toBeCloseTo(1, 5);
    expect(r.stats.teams[1].shots).toBeGreaterThan(0);
    // ticks are monotonic in the log
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].tick).toBeGreaterThanOrEqual(r.events[i - 1].tick);
    // nobody exceeds the EXP cap
    for (const p of r.state.players) expect(p.exp).toBeLessThanOrEqual(EXP_CAP);
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

  it("lands goals per match in a sane range over 20 seeds, with both teams scoring", () => {
    const totals: number[] = [];
    const scored = [0, 0];
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, seed);
      totals.push(r.score[0] + r.score[1]);
      if (r.score[0] > 0) scored[0]++;
      if (r.score[1] > 0) scored[1]++;
    }
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(mean).toBeGreaterThanOrEqual(1);
    expect(mean).toBeLessThanOrEqual(8);
    for (const t of totals) expect(t).toBeLessThanOrEqual(10);
    expect(scored[0]).toBeGreaterThan(3);
    expect(scored[1]).toBeGreaterThan(3);
  });

  it("supports sudden-death overtime when tied", () => {
    const r = simulateMatch(BESAID_AUROCHS, AUROCHS_CLONE, 5, { halfSeconds: 5, overtime: true });
    expect(r.events.find((e) => e.kind === "half-time")).toBeDefined();
    if (r.events.some((e) => e.kind === "overtime-start")) expect(r.state.half).toBe(3);
  });

  it("exposes difficulty presets that stay deterministic", () => {
    const a = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 9, { halfSeconds: 20, difficulty: "hard" });
    const b = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 9, { halfSeconds: 20, difficulty: DIFFICULTIES.hard });
    expect(a.events).toEqual(b.events);
  });
});

const AUROCHS_CLONE: TeamDef = {
  ...BESAID_AUROCHS,
  id: "aurochs-b",
  players: BESAID_AUROCHS.players.map((p) => ({ ...p, id: `${p.id}-b`, teamId: "aurochs-b" })),
};

describe("rules", () => {
  it("refills HP and clears statuses at half time, then swaps sides", () => {
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 3, halfSeconds: 20 });
    m.applyStatus(m.player("letty"), "poison");
    while (!m.events.some((e) => e.kind === "half-time")) m.step(AI_INPUT);
    expect(m.state.half).toBe(2);
    for (const p of m.state.players) {
      expect(p.hp).toBe(p.effectiveMaxHp);
      expect(p.poisonTicks).toBe(0);
      expect(p.sleepTicks).toBe(0);
      expect(p.wither).toEqual({});
    }
    expect(m.state.attackDir).toEqual([-1, 1]);
  });

  it("runs the clock in game-seconds (FRAMES_PER_GAME_SECOND ticks each)", () => {
    const m = playingMatch();
    const t0 = m.state.time;
    for (let i = 0; i < FRAMES_PER_GAME_SECOND * 3; i++) m.step(AI_INPUT);
    expect(m.state.time - t0).toBeCloseTo(3, 5);
  });

  it("moves at a speed proportional to SP and sprinting (sim extension) costs HP", () => {
    const m = playingMatch();
    const tidus = m.player("tidus");
    expect(m.speedOf(tidus, false)).toBeCloseTo(SPEED_BASE + tidus.def.stats.sp * SPEED_PER_SP, 5);
    const input: MatchInput = {
      home: { kind: "human", controlledPlayerId: "tidus", move: { x: 1, y: 0, z: 0 }, sprint: true },
      away: { kind: "ai" },
    };
    const x0 = tidus.pos.x;
    const hp0 = tidus.hp;
    for (let i = 0; i < 60; i++) m.step(input);
    expect(tidus.hp).toBeLessThan(hp0);
    expect(tidus.pos.x).toBeGreaterThan(x0);
  });

  it("drains the carrier 1 HP per 27 frames, 4 HP per 9 frames when poisoned, and regenerates others", () => {
    const m = playingMatch();
    freezeOpponents(m, 0);
    m.giveBall("tidus");
    const tidus = m.player("tidus");
    tidus.hpCounter = 0;
    // align to the HP tick: it runs when tick % 3 === 0
    while (m.state.tick % 3 !== 2) m.step(HOLD_TIDUS);
    let hp0 = tidus.hp;
    for (let i = 0; i < 27; i++) m.step(HOLD_TIDUS);
    expect(tidus.hp).toBe(hp0 - 1);
    expect(m.state.ball.carrier).toBe("tidus");

    m.applyStatus(tidus, "poison");
    expect(tidus.drainPerTick).toBe(4);
    tidus.hpCounter = 0;
    hp0 = tidus.hp;
    for (let i = 0; i < 27; i++) m.step(HOLD_TIDUS);
    expect(tidus.hp).toBe(hp0 - 12);

    // a poisoned non-carrier never regenerates; a healthy one gains 1 HP per 51 frames
    const letty = m.player("letty");
    letty.hp = 10;
    letty.hpCounter = 0;
    m.applyStatus(letty, "poison", 10_000);
    for (let i = 0; i < 120; i++) m.step(HOLD_TIDUS);
    expect(letty.hp).toBe(10);
    letty.poisonTicks = 0;
    letty.drainPerTick = 1;
    letty.hpCounter = 0;
    for (let i = 0; i < 51 * 2; i++) m.step(HOLD_TIDUS);
    expect(letty.hp).toBe(12);
  });

  it("expires statuses with events after their frame counts", () => {
    const m = playingMatch();
    freezeOpponents(m, 0);
    const p = m.player("letty");
    m.applyStatus(p, "poison", 60);
    expect(m.events.at(-1)).toMatchObject({ kind: "status-applied", player: "letty", status: "poison" });
    for (let i = 0; i < framesToTicks(60) - 1; i++) m.step(HOLD_TIDUS);
    expect(m.hasStatus(p, "poison")).toBe(true);
    m.step(HOLD_TIDUS);
    expect(m.hasStatus(p, "poison")).toBe(false);
    expect(p.drainPerTick).toBe(1);
    expect(m.events.some((e) => e.kind === "status-expired" && e.player === "letty" && e.status === "poison")).toBe(
      true,
    );
  });

  it("keeps sleeping players still and halves withered stats", () => {
    const m = playingMatch();
    const p = m.player("jassu");
    m.applyStatus(p, "sleep", 120);
    const pos = { ...p.pos };
    for (let i = 0; i < 30; i++) m.step(AI_INPUT);
    expect(p.pos).toEqual(pos);
    expect(m.canAct(p)).toBe(false);
    const q = m.player("doram");
    const at0 = m.effectiveStats(q).at;
    m.applyStatus(q, "wither", 500, "at");
    expect(m.effectiveStats(q).at).toBe(Math.floor(at0 / 2));
  });

  it("halves PA and SH while HP is below them and never reports a zero stat", () => {
    const m = playingMatch();
    const letty = m.player("letty");
    const pa = letty.def.stats.pa;
    letty.hp = pa - 1;
    expect(m.effectiveStats(letty).pa).toBe(Math.floor(pa / 2));
    letty.hp = 0;
    letty.wither.ca = { remaining: 100, divisor: 2 };
    expect(m.effectiveStats(letty).ca).toBeGreaterThanOrEqual(1);
  });

  it("uses a shot technique with its HP cost, EXP and an event (human input)", () => {
    const m = playingMatch();
    freezeOpponents(m, 0);
    m.giveBall("tidus");
    const tidus = m.player("tidus");
    expect(tidus.techniques).toContain(SPHERE_SHOT);
    const hp0 = tidus.hp;
    const exp0 = tidus.exp;
    const input: MatchInput = {
      home: {
        kind: "human",
        controlledPlayerId: "tidus",
        move: { x: 0, y: 0, z: 0 },
        sprint: false,
        shoot: true,
        technique: SPHERE_SHOT,
      },
      away: { kind: "ai" },
    };
    m.step(input);
    const used = m.events.find((e) => e.kind === "technique-used");
    expect(used).toMatchObject({ kind: "technique-used", by: "tidus", techniqueId: SPHERE_SHOT });
    const shot = m.events.find((e) => e.kind === "shot" && e.by === "tidus");
    expect(shot).toMatchObject({ kind: "shot", techniqueId: SPHERE_SHOT });
    expect(tidus.hp).toBe(hp0 - 90);
    expect(tidus.exp).toBe(exp0 + 1);
    // a technique needs HP >= cost + SH max
    tidus.hp = 90 + tidus.def.stats.sh - 1;
    expect(m.canUseTechnique(tidus, SPHERE_SHOT)).toBe(false);
  });

  it("costs PA HP for a normal pass (all of it when HP is below PA max)", () => {
    const m = playingMatch();
    freezeOpponents(m, 0);
    m.giveBall("letty");
    const letty = m.player("letty");
    const input: MatchInput = {
      home: { kind: "human", controlledPlayerId: "letty", move: { x: 0, y: 0, z: 0 }, sprint: false, pass: "tidus" },
      away: { kind: "ai" },
    };
    const hp0 = letty.hp;
    m.step(input);
    expect(m.events.at(-1)).toMatchObject({ kind: "pass", from: "letty", to: "tidus" });
    expect(letty.hp).toBe(hp0 - letty.def.stats.pa);
    m.giveBall("letty");
    letty.hp = letty.def.stats.pa - 1;
    m.step(input);
    expect(letty.hp).toBe(0);
  });

  it("resolves a tackle as a miss, breakthrough or tackle and stuns the loser", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const m = playingMatch(seed);
      m.giveBall("tidus");
      const tidus = m.player("tidus");
      const doram = m.player("doram");
      doram.pos = { ...tidus.pos };
      const input: MatchInput = {
        home: { kind: "human", controlledPlayerId: "tidus", move: { x: 0, y: 0, z: 0 }, sprint: false },
        away: { kind: "human", controlledPlayerId: "doram", move: { x: 0, y: 0, z: 0 }, sprint: false, tackle: true },
      };
      m.step(input);
      const last = m.events.filter((e) => e.kind === "tackle" || e.kind === "breakthrough" || e.kind === "tackle-miss");
      expect(last.length).toBe(1);
      outcomes.add(last[0].kind);
      expect(doram.tackleCooldown).toBeGreaterThan(0);
      if (last[0].kind === "tackle") {
        expect(m.state.ball.carrier).toBe("doram");
        expect(tidus.stun).toBe(framesToTicks(100));
      } else if (last[0].kind === "breakthrough") {
        expect(m.state.ball.carrier).toBe("tidus");
        expect(tidus.contestEn).toBeLessThan(m.effectiveStats(tidus).en);
      }
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(2);
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

  it("honours Mark Mode assignments over the formation preset", () => {
    const m = playingMatch();
    const jassu = m.player("jassu");
    expect(m.markTarget(jassu)?.role).toBe("RF");
    m.setMarks(0, { [jassu.role]: "MF" });
    expect(m.markTarget(jassu)?.role).toBe("MF");
    expect(m.markTarget(jassu)?.team).toBe(1);
    m.setMarks(0, { [jassu.role]: null });
    expect(m.markTarget(jassu)).toBeNull();
    // the other team's assignments are untouched
    const opp = m.state.players.find((q) => q.team === 1 && q.role === "LF");
    const presetMark = FORMATIONS[m.state.formations[1]].marks.LF;
    expect(opp && m.markTarget(opp)?.role).toBe(presetMark ?? undefined);
    m.setMarks(0, {});
    expect(m.markTarget(jassu)?.role).toBe("RF");
  });

  it("caps pending EXP at 250 and doubles awards with Hi-Risk", () => {
    const m = playingMatch();
    const p = m.player("letty");
    p.exp = 0;
    m.awardExp(p, 3);
    expect(p.exp).toBe(3);
    p.passives.hiRisk = true;
    m.awardExp(p, 3);
    expect(p.exp).toBe(9);
    m.awardExp(p, 1000);
    expect(p.exp).toBe(EXP_CAP);
  });
});
