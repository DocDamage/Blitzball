# Progress log

Autonomous session started 2026-10-20 (night). Repo: https://github.com/DocDamage/Blitzball

## Milestone 0 - setup: DONE
Git repo, `.gitignore` (ISO, bios, raw dumps, art never committed), Python venv `tools/.venv`, Vite + TypeScript + Three.js +
vitest + Biome scaffold in `game/`, `.claude/launch.json` (`game` config, port 5173).

## Milestone 1 - extraction: data DONE, 2D art PARTIAL, 3D models deferred (fallback chosen)
* Hidden file table at ISO LBA 0x118 cracked (16,141 entries), LZ compression (two variants) fully decoded, every file
  dumped to `data/raw/files/` (gitignored). Notes with evidence: `tools/docs/formats.md`.
* FFX text encoding derived; ATEL event scripts parsed; FFXDataParser (patched) decompiles them.
* `data/json/players.json` (60 players: names, growth curves, learnable technique tiers), `techniques.json` (60),
  `teams.json`, `rosters.json` (new-game rosters, levels, EXP, contracts, salaries, equipped techniques) all regenerate
  from the disc via `tools/extract/*.py`. Growth formula validated against 473/480 community level-99 values.
* Match rule formulas: being extracted from the decompiled match script into `tools/docs/formulas.md`.
* 2D art: texture formats decoded for two container types (`data/art/`), battle HUD + some Blitzball menu screens
  recovered; Blitzball portraits/logos not yet located (see `tools/docs/models.md`).
* 3D: model packs are pointer-relocated VU1 data; time-box session 1 spent, fallback (rebuilt low-poly) in use.

## Milestone 2 - simulation core: DONE
`game/src/sim/`: fixed-step headless match, seeded RNG, utility AI, formations/marking, statuses, techniques, techcopy,
event log, stats. 19 tests pass; a full match simulates in ~0.2 s.

## Milestone 3 - 3D presentation: DONE
`game/src/render` (stadium, water, crowd, procedural swimmers, cameras, VFX), `game/src/game` (fixed-step runtime, arcade /
tactical-pause / pure-action control modes), `game/src/input` (keyboard, mouse, gamepad, rebinding), `game/src/ui/hud`.
Dev entry: `game/dev-match.html?mode=arcade|tactical|action&watch=1`.
## Milestone 4 - league layer: DONE
`game/src/league` + `game/src/data` (seasons, tournaments, contracts, growth with the original EXP awards, IndexedDB saves)
and the app shell in `game/src/ui` (main menu, new game, team management, formation editor, scout, competitions hub,
standings, results, prizes, settings with key rebinding, save/load). Full career loop verified in the browser.
## Milestone 5 - polish: DONE for this session
Procedural Web Audio (crowd, water, whistle, impacts, technique stings, goal fanfare, UI, optional user music file),
fixed-step input (<50 ms), skip/fast-forward, instant AI-vs-AI simulation, gamepad + rebinding, UI scale, colourblind
palette, screen-shake and reduced-flash toggles, three difficulty levels (AI reaction/noise only).

## Not done / next
* PCSX2 in-game spot check of three players' stats (plan 4.2): validated against community level-99 data instead.
* Original Blitzball portraits, logos and 3D models (`tools/docs/models.md`); game uses rebuilt art.
* EXP-to-level thresholds are fitted to the new-game roster data (native code, not in the script).
* Mark Mode assignments are stored by the UI but not yet consumed by the simulation.
* Balance pass with real play-testing; the Aurochs score rarely at new-game levels (matches the original data).

## Open questions (plan section 10) - working assumptions
1. Story-only players: not in the roster (data has the 60 recruitable players only).
2. Economy: original salaries (cost per game) kept.
3. Half length: original 5 minutes default, shorter options in settings.
4. AI recruitment: AI teams re-sign/poach free agents between seasons (implemented in league layer).
5. Commentary: text ticker from the event log.
