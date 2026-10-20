import { describe, expect, it } from "vitest";
import { back, canGo, createRouter, current, go, replace, setHasGame } from "./router";

describe("router", () => {
  it("starts on the main menu without a game", () => {
    const r = createRouter();
    expect(current(r)).toBe("main");
    expect(r.hasGame).toBe(false);
  });

  it("refuses game screens until a game is loaded", () => {
    let r = createRouter(false);
    expect(canGo(r, "settings")).toBe(true);
    expect(canGo(r, "team")).toBe(false);
    r = go(r, "team");
    expect(current(r)).toBe("main");
    r = setHasGame(r, true);
    r = go(r, "team");
    expect(current(r)).toBe("team");
  });

  it("pushes and pops like a stack", () => {
    let r = setHasGame(createRouter(), true);
    r = go(r, "hub");
    r = go(r, "team");
    r = go(r, "formation");
    expect(r.stack).toEqual(["main", "hub", "team", "formation"]);
    r = back(r);
    expect(current(r)).toBe("team");
    r = back(r);
    r = back(r);
    expect(current(r)).toBe("main");
    expect(back(r)).toBe(r);
  });

  it("unwinds to an existing screen instead of looping", () => {
    let r = setHasGame(createRouter(), true);
    r = go(r, "hub");
    r = go(r, "team");
    r = go(r, "scout");
    r = go(r, "hub");
    expect(r.stack).toEqual(["main", "hub"]);
  });

  it("never returns into a match or results screen", () => {
    let r = setHasGame(createRouter(), true);
    r = go(r, "hub");
    r = go(r, "match");
    r = replace(r, "results");
    expect(current(r)).toBe("results");
    r = go(r, "prizes");
    expect(r.stack).toEqual(["main", "hub", "prizes"]);
    r = back(r);
    expect(current(r)).toBe("hub");
  });

  it("falls back to main when the game is cleared on a game screen", () => {
    let r = setHasGame(createRouter(), true);
    r = go(r, "standings");
    r = setHasGame(r, false);
    expect(current(r)).toBe("main");
  });

  it("going home resets history", () => {
    let r = setHasGame(createRouter(), true);
    r = go(r, "hub");
    r = go(r, "settings");
    r = go(r, "main");
    expect(r.stack).toEqual(["main"]);
  });
});
