/**
 * hud.ts - DOM overlay for the playable match: scoreboard, clock, player
 * panel, technique hotbar, mark indicators, mode prompts, commentary ticker,
 * banners, the tactical radial menu and the pause menu. No Three.js, no
 * external libraries; styles live in hud.css.
 *
 * The runtime calls update(view) every frame with plain data and listens to
 * the callbacks it passed in HudCallbacks. Menus are navigable with
 * MenuNavKind events (keyboard / gamepad) and with the mouse.
 */

import "./hud.css";
import type { CommentaryLine, CommentaryTone } from "../../game/commentary";
import type { PendingAction } from "../../game/control";
import type { ControlMode } from "../../game/types";
import type { MenuNavKind } from "../../input/inputManager";

export interface HotbarSlotView {
  id: number | null;
  name: string;
  kind: string;
  hpCost: number;
  usable: boolean;
  /** 0..1 fraction of a cooldown still running (0 = ready). */
  cooldown: number;
  keyLabel: string;
}

export interface SelectedPlayerView {
  id: string;
  name: string;
  role: string;
  team: 0 | 1;
  hp: number;
  maxHp: number;
  statsLine: string;
  statuses: string[];
  contested: boolean;
  hotbar: HotbarSlotView[];
  passTarget: string | null;
}

export interface MarkView {
  team: 0 | 1;
  name: string;
  targetName: string;
}

export interface BannerView {
  kind: "goal" | "half" | "full" | "overtime" | "kickoff";
  title: string;
  subtitle?: string;
  prompt?: string;
}

export interface HudView {
  teamNames: [string, string];
  score: [number, number];
  /** Game seconds of the current period. */
  clock: number;
  half: 1 | 2 | 3;
  possession: 0 | 1 | null;
  humanTeam: 0 | 1 | null;
  mode: ControlMode;
  slowMo: boolean;
  selected: SelectedPlayerView | null;
  marks: MarkView[];
  banner: BannerView | null;
  prompt: string[];
}

export interface RadialOption {
  id: string;
  label: string;
  sub?: string;
  kind: "pass" | "shoot" | "breakthrough" | "technique";
  disabled?: boolean;
  action: PendingAction | null;
}

export interface PauseMenuState {
  cameraLabel: string;
}

export interface HudCallbacks {
  onResume(): void;
  onSkipToEnd(): void;
  onCycleCamera(): void;
  onQuit(): void;
  onRadialPick(option: RadialOption): void;
}

export interface HudSettings {
  uiScale: number;
  colorblind: boolean;
  reducedFlash: boolean;
  screenShake: boolean;
}

const TICKER_LINES = 4;
const TICKER_TTL_MS = 4200;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

export function halfLabel(half: 1 | 2 | 3): string {
  return half === 1 ? "1st half" : half === 2 ? "2nd half" : "Overtime";
}

export class Hud {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly cb: HudCallbacks;
  private readonly settings: HudSettings;

  private readonly scoreTeams: [HTMLElement, HTMLElement];
  private readonly scoreGoals: [HTMLElement, HTMLElement];
  private readonly scoreNames: [HTMLElement, HTMLElement];
  private readonly clockBox: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockHalf: HTMLElement;
  private readonly playerBox: HTMLElement;
  private readonly playerName: HTMLElement;
  private readonly playerRole: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly statsLine: HTMLElement;
  private readonly statuses: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly marks: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly slowMo: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly bannerPrompt: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly radial: HTMLElement;
  private readonly radialWheel: HTMLElement;
  private readonly radialCentre: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly pauseItems: HTMLElement[] = [];
  private readonly pauseCameraVal: HTMLElement;

  private radialOptions: RadialOption[] = [];
  private radialIndex = 0;
  private radialOpen = false;
  private pauseOpen = false;
  private pauseIndex = 0;
  private lastBannerKey = "";
  private lastSelectedId: string | null = null;
  private readonly tickerTimers: number[] = [];
  private disposed = false;

  constructor(container: HTMLElement, stage: HTMLElement, settings: HudSettings, cb: HudCallbacks) {
    this.cb = cb;
    this.stage = stage;
    this.settings = settings;
    this.root = el("div", "blitz-hud");
    this.root.style.setProperty("--hud-scale", String(Math.max(0.5, Math.min(2.5, settings.uiScale || 1))));
    this.root.dataset.colorblind = settings.colorblind ? "true" : "false";

    // scoreboard
    const score = el("div", "hud-score");
    const t0 = el("div", "team");
    t0.dataset.team = "0";
    const n0 = el("span", "tname");
    const g0 = el("span", "goals", "0");
    const p0 = el("span", "poss");
    t0.append(p0, n0, g0);
    const clock = el("div", "clock");
    this.clockTime = el("div", "time", "0:00");
    this.clockHalf = el("div", "half", "1st half");
    clock.append(this.clockTime, this.clockHalf);
    const t1 = el("div", "team");
    t1.dataset.team = "1";
    const g1 = el("span", "goals", "0");
    const n1 = el("span", "tname");
    const p1 = el("span", "poss");
    t1.append(g1, n1, p1);
    score.append(t0, clock, t1);
    this.scoreTeams = [t0, t1];
    this.scoreGoals = [g0, g1];
    this.clockBox = clock;
    this.scoreNames = [n0, n1];

    // player panel
    this.playerBox = el("div", "hud-player hidden");
    const nameRow = el("div", "name");
    this.playerName = el("span");
    this.playerRole = el("span", "role");
    nameRow.append(this.playerName, this.playerRole);
    this.hpBar = el("div", "hpbar");
    this.hpFill = el("div", "fill");
    this.hpBar.append(this.hpFill);
    this.hpText = el("div", "hptext");
    this.statsLine = el("div", "stats");
    this.statuses = el("div", "statuses");
    const contested = el("span", "contested", "Contested");
    this.playerBox.append(nameRow, this.hpBar, this.hpText, this.statsLine, this.statuses, contested);

    // hotbar
    this.hotbar = el("div", "hud-hotbar hidden");
    for (let i = 0; i < 5; i++) {
      const slot = el("div", "slot empty");
      slot.append(
        el("span", "key", String(i + 1)),
        el("span", "tname", "-"),
        el("span", "tcost", ""),
        el("span", "cool"),
      );
      this.hotbar.append(slot);
      this.hotbarSlots.push(slot);
    }

    this.marks = el("div", "hud-marks hidden");
    this.prompt = el("div", "hud-prompt");
    this.slowMo = el("div", "hud-slowmo", "SLOW");
    this.ticker = el("div", "hud-ticker");

    this.banner = el("div", "hud-banner");
    this.bannerTitle = el("div", "title");
    this.bannerSub = el("div", "sub");
    this.bannerPrompt = el("div", "prompt");
    this.banner.append(this.bannerTitle, this.bannerSub, this.bannerPrompt);
    this.flash = el("div", "hud-flash");

    // radial
    this.radial = el("div", "hud-radial");
    this.radialWheel = el("div", "wheel");
    this.radialCentre = el("div", "centre");
    this.radialWheel.append(this.radialCentre);
    this.radial.append(this.radialWheel);
    this.radial.addEventListener("pointermove", (e) => this.radialHover(e));
    this.radial.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.radialHover(e);
      this.radialConfirm();
    });

    // pause
    this.pause = el("div", "hud-pause");
    const panel = el("div", "panel");
    panel.append(el("h2", undefined, "Paused"));
    const mk = (label: string, value?: string) => {
      const item = el("div", "item");
      item.append(el("span", "lbl", label));
      const val = el("span", "val", value ?? "");
      item.append(val);
      panel.append(item);
      this.pauseItems.push(item);
      return val;
    };
    mk("Resume");
    mk("Skip to full time");
    this.pauseCameraVal = mk("Camera", "broadcast");
    mk("Quit match");
    panel.append(el("div", "hint", "Up / Down to move, Enter to confirm, Esc to resume"));
    this.pause.append(panel);
    this.pauseItems.forEach((item, i) => {
      item.addEventListener("pointermove", () => this.setPauseIndex(i));
      item.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        this.setPauseIndex(i);
        this.pauseConfirm();
      });
    });

    this.root.append(
      score,
      this.playerBox,
      this.hotbar,
      this.marks,
      this.prompt,
      this.slowMo,
      this.ticker,
      this.flash,
      this.banner,
      this.radial,
      this.pause,
    );
    container.append(this.root);
  }

  // ------------------------------------------------------------------ per-frame

  update(v: HudView): void {
    if (this.disposed) return;
    this.scoreNames[0].textContent = v.teamNames[0];
    this.scoreNames[1].textContent = v.teamNames[1];
    this.scoreGoals[0].textContent = String(v.score[0]);
    this.scoreGoals[1].textContent = String(v.score[1]);
    this.scoreTeams[0].classList.toggle("has-ball", v.possession === 0);
    this.scoreTeams[1].classList.toggle("has-ball", v.possession === 1);
    this.clockTime.textContent = formatClock(v.clock);
    this.clockHalf.textContent = halfLabel(v.half);
    this.clockBox.classList.toggle("slowmo", v.slowMo);
    this.slowMo.classList.toggle("on", v.mode === "arcade" && v.slowMo);

    const s = v.selected;
    this.playerBox.classList.toggle("hidden", !s);
    this.hotbar.classList.toggle("hidden", !s);
    if (s) {
      this.playerBox.dataset.team = String(s.team);
      if (s.id !== this.lastSelectedId) {
        this.lastSelectedId = s.id;
        this.playerName.textContent = s.name;
      }
      this.playerRole.textContent = s.passTarget ? `${s.role} - pass to ${s.passTarget}` : s.role;
      const frac = s.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / s.maxHp)) : 0;
      this.hpFill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.hpBar.classList.toggle("low", frac < 0.25);
      this.hpText.textContent = `HP ${Math.max(0, Math.round(s.hp))} / ${s.maxHp}`;
      this.statsLine.innerHTML = s.statsLine;
      this.statuses.replaceChildren(...s.statuses.map((st) => el("span", st, st)));
      this.playerBox.classList.toggle("is-contested", s.contested);
      s.hotbar.forEach((slot, i) => {
        const e = this.hotbarSlots[i];
        if (!e) return;
        e.className = `slot ${slot.id === null ? "empty" : slot.usable ? "usable" : "unusable"}`;
        (e.children[0] as HTMLElement).textContent = slot.keyLabel;
        (e.children[1] as HTMLElement).textContent = slot.id === null ? "-" : slot.name;
        (e.children[2] as HTMLElement).textContent = slot.id === null ? "" : `${slot.kind} - ${slot.hpCost} HP`;
        (e.children[3] as HTMLElement).style.width = `${(slot.cooldown * 100).toFixed(0)}%`;
      });
    }

    this.marks.classList.toggle("hidden", v.marks.length === 0);
    if (v.marks.length > 0) {
      const rows: HTMLElement[] = [el("div", "title", "Marks")];
      for (const m of v.marks) {
        const row = el("div", "mark");
        const dot = el("span", `dot t${m.team}`);
        const text = el("span");
        text.append(el("b", undefined, m.name), document.createTextNode(` on ${m.targetName}`));
        row.append(dot, text);
        rows.push(row);
      }
      this.marks.replaceChildren(...rows);
    }

    this.prompt.innerHTML = v.prompt.join("<br>");

    const key = v.banner ? `${v.banner.kind}:${v.banner.title}:${v.banner.subtitle ?? ""}` : "";
    if (key !== this.lastBannerKey) {
      this.lastBannerKey = key;
      this.banner.className = `hud-banner${v.banner ? ` on ${v.banner.kind}` : ""}`;
      if (v.banner) {
        this.bannerTitle.textContent = v.banner.title;
        this.bannerSub.textContent = v.banner.subtitle ?? "";
        this.bannerPrompt.textContent = v.banner.prompt ?? "";
      }
    }
  }

  // ------------------------------------------------------------------ effects

  pushCommentary(lines: readonly (CommentaryLine & { stamp?: string })[]): void {
    if (this.disposed) return;
    for (const l of lines) {
      const e = el("div", `line ${l.tone satisfies CommentaryTone}`, l.stamp ? `${l.stamp}  ${l.text}` : l.text);
      this.ticker.append(e);
      const t = window.setTimeout(() => {
        e.classList.add("fading");
        window.setTimeout(() => e.remove(), 420);
      }, TICKER_TTL_MS);
      this.tickerTimers.push(t);
    }
    while (this.ticker.children.length > TICKER_LINES) this.ticker.firstElementChild?.remove();
  }

  /** Goal flash (suppressed by reducedFlash) and screen shake (toggle). */
  goalEffects(): void {
    if (!this.settings.reducedFlash) {
      this.flash.classList.remove("on");
      void this.flash.offsetWidth;
      this.flash.classList.add("on");
    }
    this.shake();
  }

  shake(): void {
    if (!this.settings.screenShake) return;
    this.stage.classList.remove("blitz-shake");
    void this.stage.offsetWidth;
    this.stage.classList.add("blitz-shake");
  }

  // ------------------------------------------------------------------ radial menu

  get isRadialOpen(): boolean {
    return this.radialOpen;
  }

  openRadial(title: string, subtitle: string, options: RadialOption[]): void {
    this.radialOptions = options;
    this.radialIndex = Math.max(
      0,
      options.findIndex((o) => !o.disabled),
    );
    this.radialOpen = true;
    this.radialCentre.replaceChildren(el("b", undefined, title), document.createTextNode(subtitle));
    for (const child of [...this.radialWheel.children]) if (child !== this.radialCentre) child.remove();
    const n = options.length;
    const radius = 140;
    options.forEach((o, i) => {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const opt = el("div", `opt kind-${o.kind}${o.disabled ? " disabled" : ""}`);
      opt.style.transform = `translate(calc(${Math.cos(angle) * radius}px * var(--hud-scale)), calc(${
        Math.sin(angle) * radius
      }px * var(--hud-scale)))`;
      opt.append(el("span", "lbl", o.label));
      if (o.sub) opt.append(el("span", "sub", o.sub));
      opt.dataset.index = String(i);
      this.radialWheel.append(opt);
    });
    this.radial.classList.add("on");
    this.renderRadialSelection();
  }

  closeRadial(): void {
    this.radialOpen = false;
    this.radial.classList.remove("on");
  }

  private radialHover(e: PointerEvent): void {
    if (!this.radialOpen || this.radialOptions.length === 0) return;
    const r = this.radialWheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) return;
    const n = this.radialOptions.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    const i = Math.round((a / (Math.PI * 2)) * n) % n;
    if (i !== this.radialIndex) {
      this.radialIndex = i;
      this.renderRadialSelection();
    }
  }

  private renderRadialSelection(): void {
    const opts = this.radialWheel.querySelectorAll<HTMLElement>(".opt");
    opts.forEach((o, i) => {
      o.classList.toggle("selected", i === this.radialIndex);
    });
  }

  private radialMove(delta: number): void {
    const n = this.radialOptions.length;
    if (n === 0) return;
    this.radialIndex = (this.radialIndex + delta + n) % n;
    this.renderRadialSelection();
  }

  private radialConfirm(): void {
    const o = this.radialOptions[this.radialIndex];
    if (!o || o.disabled) return;
    this.closeRadial();
    this.cb.onRadialPick(o);
  }

  // ------------------------------------------------------------------ pause menu

  get isPauseOpen(): boolean {
    return this.pauseOpen;
  }

  openPause(state: PauseMenuState): void {
    this.pauseOpen = true;
    this.pauseIndex = 0;
    this.pauseCameraVal.textContent = state.cameraLabel;
    this.pause.classList.add("on");
    this.renderPause();
  }

  setPauseCamera(label: string): void {
    this.pauseCameraVal.textContent = label;
  }

  closePause(): void {
    this.pauseOpen = false;
    this.pause.classList.remove("on");
  }

  private setPauseIndex(i: number): void {
    this.pauseIndex = i;
    this.renderPause();
  }

  private renderPause(): void {
    this.pauseItems.forEach((item, i) => {
      item.classList.toggle("selected", i === this.pauseIndex);
    });
  }

  private pauseConfirm(): void {
    switch (this.pauseIndex) {
      case 0:
        this.cb.onResume();
        break;
      case 1:
        this.cb.onSkipToEnd();
        break;
      case 2:
        this.cb.onCycleCamera();
        break;
      case 3:
        this.cb.onQuit();
        break;
    }
  }

  // ------------------------------------------------------------------ navigation

  /** Route a menu-navigation event to the open menu. Returns true when consumed. */
  nav(kind: MenuNavKind): boolean {
    if (this.pauseOpen) {
      const n = this.pauseItems.length;
      if (kind === "up") this.setPauseIndex((this.pauseIndex + n - 1) % n);
      else if (kind === "down") this.setPauseIndex((this.pauseIndex + 1) % n);
      else if (kind === "confirm") this.pauseConfirm();
      else if (kind === "back") this.cb.onResume();
      else return false;
      return true;
    }
    if (this.radialOpen) {
      if (kind === "right" || kind === "down") this.radialMove(1);
      else if (kind === "left" || kind === "up") this.radialMove(-1);
      else if (kind === "confirm") this.radialConfirm();
      else if (kind === "back") {
        const bt = this.radialOptions.find((o) => o.kind === "breakthrough");
        this.closeRadial();
        if (bt) this.cb.onRadialPick(bt);
      } else return false;
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.tickerTimers) window.clearTimeout(t);
    this.root.remove();
  }
}
