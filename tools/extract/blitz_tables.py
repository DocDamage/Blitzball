"""Generate data/json/*.json for Blitzball from the extracted disc files.

Sources (all located by tools/extract/scan.py, see tools/docs/formats.md):
  * fid 00410  menu macro text: player names (chunk1), technique/formation/team/prize names (chunk2)
  * fid 01601  event bltz0000, worker 0 shared data: growth tables (var 0x129..0x131), technique tables
               (var 0x136..0x139), player tables (var 0x132..0x135)
  * fid 06731  event bltz0200: technique descriptions (string 41+techId)
Growth formula (validated against 473/480 community level-99 values):
  x = level; mode 0: base + a*x ; mode 1: base + a*x^c ; mode 2: base + a*x - c*x^2 ; mode 3: base + a*x + c*x^2
  floor, then clamp to 9999 (HP) or 99 (others).
"""
import json, math, re, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from ffxtext import decode, read_string_table
from atel import load_event

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "data/raw/files"
OUT = ROOT / "data/json"

def table4(t):
    first = t[0] | t[1] << 8
    out = []
    for i in range(first // 4):
        off = t[i * 4] | t[i * 4 + 1] << 8
        e = t.find(b"\0", off)
        out.append(decode(t[off:e]))
    return out

def clean(s):
    """Keep only the effect text: drop the name/HP-cost header lines and control codes."""
    s = s.replace("{09}0", "").replace("{0a})", "").replace("{0a}'", "").replace("{0b}1", "the confirm button")
    s = re.sub(r"\{[0-9a-f]{2}\}\d?", "", s)
    lines = [l.strip() for l in s.splitlines() if l.strip()]
    lines = [l for l in lines if not l.startswith("HP Cost") and not l.startswith("Equip HP Cost") and l not in ("% chance", "100% chance")]
    return " ".join(lines).replace("  ", " ").strip()

def stat_at(p, level, hp=False):
    base, a, c, mode = p
    x = level
    if mode == 0: v = base + a * x
    elif mode == 1: v = base + a * (x ** c)
    elif mode == 2: v = base + a * x - c * x * x
    else: v = base + a * x + c * x * x
    v = math.floor(v + 1e-6)
    return max(0, min(9999 if hp else 99, v))

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    macro = (FILES / "00410.bin").read_bytes()
    names = table4(macro[0x630:0xC20])      # chunk 1
    misc = table4(macro[0xC20:0x1480])      # chunk 2
    player_names = ["Tidus", "Wakka"] + names[2:60]
    assert len(player_names) == 60, len(player_names)
    tech_names = misc[1:61]
    formation_names = misc[61:70]
    team_names = misc[70:76]            # Luca Goers, Kilika Beasts, Al Bhed Psyches, Ronso Fangs, Guado Glories, Besaid Aurochs
    prize_names = misc[86:90]

    _, sc = load_event(FILES / "01601.bin")
    w = sc.workers[0]
    V = lambda i: sc.var_values(w, w["vars"][i])
    growth = {"HP": V(0x129), "AT": V(0x12B), "EN": V(0x12C), "PA": V(0x12D), "SH": V(0x12E), "BL": V(0x12F), "CA": V(0x130), "SP": V(0x131)}
    model_idx = V(0x132); words_a = V(0x133); words_b = V(0x134); triple = V(0x135)
    tech_boost = V(0x136); tech_cost = V(0x137); tech_power = V(0x138); tech_flags = V(0x139)

    _, sc2 = load_event(FILES / "06731.bin")
    b2 = (FILES / "06731.bin").read_bytes()
    offs = [struct.unpack_from("<I", b2, 4 + i * 4)[0] for i in range(10)]
    c1 = offs[1]; end = min([o for o in offs[2:] if o and o > c1], default=len(b2))
    strs = read_string_table(b2[c1:end])

    players = []
    for i, n in enumerate(player_names):
        g = {k: {"base": t[i * 4], "a": t[i * 4 + 1], "c": t[i * 4 + 2], "mode": int(t[i * 4 + 3])} for k, t in growth.items()}
        players.append({
            "id": i, "name": n,
            "growth": g,
            "statsLv1": {k: stat_at(growth[k][i * 4:i * 4 + 4], 1, k == "HP") for k in growth},
            "statsLv99": {k: stat_at(growth[k][i * 4:i * 4 + 4], 99, k == "HP") for k in growth},
            "modelIndex": model_idx[i],
            # Learnable techniques in four tiers (bit b of page-1 word = tech b; bit b of page-2 word = tech 30+b).
            # Tier thresholds (3 levels) open tiers 2..4; tier 1 is available from the start. See formats.md.
            "learnableTiers": [sorted([b for b in range(1, 32) if (words_a[i * 4 + j] >> b) & 1] +
                                      [30 + b for b in range(2, 32) if (words_b[i * 4 + j] >> b) & 1]) for j in range(4)],
            "tierLevels": triple[i * 3:i * 3 + 3],
        })
    techniques = [{"id": 0, "name": "(none)"}]
    for t in range(1, 61):
        name = tech_names[t - 1]
        kind = ("shot" if "Shot" in name else "pass" if "Pass" in name else "tackle" if "Tackle" in name and "Slip" not in name
                else "evade" if "Slip" in name else "guard" if name.startswith("Anti-") else "passive")
        desc = clean(strs[41 + t]) if 41 + t < len(strs) else ""
        techniques.append({"id": t, "name": name, "kind": kind, "hpCost": tech_cost[t], "statBoost": tech_boost[t],
                           "chancePct": tech_power[t], "flags": tech_flags[t], "description": desc})
    json.dump({"formula": __doc__.split("Growth formula")[1].strip(), "players": players}, open(OUT / "players.json", "w"), indent=1)
    json.dump(techniques, open(OUT / "techniques.json", "w"), indent=1)
    json.dump({"teams": [{"id": i, "name": n} for i, n in enumerate(team_names)], "formations": formation_names, "prizes": prize_names},
              open(OUT / "teams.json", "w"), indent=1)
    print("players", len(players), "techniques", len(techniques) - 1, "teams", team_names)
    for p in players[:3]: print(p["name"], p["statsLv1"], p["statsLv99"])
    for t in techniques[1:6]: print(t)

if __name__ == "__main__":
    main()
