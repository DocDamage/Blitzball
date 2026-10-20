/**
 * router.ts - Pure screen state machine for the menu shell.
 *
 * No DOM here: the shell (app.ts) renders whatever `current(router)` says.
 * Screens that need a league in memory are listed in NEEDS_GAME; navigating
 * to one without a game redirects to the main menu, so screen code can
 * assume `app.state` exists. The history is a stack so Escape always has a
 * well-defined "back"; the match screen cannot be returned to with back
 * (a finished match leads to results, never back into the pool).
 */

export type ScreenId =
  | "main"
  | "new-game"
  | "load"
  | "settings"
  | "demo"
  | "team"
  | "formation"
  | "scout"
  | "hub"
  | "standings"
  | "results"
  | "prizes"
  | "match";

export interface RouterState {
  stack: ScreenId[];
  hasGame: boolean;
}

export const NEEDS_GAME: ReadonlySet<ScreenId> = new Set([
  "team",
  "formation",
  "scout",
  "hub",
  "standings",
  "results",
  "prizes",
  "match",
]);

/** Screens that are never kept in history (returning to them makes no sense). */
const TRANSIENT: ReadonlySet<ScreenId> = new Set(["match", "results", "prizes"]);

export function createRouter(hasGame = false): RouterState {
  return { stack: ["main"], hasGame };
}

export function current(r: RouterState): ScreenId {
  return r.stack[r.stack.length - 1] ?? "main";
}

export function canGo(r: RouterState, to: ScreenId): boolean {
  return r.hasGame || !NEEDS_GAME.has(to);
}

/** Push a screen. Returns a new state (never mutates). */
export function go(r: RouterState, to: ScreenId): RouterState {
  if (!canGo(r, to)) return { ...r, stack: ["main"] };
  const stack = r.stack.filter((s) => !TRANSIENT.has(s));
  // Going "home" resets history instead of piling up main menus.
  if (to === "main") return { ...r, stack: ["main"] };
  // Revisiting a screen already in the stack unwinds to it (no loops).
  const idx = stack.lastIndexOf(to);
  if (idx >= 0) return { ...r, stack: stack.slice(0, idx + 1) };
  return { ...r, stack: [...stack, to] };
}

/** Replace the current screen (used for match -> results). */
export function replace(r: RouterState, to: ScreenId): RouterState {
  if (!canGo(r, to)) return { ...r, stack: ["main"] };
  const stack = r.stack.slice(0, -1).filter((s) => !TRANSIENT.has(s));
  return { ...r, stack: [...stack, to] };
}

export function back(r: RouterState): RouterState {
  if (r.stack.length <= 1) return r;
  const stack = r.stack.slice(0, -1);
  while (stack.length > 1 && TRANSIENT.has(stack[stack.length - 1])) stack.pop();
  return { ...r, stack };
}

export function setHasGame(r: RouterState, hasGame: boolean): RouterState {
  const next = { ...r, hasGame };
  if (!hasGame && NEEDS_GAME.has(current(next))) return { ...next, stack: ["main"] };
  return next;
}

export const SCREEN_TITLES: Record<ScreenId, string> = {
  main: "Blitzball",
  "new-game": "New game",
  load: "Load game",
  settings: "Settings",
  demo: "Stadium demo",
  team: "Team management",
  formation: "Formation",
  scout: "Scout",
  hub: "Competitions",
  standings: "Standings",
  results: "Match results",
  prizes: "Prizes",
  match: "Match",
};
