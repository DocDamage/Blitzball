"""PS2 GS local memory (4 MB) with the PSMCT32 / PSMT8 / PSMT4 pixel addressing, for reading textures that the
game placed in VRAM by block address rather than through explicit uploads.

Tables follow the GS block/column layouts (as implemented in PCSX2's GSLocalMemory). Addresses: bp in 256-byte
blocks, bw in 64-pixel units.
"""

import numpy as np

VRAM_BYTES = 4 * 1024 * 1024

BLOCK32 = np.array([
    [0, 1, 4, 5, 16, 17, 20, 21],
    [2, 3, 6, 7, 18, 19, 22, 23],
    [8, 9, 12, 13, 24, 25, 28, 29],
    [10, 11, 14, 15, 26, 27, 30, 31],
])
COLUMN32 = np.array([
    [0, 1, 4, 5, 8, 9, 12, 13],
    [2, 3, 6, 7, 10, 11, 14, 15],
    [16, 17, 20, 21, 24, 25, 28, 29],
    [18, 19, 22, 23, 26, 27, 30, 31],
    [32, 33, 36, 37, 40, 41, 44, 45],
    [34, 35, 38, 39, 42, 43, 46, 47],
    [48, 49, 52, 53, 56, 57, 60, 61],
    [50, 51, 54, 55, 58, 59, 62, 63],
])
BLOCK8 = np.array([
    [0, 1, 4, 5, 16, 17, 20, 21],
    [2, 3, 6, 7, 18, 19, 22, 23],
    [8, 9, 12, 13, 24, 25, 28, 29],
    [10, 11, 14, 15, 26, 27, 30, 31],
])
COLUMN8 = np.array([
    [0, 4, 16, 20, 32, 36, 48, 52, 2, 6, 18, 22, 34, 38, 50, 54],
    [8, 12, 24, 28, 40, 44, 56, 60, 10, 14, 26, 30, 42, 46, 58, 62],
    [33, 37, 49, 53, 1, 5, 17, 21, 35, 39, 51, 55, 3, 7, 19, 23],
    [41, 45, 57, 61, 9, 13, 25, 29, 43, 47, 59, 63, 11, 15, 27, 31],
    [96, 100, 112, 116, 64, 68, 80, 84, 98, 102, 114, 118, 66, 70, 82, 86],
    [104, 108, 120, 124, 72, 76, 88, 92, 106, 110, 122, 126, 74, 78, 90, 94],
    [65, 69, 81, 85, 97, 101, 113, 117, 67, 71, 83, 87, 99, 103, 115, 119],
    [73, 77, 89, 93, 105, 109, 121, 125, 75, 79, 91, 95, 107, 111, 123, 127],
    [128, 132, 144, 148, 160, 164, 176, 180, 130, 134, 146, 150, 162, 166, 178, 182],
    [136, 140, 152, 156, 168, 172, 184, 188, 138, 142, 154, 158, 170, 174, 186, 190],
    [161, 165, 177, 181, 129, 133, 145, 149, 163, 167, 179, 183, 131, 135, 147, 151],
    [169, 173, 185, 189, 137, 141, 153, 157, 171, 175, 187, 191, 139, 143, 155, 159],
    [224, 228, 240, 244, 192, 196, 208, 212, 226, 230, 242, 246, 194, 198, 210, 214],
    [232, 236, 248, 252, 200, 204, 216, 220, 234, 238, 250, 254, 202, 206, 218, 222],
    [193, 197, 209, 213, 225, 229, 241, 245, 195, 199, 211, 215, 227, 231, 243, 247],
    [201, 205, 217, 221, 233, 237, 249, 253, 203, 207, 219, 223, 235, 239, 251, 255],
])


def addr32(bp: int, bw: int, w: int, h: int) -> np.ndarray:
    """Byte address of each PSMCT32 pixel (h, w)."""
    y, x = np.mgrid[0:h, 0:w]
    page = (y // 32) * bw + (x // 64)
    block = BLOCK32[(y // 8) % 4, (x // 8) % 8]
    word = COLUMN32[y % 8, x % 8]
    return (bp * 64 + page * 2048 + block * 64 + word) * 4


def addr8(bp: int, bw: int, w: int, h: int) -> np.ndarray:
    """Byte address of each PSMT8 pixel (h, w); a PSMT8 page is 128x64 and bw counts 64-pixel units."""
    y, x = np.mgrid[0:h, 0:w]
    page = (y // 64) * max(1, bw // 2) + (x // 128)
    block = BLOCK8[(y // 16) % 4, (x // 16) % 8]
    byte = COLUMN8[y % 16, x % 16]
    return bp * 256 + page * 8192 + block * 256 + byte


class GSMem:
    def __init__(self) -> None:
        self.mem = np.zeros(VRAM_BYTES, dtype=np.uint8)

    def write_raw(self, bp: int, data: bytes) -> None:
        a = bp * 256
        n = min(len(data), VRAM_BYTES - a)
        self.mem[a : a + n] = np.frombuffer(data, dtype=np.uint8)[:n]

    def write32(self, bp: int, bw: int, w: int, h: int, data: bytes) -> None:
        """Upload a linear PSMCT32 image (what BITBLTBUF with DPSM=PSMCT32 does)."""
        a = addr32(bp, bw, w, h) % VRAM_BYTES
        px = np.frombuffer(data, dtype=np.uint8)[: w * h * 4].reshape(h, w, 4)
        for c in range(4):
            self.mem[(a + c) % VRAM_BYTES] = px[..., c]

    def read8(self, bp: int, bw: int, w: int, h: int) -> np.ndarray:
        return self.mem[addr8(bp, bw, w, h) % VRAM_BYTES]

    def read32(self, bp: int, bw: int, w: int, h: int) -> np.ndarray:
        a = addr32(bp, bw, w, h) % VRAM_BYTES
        return np.stack([self.mem[(a + c) % VRAM_BYTES] for c in range(4)], axis=-1)

    def clut256(self, cbp: int) -> np.ndarray:
        """A 256-entry PSMCT32 CLUT stored as a 16x16 block (CSM1), in palette index order."""
        raw = self.read32(cbp, 1, 16, 16).reshape(256, 4)
        idx = np.arange(256)
        src = (idx & ~0x18) | ((idx & 0x08) << 1) | ((idx & 0x10) >> 1)
        return raw[src]
