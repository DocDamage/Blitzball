/**
 * save.ts - Versioned save system: three manual slots plus an autosave.
 *
 * Storage goes through a tiny async key/value adapter so the same code runs
 * on IndexedDB in the browser and on an in-memory map in tests (vitest has no
 * DOM; createDefaultAdapter() detects `indexedDB`).
 */

import { LEAGUE_STATE_VERSION, type LeagueState } from "./state";

export const SAVE_SCHEMA_VERSION = 1;
export const SAVE_SLOTS = [0, 1, 2] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number] | "auto";

export interface SaveEnvelope {
  schema: number;
  savedAt: number;
  label: string;
  state: LeagueState;
}

export interface SaveSummary {
  slot: SaveSlot;
  savedAt: number;
  label: string;
  season: number;
  day: number;
  playerTeam: number;
}

export interface SaveAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// ------------------------------------------------------------- adapters

export class MemoryAdapter implements SaveAdapter {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

const DB_NAME = "blitzball";
const STORE = "saves";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbAdapter implements SaveAdapter {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(key: string): Promise<string | null> {
    const v = await request((await this.store("readonly")).get(key));
    return typeof v === "string" ? v : null;
  }
  async set(key: string, value: string): Promise<void> {
    await request((await this.store("readwrite")).put(value, key));
  }
  async delete(key: string): Promise<void> {
    await request((await this.store("readwrite")).delete(key));
  }
  async keys(): Promise<string[]> {
    const ks = await request((await this.store("readonly")).getAllKeys());
    return ks.map(String);
  }
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** IndexedDB when available, otherwise an in-memory adapter (tests, private mode). */
export function createDefaultAdapter(): SaveAdapter {
  return hasIndexedDb() ? new IndexedDbAdapter() : new MemoryAdapter();
}

// --------------------------------------------------------------- migrate

export class SaveError extends Error {}

/**
 * Upgrade an envelope from an older schema. Add a case per bump; each case
 * transforms version n into n+1 and falls through to the next.
 */
export function migrate(raw: unknown): SaveEnvelope {
  if (typeof raw !== "object" || raw === null) throw new SaveError("save is not an object");
  const env = raw as Partial<SaveEnvelope> & { schema?: number };
  if (typeof env.schema !== "number") throw new SaveError("save has no schema version");
  if (env.schema > SAVE_SCHEMA_VERSION)
    throw new SaveError(`save schema ${env.schema} is newer than ${SAVE_SCHEMA_VERSION}`);
  let schema = env.schema;
  // Example for the future:
  // if (schema === 1) { ...transform env.state...; schema = 2; }
  if (schema !== SAVE_SCHEMA_VERSION) throw new SaveError(`no migration from schema ${schema}`);
  if (!env.state || typeof env.state !== "object") throw new SaveError("save has no state");
  if (env.state.version !== LEAGUE_STATE_VERSION) throw new SaveError(`state version ${env.state.version} unsupported`);
  schema = SAVE_SCHEMA_VERSION;
  return { schema, savedAt: env.savedAt ?? 0, label: env.label ?? "", state: env.state };
}

// ------------------------------------------------------------------- api

export function slotKey(slot: SaveSlot): string {
  return `save:${slot}`;
}

export async function saveGame(
  adapter: SaveAdapter,
  slot: SaveSlot,
  state: LeagueState,
  label = "",
  now = Date.now(),
): Promise<SaveEnvelope> {
  const env: SaveEnvelope = { schema: SAVE_SCHEMA_VERSION, savedAt: now, label, state: structuredClone(state) };
  await adapter.set(slotKey(slot), JSON.stringify(env));
  return env;
}

export async function loadGame(adapter: SaveAdapter, slot: SaveSlot): Promise<LeagueState | null> {
  const text = await adapter.get(slotKey(slot));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError("save is not valid JSON");
  }
  return migrate(parsed).state;
}

export async function deleteSave(adapter: SaveAdapter, slot: SaveSlot): Promise<void> {
  await adapter.delete(slotKey(slot));
}

/** Autosave after each match: the "auto" slot. */
export function autosave(adapter: SaveAdapter, state: LeagueState): Promise<SaveEnvelope> {
  return saveGame(adapter, "auto", state, "autosave");
}

export async function listSaves(adapter: SaveAdapter): Promise<SaveSummary[]> {
  const out: SaveSummary[] = [];
  for (const slot of [...SAVE_SLOTS, "auto"] as SaveSlot[]) {
    const text = await adapter.get(slotKey(slot));
    if (text === null) continue;
    try {
      const env = migrate(JSON.parse(text));
      out.push({
        slot,
        savedAt: env.savedAt,
        label: env.label,
        season: env.state.season,
        day: env.state.day,
        playerTeam: env.state.playerTeam,
      });
    } catch {
      // Corrupt or incompatible slot: skip it rather than fail the whole list.
    }
  }
  return out;
}
