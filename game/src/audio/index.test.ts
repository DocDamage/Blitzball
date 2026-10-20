import { describe, expect, it } from "vitest";
import { createAudio, DEFAULT_AUDIO_SETTINGS, familyOf } from "./index";

describe("createAudio", () => {
  it("falls back to a silent no-op backend when AudioContext is missing", () => {
    const a = createAudio(DEFAULT_AUDIO_SETTINGS);
    expect(a.available).toBe(false);
    expect(() => {
      a.resume();
      a.play("goal");
      a.play("technique", { family: "shot" });
      a.setVolumes({ master: 0.5, muted: true });
      a.setAmbience(true);
      a.startMusic();
      a.setUserMusic(null);
      a.stopMusic();
      a.dispose();
    }).not.toThrow();
  });

  it("maps technique kinds to sting families", () => {
    expect(familyOf("shot")).toBe("shot");
    expect(familyOf("pass")).toBe("pass");
    expect(familyOf("tackle")).toBe("tackle");
    expect(familyOf("evade")).toBe("passive");
    expect(familyOf(undefined)).toBe("passive");
  });
});
