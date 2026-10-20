"""Spectrogram contact sheet of WAV files: wavsheet.py out.png a.wav b.wav ..."""
import os
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from sfx_sheet import spectrogram  # noqa: E402

W, H, cols = 320, 120, 3
files = sys.argv[2:]
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * W, rows * (H + 14)), (16, 16, 24))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    with wave.open(f) as w:
        ch, rate = w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    x = x.reshape(-1, ch).mean(axis=1)
    ox, oy = (i % cols) * W, (i // cols) * (H + 14)
    seg = np.array_split(np.abs(x), W - 4)
    for j, s in enumerate(seg):
        v = int(s.max() * (H // 4)) if len(s) else 0
        d.line([(ox + 2 + j, oy + 14 + H // 4 - v), (ox + 2 + j, oy + 14 + H // 4 + v)], fill=(90, 200, 255))
    sp = spectrogram(x, W - 4, H // 2)
    if sp.max() > 0:
        sp = (255 * sp / sp.max()).astype(np.uint8)
        sheet.paste(Image.fromarray(sp, "L").convert("RGB"), (ox + 2, oy + 14 + H // 2))
    d.text((ox + 3, oy + 1), "%s %.2fs" % (os.path.basename(f), len(x) / rate), fill=(255, 255, 255))
sheet.save(sys.argv[1])
