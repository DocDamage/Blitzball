# 3D models and remaining 2D art: time-box record

Date: 2026-10-20 (first extraction session)

## What was found

* Character packs (fid entries whose first u32 is `0x01B0xxxx`, e.g. 09021, 09024, 09025) are relocated memory images:
  the header is a table of absolute pointers into the pack's load address `0x01B00000` (pointer - 0x01B00000 = file offset)
  plus pointers into a shared region around `0x00268000` (common skeleton/animation tables resident in RAM).
  Geometry is VU1 packet data (DMA tags, `0x77777777` fillers seen in 06878/06896).
* Event resource packs beside the Blitzball events (01604, 01622, 06878, 06896; header `u32 0, u32 type, u32 0, u32 offset`)
  contain no 256-colour CLUTs; their textures are either 16-bit/32-bit or inside VU packets.
* 2D art recovered so far: memory-card screens and Blitzball gil/prize menus (`data/art/tex`), battle HUD and
  controller diagrams (`data/art/tex_raw`, fids 00377..00393). Blitzball portraits and team logos not yet located.

## Decision

Per plan section 4.4 the model format gets a two-session time box. Session 1 is spent; the pointer-relocated pack
layout is documented above but no geometry has been decoded. The game proceeds with the fallback: rebuilt low-poly
players, ball and sphere pool in Three.js, textured with original colours. Session 2 of the time box (model packs,
`0x01B00000` relocation, VU1 packet decoding) and the portrait hunt stay on the list and do not block gameplay.
