import { describe, expect, it } from "vitest";
import { loadGameData, statAt } from "../data";
import { simulateMatch } from "./index";
import { Match } from "./match";
import { matchReport } from "./report";
import { BESAID_AUROCHS, LUCA_GOERS } from "./sampleTeams";
import { playerSlug, teamDefFromRoster } from "./teamFromData";
import { ROLE_ORDER } from "./types";

const data = loadGameData();

describe("teamFromData", () => {
  it("builds the Aurochs from the new-game roster with stats from statAt", () => {
    expect(BESAID_AUROCHS.dataId).toBe(5);
    expect(BESAID_AUROCHS.players.map((p) => p.id)).toEqual(["tidus", "datto", "letty", "jassu", "botta", "keepa"]);
    const tidus = BESAID_AUROCHS.players[0];
    expect(tidus.dataId).toBe(0);
    expect(tidus.level).toBe(2);
    expect(tidus.stats.hp).toBe(statAt(data.players[0], "HP", 2));
    expect(tidus.stats.sh).toBe(statAt(data.players[0], "SH", 2));
    expect(tidus.techniques).toEqual([3]); // Sphere Shot equipped
    expect(tidus.keyTechniques).toContain(1); // Jecht Shot learned
    expect(tidus.learnableTiers?.length).toBe(4);
    expect(tidus.tierLevels).toEqual(data.players[0].tierLevels);
    // the keeper is slot 5
    expect(BESAID_AUROCHS.players[5].id).toBe("keepa");
    expect(ROLE_ORDER[5]).toBe("GK");
  });

  it("honours level and equipment overrides and only counts unlocked slots", () => {
    const t = teamDefFromRoster(data, 0, { levels: { 7: 20 }, equipped: { 8: [5, 8] } });
    const bickson = t.players.find((p) => p.dataId === 7);
    expect(bickson?.level).toBe(20);
    expect(bickson?.stats.sh).toBe(statAt(data.players[7], "SH", 20));
    expect(t.players.find((p) => p.dataId === 8)?.techniques).toEqual([5, 8]);
    expect(LUCA_GOERS.players.find((p) => p.dataId === 9)?.techniques).toEqual([26]);
  });

  it("slugs names deterministically", () => {
    expect(playerSlug("Jumal")).toBe("jumal");
    expect(playerSlug("Shuu!")).toBe("shuu");
  });
});

describe("matchReport", () => {
  it("summarises a finished match for the league layer", () => {
    const m = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 4 });
    m.run();
    const r = matchReport(m);
    expect(r.homeTeam).toBe(5);
    expect(r.awayTeam).toBe(0);
    expect(r.score).toEqual(m.state.score);
    expect(r.perPlayer).toHaveLength(12);
    const goals = r.perPlayer.reduce((a, l) => a + l.goals, 0);
    expect(goals).toBe(r.score[0] + r.score[1]);
    const passes = r.perPlayer.reduce((a, l) => a + l.passes, 0);
    expect(passes).toBe(m.events.filter((e) => e.kind === "pass-complete").length);
    const tackles = r.perPlayer.reduce((a, l) => a + l.tackles, 0);
    expect(tackles).toBe(m.events.filter((e) => e.kind === "tackle").length);
    const saves = r.perPlayer.reduce((a, l) => a + l.shotsSaved, 0);
    expect(saves).toBe(m.events.filter((e) => e.kind === "save").length);
    const used = r.perPlayer.flatMap((l) => l.techniquesUsed);
    expect(used.length).toBe(m.events.filter((e) => e.kind === "technique-used").length);
    const copies = r.perPlayer.flatMap((l) => l.techcopyWitnessed);
    expect(copies.length).toBe(m.events.filter((e) => e.kind === "techcopy").length);
    const assists = r.perPlayer.reduce((a, l) => a + l.assists, 0);
    expect(assists).toBeLessThanOrEqual(goals);
    for (const l of r.perPlayer) expect(data.players[l.playerId]).toBeDefined();
  });

  it("is a pure function of the event log (same seed, same report)", () => {
    const a = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 8 });
    a.run();
    const b = new Match(BESAID_AUROCHS, LUCA_GOERS, { seed: 8 });
    b.run();
    expect(matchReport(a)).toEqual(matchReport(b));
    expect(simulateMatch(BESAID_AUROCHS, LUCA_GOERS, 8).score).toEqual(a.state.score);
  });
});
