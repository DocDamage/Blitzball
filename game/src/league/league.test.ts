import { describe, expect, it } from "vitest";
import { hasLearned, loadGameData, statsAt } from "../data";
import {
  afterMatchContracts,
  aiRosterPhase,
  applyMatchReport,
  autosave,
  currentFixtures,
  EXP_PER_ACTION,
  emptyLine,
  expForLevel,
  expiringPlayers,
  freeAgentIds,
  grantExp,
  learnTechnique,
  levelForExp,
  listSaves,
  loadGame,
  type MatchReport,
  type MatchResolver,
  MemoryAdapter,
  newGame,
  playerFixture,
  playerState,
  recordResult,
  releasePlayer,
  renewContract,
  resolveCompetition,
  resolveRound,
  resolverTeam,
  saveGame,
  signFreeAgent,
  standings,
  startExhibition,
  startLeague,
  startTournament,
  statisticalResolver,
  statsLeaders,
  teamPlayerIds,
} from "./index";

const data = loadGameData();

describe("newGame", () => {
  it("matches rosters.json", () => {
    const s = newGame({ seed: 1 });
    expect(s.players).toHaveLength(60);
    expect(s.teams).toHaveLength(6);
    for (const rp of data.rosters.players) {
      const p = s.players[rp.id];
      expect(p).toMatchObject({
        level: rp.level,
        exp: rp.exp,
        techSlots: rp.techSlots,
        equippedTechs: rp.equippedTechs,
        learnedTechsPage1: rp.learnedTechsPage1,
        learnedTechsPage2: rp.learnedTechsPage2,
        contractGames: rp.contractGames,
        costPerGame: rp.costPerGame,
        team: rp.team,
        teamSlot: rp.teamSlot,
      });
    }
    for (const rt of data.rosters.teams) expect(s.teams[rt.id].players).toEqual(rt.players);
    expect(teamPlayerIds(s, 5).map((id) => data.players[id].name)).toEqual([
      "Tidus",
      "Datto",
      "Letty",
      "Jassu",
      "Botta",
      "Keepa",
    ]);
    expect(freeAgentIds(s)).toHaveLength(24);
    expect(freeAgentIds(s)).toContain(1); // Wakka starts unsigned
    expect(s.playerTeam).toBe(5);
    expect(s.competition).toBeNull();
  });

  it("levelForExp is consistent with every new-game level/exp pair", () => {
    for (const rp of data.rosters.players) {
      expect(rp.exp, `player ${rp.id}`).toBeGreaterThanOrEqual(expForLevel(rp.level));
      expect(rp.exp, `player ${rp.id}`).toBeLessThan(expForLevel(rp.level + 1));
      expect(levelForExp(rp.exp)).toBe(rp.level);
    }
  });
});

describe("league season", () => {
  it("plays 10 rounds of 3 matches, every team plays 10 games, and produces standings", () => {
    const s = newGame({ seed: 42 });
    const comp = startLeague(s);
    expect(comp.fixtures).toHaveLength(30);
    expect(comp.rounds).toBe(10);
    // Each round has every team exactly once.
    for (let r = 0; r < 10; r++) {
      const ids = comp.fixtures.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect([...ids].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    }
    // Every pair meets twice, once at home each.
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        if (a === b) continue;
        expect(comp.fixtures.filter((f) => f.home === a && f.away === b)).toHaveLength(1);
      }
    }

    const rounds = resolveCompetition(s);
    expect(rounds).toHaveLength(10);
    expect(s.competition?.finished).toBe(true);
    const table = standings(s);
    expect(table).toHaveLength(6);
    for (const row of table) {
      expect(row.played).toBe(10);
      expect(row.won + row.drawn + row.lost).toBe(10);
      expect(row.points).toBe(row.won * 3 + row.drawn);
    }
    for (let i = 1; i < table.length; i++) expect(table[i - 1].points).toBeGreaterThanOrEqual(table[i].points);
    expect(s.competition?.champion).toBe(table[0].teamId);
    expect(s.lastLeagueStandings).toEqual(table);
    expect(s.history).toHaveLength(30);
    expect(s.day).toBe(10);
    expect(statsLeaders(s, "goals", 3).length).toBeGreaterThan(0);
  });

  it("is deterministic for the same seed", () => {
    const a = newGame({ seed: 7 });
    const b = newGame({ seed: 7 });
    startLeague(a);
    startLeague(b);
    resolveCompetition(a);
    resolveCompetition(b);
    expect(a).toEqual(b);
    const c = newGame({ seed: 8 });
    startLeague(c);
    resolveCompetition(c);
    expect(c.history.map((h) => h.report.score)).not.toEqual(a.history.map((h) => h.report.score));
  });

  it("lets the player's match be recorded from an external report, then resolves the rest", () => {
    const s = newGame({ seed: 3 });
    startLeague(s);
    const f = playerFixture(s);
    expect(f).not.toBeNull();
    if (!f) return;
    const report: MatchReport = {
      homeTeam: f.home,
      awayTeam: f.away,
      score: f.home === 5 ? [3, 0] : [0, 3],
      perPlayer: [{ ...emptyLine(0), goals: 3 }],
    };
    const calls: number[] = [];
    const spyResolver: MatchResolver = (h, a, seed) => {
      calls.push(h.id, a.id);
      return statisticalResolver(h, a, seed);
    };
    recordResult(s, f.id, report);
    expect(playerFixture(s)).toBeNull();
    const result = resolveRound(s, spyResolver);
    expect(calls).not.toContain(5);
    expect(result.reports).toHaveLength(3);
    expect(standings(s)[0].teamId).toBe(5);
    expect(playerState(s, 0).season.goals).toBe(3);
  });

  it("awards league prizes to the player when they finish in the table", () => {
    const s = newGame({ seed: 11 });
    const gil = s.gil;
    startLeague(s);
    const rounds = resolveCompetition(s);
    const last = rounds[rounds.length - 1];
    expect(last.finished).toBe(true);
    expect(last.prizes.length).toBeGreaterThan(0);
    const mine = last.prizes.find((p) => p.teamId === 5);
    if (mine) {
      expect(s.gil).toBe(gil + mine.gil);
      if (mine.prizeIndex !== null) {
        expect(s.prizes.find((p) => p.prizeIndex === mine.prizeIndex)?.count).toBe(1);
        expect(mine.prizeName).toBe(data.teams.prizes[mine.prizeIndex]);
      }
    }
  });
});

describe("tournament", () => {
  it("runs three knockout rounds and crowns a champion", () => {
    const s = newGame({ seed: 99 });
    const comp = startTournament(s);
    expect(comp.teams).toHaveLength(6);
    expect(currentFixtures(s)).toHaveLength(2);
    const r0 = resolveRound(s);
    expect(r0.finished).toBe(false);
    expect(currentFixtures(s)).toHaveLength(2);
    // Seeds 1 and 2 enter in the semi-finals.
    const semis = currentFixtures(s).flatMap((f) => [f.home, f.away]);
    expect(semis).toContain(comp.teams[0]);
    expect(semis).toContain(comp.teams[1]);
    resolveRound(s);
    expect(currentFixtures(s)).toHaveLength(1);
    const final = resolveRound(s);
    expect(final.finished).toBe(true);
    expect(comp.champion).not.toBeNull();
    expect(comp.placing).toHaveLength(6);
    expect(new Set(comp.placing).size).toBe(6);
    expect(comp.fixtures).toHaveLength(5);
    expect(comp.placing[0]).toBe(comp.champion);
  });

  it("seeds from the last league standings", () => {
    const s = newGame({ seed: 5 });
    startLeague(s);
    resolveCompetition(s);
    const table = standings(s);
    const comp = startTournament(s);
    expect(comp.teams).toEqual(table.map((r) => r.teamId));
  });

  it("refuses to start while another competition is running", () => {
    const s = newGame({ seed: 5 });
    startLeague(s);
    expect(() => startTournament(s)).toThrow(/in progress/);
  });
});

describe("exhibition", () => {
  it("plays one match and pays gil for a win", () => {
    const s = newGame({ seed: 21 });
    startExhibition(s, 0);
    const gil = s.gil;
    const f = playerFixture(s);
    expect(f).toMatchObject({ home: 5, away: 0 });
    if (!f) return;
    recordResult(s, f.id, { homeTeam: 5, awayTeam: 0, score: [2, 1], perPlayer: [] });
    const r = resolveRound(s);
    expect(r.finished).toBe(true);
    expect(s.competition?.champion).toBe(5);
    expect(s.gil).toBeGreaterThan(gil);
  });
});

describe("contracts", () => {
  it("signs a free agent and charges gil", () => {
    const s = newGame({ seed: 1 });
    const wakka = playerState(s, 1);
    expect(wakka.team).toBeNull();
    const res = signFreeAgent(s, 5, 1, 10);
    expect(res).toEqual({ ok: true, cost: 10 });
    expect(s.gil).toBe(990);
    expect(wakka).toMatchObject({ team: 5, teamSlot: 6, contractGames: 10 });
    expect(s.teams[5].players[6]).toBe(1);
    expect(signFreeAgent(s, 5, 1, 5).reason).toBe("not-free-agent");
    // Rin (37) costs 100 per game; 1000 games is not allowed, 100 games is too expensive.
    expect(signFreeAgent(s, 5, 37, 1000).reason).toBe("bad-games");
    expect(signFreeAgent(s, 5, 37, 100).reason).toBe("no-gil");
    signFreeAgent(s, 5, 44, 1);
    expect(signFreeAgent(s, 5, 45, 1).reason).toBe("no-slot");
  });

  it("counts down after matches, expires, and permanent contracts never expire", () => {
    const s = newGame({ seed: 1 });
    signFreeAgent(s, 5, 1, 2); // Wakka, 2 games
    expect(expiringPlayers(s, 2)).toContain(1);
    afterMatchContracts(s, [5]);
    expect(playerState(s, 1).contractGames).toBe(1);
    const events = afterMatchContracts(s, [5]);
    expect(events).toContainEqual({ kind: "expired", playerId: 1, teamId: 5 });
    expect(playerState(s, 1).team).toBeNull();
    expect(freeAgentIds(s)).toContain(1);
    expect(s.teams[5].players[6]).toBeNull();
    expect(playerState(s, 0).contractGames).toBe(255);
    expect(releasePlayer(s, 0)).toBe(false);
  });

  it("renews and releases", () => {
    const s = newGame({ seed: 1 });
    const datto = playerState(s, 2);
    const before = datto.contractGames;
    expect(renewContract(s, 2, 5)).toEqual({ ok: true, cost: 150 });
    expect(datto.contractGames).toBe(before + 5);
    expect(releasePlayer(s, 2)).toBe(true);
    expect(datto.team).toBeNull();
    // Roster compacts so the starters stay in slots 0..5.
    expect(s.teams[5].players.slice(0, 5)).toEqual([0, 3, 4, 5, 6]);
    expect(playerState(s, 6).teamSlot).toBe(4);
  });

  it("AI teams re-sign or replace expired players and may poach free agents", () => {
    const s = newGame({ seed: 123 });
    // Run the Goers' contracts down to zero.
    for (let i = 0; i < 30; i++) afterMatchContracts(s, [0]);
    const moves = aiRosterPhase(s);
    expect(teamPlayerIds(s, 0).length).toBeGreaterThanOrEqual(6);
    const seenKinds = new Set(moves.map((m) => m.kind));
    expect(moves.length).toBeGreaterThan(0);
    expect([...seenKinds].every((k) => k === "signed" || k === "poached")).toBe(true);
    // Deterministic for the same seed.
    const t = newGame({ seed: 123 });
    for (let i = 0; i < 30; i++) afterMatchContracts(t, [0]);
    expect(aiRosterPhase(t)).toEqual(moves);
  });
});

describe("growth", () => {
  it("experience leads to level-ups and stats grow", () => {
    const s = newGame({ seed: 1 });
    const jassu = playerState(s, 4);
    expect(jassu.level).toBe(1);
    const before = statsAt(data.players[4], 1);
    const events = grantExp(s, 4, expForLevel(10));
    expect(jassu.level).toBe(10);
    const lv = events.find((e) => e.kind === "level-up");
    expect(lv).toMatchObject({ from: 1, to: 10 });
    const after = statsAt(data.players[4], 10);
    expect(after.HP).toBeGreaterThan(before.HP);
    expect(after.SH).toBeGreaterThanOrEqual(before.SH);
    grantExp(s, 4, 10 ** 9);
    expect(jassu.level).toBe(99);
    expect(statsAt(data.players[4], 99)).toEqual(data.players[4].statsLv99);
  });

  it("applyMatchReport grants EXP per action with a win bonus, and learns witnessed techniques in open tiers", () => {
    const s = newGame({ seed: 1 });
    const tidus = playerState(s, 0);
    const exp0 = tidus.exp;
    const report: MatchReport = {
      homeTeam: 5,
      awayTeam: 0,
      score: [1, 0],
      perPlayer: [
        { ...emptyLine(0), goals: 1, passes: 2, techcopyWitnessed: [5, 6] }, // Venom Shot (tier 1), Venom Shot 2 (tier 2, lv 26)
      ],
    };
    const events = applyMatchReport(s, report);
    const e = EXP_PER_ACTION;
    expect(tidus.exp - exp0).toBe(e.appearance + e.goal + 2 * e.pass + e.win);
    expect(tidus.career.goals).toBe(1);
    expect(hasLearned(tidus, 5)).toBe(true);
    expect(hasLearned(tidus, 6)).toBe(false);
    expect(events).toContainEqual({ kind: "technique-learned", playerId: 0, techniqueId: 5 });
    expect(events).toContainEqual({ kind: "techcopy-locked", playerId: 0, techniqueId: 6 });
    // Once tier 2 opens the technique can be learned.
    grantExp(s, 0, expForLevel(26));
    expect(learnTechnique(s, 0, 6)).toEqual({ kind: "technique-learned", playerId: 0, techniqueId: 6 });
  });

  it("a full season levels players up", () => {
    const s = newGame({ seed: 77 });
    startLeague(s);
    resolveCompetition(s);
    const starters = teamPlayerIds(s, 5);
    expect(starters.some((id) => playerState(s, id).level > data.rosters.players[id].level)).toBe(true);
    const snap = resolverTeam(s, 5);
    expect(snap.starters[0].stats).toEqual(statsAt(data.players[snap.starters[0].id], snap.starters[0].level));
  });
});

describe("save", () => {
  it("round-trips through the memory adapter, with slots and autosave", async () => {
    const adapter = new MemoryAdapter();
    const s = newGame({ seed: 9 });
    startLeague(s);
    resolveRound(s);
    await saveGame(adapter, 0, s, "after round 1", 1000);
    await autosave(adapter, s);
    const loaded = await loadGame(adapter, 0);
    expect(loaded).toEqual(s);
    expect(loaded).not.toBe(s);
    expect(await loadGame(adapter, 1)).toBeNull();
    const list = await listSaves(adapter);
    expect(list.map((l) => l.slot)).toEqual([0, "auto"]);
    expect(list[0]).toMatchObject({ label: "after round 1", savedAt: 1000, season: 1, day: 1, playerTeam: 5 });
    // The loaded state keeps playing identically.
    resolveCompetition(s);
    if (loaded) {
      resolveCompetition(loaded);
      expect(loaded).toEqual(s);
    }
  });

  it("rejects unknown schema versions", async () => {
    const adapter = new MemoryAdapter();
    await adapter.set("save:1", JSON.stringify({ schema: 999, state: {} }));
    await expect(loadGame(adapter, 1)).rejects.toThrow(/newer/);
    await adapter.set("save:2", "not json");
    await expect(loadGame(adapter, 2)).rejects.toThrow(/JSON/);
    expect(await listSaves(adapter)).toEqual([]);
  });
});
