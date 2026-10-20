/**
 * sampleTeams.ts - The two default rosters, built from the real extracted
 * data at their new-game state: Besaid Aurochs (team 5) vs Luca Goers (team 0).
 * Player ids are name slugs ("tidus", "bickson"); see teamFromData.ts.
 */

import { loadGameData } from "../data";
import { teamDefFromRoster } from "./teamFromData";
import type { TeamDef } from "./types";

export const AUROCHS_TEAM_ID = 5;
export const GOERS_TEAM_ID = 0;

export const BESAID_AUROCHS: TeamDef = teamDefFromRoster(loadGameData(), AUROCHS_TEAM_ID, {
  formation: "standard",
  personality: "balanced",
});

export const LUCA_GOERS: TeamDef = teamDefFromRoster(loadGameData(), GOERS_TEAM_ID, {
  formation: "attack",
  personality: "aggressive",
});

export const SAMPLE_TEAMS: TeamDef[] = [BESAID_AUROCHS, LUCA_GOERS];
