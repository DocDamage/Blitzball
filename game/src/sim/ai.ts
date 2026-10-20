/**
 * ai.ts - Per-player match AI plus team personality/difficulty.
 *
 * The ball carrier follows the CPU rules of the original match script
 * (formulas.md section 8): a zone-based chance to act at all, the dribble
 * chance when every defender in the encounter could be broken, shoot vs pass
 * by `rand(PA + w) < w` with the zone shot weight, the shot-range rule, and
 * passing only when PA beats the blockers' BL. Target selection, support
 * runs, marking and the keeper are sim rules (formations are not in the
 * original event). Each AI player re-evaluates every `reactionTicks` ticks
 * (staggered per player) and keeps its intent in between; utilities are
 * perturbed by `noise` from the match Rng so everything stays deterministic.
 */

import {
  AI_ACT_PCT_BY_ZONE,
  AI_ACT_PCT_SCALE,
  AI_DRIBBLE_PCT_BY_ZONE,
  AI_KEEPER_TRACK,
  AI_KEEPER_TRACK_CLAMP,
  AI_LANE_CLEAR_DIST,
  AI_MARK_OFFSET,
  AI_MAX_HOLD_TICKS,
  AI_MIN_HOLD_TICKS,
  AI_SHOT_CORNER_INSET_Y,
  AI_SHOT_CORNER_INSET_Z,
  AI_SHOT_MIN_CHANCE,
  AI_SHOT_WEIGHT_BY_ZONE,
  AI_SUPPORT_AHEAD,
  AI_SUPPORT_SIDE,
  GOAL_HALF_DEPTH,
  GOAL_HALF_HEIGHT,
  KEEPER_HOLD_SECONDS,
  POOL_HALF,
  TICK_RATE,
} from "./constants";
import { FORMATIONS } from "./formations";
import type { PlayerIntent } from "./input";
import type { Match } from "./match";
import type { Personality, PlayerState, Technique, TechniqueKind } from "./types";
import { add, dist, normalize, scale, sub, type Vec3, v3 } from "./vec";

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
  technique: number;
  /** Probability-like preference for sprinting when not strictly needed. */
  sprint: number;
  /** How many defenders press the carrier. */
  pressers: number;
}

const PERSONALITY: Record<Personality, Weights> = {
  balanced: { shoot: 1, pass: 1, technique: 1, sprint: 0.5, pressers: 2 },
  aggressive: { shoot: 1.4, pass: 0.85, technique: 1, sprint: 0.8, pressers: 2 },
  technical: { shoot: 0.9, pass: 1.3, technique: 1.5, sprint: 0.4, pressers: 1 },
  physical: { shoot: 1, pass: 0.8, technique: 0.7, sprint: 0.9, pressers: 2 },
};

export function resolveAiProfile(personality?: Personality, difficulty?: DifficultyId | Difficulty): TeamAiProfile {
  const d =
    difficulty === undefined
      ? DIFFICULTIES.normal
      : typeof difficulty === "string"
        ? DIFFICULTIES[difficulty]
        : difficulty;
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

/** Aim at the goal corner farthest from the keeper. */
export function bestShotAim(m: Match, p: PlayerState): Vec3 {
  const gx = POOL_HALF.x * m.attackDir(p.team);
  const keeper = m.keeperOf((1 - p.team) as 0 | 1);
  const cy = GOAL_HALF_HEIGHT - AI_SHOT_CORNER_INSET_Y;
  const cz = GOAL_HALF_DEPTH - AI_SHOT_CORNER_INSET_Z;
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

/** 0..1 estimate of a pass from p to t being useful (sim rule: lane, pressure, advance). */
export function passQuality(m: Match, p: PlayerState, t: PlayerState): number {
  const d = dist(p.pos, t.pos);
  if (d < 2.5) return 0.05;
  const lane = clamp01(m.laneClearance(p.team, p.pos, t.pos) / AI_LANE_CLEAR_DIST);
  const pressure = clamp01(m.nearestOpponentDistance(t) / 6);
  const dir = m.attackDir(p.team);
  const advance = ((t.pos.x - p.pos.x) * dir) / 30;
  let q = lane * 0.45 + pressure * 0.25 + advance * 0.3 + 0.05;
  // flight decay: a pass that would arrive with no PA left is fumbled
  const arrival = m.passArrivalPower(p, t);
  if (arrival <= 0) return 0;
  q *= clamp01(0.4 + arrival / 6);
  if (t.role === "GK") q -= 0.4;
  return clamp01(q);
}

export function bestPassTarget(m: Match, p: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestQ = -1;
  for (const t of m.playersOf(p.team)) {
    if (t.id === p.id || !m.canAct(t)) continue;
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
  if (kind !== "shot" && !m.rng.chance(Math.min(0.9, 0.5 * w.technique))) return undefined;
  let best = usable[0];
  for (const t of usable) if (t.statBoost > best.statBoost) best = t;
  return best;
}

function carrierIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const w = PERSONALITY[profile.personality];
  const held = m.state.tick - p.receivedTick;
  const st = m.effectiveStats(p);
  const zone = m.zoneOf(p);
  const defenders = m.encounterDefenders(p);

  // decide whether to act at all (formulas.md section 8)
  let act: boolean;
  if (defenders.length > 0) {
    let sumAt = 0;
    for (const d of defenders) sumAt += m.effectiveStats(d).at;
    const canBreakAll = (p.contestEn ?? st.en) >= sumAt;
    act = !(canBreakAll && m.rng.pct() < AI_DRIBBLE_PCT_BY_ZONE[zone]);
  } else {
    act = held >= AI_MIN_HOLD_TICKS && m.rng.pct() < AI_ACT_PCT_BY_ZONE[zone] * AI_ACT_PCT_SCALE;
  }
  const forced = held > AI_MAX_HOLD_TICKS;
  if (!act && !forced) return dribble(m, p, w);

  // shoot vs pass: shoot if rand(PA + w) < w, w = SH * zone weight, and in range
  const shotWeight = st.sh * AI_SHOT_WEIGHT_BY_ZONE[zone] * w.shoot;
  // a shot technique is worth using when its boost lifts the estimated chance
  let shotTech = pickTechnique(m, p, "shot", w);
  const plainChance = m.shotGoalChance(p, defenders);
  let shotChance = plainChance;
  if (shotTech) {
    const boostedChance = m.shotGoalChance(p, defenders, shotTech.statBoost);
    if (boostedChance > plainChance) shotChance = boostedChance;
    else shotTech = undefined;
  }
  // close to goal the original AI shoots on weight alone; further out we also require a minimal estimated chance
  const inRange = m.shotInRange(p) && (shotChance >= AI_SHOT_MIN_CHANCE || zone >= 5);
  const wantShot = inRange && m.rng.float() * (st.pa * w.pass + shotWeight) < shotWeight;
  if (wantShot) {
    return { sprint: false, action: { kind: "shoot", aim: bestShotAim(m, p), techniqueId: shotTech?.id } };
  }
  // pass only if PA beats the blockers' total BL (the defenders not tackling)
  let sumBl = 0;
  for (const d of defenders) sumBl += m.effectiveStats(d).bl;
  const target = bestPassTarget(m, p);
  if (target && (st.pa >= sumBl || forced)) {
    return {
      moveTo: p.pos,
      sprint: false,
      action: { kind: "pass", targetId: target.id, techniqueId: pickTechnique(m, p, "pass", w)?.id },
    };
  }
  // a carrier who has held the ball too long shoots even against a hopeless keeper rather than parking
  if (forced && m.shotInRange(p)) {
    return { sprint: false, action: { kind: "shoot", aim: bestShotAim(m, p) } };
  }
  return dribble(m, p, w);
}

/** Dribble toward the goal, steering away from nearby opponents. */
function dribble(m: Match, p: PlayerState, w: Weights): PlayerIntent {
  const goal = m.goalCenter(p.team);
  let steer = normalize(sub(goal, p.pos));
  for (const q of m.opponentsOf(p.team)) {
    const away = sub(p.pos, q.pos);
    const d = dist(q.pos, p.pos);
    if (d < 6) steer = add(steer, scale(normalize(away), (6 - d) / 6));
  }
  const target = add(p.pos, scale(normalize(steer), 6));
  const dOpp = m.nearestOpponentDistance(p);
  const sprint = dOpp < 5 || m.rng.chance(w.sprint * 0.3);
  return { moveTo: target, sprint: sprint && p.hp > p.effectiveMaxHp * 0.3 };
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
  // the two teammates nearest the carrier offer a short pass (flight decay kills long ones)
  const carrier = ball.carrier ? m.player(ball.carrier) : null;
  if (carrier) {
    const mates = m.playersOf(p.team).filter((q) => q.id !== carrier.id && q.role !== "GK");
    mates.sort((a, b) => dist(a.pos, carrier.pos) - dist(b.pos, carrier.pos));
    const rank = mates.findIndex((q) => q.id === p.id);
    if (rank >= 0 && rank < 2) {
      const side = rank === 0 ? 1 : -1;
      target = add(carrier.pos, v3(dir * AI_SUPPORT_AHEAD, side * AI_SUPPORT_SIDE, side * 1.5));
    }
  }
  // drift away from a close marker to open a lane
  for (const q of m.opponentsOf(p.team)) {
    const d = dist(q.pos, p.pos);
    if (d < 3) target = add(target, scale(normalize(sub(p.pos, q.pos)), 3 - d));
  }
  return { moveTo: target, sprint: m.rng.chance(w.sprint * 0.2) && p.hp > p.effectiveMaxHp * 0.5 };
}

function defendIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const w = PERSONALITY[profile.personality];
  const ball = m.state.ball;
  const carrier = ball.carrier ? m.player(ball.carrier) : null;
  const ballPos = carrier ? add(carrier.pos, scale(carrier.vel, 0.2)) : ball.pos;
  const mates = m.playersOf(p.team).filter((q) => q.role !== "GK" && m.canAct(q));
  mates.sort((a, b) => dist(a.pos, ballPos) - dist(b.pos, ballPos));
  const rank = mates.findIndex((q) => q.id === p.id);
  const d = dist(p.pos, ballPos);

  // a defender locks onto the carrier inside its lock radius (290 units, +100 Elite Defense)
  const locks = carrier && d < m.lockRadius(p) * (rank === 0 ? 2 : 1);
  if (carrier && rank >= 0 && rank < w.pressers + 1 && locks) {
    if (d <= m.tackleReach(p) && p.tackleCooldown === 0) {
      return {
        moveTo: ballPos,
        sprint: false,
        action: { kind: "tackle", techniqueId: pickTechnique(m, p, "tackle", w)?.id },
      };
    }
    return { moveTo: ballPos, sprint: d > 3 && p.hp > p.effectiveMaxHp * 0.25 };
  }
  if (!carrier && rank >= 0 && rank < 2) {
    // ball in flight toward us: chase the landing point
    return { moveTo: ball.flight ? ball.flight.aim : ball.pos, sprint: true };
  }
  const mark = m.markTarget(p);
  const own = m.ownGoalCenter(p.team);
  if (mark && dist(mark.pos, ballPos) < 28) {
    const target = add(mark.pos, scale(normalize(sub(own, mark.pos)), AI_MARK_OFFSET));
    return { moveTo: target, sprint: dist(p.pos, target) > 8 && p.hp > p.effectiveMaxHp * 0.4 };
  }
  const preset = FORMATIONS[m.state.formations[p.team]];
  return { moveTo: m.formationSlot(p, preset.defenseShift), sprint: false };
}

function looseIntent(m: Match, p: PlayerState, profile: TeamAiProfile): PlayerIntent {
  const ball = m.state.ball;
  const predicted = add(ball.pos, scale(ball.vel, 0.3));
  const mates = m.playersOf(p.team).filter((q) => q.role !== "GK" && m.canAct(q));
  mates.sort((a, b) => dist(a.pos, predicted) - dist(b.pos, predicted));
  const rank = mates.findIndex((q) => q.id === p.id);
  if (rank >= 0 && rank < 2) return { moveTo: predicted, sprint: p.hp > p.effectiveMaxHp * 0.2 };
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
  const c = AI_KEEPER_TRACK_CLAMP;
  let y = Math.max(-c, Math.min(c, ball.pos.y * AI_KEEPER_TRACK));
  let z = Math.max(-c, Math.min(c, ball.pos.z * AI_KEEPER_TRACK));
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
