# Blitzball

A standalone, full-league Blitzball game: Final Fantasy X's stats, techniques, teams and league structure, rebuilt as a
real-time 3D sports game for the web (TypeScript, Vite, Three.js). Game data is extracted from a personal copy of the
PS2 disc; extracted assets stay local and are never committed. See `BLITZBALL_PLAN.md` (plan) and `PROGRESS.md` (status).

## Run the game

```bash
cd game
pnpm install
pnpm dev
```

Open http://localhost:5173. `pnpm test` runs the headless simulation, league and UI tests; `pnpm build` produces `game/dist`.
`dev-match.html?mode=arcade|tactical|action&watch=1` starts a match directly.

Controls (rebindable in Settings): WASD/arrows move, R/F up/down, Shift sprint, Space pass, J shoot/tackle, K tackle,
Q switch player, E cycle pass target, 1-5 techniques, Esc pause, C camera, Enter skip. Gamepad supported.

## Regenerate the data from the disc

Place `Final Fantasy X (USA).iso` in the repo root (gitignored), then:

```bash
cd tools
python3 -m venv .venv && .venv/Scripts/python -m pip install pycdlib pillow numpy capstone
.venv/Scripts/python extract/unpack.py        # dumps every hidden file to data/raw/files (gitignored)
.venv/Scripts/python extract/blitz_tables.py  # data/json/players.json, techniques.json, teams.json
.venv/Scripts/python extract/init_state.py    # data/json/rosters.json (needs the FFXDataParser decompile, see docs)
.venv/Scripts/python extract/textures.py      # data/art (gitignored)
```

Format write-ups with evidence: `tools/docs/formats.md`, `tools/docs/formulas.md`, `tools/docs/models.md`.

## Layout

```
tools/extract   Python extractors (ISO walker, hidden file table, LZ, text codec, ATEL reader, table generators)
tools/docs      reverse-engineering notes
data/json       canonical game data (committed, regenerated from the disc)
game/src/sim    deterministic 60 Hz match simulation (no DOM, no Three.js)
game/src/render Three.js stadium, swimmers, cameras, VFX
game/src/game   match runtime: fixed-step loop, control modes, HUD glue
game/src/input  keyboard, mouse, gamepad, rebinding
game/src/ui     app shell, menus, league screens, HUD
game/src/league seasons, tournaments, contracts, growth, saves
game/src/data   typed loaders for data/json
```
