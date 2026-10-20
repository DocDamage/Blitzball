"""PS2 SPU-ADPCM (VAG) decoding and WAV writing."""
import struct
import wave

_F = [(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)]


def decode_blocks(data: bytes, start: int = 0, max_blocks: int | None = None):
    """Decode 16-byte SPU-ADPCM blocks from `start` until an end flag (bit0). Returns (samples, end_offset, loop_start_sample or None)."""
    out: list[int] = []
    h1 = h2 = 0
    pos = start
    loop_start = None
    n = 0
    while pos + 16 <= len(data):
        shift = data[pos] & 15
        filt = min((data[pos] >> 4) & 7, 4)
        flags = data[pos + 1]
        if flags & 4 and loop_start is None:
            loop_start = len(out)
        f0, f1 = _F[filt]
        for i in range(14):
            byte = data[pos + 2 + i]
            for nib in (byte & 15, byte >> 4):
                s = nib - 16 if nib >= 8 else nib
                v = (s << 12) >> shift if shift <= 12 else (s << 12) >> 9
                v = v + ((h1 * f0 + h2 * f1 + 32) >> 6)
                v = max(-32768, min(32767, v))
                out.append(v)
                h2, h1 = h1, v
        pos += 16
        n += 1
        if flags & 1 or (max_blocks and n >= max_blocks):
            break
    return out, pos, loop_start


def write_wav(path: str, samples: list[int], rate: int) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
