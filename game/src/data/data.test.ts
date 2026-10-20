import { describe, expect, it } from "vitest";
import {
  canLearnAt,
  hasLearned,
  learnedTechniqueIds,
  learnedTechniques,
  loadGameData,
  masksFromIds,
  playerById,
  statAt,
  statsAt,
  techniqueById,
  withLearned,
} from "./index";

const data = loadGameData();

describe("loadGameData", () => {
  it("loads 60 players, 61 techniques, 6 teams", () => {
    expect(data.players).toHaveLength(60);
    expect(data.techniques).toHaveLength(61);
    expect(data.teams.teams).toHaveLength(6);
    expect(data.rosters.players).toHaveLength(60);
    expect(data.teams.teams[5].name).toBe("Besaid Aurochs");
  });

  it("normalises technique 0 and keeps the rest", () => {
    expect(techniqueById(0)).toMatchObject({ id: 0, name: "(none)", kind: "none", hpCost: 0 });
    expect(techniqueById(23)).toMatchObject({ name: "Volley Shot", kind: "shot", hpCost: 10 });
    expect(techniqueById(1).name).toBe("Jecht Shot");
    expect(() => techniqueById(61)).toThrow();
  });

  it("Besaid Aurochs roster is Tidus, Datto, Letty, Jassu, Botta, Keepa", () => {
    const aurochs = data.rosters.teams[5];
    const names = aurochs.players.filter((p): p is number => p !== null).map((id) => playerById(id).name);
    expect(names).toEqual(["Tidus", "Datto", "Letty", "Jassu", "Botta", "Keepa"]);
    expect(aurochs.players).toHaveLength(8);
  });
});

describe("statAt", () => {
  it("Tidus level 99 BL = 19", () => {
    expect(statAt(playerById(0), "BL", 99)).toBe(19);
  });

  it("Vuroja level 99", () => {
    const v = playerById(15);
    expect(v.name).toBe("Vuroja");
    expect(statsAt(v, 99)).toEqual({ HP: 9999, AT: 54, EN: 75, PA: 99, SH: 28, CA: 20, SP: 60, BL: 65 });
  });

  it("reproduces statsLv1 and statsLv99 for every player and stat", () => {
    for (const p of data.players) {
      expect(statsAt(p, 1), p.name).toEqual(p.statsLv1);
      expect(statsAt(p, 99), p.name).toEqual(p.statsLv99);
    }
  });

  it("clamps the level into 1..99", () => {
    const t = playerById(0);
    expect(statAt(t, "HP", 0)).toBe(statAt(t, "HP", 1));
    expect(statAt(t, "HP", 500)).toBe(9999);
  });
});

describe("technique bitmasks", () => {
  it("Linna starts level 7 with Volley Shot and Nap Shot 3 equipped and learned", () => {
    const linna = playerById(45);
    const state = data.rosters.players[45];
    expect(linna.name).toBe("Linna");
    expect(state.level).toBe(7);
    expect(state.equippedTechs.slice(0, 2)).toEqual([23, 10]);
    expect(hasLearned(state, 23)).toBe(true);
    expect(hasLearned(state, 10)).toBe(true);
    expect(learnedTechniques(linna, state)).toEqual([10, 23, 41, 57]);
  });

  it("round-trips page 1 and page 2 bits including the edges", () => {
    const ids = [1, 31, 32, 60, 45];
    const masks = masksFromIds(ids);
    expect(learnedTechniqueIds(masks)).toEqual([1, 31, 32, 45, 60]);
    expect(masks.learnedTechsPage1).toBe(((1 << 1) | (1 << 31)) >>> 0);
    expect(hasLearned(masks, 2)).toBe(false);
    expect(() => withLearned(masks, 61)).toThrow(RangeError);
  });

  it("tier gating follows tierLevels", () => {
    const tidus = playerById(0); // tiers open at 26, 36, 41
    expect(canLearnAt(tidus, 1, 1)).toBe(true); // Jecht Shot, tier 1
    expect(canLearnAt(tidus, 6, 1)).toBe(false); // Venom Shot 2, tier 2
    expect(canLearnAt(tidus, 6, 26)).toBe(true);
    expect(canLearnAt(tidus, 2, 40)).toBe(false); // Jecht Shot 2, tier 4
    expect(canLearnAt(tidus, 2, 41)).toBe(true);
  });
});
