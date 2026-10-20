/**
 * screens/index.ts - Screen registry. A Screen builds its element from the
 * App and may return a dispose callback for listeners / timers it created.
 */

import type { App } from "../app";
import type { ScreenId } from "../router";
import { demoScreen } from "./demo";
import { formationScreen } from "./formation";
import { hubScreen } from "./hub";
import { loadScreen } from "./load";
import { mainMenuScreen } from "./mainMenu";
import { matchScreen } from "./match";
import { newGameScreen } from "./newGame";
import { prizesScreen } from "./prizes";
import { resultsScreen } from "./results";
import { scoutScreen } from "./scout";
import { settingsScreen } from "./settings";
import { standingsScreen } from "./standings";
import { teamScreen } from "./team";

export interface ScreenView {
  element: HTMLElement;
  dispose?: () => void;
}

export type Screen = (app: App) => ScreenView;

export const SCREENS: Record<ScreenId, Screen> = {
  main: mainMenuScreen,
  "new-game": newGameScreen,
  load: loadScreen,
  settings: settingsScreen,
  demo: demoScreen,
  team: teamScreen,
  formation: formationScreen,
  scout: scoutScreen,
  hub: hubScreen,
  standings: standingsScreen,
  results: resultsScreen,
  prizes: prizesScreen,
  match: matchScreen,
};
