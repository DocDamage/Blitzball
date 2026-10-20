/**
 * settings.ts - User settings and key bindings, persisted in localStorage.
 *
 * `blitzball.settings` holds the Settings JSON; `blitzball.bindings` holds
 * the key bindings as a flat `{ action: key }` object (the shape the input
 * layer reads). Parsing is tolerant: unknown keys are dropped and missing or
 * invalid values fall back to defaults, so a stale save never breaks the UI.
 */

export type ControlMode = "arcade" | "tactical" | "action";
export type Difficulty = "easy" | "normal" | "hard";
export type CameraMode = "broadcast" | "tactical";

export interface Settings {
  controlMode: ControlMode;
  difficulty: Difficulty;
  /** Minutes per half: 1, 3 or 5. */
  halfMinutes: 1 | 3 | 5;
  overtime: boolean;
  camera: CameraMode;
  /** Audio placeholders (0..100); no audio engine yet. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** 0.8 .. 1.4 */
  uiScale: number;
  colorblind: boolean;
  screenShake: boolean;
  reducedFlash: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  controlMode: "arcade",
  difficulty: "normal",
  halfMinutes: 3,
  overtime: true,
  camera: "broadcast",
  masterVolume: 80,
  musicVolume: 70,
  sfxVolume: 80,
  uiScale: 1,
  colorblind: false,
  screenShake: true,
  reducedFlash: false,
});

export const SETTINGS_KEY = "blitzball.settings";
export const BINDINGS_KEY = "blitzball.bindings";

/**
 * Rebindable actions and their default keys (KeyboardEvent.code values).
 * Names match src/input/bindings.ts InputAction so the flat `{ action: key }`
 * map converts straight into the runtime's KeyBindings (toRuntimeBindings).
 */
export const BINDING_ACTIONS = [
  ["up", "Move up", "KeyW"],
  ["down", "Move down", "KeyS"],
  ["left", "Move left", "KeyA"],
  ["right", "Move right", "KeyD"],
  ["ascend", "Swim up", "KeyR"],
  ["descend", "Swim down", "KeyF"],
  ["sprint", "Sprint", "ShiftLeft"],
  ["pass", "Pass", "Space"],
  ["shoot", "Shoot", "KeyJ"],
  ["tackle", "Tackle", "KeyK"],
  ["switch", "Switch player", "KeyQ"],
  ["cycleTarget", "Cycle target", "KeyE"],
  ["tech1", "Technique 1", "Digit1"],
  ["tech2", "Technique 2", "Digit2"],
  ["tech3", "Technique 3", "Digit3"],
  ["tech4", "Technique 4", "Digit4"],
  ["tech5", "Technique 5", "Digit5"],
  ["pause", "Pause", "Escape"],
  ["skip", "Skip sequence", "Enter"],
  ["camera", "Camera", "KeyC"],
  ["confirm", "Confirm", "Enter"],
  ["back", "Back", "Escape"],
] as const;

export type BindingAction = (typeof BINDING_ACTIONS)[number][0];
export type KeyBindings = Record<BindingAction, string>;

/** The runtime's shape: a key list per action (only `keys` is overridden; pad bindings keep their defaults). */
export function toRuntimeBindings(b: KeyBindings): { keys: Record<BindingAction, string[]> } {
  const keys = {} as Record<BindingAction, string[]>;
  for (const [action] of BINDING_ACTIONS) keys[action] = [b[action]];
  return { keys };
}

export function defaultBindings(): KeyBindings {
  const out = {} as KeyBindings;
  for (const [action, , key] of BINDING_ACTIONS) out[action] = key;
  return out;
}

const CONTROL_MODES: readonly ControlMode[] = ["arcade", "tactical", "action"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
const CAMERAS: readonly CameraMode[] = ["broadcast", "tactical"];
const HALF_MINUTES = [1, 3, 5] as const;

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Validate an arbitrary value into Settings, filling gaps from defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    controlMode: oneOf(o.controlMode, CONTROL_MODES, d.controlMode),
    difficulty: oneOf(o.difficulty, DIFFICULTIES, d.difficulty),
    halfMinutes: oneOf(o.halfMinutes, HALF_MINUTES, d.halfMinutes),
    overtime: bool(o.overtime, d.overtime),
    camera: oneOf(o.camera, CAMERAS, d.camera),
    masterVolume: num(o.masterVolume, d.masterVolume, 0, 100),
    musicVolume: num(o.musicVolume, d.musicVolume, 0, 100),
    sfxVolume: num(o.sfxVolume, d.sfxVolume, 0, 100),
    uiScale: num(o.uiScale, d.uiScale, 0.8, 1.4),
    colorblind: bool(o.colorblind, d.colorblind),
    screenShake: bool(o.screenShake, d.screenShake),
    reducedFlash: bool(o.reducedFlash, d.reducedFlash),
  };
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify(parseSettings(s));
}

export function deserializeSettings(text: string | null): Settings {
  if (!text) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Validate bindings: every action gets a non-empty string key, defaults fill gaps. */
export function parseBindings(raw: unknown): KeyBindings {
  const out = defaultBindings();
  if (typeof raw !== "object" || raw === null) return out;
  const o = raw as Record<string, unknown>;
  for (const [action] of BINDING_ACTIONS) {
    const v = o[action];
    if (typeof v === "string" && v.length > 0) out[action] = v;
  }
  return out;
}

export function serializeBindings(b: KeyBindings): string {
  return JSON.stringify(parseBindings(b));
}

export function deserializeBindings(text: string | null): KeyBindings {
  if (!text) return defaultBindings();
  try {
    return parseBindings(JSON.parse(text));
  } catch {
    return defaultBindings();
  }
}

// ------------------------------------------------------------ storage

interface StringStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StringStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(store: StringStore | null = storage()): Settings {
  try {
    return deserializeSettings(store?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, store: StringStore | null = storage()): void {
  try {
    store?.setItem(SETTINGS_KEY, serializeSettings(s));
  } catch {
    // Storage unavailable (private mode, quota): settings live for the session only.
  }
}

export function loadBindings(store: StringStore | null = storage()): KeyBindings {
  try {
    return deserializeBindings(store?.getItem(BINDINGS_KEY) ?? null);
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(b: KeyBindings, store: StringStore | null = storage()): void {
  try {
    store?.setItem(BINDINGS_KEY, serializeBindings(b));
  } catch {
    // ignore
  }
}

/** Human label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5)} arrow`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}
