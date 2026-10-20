"""PS2 GS PSMT8 texture de-swizzle (page 128x64, block 16x16, column 16x4; tables from the public GS swizzle code).
unswizzle_psmt8(data, width, height, base=0, dbw=None) -> bytes of linear 8-bit indices (row-major).
`data` is a GS-memory image whose byte 0 is TBP `base` (in 256-byte units); dbw = buffer width in 64-px units."""
import numpy as np

BLOCK8 = [0,1,4,5,16,17,20,21,2,3,6,7,18,19,22,23,8,9,12,13,24,25,28,29,10,11,14,15,26,27,30,31]
COLUMNWORD8 = [
 [0,1,4,5,8,9,12,13, 0,1,4,5,8,9,12,13, 2,3,6,7,10,11,14,15, 2,3,6,7,10,11,14,15,
  8,9,12,13,0,1,4,5, 8,9,12,13,0,1,4,5, 10,11,14,15,2,3,6,7, 10,11,14,15,2,3,6,7],
 [8,9,12,13,0,1,4,5, 8,9,12,13,0,1,4,5, 10,11,14,15,2,3,6,7, 10,11,14,15,2,3,6,7,
  0,1,4,5,8,9,12,13, 0,1,4,5,8,9,12,13, 2,3,6,7,10,11,14,15, 2,3,6,7,10,11,14,15]]
COLUMNBYTE8 = [0,0,0,0,0,0,0,0, 2,2,2,2,2,2,2,2, 0,0,0,0,0,0,0,0, 2,2,2,2,2,2,2,2,
               1,1,1,1,1,1,1,1, 3,3,3,3,3,3,3,3, 1,1,1,1,1,1,1,1, 3,3,3,3,3,3,3,3]

def _index_map(width, height, dbp_words, dbw):
    """Byte offsets into GS memory for each (y, x) of a width x height PSMT8 region at page-aligned dbp (256-byte units)."""
    ys, xs = np.mgrid[0:height, 0:width]
    page = dbp_words // 32 + (ys // 64) * (dbw // 2) + xs // 128   # dbw given in 64px units -> 128px pages
    px = xs % 128; py = ys % 64
    blk = np.array(BLOCK8)[(px // 16) + (py // 16) * 8]
    bx = px % 16; by = py % 16
    column = by // 4
    cx = bx; cy = by % 4
    idx = cx + cy * 16
    cw = np.where(column & 1, np.array(COLUMNWORD8[1])[idx], np.array(COLUMNWORD8[0])[idx])
    cb = np.array(COLUMNBYTE8)[idx]
    return page * 8192 + blk * 256 + column * 64 + cw * 4 + cb

def unswizzle_psmt8(data: bytes, width: int, height: int, tbp=0, base=0, dbw=None):
    if dbw is None: dbw = max(1, width // 64)
    off = _index_map(width, height, (tbp - base) * 64, dbw)   # 256-byte units -> words? page unit is 8192 bytes = 32*256
    a = np.frombuffer(data, dtype='uint8')
    out = np.zeros(off.shape, dtype='uint8')
    ok = off < len(a)
    out[ok] = a[off[ok]]
    return out


# ---- PSMCT32 write + PSMT8 read: FFX stores 8-bit textures pre-swizzled as a (w/2 x h/2) 32-bit image ----
BLOCK32 = [0,1,4,5,16,17,20,21,2,3,6,7,18,19,22,23,8,9,12,13,24,25,28,29,10,11,14,15,26,27,30,31]
COLUMNWORD32 = [0,1,4,5,8,9,12,13,2,3,6,7,10,11,14,15]

def _map32(width, height, dbw_pages):
    """word offsets (in GS memory) of each pixel of a width x height PSMCT32 image, dbw_pages = pages per row."""
    ys, xs = np.mgrid[0:height, 0:width]
    page = (ys // 32) * dbw_pages + xs // 64
    px = xs % 64; py = ys % 32
    blk = np.array(BLOCK32)[(px // 8) + (py // 8) * 8]
    bx = px % 8; by = py % 8
    column = by // 2
    cw = np.array(COLUMNWORD32)[bx + (by % 2) * 8]
    return page * 2048 + blk * 64 + column * 16 + cw

def psmct32_to_psmt8(data: bytes, width: int, height: int):
    """`data` = linear rows of a (width/2 x height/2) 32-bit image as uploaded to the GS; returns the
    width x height 8-bit texture the GS reads back in PSMT8."""
    w32, h32 = width // 2, height // 2
    pages_per_row = max(1, w32 // 64)
    npages = pages_per_row * ((h32 + 31) // 32)
    mem = np.zeros(npages * 8192, dtype='uint8')
    src = np.frombuffer(data[:w32 * h32 * 4], dtype='uint8').reshape(h32, w32, 4)
    woff = _map32(w32, h32, pages_per_row)
    for byte in range(4):
        mem[woff * 4 + byte] = src[:, :, byte]
    off = _index_map(width, height, 0, width // 64)
    ok = off < len(mem)
    out = np.zeros(off.shape, dtype='uint8'); out[ok] = mem[off[ok]]
    return out
