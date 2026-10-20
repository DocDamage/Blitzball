/**
 * Headless "season via instant simulation": the same flow the hub drives,
 * without DOM. Uses the match runtime's simulateInstant when the module
 * exists, otherwise the sim-backed resolver (sim/ Match headless), which is
 * what the shell falls back to as well.
 */
import { describe, expect, it } from "vitest";
import { loadGameData } from "../data";
import {
  aiRosterPhase,
  autosave,
  freeAgentIds,
  listSaves,
  loadGame,
  MemoryAdapter,
  newGame,
  playerFixture,
  recordResult,
  resolveRound,
  resolverTeam,
  signFreeAgent,
  standings,
  startLeague,
  startTournament,
  statsLeaders,
  teamPlayerIds,
} from "../league";
import { buildTeamDef, makeResolver, simResolver, stripReport } from "./matchFlow";
import { loadRuntime } from "./runtime";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

const FAST: Settings = { ...DEFAULT_SETTINGS, halfMinutes: 1, overtime: false };

describe("season via instant simulation", () => {
  it("builds TeamDefs from the live league state", () => {
    const state = newGame({ seed: 7, playerTeam: 5 });
    const data = loadGameData();
    const before = buildTeamDef(state, 5);
    expect(before.players.length).toBe(teamPlayerIds(state, 5).length);
    expect(before.players[0].name).toBe("Tidus");
    expect(before.dataId).toBe(5);
    expect(before.marks).toBeDefined();
    // Sign a free agent: the next TeamDef must include them.
    const fa = freeAgentIds(state)[0];
    const res = signFreeAgent(state, 5, fa, 3);
    expect(res.ok).toBe(true);
    const after = buildTeamDef(state, 5);
    expect(after.players.some((p) => p.dataId === fa)).toBe(true);
    expect(after.players.find((p) => p.dataId === fa)?.name).toBe(data.players[fa].name);
  });

  it("plays a whole league and a tournament with the simulation, saving along the way", async () => {
    const runtime = await loadRuntime();
    const state = newGame({ seed: 12345, playerTeam: 5 });
    const resolver = makeResolver(state, FAST, runtime);
    const adapter = new MemoryAdapter();

    startLeague(state);
    let rounds = 0;
    while (state.competition && !state.competition.finished) {
      // The player's fixture goes through the same path as the hub's "Simulate".
      aiRosterPhase(state); // the hub does this before building the player's opponent
      // Like a player would: refill the squad from the cheapest free agents when contracts run out.
      while (teamPlayerIds(state, 5).length < 6) {
        const cheapest = freeAgentIds(state).sort(
          (a, b) => state.players[a].costPerGame - state.players[b].costPerGame,
        )[0];
        if (cheapest === undefined || !signFreeAgent(state, 5, cheapest, 5).ok) break;
      }
      const fx = playerFixture(state);
      if (fx) {
        const report = stripReport(resolver(resolverTeam(state, fx.home), resolverTeam(state, fx.away), fx.seed));
        expect(report.homeTeam).toBe(fx.home);
        expect(report.awayTeam).toBe(fx.away);
        if (teamPlayerIds(state, fx.home).length >= 6 && teamPlayerIds(state, fx.away).length >= 6) {
          expect(report.perPlayer.length).toBeGreaterThanOrEqual(12);
        }
        recordResult(state, fx.id, report);
      }
      const result = resolveRound(state, resolver);
      expect(result.reports.length).toBe(3);
      await autosave(adapter, state);
      rounds++;
      expect(rounds).toBeLessThanOrEqual(10);
    }
    expect(rounds).toBe(10);
    expect(state.competition?.finished).toBe(true);
    expect(state.competition?.champion).not.toBeNull();
    const table = standings(state);
    expect(table.length).toBe(6);
    for (const row of table) expect(row.played).toBe(10);
    expect(state.history.length).toBe(30);
    expect(state.day).toBe(10);
    expect(state.lastLeagueStandings).not.toBeNull();

    // Somebody must have scored or passed: growth flows from the simulation.
    expect(statsLeaders(state, "passes", 1).length).toBe(1);
    const me = teamPlayerIds(state, 5);
    expect(me.some((pid) => state.players[pid].career.games > 0)).toBe(true);

    // Autosave round-trips.
    const saves = await listSaves(adapter);
    expect(saves.map((s) => s.slot)).toEqual(["auto"]);
    const loaded = await loadGame(adapter, "auto");
    expect(loaded).toEqual(state);

    // Tournament seeded from the table.
    startTournament(state);
    expect(state.competition?.teams[0]).toBe(table[0].teamId);
    while (state.competition && !state.competition.finished) resolveRound(state, resolver);
    expect(state.competition?.placing.length).toBe(6);
    expect(state.competition?.champion).not.toBeNull();
  }, 60_000);

  it("is deterministic for a given seed", () => {
    const run = () => {
      const state = newGame({ seed: 99, playerTeam: 0 });
      const resolver = simResolver(state, FAST);
      startLeague(state);
      resolveRound(state, resolver);
      resolveRound(state, resolver);
      return state.history.map((h) => h.report.score.join("-")).join(",");
    };
    expect(run()).toBe(run());
  });
});
