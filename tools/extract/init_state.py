"""Parse the new-game Blitzball initialisation from the decompiled event bltz0200 (fid 06731)
and write data/json/rosters.json: team rosters, starting level/EXP, tech slots, equipped techs,
contract durations and cost per game for all 60 players.
Input: data/raw/bltz0200_decomp.txt produced by FFXDataParser (PARSE_EVENT bltz0200).
"""
import json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
TXT = (ROOT / "data/raw/bltz0200_decomp.txt").read_text(encoding="utf-8", errors="replace")
TEAMS = ["Luca Goers", "Kilika Beasts", "Al Bhed Psyches", "Ronso Fangs", "Guado Glories", "Besaid Aurochs"]

def grab(name):
    """Return list of (index, value) for `Set name[index] = value [XXh]` lines (index may be a name with [XXh])."""
    out = []
    for m in re.finditer(r"Set " + name + r"\[(.*?)\] = (.*?) \[([0-9A-F]+)h\];", TXT):
        idx = m.group(1); val = int(m.group(3), 16)
        im = re.search(r"\[([0-9A-F]+)h\]$", idx)
        if im: i = int(im.group(1), 16)
        elif idx.isdigit(): i = int(idx)
        else: continue  # dynamic index (runtime code), not initial state
        out.append((i, val, m.group(2)))
    return out

roster = {}
for slot, val, label in grab("BlitzballTeamPlayers"):
    roster[slot] = None if val == 0x3C else val
players = {i: {"id": i} for i in range(60)}
for i, v, _ in grab("BlitzballPlayerCurrentLevel"): players[i]["level"] = v
for i, v, _ in grab("BlitzballPlayerCurrentEXP"): players[i]["exp"] = v
for i, v, _ in grab("BlitzballPlayerUnlockedTechSlots"): players[i]["techSlots"] = v
for i, v, _ in grab("BlitzballPlayerContractDurations"): players[i]["contractGames"] = v
for i, v, _ in grab("BlitzballPlayerCostPerGame"): players[i]["costPerGame"] = v
for p in players.values(): p["equippedTechs"] = [0] * 5; p["learnedTechsPage1"] = 0; p["learnedTechsPage2"] = 0
for i, v, _ in grab("BlitzballPlayerLearnedTechsPage1"): players[i]["learnedTechsPage1"] = v
for i, v, _ in grab("BlitzballPlayerLearnedTechsPage2"): players[i]["learnedTechsPage2"] = v
for i, v, _ in grab("BlitzballPlayerEquippedTechs"):
    players[i // 5]["equippedTechs"][i % 5] = v
for slot, pid in roster.items():
    if pid is not None:
        players[pid]["team"] = slot // 8; players[pid]["teamSlot"] = slot % 8
for p in players.values():
    p.setdefault("team", None); p.setdefault("teamSlot", None)
teams = [{"id": t, "name": TEAMS[t], "players": [roster.get(t * 8 + s) for s in range(8)]} for t in range(6)]
out = {"source": "event bltz0200 (fid 06731) new-game init", "teams": teams, "players": [players[i] for i in range(60)]}
(ROOT / "data/json/rosters.json").write_text(json.dumps(out, indent=1))
print(json.dumps(teams, indent=0)[:600]); print(players[0], players[45], players[57])
