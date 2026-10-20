/**
 * scout.ts - All 60 players: team or free agent, location, level, stats,
 * techniques, contract. Compare any player with one of your own and sign
 * free agents for N games (signFreeAgent).
 */

import { loadGameData, STAT_NAMES } from "../../data";
import { contractCost, currentStats, freeAgentIds, playerState, signFreeAgent, teamPlayerIds } from "../../league";
import type { App } from "../app";
import { button, fmtGil, h, select } from "../dom";
import { locationOf } from "../locations";
import { playerCard } from "../playerCard";
import type { ScreenView } from "./index";

type Filter = "all" | "free" | "mine" | number;

let filter: Filter = "free";
let selected: number | null = null;
let compareWith: number | null = null;
let signGames = 10;
let sortBy: "name" | "level" | "cost" | "rating" = "rating";

export function scoutScreen(app: App): ScreenView {
  const state = app.requireState();
  const data = loadGameData();
  const free = new Set(freeAgentIds(state));
  const mine = teamPlayerIds(state, state.playerTeam);
  if (compareWith !== null && !mine.includes(compareWith)) compareWith = null;

  const rating = (pid: number) => {
    const s = currentStats(state, pid);
    return STAT_NAMES.filter((n) => n !== "HP").reduce((a, n) => a + s[n], 0) + Math.floor(s.HP / 100);
  };

  let ids = state.players.map((p) => p.id);
  if (filter === "free") ids = ids.filter((id) => free.has(id));
  else if (filter === "mine") ids = ids.filter((id) => mine.includes(id));
  else if (typeof filter === "number") ids = ids.filter((id) => playerState(state, id).team === filter);
  ids.sort((a, b) => {
    const pa = playerState(state, a);
    const pb = playerState(state, b);
    switch (sortBy) {
      case "name":
        return data.players[a].name.localeCompare(data.players[b].name);
      case "level":
        return pb.level - pa.level || a - b;
      case "cost":
        return pa.costPerGame - pb.costPerGame || a - b;
      default:
        return rating(b) - rating(a) || a - b;
    }
  });
  if (selected !== null && !ids.includes(selected)) selected = ids[0] ?? null;
  if (selected === null) selected = ids[0] ?? null;

  const filterSelect = select(
    [
      { value: "free", label: "Free agents" },
      { value: "all", label: "Everyone" },
      { value: "mine", label: "My team" },
      ...state.teams.filter((t) => t.id !== state.playerTeam).map((t) => ({ value: String(t.id), label: t.name })),
    ],
    typeof filter === "number" ? String(filter) : filter,
    (v) => {
      filter = v === "free" || v === "all" || v === "mine" ? v : Number(v);
      app.refresh();
    },
    "scout-filter",
  );
  const sortSelect = select(
    [
      { value: "rating", label: "Sort: rating" },
      { value: "level", label: "Sort: level" },
      { value: "cost", label: "Sort: cost" },
      { value: "name", label: "Sort: name" },
    ] as const,
    sortBy,
    (v) => {
      sortBy = v;
      app.refresh();
    },
    "scout-sort",
  );

  const rows = ids.map((pid) => {
    const p = playerState(state, pid);
    const s = currentStats(state, pid);
    const loc = locationOf(pid);
    const tr = h(
      "tr",
      {
        class: `${selected === pid ? "selected" : ""}${p.team === state.playerTeam ? " me" : ""}`,
        tabIndex: 0,
        dataset: { focusId: `scout-${pid}` },
        onClick: () => {
          selected = pid;
          app.refresh();
        },
      },
      h("td", { text: data.players[pid].name }),
      h("td", {
        text: p.team === null ? "Free agent" : state.teams[p.team].name,
        class: p.team === null ? "good" : "",
      }),
      h("td", { text: loc.place }),
      h("td", { class: "num", text: String(p.level) }),
      h("td", { class: "num", text: String(rating(pid)) }),
      h("td", { class: "num", text: `${s.SH}/${s.PA}/${s.EN}/${s.AT}/${s.BL}/${s.CA}` }),
      h("td", { class: "num", text: fmtGil(p.costPerGame) }),
      h("td", { text: p.team === null ? "-" : p.contractGames >= 255 ? "perm." : `${p.contractGames}g` }),
    );
    return tr;
  });

  const table = h(
    "table",
    { class: "table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { text: "Player" }),
        h("th", { text: "Team" }),
        h("th", { text: "Location" }),
        h("th", { class: "num", text: "Lv" }),
        h("th", { class: "num", text: "Rating" }),
        h("th", { class: "num", text: "SH/PA/EN/AT/BL/CA" }),
        h("th", { class: "num", text: "Cost" }),
        h("th", { text: "Contract" }),
      ),
    ),
    h("tbody", {}, ...rows),
  );

  // ---- detail panel
  let detail: HTMLElement | null = null;
  if (selected !== null) {
    const pid = selected;
    const p = playerState(state, pid);
    const loc = locationOf(pid);
    const actions: HTMLElement[] = [];
    if (p.team === null) {
      const gamesSelect = select(
        [3, 5, 10, 20, 30].map((g) => ({ value: g, label: `${g} games (${fmtGil(contractCost(p, g))})` })),
        signGames,
        (v) => {
          signGames = v;
          app.refresh();
        },
        "sign-games",
      );
      const cost = contractCost(p, signGames);
      const hasSlot = state.teams[state.playerTeam].players.includes(null);
      actions.push(
        gamesSelect,
        button(
          "Sign",
          () => {
            const res = signFreeAgent(state, state.playerTeam, pid, signGames);
            if (!res.ok) {
              const why =
                res.reason === "no-gil"
                  ? `Not enough gil (${fmtGil(res.cost)})`
                  : res.reason === "no-slot"
                    ? "No free roster slot - release someone first"
                    : "Cannot sign this player";
              app.toast(why);
              return;
            }
            app.toast(`Signed ${data.players[pid].name} for ${signGames} games (${fmtGil(res.cost)})`);
            app.refresh();
          },
          {
            primary: true,
            focusId: "sign",
            disabled: state.gil < cost || !hasSlot,
            hint: !hasSlot ? "roster full" : state.gil < cost ? "not enough gil" : fmtGil(cost),
          },
        ),
      );
    }
    const compareSelect = select(
      [{ value: -1, label: "Compare with..." }, ...mine.map((id) => ({ value: id, label: data.players[id].name }))],
      compareWith ?? -1,
      (v) => {
        compareWith = v < 0 ? null : v;
        app.refresh();
      },
      "compare",
    );
    actions.push(compareSelect);
    detail = h(
      "div",
      {},
      h("p", { class: "muted", text: `${loc.place} - ${loc.note}` }),
      playerCard(app, pid, {
        editable: p.team === state.playerTeam,
        compare: compareWith !== null && compareWith !== pid ? currentStats(state, compareWith) : undefined,
        compareLabel: compareWith !== null ? data.players[compareWith].name : undefined,
        actions,
        focusPrefix: "detail",
      }),
    );
  }

  const el = h(
    "div",
    {},
    h("h1", { text: "Scout" }),
    h("p", {
      class: "lede",
      text: `${free.size} free agents around Spira · you have ${fmtGil(state.gil)} and ${state.teams[state.playerTeam].players.filter((p) => p === null).length} open roster slot(s)`,
    }),
    h("div", { class: "row", style: "margin-bottom:0.6em" }, filterSelect, sortSelect),
    h(
      "div",
      { class: "cols" },
      h("section", { class: "panel", style: "overflow:auto;max-height:60vh" }, table),
      detail,
    ),
  );
  return { element: el };
}
