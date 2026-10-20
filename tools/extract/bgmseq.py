"""Square PS2 'BGM ' sequence parsing (fid 00472: music; also the SeBlock sound effects in fid 00474).

Header (0x20): 'BGM ', u16 sequence id, u16 WD bank id, u8 track count, ..., u16 ppqn @0x0e, u32 length @0x10.
Tracks follow at 0x20, each a u32 byte size + events: VLQ delta, status byte, operands. Opcode operand counts come from
VGMTrans' SquarePS2Seq (known) plus lengths fitted against the data (every track must end exactly on its 0x00 event).
"""
import struct

# opcode -> operand byte count; None = unknown yet
OPERANDS = {
    0x00: 0, 0x02: 0, 0x03: 0, 0x04: 0, 0x08: 1, 0x0A: 1, 0x0C: 2, 0x0D: 1,
    0x10: 0, 0x11: 2, 0x12: 1, 0x13: 1, 0x18: 0, 0x19: 2, 0x1A: 1,
    0x20: 1, 0x22: 1, 0x24: 1, 0x26: 1, 0x28: 1, 0x31: 1, 0x34: 1, 0x35: 1, 0x3C: 1, 0x3E: 1,
    0x40: 3, 0x47: 2, 0x48: 3, 0x50: 3, 0x58: 1, 0x5C: 2, 0x5D: 1, 0x60: 0, 0x61: 0, 0x7F: 0,
}


def read_vlq(b: bytes, p: int):
    v = 0
    while True:
        c = b[p]
        p += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, p


def parse_track(b: bytes, p: int, end: int, ops=OPERANDS, ends=(0x00,)):
    """Parse events in b[p:end]. Returns (events, ok) where ok = ended exactly on a 0x00 event at `end`."""
    ev = []
    while p < end:
        try:
            dt, q = read_vlq(b, p)
        except IndexError:
            return ev, False
        if q >= end:
            return ev, False
        op = b[q]
        q += 1
        n = ops.get(op)
        if n is None:
            return ev, False
        if q + n > end:
            return ev, False
        ev.append((dt, op, tuple(b[q : q + n])))
        q += n
        p = q
        if op in ends:
            return ev, p == end
    return ev, False


def sequences(b: bytes):
    pos = 0
    while pos + 0x20 <= len(b):
        if b[pos : pos + 4] == b"BGM ":
            sid, wid, tc = struct.unpack_from("<HHB", b, pos + 4)
            ppqn = struct.unpack_from("<H", b, pos + 0xE)[0]
            ln = struct.unpack_from("<I", b, pos + 0x10)[0]
            yield dict(off=pos, id=sid, wd=wid, tracks=tc, ppqn=ppqn, len=ln)
        pos += 0x800


def tracks_of(b: bytes, seq):
    p = seq["off"] + 0x20
    end = seq["off"] + seq["len"]
    out = []
    for _ in range(seq["tracks"]):
        if p + 4 > len(b):
            break
        size = struct.unpack_from("<I", b, p)[0]
        out.append((p + 4, p + 4 + size))
        p += 4 + size
    return out
