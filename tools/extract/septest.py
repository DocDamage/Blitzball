"""Render the Blitzball SEPs (embedded in bltz0000, fid 01601) to WAVs: septest.py outdir"""
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402
import sndseq as sq  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
b = open(os.path.join(r.FILES, "01601.bin"), "rb").read()
text = open(os.path.join(r.ROOT, "data", "raw", "bltz0000_decomp.txt"), encoding="utf8", errors="replace").read()
ids = sorted(set(int(m) for m in re.findall(r"sfx=sfx:(\d+)", text)))
offs = sq.sep_files(b, ids)
for i in ids:
    a, info = r.render_se(b, offs[i], max_seconds=6.0)
    pk = float(np.abs(a).max()) if len(a) else 0
    print(i, info, "dur %.2f peak %.2f" % (len(a) / r.RATE, pk))
    r.write_wav(os.path.join(out, "sep_%d.wav" % i), r.to_int16(a, min(1.0, 0.9 / pk) if pk > 0 else 1))
