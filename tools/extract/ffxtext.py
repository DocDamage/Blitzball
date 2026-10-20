"""FFX menu/event text encoding (US charset).

Derived in this repo from the string chunk of event bltz0000 (fid 01601), where the bytes
63 7e 84 81 7d 70 7c 74 7d 83 3a 76 70 7c 74 82 read "Tournament games":
  0x00 end, 0x03 newline, 0x30..0x39 '0'..'9', 0x3A space, 0x50..0x69 'A'..'Z', 0x70..0x89 'a'..'z'.
Bytes 0x3B..0x4F and 0x8A.. are punctuation and control codes; unknown bytes render as {xx}.
Control codes seen: 0x07 xx (colour), 0x09 xx / 0x10 xx (choice/line markers), 0x12 xx (variable), 0x0a xx.
"""
TABLE = {0x00: "\0", 0x03: "\n", 0x3A: " "}
for i in range(10): TABLE[0x30 + i] = chr(ord("0") + i)
for i in range(26): TABLE[0x50 + i] = chr(ord("A") + i)
for i in range(26): TABLE[0x70 + i] = chr(ord("a") + i)
# punctuation guesses (confirmed where noted in formats.md)
TABLE.update({0x3B: "!", 0x3C: '"', 0x3D: "#", 0x3E: "$", 0x3F: "%", 0x40: "&", 0x41: "'", 0x42: "(", 0x43: ")",
              0x44: "*", 0x45: "+", 0x46: ",", 0x47: "-", 0x48: ".", 0x49: "/", 0x4A: ":", 0x4B: ";", 0x4C: "<",
              0x4D: "=", 0x4E: ">", 0x4F: "?"})

REVERSE = {c: b for b, c in TABLE.items() if len(c) == 1}

def encode(s: str) -> bytes:
    return bytes(REVERSE[c] for c in s)

def decode(b: bytes) -> str:
    out = []
    for x in b:
        if x == 0: break
        out.append(TABLE.get(x, "{%02x}" % x))
    return "".join(out)

def read_string_table(chunk: bytes):
    """FieldString table: count = u16@0 / 8; entry i = (u32 regular, u32 simplified) headers, low 16 bits = offset."""
    if len(chunk) < 8: return []
    count = (chunk[0] | chunk[1] << 8) // 8
    out = []
    for i in range(count):
        off = chunk[i * 8] | chunk[i * 8 + 1] << 8
        end = chunk.find(b"\0", off)
        out.append(decode(chunk[off:end if end >= 0 else len(chunk)]))
    return out
