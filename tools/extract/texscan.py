"""Find texture containers embedded anywhere inside dumped files and convert them.
Writes data/art/tex_embedded/<fid>_<offset>_<n>.png and manifest.json."""
import json, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from textures import parse, to_images
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/art/tex_embedded"; OUT.mkdir(parents=True, exist_ok=True)

def candidates(b):
    i = 0; found = []
    while True:
        i = b.find(b"\x01\x00\x00\x00", i)
        if i < 0 or i + 32 > len(b): break
        if i % 16 == 0:
            count = struct.unpack_from("<I", b, i + 4)[0]
            if 1 <= count <= 64 and i + 0x10 + count * 16 <= len(b):
                ok = True
                for k in range(count):
                    w, h, bpp, p0, p1, p2, co, po = struct.unpack_from("<HHBBBBII", b, i + 0x10 + k * 16)
                    if not (8 <= w <= 1024 and 8 <= h <= 1024 and bpp in (4, 8) and co < len(b) - i and po < len(b) - i and po > co):
                        ok = False; break
                if ok: found.append(i)
        i += 4
    return found

if __name__ == "__main__":
    m = json.load(open(ROOT / "data/raw/files/manifest.json"))
    manifest = []; nfiles = 0
    for r in m:
        if not r.get("dumped") or r["size"] < 64 or r["magic"] == "VS-stream": continue
        fid = f"{r['id']:05d}"
        b = (ROOT / f"data/raw/files/{fid}.bin").read_bytes()
        cs = candidates(b)
        if not cs: continue
        nfiles += 1
        for off in cs:
            try:
                imgs = to_images(b[off:])
            except Exception as e:
                continue
            for i, img in enumerate(imgs):
                name = f"{fid}_{off:06x}_{i}.png"; img.save(OUT / name)
                manifest.append({"fid": r["id"], "offset": off, "index": i, "file": name, "size": img.size})
        if nfiles % 100 == 0: print(nfiles, len(manifest), flush=True)
    json.dump(manifest, open(OUT / "manifest.json", "w"), indent=0)
    print("files with textures", nfiles, "textures", len(manifest))
