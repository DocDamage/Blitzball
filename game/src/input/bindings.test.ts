import { describe, expect, it } from "vitest";
import {
  BINDINGS_STORAGE_KEY,
  DEFAULT_BINDINGS,
  INPUT_ACTIONS,
  keyLabel,
  loadBindings,
  mergeBindings,
  parseBindings,
  rebind,
  resetBindings,
  saveBindings,
  serializeBindings,
} from "./bindings";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    map,
  };
}

describe("key bindings", () => {
  it("has every action bound on the keyboard by default", () => {
    for (const a of INPUT_ACTIONS) expect(DEFAULT_BINDINGS.keys[a].length, a).toBeGreaterThan(0);
  });

  it("serialises and parses back to an equal value", () => {
    const b = mergeBindings({ keys: { pass: ["KeyX"] }, pad: { pass: [3] } });
    const parsed = parseBindings(serializeBindings(b));
    expect(parsed).toEqual(b);
    expect(parsed.keys.pass).toEqual(["KeyX"]);
    expect(parsed.pad.pass).toEqual([3]);
    expect(parsed.keys.shoot).toEqual(DEFAULT_BINDINGS.keys.shoot);
  });

  it("falls back to defaults for malformed input", () => {
    expect(parseBindings("not json")).toEqual(mergeBindings());
    expect(parseBindings(null)).toEqual(mergeBindings());
    const partial = parseBindings(JSON.stringify({ keys: { pass: "nope", shoot: ["KeyZ", 5] } }));
    expect(partial.keys.pass).toEqual(DEFAULT_BINDINGS.keys.pass);
    expect(partial.keys.shoot).toEqual(["KeyZ"]);
  });

  it("saves to and loads from storage", () => {
    const storage = memoryStorage();
    const b = rebind(DEFAULT_BINDINGS, "shoot", "keys", "KeyL");
    expect(saveBindings(b, storage)).toBe(true);
    expect(storage.map.has(BINDINGS_STORAGE_KEY)).toBe(true);
    expect(loadBindings(storage).keys.shoot).toEqual(["KeyL"]);
    expect(resetBindings(storage)).toEqual(mergeBindings());
    expect(loadBindings(storage)).toEqual(mergeBindings());
    expect(loadBindings(null)).toEqual(mergeBindings());
    expect(saveBindings(b, null)).toBe(false);
  });

  it("rebinding steals the key from other gameplay actions but not menu ones", () => {
    const b = rebind(DEFAULT_BINDINGS, "shoot", "keys", "Space");
    expect(b.keys.shoot[0]).toBe("Space");
    expect(b.keys.pass).not.toContain("Space");
    expect(b.keys.confirm).toContain("Space");
    const p = rebind(b, "tackle", "pad", 0);
    expect(p.pad.tackle).toEqual([0]);
    expect(p.pad.pass).not.toContain(0);
    expect(p.pad.confirm).toContain(0);
  });

  it("labels keys", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("ArrowUp")).toBe("Up");
    expect(keyLabel("ShiftLeft")).toBe("Shift");
  });
});
