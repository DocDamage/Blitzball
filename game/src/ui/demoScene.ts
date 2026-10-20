/**
 * demoScene.ts - The original scripted stadium demo, now a function.
 *
 * Drives the 3D presentation layer with a fake snapshot so the scene can be
 * judged without the simulation. `startDemo(container)` returns a stop
 * function that removes listeners and disposes the renderer.
 *
 * Keys: 1 broadcast, 2 tactical, 3 orbit, G goal flash,
 *       J/S/V/N technique effects at the ball, Space pause.
 */
import { createRenderer } from "../render";
import type { PlayerAction, PlayerState, PoolBounds, RenderSnapshot, Vec3 } from "../render/renderState";

const POOL: PoolBounds = { minX: -30, maxX: 30, minY: -20, maxY: 20, minZ: 0, maxZ: 30 };
const CYCLE = 12;
const MAX_SPEED = 9;

interface Keyframe {
  t: number;
  p: Vec3;
}
interface ActionWindow {
  start: number;
  end: number;
  action: PlayerAction;
}
interface Actor {
  id: string;
  team: 0 | 1;
  isKeeper?: boolean;
  /** Keyframed path over one cycle (t in [0, CYCLE)); wraps smoothly. */
  path?: Keyframe[];
  /** Roaming motion when no path is given. */
  home?: Vec3;
  roam?: { ax: number; ay: number; az: number; w: number; phi: number };
  actions?: ActionWindow[];
  statuses?: string[];
  hpBase: number;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function samplePath(path: Keyframe[], t: number, out: Vec3): void {
  const tt = ((t % CYCLE) + CYCLE) % CYCLE;
  let a = path[path.length - 1];
  let b = path[0];
  let ta = a.t - CYCLE;
  let tb = b.t;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (k.t <= tt) {
      a = k;
      ta = k.t;
      b = path[(i + 1) % path.length];
      tb = i + 1 < path.length ? b.t : b.t + CYCLE;
    }
  }
  const u = tb === ta ? 0 : smooth((tt - ta) / (tb - ta));
  out.x = lerp(a.p.x, b.p.x, u);
  out.y = lerp(a.p.y, b.p.y, u);
  out.z = lerp(a.p.z, b.p.z, u);
}

function actorPosition(actor: Actor, t: number, out: Vec3): void {
  if (actor.path) {
    samplePath(actor.path, t, out);
    return;
  }
  const h = actor.home ?? v(0, 0, 15);
  const r = actor.roam ?? { ax: 4, ay: 4, az: 2, w: 0.5, phi: 0 };
  out.x = h.x + Math.sin(t * r.w + r.phi) * r.ax;
  out.y = h.y + Math.cos(t * r.w * 0.8 + r.phi) * r.ay;
  out.z = h.z + Math.sin(t * r.w * 0.6 + r.phi * 2) * r.az;
}

// --- scripted cast ----------------------------------------------------------
function makeActors(): Actor[] {
  return [
    {
      id: "a1",
      team: 0,
      hpBase: 0.9,
      path: [
        { t: 0, p: v(-10, 5, 15) },
        { t: 3.5, p: v(8, 2, 15) },
        { t: 4.4, p: v(9, 1, 15) },
        { t: 8, p: v(16, 8, 16) },
        { t: 9.5, p: v(14, 9, 18) },
        { t: 11.5, p: v(-10, 5, 15) },
      ],
      actions: [
        { start: 3.5, end: 4.1, action: "pass" },
        { start: 8.7, end: 11, action: "celebrate" },
      ],
    },
    {
      id: "a2",
      team: 0,
      hpBase: 0.75,
      path: [
        { t: 0, p: v(2, -12, 14) },
        { t: 3.8, p: v(16, -8, 16) },
        { t: 4.4, p: v(16, -8, 16) },
        { t: 7.4, p: v(22, -3, 15) },
        { t: 8.2, p: v(22, -2, 15) },
        { t: 9.4, p: v(20, -4, 17) },
        { t: 11.6, p: v(2, -12, 14) },
      ],
      actions: [
        { start: 3.9, end: 4.5, action: "catch" },
        { start: 4.5, end: 7.4, action: "sprint" },
        { start: 7.4, end: 8.2, action: "shoot" },
        { start: 8.7, end: 11, action: "celebrate" },
      ],
      statuses: [],
    },
    {
      id: "a3",
      team: 0,
      hpBase: 0.5,
      home: v(-5, 10, 12),
      roam: { ax: 7, ay: 4, az: 3, w: 0.55, phi: 1.2 },
      statuses: ["poison"],
      actions: [{ start: 8.7, end: 11, action: "celebrate" }],
    },
    {
      id: "a4",
      team: 0,
      hpBase: 0.95,
      home: v(-14, -6, 20),
      roam: { ax: 6, ay: 6, az: 2, w: 0.4, phi: 2.5 },
      actions: [{ start: 8.7, end: 11, action: "celebrate" }],
    },
    {
      id: "a5",
      team: 0,
      hpBase: 0.65,
      home: v(-20, 0, 15),
      roam: { ax: 3, ay: 9, az: 4, w: 0.35, phi: 4 },
      statuses: ["wither"],
    },
    {
      id: "a6",
      team: 0,
      isKeeper: true,
      hpBase: 1,
      home: v(-26, 0, 15),
      roam: { ax: 0.5, ay: 2.5, az: 1.5, w: 0.7, phi: 0 },
      actions: [{ start: 1.0, end: 1.6, action: "block" }],
    },
    {
      id: "b1",
      team: 1,
      hpBase: 0.8,
      path: [
        { t: 0, p: v(10, -4, 16) },
        { t: 5.6, p: v(18, -6, 16) },
        { t: 6.2, p: v(21, -5, 15) },
        { t: 6.8, p: v(24, -5, 14) },
        { t: 9, p: v(20, -8, 15) },
        { t: 11.5, p: v(10, -4, 16) },
      ],
      actions: [
        { start: 5.9, end: 6.9, action: "tackle" },
        { start: 8.6, end: 9.4, action: "hit" },
      ],
    },
    {
      id: "b2",
      team: 1,
      hpBase: 0.6,
      home: v(6, 8, 18),
      roam: { ax: 8, ay: 5, az: 3, w: 0.5, phi: 0.7 },
      statuses: ["sleep"],
      actions: [{ start: 2, end: 6, action: "idle" }],
    },
    {
      id: "b3",
      team: 1,
      hpBase: 0.85,
      home: v(0, -2, 10),
      roam: { ax: 9, ay: 7, az: 3, w: 0.45, phi: 3.3 },
      actions: [{ start: 8.6, end: 9.6, action: "hit" }],
    },
    {
      id: "b4",
      team: 1,
      hpBase: 0.4,
      home: v(14, 12, 20),
      roam: { ax: 5, ay: 5, az: 2, w: 0.6, phi: 5.1 },
      statuses: ["poison", "sleep"],
    },
    {
      id: "b5",
      team: 1,
      hpBase: 0.7,
      home: v(20, 10, 12),
      roam: { ax: 4, ay: 6, az: 3, w: 0.38, phi: 1.9 },
    },
    {
      id: "b6",
      team: 1,
      isKeeper: true,
      hpBase: 1,
      path: [
        { t: 0, p: v(27, 0, 15) },
        { t: 7, p: v(27, -1, 15) },
        { t: 8, p: v(27, -2.5, 16) },
        { t: 9, p: v(27, 1, 15) },
        { t: 11, p: v(27, 0, 15) },
      ],
      actions: [{ start: 7.6, end: 8.8, action: "block" }],
    },
  ];
}

interface ActorRuntime {
  pos: Vec3;
  prev: Vec3;
  facing: number;
}

/** Start the demo inside `container`; returns a stop function. */
export function startDemo(container: HTMLElement): () => void {
  const actors = makeActors();
  const runtime = new Map<string, ActorRuntime>();
  for (const a of actors) {
    const p = v(0, 0, 0);
    actorPosition(a, 0, p);
    runtime.set(a.id, { pos: { ...p }, prev: { ...p }, facing: a.team === 0 ? 0 : Math.PI });
  }
  const tmp = v(0, 0, 0);

  function ballAt(t: number, out: Vec3): string | null {
    // Phases: carried by a1 (0..3.6) -> flight to a2 (3.6..4.2) -> carried by a2 (4.2..7.9)
    // -> shot into goal (7.9..8.6) -> loose in net (8.6..11) -> carried back by a1 (11..12)
    const tt = ((t % CYCLE) + CYCLE) % CYCLE;
    if (tt < 3.6 || tt >= 11) {
      actorPosition(actors[0], tt, tmp);
      out.x = tmp.x + Math.cos(runtime.get("a1")?.facing ?? 0) * 1.2;
      out.y = tmp.y + Math.sin(runtime.get("a1")?.facing ?? 0) * 1.2;
      out.z = tmp.z + 0.3;
      return "a1";
    }
    if (tt < 4.2) {
      const from = v(0, 0, 0);
      const to = v(0, 0, 0);
      actorPosition(actors[0], 3.6, from);
      actorPosition(actors[1], 4.2, to);
      const u = (tt - 3.6) / 0.6;
      out.x = lerp(from.x, to.x, u);
      out.y = lerp(from.y, to.y, u);
      out.z = lerp(from.z, to.z, u) + Math.sin(u * Math.PI) * 3;
      return null;
    }
    if (tt < 7.9) {
      actorPosition(actors[1], tt, tmp);
      out.x = tmp.x + Math.cos(runtime.get("a2")?.facing ?? 0) * 1.2;
      out.y = tmp.y + Math.sin(runtime.get("a2")?.facing ?? 0) * 1.2;
      out.z = tmp.z + 0.3;
      return "a2";
    }
    if (tt < 8.6) {
      const from = v(0, 0, 0);
      actorPosition(actors[1], 7.9, from);
      const u = (tt - 7.9) / 0.7;
      out.x = lerp(from.x + 1, 30.5, u);
      out.y = lerp(from.y, 2.5, u);
      out.z = lerp(from.z, 16.5, u);
      return null;
    }
    out.x = 31;
    out.y = 2.5;
    out.z = 16.5 - Math.min(1, (tt - 8.6) * 2) * 2;
    return null;
  }

  // --- renderer & loop --------------------------------------------------------
  const view = createRenderer(container, POOL);

  const hud = document.createElement("div");
  hud.className = "demo-hud";
  container.appendChild(hud);

  let score: [number, number] = [0, 0];
  let lastGoalCycle = -1;
  let paused = false;
  let simTime = 0;
  let last = performance.now();
  const ballPos = v(0, 0, 0);
  const scratch = v(0, 0, 0);

  const snapshot: RenderSnapshot = {
    pool: POOL,
    ball: { position: ballPos, carrierId: null },
    players: [],
    score,
    clock: 0,
    half: 1,
    possession: 0,
    selectedPlayerId: "a2",
  };

  function buildPlayers(t: number, dt: number): PlayerState[] {
    const out: PlayerState[] = [];
    for (const a of actors) {
      const rt = runtime.get(a.id);
      if (!rt) continue;
      rt.prev.x = rt.pos.x;
      rt.prev.y = rt.pos.y;
      rt.prev.z = rt.pos.z;
      actorPosition(a, t, scratch);
      rt.pos.x = scratch.x;
      rt.pos.y = scratch.y;
      rt.pos.z = scratch.z;
      const vx = (rt.pos.x - rt.prev.x) / Math.max(dt, 1e-3);
      const vy = (rt.pos.y - rt.prev.y) / Math.max(dt, 1e-3);
      const vz = (rt.pos.z - rt.prev.z) / Math.max(dt, 1e-3);
      const sp = Math.hypot(vx, vy, vz);
      if (sp > 0.3) rt.facing = Math.atan2(vy, vx);
      const speed = Math.min(1, sp / MAX_SPEED);
      const tt = ((t % CYCLE) + CYCLE) % CYCLE;
      let action: PlayerAction = speed > 0.55 ? "sprint" : speed > 0.06 ? "swim" : "idle";
      for (const w of a.actions ?? []) {
        if (tt >= w.start && tt < w.end) action = w.action;
      }
      const hp = Math.min(1, Math.max(0.05, a.hpBase + Math.sin(t * 0.3 + a.id.charCodeAt(1)) * 0.15));
      out.push({
        id: a.id,
        team: a.team,
        position: { x: rt.pos.x, y: rt.pos.y, z: rt.pos.z },
        facing: rt.facing,
        speed,
        action,
        hp,
        statuses: a.statuses ?? [],
        isKeeper: a.isKeeper,
      });
    }
    return out;
  }

  let stopped = false;
  let raf = 0;

  function frame(now: number): void {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) simTime += dt;

    snapshot.players = buildPlayers(simTime, paused ? 1 / 60 : dt);
    snapshot.ball.carrierId = ballAt(simTime, ballPos);
    snapshot.possession = snapshot.ball.carrierId ? 0 : null;
    snapshot.clock = simTime;
    snapshot.half = simTime < 150 ? 1 : 2;

    const cycle = Math.floor(simTime / CYCLE);
    const tt = simTime - cycle * CYCLE;
    if (tt >= 8.6 && lastGoalCycle !== cycle) {
      lastGoalCycle = cycle;
      score = [score[0] + 1, score[1]];
      snapshot.score = score;
      view.vfx.spawnGoalFlash(1);
    }
    if (tt >= 7.9 && tt < 7.95 && !paused) {
      view.vfx.spawnTechniqueEffect(cycle % 2 === 0 ? "Jecht Shot" : "Sphere Shot", ballPos);
    }

    view.update(snapshot, dt);

    const m = Math.floor(simTime / 60);
    const s = Math.floor(simTime % 60);
    hud.textContent =
      `BLITZBALL demo   ${score[0]} - ${score[1]}   ${m}:${s.toString().padStart(2, "0")}   half ${snapshot.half}\n` +
      `camera: ${view.getCamera()}  [1] broadcast [2] tactical [3] orbit\n` +
      `[G] goal flash  [J] Jecht  [S] Sphere  [V] Venom  [N] Nap  [Space] pause${paused ? " (paused)" : ""}\n` +
      "[Esc] back to menu";

    raf = requestAnimationFrame(frame);
  }

  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "1":
        view.setCamera("broadcast");
        break;
      case "2":
        view.setCamera("tactical");
        break;
      case "3":
        view.setCamera("orbit");
        break;
      case "g":
      case "G":
        view.vfx.spawnGoalFlash(Math.random() < 0.5 ? -1 : 1);
        break;
      case "j":
      case "J":
        view.vfx.spawnTechniqueEffect("Jecht Shot", ballPos);
        break;
      case "s":
      case "S":
        view.vfx.spawnTechniqueEffect("Sphere Shot", ballPos);
        break;
      case "v":
      case "V":
        view.vfx.spawnTechniqueEffect("Venom Pass", ballPos);
        break;
      case "n":
      case "N":
        view.vfx.spawnTechniqueEffect("Nap Shot", ballPos);
        break;
      case " ":
        paused = !paused;
        e.preventDefault();
        break;
    }
  };
  window.addEventListener("keydown", onKey);
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    view.dispose();
    hud.remove();
  };
}
