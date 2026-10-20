"""Convert FFX PS2 .ffm models (extracted from the ISO by Noesis) to .gltf, one folder per model.

Usage: python noesis_models.py <type> [<type> ...]   e.g. python noesis_models.py type0 type6
Input:  data/raw/noesis/out.txtmodels/<type>/mdlNNNN.ffm (produced by `Noesis64.exe ?cmode <iso> <out>`)
Output: data/raw/noesis/glb/<type>/mdlNNNN/model.gltf (+ Noesis texture PNGs and a log)
"""

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
NOESIS = pathlib.Path.home() / "noesis" / "Noesis64.exe"
SRC = ROOT / "data" / "raw" / "noesis" / "out.txtmodels"
DST = ROOT / "data" / "raw" / "noesis" / "glb"


def convert(src: pathlib.Path, out_dir: pathlib.Path) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    log = out_dir / "noesis.log"
    subprocess.run(
        [str(NOESIS), "?cmode", str(src), str(out_dir / "model.gltf"), "-logfile", str(log)],
        timeout=120,
        check=False,
    )
    text = log.read_text(errors="replace")
    return "ok" if "Wrote file to" in text else "FAILED"


def main() -> None:
    for t in sys.argv[1:]:
        for src in sorted((SRC / t).glob("*.ffm")):
            print(t, src.stem, convert(src, DST / t / src.stem), flush=True)


if __name__ == "__main__":
    main()
