"""FFX PS2 texture container -> PNG.

Container (files whose first u32 is 1; see tools/docs/formats.md 'Textures'):
  u32 magic=1, u32 count, then `count` descriptors of 16 bytes at +0x10:
    u16 width, u16 height, u8 bpp (8 or 4), u8 pad[3], u32 clut_offset, u32 pixel_offset
  CLUT: 256 (8bpp) or 16 (4bpp) RGBA entries, PS2 alpha (0x80 = opaque). 8bpp CLUTs are stored in the PS2
  CSM1 order (blocks of 8 swapped in pairs: index bits 3 and 4 exchanged).
"""
import struct, sys, json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

def unswizzle_clut(clut):
    out = list(clut)
    for i in range(256):
        j = (i & ~0x18) | ((i & 0x08) << 1) | ((i & 0x10) >> 1)
        out[j] = clut[i]
    return out

def parse(b: bytes):
    magic, count = struct.unpack_from("<II", b, 0)
    if magic != 1 or count == 0 or count > 64: return []
    texs = []
    for i in range(count):
        w, h, bpp, _p0, _p1, _p2, clut_off, pix_off = struct.unpack_from("<HHBBBBII", b, 0x10 + i * 16)
        if w == 0 or h == 0 or bpp not in (4, 8) or pix_off >= len(b): return []
        texs.append((w, h, bpp, clut_off, pix_off))
    return texs

def to_images(b: bytes):
    imgs = []
    for w, h, bpp, clut_off, pix_off in parse(b):
        n = 256 if bpp == 8 else 16
        raw = [tuple(b[clut_off + i * 4: clut_off + i * 4 + 4]) for i in range(n)]
        if bpp == 8: raw = unswizzle_clut(raw)
        pal = [(r, g, bl, min(255, a * 2)) for r, g, bl, a in raw]
        img = Image.new("RGBA", (w, h))
        px = img.load()
        if bpp == 8:
            data = b[pix_off: pix_off + w * h]
            for y in range(h):
                row = y * w
                for x in range(w):
                    px[x, y] = pal[data[row + x]]
        else:
            data = b[pix_off: pix_off + w * h // 2]
            for y in range(h):
                for x in range(w):
                    v = data[(y * w + x) // 2]
                    idx = v & 0xF if x % 2 == 0 else v >> 4
                    px[x, y] = pal[idx]
        imgs.append(img)
    return imgs

if __name__ == "__main__":
    out = ROOT / "data/art/tex"; out.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[1:]
    if not ids:
        m = json.load(open(ROOT / "data/raw/files/manifest.json"))
        ids = [f"{r['id']:05d}" for r in m if r.get("dumped") and r["head"].startswith("01000000")]
    manifest = []
    for fid in ids:
        b = (ROOT / f"data/raw/files/{fid}.bin").read_bytes()
        for i, img in enumerate(to_images(b)):
            p = out / f"{fid}_{i}.png"; img.save(p); manifest.append({"fid": int(fid), "index": i, "file": p.name, "size": img.size})
    json.dump(manifest, open(out / "manifest.json", "w"), indent=0)
    print("wrote", len(manifest), "textures")


# ---- Format B: raw texture with 16-byte header {u32 width, u32 height, u32 a, u32 b}, CLUT, pixels ----
def parse_raw(b: bytes):
    if len(b) < 16: return None
    w, h, a, c = struct.unpack_from("<IIII", b, 0)
    if not (8 <= w <= 1024 and 8 <= h <= 1024 and w & (w - 1) == 0 and h & (h - 1) == 0): return None
    if len(b) == 16 + 1024 + w * h: return (w, h, 8)
    if len(b) == 16 + 64 + w * h // 2: return (w, h, 4)
    return None

def raw_to_image(b: bytes):
    p = parse_raw(b)
    if not p: return None
    w, h, bpp = p
    n = 256 if bpp == 8 else 16
    raw = [tuple(b[16 + i * 4: 16 + i * 4 + 4]) for i in range(n)]
    if bpp == 8: raw = unswizzle_clut(raw)
    pal = [(r, g, bl, min(255, a * 2)) for r, g, bl, a in raw]
    img = Image.new("RGBA", (w, h)); px = img.load()
    base = 16 + n * 4
    for y in range(h):
        for x in range(w):
            if bpp == 8: idx = b[base + y * w + x]
            else:
                v = b[base + (y * w + x) // 2]; idx = v & 0xF if x % 2 == 0 else v >> 4
            px[x, y] = pal[idx]
    return img
