/**
 * rng.ts - Seeded pseudo random number generator for the match simulation.
 *
 * Every random decision in the sim (contest spreads, AI noise, techcopy rolls,
 * pass/shot inaccuracy) must come from the match's single Rng instance so a
 * match replays identically from the same seed and inputs. mulberry32 is used:
 * 32-bit state, fast, and good enough statistically for gameplay.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Raw 32-bit unsigned integer. */
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

  /** Integer in [lo, hi] (both inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  /** Integer in [0, n-1] like the original Common.GetRandomInRange(maxExclusive = n); 0 when n <= 0. */
  rand(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.float() * n);
  }

  /** rand(100): percent roll. */
  pct(): number {
    return this.rand(100);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Uniform float in [lo, hi); used for FFX-style stat contest spreads. */
  spread(lo: number, hi: number): number {
    return lo + this.float() * (hi - lo);
  }

  /** Pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** Current internal state (exposed so a match snapshot can include it). */
  get state(): number {
    return this.s;
  }
}
