/**
 * devMatch.ts - Development entry (dev-match.html): Besaid Aurochs vs Luca
 * Goers with the human on team 0. Query string:
 *   ?mode=arcade|tactical|action   control mode (default arcade)
 *   &watch=1                       AI vs AI
 *   &camera=tactical               start with the top-down camera
 *   &half=60                       game-seconds per half (default 90 here)
 *   &seed=7
 * The resolved result is logged to the console and exposed as window.__matchResult.
 */

import { BESAID_AUROCHS, LUCA_GOERS } from "../sim/sampleTeams";
import { playMatch } from "./matchRuntime";
import type { ControlMode, MatchHandle } from "./types";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

const q = new URLSearchParams(location.search);
const modeParam = q.get("mode");
const mode: ControlMode = modeParam === "tactical" || modeParam === "action" ? modeParam : "arcade";
const watch = q.get("watch") === "1";
const half = Number(q.get("half") ?? "90");
const seed = Number(q.get("seed") ?? "1");

const handle: MatchHandle = playMatch(app, {
  home: BESAID_AUROCHS,
  away: LUCA_GOERS,
  seed: Number.isFinite(seed) ? seed : 1,
  halfSeconds: Number.isFinite(half) && half > 0 ? half : 90,
  overtime: q.get("overtime") === "1",
  difficulty: "normal",
  humanTeam: watch ? null : 0,
  controlMode: mode,
  camera: q.get("camera") === "tactical" ? "tactical" : "broadcast",
  settings: {
    uiScale: Number(q.get("scale") ?? "1") || 1,
    screenShake: q.get("shake") !== "0",
    reducedFlash: q.get("reducedFlash") === "1",
    colorblind: q.get("colorblind") === "1",
  },
});

declare global {
  interface Window {
    __matchHandle?: MatchHandle;
    __matchResult?: unknown;
  }
}
window.__matchHandle = handle;

handle.promise.then((result) => {
  window.__matchResult = result;
  console.log("[devMatch] match finished", result.score, result.abandoned ? "(abandoned)" : "");
});
