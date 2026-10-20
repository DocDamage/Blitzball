/**
 * balance.test.ts - headless batch measurement for tuning. Skipped unless BALANCE=1.
 *   BALANCE=1 npx vitest run src/sim/balance.test.ts
 * Prints per matchup: goals (home/away), shots, on-target %, pass completion %, tackle win %, possession.
 */
import { describe, it } from "vitest";
import { loadGameData } from "../data";
import { simulateMatch } from "./index";
import { teamDefFromRoster } from "./teamFromData";

declare const process: { env: Record<string, string | undefined> };
const RUN = !!process.env.BALANCE;
const SEEDS = Number(process.env.SEEDS ?? 8);
const LEVEL = process.env.LEVEL ? Number(process.env.LEVEL) : undefined;
const HALF = Number(process.env.HALF ?? 300);

describe.skipIf(!RUN)("balance batch", () => {
  it("prints the table", () => {
    const data = loadGameData();
    const teams = [0, 1, 2, 3, 4, 5].map((t) => {
      const levels: Record<number, number> = {};
      if (LEVEL !== undefined) for (const p of data.rosters.teams[t].players) if (p !== null) levels[p] = LEVEL;
      return teamDefFromRoster(data, t, { levels });
    });
    const rows: string[] = [];
    const agg = {
      goals: 0,
      matches: 0,
      shots: 0,
      onTarget: 0,
      passes: 0,
      passOk: 0,
      tackles: 0,
      tacklesWon: 0,
      zeroZero: 0,
    };
    for (let h = 0; h < 6; h++) {
      for (let a = 0; a < 6; a++) {
        if (h === a) continue;
        let gh = 0,
          ga = 0,
          sh = 0,
          sa = 0,
          ot = 0,
          pc = 0,
          pt = 0,
          tw = 0,
          tt = 0,
          pos = 0;
        for (let s = 1; s <= SEEDS; s++) {
          const r = simulateMatch(teams[h], teams[a], s * 7919 + h * 31 + a, { halfSeconds: HALF });
          gh += r.score[0];
          ga += r.score[1];
          const [th, ta] = r.stats.teams;
          sh += th.shots;
          sa += ta.shots;
          ot += th.shotsOnTarget + ta.shotsOnTarget;
          pc += th.passesCompleted + ta.passesCompleted;
          pt += th.passes + ta.passes;
          tw += th.tacklesWon + ta.tacklesWon;
          tt += th.tackles + ta.tackles;
          pos += th.possession;
          if (r.score[0] + r.score[1] === 0) agg.zeroZero++;
        }
        const n = SEEDS;
        rows.push(
          `${teams[h].name.padEnd(16)} ${teams[a].name.padEnd(16)} goals ${(gh / n).toFixed(2)}-${(ga / n).toFixed(2)}  shots ${(sh / n).toFixed(1)}-${(sa / n).toFixed(1)}  onT ${((100 * ot) / Math.max(1, sh + sa)).toFixed(0)}%  pass ${((100 * pc) / Math.max(1, pt)).toFixed(0)}%  tackle ${((100 * tw) / Math.max(1, tt)).toFixed(0)}%  poss ${((100 * pos) / n).toFixed(0)}%`,
        );
        agg.goals += gh + ga;
        agg.matches += n;
        agg.shots += sh + sa;
        agg.onTarget += ot;
        agg.passes += pt;
        agg.passOk += pc;
        agg.tackles += tt;
        agg.tacklesWon += tw;
      }
    }
    console.log(rows.join("\n"));
    console.log(
      `TOTAL matches ${agg.matches}: goals/match ${(agg.goals / agg.matches).toFixed(2)}, shots/match ${(agg.shots / agg.matches).toFixed(1)}, on target ${((100 * agg.onTarget) / Math.max(1, agg.shots)).toFixed(0)}%, pass ${((100 * agg.passOk) / Math.max(1, agg.passes)).toFixed(0)}%, tackle ${((100 * agg.tacklesWon) / Math.max(1, agg.tackles)).toFixed(0)}%, 0-0 ${agg.zeroZero}`,
    );
  });
});
