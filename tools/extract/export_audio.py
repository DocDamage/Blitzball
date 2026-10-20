"""Render the game's real audio from the disc into game/public/ffx/audio/ (Ogg Vorbis + manifest.json).

* Blitzball match/menu sound effects: the SEP files embedded in the Blitzball event script (fid 01601), played by the
  sequencer + sound banks (see tools/docs/sound.md). Cue -> sfx id choices come from the script context (shots and
  tackles sit next to the TIDU_/WAKK_BZ_SHOT*/TACL* motions, 89227 plays when a goal is scored, ...).
* UI sounds: the SeBlock (fid 00474) entries 1..4 (cursor, confirm, cancel, error) and the level-up chime.
* Music: 'BGM ' sequences (fid 00472) rendered through their WD banks, with the loop markers of the music data.

Requires ffmpeg on PATH. Usage: python export_audio.py
"""
import json
import os
import re
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import sndrender as r  # noqa: E402
import sndseq as sq  # noqa: E402

OUT = os.path.join(r.ROOT, "game", "public", "ffx", "audio")

# cue -> list of variants. kind: "sep" (event-script SEP by sfx id) | "se" (SeBlock index)
# trim: drop the leading quiet part so the sound starts at its first audible event (the originals are timed to a
# motion that begins before the impact)
SFX = {
    "goal": [("sep", 89227, {})],
    "goal-swell": [("sep", 89226, {})],
    "kickoff": [("sep", 91233, {})],
    "half-time": [("sep", 91235, {})],
    "full-time": [("sep", 91232, {})],
    "shot": [("sep", 90119, {}), ("sep", 90120, {})],
    "shot-power": [("sep", 91148, {}), ("sep", 90158, {})],
    "shot-release": [("sep", 90159, {"trim": True}), ("sep", 90160, {"trim": True})],
    "tackle": [("sep", 90164, {"trim": True}), ("sep", 90166, {"trim": True}), ("sep", 90165, {"trim": True})],
    "technique": [("sep", 90161, {}), ("sep", 90162, {}), ("sep", 90163, {})],
    "techcopy": [("sep", 90169, {})],
    "cheer": [("sep", i, {}) for i in (81047, 81048, 81049, 81050, 81051, 81052)],
    "crowd-roar": [("sep", i, {}) for i in (81053, 81054, 81055)],
    "crowd-gasp": [("sep", 84116, {})],
    "ui-click": [("se", 1, {})],
    "ui-confirm": [("se", 2, {})],
    "ui-back": [("se", 3, {})],
    "ui-error": [("se", 4, {})],
    "new-game": [("se", 5, {})],
    "level-up": [("se", 23, {})],
}

# name -> BGM sequence id (FFXDataParser's bgm enum: 0x1B Blitz Off!, 0x18 The Blitzers, ...)
MUSIC = {
    "blitz-off": 0x1B,
    "the-blitzers": 0x18,
    "face-off": 0x23,
    "luca": 0x93,
    "victory": 0x8A,
    "game-over": 0x8C,
}

SFX_RMS = 0.12  # target RMS of the loud part, before per-cue gain
MUSIC_RMS = 0.16


def encode(path, audio_i16, q=4):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(r.RATE), "-ac", str(audio_i16.shape[1]),
           "-i", "-", "-c:a", "libvorbis", "-q:a", str(q), path]
    subprocess.run(cmd, input=audio_i16.tobytes(), check=True)


def leveled(audio, rms_target, peak_cap=0.97):
    loud = audio[np.abs(audio).max(axis=1) > 0.05 * np.abs(audio).max()]
    rms = float(np.sqrt((loud**2).mean())) if len(loud) else 1.0
    g = rms_target / max(rms, 1e-6)
    pk = float(np.abs(audio).max()) * g
    if pk > peak_cap:
        g *= peak_cap / pk
    return audio * g


def trim_lead(audio, frac=0.35, pre=0.02):
    env = np.abs(audio).max(axis=1)
    k = int(0.005 * r.RATE)
    sm = np.convolve(env, np.ones(k) / k, mode="same")
    on = int(np.argmax(sm > frac * sm.max()))
    return audio[max(0, on - int(pre * r.RATE)) :]


def main():
    b_ev = open(os.path.join(r.FILES, "01601.bin"), "rb").read()
    b_se = open(os.path.join(r.FILES, "00474.bin"), "rb").read()
    b_bgm = open(os.path.join(r.FILES, "00472.bin"), "rb").read()
    text = open(os.path.join(r.ROOT, "data", "raw", "bltz0000_decomp.txt"), encoding="utf8", errors="replace").read()
    ids = sorted(set(int(m) for m in re.findall(r"sfx=sfx:(\d+)", text)))
    seps = sq.sep_files(b_ev, ids)
    ses = sq.seblock_entries(b_se)

    manifest = {"sfx": {}, "music": {}, "rate": r.RATE}
    for cue, variants in SFX.items():
        files = []
        for kind, ident, opt in variants:
            if kind == "sep":
                audio, info = r.render_se(b_ev, seps[ident])
            else:
                audio, info = r.render_se(b_se, ses[ident])
            if opt.get("trim"):
                audio = trim_lead(audio)
            audio = leveled(audio, SFX_RMS)
            name = f"sfx/{kind}{ident}.ogg"
            encode(os.path.join(OUT, name), r.to_int16(audio, 1.0))
            files.append({"file": name, "duration": round(len(audio) / r.RATE, 3)})
            print(cue, kind, ident, "%.2fs" % (len(audio) / r.RATE), flush=True)
        manifest["sfx"][cue] = files

    seqs = {s["id"]: s for s in sq.bgm_sequences(b_bgm)}
    for name, sid in MUSIC.items():
        audio, info = r.render_bgm(b_bgm, seqs[sid])
        audio = leveled(audio, MUSIC_RMS)
        fn = f"music/{name}.ogg"
        encode(os.path.join(OUT, fn), r.to_int16(audio, 1.0))
        manifest["music"][name] = {
            "file": fn,
            "duration": round(len(audio) / r.RATE, 3),
            "loopStart": None if info["loop_start"] is None else round(info["loop_start"], 4),
            "loopEnd": None if info["loop_end"] is None else round(info["loop_end"], 4),
        }
        print("music", name, info, flush=True)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)


if __name__ == "__main__":
    main()
