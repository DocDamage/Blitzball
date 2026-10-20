"""Cut the colour party portraits out of a PCSX2 VRAM capture (tools/extract/pcsx2_watch.py) taken on a screen that shows
them (Sphere Grid / status). The 8 portraits are the index sheet fid 00422 (512x256, 91x96 each) uploaded as PSMT8 at
bp 14848 (bw 8), with one shared 256-colour CLUT at CBP 11984 (found by matching the Tidus portrait against the screenshot).
usage: party_portraits.py <capture dir>   -> game/public/ffx/portraits/<name>.png
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gsmem import GSMem, addr32  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "game", "public", "ffx", "portraits")
NAMES = ["tidus", "yuna", "auron", "kimahri", "wakka", "lulu", "rikku", "extra"]
SHEET_BP, SHEET_BW, CLUT_CBP = 14848, 8, 11984
W, H = 91, 96


def main():
    cap = sys.argv[1]
    g = GSMem()
    g.mem[:] = np.fromfile(os.path.join(cap, "vram.bin"), dtype=np.uint8)
    idx = g.read8(SHEET_BP, SHEET_BW, 512, 256)
    a = addr32(0, 1, 16, 16)
    px = np.stack([g.mem[(a + CLUT_CBP * 256 + c) % 4194304] for c in range(4)], axis=-1).reshape(256, 4)
    order = np.array([(i & ~0x18) | ((i & 0x08) << 1) | ((i & 0x10) >> 1) for i in range(256)])
    pal = px[order][:, :3].astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    for k, name in enumerate(NAMES):
        tile = idx[(k // 4) * H : (k // 4) * H + H, (k % 4) * W : (k % 4) * W + W]
        Image.fromarray(pal[tile], "RGB").save(os.path.join(OUT, f"{name}.png"))
        print(name)


if __name__ == "__main__":
    main()
