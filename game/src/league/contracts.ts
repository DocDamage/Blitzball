/**
 * contracts.ts - Signing, countdown, expiry and AI roster management.
 *
 * Contracts are counted in games, as in FFX: a player signed for N games at
 * costPerGame costs N * costPerGame up front and leaves the team when the
 * count reaches 0. Tidus (255) is permanent. AI teams re-sign or poach free
 * agents deterministically from the state's RNG.
 */

import { loadGameData, statsAt } from "../data";
import {
  AI_CONTRACT_GAMES,
  AI_POACH_CHANCE,
  AI_RESIGN_CHANCE,
  PERMANENT_CONTRACT,
  ROSTER_SIZE,
  STARTERS,
} from "./constants";
import type { LeagueRng } from "./rng";
import {
  freeAgentIds,
  type LeaguePlayerState,
  type LeagueState,
  playerState,
  teamPlayerIds,
  teamState,
  withRng,
} from "./state";

export interface SignResult {
  ok: boolean;
  reason?: "not-free-agent" | "no-slot" | "no-gil" | "bad-games";
  cost: number;
}

export function contractCost(player: LeaguePlayerState, games: number): number {
  return games * player.costPerGame;
}

export function isPermanent(player: LeaguePlayerState): boolean {
  return player.contractGames >= PERMANENT_CONTRACT;
}

function firstEmptySlot(state: LeagueState, teamId: number): number {
  return teamState(state, teamId).players.indexOf(null);
}

/**
 * Sign a free agent to a team for `games` games. The player's team pays from
 * state.gil; AI teams pay from their own (unlimited for simplicity) budget.
 */
export function signFreeAgent(state: LeagueState, teamId: number, playerId: number, games: number): SignResult {
  const p = playerState(state, playerId);
  const cost = contractCost(p, games);
  if (!Number.isInteger(games) || games < 1 || games >= PERMANENT_CONTRACT)
    return { ok: false, reason: "bad-games", cost };
  if (p.team !== null) return { ok: false, reason: "not-free-agent", cost };
  const slot = firstEmptySlot(state, teamId);
  if (slot < 0) return { ok: false, reason: "no-slot", cost };
  if (teamId === state.playerTeam) {
    if (state.gil < cost) return { ok: false, reason: "no-gil", cost };
    state.gil -= cost;
  }
  teamState(state, teamId).players[slot] = playerId;
  p.team = teamId;
  p.teamSlot = slot;
  p.contractGames = games;
  return { ok: true, cost };
}

/** Extend a contracted player's contract by `games` (paid like a signing). */
export function renewContract(state: LeagueState, playerId: number, games: number): SignResult {
  const p = playerState(state, playerId);
  const cost = contractCost(p, games);
  if (p.team === null) return { ok: false, reason: "not-free-agent", cost };
  if (!Number.isInteger(games) || games < 1 || p.contractGames + games >= PERMANENT_CONTRACT) {
    return { ok: false, reason: "bad-games", cost };
  }
  if (p.team === state.playerTeam) {
    if (state.gil < cost) return { ok: false, reason: "no-gil", cost };
    state.gil -= cost;
  }
  p.contractGames += games;
  return { ok: true, cost };
}

/** Remove a player from their team; they become a free agent. Permanent players cannot be released. */
export function releasePlayer(state: LeagueState, playerId: number): boolean {
  const p = playerState(state, playerId);
  if (p.team === null || isPermanent(p)) return false;
  const team = teamState(state, p.team);
  const idx = team.players.indexOf(playerId);
  if (idx >= 0) team.players[idx] = null;
  p.team = null;
  p.teamSlot = null;
  p.contractGames = 0;
  compactRoster(state, team.id);
  return true;
}

/** Move a player between two slots of their team (starter <-> bench, or reorder). */
export function swapSlots(state: LeagueState, teamId: number, slotA: number, slotB: number): void {
  const team = teamState(state, teamId);
  if (slotA < 0 || slotB < 0 || slotA >= ROSTER_SIZE || slotB >= ROSTER_SIZE) throw new RangeError("bad slot");
  const a = team.players[slotA];
  const b = team.players[slotB];
  team.players[slotA] = b;
  team.players[slotB] = a;
  if (a !== null) playerState(state, a).teamSlot = slotB;
  if (b !== null) playerState(state, b).teamSlot = slotA;
}

/** Shift players forward so the starting six are the first six non-empty slots. */
export function compactRoster(state: LeagueState, teamId: number): void {
  const team = teamState(state, teamId);
  const ids = team.players.filter((p): p is number => p !== null);
  team.players = ids.concat(new Array(ROSTER_SIZE - ids.length).fill(null));
  team.players.forEach((id, i) => {
    if (id !== null) playerState(state, id).teamSlot = i;
  });
}

export interface ContractEvent {
  kind: "expired" | "resigned" | "signed" | "poached";
  playerId: number;
  teamId: number;
  games?: number;
}

/**
 * Count down the contracts of everyone on the two teams that just played.
 * Players reaching 0 on the player's team are released to the free agent
 * pool (call renewContract before the match to keep them). AI teams get a
 * chance to re-sign. Returns the events for the UI.
 */
export function afterMatchContracts(state: LeagueState, teamIds: number[]): ContractEvent[] {
  const events: ContractEvent[] = [];
  withRng(state, (rng) => {
    for (const teamId of teamIds) {
      for (const pid of teamPlayerIds(state, teamId)) {
        const p = playerState(state, pid);
        if (isPermanent(p)) continue;
        p.contractGames = Math.max(0, p.contractGames - 1);
        if (p.contractGames > 0) continue;
        if (teamId !== state.playerTeam && rng.chance(AI_RESIGN_CHANCE)) {
          const games = rng.int(AI_CONTRACT_GAMES.min, AI_CONTRACT_GAMES.max);
          p.contractGames = games;
          events.push({ kind: "resigned", playerId: pid, teamId, games });
        } else {
          releasePlayer(state, pid);
          events.push({ kind: "expired", playerId: pid, teamId });
        }
      }
    }
  });
  return events;
}

/** Rough strength used by AI teams when choosing whom to sign. */
export function playerRating(state: LeagueState, playerId: number): number {
  const def = loadGameData().players[playerId];
  const s = statsAt(def, playerState(state, playerId).level);
  return s.SH + s.PA + s.EN + s.AT + s.BL + s.CA + s.SP / 4 + s.HP / 100;
}

function aiSign(
  state: LeagueState,
  rng: LeagueRng,
  teamId: number,
  pool: number[],
  kind: "signed" | "poached",
): ContractEvent | null {
  if (pool.length === 0) return null;
  // Prefer strong players, but keep some randomness: pick from the top three by rating.
  const ranked = pool.slice().sort((a, b) => playerRating(state, b) - playerRating(state, a));
  const pid = rng.pick(ranked.slice(0, 3));
  const games = rng.int(AI_CONTRACT_GAMES.min, AI_CONTRACT_GAMES.max);
  const res = signFreeAgent(state, teamId, pid, games);
  if (!res.ok) return null;
  return { kind, playerId: pid, teamId, games };
}

/**
 * AI roster phase: every AI team fills missing starters from the free agent
 * pool, and may poach one extra free agent for the bench. Deterministic given
 * state.rngState. Call once per round before fixtures are played.
 */
export function aiRosterPhase(state: LeagueState): ContractEvent[] {
  const events: ContractEvent[] = [];
  withRng(state, (rng) => {
    const order = rng.shuffle(state.teams.map((t) => t.id).filter((id) => id !== state.playerTeam));
    for (const teamId of order) {
      compactRoster(state, teamId);
      // Fill starters first (mandatory).
      while (teamPlayerIds(state, teamId).length < STARTERS) {
        const ev = aiSign(state, rng, teamId, freeAgentIds(state), "signed");
        if (!ev) break;
        events.push(ev);
      }
      // Optional poach onto the bench.
      if (teamPlayerIds(state, teamId).length < ROSTER_SIZE && rng.chance(AI_POACH_CHANCE)) {
        const ev = aiSign(state, rng, teamId, freeAgentIds(state), "poached");
        if (ev) events.push(ev);
      }
    }
  });
  return events;
}

/** Players on the player's team whose contract ends after `games` more games. */
export function expiringPlayers(state: LeagueState, games = 1): number[] {
  return teamPlayerIds(state, state.playerTeam).filter((pid) => {
    const p = playerState(state, pid);
    return !isPermanent(p) && p.contractGames <= games;
  });
}
