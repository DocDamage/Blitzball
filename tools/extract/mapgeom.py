"""FFX PS2 field map (MAP1) -> glTF with textures.

MAP1 container (Noesis extraction section 019): u32 'MAP1', then u32 section offsets at +0x04..+0x7C.
  slot 4 (+0x10)  'YNDT' 2D background layers (not used here)
  slot 5 (+0x14)  graphics: u32 0x00214365, u32 0x110, u32 size, u32 count, ... then per-mesh records whose VIF
                  streams draw the scene, plus GIF image uploads (textures, CLUTs)
  slot 6 (+0x18)  collision mesh (int16 xyz)
Each VIF batch unpacks, to VU1 memory: a 10-qword header at 0 (GIF tag + A+D writes incl. TEX0), N RGBA8 vertex
colours, N UV pairs (16-bit, texels * 16) and N float xyz positions, then kicks the microprogram. Vertices form a
triangle list. Textures are uploaded with BITBLTBUF/TRXREG/TRXDIR + an IMAGE GIF tag in the texture's own pixel
format, so the bytes are linear; a draw's TEX0.TBP0 / CBP are matched against upload destinations.

Usage: python mapgeom.py <MAP1 file> <out dir>         -> out/map.gltf, out/map.bin, out/tex_*.png
       python mapgeom.py --stats <dir of MAP1 files>    -> one line per map: triangles, bounds
"""

import json
import pathlib
import re
import struct
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import gsmem  # noqa: E402
import vif  # noqa: E402

STREAM_START = bytes.fromhex("0000001101010001")  # FLUSH; STCYCL 1,1


def graphics_section(b: bytes) -> tuple[int, int] | None:
    if b[:4] != b"MAP1":
        return None
    off = struct.unpack_from("<I", b, 0x14)[0]
    if not off or struct.unpack_from("<I", b, off)[0] != 0x00214365:
        return None
    return off, off + struct.unpack_from("<I", b, off + 8)[0]


def batches(b: bytes, start: int, end: int) -> list[vif.Batch]:
    """Parse every VIF stream in the section, resynchronising at each stream start (mesh records sit between)."""
    starts = [m.start() + start for m in re.finditer(re.escape(STREAM_START), b[start:end])]
    out: list[vif.Batch] = []
    for i, s in enumerate(starts):
        stop = starts[i + 1] if i + 1 < len(starts) else end
        try:
            out += vif.parse(b, s, stop)
        except ValueError as e:
            at = int(str(e).rsplit(" at ", 1)[1], 16)
            try:
                out += vif.parse(b, s, at)
            except ValueError:
                pass
    return out


def tex0_of(batch: vif.Batch) -> int | None:
    """The TEX0 in effect for the batch: the last TEX0_1/TEX0_2 A+D write in its header (the header writes a
    PSMT8 TEX0 and then the PSMT4 one actually used, with its palette offset in CSA)."""
    last = None
    for u in batch.unpacks:
        if u.addr == 0 and u.vn == 3 and u.vl == 0:
            rows = u.data.astype(np.uint64)
            for r in rows:
                if int(r[2]) in (6, 7) and int(r[3]) == 0 and (int(r[0]) or int(r[1])):
                    last = int(r[0]) | (int(r[1]) << 32)
    return last


def triangles(batch: vif.Batch):
    """(positions[N,3], uvs[N,2] in texels, colours[N,4]) for a standard geometry batch, else None."""
    cols = uvs = pos = None
    for u in batch.unpacks:
        if u.vn == 3 and u.vl == 2:
            cols = u.data
        elif u.vn == 1 and u.vl == 1:
            uvs = u.data
        elif u.vn == 2 and u.vl == 0:
            pos = u.data.astype(np.uint32).view(np.float32)
    if cols is None or uvs is None or pos is None:
        return None
    n = min(len(cols), len(uvs), len(pos))
    n -= n % 3
    if n == 0:
        return None
    return pos[:n].astype(np.float32), uvs[:n].astype(np.float32) / 16.0, cols[:n]


def uploads(b: bytes, start: int, end: int) -> dict[tuple[int, int], tuple[int, int, int, bytes]]:
    """(dbp, dpsm) -> (dbw, width, height, pixels) for every image transfer in the section."""
    out = {}
    off = start - (start % 16)
    while off + 16 <= end:
        reg = struct.unpack_from("<Q", b, off + 8)[0]
        if reg == 0x50:
            bitblt = struct.unpack_from("<Q", b, off)[0]
            dbp, dbw, dpsm = (bitblt >> 32) & 0x3FFF, (bitblt >> 48) & 0x3F, (bitblt >> 56) & 0x3F
            w = h = 0
            p = off + 16
            while p + 16 <= end and p < off + 16 * 6:
                r = struct.unpack_from("<Q", b, p + 8)[0]
                v = struct.unpack_from("<Q", b, p)[0]
                if r == 0x52:
                    w, h = v & 0xFFF, (v >> 32) & 0xFFF
                if r == 0x53:
                    tag = struct.unpack_from("<Q", b, p + 16)[0]
                    nloop, flg = tag & 0x7FFF, (tag >> 58) & 3
                    if flg == 2 and w and h:
                        data = b[p + 32 : p + 32 + nloop * 16]
                        out[(dbp, dpsm)] = (dbw, w, h, data)
                    off = p + 32 + nloop * 16 - 16
                    break
                p += 16
        off += 16
    return out


def unswizzle4(buf: np.ndarray, w: int, h: int) -> np.ndarray:
    """PSMT4 texel indices from data stored for a PSMCT32 upload (the usual PS2 texture-conversion layout)."""
    y, x = np.mgrid[0:h, 0:w]
    page_x, page_y = x & ~0x7F, y & ~0x7F
    ph, pv = (w + 127) // 128, (h + 127) // 128
    pn = (page_y // 128) * ph + (page_x // 128)
    ploc = (pn // pv) * 32 * h * 2 + (pn % pv) * 64 * 4
    lx, ly = x & 0x7F, y & 0x7F
    bloc = ((lx & ~0x1F) >> 1) * h + (ly & ~0xF) * 2
    swap = (((ly + 2) >> 2) & 1) * 4
    pos_y = (((ly & ~3) >> 1) + (ly & 1)) & 7
    v = buf[ploc + bloc + pos_y * h * 2 + ((lx + swap) & 7) * 4 + ((lx >> 3) & 3)]
    return np.where(((ly >> 1) & 1) == 1, v >> 4, v & 15).astype(np.uint8)


def unswizzle8(buf: np.ndarray, w: int, h: int) -> np.ndarray:
    """PSMT8 texel indices from data stored for a PSMCT32 upload."""
    y, x = np.mgrid[0:h, 0:w]
    block = (y & ~0xF) * w + (x & ~0xF) * 2
    swap = (((y + 2) >> 2) & 1) * 4
    pos_y = (((y & ~3) >> 1) + (y & 1)) & 7
    return buf[block + pos_y * w * 2 + ((x + swap) & 7) * 4 + ((y >> 1) & 1) + ((x >> 2) & 2)]


# Where the engine uploads a texture file's palette record (type 3): a 256-wide PSMCT32 image (checked on Luca)
CLUT_BASE, CLUT_BW, CLUT_W = 0x2080, 4, 256


class Companion:
    """A texture-only MAP1 file (the one before a geometry map): type-2 records are textures with their GS upload
    address ({1, DBP, DBW, PSM} at +0x40, pixels at +0x80), the type-3 record is the palette area."""

    def __init__(self, b: bytes) -> None:
        self.tex: dict[int, tuple[int, np.ndarray]] = {}
        self.gs = gsmem.GSMem()
        sec = struct.unpack_from("<I", b, 0x14)[0]
        r = sec + 0x40
        while r + 0x40 <= len(b):
            typ, size = struct.unpack_from("<II", b, r)
            if size == 0 or r + 0x40 + size > len(b):
                break
            if typ == 2:
                _, dbp, _, psm = struct.unpack_from("<4I", b, r + 0x40)
                self.tex[dbp] = (psm, np.frombuffer(b[r + 0x80 : r + 0x40 + size], dtype=np.uint8))
            elif typ == 3:
                data = b[r + 0x40 : r + 0x40 + size]
                self.gs.write32(CLUT_BASE, CLUT_BW, CLUT_W, len(data) // 4 // CLUT_W, data)
            r += 0x40 + size

    def image(self, tex0: int) -> Image.Image | None:
        tbp, psm = tex0 & 0x3FFF, (tex0 >> 20) & 0x3F
        cbp, csa = (tex0 >> 37) & 0x3FFF, (tex0 >> 56) & 0x1F
        rec = self.tex.get(tbp)
        if not rec or rec[0] != psm:
            return None
        pal = self.gs.clut256(cbp).copy()
        if psm == 0x14:
            idx = unswizzle4(rec[1], 256, 256)
            pal = pal[csa * 16 : csa * 16 + 16]
        elif psm == 0x13:
            idx = unswizzle8(rec[1], 256, 256)
        else:
            return None
        pal[:, 3] = np.minimum(255, pal[:, 3].astype(np.int32) * 2)
        return Image.fromarray(pal[idx], "RGBA")


def companion_for(path: pathlib.Path) -> "Companion | None":
    """The texture-only MAP1 that precedes a geometry map in the disc order."""
    m = re.match(r"file(\d+)\.raw$", path.name)
    if not m:
        return None
    prev = path.with_name(f"file{int(m.group(1)) - 1:04d}.raw")
    if not prev.exists():
        return None
    b = prev.read_bytes()
    slots = struct.unpack_from("<32I", b, 0)
    if b[:4] != b"MAP1" or not slots[5] or any(slots[i] for i in (4, 6)):
        return None
    return Companion(b)


PSM_BITS = {0x00: 32, 0x13: 8, 0x14: 4, 0x1B: 8, 0x24: 4, 0x2C: 4}


def unswizzle_clut8(pal: np.ndarray) -> np.ndarray:
    idx = np.arange(256)
    src = (idx & ~0x18) | ((idx & 0x08) << 1) | ((idx & 0x10) >> 1)
    return pal[src]


def texture_image(tex0: int, ups: dict) -> Image.Image | None:
    tbp, psm = tex0 & 0x3FFF, (tex0 >> 20) & 0x3F
    tw, th = 1 << ((tex0 >> 26) & 0xF), 1 << ((tex0 >> 30) & 0xF)
    cbp, csa = (tex0 >> 37) & 0x3FFF, (tex0 >> 56) & 0x1F
    pix = ups.get((tbp, psm))
    clut = ups.get((cbp, 0x00))
    if not pix or not clut or psm not in (0x13, 0x14):
        return None
    _, w, h, data = pix
    pal = np.frombuffer(clut[3], dtype=np.uint8)
    pal = pal[: len(pal) - len(pal) % 4].reshape(-1, 4)
    if psm == 0x13:
        if len(pal) < 256:
            return None
        pal = unswizzle_clut8(pal[:256])
        idx = np.frombuffer(data, dtype=np.uint8)[: w * h]
    else:
        start = csa * 16
        pal = pal[start : start + 16]
        if len(pal) < 16:
            return None
        raw = np.frombuffer(data, dtype=np.uint8)[: w * h // 2]
        idx = np.stack([raw & 15, raw >> 4], axis=1).ravel()
    if len(idx) < w * h:
        return None
    rgba = pal[idx].copy()
    rgba[:, 3] = np.minimum(255, rgba[:, 3].astype(np.int32) * 2)
    img = Image.fromarray(rgba.reshape(h, w, 4), "RGBA")
    if (tw, th) != (w, h):
        img = img.crop((0, 0, min(tw, w), min(th, h)))
    return img


def decode(path: pathlib.Path):
    b = path.read_bytes()
    sec = graphics_section(b)
    if not sec:
        return None
    start, end = sec
    groups: dict[int | None, list] = {}
    tex0 = None
    for bt in batches(b, start, end):
        # GS state persists: a batch that sets no TEX0 draws with the previous one
        tex0 = tex0_of(bt) or tex0
        tri = triangles(bt)
        if tri:
            groups.setdefault(tex0, []).append(tri)
    return b, sec, groups


def write_gltf(path: pathlib.Path, out: pathlib.Path) -> dict:
    res = decode(path)
    if not res:
        raise SystemExit("no MAP1 graphics section")
    b, (start, end), groups = res
    ups = uploads(b, start, end)
    comp = companion_for(path)
    out.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    gl = {"asset": {"version": "2.0"}, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}], "meshes": [{"primitives": []}],
          "accessors": [], "bufferViews": [], "materials": [], "textures": [], "images": [], "samplers": [{}]}

    def view(arr: np.ndarray, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        gl["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes, "target": target})
        blob.extend(arr.tobytes())
        return len(gl["bufferViews"]) - 1

    stats = {"triangles": 0, "textures": 0, "untextured": 0}
    for k, (tex0, parts) in enumerate(groups.items()):
        pos = np.concatenate([p[0] for p in parts])
        uv = np.concatenate([p[1] for p in parts])
        col = np.concatenate([p[2] for p in parts]).astype(np.float32)
        img = None
        if tex0 is not None:
            img = comp.image(tex0) if comp else None
            img = img or texture_image(tex0, ups)
        mat: dict = {"pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 1}, "doubleSided": True}
        if img is not None:
            name = f"tex_{k:03d}.png"
            img.save(out / name)
            gl["images"].append({"uri": name})
            gl["textures"].append({"source": len(gl["images"]) - 1, "sampler": 0})
            mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(gl["textures"]) - 1}
            mat["alphaMode"] = "MASK"
            uv = uv / np.array([img.width, img.height], dtype=np.float32)
            stats["textures"] += 1
        else:
            stats["untextured"] += 1
        gl["materials"].append(mat)
        # PS2 vertex colour 0x80 = 1.0
        colors = np.clip(col / 128.0, 0, 1).astype(np.float32)
        acc = []
        for arr, typ, target in ((pos, "VEC3", 34962), (uv.astype(np.float32), "VEC2", 34962), (colors, "VEC4", 34962)):
            a = {"bufferView": view(np.ascontiguousarray(arr), target), "componentType": 5126, "count": len(arr), "type": typ}
            if typ == "VEC3":
                a["min"] = pos.min(axis=0).tolist()
                a["max"] = pos.max(axis=0).tolist()
            gl["accessors"].append(a)
            acc.append(len(gl["accessors"]) - 1)
        gl["meshes"][0]["primitives"].append(
            {"attributes": {"POSITION": acc[0], "TEXCOORD_0": acc[1], "COLOR_0": acc[2]}, "material": k})
        stats["triangles"] += len(pos) // 3
    gl["buffers"] = [{"uri": "map.bin", "byteLength": len(blob)}]
    (out / "map.bin").write_bytes(blob)
    (out / "map.gltf").write_text(json.dumps(gl))
    return stats


def main() -> None:
    if sys.argv[1] == "--stats":
        for f in sorted(pathlib.Path(sys.argv[2]).iterdir()):
            res = decode(f)
            if not res:
                continue
            _, _, groups = res
            pts = [p[0] for parts in groups.values() for p in parts]
            if not pts:
                continue
            allp = np.concatenate(pts)
            size = allp.max(axis=0) - allp.min(axis=0)
            print(f.name, len(allp) // 3, len(groups), " ".join(f"{s:.0f}" for s in size), flush=True)
    else:
        print(write_gltf(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])))


if __name__ == "__main__":
    main()
