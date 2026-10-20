"""Sanity check for the pitch model: play key 60 on every program of a bank and measure the fundamental.
If unity key / fine tune / base rate are right, tonal instruments should all land near 261.6 Hz."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402


def f0(x, rate=r.RATE):
    x = x[: int(0.4 * rate)]
    x = x - x.mean()
    if np.abs(x).max() < 1e-4:
        return None
    n = len(x)
    ac = np.fft.irfft(np.abs(np.fft.rfft(x, 2 * n)) ** 2)[:n]
    lo, hi = int(rate / 2000), int(rate / 60)
    k = lo + int(np.argmax(ac[lo:hi]))
    return rate / k, float(ac[k] / ac[0])


