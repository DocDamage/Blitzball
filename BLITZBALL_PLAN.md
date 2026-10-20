# Blitzball: Standalone Game Plan

Status: planning document. Nothing in this plan has been built yet.
Date: 2026-10-20

---

## 1. Vision

A standalone, full-league Blitzball game built on the web, reimagined as a real-time 3D sports game that keeps FFX's stats, techniques, teams and league structure but removes the dead time of the original encounter system. Data and art are extracted from the player's own copy of Final Fantasy X (PS2, USA) for a personal fan project.

### Decisions locked in (from qualifying questions)

| Topic | Decision |
|---|---|
| Scope | Full league: matches, teams, recruitment, scouting, player growth, leagues, tournaments, saves |
| Mechanics | Real-time reimagining. All three control modes selectable from the menu (see section 5.3) |
| Platform | Web, TypeScript, Vite |
| Rendering | 3D with Three.js |
| Players | Single-player vs AI |
| Assets | Extract data and art from the ISO. Rebuilt fallbacks where formats resist |
| Milestone order | Extraction first: data, then 2D art, then 3D models |
| Emulator | PCSX2 may be run for live memory inspection and verification |

### Machine inventory (checked 2026-10-20)

| Tool | Status |
|---|---|
| Python | 3.10.11 (`python`), 3.12.10 (`python3`) |
| Node / npm / pnpm | 24.14.1 / 11.12.1 / 10.33.0 |
| git | 2.55.0 |
| PCSX2 | Installed at `C:\Program Files\PCSX2` |
| 7-Zip | Not installed (not required; ISO will be parsed in Python) |
| Disc | `Final Fantasy X (USA).iso`, 4.5 GB, ISO9660 volume `FINAL_FANTASY_X`, PS2 BIOS files in `bios/` |

---

## 2. Repository layout

```
FFX Project/
  BLITZBALL_PLAN.md          this file
  Final Fantasy X (USA).iso  never committed (.gitignore)
  bios/                      never committed
  tools/
    extract/                 Python: ISO reader, archive unpackers, table dumpers
    pcsx2/                   PINE/debugger scripts, savestate notes, memory maps
    docs/                    reverse-engineering notes, offsets, format write-ups
  data/
    raw/                     dumped binaries from the disc (gitignored)
    json/                    canonical game data: players, teams, techniques, curves
    art/                     extracted textures, portraits, UI (gitignored, personal use)
  game/
    package.json             Vite + TypeScript + Three.js
    src/
      sim/                   deterministic match simulation, no rendering imports
      render/                Three.js scene, camera, characters, VFX
      ui/                    HUD, menus, league screens
      league/                season, rosters, contracts, growth, saves
      ai/                    match AI and league AI
      input/                 keyboard, mouse, gamepad
      data/                  typed loaders for data/json
    public/
```

Rule: `sim/` never imports from `render/` or `ui/`. The simulation must run headless at a fixed timestep so it can be unit tested and later made deterministic for replays or networking.

---

## 3. Milestone 0: Project setup

1. `git init`, `.gitignore` for the ISO, `bios/`, `data/raw/`, `data/art/`, `node_modules/`.
2. Python virtual environment under `tools/` with `pycdlib` (ISO9660), `pillow` (image conversion), `numpy`. Fallback: hand-written ISO9660 reader if pycdlib misbehaves on PS2 discs.
3. `game/` scaffolded with `pnpm create vite` (vanilla-ts), add `three`, `@types/three`, `vitest`.
4. Decide formatting and lint: Biome or ESLint + Prettier.
5. Launch config so the dev server previews in this app.

Done when: repo exists, `pnpm dev` shows an empty Three.js scene, `pytest` runs an empty test.

---

## 4. Milestone 1: Extraction

### 4.1 Disc and container formats

1. Parse the ISO9660 directory tree, list every file with LBA and size.
2. Identify the executable (`SLUS_203.12` expected) and `SYSTEM.CNF`.
3. Identify the data container(s). FFX on PS2 stores most content in large packed files addressed by an internal file table rather than by individual disc files. Expected work:
   - Locate the file table (likely referenced from the ELF, pointing at sector offsets).
   - Write an unpacker that splits the container into numbered entries.
   - Classify entries by magic bytes: TIM2 images (`TIM2`), compressed blobs (FFX uses an LZS variant), model and animation packs, text tables, event scripts.
4. Document every discovered format in `tools/docs/formats.md` with offsets and evidence.

### 4.2 Data tables (first)

Target output is `data/json/` with these files:

| File | Contents |
|---|---|
| `players.json` | All 60 recruitable players plus story-only players: name, home team, starting stats, growth curve per stat, learnable techniques, key techniques, initial level, salary |
| `teams.json` | Besaid Aurochs, Luca Goers, Al Bhed Psyches, Kilika Beasts, Ronso Fangs, Guado Glories: starting rosters, formation, colors |
| `techniques.json` | Every shot, pass, tackle, block, catch and passive technique: type, cost, stat modifiers, status inflicted, duration, techcopy availability, acquisition (learn, prize) |
| `statuses.json` | Poison, sleep, wither and others: effect per tick, durations |
| `growth.json` | Level-to-stat curves and experience-per-level table |
| `prizes.json` | League and tournament prize tables, including the Jecht Shot sphere, Attack Reels, Status Reels, Aurochs Reels, Wakka's Sigil and other rewards |
| `formulas.md` | Contest resolution (EN vs EN, AT vs BL, SH vs CA), shot speed, pass accuracy, movement speed, HP drain, experience awards, written as reproducible formulas with evidence |

Locating strategy:

1. Search the ELF and unpacked entries for ASCII player and team names (Tidus, Wakka, Datto, Letty, Jassu, Botta, Keepa, Bickson, Graav, Abus). FFX text may use its own character table rather than ASCII; if ASCII search fails, derive the encoding from the font table and search again.
2. Use the reverse-engineering tools available in this session (MIPS R5900 ELF: strings, cross-references, decompilation) to find the code that reads stat tables, then walk back to the table base address.
3. Run the game in PCSX2, enter Blitzball, and use the debugger plus savestates to find live player structures by searching for known stat values (for example a starting player's level-1 HP, EN and AT). Diff two savestates after a known change (one level up, one technique learned) to confirm field layouts.
4. Cross-check against community documentation of FFX Blitzball stats; treat it as a hint, never as the source.
5. Every table dump is produced by a script in `tools/extract/`, never by hand editing, so the dump can be regenerated.

Done when: `players.json`, `teams.json`, `techniques.json` and `growth.json` regenerate from the ISO with one command and match the in-game Blitzball menu for at least three spot-checked players.

### 4.3 2D art (second)

1. Portraits for all Blitzball players (menu face icons).
2. Blitzball UI: stat icons, team logos, scoreboard elements, cursor, frames.
3. Stadium and pool textures (Luca stadium water, stands, sphere pool shell).
4. Technique and status icons.
5. Font glyphs if the FFX menu font is wanted.

Format expectation: TIM2 (`.tm2`) with 4-bit and 8-bit CLUT variants, possibly swizzled. The converter outputs PNG into `data/art/` with a manifest JSON mapping each source entry to its output file.

Done when: a gallery page in the dev build shows every portrait, logo and icon with its source entry id.

### 4.4 3D models and animations (third, highest risk)

1. Player models (one per team body type plus named characters), the Blitzball itself, the Luca sphere pool and stadium.
2. Animations: swim idle, swim move, pass, shoot, tackle, block, catch, hit reaction, goal celebration.
3. PS2 FFX models are stored as VU1-targeted vertex packets with skinning data. Plan: document the format, write a converter to glTF (geometry, UVs, bone weights, skeleton, animation tracks).
4. Fallback if the format is not cracked within the time box: low-poly rebuilt characters made with the connected art tools, textured with the extracted 2D art. Gameplay must never wait on this.

Time box: two working sessions on model formats before switching to the fallback. The decision is recorded in `tools/docs/models.md`.

Done when: at least one player model and the sphere pool load as glTF in Three.js with a playing swim animation, or the fallback decision is recorded.

---

## 5. Milestone 2: Match simulation core

### 5.1 Architecture

- Fixed timestep (60 Hz) simulation in `game/src/sim/`, pure TypeScript, no DOM or Three.js.
- Entity model: `Player` (team, position, velocity, facing, stats, current HP, statuses, cooldowns, has ball), `Ball` (position, velocity, carrier, in-flight state), `Match` (clock, score, half, possession, event log).
- Seeded random number generator so a match replays identically from the same seed and inputs.
- Event log (pass, shot, tackle, goal, status applied) feeds HUD, commentary text, stats and replays.

### 5.2 Mapping FFX stats to real-time play

| FFX stat | Real-time role |
|---|---|
| HP | Stamina pool. Drains with sprinting, tackling and techniques. Low HP slows the player, as in FFX. Refills at half time |
| EN (endurance) | Breakthrough resistance when tackled while carrying |
| AT (attack) | Tackle strength, compared against carrier EN |
| PA (pass) | Pass speed and accuracy, compared against defender BL on interceptions |
| BL (block) | Interception reach and strength against PA |
| SH (shoot) | Shot speed and power, compared against keeper CA |
| CA (catch) | Keeper save radius and reaction |
| SP (speed) | Swim speed |

Contests resolve instantly with FFX-style comparison plus a small seeded random spread, so stats remain meaningful while the game never stops.

### 5.3 Three control modes (menu option)

1. **Arcade sports hybrid**: free movement; buttons for pass, shoot, tackle, sprint; techniques on a hotbar with HP cost and cooldown; a brief slow-motion window (about 0.4 s) on contested shots and tackles to make outcomes readable.
2. **Real-time with tactical pause**: same movement, but any contact or technique opens a radial menu that freezes time until the player picks (pass target, shoot, breakthrough, technique). Closest to the original decision flavor with none of its waiting.
3. **Pure action**: no slow-motion, no pauses. Stats only scale speed, power, accuracy and reach.

All three share the same simulation; the mode only changes how input is gathered and whether the time scale is altered. The mode is a single setting read by the input layer.

### 5.4 Rules

- Two halves of five minutes with half time; overtime rule configurable.
- Goals, out-of-pool resets, kickoff after goals, keeper possession rules.
- Status effects: poison (HP drain), sleep (cannot act), wither (stat reduction), others as found in extraction.
- Techniques and techcopy: a player can learn a technique by witnessing it in a match when it is marked as techcopy-able; the AI uses techniques according to its own roster.
- Marking and formations: assign defenders to opposing players; formation presets selectable before kickoff and at half time.

### 5.5 Match AI

- Utility-based per-player AI: evaluate pass lanes, shot quality, tackle opportunity, positioning relative to formation and marks.
- Team-level tactics by difficulty and team personality (Goers aggressive, Psyches technical, Fangs physical, and so on).
- Deterministic given the seed.

Done when: a full match runs headless in a test with two AI teams, produces a score and an event log, and the same seed replays identically.

---

## 6. Milestone 3: 3D presentation

- Three.js scene: sphere pool (transparent water shader, refraction, bubbles), stadium, crowd impostors, lighting matching Luca.
- Camera: broadcast follow camera with smoothing, zoom on contests and goals, optional top-down tactical camera.
- Characters: glTF skinned meshes with an animation state machine (idle, swim, sprint, pass, shoot, tackle, block, catch, hit, celebrate). Blend transitions.
- VFX: technique effects (Jecht Shot spin, Sphere Shot glow, Venom Pass trail, Nap Shot), goal flash, status particles.
- HUD: score, clock, possession, selected player, HP bar, technique hotbar, mark indicators, mode-specific prompts.
- Performance target: 60 fps on a mid-range laptop GPU at 1080p; 30 fps floor on integrated graphics.

Done when: a match is playable end to end in 3D with HUD in all three control modes.

---

## 7. Milestone 4: League layer

- Teams and rosters: six teams, eight players each (six starters, two reserves), plus a free agent pool of players found around Spira in the original, represented here as a scouting list with locations as flavor.
- Contracts: sign players for a number of games at a salary, as in FFX. Contracts expire and players may be poached by AI teams.
- Player growth: experience from match actions, level-ups applying extracted growth curves, technique learning through techcopy and level.
- Competitions: exhibition, league (ten games), tournament (three rounds), with prize tables from extraction. Season calendar with AI teams playing each other, standings, stats leaders.
- Scouting: view any player's stats and techniques, compare with the current roster, see contract status.
- Save system: IndexedDB with a versioned schema, multiple slots, autosave after each match.
- Menus: main menu, team management, formation editor, scout, standings, settings (control mode, difficulty, match length, camera, audio, key bindings).

Done when: a full season can be played from new game to league champion with saves.

---

## 8. Milestone 5: Responsiveness and polish

Responsiveness is a stated goal, so it gets explicit acceptance criteria:

- Input to visible reaction under 50 ms (one simulation tick plus one render frame).
- No animation locks longer than 250 ms that ignore input; every action is cancellable into movement.
- Every menu transition under 100 ms, no mandatory confirmation screens.
- Skip and fast-forward on any non-interactive sequence (goal replay, half time). AI-vs-AI league matches simulate instantly with a results summary.
- Gamepad, keyboard and mouse supported with rebinding; UI navigable without a mouse.
- Audio: crowd, water, whistle, technique sounds; music optional, user-supplied or extracted for personal use.
- Accessibility: colorblind-safe team colors, UI scale, screen-shake toggle, reduced flash.
- Difficulty levels affecting AI reaction time and tactics, never stat cheating.

---

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Container or table formats undocumented | Data extraction stalls | PCSX2 live memory path as a second route; hand-typed table as a last resort, flagged as such |
| Model format not cracked | No original 3D look | Time box of two sessions, then rebuilt low-poly characters with extracted textures |
| FFX text encoding is custom | String search fails | Derive the encoding from the font and menu text early |
| Real-time balance feels wrong with FFX numbers | Gameplay flat | Tunable mapping constants in one file; headless batch simulation to measure goals per match and contest win rates |
| Scope creep across league features | Never ships | Milestone gates above; each milestone ends with a playable build |
| Legal exposure | Project cannot be shared | Extracted assets stay local and gitignored; only code, format notes and original assets are shareable |

---

## 10. Open questions (decide during Milestone 1)

1. Story-only players (Tidus during the Luca match, Jecht in flashbacks) in the roster or not?
2. Keep contract salaries and the original economy, or simplify to a single currency?
3. Half length default: the original five minutes, or a shorter default with the original as an option?
4. Should AI teams recruit free agents between seasons, or stay static as in FFX?
5. Commentary: text ticker only, or voiced lines later?

---

## 11. Suggested session order

1. Milestone 0 setup (one short session).
2. ISO parse and container unpack (one session).
3. Data tables: ELF analysis plus PCSX2 verification (two to three sessions).
4. 2D art converter and gallery (one to two sessions).
5. Model format time box (two sessions, then decide).
6. Simulation core with headless tests (two to three sessions).
7. Three.js match presentation (three to four sessions).
8. League layer and saves (three to four sessions).
9. Polish and responsiveness pass (ongoing, final two sessions).
