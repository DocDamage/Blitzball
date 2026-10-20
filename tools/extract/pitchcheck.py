"""Sanity check for the pitch model: play key 60 on every program of a bank and measure the fundamental.
If unity key / fine tune / base rate are right, tonal instruments should all land near 261.6 Hz."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402
import sndseq as sq  # noqa: E402


from pitchcheck_lib import f0  # noqa: E402

bid = int(sys.argv[1])
key = int(sys.argv[2]) if len(sys.argv) > 2 else 60
wd = r.bank(bid)
for prog in range(len(wd.instruments)):
    ev = [(0, sq.NOTE_KEYVEL, (key, 100)), (96, sq.OFF_KEY, (key,)), (0, sq.END, ())]
    ev = [(0, ev[0][1], ev[0][2]), (96, ev[1][1], ev[1][2]), (96, sq.END, ())]
    # absolute ticks
    abs_ev = []
    t = 0
    for dt, op, a in ev:
        t += dt
        abs_ev.append((t, op, a))
    # program change first
    abs_ev.insert(0, (0, sq.PROGRAM, (prog,)))
    audio, n = r.render([abs_ev], lambda s: wd, lambda t: t / 96.0, 1.5)
    m = audio.mean(axis=1)
    res = f0(m)
    print(prog, "regions", len(wd.instruments[prog]), res if res is None else "f0=%.1f conf=%.2f" % res)
