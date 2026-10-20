"""Export the original Luca Blitzball stadium (field map, Noesis section 019 file3064 + its texture file 3063) to
game/public/ffx/stadium/ for the renderer, with the placement of its water sphere.

Inside the stadium the map has an outer sphere mesh (radius ~80 map units) and nested spherical shells (radius ~59-67:
the animated water surface layers, drawn with additive effects on the PS2). The renderer lines its play sphere up
with the main water shell and hides every piece inside the outer sphere: it draws the water, goals and markings itself.

Usage: python blitz_stadium.py [map file]
"""

import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import mapgeom  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
MAP = ROOT / "data" / "raw" / "noesis" / "out.txtsect019" / "file3064.raw"
OUT = ROOT / "game" / "public" / "ffx" / "stadium"


def main() -> None:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else MAP
    stats = mapgeom.write_gltf(src, OUT)
    gl = json.loads((OUT / "map.gltf").read_text())
    sphere = None
    for i, prim in enumerate(gl["meshes"][0]["primitives"]):
        acc = gl["accessors"][prim["attributes"]["POSITION"]]
        lo, hi = acc["min"], acc["max"]
        ext = [hi[k] - lo[k] for k in range(3)]
        # the only primitive that is a ball of equal extents in all three axes and not the whole map
        if min(ext) > 50 and max(ext) - min(ext) < 0.02 * max(ext) and max(ext) < 300:
            sphere = {"primitive": i, "center": [(hi[k] + lo[k]) / 2 for k in range(3)], "radius": max(ext) / 2}
    if sphere is None:
        raise SystemExit("water sphere not found")
    blob = (OUT / "map.bin").read_bytes()
    centre = np.array(sphere["center"])
    hide, shells = [], []
    for i, prim in enumerate(gl["meshes"][0]["primitives"]):
        acc = gl["accessors"][prim["attributes"]["POSITION"]]
        view = gl["bufferViews"][acc["bufferView"]]
        pts = np.frombuffer(blob, np.float32, acc["count"] * 3, view["byteOffset"]).reshape(-1, 3)
        d = np.linalg.norm(pts - centre, axis=1)
        if d.max() < sphere["radius"] * 1.05:
            hide.append(i)
            if d.max() - d.min() < 2 and i != sphere["primitive"]:
                shells.append((acc["count"], float(d.mean())))
    # the water surface: the biggest tight shell inside the outer sphere
    sphere["water_radius"] = max(shells)[1] if shells else sphere["radius"]
    sphere["hide"] = hide
    (OUT / "stadium.json").write_text(json.dumps({"path": "map.gltf", "sphere": sphere, **stats}, indent=1))
    print(stats, sphere)


if __name__ == "__main__":
    main()
