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

## Session 2 (2026-10-20, second and final time-box session)

### Where the Blitzball UI art is NOT

* The four packs beside the Blitzball events (01604, 01622, 06878, 06896) are **motion packs**, not art. Corrected header:
  `u32 0, u32 entry_count, u32 0, u32 dir_offset`; directory entries are 20 bytes `{u32 0, u16 model_id, u16 0, u16 n, u16 n, u32 table_end}`.
  01604 = models 0001 (Tidus lo-res), 0005 (Wakka lo-res), 0065, 4029, 6004, 600E, 6067/6071 (Ronso blitzers), 60CB/60D5 (Guado
  blitzers) with 24-26 motions each; the per-model table rows are `{u16 motion_id, u16 model_id, u16 1, u16 0x0A, u32 off, u32 off+2}`.
  06878/06896 hold 6 models (0001, 0005, 0065, 4029, 6004, 600E) for the Luca scouting scenes.
* The menu events bltz0005/0006 and the match event bltz0000 draw **everything** through `Common.setSplashSprite(0x011B)`
  (55,626 calls in bltz0000). The sprite argument is a 0x60-byte shared-data struct (`00000346 00010001 ... 80808080`
  RGBA, a `(group, index)` word at +0x48, e.g. `0d000000`/`0b000100`); bltz0000 carries 32 such templates at file 0x470180.
  The pixel source behind those groups was not resolved this session (needs the native 0x011B handler).
* `textureSetImageBase/ClutBase/LoadImage` (0x505A/B/0x5071) and `set2DLayerTexture` (0x801D) are never called by the Blitzball scripts.
* `tools/extract/clutscan.py` (256-entry RGBA CLUT finder, log in `data/art/clutscan.log`) finds no CLUT in 01601/06875/06893/06731/04301
  nor in the four packs, so any art inside them is 16/32-bit or 4-bit.

### What was found (menu / system modules)

* mdg table (LBA 0x158, `int16[1024]`): module -> first fid. Relevant bases: 12 -> 00485 (events), 17 -> 09021 (character packs),
  18 -> 00406 (system sheets), 24 -> 00474, 37 -> 00434, 42 -> 00458, 48 -> 00358 (menu).
* Menu module 00358..00405: triplets {layout, textures, empty}. `00359/00362/00365/00368/00371` are **sprite layout files**
  (`u32 1, u32 group_count, u32 group_table_off, u32 sprite_table_off(0x24)`, sprite rects `{u16 u0,u16 u1,u16 v0,u16 v1,u16 page,u16 0xFFFF}`,
  group table rows `{u32 off, u16 count, u16 0xFFFF}` pointing at 312-byte runtime sprite records) and 00360/363/366/369/372 their
  format-A texture containers (already converted). 00366 is the Blitzball entry-fee/prize screen (map + "Entry Fee / Gil left").
* System module 00406..00433 holds **headerless linear 8-bit sheets** (converted to index-grayscale PNGs by
  `tools/extract/menu_raw.py` -> `data/art/menu_raw/`): 00422 and 00423 = 128x128 face portraits (party and aeons/extra),
  00424 = 64x64 party portraits, 00429 = 512x416 Spira map, 00416/00417 = UI word sheets. CLUTs for these were not found
  (00414 holds 4 CLUTs for other sheets; 00415/00421/00425 are 4-bit pixel data).
* 00374/00375 (menu module) and 00442/00454 (module 37) are GS-layout texture dumps: 00375 = 5 CLUTs then swizzled PSMT8 data,
  00442 = `{0, 96, 96, 0x580}` + 0x20-byte GS TEX0 descriptors at +0x60 (PSMT8 256x256 / 512x512 / 128x64 textures, TBP0 0x2F00..0x39F8,
  CBP 0x38E8..0x39FC) + CLUT handle list at +0x680. `tools/extract/gsswizzle.py` implements the public PSMT8 and PSMCT32->PSMT8
  layouts but neither produced a clean image on 00375 (block-scrambled output), so the dumps remain unconverted.
* **Blitzball player portraits (60 players), team logos and stat icons were not located.** The grayscale party portraits
  (00422/424) are the only portrait art recovered; they are not Blitzball-specific.

### Character model packs (format notes, no geometry decoded)

* Pack = memory image loaded at 0x01B00000; header = 16 absolute pointers (09024: +0x2FA0, +0x30B8, +0x30C0, +0x30C8, +0x31A8, +0x32A8,
  +0x32B0, +0xCCD0, 0 x7, +0x32B8). 92 in-pack pointers and 70 pointers into the resident 0x0026xxxx region in 09024.
* Textures inside the packs are 8-bit with 256-entry RGBA CLUTs (CSM1 order) found by clutscan.py: 09024 @0x31190/0x31590,
  09025 @0x324B0..0x33BE0 (6 CLUTs), 09026 @0x30520.., 09027 @0x2FF80.. (6), 09028 (7), etc. The pixel data is GS-swizzled and
  is referenced through the pointer table, so a converter needs the pointer table semantics plus a working PSMT8 de-swizzle.
* Blitzball player models are the lo-res PC models (0001 Tidus, 0005 Wakka) and NPC blitzers 6067/6071/60CB/60D5 (ids from 01604);
  fid = 09021 + sub-index where the model-id -> sub-index map lives in the executable (not extracted).

### Verdict

The 3D-model time box is **closed without a glTF**. Two sessions produced the pack layout, the motion-pack directory format,
CLUT locations and the Blitzball model ids, but no vertex/UV decoding and no verified texture de-swizzle. The game keeps the
Three.js fallback models. Remaining 2D leads, in order of promise: (1) the native handler of script call 0x011B
(find the Common call table in the ELF, resolve the `(group,index)` word to a texture source), (2) a verified PSMT8 de-swizzle
tested against 00442's TEX0 descriptors, (3) the executable-resident CLUTs for the 00422/00423/00424 portrait sheets.

## Session 3 (2026-10-20): solved with Noesis

Rich Whitehouse's Noesis (v4.474, free, `C:\Users\<user>\noesis`) has built-in FFX PS2 support (model/anim spec by
"revelation"). `Noesis64.exe ?cmode "<iso>" "<out>"` extracts the disc into `type0..type6/mdlNNNN.ffm` (+ `_aN.ffa`
motion banks); `tools/extract/noesis_models.py` converts them to glTF. Write `.gltf`: Noesis's `.glb` is its own format.
Model space is Y-down.

* type0 = party (0 Tidus, 1 Yuna, 2 Auron, 3 Kimahri, 4 Wakka, 5 Lulu, 6 Rikku, ...; 12-31 hi-res), type2 = textured
  NPCs, type4 = weapons (Wakka's blitzballs), type5 = props, type6 = untextured generic bodies.
* type2 index = position in FFXDataParser's models.csv 2xxx list minus 23 (minus 24 from 0x2116 on). Blitzball team
  models (BLZ_*): Aurochs 107-111, Kilika 112-116, Luca 117-121, Guado 122-125, Psyches 126-130, Ronso 131-134,
  Nav Guado 172, Gazna Ronso 173. players.json `modelIndex` 0..33 maps onto them (blitz_assets.py).
* The match motion pack (fid 01604) is an .ffa with 10 directory entries (Tidus 0001, Wakka 0005, generic bodies
  6004/600E/6067/6071/60CB/60D5, ...). Noesis only loads an .ffa named `mdlNNNN_aN.ffa` beside `mdlNNNN.ffm` whose
  directory ends the file, so `blitz_motions.py` carves one entry per file. Noesis binds motion channels by bone
  index without checking, so a set only works on models rigged in the same bone order: humans (Luca, Kilika,
  Psyches) take 6004, the Aurochs take 600E, Ronso 6067, Guado 60CB. Only bone rotations are kept (play in place).
* Each set stores the same choreography in its own clip order; the per-set action tables in `blitz_assets.py` were
  read off filmstrips (`game/anim-viewer.html`). Free agents (modelIndex 34..54) have no Blitzball model and wear their
  team's uniform models.
* Dev pages: `game/model-viewer.html?filter=type2/`, `game/anim-viewer.html?m=<baked dir>&rot=1&clip=all`,
  `game/char-test.html?players=0,1,2&action=swim&view=top`.

## Session 4 (2026-10-20): stadium, retargeting, sphere play volume

* Field maps are `MAP1` files (Noesis section 019). Slot 5 (`0x214365`) holds VIF streams: per batch a 10-qword
  header (GIF tag + A+D writes; the last TEX0 write is the one in effect, and it carries over to batches that set
  none), RGBA8 colours, UV16 (texels*16) and float xyz, as a triangle list (`tools/extract/vif.py`, `mapgeom.py`).
  Textures live in the texture-only `MAP1` file just before the geometry map: type-2 records `{1, DBP, DBW, PSM}` at
  +0x40 and pixels at +0x80 stored for a PSMCT32 upload (PSMT4/PSMT8 unswizzle formulas), type-3 = palette area,
  a 256-wide PSMCT32 image at 0x2080 read through the GS emulator (`gsmem.py`, CSM1 + CSA sub-palettes).
* The Luca stadium is file3064 (+ textures in file3063), found by fitting spheres to every map's mesh groups
  (`find_spheres.py`). `blitz_stadium.py` exports it; the water surface shell (radius ~62.4 map units) is lined up
  with the play sphere and everything inside the outer sphere (radius 80) is hidden.
* Team models whose bone order does not match a match motion set are driven by Tidus's motions retargeted by
  joint position at load time (`game/src/render/retarget.ts`); only the Ronso keep their own set.
* The sim's play volume is now a sphere (`POOL_RADIUS`, `FIELD_SCALE` 2.3, `SPEED_SCALE` 1.6); balance batch
  over 240 matches: 5.8 goals/match, 23.8 shots, 75% on target, 60% passes.

## Session 5 (2026-10-20): portraits and logos

Third pass at the 2D Blitzball art, still not found. Ruled out:
* Event files (`EV01`: script, shared data, SEP pack; no textures), the format-A texture containers anywhere in the dump
  (only the memory-card/prize screens), the system sheets 00416-00425 (party/aeon faces, word sheets), and module 37
  (00442 is the **Sphere Grid** texture dump: a mix of linear 128-wide and swizzled images, S.LVL, node icons).
* `imgmine.py` (block-smoothness scan over every dumped file for GS-layout images) only turns up audio and model data;
  exact-size headerless sheets (`00417/00422/00423/00416/00421`, model textures like 12134/13604) are the only linear 8-bit art.
* The EE call table for script calls was not located (the 342-entry tables at 0x552cc0/0x553220 are switch tables), so
  the native `setSplashSprite` handler and the splash texture source are still unresolved.
Model textures (type2 `modelN_tex00.png`) contain each blitzer's face, and are the only face art found.
`game/src/render/portraits.ts` therefore renders a head-and-shoulders view of each player's original model
(`game/portraits.html` shows the whole sheet). Free agents have no model; the two bent-pose Guado models (25, 26) are skipped.
No team logos were found (crests only exist as small details on the uniform textures).

### Executable pass for the splash texture source (same session; unresolved)
Using the PS2 SDK's own strings/shapes to label the US executable (the DocDamage/ffx decomp only names SDK symbols, and
for the JP SLPS build, so addresses were found by signature instead):
* `sceGsSetDefLoadImage` = `FUN_002d79d0` (its "too big size" message), `FUN_002d7bb8` is its StoreImage sibling; 22 and 8 callers
  respectively (0x103d08, 0x168110, 0x17e088, 0x19ed30, 0x283038, 0x28c210, 0x2cc118, ...). `FUN_00116eb0` builds a BITBLT
  header (TRXPOS/TRXREG). None of the callers has been tied to the splash sprites yet.
* The 342-entry pointer tables at 0x552cc0 / 0x553220 are switch tables inside the script condition evaluator (input state
  checks), **not** the call table; the 0x30b0d8 table is empty at 0x11B. The script call dispatch (ids 0x011B etc.) is still not found,
  so `setSplashSprite`'s handler remains unlocated.
* More data ruled out: 00434 = animated water caustic frames, 00454 = a second Sphere Grid dump (same layout as 00442),
  00479 = packed/compressed. `tools/extract/r5900dis.py` disassembles pointer-table targets.
Next idea: breakpoint-free approach via PCSX2 (`tools/pcsx2`): load a Blitzball save state and dump GS VRAM when the team menu is up.

### PCSX2 pass (same session): the Blitzball menus have no player portraits
With saves from GameFAQs (CodeBreaker .cbs / PS3 .PSV, converted with `mymcplus` into a PCSX2 card) the game was driven in PCSX2
(`C:\pcsx2`, keyboard bindings: arrows/WASD = d-pad/stick, K = Cross, L = Circle, I = Triangle, Enter = Start; hold keys ~0.25 s,
Tab toggles turbo). The "Luca - Blitz End" save is mid-story (no Blitzball yet); the late-game "Tower of the Dead" save has a
save sphere whose menu offers League / Tournament / Exhibition / Tutorial / Team Data. **Team Data -> player page is text only**
(name, level, team, contract, salary, stats, technique list; no portrait or logo), so the original probably has no 2D player
portraits there. Formation/League screens were not reached (input stopped responding after a state save).
Method that works for any screen: PCSX2 F1 save state -> `sstates/*.p2s` (zstd zip; `pip install zipfile-zstd`) ->
`GS.bin` is a 509-byte header + 4 MiB VRAM at offset **425** (found from the zero-run alignment) -> decode with
`tools/extract/gsmem.py` (`addr32` etc.). The HW renderer leaves the framebuffer area empty but textures are intact.
