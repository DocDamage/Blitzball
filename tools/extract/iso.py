"""ISO9660 directory walker for the FFX disc. Lists every file with LBA and size."""
import sys, json
from pathlib import Path
import pycdlib

ISO = Path(__file__).resolve().parents[2] / "Final Fantasy X (USA).iso"

def walk(iso_path=ISO):
    iso = pycdlib.PyCdlib()
    iso.open(str(iso_path))
    out = []
    for dirname, dirlist, filelist in iso.walk(iso_path="/"):
        for f in filelist:
            p = dirname.rstrip("/") + "/" + f
            rec = iso.get_record(iso_path=p)
            out.append({"path": p, "lba": rec.extent_location(), "size": rec.get_data_length()})
    iso.close()
    return out

if __name__ == "__main__":
    files = walk()
    for f in files:
        print(f"{f['lba']:>8} {f['size']:>12} {f['path']}")
    (Path(__file__).resolve().parents[2] / "data/raw").mkdir(parents=True, exist_ok=True)
    json.dump(files, open(Path(__file__).resolve().parents[2] / "data/raw/iso_files.json", "w"), indent=1)
