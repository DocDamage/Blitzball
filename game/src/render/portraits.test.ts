import { describe, expect, it } from "vitest";
import { portraitFor, portraitModelOf } from "./portraits";

describe("portraits", () => {
  it("resolve to null when the extracted assets are missing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
    try {
      await expect(portraitModelOf(0)).resolves.toBeNull();
      await expect(portraitFor(0)).resolves.toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
