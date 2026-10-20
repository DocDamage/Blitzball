/**
 * audio/index.ts - Procedural audio layer (Web Audio API, no sound files).
 *
 *   createAudio(settings) -> BlitzAudio
 *
 * Every cue is synthesised on demand from oscillators and a shared noise
 * buffer: crowd / underwater ambience beds, whistles, impacts, technique
 * stings, a goal fanfare, UI blips and an optional looping pad + arpeggio
 * track. A user-supplied music file (object URL, never persisted) replaces
 * the procedural track while set.
 *
 * Resilience: when `AudioContext` is missing (tests, old browsers) every
 * method is a silent no-op. The context is created lazily and resumed on the
 * first user gesture (autoplay policy); cues played before that are dropped,
 * ambience / music requested before that start as soon as the context runs.
 */

export interface AudioSettings {
  /** 0..1 */
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

export type TechniqueFamily = "shot" | "pass" | "tackle" | "passive";

export type CueName =
  | "kickoff"
  | "half-time"
  | "full-time"
  | "pass"
  | "pass-complete"
  | "pass-intercepted"
  | "shot"
  | "shot-blocked"
  | "save"
  | "goal"
  | "tackle"
  | "tackle-miss"
  | "breakthrough"
  | "technique"
  | "techcopy"
  | "cheer"
  | "ui-click"
  | "ui-confirm"
  | "ui-back";

export interface PlayOptions {
  /** For "technique": which sting to play. */
  family?: TechniqueFamily;
  /** 0..1 loudness scale (default 1). */
  intensity?: number;
}

export interface BlitzAudio {
  /** True when a Web Audio backend exists (false = silent no-op). */
  readonly available: boolean;
  /** Create / resume the context (call from a user gesture; also wired automatically). */
  resume(): void;
  play(name: CueName, opts?: PlayOptions): void;
  setVolumes(v: Partial<AudioSettings>): void;
  /** Crowd + underwater beds (match screens). */
  setAmbience(on: boolean): void;
  startMusic(): void;
  stopMusic(): void;
  /** Replace the procedural track with the user's own file (null = back to procedural). */
  setUserMusic(file: File | null): void;
  dispose(): void;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  master: 0.8,
  sfx: 0.8,
  music: 0.7,
  muted: false,
});

/** Technique kind (sim) -> sting family. */
export function familyOf(kind: string | undefined): TechniqueFamily {
  return kind === "shot" || kind === "pass" || kind === "tackle" ? kind : "passive";
}

type Ctor = new () => AudioContext;

function audioContextCtor(): Ctor | null {
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const NOOP: BlitzAudio = {
  available: false,
  resume() {},
  play() {},
  setVolumes() {},
  setAmbience() {},
  startMusic() {},
  stopMusic() {},
  setUserMusic() {},
  dispose() {},
};

export function createAudio(settings: AudioSettings): BlitzAudio {
  const Ctx = audioContextCtor();
  if (!Ctx) return NOOP;
  return new Engine(Ctx, settings);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Bar-by-bar music: chord tones (midi) for a slow Am - F - C - G loop.
const CHORDS = [
  [57, 60, 64, 67],
  [53, 57, 60, 64],
  [48, 52, 55, 60],
  [55, 59, 62, 67],
];
const BAR_SECONDS = 4;
const ARP_STEPS = 8;

type Bus = "sfx" | "music";

class Engine implements BlitzAudio {
  readonly available = true;
  private ctx: AudioContext | null = null;
  private readonly Ctx: Ctor;
  private settings: AudioSettings;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private disposed = false;

  private ambienceWanted = false;
  private ambienceNodes: AudioScheduledSourceNode[] = [];
  private ambienceGain: GainNode | null = null;

  private musicWanted = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private barIndex = 0;
  private userUrl: string | null = null;
  private userEl: HTMLAudioElement | null = null;
  private userSource: MediaElementAudioSourceNode | null = null;

  private readonly onGesture = (): void => {
    this.resume();
  };

  constructor(Ctx: Ctor, settings: AudioSettings) {
    this.Ctx = Ctx;
    this.settings = { ...settings };
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", this.onGesture, { capture: true, passive: true });
      window.addEventListener("keydown", this.onGesture, { capture: true, passive: true });
    }
  }

  // ------------------------------------------------------------------ lifecycle

  resume(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      try {
        this.ctx = new this.Ctx();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
    }
    if (this.ctx.state !== "running") {
      void this.ctx.resume().then(
        () => this.onRunning(),
        () => {},
      );
    } else this.onRunning();
  }

  private onRunning(): void {
    if (this.disposed || !this.ctx || this.ctx.state !== "running") return;
    this.detachGestures();
    if (this.ambienceWanted && this.ambienceNodes.length === 0) this.startAmbience();
    if (this.musicWanted && !this.musicTimer && !this.userEl) this.startProcedural();
    if (this.userEl && this.musicWanted) void this.userEl.play().catch(() => {});
  }

  private detachGestures(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("pointerdown", this.onGesture, { capture: true });
    window.removeEventListener("keydown", this.onGesture, { capture: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGestures();
    this.stopMusic();
    this.setUserMusic(null);
    this.setAmbience(false);
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  setVolumes(v: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...v };
    if (this.ctx) this.applyVolumes();
  }

  private applyVolumes(): void {
    const s = this.settings;
    const t = this.now();
    this.master.gain.setTargetAtTime(s.muted ? 0 : clamp01(s.master), t, 0.03);
    this.sfx.gain.setTargetAtTime(clamp01(s.sfx), t, 0.03);
    this.music.gain.setTargetAtTime(clamp01(s.music) * 0.6, t, 0.03);
  }

  /** The running context, or null while the autoplay policy still blocks us. */
  private live(): AudioContext | null {
    return this.ctx && this.ctx.state === "running" ? this.ctx : null;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private bus(b: Bus): GainNode {
    return b === "sfx" ? this.sfx : this.music;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  // ------------------------------------------------------------------ primitives

  /** Oscillator with an optional pitch glide and a linear attack / exponential release. */
  private tone(o: {
    type: OscillatorType;
    freq: number;
    to?: number;
    at?: number;
    dur: number;
    gain: number;
    attack?: number;
    bus?: Bus;
    filter?: number;
    detune?: number;
  }): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = this.now() + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let head: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.filter;
      head.connect(f);
      head = f;
    }
    head.connect(g).connect(this.bus(o.bus ?? "sfx"));
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** Filtered noise burst (impacts, whooshes, cheers). */
  private burst(o: {
    dur: number;
    gain: number;
    attack?: number;
    at?: number;
    type?: BiquadFilterType;
    freq: number;
    to?: number;
    q?: number;
  }): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = this.now() + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  // ------------------------------------------------------------------ cues

  play(name: CueName, opts: PlayOptions = {}): void {
    if (!this.live()) return;
    const k = clamp01(opts.intensity ?? 1);
    switch (name) {
      case "kickoff":
        this.whistle(0.35, 1);
        break;
      case "half-time":
        this.whistle(0.3, 2);
        break;
      case "full-time":
        this.whistle(0.5, 3);
        this.cheer(1);
        break;
      case "pass":
        this.burst({ dur: 0.22, gain: 0.35 * k, freq: 1200, to: 400, q: 0.8 });
        this.tone({ type: "sine", freq: 180, to: 90, dur: 0.12, gain: 0.25 * k });
        break;
      case "pass-complete":
        this.tone({ type: "triangle", freq: 320, to: 200, dur: 0.09, gain: 0.3 * k, filter: 1500 });
        this.burst({ dur: 0.06, gain: 0.2 * k, freq: 2500, q: 0.5 });
        break;
      case "pass-intercepted":
        this.burst({ dur: 0.15, gain: 0.35 * k, freq: 700, q: 1.5 });
        this.tone({ type: "sawtooth", freq: 260, to: 130, dur: 0.25, gain: 0.18 * k, filter: 900 });
        break;
      case "shot":
        this.burst({ dur: 0.4, gain: 0.5 * k, freq: 500, to: 2500, q: 0.7, attack: 0.03 });
        this.tone({ type: "sine", freq: 140, to: 50, dur: 0.25, gain: 0.45 * k });
        break;
      case "shot-blocked":
      case "tackle":
        this.tone({ type: "sine", freq: 120, to: 35, dur: 0.3, gain: 0.6 * k });
        this.burst({ dur: 0.12, gain: 0.4 * k, type: "lowpass", freq: 900, q: 0.7 });
        break;
      case "tackle-miss":
        this.burst({ dur: 0.3, gain: 0.3 * k, freq: 900, to: 300, q: 1 });
        break;
      case "save":
        this.tone({ type: "sine", freq: 160, to: 60, dur: 0.2, gain: 0.4 * k });
        this.burst({ dur: 0.1, gain: 0.3 * k, freq: 1800, q: 0.6 });
        this.cheer(0.5);
        break;
      case "goal":
        this.fanfare();
        this.cheer(1);
        break;
      case "breakthrough":
        this.burst({ dur: 0.35, gain: 0.35 * k, freq: 300, to: 3000, q: 2, attack: 0.05 });
        this.tone({ type: "triangle", freq: 220, to: 660, dur: 0.3, gain: 0.2 * k, filter: 2000 });
        break;
      case "technique":
        this.sting(opts.family ?? "passive", k);
        break;
      case "techcopy":
        this.tone({ type: "sine", freq: 1320, dur: 0.25, gain: 0.18 * k });
        this.tone({ type: "sine", freq: 1980, dur: 0.35, gain: 0.14 * k, at: 0.08 });
        this.tone({ type: "sine", freq: 2640, dur: 0.45, gain: 0.1 * k, at: 0.16 });
        break;
      case "cheer":
        this.cheer(k);
        break;
      case "ui-click":
        this.tone({ type: "square", freq: 1400, dur: 0.035, gain: 0.08 * k, filter: 3000 });
        break;
      case "ui-confirm":
        this.tone({ type: "triangle", freq: 660, dur: 0.08, gain: 0.15 * k });
        this.tone({ type: "triangle", freq: 990, dur: 0.14, gain: 0.15 * k, at: 0.07 });
        break;
      case "ui-back":
        this.tone({ type: "triangle", freq: 660, dur: 0.08, gain: 0.13 * k });
        this.tone({ type: "triangle", freq: 440, dur: 0.14, gain: 0.13 * k, at: 0.07 });
        break;
    }
  }

  private whistle(dur: number, blasts: number): void {
    for (let i = 0; i < blasts; i++) {
      const at = i * (dur + 0.12);
      this.tone({ type: "square", freq: 2600, dur, gain: 0.22, at, attack: 0.02, filter: 5000 });
      this.tone({ type: "sine", freq: 2600 * 1.01, to: 2600 * 1.03, dur, gain: 0.12, at, attack: 0.02 });
      this.burst({ dur, gain: 0.08, at, freq: 2800, q: 6 });
    }
  }

  private cheer(k: number): void {
    this.burst({ dur: 1.6 * (0.6 + 0.4 * k), gain: 0.5 * k, attack: 0.12, freq: 900, to: 600, q: 0.5 });
    this.burst({ dur: 0.9, gain: 0.25 * k, attack: 0.05, type: "highpass", freq: 2500, q: 0.5 });
  }

  private fanfare(): void {
    const notes = [72, 76, 79, 84];
    notes.forEach((n, i) => {
      const at = i * 0.11;
      const dur = i === notes.length - 1 ? 0.9 : 0.22;
      this.tone({ type: "sawtooth", freq: midi(n), dur, gain: 0.22, at, attack: 0.01, filter: 2400 });
      this.tone({ type: "triangle", freq: midi(n - 12), dur, gain: 0.18, at, attack: 0.01 });
    });
  }

  private sting(family: TechniqueFamily, k: number): void {
    switch (family) {
      case "shot":
        this.tone({ type: "sawtooth", freq: 880, to: 440, dur: 0.3, gain: 0.25 * k, filter: 2500 });
        this.tone({ type: "sawtooth", freq: 1320, to: 660, dur: 0.3, gain: 0.12 * k, filter: 2500, at: 0.04 });
        break;
      case "pass":
        this.tone({ type: "triangle", freq: 523, dur: 0.12, gain: 0.22 * k });
        this.tone({ type: "triangle", freq: 659, dur: 0.12, gain: 0.22 * k, at: 0.09 });
        this.tone({ type: "triangle", freq: 784, dur: 0.25, gain: 0.22 * k, at: 0.18 });
        break;
      case "tackle":
        this.tone({ type: "square", freq: 110, to: 55, dur: 0.35, gain: 0.3 * k, filter: 600 });
        this.tone({ type: "square", freq: 117, to: 58, dur: 0.35, gain: 0.2 * k, filter: 600 });
        break;
      default:
        this.tone({ type: "sine", freq: 1047, dur: 0.4, gain: 0.16 * k, attack: 0.05 });
        this.tone({ type: "sine", freq: 1568, dur: 0.5, gain: 0.1 * k, attack: 0.05, at: 0.1 });
    }
  }

  // ------------------------------------------------------------------ ambience

  setAmbience(on: boolean): void {
    this.ambienceWanted = on;
    if (on) {
      if (this.ambienceNodes.length === 0 && this.live()) this.startAmbience();
      return;
    }
    const nodes = this.ambienceNodes;
    const g = this.ambienceGain;
    this.ambienceNodes = [];
    this.ambienceGain = null;
    if (!nodes.length || !this.ctx) return;
    const t = this.now();
    g?.gain.setTargetAtTime(0, t, 0.4);
    for (const n of nodes) n.stop(t + 2);
  }

  private startAmbience(): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 2);
    out.connect(this.sfx);
    this.ambienceGain = out;

    const bed = (filter: BiquadFilterType, hz: number, q: number, level: number, lfoHz: number, depth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = hz;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(f).connect(g).connect(out);
      src.start(t);
      lfo.start(t);
      this.ambienceNodes.push(src, lfo);
    };
    bed("bandpass", 800, 0.5, 0.11, 0.07, 0.05); // crowd murmur with a slow swell
    bed("lowpass", 220, 0.7, 0.09, 0.19, 0.03); // underwater rumble
  }

  // ------------------------------------------------------------------ music

  startMusic(): void {
    this.musicWanted = true;
    if (!this.live()) return;
    if (this.userEl) void this.userEl.play().catch(() => {});
    else if (!this.musicTimer) this.startProcedural();
  }

  stopMusic(): void {
    this.musicWanted = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.userEl?.pause();
  }

  private startProcedural(): void {
    const ctx = this.live();
    if (!ctx) return;
    this.nextBar = ctx.currentTime + 0.1;
    this.barIndex = 0;
    const tick = () => {
      if (!this.live()) return;
      while (this.nextBar < ctx.currentTime + 1) {
        this.scheduleBar(this.nextBar - ctx.currentTime, CHORDS[this.barIndex % CHORDS.length]);
        this.nextBar += BAR_SECONDS;
        this.barIndex++;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 250);
  }

  private scheduleBar(at: number, chord: number[]): void {
    for (const n of chord) {
      for (const detune of [-7, 7]) {
        this.tone({
          type: "triangle",
          freq: midi(n),
          dur: BAR_SECONDS + 0.5,
          gain: 0.05,
          attack: 1.2,
          at,
          bus: "music",
          filter: 900,
          detune,
        });
      }
    }
    const step = BAR_SECONDS / ARP_STEPS;
    for (let i = 0; i < ARP_STEPS; i++) {
      const n = chord[(i % 2 === 0 ? i / 2 : ARP_STEPS / 2 - (i + 1) / 2) % chord.length] + 12;
      this.tone({ type: "sine", freq: midi(n), dur: step * 0.9, gain: 0.07, at: at + i * step, bus: "music" });
    }
  }

  setUserMusic(file: File | null): void {
    if (this.userEl) {
      this.userEl.pause();
      this.userSource?.disconnect();
      this.userEl.src = "";
      this.userEl = null;
      this.userSource = null;
    }
    if (this.userUrl) {
      URL.revokeObjectURL(this.userUrl);
      this.userUrl = null;
    }
    if (!file || this.disposed || typeof Audio === "undefined") {
      if (this.musicWanted && !this.disposed) this.startMusic();
      return;
    }
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.userUrl = URL.createObjectURL(file);
    const el = new Audio(this.userUrl);
    el.loop = true;
    this.userEl = el;
    this.resume();
    if (this.ctx) {
      try {
        this.userSource = this.ctx.createMediaElementSource(el);
        this.userSource.connect(this.music);
      } catch {
        // Not routable through the graph: it still plays at the element's own volume.
      }
    }
    if (this.musicWanted && this.live()) void el.play().catch(() => {});
  }
}
