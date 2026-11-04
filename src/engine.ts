/**
 * Plays songs forever: once per bar, asks the arranger for that bar's events, and hands them to the
 * synths a 16th at a time on the Tone.js clock (so an instant switch has nothing left to cancel
 * beyond the clock's look-ahead). When a song ends, composes the next one from a seed derived from
 * the last.
 */
import * as Tone from "tone";
import { arrangeBar, type BarEvents, type DrumVoice } from "./arranger";
import { scheduleStep } from "./schedule";
import { compose, type ImportedTracks, type KitName, type Song } from "./composer";
import type { ReferenceId } from "./references";
import { newSongId, type Creation, type SongSpec } from "./spec";
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
  /** A switch is waiting for the next bar line (the bar it will play), or no longer is (null). */
  onCue?: (bar: number | null) => void;
}

/** Fixed seeds for the originals' generated parts (lead melodies, riffs), so each plays the same. */
const REFERENCE_SEEDS: Record<ReferenceId, number> = {
  "true-faith": 1987,
  "different-story": 1989,
};

export function nextSeed(seed: number): number {
  return createRng(seed).fork("next-song").int(0, 999_999);
}

export class Engine {
  song: Song;
  instruments: Instruments | null = null;
  missingSamples: Record<string, DrumVoice[]> = {};
  private bar = 0;
  private repeatId: number | null = null;
  /** Set while one of the originals plays; cleared when the next generated song starts. */
  private reference: ReferenceId | null = null;
  /** Set while a creation (creator mode) plays; it loops until another song is chosen. */
  private custom: Creation | null = null;
  /** Creator mode: the section being edited plays on repeat. */
  private loop: number | null = null;
  /** The last bars scheduled, with their start on the audio clock (for recording). */
  private scheduled: { bar: number; time: number; seconds: number }[] = [];
  /** The bar playing now, handed to the synths a 16th at a time; and which 16th comes next. */
  private current: { ev: BarEvents; sixteenth: number } | null = null;
  private step = 0;
  /** Switches (songs, jumps, skips) happen at once instead of at the next bar line. */
  private instant = false;
  /** Where playback goes at the next bar line, when that isn't simply the next bar. */
  private cue: number | null = null;
  /** Parts loaded from the user's MIDI files, per original (midi.ts). */
  private readonly imported: Partial<Record<ReferenceId, ImportedTracks>> = {};
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

  /**
   * Where the song is (bar + fraction) at `audioTime` on the audio clock, from the bars already
   * scheduled; null before any.
   */
  positionAt(audioTime: number): number | null {
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      const s = this.scheduled[i];
      if (s && s.time <= audioTime)
        return s.bar + Math.min(0.9999, (audioTime - s.time) / s.seconds);
    }
    return null;
  }

  /** The section on repeat, or null. */
  get loopSection(): number | null {
    return this.loop;
  }

  get creation(): Creation | null {
    return this.custom;
  }

  get currentBar(): number {
    return this.bar;
  }

  /** The bar a switch is waiting to play at the next bar line (null when none is pending). */
  get cuedBar(): number | null {
    return this.cue;
  }

  /** true: songs, jumps and skips start at once; false: at the next bar line. */
  setInstant(on: boolean): void {
    this.instant = on;
    if (on && this.cue !== null) this.restart();
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  async start(): Promise<void> {
    if (this.playing) return;
    if (!this.instruments) useListeningContext();
    await Tone.start();
    if (!this.instruments) {
      this.instruments = await Instruments.create();
      this.missingSamples = await this.instruments.drums.loadAll();
    }
    this.applySong(this.instruments);
    const transport = Tone.getTransport();
    this.applyBpm(Tone.now());
    this.step = 0;
    this.repeatId = transport.scheduleRepeat(this.tick, "16n", 0);
    transport.start("+0.1");
    this.events.onStateChange?.(true);
  }

  stop(): void {
    if (!this.playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    this.repeatId = null;
    this.current = null;
    if (this.cue !== null) {
      this.cue = null;
      this.events.onCue?.(null);
    }
    this.instruments?.releaseAll();
    // Resume from the top of the section we stopped in.
    this.bar =
      this.song.sections[sectionIndex(this.song, Math.max(0, this.bar - 1))]?.startBar ?? 0;
    this.events.onStateChange?.(false);
  }

  /** Jumps to a new song (random or given seed) at the next bar line. */
  newSong(seed: number): void {
    this.reference = null;
    this.custom = null;
    this.loop = null;
    this.song = this.compose(seed);
    this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    this.switched();
    this.events.onSong?.(this.song);
  }

  /**
   * Plays one of the originals (its measured form, chords, key, tempo and kit) at the next bar
   * line. Generated songs follow when it ends.
   */
  playReference(id: ReferenceId): void {
    this.custom = null;
    this.loop = null;
    this.reference = id;
    this.song = this.compose(REFERENCE_SEEDS[id]);
    this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    this.switched();
    this.events.onSong?.(this.song);
  }

  /**
   * Plays a creation (creator mode) at the next bar line: from its first bar, or from the current
   * bar when it was made from the playing song.
   */
  playCustom(creation: Creation, keepPosition = false): void {
    this.reference = null;
    // Each creation gets an id the first time it plays, for its entry in My songs.
    this.custom = creation.id ? creation : { ...creation, id: newSongId() };
    this.song = this.compose(creation.seed);
    if (!keepPosition || this.bar >= this.song.totalBars) this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    if (!keepPosition) this.switched();
    this.events.onSong?.(this.song);
  }

  /** Applies an edit to the playing creation from the next bar, keeping the play position. */
  editCustom(spec: SongSpec): void {
    if (!this.custom) return;
    this.custom = { ...this.custom, spec };
    this.song = this.compose(this.custom.seed);
    if (this.bar >= this.song.totalBars) this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    this.events.onSong?.(this.song);
  }

  /** Repeats one section (creator mode), jumping there; null plays straight through again. */
  setLoop(sectionIndex: number | null): void {
    this.loop = sectionIndex;
    const section = sectionIndex === null ? undefined : this.song.sections[sectionIndex];
    if (section && !(this.bar >= section.startBar && this.bar < section.startBar + section.bars)) {
      this.bar = section.startBar;
      this.switched();
    }
  }

  /** Continues from this bar: at the next bar line, or at once in instant mode. */
  jumpTo(bar: number): void {
    this.bar = Math.max(0, Math.min(this.song.totalBars - 1, bar));
    this.switched();
  }

  skipSection(): void {
    const i = sectionIndex(this.song, Math.max(0, this.playing ? this.bar - 1 : this.bar));
    const next = this.song.sections[i + 1];
    if (next) {
      this.bar = next.startBar;
      this.switched();
    } else this.newSong(nextSeed(this.song.seed));
  }

  /**
   * After a switch (another song, a jump): starts it at once in instant mode, or marks the bar
   * waiting for the next bar line.
   */
  private switched(): void {
    this.cue = this.playing ? this.bar : null;
    if (this.cue !== null && this.instant) this.restart();
    else this.events.onCue?.(this.cue);
  }

  /**
   * Instant switch: restarts the clock right away from `this.bar`. What the synths already hold
   * (up to the clock's look-ahead) still plays; then everything is released just before the new
   * bar's first notes. Notes the polyphonic synths were about to start are caught by a second
   * release once they have.
   */
  private restart(): void {
    const inst = this.instruments;
    if (!this.playing || !inst) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    const at = Tone.now() + 0.05;
    const cut = at - 0.01;
    inst.releaseAll(cut);
    setTimeout(() => inst.releaseChords(cut), Math.max(0, (cut - Tone.now()) * 1000 + 5));
    this.current = null;
    this.step = 0;
    this.appliedBpm = 0;
    this.applyBpm(at);
    this.repeatId = transport.scheduleRepeat(this.tick, "16n", 0);
    transport.start(at);
  }

  /**
   * Settings changes recompose the current song in place from the same seed. Key, tempo and kit keep
   * the form; style can reshape it, so the play position is clamped into the new song.
   */
  update(settings: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.song = this.compose(this.song.seed);
    if (this.bar >= this.song.totalBars) this.bar = this.song.sections.at(-1)?.startBar ?? 0;
    if (this.instruments) this.applySong(this.instruments);
    // A new tempo starts at the next bar line (applyBpm), keeping the bar's 16ths even.
    this.events.onSong?.(this.song);
  }

  private compose(seed: number): Song {
    const song = compose({
      seed,
      ...this.settings,
      reference: this.reference,
      custom: this.custom?.spec ?? null,
    });
    const imported = this.reference ? this.imported[this.reference] : undefined;
    if (imported) song.imported = imported;
    return song;
  }

  /** Plays these parts (from a MIDI file) instead of the generated ones whenever this original
   * plays; null goes back to all generated. */
  setImported(id: ReferenceId, imported: ImportedTracks | null): void {
    if (imported) this.imported[id] = imported;
    else delete this.imported[id];
    if (this.reference === id) {
      this.song = this.compose(this.song.seed);
      this.events.onSong?.(this.song);
    }
  }

  /** Points the instruments at the current song: its drum machine and bass tone. */
  private applySong(inst: Instruments): void {
    inst.drums.use(this.effectiveKit());
    inst.setBassTone(this.song.style);
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

  /** Once per 16th: starts a bar on the first, then hands the synths that 16th's notes. */
  private readonly tick = (time: number): void => {
    const inst = this.instruments;
    if (!inst) return;
    if (this.step === 0) this.startBar(inst, time);
    const bar = this.current;
    if (bar) scheduleStep(inst, bar.ev, time, bar.sixteenth, this.step);
    this.step = (this.step + 1) % 16;
  };

  private startBar(inst: Instruments, time: number): void {
    if (this.cue !== null) {
      this.cue = null;
      atAudioTime(time, () => this.events.onCue?.(this.cue));
    }
    const looped = this.loop === null ? undefined : this.song.sections[this.loop];
    if (looped && (this.bar < looped.startBar || this.bar >= looped.startBar + looped.bars)) {
      this.bar = looped.startBar;
    }
    if (this.bar >= this.song.totalBars && this.custom) {
      this.bar = 0;
    } else if (this.bar >= this.song.totalBars) {
      this.reference = null;
      this.song = this.compose(nextSeed(this.song.seed));
      this.bar = 0;
      this.applySong(inst);
      const song = this.song;
      atAudioTime(time, () => this.events.onSong?.(song));
    }
    this.applyBpm(time);

    const song = this.song;
    const ev = arrangeBar(song, this.bar);
    this.current = { ev, sixteenth: 60 / song.bpm / 4 };
    this.scheduled.push({ bar: this.bar, time, seconds: (60 / song.bpm) * 4 });
    if (this.scheduled.length > 16) this.scheduled.shift();

    atAudioTime(time, () => this.events.onBar?.(ev, song));
    this.bar++;
  }
}

/**
 * Tone's default context is tuned for live playing: ~6 ms audio buffers and a 100 ms look-ahead.
 * With every instrument running, that left 27–60 ms between scheduling a bar and its first notes,
 * so any main-thread or audio-thread hiccup broke the music up. This is a listening app, and
 * controls act on the next bar anyway: larger buffers and a 300 ms look-ahead cost nothing here.
 */
function useListeningContext(): void {
  Tone.setContext(new Tone.Context({ latencyHint: "playback", lookAhead: 0.3 }));
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
