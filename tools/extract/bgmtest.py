"""Render music sequence ids to WAV: bgmtest.py outdir id..."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402
import sndseq as sq  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
b = open(os.path.join(r.FILES, "00472.bin"), "rb").read()
seqs = {s["id"]: s for s in sq.bgm_sequences(b)}
for i in map(int, sys.argv[2:]):
    a, info = r.render_bgm(b, seqs[i])
    pk = float(np.abs(a).max()) if len(a) else 0
    print(i, info, "peak %.3f" % pk, flush=True)
    r.write_wav(os.path.join(out, "bgm_%03d.wav" % i), r.to_int16(a, min(1.0, 0.9 / pk) if pk > 0 else 1))
