/**
 * bindings.ts - Rebindable input actions for keyboard and gamepad.
 *
 * A KeyBindings value maps every InputAction to a list of KeyboardEvent.code
 * values and a list of standard-mapping Gamepad button indices. Bindings are
 * plain JSON so they can be stored in localStorage (load/save) and merged
 * with partial overrides from the settings screen (mergeBindings).
 */

export type InputAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "ascend"
  | "descend"
  | "sprint"
  | "pass"
  | "shoot"
  | "tackle"
  | "switch"
  | "cycleTarget"
  | "tech1"
  | "tech2"
  | "tech3"
  | "tech4"
  | "tech5"
  | "pause"
  | "skip"
  | "camera"
  | "confirm"
  | "back";

export const INPUT_ACTIONS: readonly InputAction[] = [
  "up",
  "down",
  "left",
  "right",
  "ascend",
  "descend",
  "sprint",
  "pass",
  "shoot",
  "tackle",
  "switch",
  "cycleTarget",
  "tech1",
  "tech2",
  "tech3",
  "tech4",
  "tech5",
  "pause",
  "skip",
  "camera",
  "confirm",
  "back",
];

/** Human-readable labels for the settings screen. */
export const ACTION_LABELS: Record<InputAction, string> = {
  up: "Move forward",
  down: "Move back",
  left: "Move left",
  right: "Move right",
  ascend: "Swim up",
  descend: "Swim down",
  sprint: "Sprint",
  pass: "Pass",
  shoot: "Shoot",
  tackle: "Tackle",
  switch: "Switch player",
  cycleTarget: "Cycle pass target",
  tech1: "Technique 1",
  tech2: "Technique 2",
  tech3: "Technique 3",
  tech4: "Technique 4",
  tech5: "Technique 5",
  pause: "Pause",
  skip: "Skip",
  camera: "Camera mode",
  confirm: "Confirm",
  back: "Back",
};

export interface KeyBindings {
  /** KeyboardEvent.code values per action. */
  keys: Record<InputAction, string[]>;
  /** Standard-mapping gamepad button indices per action. */
  pad: Record<InputAction, number[]>;
}

/** Standard gamepad button indices (w3c "standard" mapping). */
export const PAD = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
});

export const DEFAULT_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  keys: {
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    ascend: ["KeyR", "PageUp"],
    descend: ["KeyF", "PageDown"],
    sprint: ["ShiftLeft", "ShiftRight"],
    pass: ["Space"],
    shoot: ["KeyJ"],
    tackle: ["KeyK"],
    switch: ["KeyQ"],
    cycleTarget: ["KeyE", "Tab"],
    tech1: ["Digit1"],
    tech2: ["Digit2"],
    tech3: ["Digit3"],
    tech4: ["Digit4"],
    tech5: ["Digit5"],
    pause: ["Escape", "KeyP"],
    skip: ["Enter"],
    camera: ["KeyC"],
    confirm: ["Enter", "Space"],
    back: ["Escape", "Backspace"],
  },
  pad: {
    up: [PAD.DUP],
    down: [PAD.DDOWN],
    left: [PAD.DLEFT],
    right: [PAD.DRIGHT],
    ascend: [PAD.RS],
    descend: [PAD.LS],
    sprint: [PAD.RT],
    pass: [PAD.A],
    shoot: [PAD.X],
    tackle: [PAD.B],
    switch: [PAD.LB],
    cycleTarget: [PAD.RB],
    tech1: [PAD.Y],
    tech2: [],
    tech3: [],
    tech4: [],
    tech5: [],
    pause: [PAD.START],
    skip: [PAD.START],
    camera: [PAD.BACK],
    confirm: [PAD.A],
    back: [PAD.B],
  },
});

export const BINDINGS_STORAGE_KEY = "blitzball.keyBindings.v1";

function cloneBindings(b: Readonly<KeyBindings>): KeyBindings {
  const keys = {} as Record<InputAction, string[]>;
  const pad = {} as Record<InputAction, number[]>;
  for (const a of INPUT_ACTIONS) {
    keys[a] = [...(b.keys[a] ?? [])];
    pad[a] = [...(b.pad[a] ?? [])];
  }
  return { keys, pad };
}

/** Deep-merge per-action overrides over `base` (defaults by default). */
export function mergeBindings(
  partial: Partial<{ keys: Partial<Record<InputAction, string[]>>; pad: Partial<Record<InputAction, number[]>> }> = {},
  base: Readonly<KeyBindings> = DEFAULT_BINDINGS,
): KeyBindings {
  const out = cloneBindings(base);
  for (const a of INPUT_ACTIONS) {
    const k = partial.keys?.[a];
    if (Array.isArray(k)) out.keys[a] = k.filter((c) => typeof c === "string");
    const p = partial.pad?.[a];
    if (Array.isArray(p)) out.pad[a] = p.filter((n) => Number.isInteger(n) && n >= 0);
  }
  return out;
}

/** Rebind one action on one device, removing the chosen key from any other action that used it. */
export function rebind(
  bindings: Readonly<KeyBindings>,
  action: InputAction,
  device: "keys",
  code: string,
  slot?: number,
): KeyBindings;
export function rebind(
  bindings: Readonly<KeyBindings>,
  action: InputAction,
  device: "pad",
  code: number,
  slot?: number,
): KeyBindings;
export function rebind(
  bindings: Readonly<KeyBindings>,
  action: InputAction,
  device: "keys" | "pad",
  code: string | number,
  slot = 0,
): KeyBindings {
  const out = cloneBindings(bindings);
  // Menu actions (confirm/back/skip/pause) may legitimately share keys with gameplay ones.
  const menu: readonly InputAction[] = ["confirm", "back", "skip", "pause"];
  const isMenu = menu.includes(action);
  for (const a of INPUT_ACTIONS) {
    if (a === action) continue;
    if (menu.includes(a) !== isMenu) continue;
    const list = out[device][a] as (string | number)[];
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
  }
  const target = out[device][action] as (string | number)[];
  const dup = target.indexOf(code);
  if (dup >= 0) target.splice(dup, 1);
  target[Math.max(0, Math.min(slot, target.length))] = code;
  return out;
}

export function serializeBindings(b: Readonly<KeyBindings>): string {
  return JSON.stringify({ version: 1, keys: b.keys, pad: b.pad });
}

/** Parse a serialized value; anything malformed falls back to the defaults for that action. */
export function parseBindings(json: string | null | undefined): KeyBindings {
  if (!json) return cloneBindings(DEFAULT_BINDINGS);
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") return cloneBindings(DEFAULT_BINDINGS);
    const r = raw as { keys?: unknown; pad?: unknown };
    return mergeBindings({
      keys: (r.keys && typeof r.keys === "object" ? r.keys : {}) as Partial<Record<InputAction, string[]>>,
      pad: (r.pad && typeof r.pad === "object" ? r.pad : {}) as Partial<Record<InputAction, number[]>>,
    });
  } catch {
    return cloneBindings(DEFAULT_BINDINGS);
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // access can throw in sandboxed documents
  }
  return null;
}

export function loadBindings(storage: StorageLike | null = defaultStorage()): KeyBindings {
  if (!storage) return cloneBindings(DEFAULT_BINDINGS);
  try {
    return parseBindings(storage.getItem(BINDINGS_STORAGE_KEY));
  } catch {
    return cloneBindings(DEFAULT_BINDINGS);
  }
}

export function saveBindings(b: Readonly<KeyBindings>, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BINDINGS_STORAGE_KEY, serializeBindings(b));
    return true;
  } catch {
    return false;
  }
}

export function resetBindings(storage: StorageLike | null = defaultStorage()): KeyBindings {
  try {
    storage?.removeItem(BINDINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
  return cloneBindings(DEFAULT_BINDINGS);
}

/** Short display name for a KeyboardEvent.code ("KeyW" -> "W", "ArrowUp" -> "Up"). */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5);
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "Space") return "Space";
  return code;
}

const PAD_LABELS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "Back",
  9: "Start",
  10: "LS",
  11: "RS",
  12: "D-Up",
  13: "D-Down",
  14: "D-Left",
  15: "D-Right",
};

export function padLabel(index: number): string {
  return PAD_LABELS[index] ?? `B${index}`;
}
