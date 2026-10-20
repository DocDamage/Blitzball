import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic for the same seed", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(a.state).toBe(b.state);
  });

  it("differs for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("produces floats in [0,1) and ints in range", () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
      expect(Number.isInteger(n)).toBe(true);
      const s = r.spread(0.75, 1.25);
      expect(s).toBeGreaterThanOrEqual(0.75);
      expect(s).toBeLessThan(1.25);
    }
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
  });

  it("covers the int range evenly enough", () => {
    const r = new Rng(7);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[r.int(0, 3)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
});
