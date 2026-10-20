/**
 * ai.ts - Utility-based per-player match AI plus team personality/difficulty.
 *
 * Each AI player re-evaluates its intent every `reactionTicks` ticks (staggered
 * per player) and keeps the previous intent in between, which models reaction
 * delay. Utilities for shooting, passing, dribbling and tackling are computed
 * from the live match geometry and the FFX stat contests, then perturbed by
 * `noise` taken from the match Rng, so everything stays deterministic per seed.
 * Team personalities (plan 5.5) scale the utilities: aggressive (Goers),
 * technical (Psyches), physical (Fangs), balanced.
 */

import {
  AI_LANE_CLEAR_DIST,
  AI_MARK_OFFSET,
  AI_MIN_HOLD_TICKS,
  AI_PRESS_DISTANCE,
  GOAL_HALF_DEPTH,
  GOAL_HALF_HEIGHT,
  KEEPER_HOLD_SECONDS,
  POOL_HALF,
  SHOT_MAX_RANGE,
  TICK_RATE,
} from "./constants";
import { FORMATIONS } from "./formations";
import type { PlayerIntent } from "./input";
import type { Match } from "./match";
import type { Personality, PlayerState, Technique, TechniqueKind } from "./types";
import { add, dist, dot, normalize, scale, sub, v3, type Vec3 } from "./vec";

export interface Difficulty {
  /** Ticks between decisions for each player (reaction delay). */
  reactionTicks: number;
  /** Amplitude of the uniform noise added to every utility. */
  noise: number;
}

export const DIFFICULTIES = {
  easy: { reactionTicks: 18, noise: 0.4 },
  normal: { reactionTicks: 10, noise: 0.2 },
  hard: { reactionTicks: 5, noise: 0.08 },
} as const satisfies Record<string, Difficulty>;

export type DifficultyId = keyof typeof DIFFICULTIES;

export interface TeamAiProfile {
  personality: Personality;
  difficulty: Difficulty;
}

interface Weights {
  shoot: number;
  pass: number;
  dribble: number;
  tackle: number;
  technique: number;
  /** Probability-like preference for sprinting when not strictly needed. */
  sprint: number;
  /** How many defenders press the carrier. */
  pressers: number;
}

const PERSONALITY: Record<Personality, Weights> = {
  balanced: { shoot: 1, pass: 1, dribble: 1, tackle: 1, technique: 1, sprint: 0.5, pressers: 1 },
  aggressive: { shoot: 1.4, pass: 0.85, dribble: 1.1, tackle: 1.3, technique: 1, sprint: 0.8, pressers: 2 },
  technical: { shoot: 0.9, pass: 1.3, dribble: 0.9, tackle: 0.8, technique: 1.5, sprint: 0.4, pressers: 1 },
  physical: { shoot: 1, pass: 0.8, dribble: 1.2, tackle: 1.5, technique: 0.7, sprint: 0.9, pressers: 2 },
};

export function resolveAiProfile(personality?: Personality, difficulty?: DifficultyId | Difficulty): TeamAiProfile {
  const d = difficulty === undefined ? DIFFICULTIES.normal : typeof difficulty === "string" ? DIFFICULTIES[difficulty] : difficulty;
  return { personality: personality ?? "balanced", difficulty: d };
}

/** Decide intents for every AI player of a team (skipping the human-controlled one). */
export function decideTeam(m: Match, team: 0 | 1, profile: TeamAiProfile, skipId?: string): void {
  const players = m.playersOf(team);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === skipId) continue;
    const due = (m.state.tick + i * 3) % profile.difficulty.reactionTicks === 0;
    if (!due && m.getIntent(p.id)) continue;
    m.setIntent(p.id, decidePlayer(m, p, profile));
  }
}

function noise(m: Match, profile: TeamAiProfile): number {
  return (m.rng.float() - 0.5) * 2 * profile.difficulty.noise;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function decidePlayer(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const ball = m.state.ball;
  if (p.role === "GK") return keeperIntent(m, p);
  if (ball.carrier === p.id) return carrierIntent(m, p, profile);
  if (ball.carrier) {
    const c = m.player(ball.carrier);
    return c.team === p.team ? supportIntent(m, p, profile) : defendIntent(m, p, profile);
  }
  if (ball.flight) {
    if (ball.flight.team === p.team) return supportIntent(m, p, profile);
    return defendIntent(m, p, profile);
  }
  return looseIntent(m, p, profile);
}

// ---------------------------------------------------------------- carrier

/** 0..1 estimate of how likely a shot from here is to go in. */
export function shotQuality(m: Match, p: PlayerState): number {
  const goal = m.goalCenter(p.team);
  const d = dist(p.pos, goal);
  if (d > SHOT_MAX_RANGE) return 0;
  const range = 1 - d / SHOT_MAX_RANGE;
  const toGoal = normalize(sub(goal, p.pos));
  const angle = clamp01((dot(toGoal, v3(m.attackDir(p.team), 0, 0)) - 0.3) / 0.7);
  const keeper = m.keeperOf((1 - p.team) as 0 | 1);
  const sh = m.effectiveStats(p).sh;
  const ca = m.effectiveStats(keeper).ca;
  const strength = sh / (sh + ca);
  let blockers = 0;
  for (const q of m.opponentsOf(p.team)) {
    if (q.role === "GK") continue;
    const r = distToLane(q.pos, p.pos, goal);
    if (r < m.blockReach(q) + 0.8) blockers++;
  }
  const blockPenalty = 0.5 ** blockers;
  return clamp01(range ** 0.6 * angle * strength * 1.8 * blockPenalty);
}

function distToLane(q: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return dist(q, a);
  const t = Math.max(0.05, Math.min(0.98, dot(sub(q, a), ab) / l2));
  return dist(q, add(a, scale(ab, t)));
}

/** Aim at the goal corner farthest from the keeper. */
export function bestShotAim(m: Match, p: PlayerState): Vec3 {
  const gx = POOL_HALF.x * m.attackDir(p.team);
  const keeper = m.keeperOf((1 - p.team) as 0 | 1);
  const cy = GOAL_HALF_HEIGHT - 1.5;
  const cz = GOAL_HALF_DEPTH - 1.2;
  let best = v3(gx, 0, 0);
  let bestD = -1;
  for (const y of [-cy, cy]) {
    for (const z of [-cz, cz]) {
      const c = v3(gx, y, z);
      const d = dist(c, keeper.pos);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/** 0..1 estimate of a pass from p to t succeeding and being useful. */
export function passQuality(m: Match, p: PlayerState, t: PlayerState): number {
  const d = dist(p.pos, t.pos);
  if (d < 2.5) return 0.05;
  const lane = clamp01(m.laneClearance(p.team, p.pos, t.pos) / AI_LANE_CLEAR_DIST);
  const pressure = clamp01(m.nearestOpponentDistance(t) / 6);
  const dir = m.attackDir(p.team);
  const advance = ((t.pos.x - p.pos.x) * dir) / 30;
  const pa = m.effectiveStats(p).pa;
  let avgBl = 0;
  const opps = m.opponentsOf(p.team);
  for (const q of opps) avgBl += m.effectiveStats(q).bl;
  avgBl /= Math.max(1, opps.length);
  const strength = pa / (pa + avgBl);
  let q = lane * 0.45 + pressure * 0.25 + advance * 0.3 + 0.15;
  q *= 0.6 + strength * 0.8;
  if (d > 25) q -= 0.25;
  if (t.role === "GK") q -= 0.4;
  return clamp01(q);
}

export function bestPassTarget(m: Match, p: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestQ = -1;
  for (const t of m.playersOf(p.team)) {
    if (t.id === p.id || !m.canContest(t)) continue;
    const q = passQuality(m, p, t);
    if (q > bestQ) {
      bestQ = q;
      best = t;
    }
  }
  return best;
}

function pickTechnique(m: Match, p: PlayerState, kind: TechniqueKind, w: Weights): Technique | undefined {
  const usable = m.usableTechniques(p, kind);
  if (usable.length === 0) return undefined;
  if (!m.rng.chance(Math.min(0.9, 0.5 * w.technique))) return undefined;
  let best = usable[0];
  for (const t of usable) {
    const key = kind === "shot" ? "sh" : kind === "pass" ? "pa" : "at";
    if ((t.statMods[key] ?? 0) > (best.statMods[key] ?? 0)) best = t;
  }
  // keep a stamina reserve so the player does not crawl afterwards
  if (p.hp - best.hpCost < p.maxHp * 0.2) return undefined;
  return best;
}

function carrierIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const w = PERSONALITY[profile.personality];
  const goal = m.goalCenter(p.team);
  const held = m.state.tick - p.receivedTick;
  const dOpp = m.nearestOpponentDistance(p);
  const st = m.effectiveStats(p);

  const sq = shotQuality(m, p);
  const shootU = sq * w.shoot + noise(m, profile);

  let bestPass: PlayerState | null = null;
  let bestPq = 0;
  for (const t of m.playersOf(p.team)) {
    if (t.id === p.id || !m.canContest(t)) continue;
    const q = passQuality(m, p, t);
    if (q > bestPq) {
      bestPq = q;
      bestPass = t;
    }
  }
  const passU = bestPq * w.pass + noise(m, profile);

  const dGoal = dist(p.pos, goal);
  let dribbleU = (clamp01(dOpp / 8) * 0.55 + 0.25 * (1 - dGoal / 60)) * w.dribble + noise(m, profile);
  if (held < AI_MIN_HOLD_TICKS) dribbleU += 0.45;
  if (dOpp < 3) {
    // pressured: dribbling only looks good if EN should beat their AT
    let at = 0;
    for (const q of m.opponentsOf(p.team)) if (dist(q.pos, p.pos) < 3) at = Math.max(at, m.effectiveStats(q).at);
    dribbleU -= 0.35 * (1 - st.en / (st.en + at + 0.01));
  }

  if (sq > 0.12 && shootU >= passU && shootU >= dribbleU) {
    return { sprint: false, action: { kind: "shoot", aim: bestShotAim(m, p), techniqueId: pickTechnique(m, p, "shot", w)?.id } };
  }
  if (bestPass && bestPq > 0.2 && passU > dribbleU) {
    return {
      moveTo: p.pos,
      sprint: false,
      action: { kind: "pass", targetId: bestPass.id, techniqueId: pickTechnique(m, p, "pass", w)?.id },
    };
  }
  // dribble toward goal, steering away from the nearest opponent
  let steer = normalize(sub(goal, p.pos));
  for (const q of m.opponentsOf(p.team)) {
    const away = sub(p.pos, q.pos);
    const d = dist(q.pos, p.pos);
    if (d < 6) steer = add(steer, scale(normalize(away), (6 - d) / 6));
  }
  const target = add(p.pos, scale(normalize(steer), 6));
  const sprint = dOpp < 5 || m.rng.chance(w.sprint * 0.3);
  return { moveTo: target, sprint: sprint && p.hp > p.maxHp * 0.3 };
}

// ---------------------------------------------------------------- off the ball

function supportIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const w = PERSONALITY[profile.personality];
  const ball = m.state.ball;
  if (ball.flight && ball.flight.to === p.id) return { moveTo: ball.flight.aim, sprint: true };
  const preset = FORMATIONS[m.state.formations[p.team]];
  let target = m.formationSlot(p, preset.attackShift);
  // forwards make runs toward the goal when the ball is in the attacking half
  const dir = m.attackDir(p.team);
  if ((p.role === "LF" || p.role === "RF") && ball.pos.x * dir > 0) {
    const goal = m.goalCenter(p.team);
    target = add(goal, v3(-dir * 10, p.role === "LF" ? 6 : -6, p.role === "LF" ? 3 : -3));
  }
  // drift away from a close marker to open a lane
  for (const q of m.opponentsOf(p.team)) {
    const d = dist(q.pos, p.pos);
    if (d < 3) target = add(target, scale(normalize(sub(p.pos, q.pos)), 3 - d));
  }
  return { moveTo: target, sprint: m.rng.chance(w.sprint * 0.2) && p.hp > p.maxHp * 0.5 };
}

function defendIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const w = PERSONALITY[profile.personality];
  const ball = m.state.ball;
  const carrier = ball.carrier ? m.player(ball.carrier) : null;
  const ballPos = carrier ? add(carrier.pos, scale(carrier.vel, 0.2)) : ball.pos;
  const mates = m.playersOf(p.team).filter((q) => q.role !== "GK" && m.canContest(q));
  mates.sort((a, b) => dist(a.pos, ballPos) - dist(b.pos, ballPos));
  const rank = mates.findIndex((q) => q.id === p.id);
  const d = dist(p.pos, ballPos);

  if (carrier && rank >= 0 && rank < w.pressers && d < AI_PRESS_DISTANCE * (rank === 0 ? 3 : 1)) {
    if (d <= m.tackleRange && p.tackleCooldown === 0) {
      const at = m.effectiveStats(p).at;
      const en = m.effectiveStats(carrier).en;
      const u = (at / (at + en)) * w.tackle * (0.6 + 0.4 * (p.hp / p.maxHp)) + noise(m, profile);
      if (u > 0.33) return { moveTo: ballPos, sprint: false, action: { kind: "tackle", techniqueId: pickTechnique(m, p, "tackle", w)?.id } };
    }
    return { moveTo: ballPos, sprint: d > 3 && p.hp > p.maxHp * 0.25 };
  }
  if (!carrier && rank >= 0 && rank < 2) {
    // ball in flight toward us: chase the landing point
    return { moveTo: ball.flight ? ball.flight.aim : ball.pos, sprint: true };
  }
  const mark = m.markTarget(p);
  const own = m.ownGoalCenter(p.team);
  if (mark && dist(mark.pos, ballPos) < 28) {
    const target = add(mark.pos, scale(normalize(sub(own, mark.pos)), AI_MARK_OFFSET));
    return { moveTo: target, sprint: dist(p.pos, target) > 8 && p.hp > p.maxHp * 0.4 };
  }
  const preset = FORMATIONS[m.state.formations[p.team]];
  return { moveTo: m.formationSlot(p, preset.defenseShift), sprint: false };
}

function looseIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const ball = m.state.ball;
  const predicted = add(ball.pos, scale(ball.vel, 0.3));
  const mates = m.playersOf(p.team).filter((q) => q.role !== "GK" && m.canContest(q));
  mates.sort((a, b) => dist(a.pos, predicted) - dist(b.pos, predicted));
  const rank = mates.findIndex((q) => q.id === p.id);
  if (rank >= 0 && rank < 2) return { moveTo: predicted, sprint: p.hp > p.maxHp * 0.2 };
  const w = PERSONALITY[profile.personality];
  return { moveTo: m.formationSlot(p, 0), sprint: m.rng.chance(w.sprint * 0.2) };
}

function keeperIntent(m: Match, p: PlayerState): PlayerIntent {
  const ball = m.state.ball;
  const own = m.ownGoalCenter(p.team);
  const inward = m.attackDir(p.team);
  if (p.hasBall) {
    const held = m.state.tick - p.receivedTick;
    if (held >= KEEPER_HOLD_SECONDS * TICK_RATE) {
      const t = bestPassTarget(m, p);
      if (t) return { moveTo: p.pos, sprint: false, action: { kind: "pass", targetId: t.id } };
    }
    return { moveTo: add(own, v3(inward * 2, 0, 0)), sprint: false };
  }
  let y = Math.max(-GOAL_HALF_HEIGHT + 0.5, Math.min(GOAL_HALF_HEIGHT - 0.5, ball.pos.y * 0.7));
  let z = Math.max(-GOAL_HALF_DEPTH + 0.5, Math.min(GOAL_HALF_DEPTH - 0.5, ball.pos.z * 0.7));
  let sprint = false;
  if (ball.flight?.kind === "shot" && ball.flight.team !== p.team && Math.abs(ball.vel.x) > 1e-6) {
    // extrapolate the shot to the goal plane
    const t = (own.x - ball.pos.x) / ball.vel.x;
    if (t > 0) {
      y = ball.pos.y + ball.vel.y * t;
      z = ball.pos.z + ball.vel.z * t;
      sprint = true;
    }
  }
  return { moveTo: v3(own.x + inward * 1.5, y, z), sprint };
}
