"""FFX PS2 hidden file table (the 'fid' table).

Evidence (see tools/docs/formats.md):
  * SLUS_203.12 @0x1647c4..0x164838 reads 0x20000 bytes from absolute LBA 0x118 into the
    fid table pointer (0x772158+0x28). Base sector global (0x30ae7c) is zeroed first.
  * SLUS_203.12 @0x162900: file_offset(id) = (fid[id] & 0x3fffff) + base ; sectors.
  * SLUS_203.12 @0x1628c0: flag test against bit 0x400000 (bit 22) of the entry.
  * Entry 0 resolves to LBA 345 == SLUS_203.12 in the ISO9660 tree, so sectors are absolute.
"""
import json, struct, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ISO = ROOT / "Final Fantasy X (USA).iso"
FID_LBA = 0x118
FID_BYTES = 0x20000
MDG_LBA = 0x158
SECTOR = 2048
TOTAL_SECTORS = 2201280

def read_sectors(f, lba, nbytes):
    f.seek(lba * SECTOR)
    return f.read(nbytes)

def load_table(f):
    raw = read_sectors(f, FID_LBA, FID_BYTES)
    vals = struct.unpack_from("<%dI" % (len(raw) // 4), raw)
    last = max(i for i, v in enumerate(vals) if v)
    entries = []
    for i in range(last + 1):
        v = vals[i]
        entries.append({"id": i, "lba": v & 0x3FFFFF, "flags": v >> 22, "raw": v})
    for i, e in enumerate(entries):
        nxt = entries[i + 1]["lba"] if i + 1 < len(entries) else TOTAL_SECTORS
        e["sectors"] = max(0, nxt - e["lba"])
    return entries

def magic_of(head: bytes) -> str:
    if head[:4] == b"TIM2": return "TIM2"
    if head[:4] == b"\x7fELF": return "ELF"
    if head[:2] == b"VS": return "VS-stream"
    if head[:4] == b"AKAO": return "AKAO"
    if head[:4] == b"AHX\x00" or head[:3] == b"AHX": return "AHX"
    if head[:4] == b"RIFF": return "RIFF"
    if head[:4] == b"ADSC" or head[:4] == b"SShd": return "ADPCM"
    if head[:4] == b"VAGp": return "VAG"
    if head[:4] == b"BUMP": return "BUMP"
    if head[:4] == b"CHDF": return "CHDF"
    if head[:4] == b"MDLS": return "MDLS"
    if head[:4] == b"\x00\x00\x00\x00": return "zeros"
    return "unknown"

if __name__ == "__main__":
    with open(ISO, "rb") as f:
        entries = load_table(f)
        for e in entries:
            head = read_sectors(f, e["lba"], 32) if e["sectors"] else b""
            e["head"] = head[:16].hex()
            e["magic"] = magic_of(head)
    out = ROOT / "data/raw/fid_index.json"
    json.dump(entries, open(out, "w"), indent=0)
    from collections import Counter
    print("entries", len(entries))
    print("magic:", Counter(e["magic"] for e in entries).most_common())
    print("flags:", Counter(e["flags"] for e in entries).most_common(12))
    print("flag bit22 set:", sum(1 for e in entries if e["flags"] & 1))
    for e in entries[:20]:
        print(e["id"], e["lba"], e["sectors"], hex(e["flags"]), e["magic"], e["head"])
