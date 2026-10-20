"""List field maps (MAP1) that contain a full sphere mesh group, e.g. the Blitzball water sphere.

Usage: python find_spheres.py <dir of MAP1 files> > spheres.txt
"""

import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import mapgeom as mg  # noqa: E402

for f in sorted(pathlib.Path(sys.argv[1]).iterdir()):
    try:
        res = mg.decode(f)
    except Exception as e:  # noqa: BLE001 - keep scanning past odd files
        print(f.name, "ERR", e, flush=True)
        continue
    if not res:
        continue
    _, _, groups = res
    found, allp = [], []
    for parts in groups.values():
        p = np.concatenate([x[0] for x in parts]).astype(np.float64)
        allp.append(p)
        if len(p) < 60:
            continue
        c = (p.max(0) + p.min(0)) / 2
        r = np.linalg.norm(p - c, axis=1)
        radius = r.mean()
        ext = p.max(0) - p.min(0)
        if radius > 1 and r.std() / radius < 0.03 and ext[1] > 1.6 * radius:
            found.append((round(float(radius), 1), len(p) // 3))
    if found:
        a = np.concatenate(allp)
        ext = a.max(0) - a.min(0)
        print(f.name, "map", " ".join(f"{e:.0f}" for e in ext), "spheres", sorted(found, reverse=True)[:5], flush=True)
