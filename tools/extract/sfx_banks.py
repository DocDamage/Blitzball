"""Walk the FFX sound-bank archive (fid 00470: 'WD' banks, 0x800-aligned) and decode every sample.

Bank layout (verified on bank 0 and 1): 'WD', u16 bank id, u32 bank size, u32 count, u32 count, ..., a u32 offset list
at +0x20 pointing at `count` 32-byte entries; sample data starts after the last entry. Entry: u32 pad, u32 sample
offset, u32 ?, u32 adsr, u32 ?, u8 root key / vol / pan / ... SPU-ADPCM data ends at the first block with the end flag.
"""
import ctypes
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "data", "raw", "files", "00470.bin")
OUT = os.path.join(ROOT, "data", "raw", "audio")

_dll = ctypes.CDLL(os.path.join(HERE, "spu_dec.dll"))
_dll.spu_decode.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
_dll.spu_decode.restype = ctypes.c_int


def decode(buf: bytes, off: int, max_blocks: int):
    out = np.zeros(max_blocks * 28, dtype=np.int16)
    loop = ctypes.c_int(-1)
    n = _dll.spu_decode(buf[off:], max_blocks, out.ctypes.data, ctypes.byref(loop))
    return out[: n * 28], n, loop.value


def banks(b: bytes):
    pos = 0
    while pos + 32 <= len(b):
        if b[pos : pos + 2] == b"WD":
            bid, size, cnt, cnt2 = struct.unpack_from("<HIII", b, pos + 2)
            if cnt == cnt2 and 0 < cnt < 400 and 0 < size < 20_000_000 and b[pos + 0x14 : pos + 0x18] == b"\0\0\0\0":
                yield pos, bid, size, cnt
        pos += 0x800


def bank_samples(b: bytes, pos: int, bid: int, size: int, cnt: int):
    bank = b[pos : pos + size]
    if 0x20 + 4 * cnt > len(bank):
        return
    offs = struct.unpack_from(f"<{cnt}I", bank, 0x20)
    base = offs[0] + 32 * cnt
    for i, eo in enumerate(offs):
        if eo + 32 > len(bank):
            continue
        e = struct.unpack_from("<8I", bank, eo)
        so = base + e[1]
        if so >= len(bank):
            continue
        pcm, nblk, loop = decode(bank, so, (len(bank) - so) // 16)
        yield i, e, pcm, loop


def features(pcm: np.ndarray, rate=44100):
    x = pcm.astype(np.float32) / 32768
    n = len(x)
    if n < 64:
        return dict(n=n, rms=float(np.sqrt((x**2).mean())) if n else 0, cen=0, flat=0, peakpos=0, dur=n / rate)
    spec = np.abs(np.fft.rfft(x * np.hanning(n))) + 1e-9
    f = np.fft.rfftfreq(n, 1 / rate)
    cen = float((spec * f).sum() / spec.sum())
    flat = float(np.exp(np.log(spec).mean()) / spec.mean())
    env = np.abs(x)
    k = max(1, n // 20)
    envs = np.convolve(env, np.ones(k) / k, mode="valid")
    return dict(
        n=n, dur=n / rate, rms=float(np.sqrt((x**2).mean())), cen=cen, flat=flat,
        peakpos=float(envs.argmax() / max(1, len(envs))), peak=float(env.max()),
    )


def main():
    b = open(SRC, "rb").read()
    os.makedirs(OUT, exist_ok=True)
    cat = []
    store = {}
    for pos, bid, size, cnt in banks(b):
        for i, e, pcm, loop in bank_samples(b, pos, bid, size, cnt):
            fe = features(pcm)
            fe.update(bank=bid, idx=i, loop=loop, entry=list(map(int, e)))
            cat.append(fe)
            store[f"{bid}_{i}"] = pcm
    json.dump(cat, open(os.path.join(OUT, "catalog.json"), "w"))
    np.savez_compressed(os.path.join(OUT, "samples.npz"), **store)
    print(len(cat), "samples;", sum(len(v) for v in store.values()) // 1000, "k pcm samples")


if __name__ == "__main__":
    sys.exit(main())
