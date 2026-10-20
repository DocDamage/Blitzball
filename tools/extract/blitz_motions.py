"""Split the Blitzball match motion pack (fid 01604) per model and bake the motions into glTF models with Noesis.

01604 is an .ffa container with one directory entry per model (`u32 0, u32 count, u32 0, u32 dir_off`, entries
`{u32 runtime, u32 model_id, u16 rows, u16 motions, u32 rows_off, u32 table_off}`). Noesis only accepts an .ffa whose
directory is the last thing in the file and whose name follows `mdlNNNN_aN.ffa` next to `mdlNNNN.ffm`, so each entry is
carved into its own file (offsets inside are absolute, so the prefix of the pack is kept) and staged beside the model.

Usage:
  python blitz_motions.py probe                     try every motion set on the Blitzball models, print what loads
  python blitz_motions.py bake <type/mdlNNNN> <id>  write data/raw/noesis/anim/<type>_<mdlNNNN>_<id>/model.gltf
"""

import json
import pathlib
import shutil
import struct
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
NOESIS = pathlib.Path.home() / "noesis" / "Noesis64.exe"
PACK = ROOT / "data" / "raw" / "files" / "01604.bin"
MODELS = ROOT / "data" / "raw" / "noesis" / "out.txtmodels"
WORK = ROOT / "data" / "raw" / "noesis" / "anim"
FPS = 20  # Noesis lays the motions end to end at 20 frames per second


def entries() -> list[tuple[int, int, int, int, int]]:
    src = PACK.read_bytes()
    _, count, _, d = struct.unpack_from("<4I", src, 0)
    return [struct.unpack_from("<IIHHII", src, d + 20 * k)[1:] for k in range(count)]


def carve(model_id: int) -> bytes:
    src = PACK.read_bytes()
    _, count, _, d = struct.unpack_from("<4I", src, 0)
    ents = entries()
    k = next(i for i, e in enumerate(ents) if e[0] == model_id)
    _, rows, motions, rows_off, table_off = ents[k]
    if k + 1 < count:
        nxt_table = ents[k + 1][4]
        end = min(struct.unpack_from("<I", src, nxt_table + 8)[0], nxt_table)
    else:
        end = d
    body = bytearray(src[:end])
    dir_off = len(body)
    body += struct.pack("<IIHHII", 0, model_id, rows, motions, rows_off, table_off)
    struct.pack_into("<4I", body, 0, 0, 1, 0, dir_off)
    return bytes(body)


def clips(model_id: int) -> list[dict]:
    """Frame ranges of each motion inside the baked track (table rows {0, kind, data_off, data_off2})."""
    src = PACK.read_bytes()
    ent = next(e for e in entries() if e[0] == model_id)
    _, _, motions, _, table_off = ent
    out, start = [], 0
    for i in range(motions):
        _, kind, off, _ = struct.unpack_from("<4I", src, table_off + 16 * i)
        frames = struct.unpack_from("<H", src, off + 2)[0]
        out.append({"index": i, "kind": kind, "start": start, "frames": frames})
        start += frames
    return out


def bake(model: str, model_id: int, out_dir: pathlib.Path) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    stage = out_dir / "stage"
    stage.mkdir(exist_ok=True)
    t, name = model.split("/")
    shutil.copy(MODELS / t / f"{name}.ffm", stage / f"{name}.ffm")
    (stage / f"{name}_a1.ffa").write_bytes(carve(model_id))
    log = out_dir / "noesis.log"
    subprocess.run(
        [str(NOESIS), "?cmode", str(stage / f"{name}.ffm"), str(out_dir / "model.gltf"),
         "-loadanim", str(stage / f"{name}_a1.ffa"), "-logfile", str(log)],
        timeout=180, check=False,
    )
    text = log.read_text(errors="replace") if log.exists() else ""
    if "mismatch" in text:
        return "mismatch"
    if "Wrote file to" not in text:
        return "FAILED"
    if "channel reduction" not in text:
        return "no-anim"
    (out_dir / "clips.json").write_text(json.dumps({"fps": FPS, "modelId": model_id, "clips": clips(model_id)}, indent=1))
    return "ok"


def main() -> None:
    if sys.argv[1] == "probe":
        sets = [0x6004, 0x600E, 0x6067, 0x6071, 0x60CB, 0x60D5]
        for i in range(104, 135):
            model = f"type2/mdl{i:04d}"
            res = {f"{m:04x}": bake(model, m, WORK / "probe" / f"{i}_{m:04x}") for m in sets}
            print(model, " ".join(f"{k}:{v}" for k, v in res.items()), flush=True)
    elif sys.argv[1] == "bake":
        model, mid = sys.argv[2], int(sys.argv[3], 16)
        t, name = model.split("/")
        print(bake(model, mid, WORK / f"{t}_{name}_{mid:04x}"))


if __name__ == "__main__":
    main()
