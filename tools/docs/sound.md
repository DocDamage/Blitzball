# Sound: what is decoded, what is not (session 5, 2026-10-20)

The real game audio is on the disc; nothing third-party is needed. State of the extraction:

## Decoded
* **fid 00470** is a sound-bank archive: 730 banks, each starting 0x800-aligned with `'WD'`, `u16 bank id`, `u32 size`,
  `u32 count`, `u32 count`, ... A `u32[count]` offset list at +0x20 points at `count` 32-byte sample entries
  (`u32 0, u32 sample offset, u32 ?, u32 ADSR (ff00c85f ...), u32 ?, bytes 3c 7f 7f 40 = root key/vol/pan/...`).
  Sample data starts after the last entry. Samples are PS2 SPU-ADPCM (16-byte blocks, end flag in byte 1 bit 0, loop-start
  bit 2). `tools/extract/sfx_banks.py` decodes all 3,147 of them (`spu_dec.c` -> `spu_dec.dll` via gcc, ctypes) into
  `data/raw/audio/samples.npz` + `catalog.json` (duration, spectral centroid/flatness, loop block).
  `tools/extract/sfx_sheet.py out.png <bank|bank:idx>...` draws waveform + spectrogram contact sheets.
  Sample rate is not stored in the entry; 44.1 kHz (SPU pitch 0x1000) is the working assumption.
* Many banks are also embedded in other fids (battle/field packs); bank ids match.
* **fid 00471** is a sparse `u32[5120]` table, index = bank id, value = byte offset into **fid 00472** (`'BGM '` file,
  1.19 MB of AKAO-style sequence data: per-bank sequences/music).
* **fid 00474** is the `SeBlock` the EE sends to the IOP (`FUN_0024fc90`): `u32` size at +0x0c, `u32[121]` entry offsets at
  +0x18 (relative to +0x210). Each entry is a small multi-channel sequence (opcodes like 0x12 note, 0x20 program, 0x22,
  0x2e...), played by IOPSOUND.IRX's driver. System sfx ids `0x8000000n` index this table (n = entry).

## Not decoded (why the game still uses procedural audio)
* The sequence language (opcodes, how a note picks bank + sample, pitch tables, ADSR, loops) lives in the IOP driver
  (`IOPSOUND.IRX`, 141 KB) and is undocumented. Most bank samples are single-cycle loops or short instrument hits (a
  waveform-synth bank), so playing a sample raw does not reproduce an effect; the sequences are needed.
* Blitzball's own sfx ids (decimal 81047-81055, 84116, 89226/7, 90117-90169, 91148, 91232-5; `bltz0000`) are not
  `0x8000xxxx` SeBlock indices and the id -> bank/sequence mapping was not found (simple div/mod tests against the bank ids
  prove nothing). Next step would be to disassemble IOPSOUND.IRX (MIPS R3000) or the EE-side sound request code.
* Without a sequencer, picking samples by hand is guesswork (nothing here can be auditioned); the contact sheets show
  one-shot candidates (banks 997/998 impacts, 4500 noise beds and thumps) but they are not wired into the game.
