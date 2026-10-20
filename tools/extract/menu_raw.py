"""Session 2: headerless 8-bit menu sheets of the 'system' module (mdg module 18, fids 406..433).
These are linear row-major 8-bit index images (confirmed visually); their CLUTs have not been located, so they are
written as grayscale PNGs (index value = brightness) to data/art/menu_raw/. Known contents:
  00422 512x256 party face portraits (128x128 x 8: Tidus, Yuna, Auron, Kimahri / Wakka, Lulu, Rikku, Seymour?)
  00423 512x256 aeon / extra portraits (Valefor.., Ixion?, Shiva?, Bahamut?, Anima?, Yojimbo, Magus sisters..)
  00424 256x128 64x64 small party portraits
  00429 512x416 Spira world map
  00416, 00417 256x256 battle/menu UI label sheets (HP/MP/Overdrive/... text and icons)
"""
from pathlib import Path
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/art/menu_raw"; OUT.mkdir(parents=True, exist_ok=True)
SHEETS = {"00422": 512, "00423": 512, "00424": 256, "00429": 512, "00416": 256, "00417": 256}
if __name__ == "__main__":
    for fid, w in SHEETS.items():
        b = (ROOT / f"data/raw/files/{fid}.bin").read_bytes()
        h = len(b) // w
        Image.fromarray(np.frombuffer(b[:w * h], dtype="uint8").reshape(h, w), "L").save(OUT / f"{fid}_{w}x{h}_idx.png")
        print(fid, w, h)
