"""Contact sheet (waveform + spectrogram per sample) for eyeballing decoded sound-bank samples.

usage: sfx_sheet.py out.png bank[:idx] ...   (a bare bank id shows every sample of that bank)
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RATE = 44100


def spectrogram(x: np.ndarray, w: int, h: int):
    n = len(x)
    if n < 256:
        return np.zeros((h, w))
    hop = max(1, (n - 256) // w)
    frames = [np.abs(np.fft.rfft(x[i : i + 256] * np.hanning(256))) for i in range(0, n - 256, hop)][:w]
    s = np.log1p(np.array(frames).T * 0.02)  # (129, t)
    s = s[::-1]
    img = np.zeros((h, w))
    ys = np.linspace(0, s.shape[0] - 1, h).astype(int)
    img[:, : s.shape[1]] = s[ys][:, :w]
    return img


def main():
    out = sys.argv[1]
    npz = np.load(os.path.join(ROOT, "data", "raw", "audio", "samples.npz"))
    keys = []
    for a in sys.argv[2:]:
        if ":" in a:
            keys.append(a.replace(":", "_"))
        else:
            keys += sorted((k for k in npz.files if k.split("_")[0] == a), key=lambda k: int(k.split("_")[1]))
    W, H, cols = 240, 90, 4
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * W, rows * (H + 14)), (16, 16, 24))
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        x = npz[k].astype(np.float32) / 32768
        ox, oy = (i % cols) * W, (i // cols) * (H + 14)
        sp = spectrogram(x, W - 4, H // 2)
        if sp.max() > 0:
            sp = (255 * sp / sp.max()).astype(np.uint8)
            sheet.paste(Image.fromarray(sp, "L").convert("RGB"), (ox + 2, oy + 14 + H // 2))
        # waveform envelope
        n = len(x)
        if n:
            seg = np.array_split(np.abs(x), W - 4)
            for j, s in enumerate(seg):
                v = int(s.max() * (H // 4)) if len(s) else 0
                d.line([(ox + 2 + j, oy + 14 + H // 4 - v), (ox + 2 + j, oy + 14 + H // 4 + v)], fill=(90, 200, 255))
        d.text((ox + 3, oy + 1), f"{k} {n / RATE:.2f}s", fill=(255, 255, 255))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
