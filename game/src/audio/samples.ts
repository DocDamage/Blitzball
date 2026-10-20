/**
 * audio/samples.ts - the game's own sounds, rendered from the disc by tools/extract/export_audio.py into
 * public/ffx/audio (gitignored, like the models). Everything here degrades to "no samples": the engine then keeps
 * using its procedural cues, so the game works without the extracted assets.
 */

export interface SampleFile {
  file: string;
  duration: number;
}

export interface MusicFile extends SampleFile {
  /** Seconds; null when the piece does not loop (plays once). */
  loopStart: number | null;
  loopEnd: number | null;
}

export interface SampleManifest {
  sfx: Record<string, SampleFile[]>;
  music: Record<string, MusicFile>;
}

/** Where the extracted audio lives. */
export const AUDIO_BASE = "/ffx/audio/";

export type MusicTrack = "menu" | "match" | "victory" | "defeat";

/** Music track -> rendered piece (BGM ids: 0x18 The Blitzers, 0x1B Blitz Off!, 0x8A Victory Fanfare, 0x8C Game Over). */
export const MUSIC_PIECE: Record<MusicTrack, string> = {
  menu: "the-blitzers",
  match: "blitz-off",
  victory: "victory",
  defeat: "game-over",
};

/** A layer of a cue: which sample group to draw a variant from and how loud. */
export interface SampleLayer {
  cue: string;
  gain: number;
}

export interface SampleRecipe {
  layers: SampleLayer[];
  /** Also run the procedural version (cues the original has no sound for, or that sample audio does not cover). */
  procedural: boolean;
}

/**
 * Engine cue -> original sounds. Choices follow the Blitzball event script: shots and tackles are played with the
 * TIDU_/WAKK_BZ_SHOT*, TACL* motions, sfx 89227 when a goal is scored, 81047.. for crowd reactions.
 * Cues with no recorded counterpart (passes, interceptions, ...) stay procedural.
 */
export function recipeFor(name: string, family?: string): SampleRecipe | null {
  switch (name) {
    case "kickoff":
      return { layers: [{ cue: "kickoff", gain: 0.9 }], procedural: false };
    case "half-time":
      return { layers: [{ cue: "half-time", gain: 0.9 }], procedural: false };
    case "full-time":
      return { layers: [{ cue: "full-time", gain: 0.9 }, { cue: "cheer", gain: 0.7 }], procedural: false };
    case "shot":
      return { layers: [{ cue: "shot", gain: 0.85 }], procedural: false };
    case "shot-blocked":
    case "tackle":
      return { layers: [{ cue: "tackle", gain: 0.9 }], procedural: false };
    case "save":
      return { layers: [{ cue: "crowd-gasp", gain: 0.6 }], procedural: true };
    case "goal":
      return { layers: [{ cue: "goal", gain: 1 }, { cue: "crowd-roar", gain: 0.8 }], procedural: false };
    case "technique":
      return {
        layers: [family === "shot" ? { cue: "shot-power", gain: 0.8 } : { cue: "technique", gain: 0.9 }],
        procedural: false,
      };
    case "techcopy":
      return { layers: [{ cue: "techcopy", gain: 0.9 }], procedural: false };
    case "cheer":
      return { layers: [{ cue: "cheer", gain: 0.8 }], procedural: false };
    case "ui-click":
      return { layers: [{ cue: "ui-click", gain: 0.7 }], procedural: false };
    case "ui-confirm":
      return { layers: [{ cue: "ui-confirm", gain: 0.8 }], procedural: false };
    case "ui-back":
      return { layers: [{ cue: "ui-back", gain: 0.8 }], procedural: false };
    default:
      return null;
  }
}

/** Fetches the manifest and decodes files on demand. Never rejects: failures just mean "not available". */
export class SampleBank {
  private manifest: SampleManifest | null = null;
  private manifestPromise: Promise<void> | null = null;
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();

  constructor(private readonly base = AUDIO_BASE) {}

  /** Start loading the manifest (idempotent). */
  load(): Promise<void> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.base}manifest.json`)
        .then((r) => (r.ok ? (r.json() as Promise<SampleManifest>) : null))
        .then((m) => {
          this.manifest = m && m.sfx && m.music ? m : null;
        })
        .catch(() => {
          this.manifest = null;
        });
    }
    return this.manifestPromise;
  }

  get ready(): boolean {
    return this.manifest !== null;
  }

  musicFile(piece: string): MusicFile | null {
    return this.manifest?.music[piece] ?? null;
  }

  /** A decoded buffer for a random variant of the cue, or null when absent / still decoding. */
  variant(ctx: AudioContext, cue: string, rng: () => number = Math.random): AudioBuffer | null {
    const list = this.manifest?.sfx[cue];
    if (!list?.length) return null;
    const pick = list[Math.floor(rng() * list.length) % list.length];
    return this.buffer(ctx, pick.file);
  }

  /** Decode every sfx file in the background so later cues are instant. */
  preloadSfx(ctx: AudioContext): void {
    if (!this.manifest) return;
    for (const list of Object.values(this.manifest.sfx)) for (const f of list) this.buffer(ctx, f.file);
  }

  /** Buffer if already decoded; otherwise kicks off the decode and returns null. */
  buffer(ctx: AudioContext, file: string): AudioBuffer | null {
    if (this.buffers.has(file)) return this.buffers.get(file) ?? null;
    void this.decode(ctx, file);
    return null;
  }

  decode(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    const cached = this.pending.get(file);
    if (cached) return cached;
    const p = fetch(`${this.base}${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((data) => (data ? ctx.decodeAudioData(data) : null))
      .catch(() => null)
      .then((buf) => {
        this.buffers.set(file, buf);
        return buf;
      });
    this.pending.set(file, p);
    return p;
  }
}
