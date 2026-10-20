"""Dump every fid-table entry from the ISO into data/raw/files/<id>.bin, decompressing LZ entries.

Writes data/raw/files/manifest.json with per-entry metadata (lba, sectors, compressed, size, magic).
Streams (VS sectors, FMV/audio interleave) are indexed but not dumped unless --streams is given.
"""
import json, sys
from pathlib import Path
from fid import load_table, magic_of, ISO, SECTOR
from lzs import decompress, declared_size

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/raw/files"

def main(dump_streams=False):
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    with open(ISO, "rb") as f:
        entries = load_table(f)
        for e in entries:
            rec = {"id": e["id"], "lba": e["lba"], "sectors": e["sectors"], "flags": e["flags"]}
            if e["sectors"] == 0:
                rec.update(size=0, magic="empty", compressed=False); manifest.append(rec); continue
            f.seek(e["lba"] * SECTOR)
            head = f.read(16)
            if head[:2] == b"VS" and not dump_streams:
                rec.update(size=e["sectors"] * SECTOR, magic="VS-stream", compressed=False, dumped=False)
                manifest.append(rec); continue
            f.seek(e["lba"] * SECTOR)
            raw = f.read(e["sectors"] * SECTOR)[: declared_size(e)]
            compressed = bool(e["flags"] & 1) and len(raw) >= 5 and raw[0] in (1, 2)
            data = decompress(raw) if compressed else raw
            rec.update(size=len(data), raw_size=len(raw), compressed=compressed, magic=magic_of(data[:16]), head=data[:16].hex(), dumped=True)
            (OUT / f"{e['id']:05d}.bin").write_bytes(data)
            manifest.append(rec)
            if e["id"] % 1000 == 0:
                print(e["id"], flush=True)
    json.dump(manifest, open(OUT / "manifest.json", "w"), indent=0)
    from collections import Counter
    print(Counter(r["magic"] for r in manifest).most_common(20))
    print("total bytes", sum(r.get("size", 0) for r in manifest if r.get("dumped")))

if __name__ == "__main__":
    main("--streams" in sys.argv)
