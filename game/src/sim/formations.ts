/**
 * formations.ts - Formation presets and marking assignments.
 *
 * Slots are in team-local coordinates: x in [-1, 1] runs from the team's own
 * goal (-1) to the opponent's goal (+1); y and z in [-1, 1] span the pool
 * width and depth. Match converts them to world space using attackDir and
 * FORMATION_SCALE. Each preset also says which opposing role every player
 * marks when defending (null = press the carrier / no fixed mark).
 */

import { FORMATION_SCALE, KICKOFF_MAX_LOCAL_X } from "./constants";
import type { FormationId, Role } from "./types";
import type { Vec3 } from "./vec";

export interface FormationPreset {
  id: FormationId;
  name: string;
  slots: Record<Role, Vec3>;
  marks: Record<Role, Role | null>;
  /** How far outfield players push forward when attacking (local x units). */
  attackShift: number;
  /** How far they drop back when defending (negative local x units). */
  defenseShift: number;
}

const BASE_MARKS: Record<Role, Role | null> = {
  LF: "RD",
  RF: "LD",
  MF: "MF",
  LD: "RF",
  RD: "LF",
  GK: null,
};

export const FORMATIONS: Record<FormationId, FormationPreset> = {
  standard: {
    id: "standard",
    name: "Standard",
    slots: {
      GK: { x: -0.92, y: 0, z: 0 },
      LD: { x: -0.5, y: 0.45, z: 0.15 },
      RD: { x: -0.5, y: -0.45, z: -0.15 },
      MF: { x: 0, y: 0, z: 0 },
      LF: { x: 0.5, y: 0.4, z: 0.2 },
      RF: { x: 0.5, y: -0.4, z: -0.2 },
    },
    marks: BASE_MARKS,
    attackShift: 0.3,
    defenseShift: -0.3,
  },
  attack: {
    id: "attack",
    name: "All-out Attack",
    slots: {
      GK: { x: -0.92, y: 0, z: 0 },
      LD: { x: -0.25, y: 0.5, z: 0.1 },
      RD: { x: -0.25, y: -0.5, z: -0.1 },
      MF: { x: 0.25, y: 0, z: 0 },
      LF: { x: 0.65, y: 0.35, z: 0.25 },
      RF: { x: 0.65, y: -0.35, z: -0.25 },
    },
    marks: { ...BASE_MARKS, LF: null, RF: null },
    attackShift: 0.4,
    defenseShift: -0.15,
  },
  defense: {
    id: "defense",
    name: "Deep Defense",
    slots: {
      GK: { x: -0.92, y: 0, z: 0 },
      LD: { x: -0.65, y: 0.35, z: 0.2 },
      RD: { x: -0.65, y: -0.35, z: -0.2 },
      MF: { x: -0.3, y: 0, z: 0 },
      LF: { x: 0.2, y: 0.45, z: 0.1 },
      RF: { x: 0.2, y: -0.45, z: -0.1 },
    },
    marks: BASE_MARKS,
    attackShift: 0.2,
    defenseShift: -0.4,
  },
  counter: {
    id: "counter",
    name: "Counter",
    slots: {
      GK: { x: -0.92, y: 0, z: 0 },
      LD: { x: -0.55, y: 0.4, z: 0.2 },
      RD: { x: -0.55, y: -0.4, z: -0.2 },
      MF: { x: -0.15, y: 0, z: 0 },
      LF: { x: 0.7, y: 0.25, z: 0.3 },
      RF: { x: 0.7, y: -0.25, z: -0.3 },
    },
    marks: { ...BASE_MARKS, LF: null, RF: null },
    attackShift: 0.25,
    defenseShift: -0.35,
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

/** Team-local slot -> world position for a team attacking toward attackDir. */
export function slotToWorld(slot: Vec3, attackDir: 1 | -1, shiftX = 0): Vec3 {
  const lx = Math.max(-1, Math.min(1, slot.x + shiftX));
  return {
    x: lx * FORMATION_SCALE.x * attackDir,
    y: slot.y * FORMATION_SCALE.y,
    z: slot.z * FORMATION_SCALE.z,
  };
}

/** Kickoff position: the formation slot pulled back into the team's own half. */
export function kickoffPosition(formation: FormationId, role: Role, attackDir: 1 | -1): Vec3 {
  const slot = FORMATIONS[formation].slots[role];
  const pulled = { x: Math.min(slot.x, KICKOFF_MAX_LOCAL_X), y: slot.y, z: slot.z };
  return slotToWorld(pulled, attackDir);
}
