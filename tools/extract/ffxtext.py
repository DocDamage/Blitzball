"""FFX menu/event text encoding (US charset).

Mapping below is the widely documented FFX US table; validated in this repo by locating team and player
names in the unpacked files (see tools/docs/formats.md, 'Text encoding').
  0x00 end, 0x03 newline, 0x30..0x39 digits, 0x3A..0x53 'A'..'Z', 0x54..0x6D 'a'..'z',
  0x6E..  punctuation (see TABLE).
"""
TABLE = {0x00: "\0", 0x03: "\n"}
for i in range(10): TABLE[0x30 + i] = chr(ord("0") + i)
for i in range(26): TABLE[0x3A + i] = chr(ord("A") + i)
for i in range(26): TABLE[0x54 + i] = chr(ord("a") + i)
PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ "
# Punctuation layout is confirmed per character as names are located; unknowns render as {xx}.
TABLE.update({0x6E: "!", 0x6F: '"', 0x70: "#", 0x71: "$", 0x72: "%", 0x73: "&", 0x74: "'", 0x75: "(", 0x76: ")",
              0x77: "*", 0x78: "+", 0x79: ",", 0x7A: "-", 0x7B: ".", 0x7C: "/", 0x7D: ":", 0x7E: ";", 0x7F: "<",
              0x80: "=", 0x81: ">", 0x82: "?", 0x83: "@", 0x84: "[", 0x85: "\\", 0x86: "]", 0x87: "^", 0x88: "_",
              0x89: "`", 0x8A: "{", 0x8B: "|", 0x8C: "}", 0x8D: "~", 0x8E: " "})

REVERSE = {c: b for b, c in TABLE.items() if len(c) == 1}

def encode(s: str) -> bytes:
    return bytes(REVERSE[c] for c in s)

def decode(b: bytes) -> str:
    out = []
    for x in b:
        if x == 0: break
        out.append(TABLE.get(x, "{%02x}" % x))
    return "".join(out)
