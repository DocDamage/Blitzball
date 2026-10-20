/**
 * growth.ts - Experience, level-ups, technique slots and techcopy learning.
 *
 * applyMatchReport() is the single entry point the game calls after a match.
 * EXP values and slot-unlock odds are PLACEHOLDERS in constants.ts.
 */

import type { StatBlock } from "../data";
import { canLearnAt, EQUIP_SLOTS, hasLearned, loadGameData, statsAt, withLearned } from "../data";
import { EXP_PER_ACTION, levelForExp, MAX_LEVEL, MAX_TECH_SLOTS, TECH_SLOT_UNLOCK_CHANCE } from "./constants";
import type { MatchReport, PlayerMatchLine } from "./report";
import { winnerOf } from "./report";
import { type CareerStats, type LeaguePlayerState, type LeagueState, playerState, withRng } from "./state";

export type GrowthEvent =
  | { kind: "exp"; playerId: number; amount: number }
  | { kind: "level-up"; playerId: number; from: number; to: number; before: StatBlock; after: StatBlock }
  | { kind: "tech-slot"; playerId: number; slots: number }
  | { kind: "technique-learned"; playerId: number; techniqueId: number }
  | { kind: "techcopy-locked"; playerId: number; techniqueId: number };

/** EXP earned from one player's match line (plus the win bonus if their team won). */
export function expForLine(line: PlayerMatchLine, won: boolean): number {
  const e = EXP_PER_ACTION;
  return (
    e.appearance +
    line.goals * e.goal +
    line.assists * e.assist +
    line.passes * e.pass +
    line.tackles * e.tackle +
    line.shotsSaved * e.shotSaved +
    line.techniquesUsed.length * e.techniqueUsed +
    (won ? e.win : 0)
  );
}

/** Current stats of a player in league state. */
export function currentStats(state: LeagueState, playerId: number): StatBlock {
  return statsAt(loadGameData().players[playerId], playerState(state, playerId).level);
}

/** Number of equip slots the player can use. */
export function equipCapacity(p: LeaguePlayerState): number {
  return Math.min(EQUIP_SLOTS, p.techSlots + 1);
}

/**
 * Add experience and resolve level-ups. Each level gained rolls for an extra
 * technique slot. Returns events; stats are derived from level via statAt so
 * nothing else needs storing.
 */
export function grantExp(state: LeagueState, playerId: number, amount: number): GrowthEvent[] {
  const events: GrowthEvent[] = [];
  if (amount <= 0) return events;
  const p = playerState(state, playerId);
  const def = loadGameData().players[playerId];
  p.exp += Math.floor(amount);
  events.push({ kind: "exp", playerId, amount: Math.floor(amount) });
  const target = Math.min(MAX_LEVEL, levelForExp(p.exp));
  if (target > p.level) {
    const from = p.level;
    const before = statsAt(def, from);
    withRng(state, (rng) => {
      for (let lv = from; lv < target; lv++) {
        if (p.techSlots + 1 < MAX_TECH_SLOTS && rng.chance(TECH_SLOT_UNLOCK_CHANCE)) {
          p.techSlots++;
          events.push({ kind: "tech-slot", playerId, slots: p.techSlots + 1 });
        }
      }
    });
    p.level = target;
    events.push({ kind: "level-up", playerId, from, to: target, before, after: statsAt(def, target) });
  }
  return events;
}

/**
 * Learn a technique through techcopy. Succeeds only if the technique is in a
 * tier open at the player's level; otherwise returns a "techcopy-locked"
 * event so the UI can hint at the level needed.
 */
export function learnTechnique(state: LeagueState, playerId: number, techniqueId: number): GrowthEvent | null {
  const p = playerState(state, playerId);
  const def = loadGameData().players[playerId];
  if (techniqueId === 0 || hasLearned(p, techniqueId)) return null;
  if (!canLearnAt(def, techniqueId, p.level)) return { kind: "techcopy-locked", playerId, techniqueId };
  const masks = withLearned(p, techniqueId);
  p.learnedTechsPage1 = masks.learnedTechsPage1;
  p.learnedTechsPage2 = masks.learnedTechsPage2;
  // Auto-equip into a free slot so AI players actually use what they learn.
  const cap = equipCapacity(p);
  for (let i = 0; i < cap; i++) {
    if (p.equippedTechs[i] === 0) {
      p.equippedTechs[i] = techniqueId;
      break;
    }
  }
  return { kind: "technique-learned", playerId, techniqueId };
}

/** Equip a learned technique into a slot (0-based) within the player's capacity; 0 clears the slot. */
export function equipTechnique(state: LeagueState, playerId: number, slot: number, techniqueId: number): boolean {
  const p = playerState(state, playerId);
  if (slot < 0 || slot >= equipCapacity(p)) return false;
  if (techniqueId !== 0 && !hasLearned(p, techniqueId)) return false;
  if (techniqueId !== 0 && p.equippedTechs.includes(techniqueId)) return false;
  p.equippedTechs[slot] = techniqueId;
  return true;
}

function addStats(into: CareerStats, line: PlayerMatchLine): void {
  into.games++;
  into.goals += line.goals;
  into.assists += line.assists;
  into.passes += line.passes;
  into.tackles += line.tackles;
  into.shotsSaved += line.shotsSaved;
}

/** Apply a match report: career/season stats, experience, level-ups, techcopy. */
export function applyMatchReport(state: LeagueState, report: MatchReport): GrowthEvent[] {
  const events: GrowthEvent[] = [];
  const winner = winnerOf(report);
  for (const line of report.perPlayer) {
    const p = playerState(state, line.playerId);
    const won = winner !== null && p.team === winner;
    addStats(p.career, line);
    addStats(p.season, line);
    events.push(...grantExp(state, line.playerId, expForLine(line, won)));
    for (const tech of line.techcopyWitnessed) {
      const ev = learnTechnique(state, line.playerId, tech);
      if (ev) events.push(ev);
    }
  }
  return events;
}
