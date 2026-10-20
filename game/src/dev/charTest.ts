// Dev-only check of the original-model renderer: one row of players, all facing +x (the red arrow), one action each.
// ?action=swim (default: one of each action), ?players=0,1,2 (data ids), ?team=5 (uniform for unknown ids),
// ?t=seconds advances the animation before the still is drawn, ?view=side|top|front.
import * as THREE from "three";
import { OriginalCharacterSystem } from "../render/originalCharacters";
import { PLAYER_ACTIONS, type PlayerAction, type PlayerState } from "../render/renderState";

const q = new URLSearchParams(location.search);
const ids = (q.get("players") ?? "0,1,2,7,25,31,19,37,6,13").split(",").map(Number);
const forced = q.get("action") as PlayerAction | null;
const advance = Number(q.get("t") ?? 0.6);
const view = q.get("view") ?? "side";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14304a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 10, 8);
scene.add(sun);
scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-4, -4, 0), 6, 0xff4040));
scene.add(new THREE.GridHelper(80, 20, 0x335577, 0x223344));

const chars = new OriginalCharacterSystem();
scene.add(chars.group);
const spacing = 7;
const cols = Math.min(5, ids.length);
const rows = Math.ceil(ids.length / cols);
const players: PlayerState[] = ids.map((dataId, i) => ({
  id: `p${i}`,
  team: 0,
  // pool coords: a grid of `cols` columns (x) by rows (y), z = height
  position: { x: ((i % cols) - (cols - 1) / 2) * spacing, y: ((rows - 1) / 2 - Math.floor(i / cols)) * spacing, z: 0 },
  facing: 0,
  speed: 0.6,
  action: forced ?? PLAYER_ACTIONS[i % PLAYER_ACTIONS.length],
  hp: 1,
  statuses: [],
  dataId,
  teamDataId: Number(q.get("team") ?? 5),
}));

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 1000);
const span = Math.max(cols, rows * 1.4) * spacing;
if (view === "top") camera.position.set(0, span * 1.1, 0.01);
else if (view === "front") camera.position.set(span * 1.2, 4, 0);
else camera.position.set(0, 4, span * 1.7);
camera.lookAt(0, 0, 0);

// Labels
for (const [i, p] of players.entries()) {
  const div = document.createElement("div");
  div.textContent = `${ids[i]} ${p.action}`;
  div.style.cssText = `position:absolute;color:#fff;font:12px system-ui;left:0;top:0`;
  document.body.append(div);
  const v = new THREE.Vector3(
    p.position.x,
    view === "top" ? 0 : -5,
    -p.position.y + (view === "top" ? 3.5 : 0),
  ).project(camera);
  div.style.transform = `translate(${((v.x + 1) / 2) * innerWidth - 20}px, ${((1 - v.y) / 2) * innerHeight}px)`;
}

let elapsed = 0;
function frame(): void {
  const dt = 1 / 30;
  chars.update(players, dt, camera, null, null);
  renderer.render(scene, camera);
}
// Let the assets load, then advance to the requested time
const start = performance.now();
const tick = (): void => {
  frame();
  if (performance.now() - start < 2500) requestAnimationFrame(tick);
  else {
    while (elapsed < advance) {
      chars.update(players, 1 / 30, camera, null, null);
      elapsed += 1 / 30;
    }
    renderer.render(scene, camera);
    document.title += " (done)";
  }
};
tick();
