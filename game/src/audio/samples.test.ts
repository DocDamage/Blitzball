import { describe, expect, it } from "vitest";
import { MUSIC_PIECE, recipeFor, SampleBank } from "./samples";

describe("recipeFor", () => {
  it("maps engine cues onto the original sound groups", () => {
    expect(recipeFor("goal")?.layers.map((l) => l.cue)).toEqual(["goal", "crowd-roar"]);
    expect(recipeFor("tackle")?.layers[0].cue).toBe("tackle");
    expect(recipeFor("shot-blocked")?.layers[0].cue).toBe("tackle");
    expect(recipeFor("technique", "shot")?.layers[0].cue).toBe("shot-power");
    expect(recipeFor("technique", "pass")?.layers[0].cue).toBe("technique");
  });

  it("leaves cues without a recorded counterpart procedural", () => {
    expect(recipeFor("pass")).toBeNull();
    expect(recipeFor("pass-intercepted")).toBeNull();
    expect(recipeFor("breakthrough")).toBeNull();
  });

  it("keeps the procedural layer for saves", () => {
    expect(recipeFor("save")?.procedural).toBe(true);
    expect(recipeFor("goal")?.procedural).toBe(false);
  });

  it("names a music piece for every track", () => {
    expect(MUSIC_PIECE.match).toBe("blitz-off");
    expect(Object.keys(MUSIC_PIECE).sort()).toEqual(["defeat", "match", "menu", "victory"]);
  });
});

describe("SampleBank", () => {
  it("reports not ready and never rejects when the manifest is missing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
    try {
      const bank = new SampleBank("/nope/");
      await expect(bank.load()).resolves.toBeUndefined();
      expect(bank.ready).toBe(false);
      expect(bank.musicFile("blitz-off")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads a manifest", async () => {
    const original = globalThis.fetch;
    const manifest = {
      sfx: { goal: [{ file: "sfx/a.ogg", duration: 1 }] },
      music: { "blitz-off": { file: "music/b.ogg", duration: 9, loopStart: 1, loopEnd: 8 } },
    };
    globalThis.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) })) as unknown as typeof fetch;
    try {
      const bank = new SampleBank("/x/");
      await bank.load();
      expect(bank.ready).toBe(true);
      expect(bank.musicFile("blitz-off")?.loopEnd).toBe(8);
    } finally {
      globalThis.fetch = original;
    }
  });
});
