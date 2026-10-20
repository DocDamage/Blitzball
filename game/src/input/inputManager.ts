/**
 * inputManager.ts - Keyboard + mouse + Gamepad API unified into one polled
 * InputState. The runtime calls poll() once per animation frame; "pressed"
 * edges are collected between polls so no key press is lost on a slow frame.
 *
 * Menu navigation (up/down/left/right/confirm/back) is published as events
 * for the shell: subscribe with onMenuNav() or listen on window for the
 * "blitz-menunav" CustomEvent (detail: MenuNavEvent). Gamepad sticks and
 * d-pad repeat while held so lists can be scrolled without a mouse.
 */

import { DEFAULT_BINDINGS, INPUT_ACTIONS, type InputAction, type KeyBindings } from "./bindings";

export type MenuNavKind = "up" | "down" | "left" | "right" | "confirm" | "back";
export type InputSource = "keyboard" | "mouse" | "gamepad";

export interface MenuNavEvent {
  kind: MenuNavKind;
  source: InputSource;
}

export const MENU_NAV_EVENT = "blitz-menunav";

export interface PointerState {
  /** CSS pixels relative to the manager's element. */
  x: number;
  y: number;
  /** Normalised -1..1 from the element centre (x right, y up). */
  nx: number;
  ny: number;
  down: boolean;
  /** Button edge since last poll: 0 left, 2 right. */
  clicked: number | null;
  /** Wheel delta since last poll (sign only matters). */
  wheel: number;
  inside: boolean;
}

export interface InputState {
  /** Screen-relative move vector, each axis -1..1 (x right, y forward/up on screen). Not normalised. */
  move: { x: number; y: number };
  /** -1 (descend) .. 1 (ascend). */
  vertical: number;
  /** Actions held at the time of the poll. */
  held: ReadonlySet<InputAction>;
  /** Actions whose press edge happened since the previous poll. */
  pressed: ReadonlySet<InputAction>;
  pointer: PointerState;
  /** Device that produced the most recent input. */
  lastSource: InputSource;
  /** True when at least one gamepad is connected. */
  gamepadConnected: boolean;
}

export interface InputManagerOptions {
  bindings?: KeyBindings;
  /** Element receiving pointer events (defaults to the window for keys; pointer coords relative to this). */
  element?: HTMLElement;
  /** Stick dead zone (0..1). */
  deadZone?: number;
  /** Whether to also dispatch MENU_NAV_EVENT on window. */
  dispatchWindowEvents?: boolean;
}

const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;

export class InputManager {
  bindings: KeyBindings;
  private readonly element: HTMLElement | null;
  private readonly deadZone: number;
  private readonly dispatchWindowEvents: boolean;
  private readonly keysDown = new Set<string>();
  private readonly pressedSinceLastPoll = new Set<InputAction>();
  private readonly padDown = new Set<number>();
  private padAxes: number[] = [0, 0, 0, 0];
  private lastSource: InputSource = "keyboard";
  private readonly navListeners = new Set<(e: MenuNavEvent) => void>();
  private readonly pressListeners = new Set<(action: InputAction, source: InputSource) => void>();
  private readonly navRepeat = new Map<MenuNavKind, number>();
  private pointer: PointerState = {
    x: 0,
    y: 0,
    nx: 0,
    ny: 0,
    down: false,
    clicked: null,
    wheel: 0,
    inside: false,
  };
  private pointerClicked: number | null = null;
  private wheelAccum = 0;
  private enabled = true;
  private disposed = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(opts: InputManagerOptions = {}) {
    this.bindings = opts.bindings ?? structuredClone(DEFAULT_BINDINGS);
    this.element = opts.element ?? null;
    this.deadZone = opts.deadZone ?? 0.22;
    this.dispatchWindowEvents = opts.dispatchWindowEvents ?? true;
    if (typeof window !== "undefined") this.attach();
  }

  /** Stop producing gameplay input (menus still navigate). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.pressedSinceLastPoll.clear();
  }

  onMenuNav(listener: (e: MenuNavEvent) => void): () => void {
    this.navListeners.add(listener);
    return () => this.navListeners.delete(listener);
  }

  /**
   * Press-edge callback, fired synchronously on the key / button event (after
   * any menu-navigation event for the same key). For actions that must react
   * immediately rather than on the next poll, such as pause.
   */
  onPress(listener: (action: InputAction, source: InputSource) => void): () => void {
    this.pressListeners.add(listener);
    return () => this.pressListeners.delete(listener);
  }

  /** Is `action` currently held on any device? */
  isHeld(action: InputAction): boolean {
    for (const code of this.bindings.keys[action] ?? []) if (this.keysDown.has(code)) return true;
    for (const b of this.bindings.pad[action] ?? []) if (this.padDown.has(b)) return true;
    return false;
  }

  /** Snapshot the current state and clear press edges. */
  poll(): InputState {
    this.pollGamepads();
    const held = new Set<InputAction>();
    if (this.enabled) for (const a of INPUT_ACTIONS) if (this.isHeld(a)) held.add(a);
    const pressed = new Set(this.enabled ? this.pressedSinceLastPoll : []);
    this.pressedSinceLastPoll.clear();

    let mx = 0;
    let my = 0;
    if (held.has("right")) mx += 1;
    if (held.has("left")) mx -= 1;
    if (held.has("up")) my += 1;
    if (held.has("down")) my -= 1;
    if (this.enabled) {
      const [ax, ay] = this.stick(0);
      if (ax !== 0 || ay !== 0) {
        mx = ax;
        my = -ay;
      }
    }
    let vertical = 0;
    if (held.has("ascend")) vertical += 1;
    if (held.has("descend")) vertical -= 1;
    if (this.enabled && vertical === 0) {
      const [, ry] = this.stick(1);
      if (ry !== 0) vertical = -ry;
    }

    const pointer: PointerState = {
      ...this.pointer,
      clicked: this.enabled ? this.pointerClicked : null,
      wheel: this.enabled ? this.wheelAccum : 0,
    };
    this.pointerClicked = null;
    this.wheelAccum = 0;

    return {
      move: { x: clamp1(mx), y: clamp1(my) },
      vertical: clamp1(vertical),
      held,
      pressed,
      pointer,
      lastSource: this.lastSource,
      gamepadConnected: this.anyGamepad(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.navListeners.clear();
  }

  // ------------------------------------------------------------------ internals

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (this.isNavKey(e.code)) e.preventDefault();
        return;
      }
      this.lastSource = "keyboard";
      this.keysDown.add(e.code);
      const nav = this.navForKey(e.code);
      if (nav) this.emitNav(nav, "keyboard");
      let bound = false;
      for (const a of INPUT_ACTIONS) {
        if (this.bindings.keys[a]?.includes(e.code)) {
          bound = true;
          this.press(a, "keyboard");
        }
      }
      if (bound && (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow"))) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    };
    const onBlur = () => {
      this.keysDown.clear();
      this.padDown.clear();
      this.pointer.down = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });

    const el = this.element ?? document.body;
    const updatePointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.nx = r.width > 0 ? (x / r.width) * 2 - 1 : 0;
      this.pointer.ny = r.height > 0 ? -((y / r.height) * 2 - 1) : 0;
      this.pointer.inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    };
    const onMove = (e: PointerEvent) => {
      updatePointer(e);
    };
    const onDown = (e: PointerEvent) => {
      this.lastSource = "mouse";
      updatePointer(e);
      this.pointer.down = true;
      this.pointerClicked = e.button;
      if (e.button === 2) e.preventDefault();
    };
    const onUp = () => {
      this.pointer.down = false;
    };
    const onWheel = (e: WheelEvent) => {
      this.wheelAccum += Math.sign(e.deltaY);
    };
    const onContext = (e: Event) => e.preventDefault();
    window.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("contextmenu", onContext);
    this.cleanup.push(() => {
      window.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContext);
    });
  }

  private isNavKey(code: string): boolean {
    return this.navForKey(code) !== null;
  }

  private navForKey(code: string): MenuNavKind | null {
    const k = this.bindings.keys;
    if (code === "ArrowUp" || k.up.includes(code)) return "up";
    if (code === "ArrowDown" || k.down.includes(code)) return "down";
    if (code === "ArrowLeft" || k.left.includes(code)) return "left";
    if (code === "ArrowRight" || k.right.includes(code)) return "right";
    if (k.confirm.includes(code)) return "confirm";
    if (k.back.includes(code)) return "back";
    return null;
  }

  private press(action: InputAction, source: InputSource): void {
    if (this.enabled) this.pressedSinceLastPoll.add(action);
    for (const l of this.pressListeners) l(action, source);
  }

  private emitNav(kind: MenuNavKind, source: InputSource): void {
    const ev: MenuNavEvent = { kind, source };
    for (const l of this.navListeners) l(ev);
    if (this.dispatchWindowEvents && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<MenuNavEvent>(MENU_NAV_EVENT, { detail: ev }));
    }
  }

  private anyGamepad(): boolean {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
    try {
      for (const g of navigator.getGamepads()) if (g) return true;
    } catch {
      return false;
    }
    return false;
  }

  private stick(index: 0 | 1): [number, number] {
    const ax = this.padAxes[index * 2] ?? 0;
    const ay = this.padAxes[index * 2 + 1] ?? 0;
    const mag = Math.hypot(ax, ay);
    if (mag < this.deadZone) return [0, 0];
    const scaled = Math.min(1, (mag - this.deadZone) / (1 - this.deadZone));
    return [(ax / mag) * scaled, (ay / mag) * scaled];
  }

  private pollGamepads(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    let pads: (Gamepad | null)[];
    try {
      pads = [...navigator.getGamepads()];
    } catch {
      return;
    }
    const pad = pads.find((g) => g?.connected) ?? null;
    if (!pad) {
      this.padDown.clear();
      this.padAxes = [0, 0, 0, 0];
      return;
    }
    this.padAxes = [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0];
    const now = performance.now();
    const next = new Set<number>();
    const edges: number[] = [];
    pad.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5;
      if (!down) return;
      next.add(i);
      if (!this.padDown.has(i)) edges.push(i);
    });
    this.padDown.clear();
    for (const i of next) this.padDown.add(i);
    if (edges.length > 0) this.lastSource = "gamepad";

    // Menu navigation from d-pad / left stick with key repeat, plus confirm/back edges.
    const [sx, sy] = this.stick(0);
    const navDown: Record<MenuNavKind, boolean> = {
      up: next.has(12) || sy < -0.6,
      down: next.has(13) || sy > 0.6,
      left: next.has(14) || sx < -0.6,
      right: next.has(15) || sx > 0.6,
      confirm: this.bindings.pad.confirm.some((b) => next.has(b)),
      back: this.bindings.pad.back.some((b) => next.has(b)),
    };
    for (const kind of Object.keys(navDown) as MenuNavKind[]) {
      if (!navDown[kind]) {
        this.navRepeat.delete(kind);
        continue;
      }
      const due = this.navRepeat.get(kind);
      if (due === undefined) {
        this.emitNav(kind, "gamepad");
        this.navRepeat.set(kind, now + REPEAT_DELAY_MS);
      } else if (now >= due && kind !== "confirm" && kind !== "back") {
        this.emitNav(kind, "gamepad");
        this.navRepeat.set(kind, now + REPEAT_RATE_MS);
      }
    }
    // Press edges after navigation so a menu can consume the button first (see onPress).
    for (const i of edges)
      for (const a of INPUT_ACTIONS) if (this.bindings.pad[a]?.includes(i)) this.press(a, "gamepad");
  }
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
