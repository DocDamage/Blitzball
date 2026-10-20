"""Minimal PS2 VIF command stream parser (enough for FFX map geometry).

A VIF code is a u32: imm (bits 0..15), num (16..23), cmd (24..31, bit 7 = interrupt). UNPACK commands
(0x60..0x7F) carry vertex data for VU1 memory; MSCAL/MSCNT kick the microprogram that draws what was unpacked.
"""

import struct
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Unpack:
    addr: int
    vn: int  # components - 1
    vl: int  # 0 = 32-bit, 1 = 16-bit, 2 = 8-bit, 3 = 5-bit RGBA
    num: int
    signed: bool
    flg: bool
    data: np.ndarray  # (num, vn + 1)
    offset: int  # file offset of the VIF code


@dataclass
class Batch:
    """Everything unpacked between two microprogram calls."""

    unpacks: list[Unpack] = field(default_factory=list)
    direct: list[bytes] = field(default_factory=list)
    row: tuple = (0, 0, 0, 0)
    mscal: int = -1
    offset: int = 0


def unpack_size(vn: int, vl: int, num: int) -> int:
    bits = {0: 32, 1: 16, 2: 8, 3: 16}[vl]
    comps = 1 if vl == 3 else vn + 1
    return (num * comps * bits // 8 + 3) & ~3


def decode_unpack(buf: bytes, pos: int, vn: int, vl: int, num: int, signed: bool) -> np.ndarray:
    comps = vn + 1
    if vl == 0:
        return np.frombuffer(buf, dtype="<u4", count=num * comps, offset=pos).reshape(num, comps)
    if vl == 1:
        dt = "<i2" if signed else "<u2"
        return np.frombuffer(buf, dtype=dt, count=num * comps, offset=pos).reshape(num, comps).astype(np.int32)
    if vl == 2:
        dt = "i1" if signed else "u1"
        return np.frombuffer(buf, dtype=dt, count=num * comps, offset=pos).reshape(num, comps).astype(np.int32)
    raw = np.frombuffer(buf, dtype="<u2", count=num, offset=pos).astype(np.int32)
    return np.stack([(raw & 31) << 3, ((raw >> 5) & 31) << 3, ((raw >> 10) & 31) << 3, (raw >> 15) << 7], axis=1)


def parse(buf: bytes, start: int, end: int) -> list[Batch]:
    batches: list[Batch] = []
    cur = Batch(offset=start)
    row = (0, 0, 0, 0)
    pos = start
    while pos + 4 <= end:
        code = struct.unpack_from("<I", buf, pos)[0]
        imm, num, cmd = code & 0xFFFF, (code >> 16) & 0xFF, (code >> 24) & 0x7F
        here = pos
        pos += 4
        if cmd >= 0x60:
            vn, vl = (cmd >> 2) & 3, cmd & 3
            n = num or 256
            size = unpack_size(vn, vl, n)
            data = decode_unpack(buf, pos, vn, vl, n, signed=not (imm & 0x4000))
            cur.unpacks.append(Unpack(imm & 0x3FF, vn, vl, n, not (imm & 0x4000), bool(imm & 0x8000), data, here))
            pos += size
        elif cmd in (0x14, 0x15, 0x17):  # MSCAL, MSCALF, MSCNT
            cur.mscal = imm
            cur.row = row
            batches.append(cur)
            cur = Batch(offset=pos)
        elif cmd == 0x20:  # STMASK
            pos += 4
        elif cmd in (0x30, 0x31):  # STROW / STCOL
            if cmd == 0x30:
                row = struct.unpack_from("<4I", buf, pos)
            pos += 16
        elif cmd == 0x4A:  # MPG
            pos += (num or 256) * 8
        elif cmd in (0x50, 0x51):  # DIRECT / DIRECTHL
            n = (imm or 65536) * 16
            cur.direct.append(buf[pos : pos + n])
            pos += n
        elif cmd in (0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x10, 0x11, 0x13):
            pass
        else:
            raise ValueError(f"unknown VIF cmd {cmd:#x} at {here:#x}")
    if cur.unpacks:
        batches.append(cur)
    return batches
