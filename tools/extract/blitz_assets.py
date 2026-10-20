"""Bake the original Blitzball player models + match motions into game/public/ffx/blitz/ for the renderer.

Every player in data/json/players.json has a `modelIndex` (bltz0000 shared var 0x132). Indices 0..33 are the story
team members; they map onto the PC models (Tidus, Wakka) and the BLZ_* team NPC models extracted by Noesis
(type2, ids from FFXDataParser's models.csv; see tools/docs/models.md). Each model is baked with the matching motion
set from the match motion pack (fid 01604): Tidus/Wakka with their own sets, humans with 0x6004, Ronso with 0x6067,
Guado with 0x60CB. The NPC sets were authored for the generic bodies, so the renderer keeps only their bone
rotations (same skeleton topology, different proportions).

Free agents (modelIndex 34..54) have no Blitzball model; the renderer dresses them in their team's uniform.

Requires: Noesis extraction (see noesis_models.py) and data/raw/files/01604.bin.
Usage: python blitz_assets.py
"""

import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import blitz_motions as bm  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "game" / "public" / "ffx" / "blitz"

HUMAN, RONSO, GUADO = 0x6004, 0x6067, 0x60CB
# The Aurochs team models are rigged like the generic adult-female body: its motion set is the one whose bone order
# matches theirs (every other set contorts them)
AUROCHS = 0x600E

# modelIndex -> (Noesis model, motion set)
MODELS: dict[int, tuple[str, int]] = {0: ("type0/mdl0000", 0x0001), 1: ("type0/mdl0004", 0x0005)}
for base, first, count, motion in [
    (2, 107, 5, AUROCHS),  # Besaid Aurochs  BLZ_BSD172..176: Datto, Letty, Jassu, Botta, Keepa
    (7, 117, 5, HUMAN),  # Luca Goers      BLZ_LUCA182..186
    (14, 112, 5, HUMAN),  # Kilika Beasts  BLZ_KLK177..181
    (19, 131, 4, RONSO),  # Ronso Fangs    BLZ_RNS206..209
    (23, 122, 4, GUADO),  # Guado Glories  BLZ_GAD197..200
    (27, 126, 5, HUMAN),  # Al Bhed Psyches BLZ_ALBD201..205
]:
    for i in range(count):
        MODELS[base + i] = (f"type2/mdl{first + i:04d}", motion)
MODELS[32] = ("type2/mdl0172", GUADO)  # Nav Guado    BLZ_GAD278
MODELS[33] = ("type2/mdl0173", RONSO)  # Gazna Ronso  BLZ_RNS281

# The team models were built on several different generic bodies, and the match pack only has motions for a few of
# them, so most sets bend the team models out of shape (Noesis binds motions by bone index). These models take
# Tidus's motions instead, retargeted at load time by joint position (game/src/render/retarget.ts). The Ronso sets
# fit the Ronso team models and stay.
RETARGET_FROM_TIDUS = set(range(2, 19)) | set(range(23, 33))

# League team id (data/json/teams.json) -> uniform models for players without their own Blitzball model
UNIFORMS = {0: [7, 8, 9, 10, 11], 1: [14, 15, 16, 17, 18], 2: [27, 28, 29, 30, 31], 3: [19, 20, 21, 22, 33],
            4: [23, 24, 25, 26, 32], 5: [2, 3, 4, 5, 6]}

# Clip index per renderer action for each motion set. Every set stores the same choreography in its own order;
# these were identified by eye in game/anim-viewer.html (filmstrips) using the frame-count fingerprints as anchors.
CLIPS = {
    0x0001: {"idle": 0, "swim": 3, "carry": 9, "pass": 4, "shoot": 13, "tackle": 12, "block": 16, "catch": 15,
             "hit": 14, "celebrate": 22},
    0x0005: {"idle": 1, "swim": 0, "carry": 10, "pass": 5, "shoot": 13, "tackle": 11, "block": 21, "catch": 15,
             "hit": 14, "celebrate": 22},
    HUMAN: {"idle": 0, "swim": 7, "carry": 9, "pass": 2, "shoot": 12, "tackle": 8, "block": 4, "catch": 14,
            "hit": 13, "celebrate": 19},
    AUROCHS: {"idle": 0, "swim": 2, "carry": 6, "pass": 9, "shoot": 12, "tackle": 10, "block": 3, "catch": 14,
              "hit": 13, "celebrate": 19},
    RONSO: {"idle": 0, "swim": 1, "carry": 11, "pass": 10, "shoot": 12, "tackle": 8, "block": 4, "catch": 14,
            "hit": 13, "celebrate": 18},
    GUADO: {"idle": 0, "swim": 1, "carry": 10, "pass": 12, "shoot": 17, "tackle": 14, "block": 8, "catch": 19,
            "hit": 18, "celebrate": 15},
}


def main() -> None:
    players = json.loads((ROOT / "data" / "json" / "players.json").read_text())
    players = players["players"] if isinstance(players, dict) else players
    OUT.mkdir(parents=True, exist_ok=True)
    models = {}
    for idx, (model, motion) in sorted(MODELS.items()):
        key = f"m{idx:02d}"
        work = bm.WORK / "blitz" / key
        status = bm.bake(model, motion, work)
        print(key, model, f"{motion:04x}", status, flush=True)
        if status != "ok":
            continue
        dst = OUT / key
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir()
        for f in work.iterdir():
            if f.is_file() and f.suffix in (".gltf", ".bin", ".png", ".json"):
                shutil.copy(f, dst / f.name)
        layout = CLIPS[motion]
        clips = json.loads((dst / "clips.json").read_text())["clips"]
        models[str(idx)] = {
            "path": f"{key}/model.gltf",
            "source": model,
            "motionSet": f"{motion:04x}",
            "retarget": motion >= 0x1000,
            "actions": {a: clips[i] for a, i in layout.items()},
        }
        if idx in RETARGET_FROM_TIDUS:
            models[str(idx)]["retargetFrom"] = 0
    manifest = {
        "fps": bm.FPS,
        "models": models,
        "players": {str(p["id"]): p["modelIndex"] for p in players},
        "uniforms": {str(k): v for k, v in UNIFORMS.items()},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("wrote", OUT / "manifest.json", len(models), "models")


if __name__ == "__main__":
    main()
