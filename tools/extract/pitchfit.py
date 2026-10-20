"""Fit the pitch model: for tonal regions measure the played f0 at the mapped key and report the error in semitones
against the equal-tempered key (A4=440), next to the region's raw bytes. usage: pitchfit.py bank..."""
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402
import sndseq as sq  # noqa: E402
from pitchcheck_lib import f0  # noqa: E402


def region_raw(wd, prog, ri):
    # recompute the record offset: instruments are contiguous 0x20 records starting at the offset table entries
    offs = struct.unpack_from(f"<{len(wd.instruments)}I", wd.data, 0x20)
    o = offs[prog] + ri * 0x20
    return wd.data[o : o + 0x20]


rows = []
for bid in map(int, sys.argv[1:]):
    wd = r.bank(bid)
    for prog, regs in enumerate(wd.instruments):
        for ri, reg in enumerate(regs):
            key = min(max((reg.key_low + reg.key_high) // 2, 36), 96) if reg.key_high < 127 else 60
            ev = [(0, sq.PROGRAM, (prog,)), (0, sq.NOTE_KEYVEL, (key, 100)), (96, sq.OFF_KEY, (key,)), (96, sq.END, ())]
            audio, n = r.render([ev], lambda s: wd, lambda t: t / 96.0, 1.5)
            m = audio.mean(axis=1)
            res = f0(m)
            if not res or res[1] < 0.97 or key < 48:
                continue
            exp = 440.0 * 2 ** ((key - 69) / 12)
            err = 12 * np.log2(res[0] / exp)
            raw = region_raw(wd, prog, ri)
            rows.append((bid, prog, ri, key, round(float(err), 3), raw[0x10:0x14].hex(), reg.unity, reg.fine, round(res[1],3)))
            print(rows[-1])

import json
json.dump(rows, open(os.path.join(os.path.dirname(__file__), 'pitchfit.json'), 'w'))
