/**
 * resolver.ts - MatchResolver: how the league plays a match it does not show.
 *
 * AI-vs-AI fixtures (and the player's fixture when auto-simmed) are resolved
 * through this interface. The real game injects a resolver backed by sim/;
 * the default here is a small deterministic statistical model built from
 * team stat totals, so league/ is fully testable without the simulation.
 */

import { loadGameData, type StatBlock, statsAt } from "../data";
import { STARTERS } from "./constants";
import { emptyLine, type MatchReport, type PlayerMatchLine } from "./report";
import { LeagueRng } from "./rng";
import type { LeagueState } from "./state";
import { playerState, teamPlayerIds, teamState } from "./state";

export interface ResolverPlayer {
  id: number;
  name: string;
  level: number;
  stats: StatBlock;
  /** Equipped technique ids (0 omitted). */
  techniques: number[];
}

export interface ResolverTeam {
  id: number;
  name: string;
  formation: number;
  /** Starters (up to six, slots 0..5) followed by bench. */
  players: ResolverPlayer[];
  starters: ResolverPlayer[];
}

export type MatchResolver = (home: ResolverTeam, away: ResolverTeam, seed: number) => MatchReport;

/** Snapshot a team from league state in the form resolvers consume. */
export function resolverTeam(state: LeagueState, teamId: number): ResolverTeam {
  const data = loadGameData();
  const team = teamState(state, teamId);
  const players = teamPlayerIds(state, teamId).map((pid): ResolverPlayer => {
    const p = playerState(state, pid);
    return {
      id: pid,
      name: data.players[pid].name,
      level: p.level,
      stats: statsAt(data.players[pid], p.level),
      techniques: p.equippedTechs.filter((t) => t !== 0),
    };
  });
  return { id: teamId, name: team.name, formation: team.formation, players, starters: players.slice(0, STARTERS) };
}

/** Pick an index weighted by `weights` (all >= 0). */
function weightedIndex(rng: LeagueRng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.int(0, weights.length - 1);
  let r = rng.float() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Default resolver. Each team gets a number of attacks proportional to its
 * midfield (EN + PA); each attack is a shot contest between a weighted random
 * attacker's SH and the keeper's CA plus a share of the defenders' BL.
 * The seed alone determines the outcome.
 */
export const statisticalResolver: MatchResolver = (home, away, seed) => {
  const rng = new LeagueRng(seed);
  const lines = new Map<number, PlayerMatchLine>();
  for (const p of [...home.players, ...away.players]) lines.set(p.id, emptyLine(p.id));
  const line = (id: number): PlayerMatchLine => {
    const l = lines.get(id);
    if (!l) throw new Error(`no line for ${id}`);
    return l;
  };

  const score: [number, number] = [0, 0];
  const sides: [ResolverTeam, ResolverTeam] = [home, away];
  const sum = (t: ResolverTeam, f: (s: StatBlock) => number) => t.starters.reduce((a, p) => a + f(p.stats), 0);

  const midfield = sides.map((t) =>
    Math.max(
      1,
      sum(t, (s) => s.EN + s.PA),
    ),
  );
  const totalMid = midfield[0] + midfield[1];
  // 12 to 20 attacks per match, split by midfield strength (home bias of 5%).
  const attacks = rng.int(12, 20);
  for (let n = 0; n < attacks; n++) {
    const homeShare = (midfield[0] / totalMid) * 1.05;
    const att = rng.chance(homeShare) ? 0 : 1;
    const atkTeam = sides[att];
    const defTeam = sides[1 - att];
    if (atkTeam.starters.length === 0 || defTeam.starters.length === 0) continue;

    // Passing phase: one or two passes credited to midfield-ish players.
    const passes = rng.int(1, 3);
    for (let i = 0; i < passes; i++) {
      const passer =
        atkTeam.starters[
          weightedIndex(
            rng,
            atkTeam.starters.map((p) => p.stats.PA + 1),
          )
        ];
      line(passer.id).passes++;
      // A tackle attempt from a defender: AT vs EN.
      const tackler =
        defTeam.starters[
          weightedIndex(
            rng,
            defTeam.starters.map((p) => p.stats.AT + 1),
          )
        ];
      const tackleRoll = rng.float() * (tackler.stats.AT + passer.stats.EN + 1);
      if (tackleRoll < tackler.stats.AT * 0.7) {
        line(tackler.id).tackles++;
        break;
      }
      if (i === passes - 1) {
        // Shot phase.
        const outfield = atkTeam.starters.filter((p) => p !== atkTeam.starters[5]);
        const shooters = outfield.length > 0 ? outfield : atkTeam.starters;
        const shooter =
          shooters[
            weightedIndex(
              rng,
              shooters.map((p) => p.stats.SH + 1),
            )
          ];
        const keeper = defTeam.starters[5] ?? defTeam.starters[defTeam.starters.length - 1];
        const blockers = defTeam.starters.slice(3, 5);
        const block = blockers.reduce((a, p) => a + p.stats.BL, 0) * 0.3;
        const shot = shooter.stats.SH * (0.6 + rng.float() * 0.8) + (shooter.techniques.length > 0 ? 2 : 0);
        const save = keeper.stats.CA * (0.6 + rng.float() * 0.8) + block;
        if (shot > save) {
          score[att]++;
          line(shooter.id).goals++;
          if (passer.id !== shooter.id) line(passer.id).assists++;
        } else {
          line(keeper.id).shotsSaved++;
        }
        if (shooter.techniques.length > 0 && rng.chance(0.3)) {
          const used = rng.pick(shooter.techniques);
          line(shooter.id).techniquesUsed.push(used);
          // Witnesses on both teams get a techcopy roll.
          for (const w of [...atkTeam.starters, ...defTeam.starters]) {
            if (w.id !== shooter.id && rng.chance(0.1)) line(w.id).techcopyWitnessed.push(used);
          }
        }
      }
    }
  }

  return {
    homeTeam: home.id,
    awayTeam: away.id,
    score,
    perPlayer: [...home.starters, ...away.starters].map((p) => line(p.id)),
  };
};
