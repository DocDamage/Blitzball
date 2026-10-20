# Sound: how FFX audio works and how the game gets it (session 5, 2026-10-20)

The game plays the disc's own sounds and music. Nothing third-party. `python tools/extract/export_audio.py` renders them
into `game/public/ffx/audio/` (Ogg Vorbis + `manifest.json`, gitignored like the models; needs ffmpeg and gcc).
Without those assets the engine falls back to its procedural cues.

## Where the data is
| fid | what |
|---|---|
| 00470 | 832 `'WD'` sound banks (ids 0..4500), 0x800-aligned: instruments -> key-split regions -> SPU-ADPCM samples |
| 00472 | 106 `'BGM '` music sequences (id = BGM id, e.g. 0x1B Blitz Off!, 0x18 The Blitzers, 0x8A Victory Fanfare) |
| 00474 | `SeBlock`: system sound effects (`sfx 0x8000000n` = entry n) |
| 01601 (bltz0000) | the Blitzball sound effects: SEP files embedded in the event script, decimal sfx ids (90117, 89227, ...) |
| 00471 | sparse `u32[5120]` bank id -> offset table (not needed for rendering) |

Other fids embed copies of banks (battle/field packs); bank ids match 00470.

## Sequencer (reverse-engineered from IOPSOUND.IRX)
The IOP driver's jump table (file offset 0x175a0 -> handlers 0x31b0..0x56fc, 128 entries) defines the opcodes; operand layouts
come straight from the handlers. `tools/extract/sndseq.py` has the table; every track of the music file and of the SeBlock
parses cleanly with it (1689 of 1691). Stream = `[VLQ delta][opcode][operands]`. Highlights:
* 0x10-0x13 note on (key/velocity, previous values reused), 0x18/0x1a note off, 0x20 program, 0x21 slot+program (SeBlock: slot
  0/1 = banks 0/1), 0x22/0x24/0x26 volume/expression/pan (0..127, centre 64), 0x23/0x25/0x27 slides (VLQ ticks, value),
  0x5c pitch bend, 0x5d bend range, 0x2c pitch slide, 0x3c sustain pedal, 0x04/0x05/0x06 track loops, 0x08/0x09 tempo.
* Music: ppqn 48, tempo = BPM byte; the conductor track has 0x02 (song loop start) / 0x03 (loop end) markers.
* Sound effects (SeBlock entries / SEPs): `u8 tracks, u16 wave(bank) id, u16 ?, u16 sizes[tracks] (bit 15 = flag)`, then the
  track streams. The driver ticks SE sequences at 240 Hz (one tick per main-loop call; BGM ticks accumulate tempo/300).
* SEP file = 0x10-byte header (sfx id at +8, total size at +0xC) + SE entry. The EE hands the area's SEP pack to the IOP
  (`REGIST SEP` in the area loader); Blitzball's live inside bltz0000.

## Banks and voices
`WD`: `+2 u16 id, +8 u32 instruments, +0xC u32 regions`, `u32 offsets[]` at +0x20, regions are 0x20 bytes
(`+1` first/last flags, `+4` sample offset, `+0xC` ADSR1/ADSR2 as SPU registers, `+0x12` fine tune, `+0x13` unity key =
`0x3a - raw`, `+0x14` key high, `+0x16` attenuation, `+0x17` pan). Samples start after the last region.
Pitch model (fitted, validated): `semitones = key - unity + (fine/256 - 0.5) + 12*log2(44100/48000)` against 48 kHz output —
across 20 music banks the measured fundamentals land within 0.08 semitones (std) of equal temperament
(`pitchfit.py`, `pitchcheck.py`). ADSR follows the SPU envelope maths (`spu_dec.c`). Reverb, vibrato/LFO opcodes and
the velocity/volume curves are approximations (linear), so the render is drier than the console's.

## Blitzball sfx ids (from the script context)
Shots play with `TIDU_/WAKK_BZ_SHOT0..3` (90119, 90120, 91148, 90158/90117), tackles with `*_BZ_TACL1..3` (90164, 90166,
90165), 89227 when a goal is scored, 81047-81055 are crowd reactions (worker w20), 90169 plays when a player gains EXP,
90161-63 sit before technique effects, 91232/33/35 are the match start/period sounds. `export_audio.py` has the cue table.

## Tools
`sndrender.py` (renderer), `sndseq.py` (format), `spu_dec.c` (ADPCM + voice), `export_audio.py`, `sndtest.py` / `bgmtest.py` /
`septest.py` (render to WAV), `wavsheet.py` (spectrogram sheets), `pitchfit.py` / `pitchcheck.py` (pitch validation).
Ghidra: `ExportHandlers.java` creates functions at jump-table targets and decompiles them.
Not rendered yet: the other 100+ music tracks (add ids to `MUSIC`), other SEP packs in area files, SPU reverb.
