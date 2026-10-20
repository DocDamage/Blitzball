import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { BESAID_AUROCHS, LUCA_GOERS, simulateMatch } from "./index";

it("tuning report", () => {
  const lines: string[] = [];
  const totals: number[] = [];
  const t0 = Date.now();
  for (let seed = 1; seed <= 20; seed++) {
    const r = simulateMatch(BESAID_AUROCHS, LUCA_GOERS, seed);
    const t = r.stats.teams;
    totals.push(r.score[0] + r.score[1]);
    lines.push(
      `seed ${seed}: ${r.score[0]}-${r.score[1]} shots ${t[0].shots}/${t[1].shots} onT ${t[0].shotsOnTarget}/${t[1].shotsOnTarget} saves ${t[0].saves}/${t[1].saves} pass ${t[0].passesCompleted}/${t[0].passes} ${t[1].passesCompleted}/${t[1].passes} int ${t[0].interceptions}/${t[1].interceptions} tk ${t[0].tacklesWon}/${t[0].tackles} ${t[1].tacklesWon}/${t[1].tackles} tech ${t[0].techniques}/${t[1].techniques} copy ${t[0].techcopies}/${t[1].techcopies} poss ${t[0].possession.toFixed(2)} ev ${r.events.length}`,
    );
  }
  lines.push(`totals: ${totals.join(",")} mean ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(2)} ms/match ${((Date.now() - t0) / 20).toFixed(0)}`);
  writeFileSync(
    "C:/Users/dferr/AppData/Local/Temp/claude/F--dev-FFX-Project/06ab29f7-d527-4127-8f7a-2d4a2f77f9d0/scratchpad/tune.txt",
    lines.join("\n"),
  );
});
