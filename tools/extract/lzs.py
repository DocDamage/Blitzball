"""FFX PS2 LZ decompressor.

Evidence: SLUS_203.12 FUN_002533f0 (type 1, 2 KiB window) and FUN_002535c0 (type 2, 4 KiB window),
dispatched on the first header byte (see data/raw/ghidra/all_functions.c around line 79322).

Stream layout:
  byte 0      : type (1 or 2)
  bytes 1..4  : decompressed size, little-endian uint32
  tokens      :
    b0 == 0x00            end of stream
    0x01 <= b0 <= 0x7d    literal run, b0 bytes follow
    b0 == 0x7e            RLE: count = next+4, value = next
    b0 == 0x7f            RLE: count = next uint16 LE, value = next
    b0 & 0x80             back-reference, second byte b1 follows
        type 1: length = ((b0>>3)&0xf)+3, distance = (((b0&0x7)<<8)|b1)+1
        type 2: length = ((b0>>4)&0x7)+3, distance = (((b0&0xf)<<8)|b1)+1
    A reference reaching before the start of the output yields zero bytes.
"""

def is_compressed(data: bytes) -> bool:
    return len(data) >= 5 and data[0] in (1, 2)

def decompress(src: bytes) -> bytes:
    typ = src[0]
    if typ not in (1, 2):
        raise ValueError("not an FFX LZ stream (type %d)" % typ)
    size = src[1] | src[2] << 8 | src[3] << 16 | src[4] << 24
    out = bytearray()
    i = 5
    L = len(src)
    while i < L and len(out) < size:
        b0 = src[i]; i += 1
        if b0 & 0x80:
            b1 = src[i]; i += 1
            if typ == 1:
                n = ((b0 >> 3) & 0xF) + 3
                dist = (((b0 & 0x7) << 8) | b1) + 1
            else:
                n = ((b0 >> 4) & 0x7) + 3
                dist = (((b0 & 0xF) << 8) | b1) + 1
            if dist > len(out):
                zeros = min(n, dist - len(out))
                out += b"\0" * zeros
                n -= zeros
            for _ in range(n):
                out.append(out[-dist])
        elif b0 == 0:
            break
        elif b0 < 0x7E:
            out += src[i:i + b0]; i += b0
        elif b0 == 0x7E:
            n = src[i] + 4; v = src[i + 1]; i += 2
            out += bytes([v]) * n
        else:
            n = src[i] | src[i + 1] << 8; v = src[i + 2]; i += 3
            out += bytes([v]) * n
    return bytes(out[:size])

def declared_size(entry) -> int:
    """Byte size of an entry from the fid table (sectors*2048 minus slack in top 9 bits, 4-byte units)."""
    return entry["sectors"] * 2048 - (entry["flags"] >> 1) * 4
