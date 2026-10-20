/**
 * rng.ts - Seeded RNG for the league layer (mulberry32). Kept local so
 * league/ never depends on sim/. The state is a plain number so it can be
 * stored in LeagueState and saved.
 */

export class LeagueRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  static fromState(state: number): LeagueRng {
    return new LeagueRng(state);
  }

  get state(): number {
    return this.s;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty array");
    return items[this.int(0, items.length - 1)];
  }

  /** In-place Fisher-Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}

/** Mix a few integers into one 32-bit seed (for per-fixture match seeds). */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
