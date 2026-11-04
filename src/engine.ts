/**
 * Plays songs forever: once per bar, asks the arranger for that bar's events and schedules them on
 * the Tone.js clock. When a song ends, composes the next one from a seed derived from the last.
 */
import * as Tone from "tone";
import { arrangeBar, MELODIC_TRACKS, type BarEvents, type DrumVoice } from "./arranger";
import { compose, type KitName, type Song } from "./composer";
import { Instruments } from "./instruments";
import { createRng } from "./rng";
import type { Key } from "./theory";

export interface EngineSettings {
  style: number;
  /** null = pick per song. */
  key: Key | null;
  /** null = pick per song. */
  bpm: number | null;
  kit: KitName | "auto";
}

export interface EngineEvents {
  onBar?: (events: BarEvents, song: Song) => void;
  onSong?: (song: Song) => void;
  onStateChange?: (playing: boolean) => void;
}

export function nextSeed(seed: number): number {
  return createRng(seed).fork("next-song").int(0, 999_999);
}

export class Engine {
  song: Song;
  instruments: Instruments | null = null;
  missingSamples: Record<string, DrumVoice[]> = {};
  private bar = 0;
  private repeatId: number | null = null;
  private appliedBpm = 0;

  constructor(
    private settings: EngineSettings,
    seed: number,
    private readonly events: EngineEvents = {},
  ) {
    this.song = this.compose(seed);
  }

  get playing(): boolean {
    return this.repeatId !== null;
  }

  get currentBar(): number {
    return this.bar;
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  async start(): Promise<void> {
    if (this.playing) return;
    await Tone.start();
    if (!this.instruments) {
      this.instruments = await Instruments.create();
      this.missingSamples = await this.instruments.drums.loadAll();
    }
    this.instruments.drums.use(this.effectiveKit());
    const transport = Tone.getTransport();
    this.applyBpm(Tone.now());
    this.repeatId = transport.scheduleRepeat(this.tick, "1m", 0);
    transport.start("+0.1");
    this.events.onStateChange?.(true);
  }

  stop(): void {
    if (!this.playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    this.repeatId = null;
    this.instruments?.releaseAll();
    // Resume from the top of the section we stopped in.
    this.bar =
      this.song.sections[sectionIndex(this.song, Math.max(0, this.bar - 1))]?.startBar ?? 0;
    this.events.onStateChange?.(false);
  }

  /** Jumps to a new song (random or given seed) at the next bar line. */
  newSong(seed: number): void {
    this.song = this.compose(seed);
    this.bar = 0;
    this.events.onSong?.(this.song);
  }

  /** Continues from this bar at the next bar line. */
  jumpTo(bar: number): void {
    this.bar = Math.max(0, Math.min(this.song.totalBars - 1, bar));
  }

  skipSection(): void {
    const i = sectionIndex(this.song, Math.max(0, this.playing ? this.bar - 1 : this.bar));
    const next = this.song.sections[i + 1];
    if (next) this.bar = next.startBar;
    else this.newSong(nextSeed(this.song.seed));
  }

  /**
   * Settings changes recompose the current song in place from the same seed. Key, tempo and kit keep
   * the form; style can reshape it, so the play position is clamped into the new song.
   */
  update(settings: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.song = this.compose(this.song.seed);
    if (this.bar >= this.song.totalBars) this.bar = this.song.sections.at(-1)?.startBar ?? 0;
    if (this.instruments) this.instruments.drums.use(this.effectiveKit());
    if (this.playing && "bpm" in settings) Tone.getTransport().bpm.rampTo(this.song.bpm, 0.5);
    this.events.onSong?.(this.song);
  }

  private compose(seed: number): Song {
    return compose({ seed, ...this.settings });
  }

  private effectiveKit(): KitName {
    const kit = this.song.kit;
    return kit !== "synth" && !this.instruments?.drums.hasSamples(kit) ? "synth" : kit;
  }

  private applyBpm(time: number): void {
    if (this.appliedBpm === this.song.bpm) return;
    Tone.getTransport().bpm.setValueAtTime(this.song.bpm, time);
    this.appliedBpm = this.song.bpm;
  }

  private readonly tick = (time: number): void => {
    const inst = this.instruments;
    if (!inst) return;
    if (this.bar >= this.song.totalBars) {
      this.song = this.compose(nextSeed(this.song.seed));
      this.bar = 0;
      inst.drums.use(this.effectiveKit());
      const song = this.song;
      atAudioTime(time, () => this.events.onSong?.(song));
    }
    this.applyBpm(time);

    const song = this.song;
    const ev = arrangeBar(song, this.bar);
    scheduleBar(inst, ev, time, song.bpm);

    atAudioTime(time, () => this.events.onBar?.(ev, song));
    this.bar++;
  };
}

/** Schedules every event of one bar starting at `time` (seconds on the audio clock). */
export function scheduleBar(inst: Instruments, ev: BarEvents, time: number, bpm: number): void {
  const sixteenth = 60 / bpm / 4;
  for (const hit of ev.drums) inst.drum(hit, time + hit.step * sixteenth);
  for (const track of MELODIC_TRACKS) inst.play(track, ev.notes[track], time, sixteenth);
}

/**
 * Runs a UI callback when the audio clock reaches `time`. Not Tone.Draw: it rides
 * requestAnimationFrame and silently drops callbacks more than 0.25 s late, so the display froze
 * whenever the tab was in the background. Timers are throttled there too, but never dropped.
 */
function atAudioTime(time: number, callback: () => void): void {
  setTimeout(callback, Math.max(0, (time - Tone.now()) * 1000));
}

function sectionIndex(song: Song, bar: number): number {
  const i = song.sections.findIndex((s) => bar >= s.startBar && bar < s.startBar + s.bars);
  return i === -1 ? song.sections.length - 1 : i;
}
