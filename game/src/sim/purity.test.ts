import { describe, expect, it } from "vitest";

/** sim/ must stay headless: no Three.js, no DOM, no imports from render/ or ui/. */
describe("sim purity", () => {
  it("has no DOM, Three.js, render or ui references", () => {
    const sources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >;
    const files = Object.keys(sources).filter((f) => !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    const banned = [
      /from\s+["']three["']/,
      /from\s+["']three\//,
      /\bdocument\b\s*\./,
      /\bwindow\b\s*\./,
      /\brequestAnimationFrame\b/,
      /\bnavigator\b\s*\./,
      /from\s+["']\.\.\/(render|ui)\//,
      /\bHTML[A-Za-z]*Element\b/,
    ];
    for (const f of files) {
      const src = sources[f];
      for (const re of banned) expect(src, `${f} matches ${re}`).not.toMatch(re);
    }
  });
});
