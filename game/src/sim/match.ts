/**
 * match.ts - The Match class: fixed-timestep (60 Hz) headless blitzball sim.
 *
 * One call to step(inputs) advances exactly one tick. The class owns the
 * complete MatchState (clock, halves, score, players, ball), the seeded Rng
 * and an append-only event log. The contest rules are the ones extracted from
 * the original match script (tools/docs/formulas.md), mapped onto real time:
 *   - no stop-and-pick encounters: defenders tackle when they reach the
 *     carrier, and the opponents around a passer / shooter at launch become
 *     the blockers of that pass / shot (plus, as a sim extension, defenders
 *     the ball flies past)
 *   - tackle r = AT'/2 + rand(AT') vs the carrier's working EN (chained per
 *     encounter), block r = BL/2 + rand(BL+1) subtracted from PA'/SH', flight
 *     decay per 100 original units, goalie g = CA'/2 + rand(CA')
 *   - HP: pass costs PA, shot costs SH, carrier drain / regen tick, Venom,
 *     Nap, Wither, Drain, Anti-*, every passive technique, techcopy and the
 *     per-action EXP table with the 250 cap and Hi-Risk doubling
 *   - the clock runs in game-seconds (FRAMES_PER_GAME_SECOND), two halves with
 *     a side swap, optional overtime, blitz-off at kickoff and after goals
 * Where formulas.md marks something unknown (throw-ins, half-time HP, sprint,
 * pass targeting) the previous sim behaviour is kept and commented.
 * No DOM, no Three.js: this file must stay importable from node tests.
 */

import { bestPassTarget, bestShotAim, decideTeam, resolveAiProfile, type TeamAiProfile } from "./ai";
import {
  AIMED_SHOT_CATCH_RADIUS,
  BALL_LOST_STUN_FRAMES,
  BLOCK_REACH_BASE,
  BLOCK_REACH_PER_BL,
  BRAWLER_EXTRA_RADIUS,
  CARRY_OFFSET,
  CARRY_SPEED_MULT,
  CATCH_RADIUS,
  DEFAULT_HALF_SECONDS,
  DEFAULT_OVERTIME_SECONDS,
  DEFENDER_LOCK_RADIUS,
  DEFLECT_SPEED,
  DEFLECT_WINDOW_BASE,
  DT,
  ELITE_DEFENSE_EXTRA_RADIUS,
  ENCOUNTER_RADIUS,
  EXP_AIMED_CATCH,
  EXP_BLOCK,
  EXP_BREAKTHROUGH,
  EXP_CAP,
  EXP_GAMBLE,
  EXP_GOAL,
  EXP_GOALIE_CATCH,
  EXP_GOALIE_START,
  EXP_GOOD_MORNING,
  EXP_PASS_COMPLETE,
  EXP_RESIST,
  EXP_SUPER_GOALIE,
  EXP_TACKLE_MISSED,
  EXP_VOLLEY,
  FLIGHT_DECAY_DISTANCE,
  FRAMES_PER_GAME_SECOND,
  FUMBLE_SPEED,
  framesToTicks,
  GAMBLE_CHANCE,
  GAMBLE_FRAMES,
  GAMBLE_HP,
  GOAL_HALF_DEPTH,
  GOAL_HALF_HEIGHT,
  GOALIE_PASSIVE_HP,
  GOOD_MORNING_CHANCE,
  GOOD_MORNING_HP,
  HP_TICK_CARRIER_STEP,
  HP_TICK_CARRIER_STEP_POISONED,
  HP_TICK_EVERY_FRAMES,
  HP_TICK_LIMIT,
  HP_TICK_REGEN_BONUS,
  KEEPER_MAX_HOLD_SECONDS,
  KEEPER_ZONE_DEPTH,
  LOOSE_DRAG_PER_TICK,
  MAX_ENCOUNTER_DEFENDERS,
  NAP_FRAMES,
  ORIG_UNITS_PER_POOL_UNIT,
  PASS_BASE_SPEED,
  PASS_CONTEST_MIN_TRAVEL,
  PASS_LEAD_SECONDS,
  PASS_OVERSHOOT,
  PASS_SPEED_PER_PA,
  PICKUP_RADIUS,
  PILE_VENOM_CAP,
  PLAYER_RADIUS,
  POISON_DRAIN,
  POOL_HALF,
  POOL_RADIUS,
  RESET_FREEZE_SECONDS,
  SHOT_ACCURACY_BASE,
  SHOT_BASE_SPEED,
  SHOT_MISS_SPREAD,
  SHOT_SPEED_PER_SH,
  SPEED_BASE,
  SPEED_PER_SP,
  SPRINT_HP_PER_SECOND,
  SPRINT_MULT,
  SUPER_GOALIE_BONUS,
  SUPER_GOALIE_CHANCE,
  TACKLE_COOLDOWN_SECONDS,
  TACKLE_WHIFF_STUN_SECONDS,
  TICK_RATE,
  VENOM_FRAMES,
  WALL_BOUNCE,
  WITHER_FRAMES,
} from "./constants";
import { FORMATIONS, kickoffPosition, slotToWorld } from "./formations";
import { AI_INPUT, type HumanTeamInput, type MatchInput, type PlayerAction, type PlayerIntent } from "./input";
import { Rng } from "./rng";
import { blockRoll, boosted, flightDecay, goalieRoll, shotInRange, tackleRoll, techcopyRoll } from "./rules";
import { getTechnique, START_COST_PASSIVES, TECH_FLAG } from "./techniques";
import {
  type BallFlight,
  type ChanceCost,
  CONTEST_STATS,
  type ContestStat,
  type FormationId,
  type MarkAssignments,
  type MatchEvent,
  type MatchEventPayload,
  type MatchState,
  type Passives,
  type PlayerDef,
  type PlayerState,
  ROLE_ORDER,
  type Stats,
  type StatusFamily,
  type StatusKind,
  type TeamDef,
  type Technique,
  type TechniqueKind,
} from "./types";
import {
  add,
  clampBox,
  clampSphere,
  dist,
  distToSegment,
  dot,
  isZero,
  len,
  normalize,
  scale,
  sub,
  type Vec3,
  v3,
} from "./vec";

export interface MatchOptions {
  seed: number;
  /** Game-seconds per half (default 300 = 5:00). */
  halfSeconds?: number;
  overtime?: boolean;
  overtimeSeconds?: number;
  /** Ticks per game-second of the clock (default FRAMES_PER_GAME_SECOND). */
  framesPerGameSecond?: number;
  /** AI difficulty for both AI-controlled teams ("easy" | "normal" | "hard" or a custom object). */
  difficulty?: Parameters<typeof resolveAiProfile>[1];
}

type Team = 0 | 1;

const SECS = (s: number) => Math.round(s * TICK_RATE);

/** Resolve the passive techniques of a player from its equipped list (formulas.md section 1). */
export function resolvePassives(techniqueIds: readonly number[]): Passives {
  const p: Passives = {
    eliteDefense: false,
    goldenArm: false,
    pileVenom: false,
    pileWither: false,
    hiRisk: false,
    regen: false,
    superGoalie: false,
    spinBall: false,
    gripGloves: false,
    goodMorning: false,
    gamble: false,
    brawler: null,
    tackleSlip: null,
    volley: null,
    anti: {},
  };
  // the match keeps max(chancePct) and max(hpCost) over the equipped techs of each family
  const best = (cur: ChanceCost | null, t: Technique): ChanceCost => ({
    chance: Math.max(cur?.chance ?? 0, t.chancePct),
    cost: Math.max(cur?.cost ?? 0, t.hpCost),
  });
  for (const id of techniqueIds) {
    const t = getTechnique(id);
    if (!t) continue;
    if (t.passive) {
      if (t.passive === "brawler") p.brawler = best(p.brawler, t);
      else p[t.passive] = true;
    }
    if (t.kind === "guard" && t.family) p.anti[t.family] = best(p.anti[t.family] ?? null, t);
    if (t.flags & TECH_FLAG.tackleSlip) p.tackleSlip = best(p.tackleSlip, t);
    if (t.volley) p.volley = best(p.volley, t);
  }
  return p;
}

export class Match {
  readonly teams: [TeamDef, TeamDef];
  readonly state: MatchState;
  readonly events: MatchEvent[] = [];
  readonly rng: Rng;
  readonly halfSeconds: number;
  readonly overtime: boolean;
  readonly overtimeSeconds: number;
  readonly framesPerGameSecond: number;
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
    this.framesPerGameSecond = opts.framesPerGameSecond ?? FRAMES_PER_GAME_SECOND;
    this.ai = [
      resolveAiProfile(home.personality, opts.difficulty),
      resolveAiProfile(away.personality, opts.difficulty),
    ];

    const players: PlayerState[] = [];
    for (const team of [0, 1] as const) {
      const def = this.teams[team];
      for (let i = 0; i < 6; i++) {
        const p = this.createPlayer(def, def.players[i], team, i);
        if (this.byId.has(p.id)) throw new Error(`duplicate player id ${p.id}`);
        this.byId.set(p.id, p);
        players.push(p);
      }
    }

    this.state = {
      tick: 0,
      periodTicks: 0,
      time: 0,
      half: 1,
      phase: "reset",
      resetTicks: SECS(RESET_FREEZE_SECONDS),
      score: [0, 0],
      possession: null,
      possessionTicks: [0, 0],
      attackDir: [1, -1],
      formations: [home.formation, away.formation],
      marks: [{ ...home.marks }, { ...away.marks }],
      players,
      ball: { pos: v3(0, 0, 0), vel: v3(0, 0, 0), carrier: null, flight: null, lastTouch: null },
      rngState: this.rng.state,
    };
    // both goalies +2 EXP at match start
    for (const team of [0, 1] as const) this.awardExp(this.keeperOf(team), EXP_GOALIE_START);
    this.placeForKickoff();
  }

  private createPlayer(def: TeamDef, pd: PlayerDef, team: Team, slot: number): PlayerState {
    const passives = resolvePassives(pd.techniques);
    // Passive techs pay their hpCost at match start; if HP < cost the tech is
    // disabled and HP set to 0 (formulas.md section 1). The script repeats
    // the deduction after every encounter; we read that as "0080 is derived
    // from 0040 minus the costs", i.e. a once-only reduction of the ceiling.
    let hp = pd.stats.hp;
    for (const kind of START_COST_PASSIVES) {
      if (!passives[kind]) continue;
      const tech = pd.techniques.map((id) => getTechnique(id)).find((t) => t?.passive === kind);
      const cost = tech?.hpCost ?? 0;
      if (hp < cost) {
        passives[kind] = false;
        hp = 0;
      } else hp -= cost;
    }
    return {
      id: pd.id,
      teamId: def.id,
      team,
      role: ROLE_ORDER[slot],
      def: pd,
      pos: v3(0, 0, 0),
      vel: v3(0, 0, 0),
      facing: v3(team === 0 ? 1 : -1, 0, 0),
      hp,
      maxHp: pd.stats.hp,
      effectiveMaxHp: hp,
      exp: 0,
      passives,
      hpCounter: 0,
      drainPerTick: 1,
      poisonTicks: 0,
      sleepTicks: 0,
      wither: {},
      override: {},
      overrideEveryTicks: 1,
      overrideCounter: 0,
      gambleTicks: 0,
      gambleStats: null,
      contestEn: null,
      techniques: [...pd.techniques],
      learned: [],
      tackleCooldown: 0,
      stun: 0,
      hasBall: false,
      receivedTick: 0,
    };
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
    s.periodTicks++;
    s.time = s.periodTicks / this.framesPerGameSecond;
    this.tickStatuses();
    this.tickHp();
    this.tickTimers();
    this.gatherIntents(inputs);
    this.movePlayers();
    this.trackEncounters();
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

  /** Replace a team's Mark Mode assignments (roles left out fall back to the formation preset). */
  setMarks(team: Team, marks: MarkAssignments): void {
    this.state.marks[team] = { ...marks };
  }

  /** The opposing player this player marks: the team's Mark Mode choice, else the formation preset (null = press). */
  markTarget(p: PlayerState): PlayerState | null {
    const override = this.state.marks[p.team][p.role];
    const role = override !== undefined ? override : FORMATIONS[this.state.formations[p.team]].marks[p.role];
    if (!role) return null;
    const other = (1 - p.team) as Team;
    return this.state.players.find((q) => q.team === other && q.role === role) ?? null;
  }

  /**
   * Current stats (formulas.md section 1 "stat refresh"): max, withered stats
   * divided, PA / SH halved while HP is below them, everything halved by
   * Hi-Risk, zero -> 1, then Good Morning! overrides and Gamble values.
   */
  effectiveStats(p: PlayerState): Stats {
    const s: Stats = { ...p.def.stats };
    for (const k of CONTEST_STATS) {
      const w = p.wither[k];
      if (w) s[k] = Math.floor(s[k] / w.divisor);
    }
    if (p.hp < s.pa) s.pa = Math.floor(s.pa / 2);
    if (p.hp < s.sh) s.sh = Math.floor(s.sh / 2);
    if (p.passives.hiRisk) for (const k of CONTEST_STATS) s[k] = Math.floor(s[k] / 2);
    for (const k of CONTEST_STATS) if (s[k] === 0) s[k] = 1;
    for (const k of CONTEST_STATS) {
      const o = p.override[k];
      if (o !== undefined && o > 0) s[k] = o;
    }
    if (p.gambleTicks > 0 && p.gambleStats) for (const k of CONTEST_STATS) s[k] = p.gambleStats[k];
    return s;
  }

  hasStatus(p: PlayerState, kind: StatusKind): boolean {
    if (kind === "poison") return p.poisonTicks > 0;
    if (kind === "sleep") return p.sleepTicks > 0;
    return Object.keys(p.wither).length > 0;
  }

  isAsleep(p: PlayerState): boolean {
    return p.sleepTicks > 0;
  }

  /** Can move / act this tick (not asleep, not stunned). */
  canAct(p: PlayerState): boolean {
    return !this.isAsleep(p) && p.stun <= 0;
  }

  /** Can take a contest action (alias kept for the AI / tests). */
  canContest(p: PlayerState): boolean {
    return this.canAct(p);
  }

  /**
   * Whether a shot / pass / tackle technique may be used now (formulas.md
   * section 2): shot techs need HP >= cost + SH max and no poison, pass techs
   * HP >= cost + PA max and poison multiplier < 64, tackle techs HP >= cost
   * and multiplier < 16.
   */
  canUseTechnique(p: PlayerState, techniqueId: number, kind?: TechniqueKind): boolean {
    const t = getTechnique(techniqueId);
    if (!t || (t.kind !== "shot" && t.kind !== "pass" && t.kind !== "tackle")) return false;
    if (kind && t.kind !== kind) return false;
    if (!p.techniques.includes(techniqueId) || !this.canAct(p)) return false;
    if (t.volley) return false; // Volley Shots fire on their own
    if (t.kind === "shot") return p.hp >= t.hpCost + p.def.stats.sh && p.drainPerTick < 4;
    if (t.kind === "pass") return p.hp >= t.hpCost + p.def.stats.pa && p.drainPerTick < 64;
    return p.hp >= t.hpCost && p.drainPerTick < 16;
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

  /**
   * Scenario / test helper: apply a status directly (no chance roll, no
   * Anti-* check). Duration in original frames; defaults per formulas.md.
   */
  applyStatus(p: PlayerState, kind: StatusKind, frames?: number, stat?: ContestStat): void {
    if (kind === "poison") {
      p.drainPerTick = POISON_DRAIN;
      p.poisonTicks = framesToTicks(frames ?? VENOM_FRAMES);
    } else if (kind === "sleep") {
      p.sleepTicks = framesToTicks(frames ?? NAP_FRAMES);
      p.vel = v3(0, 0, 0);
    } else {
      const k = stat ?? CONTEST_STATS[this.rng.rand(CONTEST_STATS.length)];
      p.wither[k] = { remaining: framesToTicks(frames ?? WITHER_FRAMES), divisor: 2 };
      this.emit({ kind: "status-applied", player: p.id, status: kind, duration: frames ?? WITHER_FRAMES, stat: k });
      return;
    }
    this.emit({ kind: "status-applied", player: p.id, status: kind, duration: frames ?? 0 });
  }

  /** Pending EXP award: n * (1 + HiRisk), capped at EXP_CAP per match. */
  awardExp(p: PlayerState, n: number): void {
    p.exp = Math.min(EXP_CAP, p.exp + n * (1 + (p.passives.hiRisk ? 1 : 0)));
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
      p.contestEn = null;
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
      s.periodTicks = 0;
      s.attackDir = [s.attackDir[1], s.attackDir[0]];
      this.startReset();
      return;
    }
    if (s.half === 2 && this.overtime && s.score[0] === s.score[1]) {
      this.emit({ kind: "overtime-start", score: [...s.score] });
      this.halfTimeRefill();
      s.half = 3;
      s.time = 0;
      s.periodTicks = 0;
      s.attackDir = [s.attackDir[1], s.attackDir[0]];
      this.startReset();
      return;
    }
    this.finish();
  }

  /**
   * Half-time: HP back to the effective maximum and statuses cleared. The
   * original script does not show what happens to HP and statuses at the
   * break (formulas.md section 7), so the previous sim behaviour is kept.
   */
  private halfTimeRefill(): void {
    for (const p of this.state.players) {
      p.hp = p.effectiveMaxHp;
      this.clearStatuses(p);
      p.stun = 0;
      p.tackleCooldown = 0;
      p.contestEn = null;
    }
  }

  private clearStatuses(p: PlayerState): void {
    if (p.poisonTicks > 0) this.emit({ kind: "status-expired", player: p.id, status: "poison" });
    if (p.sleepTicks > 0) this.emit({ kind: "status-expired", player: p.id, status: "sleep" });
    p.poisonTicks = 0;
    p.sleepTicks = 0;
    p.drainPerTick = 1;
    this.cureWither(p);
    p.override = {};
    p.gambleTicks = 0;
    p.gambleStats = null;
  }

  private cureWither(p: PlayerState): void {
    for (const k of CONTEST_STATS) {
      if (p.wither[k]) this.emit({ kind: "status-expired", player: p.id, status: "wither", stat: k });
    }
    p.wither = {};
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
    this.awardExp(by, EXP_GOAL);
    this.emit({ kind: "goal", by: by.id, team: by.team, score: [...s.score], keeperInReach });
    // Overtime: whether the first goal ends it is UNCERTAIN in formulas.md; sudden death is kept.
    if (s.half === 3) this.finish();
    else this.startReset();
  }

  // ------------------------------------------------------------------ per-tick phases

  /** Status timers (formulas.md section 4), Good Morning! decay and Gamble timer. */
  private tickStatuses(): void {
    for (const p of this.state.players) {
      if (p.poisonTicks > 0 && --p.poisonTicks === 0) {
        p.drainPerTick = 1;
        this.emit({ kind: "status-expired", player: p.id, status: "poison" });
      }
      if (p.sleepTicks > 0 && --p.sleepTicks === 0)
        this.emit({ kind: "status-expired", player: p.id, status: "sleep" });
      for (const k of CONTEST_STATS) {
        const w = p.wither[k];
        if (w && --w.remaining <= 0) {
          delete p.wither[k];
          this.emit({ kind: "status-expired", player: p.id, status: "wither", stat: k });
        }
      }
      if (Object.keys(p.override).length > 0 && ++p.overrideCounter >= p.overrideEveryTicks) {
        p.overrideCounter = 0;
        for (const k of CONTEST_STATS) {
          const o = p.override[k];
          if (o === undefined) continue;
          if (o <= 1) delete p.override[k];
          else p.override[k] = o - 1;
        }
      }
      if (p.gambleTicks > 0 && --p.gambleTicks === 0) p.gambleStats = null;
    }
  }

  /**
   * HP tick (formulas.md section 3, runs every 3 original frames):
   *   carrier: counter -= 2 (8 poisoned); below 0 -> HP -= drain, counter = 16
   *   others, not poisoned: counter += 1 (+3 Regen); above 16 -> +1 HP up to
   *   the effective max, counter = 0
   */
  private tickHp(): void {
    if (this.state.tick % framesToTicks(HP_TICK_EVERY_FRAMES) !== 0) return;
    const carrier = this.state.ball.carrier;
    for (const p of this.state.players) {
      const poisoned = p.poisonTicks > 0;
      if (p.id === carrier) {
        p.hpCounter -= poisoned ? HP_TICK_CARRIER_STEP_POISONED : HP_TICK_CARRIER_STEP;
        if (p.hpCounter < 0) {
          p.hp = Math.max(0, p.hp - p.drainPerTick);
          p.hpCounter = HP_TICK_LIMIT;
        }
      } else if (!poisoned) {
        p.hpCounter += 1 + (p.passives.regen ? HP_TICK_REGEN_BONUS : 0);
        if (p.hpCounter > HP_TICK_LIMIT) {
          if (p.hp < p.effectiveMaxHp) p.hp++;
          p.hpCounter = 0;
        }
      }
    }
  }

  private tickTimers(): void {
    for (const p of this.state.players) {
      if (p.tackleCooldown > 0) p.tackleCooldown--;
      if (p.stun > 0) p.stun--;
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
    const tech = input.technique !== undefined ? getTechnique(input.technique) : undefined;
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

  /** Swim speed in pool units/s: proportional to SP (sprint is a sim extension). */
  speedOf(p: PlayerState, sprint: boolean): number {
    let speed = SPEED_BASE + this.effectiveStats(p).sp * SPEED_PER_SP;
    if (sprint && p.hp > 0) speed *= SPRINT_MULT;
    if (p.hasBall) speed *= CARRY_SPEED_MULT;
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
    const c = clampSphere(clampBox(pos, POOL_HALF), POOL_RADIUS - PLAYER_RADIUS);
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

  /**
   * Encounter bookkeeping: while at least one opponent is inside the
   * encounter radius the carrier's working EN is kept (and reduced by every
   * breakthrough); it resets to the current EN when the encounter ends.
   */
  private trackEncounters(): void {
    const s = this.state;
    for (const p of s.players) {
      if (p.id !== s.ball.carrier) {
        p.contestEn = null;
        continue;
      }
      const near = this.encounterDefenders(p).length > 0;
      if (!near) p.contestEn = null;
      else if (p.contestEn === null) p.contestEn = this.effectiveStats(p).en;
    }
  }

  /**
   * Opponents forming the encounter around a carrier (formulas.md section 2):
   * within the encounter radius (+Brawler range when it fires and pays),
   * awake, not the goalie, not already spent on a tackle; at most five,
   * sorted by current AT descending.
   */
  encounterDefenders(carrier: PlayerState, brawlerMayFire = false): PlayerState[] {
    const out: { p: PlayerState; at: number }[] = [];
    for (const q of this.opponentsOf(carrier.team)) {
      if (q.role === "GK" || this.isAsleep(q) || q.tackleCooldown > 0) continue;
      const d = dist(q.pos, carrier.pos);
      let joins = d < ENCOUNTER_RADIUS;
      if (!joins && q.passives.brawler && d < ENCOUNTER_RADIUS + BRAWLER_EXTRA_RADIUS) {
        const b = q.passives.brawler;
        if (b.cost > 0 && q.hp >= b.cost) {
          if (brawlerMayFire) {
            if (b.chance > this.rng.pct()) {
              q.hp -= b.cost;
              joins = true;
            }
          } else joins = true; // planning view: assume Brawler reaches
        }
      }
      if (joins) out.push({ p: q, at: this.effectiveStats(q).at });
    }
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, MAX_ENCOUNTER_DEFENDERS).map((e) => e.p);
  }

  /** Distance within which a defender locks onto the carrier (Elite Defense extends it). */
  lockRadius(p: PlayerState): number {
    return DEFENDER_LOCK_RADIUS + (p.passives.eliteDefense ? ELITE_DEFENSE_EXTRA_RADIUS : 0);
  }

  /** Tackle reach of a defender against a carrier (encounter radius, Brawler extends it). */
  tackleReach(p: PlayerState): number {
    return ENCOUNTER_RADIUS + (p.passives.brawler ? BRAWLER_EXTRA_RADIUS : 0);
  }

  /** CPU shot-range rule of formulas.md section 8 for this carrier. */
  shotInRange(p: PlayerState): boolean {
    const d = dist(p.pos, this.goalCenter(p.team)) * ORIG_UNITS_PER_POOL_UNIT;
    return shotInRange(this.effectiveStats(p).sh, d);
  }

  /**
   * AI estimate (0..1) that a shot from here beats the goalie roll: SH after
   * the blockers' expected rolls (~BL each) and the flight decay to the goal,
   * against g = CA/2 + rand(CA).
   */
  shotGoalChance(p: PlayerState, blockers: readonly PlayerState[] = [], boost = 0): number {
    let power = boosted(this.effectiveStats(p).sh, boost);
    for (const b of blockers) power -= this.effectiveStats(b).bl;
    if (power <= 0) return 0;
    const buckets = Math.floor(dist(p.pos, this.goalCenter(p.team)) / FLIGHT_DECAY_DISTANCE);
    for (let i = 0; i < buckets && power > 0; i++) power = flightDecay(power, p.passives.goldenArm);
    const keeper = this.keeperOf((1 - p.team) as Team);
    if (this.isAsleep(keeper)) return power >= 1 ? 1 : 0;
    const ca = this.effectiveStats(keeper).ca;
    const lo = Math.floor(ca / 2);
    let wins = 0;
    for (let g = lo; g < lo + ca; g++) if (g < power) wins++;
    return wins / ca;
  }

  /** AI estimate of the PA left when a pass to `t` arrives (flight decay only). */
  passArrivalPower(p: PlayerState, t: PlayerState): number {
    let power = this.effectiveStats(p).pa;
    const buckets = Math.floor(dist(p.pos, t.pos) / FLIGHT_DECAY_DISTANCE);
    for (let i = 0; i < buckets && power > 0; i++) power = flightDecay(power, p.passives.goldenArm);
    return power;
  }

  /** 0..6 attacking zone (6 = at the opponents' goal) for the CPU decision tables. */
  zoneOf(p: PlayerState): number {
    const progress = (p.pos.x * this.attackDir(p.team) + POOL_HALF.x) / (2 * POOL_HALF.x);
    return Math.max(0, Math.min(6, Math.floor(progress * 7)));
  }

  private resolveActions(): void {
    const s = this.state;
    for (const p of s.players) {
      const intent = this.intents.get(p.id);
      const action = intent?.action;
      if (!action) continue;
      if (intent) intent.action = undefined;
      if (s.phase !== "play" || !this.canAct(p)) continue;
      if (action.kind === "tackle") this.doTackle(p, action.techniqueId);
      else if (!p.hasBall || s.ball.carrier !== p.id) continue;
      else if (action.kind === "pass" && action.targetId) this.doPass(p, action.targetId, action.techniqueId);
      else if (action.kind === "shoot") this.doShoot(p, action.aim ?? this.goalCenter(p.team), action.techniqueId);
    }
    // keeper hold limit (sim rule): force a pass to the nearest teammate
    const carrier = s.ball.carrier ? this.player(s.ball.carrier) : null;
    if (carrier && carrier.role === "GK" && s.tick - carrier.receivedTick > SECS(KEEPER_MAX_HOLD_SECONDS)) {
      const mates = this.playersOf(carrier.team).filter((q) => q.id !== carrier.id);
      mates.sort((a, b) => dist(a.pos, carrier.pos) - dist(b.pos, carrier.pos));
      if (mates.length) this.doPass(carrier, mates[0].id);
    }
  }

  // ------------------------------------------------------------------ techniques & statuses

  /** Use a shot / pass / tackle technique: pay its cost, award EXP, offer techcopy. */
  private useTechnique(p: PlayerState, techniqueId: number | undefined, kind: TechniqueKind): Technique | undefined {
    if (techniqueId === undefined || !this.canUseTechnique(p, techniqueId, kind)) return undefined;
    const t = getTechnique(techniqueId) as Technique;
    // HP cost paid up front except Drain Tackle (paid by the victim on success)
    if (t.family !== "drain") p.hp = Math.max(0, p.hp - t.hpCost);
    this.awardExp(p, t.useExp);
    this.emit({ kind: "technique-used", by: p.id, techniqueId: t.id, team: p.team });
    this.offerTechcopy(p, t.id);
    return t;
  }

  /** Can this player ever learn the technique at its level (tier gating from data/json)? */
  canLearn(p: PlayerState, techniqueId: number): boolean {
    const d = p.def;
    if (p.techniques.includes(techniqueId) || p.learned.includes(techniqueId)) return false;
    if (d.keyTechniques?.includes(techniqueId)) return false;
    if (!d.learnableTiers) return true; // no tier data: anything goes (placeholder teams)
    const tier = d.learnableTiers.findIndex((t) => t.includes(techniqueId));
    if (tier < 0) return false;
    if (tier === 0) return true;
    const need = d.tierLevels?.[tier - 1];
    return need !== undefined && d.level >= need;
  }

  /**
   * Techcopy (formulas.md section 5): candidates are the opponents marking
   * the user who could learn the technique; one is picked at random and
   * succeeds 20 / 50 / 100 % when its level is below / equal / above the
   * user's. Learned techniques go to `learned` (committed by the league).
   */
  offerTechcopy(user: PlayerState, techniqueId: number): PlayerState | null {
    const candidates = this.opponentsOf(user.team).filter(
      (k) => this.markTarget(k)?.id === user.id && this.canLearn(k, techniqueId),
    );
    if (candidates.length === 0) return null;
    const k = candidates[this.rng.rand(candidates.length)];
    if (techcopyRoll(this.rng, k.def.level, user.def.level)) {
      k.learned.push(techniqueId);
      this.emit({ kind: "techcopy", by: k.id, techniqueId, from: user.id, team: k.team });
      return k;
    }
    this.emit({ kind: "techcopy-failed", by: k.id, techniqueId, from: user.id, team: k.team });
    return null;
  }

  /**
   * Roll a technique's status on a victim (formulas.md section 4):
   * rand(100) < chancePct, then the Anti-* resist check, then the effect.
   */
  private inflict(victim: PlayerState, attacker: PlayerState, tech: Technique | undefined): void {
    if (!tech?.family || (tech.kind !== "shot" && tech.kind !== "pass" && tech.kind !== "tackle")) return;
    if (this.rng.pct() >= tech.chancePct) return;
    const anti = victim.passives.anti[tech.family];
    if (anti && this.rng.pct() < anti.chance && victim.hp >= anti.cost) {
      victim.hp -= anti.cost;
      this.awardExp(victim, EXP_RESIST);
      this.emit({ kind: "status-resisted", player: victim.id, status: tech.family, techniqueId: tech.id });
      const antiId = this.antiTechniqueId(victim, tech.family);
      if (antiId !== undefined) this.offerTechcopy(victim, antiId);
      return;
    }
    this.applyFamily(victim, attacker, tech);
  }

  private antiTechniqueId(p: PlayerState, family: StatusFamily): number | undefined {
    return p.techniques.find((id) => {
      const t = getTechnique(id);
      return t?.kind === "guard" && t.family === family;
    });
  }

  private applyFamily(victim: PlayerState, attacker: PlayerState, tech: Technique): void {
    switch (tech.family) {
      case "venom":
        if (victim.poisonTicks > 0 && attacker.passives.pileVenom) {
          if (victim.drainPerTick < PILE_VENOM_CAP) victim.drainPerTick *= 4;
        } else victim.drainPerTick = POISON_DRAIN;
        victim.poisonTicks = framesToTicks(VENOM_FRAMES);
        this.emit({ kind: "status-applied", player: victim.id, status: "poison", duration: VENOM_FRAMES });
        break;
      case "nap":
        victim.sleepTicks = framesToTicks(NAP_FRAMES);
        victim.vel = v3(0, 0, 0);
        this.emit({ kind: "status-applied", player: victim.id, status: "sleep", duration: NAP_FRAMES });
        break;
      case "wither": {
        // The original picks the stat through a rand(3)-based switch; which
        // stats share a branch is not documented, so one of the six is drawn.
        const k = CONTEST_STATS[this.rng.rand(CONTEST_STATS.length)];
        const existing = victim.wither[k];
        let divisor = 2;
        if (existing && attacker.passives.pileWither && existing.divisor < 100) divisor = existing.divisor * 2;
        else if (existing) divisor = existing.divisor;
        victim.wither[k] = { remaining: framesToTicks(WITHER_FRAMES), divisor };
        this.emit({ kind: "status-applied", player: victim.id, status: "wither", duration: WITHER_FRAMES, stat: k });
        break;
      }
      case "drain": {
        const amount = Math.min(tech.hpCost, victim.hp);
        victim.hp -= amount;
        attacker.hp = Math.min(attacker.effectiveMaxHp, attacker.hp + tech.hpCost);
        this.emit({ kind: "drain", by: attacker.id, on: victim.id, amount });
        break;
      }
      default:
        break;
    }
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
    p.contestEn = null;
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

  /** The blocker that stops a launched pass or shot, if any; applies block rolls to `power`. */
  private resolveLaunchBlockers(
    p: PlayerState,
    power: number,
    tech: Technique | undefined,
  ): { power: number; blockedBy: PlayerState | null; rolled: string[] } {
    let pw = power;
    const rolled: string[] = [];
    for (const q of this.encounterDefenders(p, true)) {
      rolled.push(q.id);
      const bl = this.effectiveStats(q).bl;
      const roll = blockRoll(this.rng, bl);
      if (roll.random === 0) continue; // " can't block it!"
      if (roll.value < pw) {
        pw -= roll.value;
        this.inflict(q, p, tech);
        continue;
      }
      return { power: pw, blockedBy: q, rolled };
    }
    return { power: pw, blockedBy: null, rolled };
  }

  private blocked(by: PlayerState, carrier: PlayerState): void {
    by.tackleCooldown = SECS(TACKLE_COOLDOWN_SECONDS);
    carrier.stun = framesToTicks(BALL_LOST_STUN_FRAMES);
    this.awardExp(by, EXP_BLOCK);
    this.takeBall(by);
  }

  private doPass(p: PlayerState, targetId: string, techniqueId?: number): void {
    const target = this.byId.get(targetId);
    if (!target || target.id === p.id || target.team !== p.team) return;
    const s = this.state;
    const st = this.effectiveStats(p);
    const tech = this.useTechnique(p, techniqueId, "pass");
    // normal pass costs PA HP (all of it while HP is below PA max); a tech pass paid its hpCost
    if (!tech) p.hp = p.hp < p.def.stats.pa ? 0 : p.hp - st.pa;
    const pa = boosted(st.pa, tech?.statBoost ?? 0);
    const { power, blockedBy, rolled } = this.resolveLaunchBlockers(p, pa, tech);
    this.emit({ kind: "pass", from: p.id, to: target.id, team: p.team, techniqueId: tech?.id });
    if (blockedBy) {
      this.blocked(blockedBy, p);
      this.emit({ kind: "pass-intercepted", from: p.id, to: target.id, by: blockedBy.id, team: blockedBy.team });
      return;
    }
    const aim = add(target.pos, scale(target.vel, PASS_LEAD_SECONDS));
    const dir = normalize(sub(aim, s.ball.pos));
    const distance = dist(aim, s.ball.pos);
    const speed = PASS_BASE_SPEED + pa * PASS_SPEED_PER_PA;
    const flight: BallFlight = {
      kind: "pass",
      from: p.id,
      to: target.id,
      team: p.team,
      power,
      contested: rolled,
      aim,
      travelled: 0,
      aimDistance: distance,
      decayBucket: Math.floor(dist(target.pos, s.ball.pos) / FLIGHT_DECAY_DISTANCE),
      techniqueId: tech?.id,
      aimed: false,
      deflectWindow: 0,
    };
    this.dropBall(scale(dir, speed));
    s.ball.flight = flight;
    s.ball.lastTouch = p.team;
    s.possession = p.team;
    p.facing = dir;
  }

  private doShoot(p: PlayerState, aimPoint: Vec3, techniqueId?: number, volley = false): void {
    const s = this.state;
    const st = this.effectiveStats(p);
    const tech = volley ? undefined : this.useTechnique(p, techniqueId, "shot");
    if (!tech && !volley) p.hp = p.hp < p.def.stats.sh ? 0 : p.hp - st.sh;
    const sh = boosted(st.sh, tech?.statBoost ?? 0);
    const aimed = !!tech?.aimed && this.rng.pct() < tech.chancePct;
    const { power, blockedBy, rolled } = this.resolveLaunchBlockers(p, sh, tech);
    this.emit({ kind: "shot", by: p.id, team: p.team, power, techniqueId: tech?.id, aimed });
    if (blockedBy) {
      this.blocked(blockedBy, p);
      this.emit({ kind: "shot-blocked", by: p.id, blocker: blockedBy.id, team: p.team });
      return;
    }
    // Spin Ball widens the goalie's deflection window (needs and costs 30 HP)
    let deflectWindow = DEFLECT_WINDOW_BASE;
    if (p.passives.spinBall && p.hp >= GOALIE_PASSIVE_HP) {
      p.hp -= GOALIE_PASSIVE_HP;
      deflectWindow += getTechnique(48)?.chancePct ?? 3;
    }
    const dir0 = normalize(sub(aimPoint, s.ball.pos));
    const distance = dist(aimPoint, s.ball.pos);
    const aim = add(aimPoint, this.missOffset(dir0, distance, SHOT_MISS_SPREAD, sh + SHOT_ACCURACY_BASE));
    const dir = normalize(sub(aim, s.ball.pos));
    const speed = SHOT_BASE_SPEED + sh * SHOT_SPEED_PER_SH;
    const flight: BallFlight = {
      kind: "shot",
      from: p.id,
      team: p.team,
      power,
      contested: rolled,
      aim,
      travelled: 0,
      aimDistance: distance,
      decayBucket: Math.floor(dist(this.goalCenter(p.team), s.ball.pos) / FLIGHT_DECAY_DISTANCE),
      techniqueId: tech?.id,
      aimed,
      deflectWindow,
    };
    this.dropBall(scale(dir, speed));
    s.ball.flight = flight;
    s.ball.lastTouch = p.team;
    s.possession = p.team;
    p.facing = dir;
  }

  /**
   * Tackle (formulas.md section 2): r = AT'/2 + rand(AT'); random part 0 is
   * a miss; Tackle Slip may evade; r < working EN keeps the ball (EN -= r);
   * otherwise the tackler takes it and the carrier is stunned 100 frames.
   */
  private doTackle(p: PlayerState, techniqueId?: number): void {
    const s = this.state;
    if (!s.ball.carrier || p.tackleCooldown > 0 || p.role === "GK") return;
    const c = this.player(s.ball.carrier);
    if (c.team === p.team || dist(c.pos, p.pos) > this.tackleReach(p)) return;
    const tech = this.useTechnique(p, techniqueId, "tackle");
    const at = boosted(this.effectiveStats(p).at, tech?.statBoost ?? 0);
    p.tackleCooldown = SECS(TACKLE_COOLDOWN_SECONDS);
    const roll = tackleRoll(this.rng, at);
    if (roll.random === 0) {
      p.stun = SECS(TACKLE_WHIFF_STUN_SECONDS);
      this.awardExp(c, EXP_TACKLE_MISSED);
      this.emit({ kind: "tackle-miss", by: p.id, on: c.id, team: p.team });
      return;
    }
    const slip = c.passives.tackleSlip;
    if (slip && this.rng.pct() < slip.chance && c.hp >= slip.cost) {
      c.hp -= slip.cost;
      p.stun = SECS(TACKLE_WHIFF_STUN_SECONDS);
      this.emit({ kind: "tackle-evaded", by: p.id, on: c.id, team: p.team });
      const slipId = c.techniques.find((id) => (getTechnique(id)?.flags ?? 0) & TECH_FLAG.tackleSlip);
      if (slipId !== undefined) this.offerTechcopy(c, slipId);
      return;
    }
    const en = c.contestEn ?? this.effectiveStats(c).en;
    if (roll.value < en) {
      c.contestEn = en - roll.value;
      this.awardExp(c, EXP_BREAKTHROUGH);
      this.emit({ kind: "breakthrough", carrier: c.id, tackler: p.id, team: c.team });
      this.inflict(c, p, tech);
      return;
    }
    c.stun = framesToTicks(BALL_LOST_STUN_FRAMES);
    this.takeBall(p);
    this.emit({ kind: "tackle", by: p.id, on: c.id, team: p.team, techniqueId: tech?.id });
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
      if (!this.canAct(p)) continue;
      const d = dist(p.pos, b.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      this.takeBall(best);
      this.emit({ kind: "pickup", by: best.id, team: best.team });
      this.tryVolley(best);
    }
  }

  /** Volley Shot: a loose ball reaching the player becomes an immediate shot (chance, HP cost, +3 EXP). */
  private tryVolley(p: PlayerState): void {
    const v = p.passives.volley;
    if (!v || p.role === "GK" || this.rng.pct() >= v.chance || p.hp < v.cost) return;
    p.hp -= v.cost;
    this.awardExp(p, EXP_VOLLEY);
    const id = p.techniques.find((t) => getTechnique(t)?.volley);
    if (id !== undefined) {
      this.emit({ kind: "technique-used", by: p.id, techniqueId: id, team: p.team });
      this.offerTechcopy(p, id);
    }
    this.doShoot(p, bestShotAim(this, p), undefined, true);
  }

  private bounce(): void {
    const b = this.state.ball;
    // the goal planes
    if (Math.abs(b.pos.x) > POOL_HALF.x) {
      b.pos.x = Math.sign(b.pos.x) * POOL_HALF.x;
      b.vel.x = -Math.sign(b.pos.x) * Math.abs(b.vel.x) * WALL_BOUNCE;
    }
    // the sphere wall: reflect the outward part of the velocity
    const r = len(b.pos);
    if (r > POOL_RADIUS) {
      const n = scale(b.pos, 1 / r);
      b.pos = scale(n, POOL_RADIUS);
      const out = dot(b.vel, n);
      if (out > 0) b.vel = sub(b.vel, scale(n, out * (1 + WALL_BOUNCE)));
    }
  }

  /** Flight decay: whenever floor(distance / 100 units) changes, power -= max(1, power / 5 (10 Golden Arm)). */
  private decayFlight(f: BallFlight, distanceLeft: number): void {
    const bucket = Math.floor(distanceLeft / FLIGHT_DECAY_DISTANCE);
    if (bucket === f.decayBucket) return;
    f.decayBucket = bucket;
    f.power = flightDecay(f.power, this.player(f.from).passives.goldenArm);
  }

  /** Sim extension: a defender the ball passes within reach gets one block roll (same formula as the encounter). */
  private laneBlock(f: BallFlight): PlayerState | null {
    const b = this.state.ball;
    for (const q of this.state.players) {
      if (q.team === f.team || q.role === "GK" || f.contested.includes(q.id) || !this.canAct(q)) continue;
      if (q.id === f.to) continue;
      const reach = this.blockReach(q);
      if (dist(q.pos, b.pos) > reach) continue;
      if (dot(b.vel, sub(q.pos, b.pos)) < -0.5 * reach * len(b.vel)) continue;
      f.contested.push(q.id);
      const roll = blockRoll(this.rng, this.effectiveStats(q).bl);
      if (roll.random === 0) continue;
      if (roll.value < f.power) {
        f.power -= roll.value;
        this.inflict(q, this.player(f.from), f.techniqueId !== undefined ? getTechnique(f.techniqueId) : undefined);
        continue;
      }
      return q;
    }
    return null;
  }

  private flightPass(f: BallFlight): void {
    const s = this.state;
    const b = s.ball;
    const target = this.player(f.to as string);
    const passer = this.player(f.from);
    this.decayFlight(f, dist(target.pos, b.pos));
    if (f.travelled >= PASS_CONTEST_MIN_TRAVEL) {
      const blocker = this.laneBlock(f);
      if (blocker) {
        this.blocked(blocker, passer);
        this.emit({ kind: "pass-intercepted", from: f.from, to: target.id, by: blocker.id, team: blocker.team });
        return;
      }
    }
    // arrival at the receiver
    if (dist(target.pos, b.pos) <= CATCH_RADIUS && target.stun <= 0) {
      const tech = f.techniqueId !== undefined ? getTechnique(f.techniqueId) : undefined;
      if (this.isAsleep(target)) {
        target.sleepTicks = 0;
        this.emit({ kind: "wake-up", player: target.id, by: f.from });
        this.tryGoodMorning(target, tech);
      }
      if (f.power > 0) {
        this.takeBall(target);
        this.awardExp(passer, EXP_PASS_COMPLETE);
        this.emit({ kind: "pass-complete", from: f.from, to: target.id, team: f.team });
        this.tryGamble(target);
      } else {
        b.flight = null;
        b.vel = scale(normalize(b.vel), FUMBLE_SPEED);
        s.possession = null;
        this.emit({ kind: "pass-fumbled", from: f.from, to: target.id, team: f.team });
      }
      return;
    }
    // overshoot or wall -> loose ball
    const outside = Math.abs(b.pos.x) > POOL_HALF.x || len(b.pos) > POOL_RADIUS;
    if (f.travelled > f.aimDistance + PASS_OVERSHOOT || outside) {
      b.flight = null;
      b.vel = scale(b.vel, 0.3);
      s.possession = null;
      this.bounce();
    }
  }

  /** Good Morning!: a sleeper woken by a pass may get two stats at 99, decaying (formulas.md section 5). */
  private tryGoodMorning(p: PlayerState, tech: Technique | undefined): void {
    if (!p.passives.goodMorning || this.rng.pct() >= GOOD_MORNING_CHANCE || p.hp < GOOD_MORNING_HP) return;
    this.cureWither(p);
    this.awardExp(p, EXP_GOOD_MORNING);
    p.hp -= GOOD_MORNING_HP;
    p.override = {};
    p.overrideCounter = 0;
    if (tech?.family && tech.family !== "drain") {
      const pair: Record<"venom" | "nap" | "wither", [ContestStat, ContestStat]> = {
        venom: ["en", "ca"],
        nap: ["at", "pa"],
        wither: ["sh", "bl"],
      };
      for (const k of pair[tech.family]) p.override[k] = 99;
      p.overrideEveryTicks = framesToTicks(2 ** Math.max(1, tech.tier));
    } else {
      p.override[CONTEST_STATS[this.rng.rand(CONTEST_STATS.length)]] = 99;
      p.overrideEveryTicks = framesToTicks(1);
    }
    this.emit({ kind: "good-morning", player: p.id });
  }

  /** Gamble: on receiving a pass, every contest stat becomes rand(100) for 400 frames. */
  private tryGamble(p: PlayerState): void {
    if (!p.passives.gamble || Object.keys(p.override).length > 0) return;
    if (this.rng.pct() >= GAMBLE_CHANCE || p.hp < GAMBLE_HP) return;
    this.cureWither(p);
    this.awardExp(p, EXP_GAMBLE);
    p.hp -= GAMBLE_HP;
    p.gambleTicks = framesToTicks(GAMBLE_FRAMES);
    const g = { en: 0, pa: 0, sh: 0, at: 0, bl: 0, ca: 0 };
    for (const k of CONTEST_STATS) g[k] = Math.max(1, this.rng.pct());
    p.gambleStats = g;
    this.emit({ kind: "gamble", player: p.id });
  }

  private flightShot(f: BallFlight): void {
    const s = this.state;
    const b = s.ball;
    const shooter = this.player(f.from);
    const tech = f.techniqueId !== undefined ? getTechnique(f.techniqueId) : undefined;
    const defending = (1 - f.team) as Team;
    const goalX = POOL_HALF.x * this.attackDir(f.team);
    this.decayFlight(f, Math.abs(goalX - b.pos.x));
    const blocker = this.laneBlock(f);
    if (blocker) {
      this.blocked(blocker, shooter);
      this.emit({ kind: "shot-blocked", by: f.from, blocker: blocker.id, team: f.team });
      return;
    }
    const crossed = (b.pos.x - goalX) * this.attackDir(f.team) >= 0;
    const keeper = this.keeperOf(defending);
    if (!crossed) {
      if (len(b.pos) > POOL_RADIUS) this.outOfBounds(keeper);
      return;
    }
    const onTarget = Math.abs(b.pos.y) <= GOAL_HALF_HEIGHT && Math.abs(b.pos.z) <= GOAL_HALF_DEPTH;
    if (!onTarget) {
      this.outOfBounds(keeper);
      return;
    }
    const crossing = v3(goalX, b.pos.y, b.pos.z);
    const keeperInReach = dist(keeper.pos, crossing) <= AIMED_SHOT_CATCH_RADIUS;
    // goalie asleep: anything with power left scores
    if (this.isAsleep(keeper)) {
      if (f.power >= 1) this.scoreGoal(shooter, false);
      else this.keeperCatch(keeper, shooter);
      return;
    }
    // aimed shot (Jecht Shot 2 / Invisible Shot): caught only if the keeper covers the crossing point
    if (f.aimed) {
      if (keeperInReach) {
        this.awardExp(keeper, EXP_AIMED_CATCH);
        this.inflict(keeper, shooter, tech);
        this.takeBall(keeper);
        this.emit({ kind: "save", keeper: keeper.id, shooter: f.from, team: defending });
      } else this.scoreGoal(shooter, keeperInReach);
      return;
    }
    let ca = this.effectiveStats(keeper).ca;
    if (keeper.passives.superGoalie && keeper.hp >= GOALIE_PASSIVE_HP && this.rng.pct() < SUPER_GOALIE_CHANCE) {
      this.awardExp(keeper, EXP_SUPER_GOALIE);
      keeper.hp -= GOALIE_PASSIVE_HP;
      ca = Math.min(99, ca + this.rng.rand(SUPER_GOALIE_BONUS));
    }
    const g = goalieRoll(this.rng, ca);
    // the shot technique's status is rolled on the goalie whenever it contests the shot
    this.inflict(keeper, shooter, tech);
    if (g < f.power) {
      this.scoreGoal(shooter, keeperInReach);
      return;
    }
    let window = f.deflectWindow;
    if (keeper.passives.gripGloves && keeper.hp >= GOALIE_PASSIVE_HP) {
      keeper.hp -= GOALIE_PASSIVE_HP;
      window -= getTechnique(49)?.chancePct ?? 3;
    }
    if (this.rng.rand(10) < window) {
      // " gets a hand on it!": loose ball in front of the goal
      this.awardExp(keeper, EXP_GOALIE_CATCH);
      b.flight = null;
      const out = normalize(add(scale(v3(-this.attackDir(f.team), 0, 0), 2), v3(0, this.rng.float() - 0.5, 0)));
      b.pos = add(crossing, scale(out, 1.5));
      b.vel = scale(out, DEFLECT_SPEED);
      s.possession = null;
      this.emit({ kind: "deflection", keeper: keeper.id, shooter: f.from, team: defending });
      return;
    }
    this.keeperCatch(keeper, shooter);
  }

  private keeperCatch(keeper: PlayerState, shooter: PlayerState): void {
    this.awardExp(keeper, EXP_GOALIE_CATCH);
    this.takeBall(keeper);
    this.emit({ kind: "save", keeper: keeper.id, shooter: shooter.id, team: keeper.team });
  }

  /** Out of the pool: the defending keeper restarts (the original's throw-in condition is native: UNKNOWN). */
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
      if (!this.canAct(q)) continue;
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

  /** Reach used by defenders to block passes and shots in flight (sim extension). */
  blockReach(p: PlayerState): number {
    return BLOCK_REACH_BASE + this.effectiveStats(p).bl * BLOCK_REACH_PER_BL;
  }
}
