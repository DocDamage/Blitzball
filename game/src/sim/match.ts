/**
 * match.ts - The Match class: fixed-timestep (60 Hz) headless blitzball sim.
 *
 * One call to step(inputs) advances exactly one tick. The class owns the
 * complete MatchState (clock, halves, score, players, ball), the seeded Rng
 * and an append-only event log. Rules implemented (plan 5.4):
 *   - two halves with a half-time HP refill and side swap, optional sudden
 *     death overtime
 *   - blitz-off (loose ball at centre) at kickoff and after every goal
 *   - passes contested by defender BL, shots contested by blocker BL and the
 *     keeper's CA, tackles contested AT vs EN; all instant FFX-style contests
 *   - out-of-pool resets (missed shots -> defending keeper), keeper hold limits
 *   - statuses ticked per tick (poison drain, sleep/nap, wither), techniques
 *     with HP cost + cooldown, techcopy for witnesses
 *   - formation presets and marking assignments (formations.ts)
 * No DOM, no Three.js: this file must stay importable from node tests.
 */

import { bestPassTarget, bestShotAim, decideTeam, resolveAiProfile, type TeamAiProfile } from "./ai";
import {
  BASE_SPEED,
  BLOCK_REACH_BASE,
  BLOCK_REACH_PER_BL,
  BREAKTHROUGH_HP_COST,
  CARRY_OFFSET,
  CARRY_SPEED_MULT,
  CATCH_RADIUS,
  CONTEST_SPREAD_MAX,
  CONTEST_SPREAD_MIN,
  DEFAULT_HALF_SECONDS,
  DEFAULT_OVERTIME_SECONDS,
  DT,
  GOAL_HALF_DEPTH,
  GOAL_HALF_HEIGHT,
  KEEPER_MAX_HOLD_SECONDS,
  KEEPER_SAVE_MULT,
  KEEPER_ZONE_DEPTH,
  LOOSE_DRAG_PER_TICK,
  LOW_HP_SPEED_FLOOR,
  NAP_SPEED_MULT,
  PASS_ACCURACY_BASE,
  PASS_BASE_SPEED,
  PASS_CONTEST_MIN_TRAVEL,
  PASS_LEAD_SECONDS,
  PASS_MIN_POWER_FRAC,
  PASS_MISS_SPREAD,
  PASS_OVERSHOOT,
  PASS_RANGE_FULL,
  PASS_SPEED_PER_PA,
  PICKUP_RADIUS,
  PLAYER_RADIUS,
  POISON_HP_PER_SECOND,
  POOL_HALF,
  RESET_FREEZE_SECONDS,
  SAVE_RADIUS_BASE,
  SAVE_RADIUS_PER_CA,
  SHOT_ACCURACY_BASE,
  SHOT_BASE_SPEED,
  SHOT_BLOCK_FACTOR,
  SHOT_MISS_SPREAD,
  SHOT_POWER_DECAY_PER_UNIT,
  SHOT_SPEED_PER_SH,
  SPEED_PER_SP,
  SPRINT_HP_PER_SECOND,
  SPRINT_MULT,
  TACKLE_COOLDOWN_SECONDS,
  TACKLE_HP_COST,
  TACKLE_RANGE,
  TACKLE_WHIFF_STUN_SECONDS,
  TACKLED_STUN_SECONDS,
  TECHCOPY_CHANCE,
  TECHCOPY_RADIUS,
  TICK_RATE,
  WALL_BOUNCE,
  WITHER_STAT_MULT,
} from "./constants";
import { FORMATIONS, kickoffPosition, slotToWorld } from "./formations";
import { AI_INPUT, type HumanTeamInput, type MatchInput, type PlayerAction, type PlayerIntent } from "./input";
import { Rng } from "./rng";
import { getTechnique, PASSIVE_IMMUNITY } from "./techniques";
import {
  type BallFlight,
  type FormationId,
  type MatchEvent,
  type MatchEventPayload,
  type MatchState,
  type PlayerState,
  ROLE_ORDER,
  type Stats,
  type StatusKind,
  type TeamDef,
  type Technique,
  type TechniqueKind,
} from "./types";
import { add, clampBox, dist, distToSegment, dot, isZero, len, normalize, scale, sub, type Vec3, v3 } from "./vec";

export interface MatchOptions {
  seed: number;
  halfSeconds?: number;
  overtime?: boolean;
  overtimeSeconds?: number;
  /** AI difficulty for both AI-controlled teams ("easy" | "normal" | "hard" or a custom object). */
  difficulty?: Parameters<typeof resolveAiProfile>[1];
}

type Team = 0 | 1;

const SECS = (s: number) => Math.round(s * TICK_RATE);

export class Match {
  readonly teams: [TeamDef, TeamDef];
  readonly state: MatchState;
  readonly events: MatchEvent[] = [];
  readonly rng: Rng;
  readonly halfSeconds: number;
  readonly overtime: boolean;
  readonly overtimeSeconds: number;
  readonly ai: [TeamAiProfile, TeamAiProfile];

  private readonly byId = new Map<string, PlayerState>();
  private readonly intents = new Map<string, PlayerIntent>();

  constructor(home: TeamDef, away: TeamDef, opts: MatchOptions) {
    if (home.players.length < 6 || away.players.length < 6) throw new Error("teams need 6 starters");
    this.teams = [home, away];
    this.rng = new Rng(opts.seed);
    this.halfSeconds = opts.halfSeconds ?? DEFAULT_HALF_SECONDS;
    this.overtime = opts.overtime ?? false;
    this.overtimeSeconds = opts.overtimeSeconds ?? DEFAULT_OVERTIME_SECONDS;
    this.ai = [
      resolveAiProfile(home.personality, opts.difficulty),
      resolveAiProfile(away.personality, opts.difficulty),
    ];

    const players: PlayerState[] = [];
    for (const team of [0, 1] as const) {
      const def = this.teams[team];
      for (let i = 0; i < 6; i++) {
        const pd = def.players[i];
        const p: PlayerState = {
          id: pd.id,
          teamId: def.id,
          team,
          role: ROLE_ORDER[i],
          def: pd,
          pos: v3(0, 0, 0),
          vel: v3(0, 0, 0),
          facing: v3(team === 0 ? 1 : -1, 0, 0),
          hp: pd.stats.hp,
          maxHp: pd.stats.hp,
          statuses: [],
          cooldowns: {},
          techniques: [...pd.techniques],
          tackleCooldown: 0,
          stun: 0,
          hasBall: false,
          receivedTick: 0,
        };
        if (this.byId.has(p.id)) throw new Error(`duplicate player id ${p.id}`);
        this.byId.set(p.id, p);
        players.push(p);
      }
    }

    this.state = {
      tick: 0,
      time: 0,
      half: 1,
      phase: "reset",
      resetTicks: SECS(RESET_FREEZE_SECONDS),
      score: [0, 0],
      possession: null,
      possessionTicks: [0, 0],
      attackDir: [1, -1],
      formations: [home.formation, away.formation],
      players,
      ball: { pos: v3(0, 0, 0), vel: v3(0, 0, 0), carrier: null, flight: null, lastTouch: null },
      rngState: this.rng.state,
    };
    this.placeForKickoff();
  }

  // ------------------------------------------------------------------ public API

  get finished(): boolean {
    return this.state.phase === "finished";
  }

  /** Advance exactly one 1/60 s tick. */
  step(inputs: MatchInput = AI_INPUT): void {
    const s = this.state;
    if (s.phase === "finished") return;
    s.tick++;
    if (s.phase === "reset") {
      s.resetTicks--;
      if (s.resetTicks <= 0) this.kickoff();
      s.rngState = this.rng.state;
      return;
    }
    s.time += DT;
    this.tickStatuses();
    this.tickTimers();
    this.gatherIntents(inputs);
    this.movePlayers();
    this.resolveActions();
    this.updateBall();
    if (s.phase === "play") {
      if (s.ball.carrier) s.possessionTicks[this.player(s.ball.carrier).team]++;
      if (s.time >= this.periodLength()) this.endPeriod();
    }
    s.rngState = this.rng.state;
  }

  /** Run until the match is finished (AI vs AI). */
  run(maxTicks = 10_000_000): void {
    let n = 0;
    while (!this.finished && n++ < maxTicks) this.step(AI_INPUT);
  }

  player(id: string): PlayerState {
    const p = this.byId.get(id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  playersOf(team: Team): PlayerState[] {
    return this.state.players.filter((p) => p.team === team);
  }

  opponentsOf(team: Team): PlayerState[] {
    return this.state.players.filter((p) => p.team !== team);
  }

  keeperOf(team: Team): PlayerState {
    return this.state.players.find((p) => p.team === team && p.role === "GK") as PlayerState;
  }

  attackDir(team: Team): 1 | -1 {
    return this.state.attackDir[team];
  }

  /** Centre of the goal this team attacks. */
  goalCenter(team: Team): Vec3 {
    return v3(POOL_HALF.x * this.attackDir(team), 0, 0);
  }

  /** Centre of the goal this team defends. */
  ownGoalCenter(team: Team): Vec3 {
    return v3(-POOL_HALF.x * this.attackDir(team), 0, 0);
  }

  /** Switch a team's formation (intended before kickoff / at half time, allowed any time). */
  setFormation(team: Team, formation: FormationId): void {
    this.state.formations[team] = formation;
  }

  /** World-space formation slot for a player, optionally shifted along local x. */
  formationSlot(p: PlayerState, shiftX = 0): Vec3 {
    const preset = FORMATIONS[this.state.formations[p.team]];
    return slotToWorld(preset.slots[p.role], this.attackDir(p.team), shiftX);
  }

  /** The opposing player this player marks, per the formation preset (null = press). */
  markTarget(p: PlayerState): PlayerState | null {
    const role = FORMATIONS[this.state.formations[p.team]].marks[p.role];
    if (!role) return null;
    const other = (1 - p.team) as Team;
    return this.state.players.find((q) => q.team === other && q.role === role) ?? null;
  }

  /** Base stats plus passive technique mods, reduced by wither. */
  effectiveStats(p: PlayerState): Stats {
    const s: Stats = { ...p.def.stats };
    for (const id of p.techniques) {
      const t = getTechnique(id);
      if (t?.kind === "passive") for (const k of Object.keys(t.statMods) as (keyof Stats)[]) s[k] += t.statMods[k] ?? 0;
    }
    if (this.hasStatus(p, "wither")) {
      for (const k of ["en", "at", "pa", "bl", "sh", "ca"] as const) s[k] = Math.max(0, s[k] * WITHER_STAT_MULT);
    }
    return s;
  }

  hasStatus(p: PlayerState, kind: StatusKind): boolean {
    return p.statuses.some((st) => st.kind === kind);
  }

  isAsleep(p: PlayerState): boolean {
    return this.hasStatus(p, "sleep");
  }

  /** Can move / act this tick (not asleep, not stunned). */
  canAct(p: PlayerState): boolean {
    return !this.isAsleep(p) && p.stun <= 0;
  }

  /** Can take a contest action: canAct and not napping. */
  canContest(p: PlayerState): boolean {
    return this.canAct(p) && !this.hasStatus(p, "nap");
  }

  canUseTechnique(p: PlayerState, techniqueId: string, kind?: TechniqueKind): boolean {
    const t = getTechnique(techniqueId);
    if (!t || t.kind === "passive") return false;
    if (kind && t.kind !== kind) return false;
    if (!p.techniques.includes(techniqueId)) return false;
    if ((p.cooldowns[techniqueId] ?? 0) > 0) return false;
    return p.hp >= t.hpCost && this.canContest(p);
  }

  usableTechniques(p: PlayerState, kind: TechniqueKind): Technique[] {
    const out: Technique[] = [];
    for (const id of p.techniques) if (this.canUseTechnique(p, id, kind)) out.push(getTechnique(id) as Technique);
    return out;
  }

  /** Intent currently cached for a player (AI decisions persist between reaction ticks). */
  getIntent(id: string): PlayerIntent | undefined {
    return this.intents.get(id);
  }

  setIntent(id: string, intent: PlayerIntent): void {
    this.intents.set(id, intent);
  }

  /** Scenario / test helper: hand the ball to a player immediately. */
  giveBall(playerId: string): void {
    this.takeBall(this.player(playerId));
  }

  /** Scenario / test helper: apply a status directly. */
  applyStatus(p: PlayerState, kind: StatusKind, seconds: number): boolean {
    for (const id of p.techniques) if (PASSIVE_IMMUNITY[id]?.includes(kind)) return false;
    const ticks = SECS(seconds);
    const existing = p.statuses.find((st) => st.kind === kind);
    if (existing) existing.remaining = Math.max(existing.remaining, ticks);
    else p.statuses.push({ kind, remaining: ticks });
    this.emit({ kind: "status-applied", player: p.id, status: kind, duration: seconds });
    return true;
  }

  /** Deep copy of the state for snapshots / replay comparison. */
  snapshot(): MatchState {
    return structuredClone(this.state);
  }

  // ------------------------------------------------------------------ events

  private emit(e: MatchEventPayload): void {
    const s = this.state;
    this.events.push({ ...e, tick: s.tick, time: s.time, half: s.half } as MatchEvent);
  }

  // ------------------------------------------------------------------ phases

  private periodLength(): number {
    return this.state.half === 3 ? this.overtimeSeconds : this.halfSeconds;
  }

  private placeForKickoff(): void {
    const s = this.state;
    for (const p of s.players) {
      p.pos = kickoffPosition(s.formations[p.team], p.role, this.attackDir(p.team));
      p.vel = v3(0, 0, 0);
      p.facing = v3(this.attackDir(p.team), 0, 0);
      p.hasBall = false;
      p.stun = 0;
      p.tackleCooldown = 0;
    }
    s.ball = { pos: v3(0, 0, 0), vel: v3(0, 0, 0), carrier: null, flight: null, lastTouch: null };
    s.possession = null;
    this.intents.clear();
  }

  private kickoff(): void {
    this.placeForKickoff();
    this.state.phase = "play";
    this.emit({ kind: "kickoff" });
  }

  private startReset(): void {
    const s = this.state;
    s.phase = "reset";
    s.resetTicks = SECS(RESET_FREEZE_SECONDS);
    for (const p of s.players) p.vel = v3(0, 0, 0);
    s.ball.vel = v3(0, 0, 0);
    s.ball.flight = null;
  }

  private endPeriod(): void {
    const s = this.state;
    if (s.half === 1) {
      this.emit({ kind: "half-time", score: [...s.score] });
      this.halfTimeRefill();
      s.half = 2;
      s.time = 0;
      s.attackDir = [s.attackDir[1], s.attackDir[0]];
      this.startReset();
      return;
    }
    if (s.half === 2 && this.overtime && s.score[0] === s.score[1]) {
      this.emit({ kind: "overtime-start", score: [...s.score] });
      this.halfTimeRefill();
      s.half = 3;
      s.time = 0;
      s.attackDir = [s.attackDir[1], s.attackDir[0]];
      this.startReset();
      return;
    }
    this.finish();
  }

  private halfTimeRefill(): void {
    for (const p of this.state.players) {
      p.hp = p.maxHp;
      for (const st of p.statuses) this.emit({ kind: "status-expired", player: p.id, status: st.kind });
      p.statuses = [];
      p.cooldowns = {};
      p.stun = 0;
      p.tackleCooldown = 0;
    }
  }

  private finish(): void {
    const s = this.state;
    s.phase = "finished";
    s.ball.flight = null;
    for (const p of s.players) p.vel = v3(0, 0, 0);
    this.emit({ kind: "full-time", score: [...s.score] });
  }

  private scoreGoal(by: PlayerState, keeperInReach: boolean): void {
    const s = this.state;
    s.score[by.team]++;
    s.ball.carrier = null;
    s.ball.flight = null;
    s.ball.lastTouch = by.team;
    for (const p of s.players) p.hasBall = false;
    this.emit({ kind: "goal", by: by.id, team: by.team, score: [...s.score], keeperInReach });
    if (s.half === 3) this.finish();
    else this.startReset();
  }

  // ------------------------------------------------------------------ per-tick phases

  private tickStatuses(): void {
    for (const p of this.state.players) {
      if (p.statuses.length === 0) continue;
      const keep = [];
      for (const st of p.statuses) {
        st.remaining--;
        if (st.kind === "poison") p.hp = Math.max(0, p.hp - POISON_HP_PER_SECOND * DT);
        if (st.remaining > 0) keep.push(st);
        else this.emit({ kind: "status-expired", player: p.id, status: st.kind });
      }
      p.statuses = keep;
    }
  }

  private tickTimers(): void {
    for (const p of this.state.players) {
      if (p.tackleCooldown > 0) p.tackleCooldown--;
      if (p.stun > 0) p.stun--;
      for (const id of Object.keys(p.cooldowns)) {
        p.cooldowns[id]--;
        if (p.cooldowns[id] <= 0) delete p.cooldowns[id];
      }
    }
  }

  private gatherIntents(inputs: MatchInput): void {
    for (const team of [0, 1] as const) {
      const input = team === 0 ? inputs.home : inputs.away;
      if (input.kind === "human") {
        const p = this.byId.get(input.controlledPlayerId);
        if (p && p.team === team) {
          this.intents.set(p.id, this.humanIntent(p, input));
          decideTeam(this, team, this.ai[team], p.id);
          continue;
        }
      }
      decideTeam(this, team, this.ai[team]);
    }
  }

  private humanIntent(p: PlayerState, input: HumanTeamInput): PlayerIntent {
    const intent: PlayerIntent = { move: normalize(input.move), sprint: input.sprint };
    const tech = input.technique ? getTechnique(input.technique) : undefined;
    let action: PlayerAction | undefined;
    if (p.hasBall) {
      if (input.shoot || tech?.kind === "shot") {
        action = { kind: "shoot", aim: bestShotAim(this, p), techniqueId: tech?.kind === "shot" ? tech.id : undefined };
      } else if (input.pass || tech?.kind === "pass") {
        const targetId = typeof input.pass === "string" ? input.pass : bestPassTarget(this, p)?.id;
        if (targetId) action = { kind: "pass", targetId, techniqueId: tech?.kind === "pass" ? tech.id : undefined };
      }
    } else if (input.tackle || tech?.kind === "tackle") {
      action = { kind: "tackle", techniqueId: tech?.kind === "tackle" ? tech.id : undefined };
    }
    intent.action = action;
    return intent;
  }

  /** Swim speed in units/s for this tick. */
  speedOf(p: PlayerState, sprint: boolean): number {
    const st = this.effectiveStats(p);
    let speed = BASE_SPEED + st.sp * SPEED_PER_SP;
    speed *= LOW_HP_SPEED_FLOOR + (1 - LOW_HP_SPEED_FLOOR) * (p.maxHp > 0 ? p.hp / p.maxHp : 0);
    if (sprint && p.hp > 0) speed *= SPRINT_MULT;
    if (p.hasBall) speed *= CARRY_SPEED_MULT;
    if (this.hasStatus(p, "nap")) speed *= NAP_SPEED_MULT;
    return speed;
  }

  private movePlayers(): void {
    const s = this.state;
    for (const p of s.players) {
      if (!this.canAct(p)) {
        p.vel = v3(0, 0, 0);
        continue;
      }
      const intent = this.intents.get(p.id);
      let dir = v3(0, 0, 0);
      if (intent?.move) dir = normalize(intent.move);
      else if (intent?.moveTo) {
        const d = sub(intent.moveTo, p.pos);
        if (len(d) > 0.35) dir = normalize(d);
      }
      if (isZero(dir)) {
        p.vel = v3(0, 0, 0);
        continue;
      }
      const sprint = !!intent?.sprint;
      const speed = this.speedOf(p, sprint);
      if (sprint) p.hp = Math.max(0, p.hp - SPRINT_HP_PER_SECOND * DT);
      p.vel = scale(dir, speed);
      p.facing = dir;
      p.pos = this.clampPlayer(p, add(p.pos, scale(p.vel, DT)));
    }
    // gentle separation so players never stack on one point
    const ps = s.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const d = sub(b.pos, a.pos);
        const l = len(d);
        const min = PLAYER_RADIUS * 2;
        if (l < min && l > 1e-6) {
          const push = scale(d, ((min - l) / l) * 0.5);
          a.pos = this.clampPlayer(a, sub(a.pos, push));
          b.pos = this.clampPlayer(b, add(b.pos, push));
        } else if (l <= 1e-6) {
          a.pos = this.clampPlayer(a, add(a.pos, v3(0, (i % 2 ? 1 : -1) * 0.5, 0)));
        }
      }
    }
  }

  private clampPlayer(p: PlayerState, pos: Vec3): Vec3 {
    const c = clampBox(pos, POOL_HALF);
    if (p.role === "GK") {
      // keeper stays inside the strip in front of its own goal
      const own = this.ownGoalCenter(p.team).x;
      const inward = own > 0 ? -1 : 1;
      const limit = own + inward * KEEPER_ZONE_DEPTH;
      if (inward > 0) c.x = Math.min(c.x, limit);
      else c.x = Math.max(c.x, limit);
      c.y = Math.max(-GOAL_HALF_HEIGHT - 2, Math.min(GOAL_HALF_HEIGHT + 2, c.y));
      c.z = Math.max(-GOAL_HALF_DEPTH - 2, Math.min(GOAL_HALF_DEPTH + 2, c.z));
    }
    return c;
  }

  private resolveActions(): void {
    const s = this.state;
    for (const p of s.players) {
      const intent = this.intents.get(p.id);
      const action = intent?.action;
      if (!action) continue;
      if (intent) intent.action = undefined;
      if (s.phase !== "play" || !this.canContest(p)) continue;
      if (action.kind === "tackle") this.doTackle(p, action.techniqueId);
      else if (!p.hasBall || s.ball.carrier !== p.id) continue;
      else if (action.kind === "pass" && action.targetId) this.doPass(p, action.targetId, action.techniqueId);
      else if (action.kind === "shoot") this.doShoot(p, action.aim ?? this.goalCenter(p.team), action.techniqueId);
    }
    // keeper hold limit: force a pass to the nearest teammate
    const carrier = s.ball.carrier ? this.player(s.ball.carrier) : null;
    if (carrier && carrier.role === "GK" && s.tick - carrier.receivedTick > SECS(KEEPER_MAX_HOLD_SECONDS)) {
      const mates = this.playersOf(carrier.team).filter((q) => q.id !== carrier.id);
      mates.sort((a, b) => dist(a.pos, carrier.pos) - dist(b.pos, carrier.pos));
      if (mates.length) this.doPass(carrier, mates[0].id);
    }
  }

  // ------------------------------------------------------------------ techniques & statuses

  private useTechnique(p: PlayerState, techniqueId: string | undefined, kind: TechniqueKind): Technique | undefined {
    if (!techniqueId || !this.canUseTechnique(p, techniqueId, kind)) return undefined;
    const t = getTechnique(techniqueId) as Technique;
    p.hp = Math.max(0, p.hp - t.hpCost);
    if (t.cooldown > 0) p.cooldowns[t.id] = SECS(t.cooldown);
    this.emit({ kind: "technique-used", by: p.id, techniqueId: t.id, team: p.team });
    if (t.techcopy) {
      for (const q of this.state.players) {
        if (q.id === p.id || q.techniques.includes(t.id)) continue;
        if (dist(q.pos, p.pos) > TECHCOPY_RADIUS) continue;
        if (this.rng.chance(TECHCOPY_CHANCE)) {
          q.techniques.push(t.id);
          this.emit({ kind: "techcopy", by: q.id, techniqueId: t.id, from: p.id, team: q.team });
        }
      }
    }
    return t;
  }

  /** Auto-fire the best usable block/catch technique for a defensive contest. */
  private autoTechnique(p: PlayerState, kind: "block" | "catch"): Technique | undefined {
    const usable = this.usableTechniques(p, kind);
    if (usable.length === 0) return undefined;
    return this.useTechnique(p, usable[0].id, kind);
  }

  private tryInflict(target: PlayerState, tech: Technique | undefined): void {
    if (!tech?.inflicts) return;
    if (this.rng.chance(tech.inflicts.chance)) this.applyStatus(target, tech.inflicts.kind, tech.inflicts.duration);
  }

  private spread(): number {
    return this.rng.spread(CONTEST_SPREAD_MIN, CONTEST_SPREAD_MAX);
  }

  // ------------------------------------------------------------------ actions

  private takeBall(p: PlayerState): void {
    const s = this.state;
    for (const q of s.players) q.hasBall = false;
    p.hasBall = true;
    s.ball.carrier = p.id;
    s.ball.flight = null;
    s.ball.pos = add(p.pos, scale(p.facing, CARRY_OFFSET));
    s.ball.vel = v3(0, 0, 0);
    s.possession = p.team;
    s.ball.lastTouch = p.team;
    p.receivedTick = s.tick;
    const intent = this.intents.get(p.id);
    if (intent) intent.action = undefined;
  }

  private dropBall(vel: Vec3): void {
    const s = this.state;
    for (const q of s.players) q.hasBall = false;
    s.ball.carrier = null;
    s.ball.flight = null;
    s.ball.vel = vel;
    s.possession = null;
  }

  /** Random lateral offset perpendicular to dir, scaled by distance / accuracy. */
  private missOffset(dir: Vec3, distance: number, spread: number, accuracy: number): Vec3 {
    const r = v3(this.rng.float() - 0.5, this.rng.float() - 0.5, this.rng.float() - 0.5);
    const perp = normalize(sub(r, scale(dir, dot(r, dir))));
    const amount = (this.rng.float() * 2 - 1) * spread * (distance / accuracy);
    return scale(perp, amount);
  }

  private doPass(p: PlayerState, targetId: string, techniqueId?: string): void {
    const target = this.byId.get(targetId);
    if (!target || target.id === p.id || target.team !== p.team) return;
    const tech = this.useTechnique(p, techniqueId, "pass");
    const pa = this.effectiveStats(p).pa + (tech?.statMods.pa ?? 0);
    const s = this.state;
    let aim = add(target.pos, scale(target.vel, PASS_LEAD_SECONDS));
    const dir0 = normalize(sub(aim, s.ball.pos));
    const distance = dist(aim, s.ball.pos);
    aim = add(aim, this.missOffset(dir0, distance, PASS_MISS_SPREAD, pa + PASS_ACCURACY_BASE));
    const dir = normalize(sub(aim, s.ball.pos));
    const speed = PASS_BASE_SPEED + pa * PASS_SPEED_PER_PA;
    const flight: BallFlight = {
      kind: "pass",
      from: p.id,
      to: target.id,
      team: p.team,
      power: pa,
      contested: [],
      aim,
      travelled: 0,
      aimDistance: distance,
      techniqueId: tech?.id,
    };
    this.dropBall(scale(dir, speed));
    s.ball.flight = flight;
    s.ball.lastTouch = p.team;
    s.possession = p.team;
    p.facing = dir;
    this.emit({ kind: "pass", from: p.id, to: target.id, team: p.team, techniqueId: tech?.id });
  }

  private doShoot(p: PlayerState, aimPoint: Vec3, techniqueId?: string): void {
    const tech = this.useTechnique(p, techniqueId, "shot");
    const sh = this.effectiveStats(p).sh + (tech?.statMods.sh ?? 0);
    const s = this.state;
    const dir0 = normalize(sub(aimPoint, s.ball.pos));
    const distance = dist(aimPoint, s.ball.pos);
    const aim = add(aimPoint, this.missOffset(dir0, distance, SHOT_MISS_SPREAD, sh + SHOT_ACCURACY_BASE));
    const dir = normalize(sub(aim, s.ball.pos));
    const speed = SHOT_BASE_SPEED + sh * SHOT_SPEED_PER_SH;
    const power = sh * this.spread();
    const flight: BallFlight = {
      kind: "shot",
      from: p.id,
      team: p.team,
      power,
      contested: [],
      aim,
      travelled: 0,
      aimDistance: distance,
      techniqueId: tech?.id,
    };
    this.dropBall(scale(dir, speed));
    s.ball.flight = flight;
    s.ball.lastTouch = p.team;
    s.possession = p.team;
    p.facing = dir;
    this.emit({ kind: "shot", by: p.id, team: p.team, power, techniqueId: tech?.id });
  }

  private doTackle(p: PlayerState, techniqueId?: string): void {
    const s = this.state;
    if (!s.ball.carrier || p.tackleCooldown > 0) return;
    const c = this.player(s.ball.carrier);
    if (c.team === p.team || dist(c.pos, p.pos) > TACKLE_RANGE) return;
    const tech = this.useTechnique(p, techniqueId, "tackle");
    const at = (this.effectiveStats(p).at + (tech?.statMods.at ?? 0)) * this.spread();
    const en = this.effectiveStats(c).en * this.spread();
    p.hp = Math.max(0, p.hp - TACKLE_HP_COST);
    c.hp = Math.max(0, c.hp - BREAKTHROUGH_HP_COST);
    p.tackleCooldown = SECS(TACKLE_COOLDOWN_SECONDS);
    if (at > en) {
      c.stun = SECS(TACKLED_STUN_SECONDS);
      this.takeBall(p);
      this.emit({ kind: "tackle", by: p.id, on: c.id, team: p.team, techniqueId: tech?.id });
      this.tryInflict(c, tech);
    } else {
      p.stun = SECS(TACKLE_WHIFF_STUN_SECONDS);
      this.emit({ kind: "breakthrough", carrier: c.id, tackler: p.id, team: c.team });
    }
  }

  // ------------------------------------------------------------------ ball

  private updateBall(): void {
    const s = this.state;
    const b = s.ball;
    if (b.carrier) {
      const c = this.player(b.carrier);
      b.pos = add(c.pos, scale(c.facing, CARRY_OFFSET));
      b.vel = c.vel;
      return;
    }
    const step = scale(b.vel, DT);
    b.pos = add(b.pos, step);
    if (b.flight) {
      b.flight.travelled += len(step);
      if (b.flight.kind === "pass") this.flightPass(b.flight);
      else this.flightShot(b.flight);
      return;
    }
    // loose ball: drag, bounce, pickup
    b.vel = scale(b.vel, LOOSE_DRAG_PER_TICK);
    this.bounce();
    let best: PlayerState | null = null;
    let bestD = PICKUP_RADIUS;
    for (const p of s.players) {
      if (!this.canContest(p)) continue;
      const d = dist(p.pos, b.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      this.takeBall(best);
      this.emit({ kind: "pickup", by: best.id, team: best.team });
    }
  }

  private bounce(): void {
    const b = this.state.ball;
    const axes = ["x", "y", "z"] as const;
    for (const a of axes) {
      if (b.pos[a] > POOL_HALF[a]) {
        b.pos[a] = POOL_HALF[a];
        b.vel[a] = -Math.abs(b.vel[a]) * WALL_BOUNCE;
      } else if (b.pos[a] < -POOL_HALF[a]) {
        b.pos[a] = -POOL_HALF[a];
        b.vel[a] = Math.abs(b.vel[a]) * WALL_BOUNCE;
      }
    }
  }

  private passPower(f: BallFlight): number {
    return f.power * Math.max(PASS_MIN_POWER_FRAC, 1 - f.travelled / PASS_RANGE_FULL);
  }

  private flightPass(f: BallFlight): void {
    const s = this.state;
    const b = s.ball;
    const tech = f.techniqueId ? getTechnique(f.techniqueId) : undefined;
    // interception attempts by opponents in reach (one try per defender per pass)
    for (const q of s.players) {
      if (f.travelled < PASS_CONTEST_MIN_TRAVEL) break;
      if (q.team === f.team || f.contested.includes(q.id) || !this.canContest(q)) continue;
      const reach = BLOCK_REACH_BASE + this.effectiveStats(q).bl * BLOCK_REACH_PER_BL;
      if (dist(q.pos, b.pos) > reach) continue;
      // only a defender the ball is still approaching (or level with) can reach it
      if (dot(b.vel, sub(q.pos, b.pos)) < -0.5 * reach * len(b.vel)) continue;
      const blockTech = this.autoTechnique(q, "block");
      const bl = (this.effectiveStats(q).bl + (blockTech?.statMods.bl ?? 0)) * this.spread();
      const pa = this.passPower(f) * this.spread();
      f.contested.push(q.id);
      if (bl > pa) {
        this.takeBall(q);
        this.emit({ kind: "pass-intercepted", from: f.from, to: f.to as string, by: q.id, team: q.team });
        return;
      }
      this.tryInflict(q, tech);
    }
    // catch by the intended receiver
    const target = this.player(f.to as string);
    if (this.canContest(target) && dist(target.pos, b.pos) <= CATCH_RADIUS) {
      this.takeBall(target);
      this.emit({ kind: "pass-complete", from: f.from, to: target.id, team: f.team });
      return;
    }
    // overshoot or wall -> loose ball
    const outside =
      Math.abs(b.pos.x) > POOL_HALF.x || Math.abs(b.pos.y) > POOL_HALF.y || Math.abs(b.pos.z) > POOL_HALF.z;
    if (f.travelled > f.aimDistance + PASS_OVERSHOOT || outside) {
      b.flight = null;
      b.vel = scale(b.vel, 0.3);
      s.possession = null;
      this.bounce();
    }
  }

  private flightShot(f: BallFlight): void {
    const s = this.state;
    const b = s.ball;
    const tech = f.techniqueId ? getTechnique(f.techniqueId) : undefined;
    const defending = (1 - f.team) as Team;
    f.power -= SHOT_POWER_DECAY_PER_UNIT * len(scale(b.vel, DT));
    // blockers (outfield opponents) chip away at the shot power
    for (const q of s.players) {
      if (q.team === f.team || q.role === "GK" || f.contested.includes(q.id) || !this.canContest(q)) continue;
      const reach = BLOCK_REACH_BASE + this.effectiveStats(q).bl * BLOCK_REACH_PER_BL;
      if (dist(q.pos, b.pos) > reach) continue;
      const blockTech = this.autoTechnique(q, "block");
      const bl = (this.effectiveStats(q).bl + (blockTech?.statMods.bl ?? 0)) * this.spread();
      f.contested.push(q.id);
      f.power -= bl * SHOT_BLOCK_FACTOR;
      if (f.power <= 0) {
        this.takeBall(q);
        this.emit({ kind: "shot-blocked", by: f.from, blocker: q.id, team: f.team });
        return;
      }
      this.tryInflict(q, tech);
    }
    // goal plane
    const goalX = POOL_HALF.x * this.attackDir(f.team);
    const crossed = (b.pos.x - goalX) * this.attackDir(f.team) >= 0;
    const keeper = this.keeperOf(defending);
    if (crossed) {
      const onTarget = Math.abs(b.pos.y) <= GOAL_HALF_HEIGHT && Math.abs(b.pos.z) <= GOAL_HALF_DEPTH;
      if (onTarget) {
        const crossing = v3(goalX, b.pos.y, b.pos.z);
        const kst = this.effectiveStats(keeper);
        const reach = SAVE_RADIUS_BASE + kst.ca * SAVE_RADIUS_PER_CA;
        const inReach = this.canContest(keeper) && dist(keeper.pos, crossing) <= reach;
        if (inReach) {
          const catchTech = this.autoTechnique(keeper, "catch");
          const ca = (kst.ca + (catchTech?.statMods.ca ?? 0)) * KEEPER_SAVE_MULT * this.spread();
          this.tryInflict(keeper, tech);
          if (ca >= f.power) {
            this.takeBall(keeper);
            this.emit({ kind: "save", keeper: keeper.id, shooter: f.from, team: defending });
            return;
          }
        }
        this.scoreGoal(this.player(f.from), inReach);
        return;
      }
      this.outOfBounds(keeper);
      return;
    }
    if (Math.abs(b.pos.y) > POOL_HALF.y || Math.abs(b.pos.z) > POOL_HALF.z) this.outOfBounds(keeper);
  }

  private outOfBounds(keeper: PlayerState): void {
    keeper.pos = add(this.ownGoalCenter(keeper.team), v3(this.attackDir(keeper.team) * 1.5, 0, 0));
    this.takeBall(keeper);
    this.emit({ kind: "out-of-bounds-reset", toTeam: keeper.team, toPlayer: keeper.id });
  }

  // ------------------------------------------------------------------ geometry helpers for AI

  /** Distance from the nearest opponent to the segment a-b (strictly between the ends). */
  laneClearance(team: Team, a: Vec3, b: Vec3): number {
    let min = Number.POSITIVE_INFINITY;
    for (const q of this.opponentsOf(team)) {
      if (!this.canContest(q)) continue;
      const r = distToSegment(q.pos, a, b);
      if (r.t > 0.05 && r.t < 0.98 && r.d < min) min = r.d;
    }
    return min;
  }

  nearestOpponentDistance(p: PlayerState): number {
    let min = Number.POSITIVE_INFINITY;
    for (const q of this.opponentsOf(p.team)) {
      const d = dist(q.pos, p.pos);
      if (d < min) min = d;
    }
    return min;
  }

  /** Reach used by defenders to block passes and shots. */
  blockReach(p: PlayerState): number {
    return BLOCK_REACH_BASE + this.effectiveStats(p).bl * BLOCK_REACH_PER_BL;
  }

  /** Keeper save reach. */
  saveReach(keeper: PlayerState): number {
    return SAVE_RADIUS_BASE + this.effectiveStats(keeper).ca * SAVE_RADIUS_PER_CA;
  }

  get tackleRange(): number {
    return TACKLE_RANGE;
  }
}
