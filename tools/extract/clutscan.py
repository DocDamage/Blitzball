"""Scan every dumped file (and the ELF) for 256-entry RGBA CLUT blocks (PS2 alpha 0x00/0x80) and 16-entry CLUTs.
Prints fid, offset, distinct colours. Used in session 2 to hunt the Blitzball menu art."""
import json, sys, numpy as np
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

def scan(b, step=16, min_alpha_frac=0.97, min_distinct=40):
    a = np.frombuffer(b, dtype='uint8'); n = len(a) // 4 * 4
    q = a[:n].reshape(-1, 4)
    alpha_ok = (q[:, 3] == 0x80) | (q[:, 3] == 0x00)
    hits = []
    # sliding window of 256 entries at 16-byte (4-entry) steps
    cs = np.concatenate([[0], np.cumsum(alpha_ok)])
    for e in range(0, len(q) - 256, step // 4):
        if cs[e + 256] - cs[e] >= 256 * min_alpha_frac:
            blk = q[e:e + 256]
            if (blk[:, 3] == 0x80).sum() < 64: continue
            d = len(np.unique(blk.view('<u4')))
            if d >= min_distinct:
                hits.append((e * 4, d))
    # merge runs
    out = []
    for off, d in hits:
        if out and off - out[-1][0] < 1024: continue
        out.append((off, d))
    return out

if __name__ == "__main__":
    m = json.load(open(ROOT / "data/raw/files/manifest.json"))
    res = {}
    ids = [int(x) for x in sys.argv[1:]] or None
    for r in m:
        if not r.get("dumped") or r["size"] < 2048 or r["magic"] in ("VS-stream", "ELF"): continue
        if ids and r["id"] not in ids: continue
        if r["size"] > 20_000_000: continue
        b = (ROOT / f"data/raw/files/{r['id']:05d}.bin").read_bytes()
        h = scan(b)
        if h: res[r["id"]] = h; print(r["id"], r["size"], [(hex(o), d) for o, d in h[:12]], len(h), flush=True)
    json.dump({k: v for k, v in res.items()}, open(ROOT / "data/art/clutscan.json", "w"))
