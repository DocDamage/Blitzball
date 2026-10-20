/**
 * results.ts - Post-match summary: score, scorers, EXP, level-ups,
 * techniques learned, contract events, the rest of the round, prizes.
 */

import { loadGameData, techniqueById } from "../../data";
import { playerState } from "../../league";
import { playerSlug } from "../../sim/teamFromData";
import type { MatchEvent } from "../../sim/types";
import type { App } from "../app";
import { button, fmtGil, h, section } from "../dom";
import type { ScreenView } from "./index";

function clock(time: number, half: number): string {
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${half === 3 ? "OT " : half === 2 ? "2H " : "1H "}${m}:${s.toString().padStart(2, "0")}`;
}

export function resultsScreen(app: App): ScreenView {
  const state = app.requireState();
  const data = loadGameData();
  const r = app.lastResult;
  if (!r) {
    queueMicrotask(() => app.go("hub"));
    return { element: h("div") };
  }
  const name = (pid: number) => data.players[pid].name;
  const me = state.playerTeam;
  const el = h("div", {}, h("h1", { text: r.kind === "exhibition" ? "Exhibition result" : "Match results" }));

  if (r.report) {
    const rep = r.report;
    const won =
      rep.score[0] === rep.score[1] ? null : (rep.score[0] > rep.score[1] ? rep.homeTeam : rep.awayTeam) === me;
    const homeTeam = rep.homeTeam;
    const verdict = won === null ? "Draw" : won ? "Victory" : "Defeat";
    el.append(
      h(
        "div",
        { class: "scoreline" },
        h("div", { class: `home${homeTeam === me ? " accent" : ""}`, text: r.teamNames[0] }),
        h("div", { class: "big", text: `${rep.score[0]} - ${rep.score[1]}` }),
        h("div", { class: rep.awayTeam === me ? "accent" : "", text: r.teamNames[1] }),
      ),
      h("p", { class: `lede ${won === null ? "" : won ? "good" : "bad"}`, text: verdict }),
    );

    // Scorers: from the event log when present (times), else from the report.
    const goalEvents = r.events.filter((e): e is Extract<MatchEvent, { kind: "goal" }> => e.kind === "goal");
    const scorerItems =
      goalEvents.length > 0
        ? goalEvents.map((e) => {
            const pid = data.players.findIndex((p) => playerSlug(p.name) === e.by);
            const label = pid >= 0 ? name(pid) : e.by;
            return h("li", { text: `${clock(e.time, e.half)}  ${label}  (${e.score.join("-")})` });
          })
        : rep.perPlayer.filter((l) => l.goals > 0).map((l) => h("li", { text: `${name(l.playerId)} x${l.goals}` }));
    el.append(
      section(
        "Scorers",
        scorerItems.length
          ? h("ul", { class: "event-list" }, ...scorerItems)
          : h("p", { class: "muted", text: "No goals" }),
      ),
    );

    // Growth for the player's own team.
    const mineIds = new Set(
      rep.perPlayer
        .map((l) => l.playerId)
        .filter((pid) => playerState(state, pid).team === me || state.teams[me].players.includes(pid)),
    );
    const exp = r.growth.filter((g) => g.kind === "exp" && mineIds.has(g.playerId));
    const levelUps = r.growth.filter((g) => g.kind === "level-up");
    const learned = r.growth.filter((g) => g.kind === "technique-learned");
    const slots = r.growth.filter((g) => g.kind === "tech-slot");
    el.append(
      h(
        "div",
        { class: "cols" },
        section(
          "Experience (your team)",
          exp.length === 0
            ? h("p", { class: "muted", text: "No experience awarded" })
            : h(
                "ul",
                { class: "event-list" },
                ...exp.map((g) =>
                  g.kind === "exp" ? h("li", { text: `${name(g.playerId)} +${g.amount} EXP` }) : null,
                ),
              ),
        ),
        section(
          "Level-ups and techniques",
          levelUps.length + learned.length + slots.length === 0
            ? h("p", { class: "muted", text: "Nothing new this match" })
            : h(
                "ul",
                { class: "event-list" },
                ...levelUps.map((g) =>
                  g.kind === "level-up"
                    ? h("li", {
                        class: mineIds.has(g.playerId) ? "good" : "",
                        text: `${name(g.playerId)} reached level ${g.to} (from ${g.from})`,
                      })
                    : null,
                ),
                ...slots.map((g) =>
                  g.kind === "tech-slot"
                    ? h("li", { text: `${name(g.playerId)} unlocked technique slot ${g.slots}` })
                    : null,
                ),
                ...learned.map((g) =>
                  g.kind === "technique-learned"
                    ? h("li", {
                        class: mineIds.has(g.playerId) ? "good" : "",
                        text: `${name(g.playerId)} learned ${techniqueById(g.techniqueId).name}`,
                      })
                    : null,
                ),
              ),
        ),
      ),
    );
    if (r.contracts.length > 0) {
      el.append(
        section(
          "Contracts",
          h(
            "ul",
            { class: "event-list" },
            ...r.contracts.map((c) =>
              h("li", {
                class: c.teamId === me && c.kind === "expired" ? "warn" : "",
                text: `${name(c.playerId)} (${state.teams[c.teamId].name}): ${c.kind}${c.games ? ` for ${c.games} games` : ""}`,
              }),
            ),
          ),
        ),
      );
    }
  }

  if (r.round) {
    const others = r.round.reports.filter((rep) => !r.report || rep !== r.report);
    if (others.length > 0 && r.kind !== "exhibition") {
      el.append(
        section(
          `Round ${r.round.round + 1} results`,
          h(
            "ul",
            { class: "event-list" },
            ...others.map((rep) =>
              h("li", {
                text: `${state.teams[rep.homeTeam].name} ${rep.score[0]} - ${rep.score[1]} ${state.teams[rep.awayTeam].name}`,
              }),
            ),
          ),
        ),
      );
    }
    if (r.round.rosterMoves.length > 0) {
      el.append(
        section(
          "Transfer news",
          h(
            "ul",
            { class: "event-list" },
            ...r.round.rosterMoves.map((c) =>
              h("li", {
                text: `${state.teams[c.teamId].name} ${c.kind} ${name(c.playerId)}${c.games ? ` (${c.games} games)` : ""}`,
              }),
            ),
          ),
        ),
      );
    }
    if (r.round.finished && r.round.prizes.length > 0) {
      const mine = r.round.prizes.find((p) => p.teamId === me);
      el.append(
        section(
          "Competition finished",
          h(
            "p",
            {},
            h("span", { text: "Champion: " }),
            h("b", { text: state.teams[state.competition?.champion ?? r.round.prizes[0].teamId].name }),
          ),
          mine
            ? h("p", {
                class: "good",
                text: `You finished ${mine.place + 1}${["st", "nd", "rd"][mine.place] ?? "th"}: ${fmtGil(mine.gil)}${mine.prizeName ? ` + ${mine.prizeName}` : ""}`,
              })
            : null,
        ),
      );
    }
  }

  el.append(
    h(
      "div",
      { class: "actions" },
      r.round?.finished
        ? button("Prizes", () => app.go("prizes"), { primary: true, focusId: "prizes" })
        : button("Continue", () => app.go("hub"), { primary: true, focusId: "continue" }),
      button("Team management", () => app.go("team")),
      button("Standings", () => app.go("standings")),
      r.round?.finished ? button("Competitions", () => app.go("hub")) : null,
    ),
  );
  el.querySelector<HTMLElement>(".actions button")?.setAttribute("data-autofocus", "");
  return { element: el };
}
