"""Record screens from a PCSX2 session you are playing.

Run it, then play: every time you press F1 (save state) in PCSX2 this script copies the state before the next F1 overwrites
it, and extracts from it the screenshot, the raw 4 MiB GS VRAM and a CT32 decode of VRAM. Output: data/vram/captures/<n>_<time>/.
Needs `pip install zipfile-zstd` (PCSX2 states are zstd zips). usage: pcsx2_watch.py [sstates dir]
"""
import os
import sys
import time
import zipfile

import numpy as np
import zipfile_zstd  # noqa: F401  (registers the zstd codec)
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gsmem import addr32  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(r"F:\dev\FFX Project", "data", "vram", "captures")  # main checkout (data/ is gitignored)
VRAM_OFFSET = 425  # GS.bin = 509-byte header (+ trailer) around the 4 MiB VRAM
SS = sys.argv[1] if len(sys.argv) > 1 else r"C:\pcsx2\sstates"


def process(path, n):
    stamp = time.strftime("%H%M%S")
    d = os.path.join(OUT, f"{n:03d}_{stamp}")
    os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        gs = np.frombuffer(z.read("GS.bin"), dtype=np.uint8)
        open(os.path.join(d, "screenshot.png"), "wb").write(z.read("Screenshot.png"))
    vram = gs[VRAM_OFFSET : VRAM_OFFSET + 4194304]
    vram.tofile(os.path.join(d, "vram.bin"))
    a = addr32(0, 16, 1024, 1024)
    px = np.stack([vram[(a + c) % 4194304] for c in range(4)], axis=-1).copy()
    px[..., 3] = 255
    Image.fromarray(px, "RGBA").save(os.path.join(d, "vram_ct32.png"))
    print("captured", d, flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    seen = {}
    n = len([x for x in os.listdir(OUT)])
    print("watching", SS, flush=True)
    while True:
        for f in os.listdir(SS) if os.path.isdir(SS) else []:
            if not f.endswith(".p2s"):
                continue
            p = os.path.join(SS, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            key = (st.st_mtime_ns, st.st_size)
            if seen.get(p) == key:
                continue
            time.sleep(2)  # let PCSX2 finish writing
            st2 = os.stat(p)
            if (st2.st_mtime_ns, st2.st_size) != key:
                continue
            try:
                n += 1
                process(p, n)
                seen[p] = key
            except Exception as e:  # half-written file: retry on next pass
                print("retry", f, e, flush=True)
                n -= 1
        time.sleep(1)


if __name__ == "__main__":
    main()
