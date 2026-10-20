// Dev-only contact sheet for models extracted from the disc into public/ffx/models (see tools/extract/noesis_models.py).
// ?filter=type0 limits the sheet to paths containing the string; ?angle=deg turns the models.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SIZE = 360;
const params = new URLSearchParams(location.search);
const filter = params.get("filter") ?? "";
const angle = (Number(params.get("angle") ?? 0) * Math.PI) / 180;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a3550);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 2, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const loader = new GLTFLoader();
const grid = document.getElementById("grid") as HTMLDivElement;
// ?thumb=px shrinks the grid cells so a whole folder fits on one screen
if (params.get("thumb")) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${params.get("thumb")}px, 1fr))`;

async function main(): Promise<void> {
  // ?filter=a,b,c matches any of the substrings
  const filters = filter.split(",");
  const base = params.get("index") ?? "/ffx/models/";
  const list = (await (await fetch(`${base}index.txt`)).text())
    .split(/\r?\n/)
    .filter((l) => l && filters.some((f) => l.includes(f)));
  for (const path of list) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = path.replace(".glb", "");
    try {
      const gltf = await loader.loadAsync(`${base}${path}`);
      const root = gltf.scene;
      // FFX model space is Y-down
      root.rotation.set(Math.PI, angle, 0);
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5;
      camera.position.set(centre.x, centre.y, centre.z + (radius / Math.tan((15 * Math.PI) / 180)) * 1.05);
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      camera.lookAt(centre);
      renderer.render(scene, camera);
      const img = document.createElement("img");
      img.src = renderer.domElement.toDataURL();
      fig.append(img);
      cap.textContent += ` (${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)})`;
      scene.remove(root);
    } catch (err) {
      cap.textContent += ` FAILED: ${String(err)}`;
    }
    fig.append(cap);
    grid.append(fig);
  }
  document.title += " (done)";
}

void main();
