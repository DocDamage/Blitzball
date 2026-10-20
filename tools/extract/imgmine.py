"""Mine dumped files for continuous-tone images stored in GS block layouts.

For every 256-byte block the data is read as a PSMT8 block (16x16, COLUMN8 order), a PSMCT32 block (8x8, red channel)
and a linear 16x16 block; a block is 'smooth' when neighbouring pixels differ little but the block is not constant.
Long runs of smooth blocks mark image data. usage: imgmine.py [min_run] -> prints hits sorted by run length.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from gsmem import COLUMN32, COLUMN8  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FILES = os.path.join(ROOT, "data", "raw", "files")


def smooth8(blocks):  # (N,256) uint8 -> score per block for each layout
    out = {}
    t8 = blocks[:, COLUMN8.ravel()].reshape(-1, 16, 16).astype(np.int16)
    lin = blocks.reshape(-1, 16, 16).astype(np.int16)
    t32 = blocks.reshape(-1, 64, 4)[:, COLUMN32.ravel(), 0].reshape(-1, 8, 8).astype(np.int16)
    for name, im in (("t8", t8), ("lin", lin), ("ct32", t32)):
        d = np.abs(np.diff(im, axis=2)).mean(axis=(1, 2)) + np.abs(np.diff(im, axis=1)).mean(axis=(1, 2))
        rng = im.reshape(len(im), -1).max(axis=1) - im.reshape(len(im), -1).min(axis=1)
        out[name] = (d, rng)
    return out


def runs(mask, min_run):
    idx = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return [(int(a), int(b - a)) for a, b in zip(idx[::2], idx[1::2]) if b - a >= min_run]


def main():
    min_run = int(sys.argv[1]) if len(sys.argv) > 1 else 64
    hits = []
    for f in sorted(os.listdir(FILES)):
        if not f.endswith(".bin"):
            continue
        p = os.path.join(FILES, f)
        sz = os.path.getsize(p)
        if sz < 256 * min_run or sz > 250_000_000:
            continue
        b = np.fromfile(p, dtype=np.uint8)
        n = len(b) // 256
        blocks = b[: n * 256].reshape(n, 256)
        for name, (d, rng) in smooth8(blocks).items():
            mask = (d < 22) & (rng > 40) & (rng < 250)
            for start, ln in runs(mask, min_run):
                hits.append((ln, f, name, start * 256))
    hits.sort(reverse=True)
    for h in hits[:200]:
        print(h)
    print(len(hits))


if __name__ == "__main__":
    main()
