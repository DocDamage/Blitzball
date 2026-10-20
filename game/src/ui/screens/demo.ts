/**
 * demo.ts - Hosts the scripted stadium demo in the full-screen container.
 */

import type { App } from "../app";
import { startDemo } from "../demoScene";
import { button, empty, h } from "../dom";
import type { ScreenView } from "./index";

export function demoScreen(app: App): ScreenView {
  empty(app.matchHost);
  let stop: (() => void) | null = null;
  const exit = () => app.go("main");
  try {
    stop = startDemo(app.matchHost);
  } catch (err) {
    console.error("demo failed to start", err);
    app.toast("The 3D demo could not start (WebGL unavailable?)");
    queueMicrotask(exit);
  }
  const bar = h("div", { class: "match-bar" }, button("Exit demo", exit, { class: "small", hint: "Esc" }));
  app.matchHost.append(bar);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      exit();
    }
  };
  window.addEventListener("keydown", onKey);
  bar.querySelector<HTMLElement>("button")?.focus();

  return {
    element: h("div", { text: "Stadium demo running" }),
    dispose: () => {
      window.removeEventListener("keydown", onKey);
      stop?.();
      empty(app.matchHost);
    },
  };
}
