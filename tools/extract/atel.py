"""Minimal ATEL (FFX event script) reader: header, workers, variable declarations and their values.
Ported from FFXDataParser (AtelScriptObject.mapFields, ScriptWorker, ScriptVariable).
Event file (.ebp) layout: 'EV01' magic? then u32 chunk offsets at +4; chunk 0 = ATEL script.
"""
import struct, sys, json
from pathlib import Path

def u16(b, o): return struct.unpack_from("<H", b, o)[0]
def u32(b, o): return struct.unpack_from("<I", b, o)[0]

FORMAT_LEN = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 4}
FORMAT_SIGNED = {1: True, 3: True, 5: True}

class Script:
    def __init__(self, data: bytes, base: int):
        self.d = data; self.base = base  # script bytes start at base inside file
        s = base
        self.script_id = data[u32(data, s + 0x0C) + s:].split(b"\0")[0].decode(errors="replace")
        self.event_data_offset = u32(data, s + 0x20)
        self.namespace_count = u16(data, s + 0x34)
        self.workers = []
        for i in range(self.namespace_count):
            wo = u32(data, s + 0x38 + i * 4) + s
            w = {
                "index": i, "type": u16(data, wo), "var_count": u16(data, wo + 2),
                "var_decl_off": u32(data, wo + 0x14), "private_off": u32(data, wo + 0x2C), "shared_off": u32(data, wo + 0x30),
            }
            w["vars"] = []
            for vi in range(w["var_count"]):
                vo = w["var_decl_off"] + s + vi * 8
                lb = u32(data, vo); hb = u32(data, vo + 4)
                fmt = (lb >> 28) & 0xF; loc = (lb >> 25) & 0x7
                w["vars"].append({"index": vi, "offset": lb & 0xFFFFFF, "format": fmt, "location": loc,
                                   "count": hb & 0xFFFF, "elem_size": hb >> 16})
            self.workers.append(w)

    def var_values(self, w, v):
        if v["location"] == 3: base = w["private_off"]
        elif v["location"] == 4: base = w["shared_off"]
        elif v["location"] == 6: base = self.event_data_offset
        else: return None
        if base == 0: return None
        L = FORMAT_LEN[v["format"]]
        start = self.base + base + v["offset"]
        vals = []
        for i in range(v["count"]):
            o = start + i * L
            if o + L > len(self.d): break
            x = int.from_bytes(self.d[o:o + L], "little", signed=FORMAT_SIGNED.get(v["format"], False))
            if v["format"] == 6:
                x = struct.unpack_from("<f", self.d, o)[0]
            vals.append(x)
        return vals

def load_event(path):
    b = Path(path).read_bytes()
    c0 = u32(b, 4)
    return b, Script(b, c0)

if __name__ == "__main__":
    b, sc = load_event(sys.argv[1])
    print("script", sc.script_id, "workers", sc.namespace_count, "eventData", hex(sc.event_data_offset))
    minc = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    for w in sc.workers:
        for v in w["vars"]:
            if v["count"] >= minc:
                vals = sc.var_values(w, v)
                print(f"w{w['index']:02x} var{v['index']:03x} fmt{v['format']} loc{v['location']} n={v['count']} off={v['offset']:#x}: {vals[:40] if vals else vals}")
