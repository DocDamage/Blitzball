import { describe, expect, it } from "vitest";
import { loadGameData } from "../data";
import { AI_INPUT } from "./input";
import { Match } from "./match";
import { Rng } from "./rng";
import { blockRoll, flightDecay, goalieRoll, shotInRange, tackleRoll, techcopyRoll, techcopyThreshold } from "./rules";
import { BESAID_AUROCHS, LUCA_GOERS } from "./sampleTeams";
import { teamDefFromRoster } from "./teamFromData";
import { techniqueIdByName } from "./techniques";
import type { TeamDef } from "./types";

/** Rand source returning a fixed value (clamped into range). */
const fixed = (v: number) => ({ rand: (n: number) => Math.min(v, Math.max(0, n - 1)) });

describe("contest rolls", () => {
  it("tackle: r = AT/2 + rand(AT), random part 0 is a miss", () => {
    const miss = tackleRoll(fixed(0), 9);
    expect(miss).toEqual({ value: 4, random: 0 });
    const max = tackleRoll(fixed(99), 9);
    expect(max).toEqual({ value: 4 + 8, random: 8 });
    // over many seeded rolls the value stays within [AT/2, AT/2 + AT - 1]
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const r = tackleRoll(rng, 10);
      expect(r.value).toBeGreaterThanOrEqual(5);
      expect(r.value).toBeLessThanOrEqual(14);
      expect(r.value - r.random).toBe(5);
    }
  });

  it("block: r = BL/2 + rand(BL + 1), random part 0 cannot block", () => {
    expect(blockRoll(fixed(0), 5)).toEqual({ value: 2, random: 0 });
    expect(blockRoll(fixed(99), 5)).toEqual({ value: 2 + 5, random: 5 });
  });

  it("goalie: g = CA/2 + rand(CA) and the shot scores only when g < SH", () => {
    expect(goalieRoll(fixed(0), 8)).toBe(4);
    expect(goalieRoll(fixed(99), 8)).toBe(4 + 7);
    const rng = new Rng(3);
    let goals = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) if (goalieRoll(rng, 8) < 8) goals++;
    // g in [4, 11]: 4 of 8 values are below 8
    expect(goals / trials).toBeGreaterThan(0.45);
    expect(goals / trials).toBeLessThan(0.55);
  });

  it("flight decay subtracts max(1, stat/5), /10 with Golden Arm, floored at 0", () => {
    expect(flightDecay(12, false)).toBe(10);
    expect(flightDecay(9, false)).toBe(8);
    expect(flightDecay(1, false)).toBe(0);
    expect(flightDecay(0, false)).toBe(0);
    expect(flightDecay(12, true)).toBe(11);
    expect(flightDecay(50, true)).toBe(45);
  });

  it("shot range: d = dist/100, times SH/10 when non-zero, in range while d <= SH", () => {
    expect(shotInRange(9, 900)).toBe(true);
    expect(shotInRange(9, 1000)).toBe(false);
    expect(shotInRange(12, 1200)).toBe(true);
    expect(shotInRange(12, 1300)).toBe(false);
    expect(shotInRange(25, 1250)).toBe(true);
    expect(shotInRange(25, 1300)).toBe(false);
  });

  it("techcopy thresholds are 2 / 5 / 10 out of 10 by level relation", () => {
    expect(techcopyThreshold(1, 3)).toBe(2);
    expect(techcopyThreshold(3, 3)).toBe(5);
    expect(techcopyThreshold(5, 3)).toBe(10);
    const rng = new Rng(11);
    const rate = (c: number, u: number) => {
      let ok = 0;
      for (let i = 0; i < 5000; i++) if (techcopyRoll(rng, c, u)) ok++;
      return ok / 5000;
    };
    expect(rate(1, 3)).toBeGreaterThan(0.17);
    expect(rate(1, 3)).toBeLessThan(0.23);
    expect(rate(3, 3)).toBeGreaterThan(0.47);
    expect(rate(3, 3)).toBeLessThan(0.53);
    expect(rate(9, 3)).toBe(1);
  });
});

describe("flight decay in a match", () => {
  it("reduces a pass's power as it crosses each 100-unit step toward the receiver", () => {
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 1 });
    while (m.state.phase !== "play") m.step(AI_INPUT);
    for (const q of m.opponentsOf(0)) q.sleepTicks = 1_000_000;
    m.giveBall("letty");
    const letty = m.player("letty");
    const tidus = m.player("tidus");
    letty.pos = { x: -20, y: 0, z: 0 };
    tidus.pos = { x: -5, y: 0, z: 0 };
    const hold = {
      home: { kind: "human" as const, controlledPlayerId: "letty", move: { x: 0, y: 0, z: 0 }, sprint: false },
      away: { kind: "ai" as const },
    };
    m.step(hold); // the ball follows Letty to her new position
    m.step({
      home: { kind: "human", controlledPlayerId: "letty", move: { x: 0, y: 0, z: 0 }, sprint: false, pass: "tidus" },
      away: { kind: "ai" },
    });
    const f = m.state.ball.flight;
    expect(f?.kind).toBe("pass");
    const p0 = f?.power ?? 0;
    expect(p0).toBe(m.effectiveStats(letty).pa);
    for (let i = 0; i < 20 && m.state.ball.flight; i++) m.step(hold);
    const mid = m.state.ball.flight?.power;
    expect(mid).toBeDefined();
    expect(mid as number).toBeLessThan(p0);
  });
});

describe("techcopy in a match", () => {
  const data = loadGameData();
  const VENOM_TACKLE = techniqueIdByName("Venom Tackle");

  /** Aurochs with Letty (MF, marks the opposing MF) at a chosen level and no tier data (anything learnable). */
  function aurochsWithLettyAt(level: number): TeamDef {
    const t = teamDefFromRoster(data, 5, { levels: { 3: level } });
    return { ...t, players: t.players.map((p) => ({ ...p, learnableTiers: undefined, tierLevels: undefined })) };
  }

  function successRate(copierLevel: number, trials = 3000): number {
    // Graav (MF of the Goers, level 3) is the user; Letty is the only marker of the opposing MF
    const m = new Match(aurochsWithLettyAt(copierLevel), LUCA_GOERS, { seed: 5 });
    const graav = m.player("graav");
    const letty = m.player("letty");
    expect(graav.def.level).toBe(3);
    expect(m.markTarget(letty)?.id).toBe("graav");
    let ok = 0;
    for (let i = 0; i < trials; i++) {
      letty.learned = [];
      if (m.offerTechcopy(graav, VENOM_TACKLE)) ok++;
    }
    return ok / trials;
  }

  it("succeeds 20 % below, 50 % at and 100 % above the user's level", () => {
    const low = successRate(1);
    expect(low).toBeGreaterThan(0.16);
    expect(low).toBeLessThan(0.24);
    const equal = successRate(3);
    expect(equal).toBeGreaterThan(0.46);
    expect(equal).toBeLessThan(0.54);
    expect(successRate(10, 200)).toBe(1);
  });

  it("only offers techniques inside the copier's open tiers and never ones already known", () => {
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 5 });
    const letty = m.player("letty");
    // Letty (level 1) can learn tier-1 techniques only
    const tier1 = letty.def.learnableTiers?.[0] ?? [];
    const tier2 = letty.def.learnableTiers?.[1] ?? [];
    expect(m.canLearn(letty, tier1[0])).toBe(true);
    expect(m.canLearn(letty, tier2[0])).toBe(false);
    letty.learned.push(tier1[0]);
    expect(m.canLearn(letty, tier1[0])).toBe(false);
    // Graav's Venom Tackle (26) is in Letty's tiers only if the data says so
    const learnable = letty.def.learnableTiers?.some((t) => t.includes(VENOM_TACKLE)) ?? false;
    const tier = letty.def.learnableTiers?.findIndex((t) => t.includes(VENOM_TACKLE)) ?? -1;
    const open = tier === 0 || (tier > 0 && letty.def.level >= (letty.def.tierLevels?.[tier - 1] ?? 999));
    expect(m.canLearn(letty, VENOM_TACKLE)).toBe(learnable && open);
    expect(m.markTarget(letty)?.id).toBe("graav");
  });

  it("records successful copies as learned (pending), not as equipped techniques", () => {
    const m = new Match(aurochsWithLettyAt(10), LUCA_GOERS, { seed: 5 });
    const letty = m.player("letty");
    const k = m.offerTechcopy(m.player("graav"), VENOM_TACKLE);
    expect(k?.id).toBe("letty");
    expect(letty.learned).toEqual([VENOM_TACKLE]);
    expect(letty.techniques).not.toContain(VENOM_TACKLE);
    expect(m.events.at(-1)).toMatchObject({ kind: "techcopy", by: "letty", techniqueId: VENOM_TACKLE, from: "graav" });
  });
});
