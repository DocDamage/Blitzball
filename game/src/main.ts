/**
 * Entry point: boots the menu shell (src/ui). The scripted stadium demo that
 * used to live here is reachable from the main menu ("Stadium demo") and
 * lives in src/ui/demoScene.ts.
 */
import { App } from "./ui/app";
import "./ui/styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");

const app = new App(root);
app.start();

// Handy for debugging from the console.
declare global {
  interface Window {
    blitzball?: App;
  }
}
window.blitzball = app;
