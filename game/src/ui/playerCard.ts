/**
 * playerCard.ts - Player card shared by team management and scouting.
 *
 * Shows current stats (via currentStats), level and EXP progress, contract
 * status and cost, and the technique list. When `editable`, learned
 * techniques can be equipped / unequipped within the player's slot capacity
 * (equipTechnique) and the player released (undoable).
 */

import {
  canLearnAt,
  learnedTechniques,
  loadGameData,
  STAT_NAMES,
  type StatBlock,
  techniqueById,
  techniqueTier,
} from "../data";
import {
  contractCost,
  currentStats,
  equipCapacity,
  equipTechnique,
  expForLevel,
  isPermanent,
  type LeagueState,
  playerState,
  releasePlayer,
  renewContract,
} from "../league";
import { portraitFor } from "../render/portraits";
import type { App } from "./app";
import { button, fmtGil, h } from "./dom";

export function statsGrid(stats: StatBlock, compare?: StatBlock): HTMLElement {
  return h(
    "div",
    { class: "stats" },
    ...STAT_NAMES.map((name) => {
      const d = compare ? stats[name] - compare[name] : 0;
      return h(
        "div",
        { class: "stat" },
        h("b", { text: name }),
        h(
          "span",
          {},
          h("span", { text: String(stats[name]) }),
          compare && d !== 0
            ? h("span", { class: `delta ${d > 0 ? "good" : "bad"}`, text: `${d > 0 ? "+" : ""}${d}` })
            : null,
        ),
      );
    }),
  );
}

export function contractLabel(state: LeagueState, pid: number): string {
  const p = playerState(state, pid);
  if (p.team === null) return `Free agent · ${fmtGil(p.costPerGame)}/game`;
  if (isPermanent(p)) return "Permanent contract";
  return `${p.contractGames} game${p.contractGames === 1 ? "" : "s"} left · ${fmtGil(p.costPerGame)}/game`;
}

export interface CardOptions {
  editable?: boolean;
  /** Stats to compare against (deltas shown). */
  compare?: StatBlock;
  compareLabel?: string;
  /** Extra buttons rendered in the action row. */
  actions?: HTMLElement[];
  focusPrefix?: string;
}

export function playerCard(app: App, pid: number, opts: CardOptions = {}): HTMLElement {
  const state = app.requireState();
  const data = loadGameData();
  const def = data.players[pid];
  const p = playerState(state, pid);
  const stats = currentStats(state, pid);
  const teamName = p.team === null ? "Free agent" : state.teams[p.team].name;
  const cap = equipCapacity(p);
  const equipped = p.equippedTechs.slice(0, cap);
  const learned = learnedTechniques(def, p);
  const prefix = opts.focusPrefix ?? `card-${pid}`;

  const expThis = expForLevel(p.level);
  const expNext = expForLevel(p.level + 1);
  const expPct = expNext > expThis ? Math.min(100, Math.round(((p.exp - expThis) / (expNext - expThis)) * 100)) : 100;

  const techChips: HTMLElement[] = [];
  for (let slot = 0; slot < cap; slot++) {
    const t = equipped[slot];
    const chip = h(
      "span",
      {
        class: `chip${t ? " equipped" : ""}${opts.editable ? "" : " static"}`,
        tabIndex: opts.editable && t ? 0 : undefined,
        title: t ? techniqueById(t).description : "Empty slot",
        dataset: { focusId: `${prefix}-slot-${slot}` },
        onClick: () => {
          if (!opts.editable || !t) return;
          app.undoable(`Unequipped ${techniqueById(t).name}`, () => equipTechnique(state, pid, slot, 0));
        },
      },
      h("span", { text: t ? techniqueById(t).name : `(slot ${slot + 1})` }),
      opts.editable && t ? h("span", { class: "muted", text: "×" }) : null,
    );
    techChips.push(chip);
  }

  const learnedChips: HTMLElement[] = learned
    .filter((t) => !equipped.includes(t))
    .map((t) => {
      const tech = techniqueById(t);
      const free = equipped.indexOf(0);
      const canEquip = opts.editable && free >= 0;
      return h(
        "span",
        {
          class: `chip${canEquip ? "" : " locked"}`,
          tabIndex: canEquip ? 0 : undefined,
          title: `${tech.description}${canEquip ? "" : " (no free slot)"}`,
          dataset: { focusId: `${prefix}-learn-${t}` },
          onClick: () => {
            if (!canEquip) return;
            app.undoable(`Equipped ${tech.name}`, () => equipTechnique(state, pid, free, t));
          },
        },
        h("span", { text: tech.name }),
        canEquip ? h("span", { class: "muted", text: "+" }) : null,
      );
    });

  // Techniques the player could still learn (for scouting): open tiers minus learned.
  const learnable = def.learnableTiers
    .flat()
    .filter((t) => !learned.includes(t))
    .map((t) => ({ id: t, open: canLearnAt(def, t, p.level), tier: techniqueTier(def, t) }));

  const actions: HTMLElement[] = [...(opts.actions ?? [])];
  if (opts.editable && p.team === state.playerTeam) {
    if (!isPermanent(p)) {
      const games = 5;
      const cost = contractCost(p, games);
      actions.push(
        button(
          `Extend +${games} games`,
          () => {
            const res = renewContract(state, pid, games);
            if (!res.ok) {
              app.toast(res.reason === "no-gil" ? `Not enough gil (${fmtGil(cost)})` : "Cannot extend");
              return;
            }
            app.toast(`Extended ${def.name} for ${games} games (${fmtGil(cost)})`);
            app.refresh();
          },
          { class: "small", hint: fmtGil(cost), focusId: `${prefix}-extend`, disabled: state.gil < cost },
        ),
        button(
          "Release",
          () => {
            app.undoable(`Released ${def.name}`, () => {
              releasePlayer(state, pid);
            });
          },
          { class: "small btn-danger", focusId: `${prefix}-release` },
        ),
      );
    }
  }

  // portrait rendered from the player's original model; stays hidden for free agents and without the assets
  const portrait = document.createElement("img");
  portrait.className = "portrait";
  portrait.alt = "";
  void portraitFor(pid).then((url) => {
    if (!url || !portrait.isConnected) return;
    portrait.src = url;
    portrait.classList.add("ready");
  });

  return h(
    "div",
    { class: "card" },
    portrait,
    h("h3", { text: def.name }),
    h("div", { class: "muted", text: `${teamName} · Level ${p.level} · ${p.exp} EXP` }),
    h(
      "div",
      { class: "exp-bar", title: `${expPct}% to level ${p.level + 1}` },
      h("div", { style: `width:${expPct}%` }),
    ),
    h("div", {
      class: p.team !== null && !isPermanent(p) && p.contractGames <= 1 ? "warn" : "muted",
      text: contractLabel(state, pid),
    }),
    opts.compare ? h("div", { class: "muted", text: `Compared with ${opts.compareLabel ?? "your player"}` }) : null,
    h("div", { style: "margin:0.6em 0" }, statsGrid(stats, opts.compare)),
    h("div", { class: "muted", text: `Equipped (${equipped.filter((t) => t !== 0).length}/${cap} slots)` }),
    h("div", { class: "techs" }, ...techChips),
    learnedChips.length > 0
      ? h(
          "div",
          {},
          h("div", { class: "muted", style: "margin-top:0.5em", text: "Learned, not equipped" }),
          h("div", { class: "techs" }, ...learnedChips),
        )
      : null,
    learnable.length > 0
      ? h(
          "div",
          {},
          h("div", { class: "muted", style: "margin-top:0.5em", text: "Can learn by techcopy" }),
          h(
            "div",
            { class: "techs" },
            ...learnable.map((l) =>
              h("span", {
                class: `chip static${l.open ? "" : " locked"}`,
                text: `${techniqueById(l.id).name}${l.open ? "" : ` (Lv ${def.tierLevels[l.tier - 1] ?? "?"})`}`,
                title: techniqueById(l.id).description,
              }),
            ),
          ),
        )
      : null,
    actions.length > 0 ? h("div", { class: "actions" }, ...actions) : null,
  );
}
