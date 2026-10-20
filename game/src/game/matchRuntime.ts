/**
 * matchRuntime.ts - The playable match: fixed-timestep sim loop, input,
 * control modes, renderer + HUD glue. This is the API the app shell uses:
 *
 *   playMatch(container, options) -> MatchHandle   (3D, interactive)
 *   simulateInstant(options)      -> MatchResult   (headless, league fixtures)
 *
 * Loop: the sim steps at TICK_RATE (60 Hz) from a real-time accumulator
 * scaled by the control mode's time scale (timeScale.ts); the renderer draws
 * every animation frame from a RenderSnapshot (snapshotAdapter.ts). Input is
 * polled at the start of every frame so a press reaches the sim within one
 * frame plus one tick (< 50 ms at 30 fps).
 */

// [audio hook]
import { type BlitzAudio, createAudio, DEFAULT_AUDIO_SETTINGS, familyOf } from "../audio";
import { InputManager, type InputState, mergeBindings } from "../input";
import { emptyLine, type MatchReport } from "../league/report";
import { type BlitzRenderer, createRenderer } from "../render";
import { DT, TACKLE_COOLDOWN_SECONDS, TICK_RATE } from "../sim/constants";
import { AI_INPUT, type MatchInput, type TeamInput } from "../sim/input";
import { Match } from "../sim/match";
import { matchReport } from "../sim/report";
import { getTechnique } from "../sim/techniques";
import type { MatchEvent, PlayerState } from "../sim/types";
import { Hud, type HudView, type MarkView, type RadialOption, type SelectedPlayerView } from "../ui/hud";
import { commentaryForEvents, makeNameLookup, type NameLookup } from "./commentary";
import {
  buildHumanInput,
  type CameraBasis,
  type ControlState,
  contestedBy,
  DEFAULT_BASIS,
  hotbarOf,
  initialControlState,
  passCandidates,
  updateControlled,
} from "./control";
import { ActionTracker, simToRenderPos, toRenderSnapshot } from "./snapshotAdapter";
import { decideTimeScale, nextSlowMoRemaining } from "./timeScale";
import type { MatchHandle, MatchOptions, MatchResult } from "./types";

export type { ControlMode, MatchHandle, MatchOptions, MatchResult, MatchSettings } from "./types";

/** Real seconds the half-time / overtime banner holds the sim (skippable). */
const BREAK_HOLD_SECONDS = 4;
/** Real seconds the full-time banner shows before the promise resolves (skippable). */
const FULL_TIME_HOLD_SECONDS = 2.5;
/** Minimum real seconds between two automatic tactical prompts. */
const TACTICAL_PROMPT_COOLDOWN = 1.5;
const MAX_TICKS_PER_FRAME = 8;

function toSimOptions(o: MatchOptions) {
  return { seed: o.seed, halfSeconds: o.halfSeconds, overtime: o.overtime, difficulty: o.difficulty };
}

/** matchReport() needs data ids; fall back to a structural report when teams were hand-built. */
function safeReport(match: Match): MatchReport {
  try {
    return matchReport(match);
  } catch {
    const [home, away] = match.teams;
    return {
      homeTeam: home.dataId ?? -1,
      awayTeam: away.dataId ?? -1,
      score: [match.state.score[0], match.state.score[1]],
      perPlayer: match.state.players.map((p, i) => emptyLine(p.def.dataId ?? i)),
    };
  }
}

function resultOf(match: Match, abandoned = false): MatchResult {
  const r: MatchResult = {
    ...safeReport(match),
    events: match.events,
    score: [match.state.score[0], match.state.score[1]],
  };
  if (abandoned) r.abandoned = true;
  return r;
}

/** Headless: run the whole match with AI on both sides and return the report. */
export function simulateInstant(options: MatchOptions): MatchResult {
  const match = new Match(options.home, options.away, toSimOptions(options));
  match.run();
  return resultOf(match);
}

export function playMatch(container: HTMLElement, options: MatchOptions): MatchHandle {
  if (options.instant) {
    const result = simulateInstant(options);
    return {
      promise: Promise.resolve(result),
      pause() {},
      resume() {},
      skip() {},
      dispose() {},
    };
  }
  return new MatchRuntime(container, options);
}

class MatchRuntime implements MatchHandle {
  readonly promise: Promise<MatchResult>;
  private resolve!: (r: MatchResult) => void;

  private readonly options: MatchOptions;
  private readonly match: Match;
  private readonly stage: HTMLElement;
  private readonly renderer: BlitzRenderer;
  private readonly hud: Hud;
  private readonly input: InputManager;
  private readonly tracker = new ActionTracker();
  // [audio hook] procedural cues for sim events; ambience runs for the whole match.
  private readonly audio: BlitzAudio;
  private readonly names: NameLookup;
  private readonly unsubNav: () => void;
  private readonly unsubPress: () => void;

  private control: ControlState = initialControlState();
  private accumulator = 0;
  private slowMoRemaining = 0;
  private paused = false;
  private breakHold = 0;
  private fullTimeHold = -1;
  private tacticalCooldown = 0;
  private wasContested = false;
  /** A menu consumed a navigation key since the last poll (so the same key must not also toggle pause). */
  private navConsumed = false;
  private lastNow = 0;
  private raf = 0;
  private disposed = false;
  private settled = false;
  private cameraMode: "broadcast" | "tactical" = "broadcast";
  private bannerEvent: MatchEvent | null = null;

  constructor(container: HTMLElement, options: MatchOptions) {
    this.options = options;
    this.promise = new Promise<MatchResult>((res) => {
      this.resolve = res;
    });
    this.match = new Match(options.home, options.away, toSimOptions(options));
    this.names = makeNameLookup(options.home, options.away);

    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.stage = document.createElement("div");
    this.stage.className = "blitz-stage";
    container.appendChild(this.stage);
    this.renderer = createRenderer(this.stage);
    this.cameraMode = options.camera;
    this.renderer.setCamera(options.camera);

    this.hud = new Hud(container, this.stage, options.settings, {
      onResume: () => this.resume(),
      onSkipToEnd: () => this.skip(),
      onCycleCamera: () => this.cycleCamera(),
      onQuit: () => this.finish(true),
      onRadialPick: (o) => this.onRadialPick(o),
    });
    this.input = new InputManager({ bindings: mergeBindings(options.settings.keyBindings), element: container });
    this.unsubNav = this.input.onMenuNav((e) => {
      this.navConsumed = this.hud.nav(e.kind);
    });
    this.unsubPress = this.input.onPress((a) => {
      if (a !== "pause") return;
      const consumed = this.navConsumed;
      this.navConsumed = false;
      if (consumed || this.settled || this.disposed || this.hud.isRadialOpen) return;
      if (this.paused) this.resume();
      else this.pause();
    });

    // [audio hook]
    this.audio = createAudio(options.settings.audio ?? DEFAULT_AUDIO_SETTINGS);
    this.audio.resume();
    this.audio.setAmbience(true);
    this.audio.startMusic("match");

    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ handle API

  pause(): void {
    if (this.disposed || this.settled) return;
    this.paused = true;
    if (!this.hud.isPauseOpen) this.hud.openPause({ cameraLabel: this.cameraMode });
    this.input.setEnabled(false);
  }

  resume(): void {
    if (this.disposed || this.settled) return;
    this.paused = false;
    this.hud.closePause();
    this.input.setEnabled(!this.hud.isRadialOpen);
    this.lastNow = performance.now();
  }

  skip(): void {
    if (this.disposed || this.settled) return;
    this.hud.closePause();
    this.hud.closeRadial();
    this.match.run();
    this.finish(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.settled) {
      this.settled = true;
      this.resolve(resultOf(this.match, true));
    }
    cancelAnimationFrame(this.raf);
    this.unsubNav();
    this.unsubPress();
    this.input.dispose();
    this.hud.dispose();
    this.audio.dispose(); // [audio hook]
    this.renderer.dispose();
    this.stage.remove();
  }

  // ------------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const realDt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    const input = this.input.poll();
    this.handleGlobalKeys(input);

    const frameEvents: MatchEvent[] = [];
    if (this.settled) {
      // full-time banner hold
      if (this.fullTimeHold >= 0) {
        this.fullTimeHold -= realDt;
        if (this.fullTimeHold <= 0 || input.pressed.has("skip")) this.finish(false);
      }
    } else {
      this.stepSim(input, realDt, frameEvents);
    }

    this.presentEvents(frameEvents);
    this.draw(realDt);
  };

  private handleGlobalKeys(input: InputState): void {
    if (this.settled || this.paused) return;
    if (input.pressed.has("camera")) this.cycleCamera();
    if (input.pressed.has("skip") && this.breakHold > 0) this.breakHold = 0;
  }

  private stepSim(input: InputState, realDt: number, frameEvents: MatchEvent[]): void {
    const m = this.match;
    const human = this.options.humanTeam;

    if (this.breakHold > 0) {
      this.breakHold -= realDt;
      return;
    }

    // Tactical mode: freeze and open the radial menu when the human carrier is contested or wants to act.
    if (this.options.controlMode === "tactical" && human !== null && !this.hud.isRadialOpen && !this.paused) {
      this.tacticalCooldown = Math.max(0, this.tacticalCooldown - realDt);
      this.maybeOpenRadial(input);
    }

    const scale = decideTimeScale({
      mode: this.options.controlMode,
      slowMoRemaining: this.slowMoRemaining,
      menuOpen: this.hud.isRadialOpen,
      paused: this.paused,
    });
    this.accumulator += realDt * scale;
    const basis = this.cameraBasis();
    let first = true;
    let ticks = 0;
    while (this.accumulator >= DT && ticks < MAX_TICKS_PER_FRAME && !m.finished) {
      this.accumulator -= DT;
      ticks++;
      const before = m.events.length;
      m.step(this.buildInput(input, basis, first));
      first = false;
      for (let i = before; i < m.events.length; i++) frameEvents.push(m.events[i]);
      if (human !== null) this.control = updateControlled(m, human, this.control);
      if (this.consumeBreak(frameEvents)) break;
    }
    if (this.accumulator > DT * MAX_TICKS_PER_FRAME) this.accumulator = 0;
    this.slowMoRemaining = nextSlowMoRemaining(this.options.controlMode, this.slowMoRemaining, realDt, frameEvents);

    if (m.finished && !this.settled) {
      this.settled = true;
      this.bannerEvent = m.events[m.events.length - 1] ?? null;
      this.fullTimeHold = FULL_TIME_HOLD_SECONDS;
      this.input.setEnabled(true);
    }
  }

  /** Hold the sim on half-time / overtime banners (the sim's own freeze is only 1.5 s). */
  private consumeBreak(events: MatchEvent[]): boolean {
    for (const e of events) {
      if (e.kind === "half-time" || e.kind === "overtime-start") {
        this.breakHold = BREAK_HOLD_SECONDS;
        this.bannerEvent = e;
        this.accumulator = 0;
        return true;
      }
    }
    return false;
  }

  private buildInput(input: InputState, basis: CameraBasis, consumeEdges: boolean): MatchInput {
    const human = this.options.humanTeam;
    if (human === null) return AI_INPUT;
    const r = buildHumanInput(this.match, human, this.control, input, basis, consumeEdges);
    this.control = r.state;
    const team: TeamInput = r.input.controlledPlayerId ? r.input : { kind: "ai" };
    return human === 0 ? { home: team, away: { kind: "ai" } } : { home: { kind: "ai" }, away: team };
  }

  private maybeOpenRadial(input: InputState): void {
    const m = this.match;
    if (m.state.phase !== "play" || !this.control.controlledId) return;
    const p = m.player(this.control.controlledId);
    if (!p.hasBall || !m.canAct(p)) {
      this.wasContested = false;
      return;
    }
    const contested = contestedBy(m, p).length > 0;
    const wantsAct =
      input.pressed.has("pass") ||
      input.pressed.has("shoot") ||
      input.pressed.has("tech1") ||
      input.pressed.has("tech2") ||
      input.pressed.has("tech3") ||
      input.pressed.has("tech4") ||
      input.pressed.has("tech5") ||
      input.pointer.clicked !== null;
    const newlyContested = contested && !this.wasContested && this.tacticalCooldown <= 0;
    this.wasContested = contested;
    if (!wantsAct && !newlyContested) return;
    this.tacticalCooldown = TACTICAL_PROMPT_COOLDOWN;
    this.openRadialFor(p, contested);
  }

  private openRadialFor(p: PlayerState, contested: boolean): void {
    const m = this.match;
    const options: RadialOption[] = [];
    const cands = passCandidates(m, p.id).slice(0, 3);
    for (const t of cands) {
      options.push({
        id: `pass:${t.id}`,
        label: `Pass`,
        sub: `${t.def.name} (PA ${m.effectiveStats(p).pa} -> ${Math.round(m.passArrivalPower(p, t))})`,
        kind: "pass",
        action: { pass: t.id },
      });
    }
    const chance = Math.round(m.shotGoalChance(p, contestedBy(m, p)) * 100);
    options.push({
      id: "shoot",
      label: "Shoot",
      sub: `SH ${m.effectiveStats(p).sh} - ${chance}%`,
      kind: "shoot",
      action: { shoot: true },
    });
    options.push({
      id: "breakthrough",
      label: "Breakthrough",
      sub: contested ? `EN ${m.effectiveStats(p).en} vs tackles` : "Keep swimming",
      kind: "breakthrough",
      action: null,
    });
    for (const t of hotbarOf(p)) {
      if (!t) continue;
      const usable = m.canUseTechnique(p, t.id);
      options.push({
        id: `tech:${t.id}`,
        label: t.name,
        sub: `${t.kind} - ${t.hpCost} HP`,
        kind: "technique",
        disabled: !usable,
        action: { technique: t.id },
      });
    }
    this.hud.openRadial(p.def.name, contested ? "Contested!" : "Choose an action", options);
    this.input.setEnabled(false);
  }

  private onRadialPick(o: RadialOption): void {
    this.control = { ...this.control, pending: o.action ?? null };
    this.input.setEnabled(!this.paused);
    this.lastNow = performance.now();
  }

  private cycleCamera(): void {
    this.cameraMode = this.cameraMode === "broadcast" ? "tactical" : "broadcast";
    this.renderer.setCamera(this.cameraMode);
    this.hud.setPauseCamera(this.cameraMode);
  }

  /** Screen axes of the current camera projected onto the pool's x/y plane. */
  private cameraBasis(): CameraBasis {
    const cam = this.renderer.three.camera;
    const q = cam.quaternion;
    const right = rotate(q, 1, 0, 0);
    let fwd = rotate(q, 0, 0, -1);
    let f = planar(fwd);
    if (Math.hypot(f.x, f.y) < 0.2) {
      fwd = rotate(q, 0, 1, 0);
      f = planar(fwd);
    }
    const r = planar(right);
    const rl = Math.hypot(r.x, r.y);
    const fl = Math.hypot(f.x, f.y);
    if (rl < 1e-3 || fl < 1e-3) return DEFAULT_BASIS;
    return { right: { x: r.x / rl, y: r.y / rl }, forward: { x: f.x / fl, y: f.y / fl } };
  }

  // ------------------------------------------------------------------ presentation

  private presentEvents(frameEvents: MatchEvent[]): void {
    if (frameEvents.length === 0) return;
    const m = this.match;
    const human = this.options.humanTeam;
    this.tracker.ingest(frameEvents, m.state);
    this.hud.pushCommentary(commentaryForEvents(frameEvents, this.names, human));
    this.playCues(frameEvents); // [audio hook]
    for (const e of frameEvents) {
      if (e.kind === "goal") {
        this.bannerEvent = e;
        if (!this.options.settings.reducedFlash) this.renderer.vfx.spawnGoalFlash(m.attackDir(e.team));
        this.hud.goalEffects();
      } else if (e.kind === "technique-used") {
        const p = m.player(e.by);
        this.renderer.vfx.spawnTechniqueEffect(this.names.technique(e.techniqueId), simToRenderPos(p.pos));
      } else if (e.kind === "tackle" && human !== null && m.player(e.on).team === human) {
        this.hud.shake();
      } else if (e.kind === "kickoff") {
        this.bannerEvent = null;
      }
    }
  }

  // [audio hook] sim event -> cue name (events not listed are silent).
  private playCues(events: MatchEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case "kickoff":
        case "pass":
        case "pass-complete":
        case "pass-intercepted":
        case "shot":
        case "shot-blocked":
        case "save":
        case "goal":
        case "tackle":
        case "tackle-miss":
        case "breakthrough":
        case "half-time":
        case "full-time":
        case "techcopy":
          this.audio.play(e.kind);
          break;
        case "technique-used":
          this.audio.play("technique", { family: familyOf(getTechnique(e.techniqueId)?.kind) });
          break;
        default:
          break;
      }
    }
  }

  private draw(realDt: number): void {
    const m = this.match;
    const selectedId = this.options.humanTeam !== null ? this.control.controlledId : m.state.ball.carrier;
    const snapshot = toRenderSnapshot(m.state, {
      selectedPlayerId: selectedId,
      tracker: this.tracker,
      teamDataIds: [m.teams[0].dataId, m.teams[1].dataId],
    });
    this.renderer.update(snapshot, this.paused ? 0 : realDt);
    this.hud.update(this.hudView(selectedId));
  }

  private hudView(selectedId: string | null): HudView {
    const m = this.match;
    const s = m.state;
    return {
      teamNames: [this.options.home.name, this.options.away.name],
      score: [s.score[0], s.score[1]],
      clock: s.time,
      half: s.half,
      possession: s.possession,
      humanTeam: this.options.humanTeam,
      mode: this.options.controlMode,
      slowMo: this.slowMoRemaining > 0,
      selected: selectedId ? this.selectedView(m.player(selectedId)) : null,
      marks: this.marksView(),
      banner: this.bannerView(),
      prompt: this.promptLines(),
    };
  }

  private selectedView(p: PlayerState): SelectedPlayerView {
    const m = this.match;
    const st = m.effectiveStats(p);
    const keys = this.input.bindings.keys;
    const techKeys = ["tech1", "tech2", "tech3", "tech4", "tech5"] as const;
    const target = this.control.passTargetId;
    return {
      id: p.id,
      name: p.def.name,
      role: p.role,
      team: p.team,
      hp: p.hp,
      maxHp: p.effectiveMaxHp,
      statsLine: `EN <b>${st.en}</b> AT <b>${st.at}</b> PA <b>${st.pa}</b> BL <b>${st.bl}</b> SH <b>${st.sh}</b> CA <b>${st.ca}</b> SP <b>${st.sp}</b>`,
      statuses: [
        p.poisonTicks > 0 ? "poison" : "",
        p.sleepTicks > 0 ? "sleep" : "",
        Object.keys(p.wither).length ? "wither" : "",
      ].filter(Boolean),
      contested: p.hasBall && contestedBy(m, p).length > 0,
      passTarget: target && p.hasBall ? this.names.player(target) : null,
      hotbar: hotbarOf(p).map((t, i) => ({
        id: t?.id ?? null,
        name: t?.name ?? "",
        kind: t?.kind ?? "",
        hpCost: t?.hpCost ?? 0,
        usable: t ? m.canUseTechnique(p, t.id) : false,
        cooldown:
          t?.kind === "tackle" && p.tackleCooldown > 0
            ? Math.min(1, p.tackleCooldown / (TACKLE_COOLDOWN_SECONDS * TICK_RATE))
            : 0,
        keyLabel: (keys[techKeys[i]]?.[0] ?? "").replace("Digit", "") || String(i + 1),
      })),
    };
  }

  private marksView(): MarkView[] {
    const m = this.match;
    const team = this.options.humanTeam ?? 0;
    const out: MarkView[] = [];
    for (const p of m.playersOf(team)) {
      const t = m.markTarget(p);
      if (t) out.push({ team, name: p.def.name, targetName: t.def.name });
    }
    return out;
  }

  private bannerView(): HudView["banner"] {
    const s = this.match.state;
    const e = this.bannerEvent;
    const skipKey = "Enter";
    if (s.phase === "finished" && this.settled) {
      return {
        kind: "full",
        title: "Full time",
        subtitle: `${s.score[0]} - ${s.score[1]}`,
        prompt: `${skipKey} to continue`,
      };
    }
    if (!e) return null;
    if (e.kind === "goal" && s.phase === "reset") {
      return { kind: "goal", title: "GOAL!", subtitle: `${this.names.player(e.by)}  -  ${e.score[0]} - ${e.score[1]}` };
    }
    if (e.kind === "half-time" && this.breakHold > 0) {
      return {
        kind: "half",
        title: "Half time",
        subtitle: `${e.score[0]} - ${e.score[1]}`,
        prompt: `${skipKey} to skip`,
      };
    }
    if (e.kind === "overtime-start" && this.breakHold > 0) {
      return {
        kind: "overtime",
        title: "Overtime",
        subtitle: `${e.score[0]} - ${e.score[1]}`,
        prompt: `${skipKey} to skip`,
      };
    }
    return null;
  }

  private promptLines(): string[] {
    if (this.options.humanTeam === null) return ["Watching AI vs AI", "<kbd>Esc</kbd> pause  <kbd>C</kbd> camera"];
    const base = ["<kbd>WASD</kbd> move  <kbd>R</kbd>/<kbd>F</kbd> up/down  <kbd>Shift</kbd> sprint"];
    switch (this.options.controlMode) {
      case "arcade":
        base.push(
          "<kbd>Space</kbd> pass  <kbd>J</kbd> shoot/tackle  <kbd>1-5</kbd> techniques",
          "<kbd>Q</kbd> switch  <kbd>E</kbd> target  <kbd>C</kbd> camera",
        );
        break;
      case "tactical":
        base.push("<kbd>Space</kbd>/<kbd>J</kbd> open menu with the ball", "contact pauses the game - pick an action");
        break;
      case "action":
        base.push(
          "<kbd>Space</kbd> pass  <kbd>J</kbd> shoot/tackle  <kbd>1-5</kbd> techniques",
          "no slow motion, no pauses",
        );
        break;
    }
    return base;
  }

  private finish(abandoned: boolean): void {
    if (this.disposed) return;
    const result = resultOf(this.match, abandoned);
    this.settled = true;
    this.fullTimeHold = -1;
    this.resolve(result);
    this.dispose();
  }
}

function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number) {
  // v' = q * v * q^-1
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** World (x, y-up, z) -> pool-plane (x, y) : pool y = -world z. */
function planar(v: { x: number; y: number; z: number }): { x: number; y: number } {
  return { x: v.x, y: -v.z };
}
