"""Scan dumped files: identify ATEL event files (script id) and search for FFX-encoded strings."""
import struct, sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from ffxtext import encode, decode

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "data/raw/files"

def event_script_id(b: bytes):
    """Event .ebp: chunk offsets at +4 (u32 x10), chunk0 = ATEL script whose +0x0C points to the id string."""
    if len(b) < 0x40: return None
    c0 = struct.unpack_from("<I", b, 4)[0]
    if c0 == 0 or c0 >= len(b) - 16 or c0 & 3: return None
    sid = struct.unpack_from("<I", b, c0 + 0x0C)[0]
    p = c0 + sid
    if sid == 0 or p >= len(b) - 4: return None
    m = re.match(rb"[a-z0-9_]{4,12}", b[p:p + 16])
    return m.group().decode() if m else None

def find_strings(needles):
    enc = {n: encode(n) for n in needles}
    hits = {}
    for fp in sorted(FILES.glob("*.bin")):
        b = fp.read_bytes()
        for n, e in enc.items():
            i = b.find(e)
            if i >= 0:
                hits.setdefault(n, []).append((fp.stem, i))
    return hits

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "events"
    if mode == "events":
        for fp in sorted(FILES.glob("*.bin")):
            sid = event_script_id(fp.read_bytes())
            if sid: print(fp.stem, sid)
    else:
        for n, h in find_strings(sys.argv[2:]).items():
            print(n, h[:20], "..." if len(h) > 20 else "")
