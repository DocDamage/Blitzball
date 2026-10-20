/**
 * focus.ts - Keyboard and gamepad navigation for the menus.
 *
 * Arrow keys (and the d-pad / left stick) move focus spatially between the
 * focusable elements of the active screen; Enter / A activates, Escape / B
 * goes back. Text inputs and selects keep their native arrow behaviour.
 * The shell calls `attach` once; screens only need focusable elements.
 */

export interface FocusHost {
  /** Root of the currently visible screen. */
  root(): HTMLElement | null;
  back(): void;
  /** True while a match (or the demo) owns the input. */
  inputLocked(): boolean;
}

const FOCUSABLE = 'button:not([disabled]), [tabindex="0"], input:not([disabled]), select:not([disabled])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest("[hidden], .hidden")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

type Dir = "up" | "down" | "left" | "right";

/** Pick the best element in direction `dir` from `from`. */
export function spatialNext(from: HTMLElement, candidates: HTMLElement[], dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = (a.left + a.right) / 2;
  const ay = (a.top + a.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const el of candidates) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    let primary: number;
    let secondary: number;
    switch (dir) {
      case "up":
        primary = ay - by;
        secondary = Math.abs(bx - ax);
        break;
      case "down":
        primary = by - ay;
        secondary = Math.abs(bx - ax);
        break;
      case "left":
        primary = ax - bx;
        secondary = Math.abs(by - ay);
        break;
      default:
        primary = bx - ax;
        secondary = Math.abs(by - ay);
    }
    // Must be strictly in that direction (allow slight overlap for rows of equal height).
    if (primary < 4) continue;
    // Prefer elements that overlap on the cross axis; otherwise weight the offset heavily.
    const overlap =
      dir === "up" || dir === "down"
        ? Math.min(a.right, b.right) - Math.max(a.left, b.left)
        : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const score = primary + (overlap > 0 ? secondary * 0.3 : secondary * 2.5 + 400);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "range"].includes(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function attach(host: FocusHost): () => void {
  function move(dir: Dir): void {
    const root = host.root();
    if (!root) return;
    const list = focusables(root);
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const inRoot = active && root.contains(active) && list.includes(active);
    if (!inRoot) {
      (root.querySelector<HTMLElement>("[data-autofocus]") ?? list[0]).focus();
      return;
    }
    const next = spatialNext(active, list, dir);
    if (next) next.focus();
    else if (dir === "down" || dir === "up") {
      // Fall back to DOM order so every element is reachable.
      const i = list.indexOf(active);
      const j = dir === "down" ? i + 1 : i - 1;
      if (j >= 0 && j < list.length) list[j].focus();
    }
  }

  function activate(): void {
    const active = document.activeElement as HTMLElement | null;
    const root = host.root();
    if (!active || !root?.contains(active)) {
      move("down");
      return;
    }
    if (
      active instanceof HTMLButtonElement ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLSelectElement
    )
      return; // native Enter handling
    active.click();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (host.inputLocked()) return;
    if (e.defaultPrevented) return;
    const target = e.target as Element | null;
    const textEntry = isTextEntry(target);
    const horizontalInText = textEntry && (e.key === "ArrowLeft" || e.key === "ArrowRight");
    const verticalInSelect = target instanceof HTMLSelectElement && (e.key === "ArrowUp" || e.key === "ArrowDown");
    const rangeKeys = target instanceof HTMLInputElement && target.type === "range" && e.key.startsWith("Arrow");
    if (horizontalInText || verticalInSelect || rangeKeys) return;
    switch (e.key) {
      case "ArrowUp":
        move("up");
        break;
      case "ArrowDown":
        move("down");
        break;
      case "ArrowLeft":
        move("left");
        break;
      case "ArrowRight":
        move("right");
        break;
      case "Enter":
        if (!textEntry) activate();
        return;
      case "Escape":
        host.back();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  // Gamepad: poll at animation rate; edge-trigger with a repeat delay.
  let raf = 0;
  const held = new Map<string, number>();
  const REPEAT_MS = 160;
  function press(name: string, down: boolean, now: number, fn: () => void): void {
    if (!down) {
      held.delete(name);
      return;
    }
    const last = held.get(name);
    if (last === undefined || now - last > REPEAT_MS) {
      held.set(name, last === undefined ? now + 200 : now);
      fn();
    }
  }
  function poll(): void {
    raf = requestAnimationFrame(poll);
    if (host.inputLocked()) return;
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    const now = performance.now();
    for (const pad of pads) {
      if (!pad) continue;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      press("up", b(12) || ay < -0.6, now, () => move("up"));
      press("down", b(13) || ay > 0.6, now, () => move("down"));
      press("left", b(14) || ax < -0.6, now, () => move("left"));
      press("right", b(15) || ax > 0.6, now, () => move("right"));
      press("a", b(0), now, () => {
        const active = document.activeElement as HTMLElement | null;
        const root = host.root();
        if (active && root?.contains(active)) active.click();
        else move("down");
      });
      press("b", b(1), now, () => host.back());
    }
  }
  raf = requestAnimationFrame(poll);

  return () => {
    window.removeEventListener("keydown", onKey);
    cancelAnimationFrame(raf);
  };
}
