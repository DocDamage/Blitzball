import { describe, expect, it } from "vitest";
import {
  BINDINGS_KEY,
  DEFAULT_SETTINGS,
  defaultBindings,
  deserializeBindings,
  deserializeSettings,
  keyLabel,
  loadBindings,
  loadSettings,
  parseSettings,
  SETTINGS_KEY,
  saveBindings,
  saveSettings,
  serializeBindings,
  serializeSettings,
  toRuntimeBindings,
} from "./settings";

class FakeStore {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("settings serialisation", () => {
  it("round-trips", () => {
    const s = { ...DEFAULT_SETTINGS, controlMode: "tactical" as const, halfMinutes: 1 as const, uiScale: 1.2 };
    expect(deserializeSettings(serializeSettings(s))).toEqual(s);
  });

  it("drops unknown keys and repairs bad values", () => {
    const parsed = parseSettings({ controlMode: "bogus", halfMinutes: 7, uiScale: 99, overtime: "yes", extra: 1 });
    expect(parsed.controlMode).toBe(DEFAULT_SETTINGS.controlMode);
    expect(parsed.halfMinutes).toBe(DEFAULT_SETTINGS.halfMinutes);
    expect(parsed.uiScale).toBe(1.4);
    expect(parsed.overtime).toBe(DEFAULT_SETTINGS.overtime);
    expect("extra" in parsed).toBe(false);
  });

  it("survives garbage and null", () => {
    expect(deserializeSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(deserializeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("persists through a storage adapter", () => {
    const store = new FakeStore();
    saveSettings({ ...DEFAULT_SETTINGS, difficulty: "hard" }, store);
    expect(JSON.parse(store.getItem(SETTINGS_KEY) ?? "{}").difficulty).toBe("hard");
    expect(loadSettings(store).difficulty).toBe("hard");
    expect(loadSettings(new FakeStore())).toEqual(DEFAULT_SETTINGS);
  });
});

describe("key bindings", () => {
  it("are stored as a flat { action: key } object", () => {
    const store = new FakeStore();
    const b = { ...defaultBindings(), shoot: "Space" };
    saveBindings(b, store);
    const raw = JSON.parse(store.getItem(BINDINGS_KEY) ?? "{}");
    expect(raw.shoot).toBe("Space");
    expect(raw.pass).toBe("Space");
    expect(Object.values(raw).every((v) => typeof v === "string")).toBe(true);
    expect(loadBindings(store)).toEqual(b);
  });

  it("fills missing or invalid actions with defaults", () => {
    const b = deserializeBindings(JSON.stringify({ pass: "KeyP", shoot: 3, nonsense: "KeyZ" }));
    expect(b.pass).toBe("KeyP");
    expect(b.shoot).toBe(defaultBindings().shoot);
    expect("nonsense" in b).toBe(false);
    expect(JSON.parse(serializeBindings(b))).toEqual(b);
  });

  it("converts to the runtime's key-list shape", () => {
    const rt = toRuntimeBindings({ ...defaultBindings(), shoot: "KeyZ" });
    expect(rt.keys.shoot).toEqual(["KeyZ"]);
    expect(rt.keys.up).toEqual(["KeyW"]);
    expect(Object.keys(rt.keys).length).toBe(22);
  });

  it("labels key codes", () => {
    expect(keyLabel("KeyA")).toBe("A");
    expect(keyLabel("Digit5")).toBe("5");
    expect(keyLabel("ArrowUp")).toBe("Up arrow");
    expect(keyLabel("ShiftLeft")).toBe("Shift Left");
  });
});
