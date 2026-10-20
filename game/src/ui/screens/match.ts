/**
 * match.ts - Placeholder screen while a live match owns the full-screen
 * container. The runtime handle, control bar and half-time overlay are
 * managed by matchFlow.ts, which navigates here before calling playMatch.
 */

import type { App } from "../app";
import { h } from "../dom";
import type { ScreenView } from "./index";

export function matchScreen(_app: App): ScreenView {
  return { element: h("div", { class: "muted", text: "Match in progress" }) };
}
