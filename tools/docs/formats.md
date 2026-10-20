# FFX (PS2, USA, SLUS_203.12) container formats

All offsets below are virtual addresses in the ELF unless stated. ELF load base: vaddr 0x100000 at file offset 0x1000.
Decompiled reference: `data/raw/ghidra/all_functions.c` (Ghidra 12.1.4 headless, language MIPS:LE:64:default).

## Disc layout

* ISO9660 tree contains only the executable, IRX modules and SYSTEM.CNF (13 files, LBA 345..2931).
* Everything else is addressed by sector through a hidden file table ("fid" table) that is **not** in the directory tree.
* Streams (FMV and interleaved audio) are made of 2048-byte sectors starting with `VS\0\0`; header fields are
  `u16 "VS", u16 0, u32 0, u32 index, u32 remaining, u32 0x1000, u32 stream_id`.

## fid table (hidden file index)

* Loaded at boot by `FUN_001647c4` region: 0x20000 bytes read from absolute LBA 0x118 (280) into the pointer at
  `0x772158+0x28`. The sector base global (`0x30ae7c`) is zeroed first and entry 0 maps to LBA 345 = SLUS_203.12,
  so entries are absolute sectors.
* 16,141 used entries (the rest of the 0x8000 slots are zero), sorted by sector.
* Entry format (u32 LE), see `0x162900` and `0x1628c0`:
  * bits 0..21  : LBA (sector, 2048 bytes)
  * bit 22      : compressed (LZ stream, see below)
  * bits 23..31 : slack = number of unused 4-byte units in the last sector, rounded to 8 bytes.
    `byte_size = sectors*2048 - slack*4` where `sectors = next_entry.lba - lba`.
    Verified against the 13 ISO9660 files (e.g. SYSTEM.CNF 57 -> 64, MCSERV.IRX 7353 -> 7360).
* A second table ("mdg", module -> fid index, int16 LE) is read from LBA 0x158. Read by `0x162930`:
  `fid_index = mdg[module_id] + sub_index`.

## LZ compression (`FUN_002533f0` type 1, `FUN_002535c0` type 2)

Header: `u8 type (1|2)`, `u32 decompressed_size`. Tokens:

| byte b0 | meaning |
|---|---|
| 0x00 | end of stream |
| 0x01..0x7d | literal run of b0 bytes |
| 0x7e | RLE, `count = next+4`, `value = next` |
| 0x7f | RLE, `count = u16 LE`, `value = next` |
| 0x80..0xff, then b1 | back-reference. type 1: `len = ((b0>>3)&15)+3`, `dist = (((b0&7)<<8)|b1)+1`. type 2: `len = ((b0>>4)&7)+3`, `dist = (((b0&15)<<8)|b1)+1` |

A reference reaching before the start of the output produces zero bytes. 4545 type-1 and 2156 type-2 entries on
the USA disc all round-trip to their declared size (`tools/extract/lzs.py`).

## Tools

* `tools/extract/iso.py`     ISO9660 walker.
* `tools/extract/fid.py`     fid table reader and magic classifier -> `data/raw/fid_index.json`.
* `tools/extract/lzs.py`     decompressor.
* `tools/extract/unpack.py`  dumps every entry to `data/raw/files/<id>.bin` + `manifest.json`.
