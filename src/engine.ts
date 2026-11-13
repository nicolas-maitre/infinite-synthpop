/**
 * Plays songs forever: once per bar, asks the arranger for that bar's events, and hands them to the
 * synths a 16th at a time on the Tone.js clock (so an instant switch has nothing left to cancel
 * beyond the clock's look-ahead). When a song ends, composes the next one from a seed derived from
 * the last.
 *
 * Or, in render-ahead mode (ahead.ts), renders the music offline ahead of the speaker and plays the
 * rendered audio, pausing to let the render catch up rather than breaking up. The engine plans what
 * plays (`planFrom`): a song's body, then the transition into the next song. Creator mode and
 * section loops play live (recording needs the live synths).
 */
import { AudioContext as StandardAudioContext } from "standardized-audio-context";
import * as Tone from "tone";
import { AHEAD_SUPPORTED, AheadPlayer, type Deck, type Piece, type RenderMix } from "./ahead";
import { arrangeBar, MELODIC_TRACKS, type BarEvents } from "./arranger";
import { loadSampleKits, type SampleReport } from "./drums";
import type { PartBlends, RefWeights } from "./profile";
import type { GenreId } from "./genres";
import { songSound } from "./profile";
import { scheduleStep } from "./schedule";
import { compose, type ImportedTracks, type KitName, type Song } from "./composer";
import {
  autoTransition,
  glideShape,
  incomingArrange,
  INTRO_BARS,
  keyBefore,
  morphArrange,
  morphSound,
  MORPH_BARS,
  nextKey,
  nextTempo,
  outgoingArrange,
  swapBar,
  PAD_FADE_BARS,
  TAIL_BARS,
  type TransitionStyle,
} from "./dj";
import type { ReferenceId } from "./references";
import { newSongId, type Creation, type SongSpec } from "./spec";
import { autoVolumes, Instruments, type LeadPatch, type Track } from "./instruments";
import { LATENCY, LITE, LITE_SAMPLE_RATE } from "./quality";
import { createRng } from "./rng";
import { TempoMap, type TempoShape } from "./tempo";
import type { Key } from "./theory";

export interface EngineSettings {
  /** The genre generated songs come from (genres.ts), or "auto": one per song. Originals and
   * creations keep their own. */
  genre: GenreId | "auto";
  /** The genre's references' weights (genres.ts); null = a random point of its polygon per song. */
  weights: readonly number[] | null;
  /** A blend across genres (profile.ts), overriding `genre` and `weights`; null: none. */
  blend: RefWeights | null;
  /** With no `blend`: a random point of these references' polygon per song (an open blend on
   * auto); null: none. */
  blendRefs: readonly ReferenceId[] | null;
  /** Per-part blends over the song's (profile.ts); null: every part plays the song's blend. */
  parts: Partial<PartBlends> | null;
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
  /** Render-ahead playback paused to let the render catch up, or went on again. */
  onBuffering?: (buffering: boolean) => void;
  /** DJ mode: a transition into `next` is being heard (`label` names it), or is over (null). */
  onMix?: (mix: { label: string; next: Song } | null) => void;
}

/** The mixer: faders set by hand (the others follow each song's own mix), mutes, solos, master. */
export interface EngineMix {
  manual: Partial<Record<Track, number>>;
  muted: readonly Track[];
  soloed: readonly Track[];
  master: number;
}

/** Where a song in the render-ahead plan came from. `serial` tells one playing of a song from the
 * next; a song recomposed in place (a settings change) keeps it. */
interface SongMeta {
  serial: number;
  reference: ReferenceId | null;
  custom: Creation | null;
  /** DJ mode: the key and tempo the song was composed at (to suit the song before it), kept when
   * it is recomposed; and how its tempo runs (mixed in at the previous song's, gliding to its own). */
  fixed?: { key: Key; bpm: number };
  tempo?: TempoShape;
}

/** DJ mode: where a song hands over (the next song's bar 0 starts at its bar `swap`), and the next
 * song. */
interface DjPlan {
  swap: number;
  style: TransitionStyle;
  next: { song: Song; meta: SongMeta };
}

/** Bars of the next song in a transition piece: enough for the outgoing song's tails to ring out. */
const HANDOFF_BARS = 2;
/** A change to the mixer re-renders once the faders have been still this long. */
const REMIX_DELAY_MS = 300;

/** Fixed seeds for the originals' generated parts (lead melodies, riffs), so each plays the same. */
const REFERENCE_SEEDS: Record<ReferenceId, number> = {
  "true-faith": 1987,
  "different-story": 1989,
  "you-came": 1988,
  // The records' years, but Get Closer (1984 too) takes 1986 to differ from The Night, and Self
  // Control (1984 too) 1983.
  "the-night": 1984,
  faces: 1985,
  "get-closer": 1986,
  "self-control": 1983,
  // Sandra's years are taken too: 1986 and 1988, then the order on their albums.
  "innocent-love": 19861,
  "heaven-can-wait": 19881,
  "crazy-juliet": 19882,
};

export function nextSeed(seed: number): number {
  return createRng(seed).fork("next-song").int(0, 999_999);
}

export class Engine {
  song: Song;
  instruments: Instruments | null = null;
  /** Where each kit's drum samples came from (drums.ts), once loaded. */
  samples: Record<string, SampleReport> = {};
  private bar = 0;
  private repeatId: number | null = null;
  /** Set while one of the originals plays; cleared when the next generated song starts. */
  private reference: ReferenceId | null = null;
  private leadPatch: LeadPatch = "voice";
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
  private contextReady = false;
  /** Render-ahead (ahead.ts): asked for, and held off (creator mode plays live). */
  private renderAhead = false;
  private liveOnly = false;
  private bufferSeconds = 20;
  private player: AheadPlayer<SongMeta> | null = null;
  private mix: EngineMix = { manual: {}, muted: [], soloed: [], master: 0 };
  private remixTimer: ReturnType<typeof setTimeout> | null = null;
  /** The playing song's serial (SongMeta), and the last one handed out. */
  private serial = 0;
  private serials = 0;
  /** In render-ahead mode, the piece a cued switch starts. */
  private cuedPiece: Piece<SongMeta> | null = null;
  /** DJ mode: each song plays a while, then mixes into the next (dj.ts). Plays render ahead. */
  private dj = false;
  /** How DJ mode hands over: one style throughout, or auto's pick per transition. */
  private djStyle: TransitionStyle | "auto" = "auto";
  /** The playing song's DJ key and tempo, and its tempo's run (SongMeta). */
  private fixed: SongMeta["fixed"];
  private tempo: TempoShape | undefined;
  /** Each song's DJ plan, made once (a re-plan mid-transition plans the same one). */
  private djPlans = new WeakMap<Song, DjPlan>();
  /** The song a transition being heard mixes into. */
  private mixing: Song | null = null;

  constructor(
    private settings: EngineSettings,
    seed: number,
    private readonly events: EngineEvents = {},
  ) {
    this.song = this.compose(seed);
  }

  get playing(): boolean {
    return this.repeatId !== null || this.player !== null;
  }

  /** The spectrum and waveform of what plays, for the visualizer; null when stopped. */
  get analysers(): { fft: Tone.Analyser; waveform: Tone.Analyser } | null {
    if (this.player) return this.player;
    return this.instruments && this.repeatId !== null ? this.instruments : null;
  }

  /** While rendering ahead: seconds rendered ahead of the speaker, and whether it is paused for
   * the render to catch up. Null when playing live or stopped. */
  get aheadStatus(): { seconds: number; buffering: boolean } | null {
    return this.player
      ? { seconds: this.player.ahead(), buffering: this.player.isBuffering }
      : null;
  }

  /** Render the music ahead of the speaker instead of playing the synths live (when the browser
   * can, and outside creator mode and loops). */
  setRenderAhead(on: boolean): void {
    this.renderAhead = on;
    this.syncMode();
  }

  /** Holds render-ahead off (creator mode: recording needs the live synths). */
  setLiveOnly(on: boolean): void {
    this.liveOnly = on;
    this.syncMode();
  }

  /** How far ahead to render (seconds). */
  setBufferSeconds(seconds: number): void {
    this.bufferSeconds = seconds;
    this.player?.setWindow(seconds);
  }

  /**
   * The mixer. Live, it applies at once; rendering ahead, a change re-renders from a bar line a
   * few seconds on (the master volume still applies at once).
   */
  setMix(mix: EngineMix): void {
    const changed =
      JSON.stringify({ ...mix, master: 0 }) !== JSON.stringify({ ...this.mix, master: 0 });
    this.mix = { ...mix, manual: { ...mix.manual } };
    if (this.instruments && this.repeatId !== null) this.applyMix(this.instruments);
    this.player?.setMaster(mix.master);
    if (changed && this.player) {
      if (this.remixTimer !== null) clearTimeout(this.remixTimer);
      this.remixTimer = setTimeout(() => {
        this.remixTimer = null;
        this.rerender();
      }, REMIX_DELAY_MS);
    }
  }

  /** DJ mode: each song plays long enough to give its gist, then mixes into the next one. It
   * plays render ahead, whatever the Playback setting. */
  setDj(on: boolean): void {
    if (on === this.dj) return;
    this.dj = on;
    if (this.player && this.wantsAhead()) this.rerender();
    else this.syncMode();
  }

  /** The DJ's transition style, from the next transition planned on (one being heard, or
   * planned for the playing song, stays as it is). */
  setDjStyle(style: TransitionStyle | "auto"): void {
    this.djStyle = style;
  }

  private wantsAhead(): boolean {
    return AHEAD_SUPPORTED && (this.renderAhead || this.dj) && !this.liveOnly && this.loop === null;
  }

  /** Moves playback between live and render-ahead when the mode changes while playing, from the
   * next bar. */
  private syncMode(): void {
    if (!this.playing || this.wantsAhead() === (this.player !== null)) return;
    this.halt();
    void this.run().catch((error: unknown) => console.error("Couldn't switch playback", error));
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

  /**
   * Must be called from a user gesture (browsers block audio until then). The first time, it
   * loads the instruments and samples, telling `onProgress` how many samples are settled.
   */
  async start(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.playing) return;
    await this.run(onProgress);
    this.events.onStateChange?.(true);
  }

  /** Starts playing from `this.bar`, live or rendering ahead. */
  private async run(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!this.contextReady) {
      useListeningContext();
      this.contextReady = true;
    }
    await Tone.start();
    if (this.wantsAhead()) {
      // The renders load the samples too; loading them here reports them (and their progress).
      if (!Object.keys(this.samples).length) {
        this.samples = (await loadSampleKits(onProgress)).report;
      }
      this.startAhead();
      return;
    }
    if (!this.instruments) {
      const inst = Instruments.create({ lite: LITE });
      await inst.ready;
      this.instruments = inst;
      this.samples = await inst.drums.loadAll(onProgress);
    }
    this.applySong(this.instruments);
    this.applyMix(this.instruments);
    const transport = Tone.getTransport();
    this.appliedBpm = 0;
    this.applyBpm(Tone.now());
    this.step = 0;
    this.repeatId = transport.scheduleRepeat(this.tick, "16n", 0);
    transport.start("+0.1");
  }

  private startAhead(): void {
    const player = new AheadPlayer<SongMeta>({
      lite: LITE,
      window: this.bufferSeconds,
      mix: this.renderMix(),
      master: this.mix.master,
      events: {
        plan: (after) => this.planAfter(after),
        onBar: (piece, deck, bar, time) => this.aheadBar(piece, deck, bar, time),
        onBuffering: (buffering) => this.events.onBuffering?.(buffering),
      },
    });
    this.player = player;
    player.start(this.planFrom(this.song, this.bar, this.meta(), 0));
  }

  /**
   * Reopens the sound output after the page was hidden. When the screen locks, Firefox on Android
   * loses the output but keeps the audio clock running, so the song moved on silently and stayed
   * silent after unlocking. Suspending and resuming the context makes Firefox reopen the output
   * (and resumes a context the browser suspended or interrupted itself).
   */
  async wake(): Promise<void> {
    if (!this.instruments) return;
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    try {
      if (raw.state === "running") await raw.suspend();
      await raw.resume();
    } catch (error) {
      console.error("Couldn't wake the audio", error);
    }
  }

  stop(): void {
    if (!this.playing) return;
    this.halt();
    if (this.cue !== null) {
      this.cue = null;
      this.events.onCue?.(null);
    }
    // Resume from the top of the section we stopped in.
    this.bar =
      this.song.sections[sectionIndex(this.song, Math.max(0, this.bar - 1))]?.startBar ?? 0;
    this.events.onStateChange?.(false);
  }

  /** Stops the sound, live or rendered, leaving the play position where it is. */
  private halt(): void {
    if (this.repeatId !== null) {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      this.repeatId = null;
      this.current = null;
      this.instruments?.releaseAll();
    }
    if (this.player) {
      this.player.stop();
      this.player = null;
      this.cuedPiece = null;
      if (this.remixTimer !== null) clearTimeout(this.remixTimer);
      this.remixTimer = null;
      this.events.onBuffering?.(false);
    }
    this.setMixing(null);
  }

  /** Jumps to a new song (random or given seed) at the next bar line. */
  newSong(seed: number): void {
    this.reference = null;
    this.custom = null;
    this.fixed = this.tempo = undefined;
    this.loop = null;
    this.serial = ++this.serials;
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
    this.fixed = this.tempo = undefined;
    this.loop = null;
    this.reference = id;
    this.serial = ++this.serials;
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
    this.fixed = this.tempo = undefined;
    // Each creation gets an id the first time it plays, for its entry in My songs.
    this.custom = creation.id ? creation : { ...creation, id: newSongId() };
    this.song = this.compose(creation.seed);
    if (!keepPosition || this.bar >= this.song.totalBars) this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    if (!keepPosition) {
      this.serial = ++this.serials;
      this.switched();
    } else this.rerender();
    this.events.onSong?.(this.song);
  }

  /** Applies an edit to the playing creation from the next bar, keeping the play position. */
  editCustom(spec: SongSpec): void {
    if (!this.custom) return;
    this.custom = { ...this.custom, spec };
    this.song = this.compose(this.custom.seed);
    if (this.bar >= this.song.totalBars) this.bar = 0;
    if (this.instruments) this.applySong(this.instruments);
    this.rerender();
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
    this.syncMode();
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
    else {
      if (this.cue !== null && this.player) this.cutAhead(false);
      this.events.onCue?.(this.cue);
    }
  }

  /**
   * Instant switch: restarts the clock right away from `this.bar`. What the synths already hold
   * (up to the clock's look-ahead) still plays; then everything is released just before the new
   * bar's first notes. Notes the polyphonic synths were about to start are caught by a second
   * release once they have.
   */
  private restart(): void {
    if (this.player) {
      this.cue = null;
      this.cutAhead(true);
      return;
    }
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
   * the form; the weights can reshape it, so the play position is clamped into the new song.
   */
  /** The sung lead's sound (the Lead setting). It changes no song, so it applies right away. */
  setLeadPatch(patch: LeadPatch): void {
    this.leadPatch = patch;
    this.instruments?.setLeadPatch(patch);
    this.rerender();
  }

  update(settings: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.song = this.compose(this.song.seed);
    if (this.bar >= this.song.totalBars) this.bar = this.song.sections.at(-1)?.startBar ?? 0;
    if (this.instruments) this.applySong(this.instruments);
    // A new tempo starts at the next bar line (applyBpm), keeping the bar's 16ths even.
    this.rerender();
    this.events.onSong?.(this.song);
  }

  private compose(
    seed: number,
    reference: ReferenceId | null = this.reference,
    custom: Creation | null = this.custom,
    fixed: SongMeta["fixed"] | null = this.fixed ?? null,
  ): Song {
    const song = compose({
      seed,
      ...this.settings,
      // A DJ's key and tempo, unless the settings fix them.
      key: this.settings.key ?? fixed?.key ?? null,
      bpm: this.settings.bpm ?? fixed?.bpm ?? null,
      weights: this.settings.weights ?? "auto",
      reference,
      custom: custom?.spec ?? null,
    });
    const imported = reference ? this.imported[reference] : undefined;
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
      if (this.instruments) this.applySong(this.instruments);
      this.rerender();
      this.events.onSong?.(this.song);
    }
  }

  /** Points the instruments at the current song: its drum machine, bass tone, and the tracks it
   * plays (the others are disconnected). */
  private applySong(inst: Instruments): void {
    inst.drums.use(this.effectiveKit());
    inst.setLeadPatch(this.leadPatch);
    const sound = songSound(this.song);
    inst.setBassTone(sound.bassTone);
    inst.setLeadTone(sound.leadTone);
    inst.setSnareGate(sound.drums.gatedSnare);
    inst.drums.setKickWeight(sound.drums.kickWeight ?? 0);
    inst.setVoices(sound.voices);
    inst.setActiveTracks(usedTracks(this.song));
  }

  /** The mixer onto the live instruments: the playing song's own mix for the faders on auto. */
  private applyMix(inst: Instruments): void {
    const volumes = {
      ...autoVolumes(songSound(this.song).mix),
      ...this.mix.manual,
    };
    for (const [track, db] of Object.entries(volumes) as [Track, number][]) {
      const ch = inst.channels[track];
      ch.volume.value = db;
      ch.mute = this.mix.muted.includes(track);
      ch.solo = this.mix.soloed.includes(track);
    }
    inst.master.volume.value = this.mix.master;
  }

  // ── Render-ahead: planning what plays ─────────────────────────────────────────────────────

  private meta(): SongMeta {
    return {
      serial: this.serial,
      reference: this.reference,
      custom: this.custom,
      ...(this.fixed && { fixed: this.fixed }),
      ...(this.tempo && { tempo: this.tempo }),
    };
  }

  /** How a song's tempo runs: its DJ glide while that still ends on its tempo (a Tempo setting
   * changed since replaces it), else steady. */
  private shapeFor(song: Song, meta: SongMeta): TempoShape {
    const t = meta.tempo;
    return t && (t.glide?.to ?? t.bpm) === song.bpm ? t : { bpm: song.bpm };
  }

  /**
   * DJ mode: where `song` hands over, and the song after it, composed at a tempo within reach of
   * this one's and a key that mixes from it (dj.ts). Null outside DJ mode and for creations (they
   * loop).
   */
  private djPlan(song: Song, meta: SongMeta): DjPlan | null {
    if (!this.dj || meta.custom) return null;
    const cached = this.djPlans.get(song);
    if (cached) return cached;
    const rng = createRng(song.seed).fork("dj");
    const shape = this.shapeFor(song, meta);
    const glideEnd = shape.glide ? shape.glide.start + shape.glide.bars : 0;
    const swap = swapBar(song, rng, glideEnd + Math.max(INTRO_BARS, MORPH_BARS));
    const seed = nextSeed(song.seed);
    const own = this.compose(seed, null, null, null);
    const from = new TempoMap(0, shape).bpmAt(swap - 1);
    const fixed = {
      key: nextKey(keyBefore(song, swap), own.key, rng),
      bpm: nextTempo(from, own.bpm),
    };
    const next = this.compose(seed, null, null, fixed);
    const style =
      this.djStyle === "auto"
        ? autoTransition(song, next, keyBefore(song, swap), from)
        : this.djStyle;
    const plan: DjPlan = {
      swap,
      style,
      next: {
        song: next,
        meta: {
          serial: ++this.serials,
          reference: null,
          custom: null,
          fixed,
          tempo: glideShape(from, next.bpm, next.totalBars),
        },
      },
    };
    this.djPlans.set(song, plan);
    return plan;
  }

  private renderMix(): RenderMix {
    const { manual, muted, soloed } = this.mix;
    return { manual, muted, soloed, leadPatch: this.leadPatch };
  }

  /**
   * The piece that plays `song` from `bar`, starting at `at` on the timeline: the song's body up
   * to its last bar, or, from there, the transition into the next song. This is where a DJ mode
   * would plan its own transitions (longer overlaps, a mix-out point).
   */
  private planFrom(song: Song, bar: number, meta: SongMeta, at: number): Piece<SongMeta> {
    const plan = this.djPlan(song, meta);
    if (plan) return this.planDj(song, bar, meta, at, plan);
    if (bar >= song.totalBars) {
      const next = this.following(song, meta);
      return this.planFrom(next.song, 0, next.meta, at);
    }
    const clock = TempoMap.anchored(this.shapeFor(song, meta), bar, at);
    const last = song.totalBars - 1;
    if (bar < last) {
      return {
        decks: [{ song, clock, from: bar, to: last, shown: [bar, last], meta }],
        start: at,
        end: clock.time(last),
      };
    }
    // The last bar, with the next song's first bars under its tails.
    const end = clock.time(song.totalBars);
    const next = this.following(song, meta);
    const bars = Math.min(HANDOFF_BARS, next.song.totalBars - 1);
    const nextClock = TempoMap.anchored(this.shapeFor(next.song, next.meta), 0, end);
    return {
      decks: [
        { song, clock, from: last, to: song.totalBars, shown: [last, song.totalBars], meta },
        { song: next.song, clock: nextClock, from: 0, to: bars, shown: [0, bars], meta: next.meta },
      ],
      start: clock.time(last),
      end: nextClock.time(bars),
    };
  }

  /**
   * DJ mode: the song's body up to the mix-in intro, then the transition: the outgoing song to the
   * swap (its pads fading out past it), the incoming one from its mix-in intro to a few bars past
   * its bar 0, at the
   * outgoing song's tempo (dj.ts).
   */
  private planDj(
    song: Song,
    bar: number,
    meta: SongMeta,
    at: number,
    plan: DjPlan,
  ): Piece<SongMeta> {
    const { next } = plan;
    // Past the planned swap (a jump there): the song plays on and mixes over its end.
    const swap = bar < plan.swap ? plan.swap : song.totalBars;
    if (bar >= swap) return this.planFrom(next.song, 0, next.meta, at);
    const clock = TempoMap.anchored(this.shapeFor(song, meta), bar, at);
    if (plan.style === "morph") return this.planMorph(song, bar, meta, clock, swap, next);
    const mixFrom = swap - INTRO_BARS;
    if (bar < mixFrom) {
      return {
        decks: [{ song, clock, from: bar, to: mixFrom, shown: [bar, mixFrom], meta }],
        start: at,
        end: clock.time(mixFrom),
      };
    }
    const nextClock = TempoMap.anchored(this.shapeFor(next.song, next.meta), 0, clock.time(swap));
    const tail = Math.min(TAIL_BARS, next.song.totalBars - 1);
    return {
      decks: [
        {
          song,
          clock,
          from: bar,
          to: Math.min(swap + PAD_FADE_BARS, song.totalBars),
          shown: [bar, swap],
          meta,
          arrange: outgoingArrange(song, swap, next.song),
        },
        {
          song: next.song,
          clock: nextClock,
          from: bar - swap,
          first: -INTRO_BARS,
          to: tail,
          shown: [0, tail],
          meta: next.meta,
          arrange: incomingArrange(next.song),
        },
      ],
      start: at,
      end: nextClock.time(tail),
      label: "Mixing",
    };
  }

  /**
   * A DJ morph: the song's body up to the morph window, then the window on one deck (its sound
   * gliding to the next song's, its last phrase thinning out), then a handoff into the next
   * song's intro, with the outgoing tails ringing out (dj.ts).
   */
  private planMorph(
    song: Song,
    bar: number,
    meta: SongMeta,
    clock: TempoMap,
    swap: number,
    next: { song: Song; meta: SongMeta },
  ): Piece<SongMeta> {
    const at = clock.time(bar);
    const mixFrom = swap - MORPH_BARS;
    if (bar < mixFrom) {
      return {
        decks: [{ song, clock, from: bar, to: mixFrom, shown: [bar, mixFrom], meta }],
        start: at,
        end: clock.time(mixFrom),
      };
    }
    const arrange = morphArrange(song, swap);
    const sound = morphSound(song, next.song, swap);
    const last = swap - 1;
    if (bar < last) {
      return {
        decks: [{ song, clock, from: bar, to: last, shown: [bar, last], meta, arrange, sound }],
        start: at,
        end: clock.time(last),
        label: "Morphing",
        into: next.song,
      };
    }
    const nextClock = TempoMap.anchored(this.shapeFor(next.song, next.meta), 0, clock.time(swap));
    const tail = Math.min(HANDOFF_BARS, next.song.totalBars - 1);
    return {
      decks: [
        { song, clock, from: last, to: swap, shown: [last, swap], meta, arrange, sound },
        {
          song: next.song,
          clock: nextClock,
          from: 0,
          to: tail,
          shown: [0, tail],
          meta: next.meta,
          arrange: incomingArrange(next.song),
        },
      ],
      start: at,
      end: nextClock.time(tail),
      label: "Morphing",
    };
  }

  /**
   * Dev only: the pieces a DJ plays around the transition out of the song with this seed, from
   * `before` bars ahead of its mix-in intro to `after` bars into the next song.
   */
  djPreview(
    seed: number,
    before = 8,
    after = 16,
    style: TransitionStyle | "auto" = this.djStyle,
  ): { pieces: Piece<SongMeta>[]; mix: RenderMix; style: TransitionStyle } {
    const was = { dj: this.dj, style: this.djStyle };
    this.dj = true;
    this.djStyle = style;
    try {
      const song = this.compose(seed, null, null, null);
      const meta: SongMeta = { serial: -1, reference: null, custom: null };
      const plan = this.djPlan(song, meta)!;
      const window = plan.style === "morph" ? MORPH_BARS : INTRO_BARS;
      const pieces = [this.planFrom(song, Math.max(0, plan.swap - window - before), meta, 0)];
      for (;;) {
        const piece = pieces.at(-1)!;
        const deck = piece.decks.at(-1)!;
        if (deck.song === plan.next.song && deck.clock.barAt(piece.end) >= after - 1e-6) break;
        const next = this.planAfter(piece);
        const d = next.decks.at(-1)!;
        if (d.song === plan.next.song && d.to > after) {
          d.to = after;
          next.end = d.clock.time(after);
        }
        pieces.push(next);
      }
      return { pieces, mix: this.renderMix(), style: plan.style };
    } finally {
      this.dj = was.dj;
      this.djStyle = was.style;
    }
  }

  /** What follows a piece: the rest of its last deck's song (or what follows that). */
  private planAfter(piece: Piece<SongMeta>): Piece<SongMeta> {
    const deck = piece.decks.at(-1)!;
    const bar = Math.round(deck.clock.barAt(piece.end));
    return this.planFrom(deck.song, bar, deck.meta, piece.end);
  }

  /** The song after this one: a creation loops; otherwise a new song from the next seed. */
  private following(song: Song, meta: SongMeta): { song: Song; meta: SongMeta } {
    if (meta.custom) return { song, meta };
    const serial = ++this.serials;
    return {
      song: this.compose(nextSeed(song.seed), null, null, null),
      meta: { serial, reference: null, custom: null },
    };
  }

  /**
   * A switch (another song, a jump) while rendering ahead: from the next bar line, or at once,
   * the timeline is planned again from `this.bar` of `this.song`.
   */
  private cutAhead(now: boolean): void {
    const player = this.player;
    if (!player) return;
    const soon = player.playhead() + 0.1;
    const time = now ? soon : (player.barLineAfter(soon)?.time ?? soon);
    const piece = this.planFrom(this.song, this.bar, this.meta(), time);
    this.cuedPiece = now ? null : piece;
    player.cut(time, piece);
  }

  /**
   * A change to what plays here and now (settings, the mixer, the lead sound) while rendering
   * ahead: everything is rendered again from the first bar line the new render can reach in time,
   * keeping the position.
   */
  private rerender(): void {
    const player = this.player;
    if (!player) return;
    player.setMix(this.renderMix());
    // A pending switch is re-planned with the change.
    if (this.cue !== null) {
      this.cutAhead(false);
      return;
    }
    // Late enough for the new render to be ready by then, so playback doesn't pause for it.
    const line = player.barLineAfter(player.readyAfter()) ?? player.barLineAfter(player.playhead());
    if (!line) return;
    const { deck, bar } = line;
    // The playing song as just recomposed; a later one (already planned) recomposed the same way.
    const song =
      deck.meta.serial === this.serial
        ? this.song
        : this.compose(
            deck.song.seed,
            deck.meta.reference,
            deck.meta.custom,
            deck.meta.fixed ?? null,
          );
    const meta = deck.meta.serial === this.serial ? this.meta() : deck.meta;
    player.cut(line.time, this.planFrom(song, bar, meta, line.time));
  }

  /** A bar starts being heard (render-ahead): the engine follows it as the live clock does. */
  private aheadBar(piece: Piece<SongMeta>, deck: Deck<SongMeta>, bar: number, time: number): void {
    if (this.cue !== null) {
      // Bars of what played before a cued switch are stale once the switch is due.
      if (piece !== this.cuedPiece) return;
      this.cue = null;
      this.cuedPiece = null;
      this.events.onCue?.(null);
    }
    if (deck.meta.serial !== this.serial) {
      // The next song, as the live engine moves on to it.
      this.serial = deck.meta.serial;
      this.song = deck.song;
      this.reference = deck.meta.reference;
      this.custom = deck.meta.custom;
      this.fixed = deck.meta.fixed;
      this.tempo = deck.meta.tempo;
      this.events.onSong?.(this.song);
    }
    // A DJ transition is heard while its outgoing song's bars are.
    const incoming =
      piece.label && piece.decks[0] === deck ? (piece.decks[1]?.song ?? piece.into) : undefined;
    this.setMixing(incoming ?? null, piece.label);
    const song = this.song;
    const ev = arrangeBar(song, Math.min(bar, song.totalBars - 1));
    this.bar = bar + 1;
    this.scheduled.push({ bar, time, seconds: deck.clock.barSeconds(bar) });
    if (this.scheduled.length > 16) this.scheduled.shift();
    this.events.onBar?.(ev, song);
  }

  private setMixing(next: Song | null, label = "Mixing"): void {
    if (next === this.mixing) return;
    this.mixing = next;
    this.events.onMix?.(next ? { label, next } : null);
  }

  private effectiveKit(): KitName {
    const kit = this.song.kit;
    return kit !== "synth" && !this.instruments?.drums.hasSamples(kit) ? "synth" : kit;
  }

  private applyBpm(time: number): void {
    if (this.appliedBpm === this.song.bpm) return;
    Tone.getTransport().bpm.setValueAtTime(this.song.bpm, time);
    this.instruments?.setTempo(this.song.bpm);
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
      this.fixed = this.tempo = undefined;
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
 * Lite mode (phones) also runs the graph at a lower sample rate (quality.ts). That context comes
 * from standardized-audio-context, as Tone's own does: Tone checks nodes and params against that
 * library's types, which a browser's own AudioContext fails in Firefox ("param must be an
 * AudioParam").
 */
function useListeningContext(): void {
  const latencyHint = LATENCY ?? "playback";
  let context: StandardAudioContext | undefined;
  if (LITE || LATENCY !== undefined) {
    const sampleRate = LITE ? LITE_SAMPLE_RATE : undefined;
    try {
      context = new StandardAudioContext({ latencyHint, ...(sampleRate && { sampleRate }) });
    } catch {
      // A browser that refuses the rate or buffer gets its defaults.
    }
  }
  // Tone types its option as the browser's AudioContext, though it wraps this library's own.
  const raw = context as unknown as AudioContext | undefined;
  Tone.setContext(
    new Tone.Context({ latencyHint: "playback", lookAhead: 0.3, ...(raw && { context: raw }) }),
  );
}

/** The mixer tracks that play anywhere in the song. */
function usedTracks(song: Song): Set<Track> {
  const used = new Set<Track>();
  for (let bar = 0; bar < song.totalBars; bar++) {
    const ev = arrangeBar(song, bar);
    if (ev.drums.length) used.add("drums");
    for (const t of MELODIC_TRACKS) {
      if (ev.notes[t].length) used.add(t === "leadOct" ? "lead" : t);
    }
  }
  return used;
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
