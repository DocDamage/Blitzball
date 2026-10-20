"""Square PS2 sound sequence format ('BGM ' music in fid 00472, SE entries in fid 00474 and in event scripts).

Opcode table: reverse-engineered from IOPSOUND.IRX (the handlers at the jump table 0x17500) cross-checked against
VGMTrans' SquarePS2Seq. Every track in the music file and the SeBlock parses cleanly with it (all but two of 1691).

Stream = [VLQ delta][opcode][operands]...; operands are bytes ('b') or VLQs ('v'). A VLQ is MSB-first, 7 bits per byte.
"""
import struct

SPEC = {
    0x00: "", 0x01: "", 0x02: "", 0x03: "", 0x04: "", 0x05: "b", 0x06: "",
    0x08: "b", 0x09: "bb", 0x0A: "b", 0x0B: "bb", 0x0C: "bb", 0x0D: "b",
    0x10: "", 0x11: "bb", 0x12: "b", 0x13: "b", 0x18: "", 0x19: "bb", 0x1A: "b", 0x1B: "b",
    0x20: "b", 0x21: "bb", 0x22: "b", 0x23: "vb", 0x24: "b", 0x25: "vb", 0x26: "b", 0x27: "vb", 0x28: "v",
    0x29: "", 0x2A: "", 0x2B: "", 0x2C: "vb", 0x2E: "", 0x2F: "", 0x30: "",
    0x31: "b", 0x32: "b", 0x33: "b", 0x34: "b", 0x35: "b", 0x36: "b", 0x37: "b", 0x38: "b", 0x39: "bb",
    0x3C: "b", 0x3D: "b", 0x3E: "b", 0x3F: "b",
    0x40: "bbb", 0x41: "", 0x42: "b", 0x43: "vb", 0x44: "b", 0x45: "vb", 0x46: "b", 0x47: "bb", 0x48: "bbb",
    0x49: "", 0x4A: "b", 0x4B: "vb", 0x4C: "b", 0x4D: "vb", 0x4E: "b", 0x4F: "bb", 0x50: "bbb", 0x51: "",
    0x52: "b", 0x53: "vb", 0x54: "b", 0x55: "vb", 0x56: "b",
    0x58: "b", 0x59: "b", 0x5A: "b", 0x5B: "b", 0x5C: "bb", 0x5D: "b",
    0x60: "", 0x61: "", 0x62: "bb", 0x64: "", 0x65: "", 0x68: "", 0x69: "", 0x6C: "b", 0x70: "b", 0x71: "b",
    0x78: "bb", 0x79: "b", 0x7F: "",
}

# meaning of the opcodes the synthesiser uses
END, LOOP_START, LOOP_END, LOOP_FOREVER = 0x00, 0x04, 0x05, 0x06
TEMPO, TEMPO_SLIDE = 0x08, 0x09
NOTE_KEYVEL, NOTE_KEY, NOTE_VEL, NOTE_PREV = 0x11, 0x12, 0x13, 0x10
OFF_PREV, OFF_KEY2, OFF_KEY, OFF_SKIP = 0x18, 0x19, 0x1A, 0x1B
PROGRAM, BANK_PROGRAM = 0x20, 0x21
VOL, VOL_SLIDE, EXPR, EXPR_SLIDE, PAN, PAN_SLIDE = 0x22, 0x23, 0x24, 0x25, 0x26, 0x27
PITCH_SLIDE, SUSTAIN, BEND, BEND_RANGE = 0x2C, 0x3C, 0x5C, 0x5D


def read_vlq(b: bytes, p: int):
    v = 0
    while True:
        c = b[p]
        p += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, p


def parse_track(b: bytes, p: int, end: int):
    """-> [(delta, op, args)] up to and including the first END; raises on malformed data."""
    ev = []
    while p < end:
        dt, p = read_vlq(b, p)
        op = b[p]
        p += 1
        args = []
        for k in SPEC.get(op, ""):
            if k == "b":
                args.append(b[p])
                p += 1
            else:
                v, p = read_vlq(b, p)
                args.append(v)
        ev.append((dt, op, tuple(args)))
        if op == END:
            break
    return ev


def bgm_sequences(b: bytes):
    """Yield the 'BGM ' sequences of fid 00472: dict(off, id, wd, ppqn, len, tracks=[(start, end)])."""
    pos = 0
    while pos + 0x20 <= len(b):
        if b[pos : pos + 4] == b"BGM ":
            sid, wid, tc = struct.unpack_from("<HHB", b, pos + 4)
            ppqn = struct.unpack_from("<H", b, pos + 0xE)[0]
            ln = struct.unpack_from("<I", b, pos + 0x10)[0]
            p = pos + 0x20
            tracks = []
            for _ in range(tc):
                if p + 4 > len(b):
                    break
                size = struct.unpack_from("<I", b, p)[0]
                tracks.append((p + 4, p + 4 + size))
                p += 4 + size
            yield dict(off=pos, id=sid, wd=wid, ppqn=ppqn, len=ln, tracks=tracks)
        pos += 0x800


def se_entry(b: bytes, e: int):
    """SE entry at offset e: u8 track count, u16 wave (bank) id, u16 ?, u16 sizes[count] (bit15 = flag). -> dict."""
    cnt = b[e]
    wave = struct.unpack_from("<H", b, e + 1)[0]
    sizes = [struct.unpack_from("<H", b, e + 5 + 2 * k)[0] & 0x7FFF for k in range(cnt)]
    p = e + 5 + 2 * cnt
    tracks = []
    for sz in sizes:
        tracks.append((p, p + sz))
        p += sz
    return dict(wave=wave, tracks=tracks, aux=(b[e + 3], b[e + 4]))


def seblock_entries(b: bytes):
    """fid 00474: 'SeBlock ' header; u32 offsets at +0x10 (index = system sfx id & 0x7fffffff), data after the table."""
    count = struct.unpack_from("<H", b, 10)[0]
    base = 0x10 + 4 * count
    out = {}
    for i in range(count):
        o = struct.unpack_from("<I", b, 0x10 + 4 * i)[0]
        if o != 0xFFFFFFFF:
            out[i] = base + o
    return out


def sep_files(b: bytes, ids):
    """SEP files embedded in an event script (bltz0000): 0x10-byte header with the decimal sfx id at +8 and the
    total size at +0xC, then an SE entry. -> {sfx id: entry offset}."""
    out = {}
    for i in ids:
        pat = struct.pack("<I", i)
        k = b.find(pat, 0x100000)
        while k >= 0:
            if k >= 8 and 0 < struct.unpack_from("<I", b, k + 4)[0] < 0x4000 and 1 <= b[k + 8] <= 16:
                out[i] = k + 8
                break
            k = b.find(pat, k + 1)
    return out
