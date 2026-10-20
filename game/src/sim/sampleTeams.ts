/**
 * sampleTeams.ts - Two placeholder rosters with FFX-like level-1 numbers.
 *
 * Besaid Aurochs (balanced, standard formation) and Luca Goers (aggressive).
 * Order matters: players[0..5] are LF, RF, MF, LD, RD, GK (see ROLE_ORDER).
 * Real rosters are loaded later from data/json by game/src/data/.
 */

import type { PlayerDef, Stats, TeamDef } from "./types";

function p(id: string, name: string, teamId: string, stats: Stats, techniques: string[] = []): PlayerDef {
  return { id, name, teamId, stats, level: 1, techniques };
}

export const BESAID_AUROCHS: TeamDef = {
  id: "aurochs",
  name: "Besaid Aurochs",
  formation: "standard",
  personality: "balanced",
  players: [
    p("tidus", "Tidus", "aurochs", { hp: 90, en: 5, at: 3, pa: 5, bl: 5, sh: 11, ca: 1, sp: 60 }, ["sphere-shot"]),
    p("datto", "Datto", "aurochs", { hp: 95, en: 6, at: 3, pa: 6, bl: 4, sh: 8, ca: 1, sp: 62 }, ["venom-pass"]),
    p("letty", "Letty", "aurochs", { hp: 100, en: 6, at: 4, pa: 7, bl: 6, sh: 5, ca: 1, sp: 52 }),
    p("jassu", "Jassu", "aurochs", { hp: 110, en: 7, at: 6, pa: 5, bl: 7, sh: 3, ca: 1, sp: 55 }, ["nap-tackle"]),
    p("botta", "Botta", "aurochs", { hp: 105, en: 6, at: 6, pa: 4, bl: 7, sh: 3, ca: 1, sp: 50 }, ["venom-tackle"]),
    p("keepa", "Keepa", "aurochs", { hp: 180, en: 4, at: 2, pa: 4, bl: 4, sh: 1, ca: 7, sp: 40 }),
  ],
};

export const LUCA_GOERS: TeamDef = {
  id: "goers",
  name: "Luca Goers",
  formation: "attack",
  personality: "aggressive",
  players: [
    p("bickson", "Bickson", "goers", { hp: 120, en: 6, at: 4, pa: 6, bl: 5, sh: 18, ca: 1, sp: 60 }, ["sphere-shot", "wither-shot"]),
    p("abus", "Abus", "goers", { hp: 110, en: 6, at: 4, pa: 6, bl: 5, sh: 14, ca: 1, sp: 58 }, ["venom-shot"]),
    p("graav", "Graav", "goers", { hp: 130, en: 6, at: 5, pa: 7, bl: 6, sh: 7, ca: 1, sp: 56 }, ["nap-pass"]),
    p("doram", "Doram", "goers", { hp: 150, en: 7, at: 7, pa: 5, bl: 7, sh: 3, ca: 1, sp: 54 }, ["venom-tackle"]),
    p("balgerda", "Balgerda", "goers", { hp: 140, en: 7, at: 7, pa: 5, bl: 7, sh: 3, ca: 1, sp: 52 }, ["wither-tackle"]),
    p("raudy", "Raudy", "goers", { hp: 200, en: 5, at: 3, pa: 5, bl: 5, sh: 1, ca: 9, sp: 45 }, ["super-goalie"]),
  ],
};

export const SAMPLE_TEAMS: TeamDef[] = [BESAID_AUROCHS, LUCA_GOERS];
