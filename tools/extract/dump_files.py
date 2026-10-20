"""Copy the visible ISO9660 files into data/raw/disc/."""
from pathlib import Path
import pycdlib
from iso import ISO, walk
ROOT = Path(__file__).resolve().parents[2]
out = ROOT / "data/raw/disc"; out.mkdir(parents=True, exist_ok=True)
iso = pycdlib.PyCdlib(); iso.open(str(ISO))
for f in walk():
    name = f["path"].split("/")[-1].split(";")[0]
    with open(out / name, "wb") as fh:
        iso.get_file_from_iso_fp(fh, iso_path=f["path"])
    print(name, (out/name).stat().st_size)
iso.close()
