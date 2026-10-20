import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The original Luca Blitzball stadium, extracted from the disc by tools/extract/blitz_stadium.py into
 * public/ffx/stadium (never committed). The map is scaled and placed so its water sphere coincides with the match's
 * play sphere; the map's own sphere pieces are hidden because the renderer draws the water.
 */

interface StadiumInfo {
  path: string;
  sphere: {
    primitive: number;
    center: [number, number, number];
    radius: number;
    /** Radius of the map's water surface shell: lined up with the play sphere. */
    water_radius: number;
    /** Map pieces inside the sphere (water shells, sphere frame): the renderer draws its own water and goals. */
    hide: number[];
  };
}

export interface OriginalStadium {
  root: THREE.Object3D;
  dispose(): void;
}

/** Resolves to null when the extracted stadium is not present. */
export async function loadOriginalStadium(
  centre: THREE.Vector3,
  radius: number,
  baseUrl = "/ffx/stadium/",
): Promise<OriginalStadium | null> {
  let info: StadiumInfo;
  try {
    const r = await fetch(`${baseUrl}stadium.json`);
    if (!r.ok) return null;
    info = (await r.json()) as StadiumInfo;
  } catch {
    return null;
  }
  const gltf = await new GLTFLoader().loadAsync(`${baseUrl}${info.path}`);
  const map = gltf.scene;
  const s = radius / info.sphere.water_radius;
  // FFX map space is Y-down
  map.rotation.x = Math.PI;
  map.scale.setScalar(s);
  const [cx, cy, cz] = info.sphere.center;
  map.position.set(centre.x - cx * s, centre.y + cy * s, centre.z + cz * s);

  const disposables: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  map.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const hidden = new Set(info.sphere.hide);
  meshes.forEach((mesh, i) => {
    if (hidden.has(i)) {
      mesh.visible = false;
      return;
    }
    // Lighting is baked into the PS2 vertex colours: draw unlit
    const src = mesh.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshBasicMaterial({
      map: src.map,
      vertexColors: true,
      side: THREE.DoubleSide,
      alphaTest: src.map ? 0.5 : 0,
      fog: true,
    });
    src.dispose();
    mesh.material = mat;
    disposables.push(mat, mesh.geometry);
    if (src.map) disposables.push(src.map);
  });
  return {
    root: map,
    dispose() {
      for (const d of disposables) d.dispose();
      map.removeFromParent();
    },
  };
}
