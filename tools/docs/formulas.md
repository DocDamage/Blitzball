# FFX Blitzball match rules, reverse-engineered from `bltz0000` (ATEL)

Source: `data/raw/bltz0000_decomp.txt` (477,720 lines, FFXDataParser decompile of event `bltz0000`).
Line numbers below ("L12345") refer to that file. Results-screen facts come from `data/raw/bltz0200_decomp.txt` ("bltz0200 L...").
Cross-checked against `data/json/techniques.json` (tech ids / hpCost / statBoost / chancePct / flags).

Conventions:
- `rand(n)` = `Common.GetRandomInRange(maxExclusive=n)` (native, opcode 00A6h) -> integer in `[0, n-1]`.
- Divisions are integer divisions (stats are declared float[16] but hold integers after init).
- 16 match slots: 0..7 = Aurochs (slot 5 = Aurochs goalie), 8..15 = opponent (slot 13 = opponent goalie). `eventVar0F76` = ball-carrier slot, `eventVar10A5` = receiver/catcher slot, `eventVar10AE[i]` = i-th defender in the current encounter, `eventVar10A2` = number of defenders.
- "frame" = one `Common.wait(frames=1)`; the main match loop (`w24::f06`, L321125-321126) waits 1 frame per iteration. Whether a frame is 1/60 s or 1/30 s cannot be determined from the script (UNCERTAIN).
- The five field-player workers (w02..w06, w0A..w0E) are byte-identical copies; w02 line numbers are cited for them.

### Variable map (match-local arrays, index = slot)

| var | meaning | var | meaning |
|---|---|---|---|
| 0040 | HP max | 0080 | HP after passive-tech deductions ("effective max") |
| 00C0 | HP current | 12D2 | HP drain per tick (1; 4 poisoned; x4 Pile Venom) |
| 024C / 020C | AT max / current | 02CC / 028C | EN max / current |
| 034C / 030C | PA max / current | 03CC / 038C | SH max / current |
| 044C / 040C | BL max / current | 04CC / 048C | CA max / current |
| 050C | SP | 054C | poison timer |
| 058C 05CC 060C 064C 068C 06CC | wither timers (EN PA SH AT BL CA) | 1116 1126 1136 1146 1156 1166 | wither divisors (EN PA SH AT BL CA) |
| 070C 074C 078C 07CC 080C 084C | temporary stat override (EN PA SH AT BL CA) | 0C0C | Gamble timer (stats := 11F7..1247) |
| 0B8C | sleep timer | 0F7F | stun timer |
| 0E98 / 0EA8 | Anti-Venom chance / HP cost | 0EB8 / 0EC8 | Anti-Nap chance / cost |
| 0ED8 / 0EE8 | Anti-Wither chance / cost | 0EF8 / 0F08 | Anti-Drain chance / cost |
| 0F18 / 0E24 | Tackle Slip chance / cost | 0F28 / 0F38 | Volley Shot chance / cost |
| 0F48 / 0F58 | Brawler cost / chance | 1257 1176 1186 1196 11A6 11B6 11C6 11D6 11E6 | flags: Elite Defense, Pile Venom, Pile Wither, Hi-Risk, Golden Arm, Super Goalie, Regen (=3), Good Morning!, Gamble |
| 0028 / 002C / 0030 / 0034 | working EN / PA / SH / AT of the current contest | 0110 | current opposing roll |

Shared tables (worker 0 shared data, see L477110+ variable table): `sharedObj1A350` = var 0x129 HP growth; `1A710` = 0x12A (computed into eventVar01CC at L126 but never read: unused); `1AAD0` = 0x12B AT; `1B250` = 0x12C EN; `1B610` = 0x12D PA; `1B9D0` = 0x12E SH; `1BD90` = 0x12F BL; `1C150` = 0x130 CA; `1C8D0` = 0x131 SP (each 60 players x {base, a, c, mode}). Mapping confirmed by the wither code: divisor 1146 halves 020C/024C and the message is "'s AT is halved!" (L8509-8524, L8623-8624), 1116 -> 028C "EN", 1126 -> 030C "PA", 1136 -> 038C "SH", 1156 -> 040C "BL", 1166 -> 048C "CA".
`1D9B0` = tech statBoost, `1DB98` = tech chancePct, `1DAA4` = tech hpCost, `1DC8C` = tech flags (indexed by tech id). `1CE70` / `1D230` = 4 x u32 key-tech words per player (page 1 / page 2); `1D5F0` = 3 prerequisite tech ids per player.

---------------------------------------------------------------------------------------------------

## 1. Stat derivation from level (w00::init, L4-405)

For each of the 16 slots, `x = BlitzballPlayerCurrentLevel[player]`; per table entry `(base, a, c, mode)` (`sharedObj[p*4 + 0..3]`):

```
mode -1 : stat = 0                                               (L19)
mode  0 : stat = a*x + base                                      (L21)
mode  1 : stat = a*f(x) + base                                   (L23-49)
          c == 0.5  -> f = sqrt(x)                               (L24-25)
          c == 0.25 -> f = sqrt(sqrt(x))                         (L27-29)
          c == 0    -> table entry c := 2 (rewritten in place), then fall through   (L31-32)
          otherwise -> f = x; for (k = 1; k < c; k++) f *= x     (L33-43)   i.e. x^ceil(c) for non-integer c > 1
mode  2 : stat = a*x + base - c*x*x                              (L51)
mode  3 : stat = a*x + c*x*x + base                              (L53)
```
Clamp: HP `min(max(stat, 1), 9999)` (L63-66); every other stat `min(max(stat, 1), 99)` (L161-164, L201-204, ...). The intermediate is a float; storing into the int-typed slot truncates toward zero (= floor for positive values). Note: formats.md's "base + a*x^c" is exact only for c in {0.25, 0.5} or integer c; a fractional c like 1.5 gives x^2 because the loop runs for integer k < c.

HP: `0040 = 0080 = 00C0 = HP` (L68-70). Passive techs then pay their hpCost from `0080`/`00C0` at match start (L491-547, repeated after every encounter at L334680-334794 and L335332-335446): Elite Defense (flag 0x400, cost 5), Golden Arm (30), Pile Venom (30), Pile Wither (70), Hi-Risk (300), Regen (50). If HP < cost the tech is disabled (flag cleared) and HP set to 0.

Anti-* / Tackle Slip / Volley / Brawler: for all equipped techs with flag bit (2 Venom, 4 Nap, 8 Wither, 16 Drain, 128 Tackle Slip, 512 Volley, 2048 Brawler) the match keeps `max(chancePct)` and `max(hpCost)` over the equipped techs of that family (L461-501). Only the first `BlitzballPlayerUnlockedTechSlots[p]` entries of `BlitzballPlayerEquippedTechs[p*5 + k]` count (L457).

Stat refresh (run for each player every main-loop frame, L321230-321293, and after a status change, L8611-8674 / L337870-337933):
```
cur[s] = max[s]
if witherTimer[s] > 0: cur[s] = max[s] / divisor[s]          (divisor 2, or 4 with Pile Wither; section 4)
if HP(00C0) < PA: PA /= 2 ; if HP < SH: SH /= 2               (L8629-8632)
each of EN PA SH AT BL CA /= (1 + HiRisk)                     (Hi-Risk halves every stat, L8633-8638)
any stat == 0 -> 1                                            (L8639-8650)
if override[s] (070C..084C) > 0: cur[s] = override[s]         (L8651-8662, Good Morning!, section 5)
if GambleTimer (0C0C) > 0: cur[s] = 11F7..1247[s]             (L8663-8674, random values, section 5)
```
Flags `0E78[p] = (HP < PA_max)`, `0E88[p] = (HP < SH_max)` (L321294-321301) -> a pass / shot then drains HP to 0 instead of subtracting PA / SH.

## 2. Encounter / contest resolution (w24::f06)

Encounter formation (L321502-321672): every opposing player k with `dist(k, carrier) < 130 (+120 if Brawler fires: cost > 0, HP >= cost, chance > rand(100); it pays its hpCost every time, L321502-321526)` and not asleep joins. At most 5 defenders (`10A2 > 4` checks, L321691). The list `10AE[]` is insertion-sorted by current AT, descending (L321660-321670). Joining defenders get `0F7F = 100` frames of stun (L321654). Working copies `EN = 0028, PA = 002C, SH = 0030` are taken from the current stats (L321683-321685).

The carrier picks how many defenders to break through, `n = 128C` (human: menu result at L326224; CPU: section 8). Defenders `0..n-1` tackle in order (loop L332041); defenders `n..10A2-1` become blockers of the following pass or shot (loop L337171-337172).

### Tackle (per tackler i; L332193-332260 menu, L333271-335450 resolution)
- A tackler may pick a tackle tech (list built L332057-332176): requires `HP >= hpCost(tech)` and poison multiplier `12D2 < 16`. `AT' = min(99, AT + statBoost)` (L332209-332212). HP cost paid up front except Drain Tackle (L332205-332206). Tech chance `0DEC = chancePct` (L332208). Without a tech `AT' = AT` (L332201).
- Roll: `r = AT'/2 + rand(AT')`, i.e. `r in [AT'/2, AT'/2 + AT' - 1]` (L333271-333274).
- If the random part is 0 -> " misses!", carrier +1 EXP (L333275-333292).
- Tackle Slip (carrier): if `rand(100) < chance && HP >= cost` -> HP -= cost and the tackle is evaded (L333841-333842). (The "is disoriented! / loses a tech!" Gamble branch at L333801 is guarded by `and 0`: dead code.)
- Else if `r < EN`: carrier keeps the ball, `EN -= r` (w26::f0A, L476255-476258), carrier +1 EXP (L333998), and the tackle tech's status is rolled on the carrier (`rand(100) < chancePct`, then Anti-* check; section 4).
- Else (`r >= EN`): carrier loses the ball to the tackler, `0F7F[carrier] = 100` (L335449-335450).
- EN is never written back to 028C; it resets at the next encounter.

### Pass vs block (L337178-338882; arrival L339145-339167)
- Passer: `PA' = min(99, PA + statBoost)` (L326606-326609). HP cost: normal pass `HP -= PA` (HP -> 0 if `0E78`) (L326573-326578); tech pass `HP -= hpCost` (L326603). A pass tech is offered only if `HP >= hpCost + PA_max` and `12D2 < 64` (L326468-326469).
- Each blocker: `r = BL/2 + rand(BL + 1)` (L337178-337181). Random part 0 -> " can't block it!" (L337198). If `r < PA'`: `PA' -= r` (w26::f0B, L476514-476517) and the pass tech's status is rolled on the blocker (e.g. nap at L337228-337234). Else: blocked, blocker +3 EXP, " grabs the ball!", carrier stunned 100 (L338855-338882).
- Flight decay (w15::f07, L302157-302175): each time `floor(dist(ball, receiver) / 100)` changes, `PA' -= max(1, PA' / (5 + 5*GoldenArm[passer]))`, floored at 0.
- Arrival (L339148-339167): receiver asleep -> it just wakes up (" wakes back up!", L339953; Good Morning!/Gamble checks follow). Else if `PA' > 0` -> " catches the pass!", passer +1 EXP (L339149-339167); else the ball is fumbled (" fumbles the ball!").

### Shot vs block vs goalie (menu L327872-327908; blockers L356382-356433; goalie L360770-363720, L397821-398856)
- Shooter: `SH' = min(99, SH + statBoost)` (L327905-327908). HP cost: normal shot `HP -= SH` (0 if `0E88`); tech shot `HP -= hpCost` (L327872-327902). Shot techs are offered only if `HP >= hpCost + SH_max` and `12D2 < 4` (not poisoned) (L327717-327718).
- Shot range (CPU only, L329284-329287): `d = dist(carrier, goal w16) / 100; if SH/10 != 0: d *= SH/10; out of range if d > SH` (" is out of shot range!", L329336). For SH >= 10 this is `dist > ~1000` units.
- Blockers: same roll as for a pass, `r = BL/2 + rand(BL + 1)`; `r < SH'` -> `SH' -= r` (w26::f0C) else blocked (L356382-356430).
- Flight decay (w15::f06, L301911-301925): per 100 units toward the goal, `SH' -= max(1, SH' / (5 + 5*GoldenArm[shooter]))`.
- Goalie catch value `CA' = CA` (L360770, L362592). Super Goalie: if flag set, `HP >= 30`, not asleep and `rand(100) < 60` -> goalie +2 EXP, HP -= 30, `CA' = min(99, CA + rand(10))` (w1D::f06 L317862-317875, called from L362616 / L422439).
- Goalie roll `g = CA'/2 + rand(CA')` (L362662-362664). Outcomes:
  - goalie asleep: goal if `SH' >= 1` (L363645-363646), shooter +2 EXP.
  - special aimed shot (`0D9C == 5`: Jecht Shot 2 or Invisible Shot, fires with `rand(100) < chancePct`, L358573): cursor minigame instead of the roll; aimed point within 56 px of the goalie -> `12BA = 2` (caught, goalie +4 EXP, L380990-380997) else `12BA = 1` (goal, L362665).
  - otherwise `g < SH'` -> goal, shooter +2 EXP (L397821-397822). Else `rand(10) < W` -> " gets a hand on it!" (deflection, loose ball, goalie +2 EXP, L398807-398825) else a clean catch. `W = 4 + 3*SpinBall[shooter] - 3*GripGloves[goalie]` (base L358570; Spin Ball L358706-358708 requires `HP >= 30` and costs it; Grip Gloves L358921-358923 same with cost 30; the 3s are the techs' chancePct).
- Goal bookkeeping (L362669-362724, L363696-363710): `GoalsScored++`, `GoalTimestamp = clock + 300*secondHalf`, scorer = player id (+100 when scoring on the right-hand side), team score ++.

## 3. Movement, HP drain, recovery

- Movement speed is the SP stat used directly: `Common.setMovementSpeed(speed=SP)` (L5313) / `SgEvent.setMainCharMoveSpeed(moveType=18, speed=SP)` (L5336). Fixed speeds: 68 for a defender rushing the carrier (L5534), 40 (L10683), cursor 136 / 102 / 34 (L245369-245848). Brawler approach speed by distance: < 20 -> 100, 21..100 -> 200, 101..300 -> 400, > 300 -> 600 (L321508-321516).
- Per-player HP tick (w02::f0A runs every 3 frames, L5359; L5512-5529):
  ```
  if self == carrier:  counter -= 2  (8 if poisoned)
      if counter < 0:  HP -= 12D2 (floor 0); counter = 16        -> 1 HP / 27 frames; poisoned 4 HP / 9 frames
  else if not poisoned: counter += 1 + Regen(3)
      if counter > 16: if HP < 0080: HP += 1; counter = 0        -> +1 HP / 51 frames; with Regen +1 HP / 15 frames
  ```
- Action HP costs: pass = PA, shot = SH (section 2), tackle tech = hpCost, Anti-* = hpCost when it fires, Tackle Slip cost on evade, Volley Shot cost (L416445), Brawler per encounter, Spin Ball / Grip Gloves / Super Goalie / Good Morning! / Gamble on trigger. Drain Tackle costs nothing; on success the tackler gains and the victim loses `hpCost` (30 / 150 / 500) (L7834-7841).

## 4. Status effects

Applied in the victim's worker `f1B` (w02 L7415-8690; identical in w03..w06, w0A..w0E). Trigger: `rand(100) < chancePct` of the tech (`0DEC`, L7415 / L7698 / L8157 / L8310). Resist with an Anti-* tech: `rand(100) < antiChance && HP >= antiCost` -> " resists X!", victim +1 EXP, HP -= antiCost, and the Anti tech becomes a Techcopy opportunity (L7462-7560 nap, L7699-7754 drain, L8158-8212 venom, L8311-8365 wither).

| status | code `0D9C` | effect | duration |
|---|---|---|---|
| Venom (poison) | 1 | `12D2: 1 -> 4` (drain 4 HP, 4x faster, no regen). If the attacker has Pile Venom and the victim is already poisoned: `12D2 *= 4` while `< 1000` (L8295-8300). | `054C = 500` frames (L8301); on expiry `12D2 = 1` (L321208-321212) |
| Nap (sleep) | 2 | `0B8C = 800` frames, cannot move or act (L7604-7605); woken early when hit by a pass (L339953, L340008) | 800 frames, -1 per frame (L321220) |
| Wither | 3 | one random stat (`rand(3)`-based switch over PA / SH / EN / AT / BL / CA, L8410-8610) is halved: divisor stays 2, or becomes 4 (`*= 2`) if the attacker has Pile Wither and divisor < 100 (L8413-8414). Message "'s X is halved!" | timer `= 500` frames (L8415 ...) |
| Drain | 4 | victim `HP -= hpCost(tech)`, attacker `HP += hpCost` capped at `0080` (L7834-7841) | instant |

Timers decrement once per main-loop frame (L321138-321159). Good Morning! and Gamble clear all six wither timers (L340027-340032, L342044-342049).

## 5. Techniques

- Families: shots ids 1-13, 23-25, 60; passes 14-22; tackles 26-37. statBoost is added to SH / PA / AT (cap 99). Status families: Venom 5-7 / 14-16 / 26-28 (`0D9C = 1`), Nap 8-10 / 17-19 / 29-31 (2), Wither 11-13 / 20-22 / 32-34 (3), Drain 35-37 (4) (L5737-5742, L6588-6600).
- Jecht Shot 2 (id 2) and Invisible Shot (4) are special aimed shots (`0D9C = 5`, L10939-10940, L16599-16601) with probability chancePct (100 / 60): the aim minigame replaces the CA roll (section 2). Jecht Shot (1) and Sphere Shot (3) are plain +5 / +3 SH shots (EXP 2 / 1).
- Volley Shot (flag 512): when a loose ball comes to the player, `rand(100) < chance && HP >= cost` -> immediate shot with current SH, +3 EXP (L416432-416446, L416565).
- Tackle Slip (128): section 2. Anti-* (2 / 4 / 8 / 16): section 4. Brawler (2048): encounter range +120, HP cost per use. Elite Defense (1024): defender approach radius `290 -> 390` (L5479); costs 5 HP at match start.
- Pile Venom / Pile Wither: stacking (section 4). Hi-Risk: every stat halved, all EXP doubled (`+n * (1 + HiRisk)` at every award). Regen: recovery 4x. Golden Arm: flight-decay divisor 5 -> 10. Spin Ball / Grip Gloves: goalie deflection window +3 / -3 out of 10. Super Goalie: 60 % chance of CA + rand(10).
- Good Morning! (L340008-341104): when a sleeping player is woken by a pass: `rand(100) < 50 && HP >= 180` -> wither cured, +4 EXP, HP -= 180, then two stats are set to an override of 99 that decays by 1 every `k` frames, `k = 2 / 4 / 8` by tier of the pass or shot tech that hit him (Venom -> EN + CA, Nap -> AT + PA, Wither -> SH + BL); if no tech, one random stat with 1/frame decay (switch L340945-341104; decay loop L321162-321197).
- Gamble (L342036-342054, L342971-353023): on receiving a pass, `rand(100) < 50 && HP >= 300` and no override active -> wither cured, +4 EXP, HP -= 300, `0C0C = 400` frames during which each of the six stats is `rand(100)` (rolled one by one with a stop prompt for Aurochs players).
- Techcopy (w18::f07 / f08, L303706-303883; candidate list e.g. L5695-5717):
  - The prompt only appears for techs used by the opponent (`0E72 >= 8`, L303706).
  - Candidates: every slot k with `BlitzballMatchPlayerMarkedIndex[k] == user` (Mark Mode), the tech not already learned/pending (`0C4C` / `0C8C`), and the tech inside k's learnable set `0CCC` / `0D0C`.
  - Learnable set (L409-425) = `UncoveredTechs[p] | keyWord0[p] | keyWord(j+1)[p]` for each j in 0..2 whose prerequisite tech `1D5F0[p*3 + j]` is already learned.
  - One candidate is chosen at random, `0E6B[rand(0E71)]` (L303723). Success: copier level < user level -> 20 % (`rand(10) < 2`, fail text "'s level is too low!"); equal level -> 50 % ("'s Techcopy failed!"); higher level -> 100 % (L303724-303808). Learned techs are committed at half-time / match end (L302570-302581, L302910-302911).
- EXP for using a tech: pass / tackle tiers 1 / 2 / 3 -> +1 / +2 / +3 (L5920-5950); shots (L18493-18564): Jecht Shot +2, Jecht Shot 2 +5, id 60 +5, Sphere +1, Invisible +2, Venom / Nap / Wither Shot +1 / +2 / +3.

## 6. Experience

`MatchPlayerPendingEXP[slot] += n * (1 + HiRisk)`, capped at 250 per match at every award site. Awards: both goalies +2 at match start (L604-609), tackle miss -> carrier +1, each successful breakthrough +1, resist +1, tech use + tier, pass completed +1, block +3, goal +2 (shooter), goalie catch / deflection +2, aimed-shot catch +4, Good Morning! / Gamble +4, Super Goalie trigger +2, Volley +3. Level cap 99 (bltz0200 L7793, L9885). The EXP -> level table is NOT in any event script (no script writes `BlitzballPlayerCurrentEXP` or `CurrentLevel`; the results screen only displays them); it is applied natively (UNKNOWN). Initial EXP seeds are in bltz0200 L8794-9384.

## 7. Match structure

- Clock `0144` counts game-seconds up to `0148 = 300` (5:00 per half, L603; w17::f06 L302424-302425), displayed as MM:SS (L302426-302522). One tick = `wait(15) + wait(4)` frames plus the loop, and it pauses while `10B9` (encounter / goal) is set (L302566, L302731-302737): about 19 frames per game-second.
- Tutorial (GameMoment 560..574): ends when the clock passes 180 (L302567-302568). Luca first match (GameMoment 575, not overtime): first-half clock starts at 180 (L601-602).
- End of a half: learned techs committed, `BlitzballIsSecondHalf = true`, clock reset to 0 (L302903), sides swapped (`BlitzballAurochsMatchupLineLeftSide`), room change to `bltz0201` (half-time screen, L302919). A pause-menu option lets the Aurochs end the half early when trailing after GameMoment 582 or in Exhibition (L321377-321408).
- Overtime: after the second half, if tied in Tournament mode or in the Luca match (GameMoment 575), `saveData16A0 = 1` and another period is played (L302913-302929); the Luca first-half 180 s rule is skipped in overtime (L601). Overtime goals log `GoalsScored++` at the moment of scoring (L362668-362670). Whether the first goal ends overtime is handled after `w26::f07` (native helper) - UNCERTAIN.
- Kickoff / blitzoff and throw-ins are driven by natives (`Common.0148`, `Common.011A`, `Common.015D`, L476227, L363719); the throw-in text " throws it back in!" is at L381147 but the out-of-bounds condition is native (UNKNOWN).
- After a catch the goalie holds the ball (`10A5` = catcher) and play restarts via `w26::f07` (L363715).

## 8. Formations, marking, AI

- Mark Mode: `BlitzballMatchPlayerMarkedIndex[k]` (255 = none; marking the goalies 5 / 13 is ignored, L5473) makes defender k follow that opponent (L5470-5476) and makes k a Techcopy candidate for techs the marked player uses (section 5). bltz0200 resets all marks to 255 at the first tutorial (bltz0200 L15B67).
- Defender targeting (L5478-5482): a defender locks onto the carrier when `dist < 290 + 100*EliteDefense` and the carrier belongs to the other team.
- CPU ball carrier (L5383-5442): follows 7 waypoints (`sharedObj19CC0`, zone `10AC` 0..6, x mirrored per side); at each waypoint it decides to act (`0F8F = true`) with zone probability 10 / 30 / 50 / 70 / 80 / 90 / 100 % (`k < rand(10)`, k = 8, 6, 4, 2, 1, 0; zone 6 always and sets `10D5`, L5406-5427).
- CPU encounter choice (L329171-329420): `n = max k with EN >= sum(AT of the first k defenders)` (defenders sorted by AT desc). If it could break all, by zone it may still dribble (`128D = 2`) with probability 70 / 60 / 60 / 50 / 50 / 40 / 0 % (L329226-329254). Shoot-vs-pass: `w = SH * {1/16, 1/8, 1/4, 1/2, 1, 2, 9}[zone]`; shoot if `rand(PA + w) < w` and in range (L329259-329287); otherwise pass, and only if `PA >= sum(BL of the remaining blockers)` (L329404-329417).
- Formations: not in this event (only the waypoint table and `BlitzballMovementType` Auto / Manual A / Manual B for the human, L321385-321393).

Native calls the rules depend on (bodies not visible): `Common.GetRandomInRange(maxExclusive)`, `Common.workerDist(workerA, workerB)`, `Math.101B(x1,y1,z1,x2,y2,z2)` (3D distance), `Common.setMovementSpeed(speed)`, `SgEvent.setMainCharMoveSpeed(moveType, speed)`, `Common.0148(p1, worker)` / `Common.011A` / `Common.015D` / `Common.0116` (ball and possession helpers), `Common.displayFieldChoice(...)` (menus), and the EXP -> level application in the results flow.
