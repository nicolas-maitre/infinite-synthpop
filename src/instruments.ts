/**
 * Synth voices, effect buses and the mixer. Each voice is modelled on the gear in
 * docs/analysis.md §4: DX-style FM bass, chorused melodic bass, Emulator/Voyetra-ish pad, FM riff,
 * a singing mono lead, an electric-piano counter-line, FM bell arp, and saw-brass stabs.
 */
import * as Tone from "tone";
import type { DrumHit, MelodicTrack } from "./arranger";
import type { Note } from "./composer";
import { DrumKit } from "./drums";
import { FixedEQ3, FixedFilter } from "./filters";
import { SYNTHPOP_VOICES, type BassTone, type LeadTone, type Voices } from "./genres";
import { NativeFMSynth, NativeMonoSynth, NativeSynth } from "./voices";
import { midiToFreq } from "./theory";

export const TRACKS = [
  "drums",
  "bass",
  "seq",
  "guitar",
  "hook",
  "pad",
  "riff",
  "lead",
  "counter",
  "arp",
  "stab",
  "synth",
] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  drums: "Drums",
  bass: "Seq bass",
  seq: "Sequence",
  guitar: "Guitar",
  hook: "Melodic bass",
  pad: "Pad",
  riff: "Riff",
  lead: "Voice",
  counter: "Counter line",
  arp: "Arp",
  stab: "Stabs",
  synth: "Lead synth",
};

export const DEFAULT_VOLUMES: Record<Track, number> = {
  drums: -3,
  bass: -10,
  seq: -15,
  guitar: -9,
  hook: -9,
  pad: -10,
  riff: -8,
  lead: -6,
  counter: -9,
  arp: -9,
  stab: -5,
  synth: -8,
};

/**
 * The fader levels a song plays at while its faders are on auto: the defaults, moved by its
 * genre's mix at its style (genres.ts `mixAt`), and kept within the fader's travel.
 */
export function autoVolumes(offsets: Partial<Record<Track, number>> = {}): Record<Track, number> {
  return Object.fromEntries(
    TRACKS.map((t) => [t, Math.min(0, DEFAULT_VOLUMES[t] + (offsets[t] ?? 0))]),
  ) as Record<Track, number>;
}

/**
 * Gain (dB) inside the arp and stab synths. Both used to sit about 30 dB under a chorus, too
 * quiet to hear; they now sit 16–18 dB under it, picked by ear from renders. The faders top
 * out at 0 dB, so the extra level lives here and leaves the faders room above.
 */
const ARP_STAB_GAIN_DB = 6;

/** Old default fader levels, moved to the new defaults when found in saved preferences. */
export const PREVIOUS_DEFAULT_VOLUMES: Partial<Record<Track, number>> = { arp: -16, stab: -14 };

/** Spread the motif layers across the stereo field; bass, lead and drums stay centred. */
const PANS: Record<Track, number> = {
  drums: 0,
  bass: 0,
  seq: 0.2,
  guitar: -0.25,
  hook: -0.15,
  pad: 0,
  riff: -0.3,
  lead: 0,
  counter: -0.2,
  arp: 0.35,
  stab: 0.1,
  synth: 0,
};

/** The lead's reverb send on its own track (SENDS.lead), which the synth lead keeps. */
const SENDS_LEAD_REVERB = 0.35;

/** The voice compressor's makeup gain (see applyLeadTone). */
const LEAD_COMP_MAKEUP_DB = 6;

/** Post-fader send levels (gain) to the reverb and delay buses. */
const SENDS: Record<Track, { reverb: number; delay: number }> = {
  drums: { reverb: 0.08, delay: 0 },
  bass: { reverb: 0, delay: 0 },
  seq: { reverb: 0.25, delay: 0.12 },
  guitar: { reverb: 0.18, delay: 0 },
  hook: { reverb: 0.2, delay: 0.05 },
  pad: { reverb: 0.45, delay: 0 },
  riff: { reverb: 0.3, delay: 0.25 },
  lead: { reverb: SENDS_LEAD_REVERB, delay: 0.2 },
  counter: { reverb: 0.45, delay: 0.15 },
  arp: { reverb: 0.4, delay: 0.3 },
  stab: { reverb: 0.5, delay: 0.1 },
  // The Night's lead synth: Get Closer's hook patch with its own echo, sent like the riff it came
  // from (picked by ear that way, clip 6b2 in docs/italo/mix.md).
  synth: { reverb: 0.3, delay: 0.25 },
};

/**
 * The sung lead's sound (setLeadPatch, the Lead setting):
 * - "voice": one saw through three vowel formants that move from note to note (a line moves
 *   through vowels the way words do), a breath of noise, a little glide, and a vibrato that sets
 *   in after the attack, slower and wider than the synth's (The Night's singer: 3.7 Hz, ±15–20
 *   cents);
 * - "synth": the original lead, portamento and a constant 5.2 Hz vibrato on two detuned saws.
 */
export type LeadPatch = "voice" | "synth";
export const LEAD_PATCHES: readonly LeadPatch[] = ["voice", "synth"];

interface LeadSettings {
  oscillator: Tone.OmniOscillatorOptions;
  /** The synth's own filter: where its envelope starts, and how far it opens (octaves). */
  filterBase: number;
  filterOctaves: number;
  /** The low-pass after it all. */
  cutoff: number;
  /** A sung note's share of its length: the rest is the gap between words. */
  legato: number;
  /** Breath in the air band (sibilance), above 5 kHz. */
  air: number;
  /** Send to the reverb. */
  reverb: number;
  /** Whether the genre's lead tone (setLeadTone) applies. */
  mixed: boolean;
  portamento: number;
  /** The unshaped synth's share, and the formant bank's. */
  dry: number;
  formants: number;
  breath: number;
  vibratoHz: number;
  /** Vibrato depth once it has set in (Tone.Vibrato's 0–1: 0.73 / Hz is about ±20 cents). */
  vibratoDepth: number;
  /** Whether the vibrato waits for the attack. */
  vibratoDelay: boolean;
}

const LEAD_SETTINGS: Record<LeadPatch, LeadSettings> = {
  voice: {
    oscillator: { type: "sawtooth" } as Tone.OmniOscillatorOptions,
    // Open, with air and gaps: the records' vocal stems keep 5–10 kHz within 8–18 dB of their
    // 250 Hz–1 kHz band, and dip 11–16 dB between words (compare_voice.py).
    filterBase: 2600,
    filterOctaves: 2,
    cutoff: 11000,
    legato: 0.82,
    // 16 dB under the 0.2 it was matched at: the breath's noise enters before the high shelf, so
    // the genres' boosts lifted it into a steady hiss over every note from 2 kHz up, as loud as
    // the voice's own highs (28 dB under its body; now 42). Chosen by ear (clips 2a, 2e, 2c).
    air: 0.2 * Tone.dbToGain(-16),
    reverb: 0.22,
    mixed: true,
    portamento: 0.06,
    // Level-matched to the synth lead (a solo render measured it 4.9 LU louder at 0.15 and 1).
    dry: 0.085,
    formants: 0.57,
    breath: 0.07,
    vibratoHz: 4.2,
    vibratoDepth: 0.17,
    vibratoDelay: true,
  },
  synth: {
    oscillator: { type: "fatsawtooth", count: 2, spread: 14 } as Tone.OmniOscillatorOptions,
    filterBase: 1100,
    filterOctaves: 2.2,
    cutoff: 4500,
    legato: 1,
    air: 0,
    reverb: SENDS_LEAD_REVERB,
    mixed: false,
    portamento: 0.045,
    dry: 1,
    formants: 0,
    breath: 0,
    vibratoHz: 5.2,
    vibratoDepth: 0.07,
    vibratoDelay: false,
  },
};

/** Vowel formants F1–F3 (Hz) of a high voice: "ah", "oh", "eh", "ee"-ish and "aw". A note takes
 * one, so a line moves through vowels the way words do. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [800, 1150, 2900],
  [500, 900, 2800],
  [600, 1750, 2700],
  [420, 2000, 2850],
  [650, 1000, 2700],
];

export interface InstrumentOptions {
  /** Lighter voices and effects, for phones (quality.ts). Offline renders always use the full set. */
  lite?: boolean;
}

/** How long a track keeps sounding after a song stops using it (the bar still playing, release
 * tails), before it is disconnected so the browser stops processing it. */
const UNUSED_TRACK_DELAY_MS = 5000;

/**
 * The master's soft clipper, in the current context: linear below -2 dBFS, rounding off anything
 * above toward a -0.5 dBFS ceiling, up to +6 dB in (the halving gain keeps that inside the
 * shaper's ±1 input). Oversampled, so rounding off bright peaks (the voice's air, the hats)
 * doesn't alias into harsh distortion; lite skips it for CPU. Oversampling's filters overshoot the
 * curve's −0.5 dBFS ceiling by up to 0.5 dB (renders of The Night and Faces touched full scale),
 * so its output comes down 0.6 dB to keep the peaks under 0 dBFS. Also on the sum of a DJ's two
 * decks (ahead.ts).
 */
export function softClipper(lite: boolean): [Tone.Gain, Tone.WaveShaper, Tone.Gain] {
  const knee = 0.79;
  const ceiling = 0.944;
  const softClip = new Tone.WaveShaper((x) => {
    const v = Math.abs(x * 2);
    const y = v <= knee ? v : knee + (ceiling - knee) * Math.tanh((v - knee) / (ceiling - knee));
    return Math.sign(x) * y;
  }, 4096);
  if (!lite) softClip.oversample = "2x";
  const overshoot = new Tone.Gain(lite ? 1 : Tone.dbToGain(-0.6));
  return [new Tone.Gain(0.5), softClip, overshoot];
}

export class Instruments {
  readonly channels: Record<Track, Tone.Channel>;
  readonly master = new Tone.Volume(0);
  readonly fft = new Tone.Analyser("fft", 256);
  readonly waveform = new Tone.Analyser("waveform", 1024);
  readonly drums = new DrumKit();
  /** Resolves once the reverbs' impulse responses are generated. */
  readonly ready: Promise<void>;

  private readonly gate = new Tone.Gain(0);
  private readonly bassFm: Tone.FMSynth;
  private readonly bassSaw: Tone.MonoSynth;
  /** You Came's octave layer: a second saw an octave up (see setBassTone). */
  private readonly bassOct: Tone.MonoSynth;
  private readonly bassOctLevel = new Tone.Gain(0);
  private bassOctOn = false;
  /** Whether snare and clap hits open the gated reverb (see setSnareGate). */
  private snareGated = true;
  private readonly bassTone: Tone.OnePoleFilter;
  private readonly bassPresence: FixedFilter;
  /** Self Control's low cut (setBassTone): two high-passes, switched in place of a straight path,
   * so the other basses stay bit for bit what they were. */
  private readonly bassLowCut: { filters: FixedFilter[]; cut: Tone.Gain; through: Tone.Gain };
  private readonly hook: Tone.MonoSynth;
  private readonly pad: NativeSynth;
  private readonly riffFm: NativeFMSynth;
  private readonly riffSaw: NativeSynth;
  private readonly lead: Tone.MonoSynth;
  private readonly leadOct: Tone.MonoSynth;
  /** The voice's mix (setLeadTone): level, shelves, width. */
  private readonly leadMix: {
    level: Tone.Gain;
    low: Tone.Filter;
    mid: Tone.Filter;
    high: Tone.Filter;
    width: Tone.Gain;
    cutoff: Tone.Filter;
    air: Tone.Gain;
    comp: Tone.Compressor;
    makeup: Tone.Gain;
  };
  private leadTone: LeadTone = { level: 0, low: 0, mid: 0, high: 0, air: 0, width: 0 };
  /** The sung lead's voice: vibrato, formants and breath (setLeadPatch). */
  private readonly leadVoice: {
    vibrato: Tone.Vibrato;
    dry: Tone.Gain;
    formants: Tone.Gain;
    bands: Tone.Filter[];
    breath: Tone.NoiseSynth;
    breathLevel: Tone.Gain;
  };
  private leadSettings: LeadSettings = LEAD_SETTINGS.synth;
  private readonly counter: NativeFMSynth;
  /** The Night's bright saw for its two-note riff, on the riff track (see setVoices). */
  private readonly riffPlain: NativeSynth;
  /** The Night's lead synth: Get Closer's hook patch, on the synth track. */
  private readonly synth: NativeMonoSynth;
  /** Get Closer's chorus countervoice, on the counter track (see setVoices). */
  private readonly counterSoft: NativeSynth;
  /** The same voice for The Night's chorus line, louder. */
  private readonly counterSoftNight: NativeSynth;
  /** Self Control's riff, on the riff track (see setVoices). */
  private readonly riffBright: NativeSynth;
  /** Get Closer's hook: a gated narrow pulse into its own echo and chorus, on the riff track. */
  private readonly riffPulse: NativeMonoSynth;
  /** The echoes that follow the tempo (setTempo): The Night's lead synth's, Get Closer's hook's. */
  private readonly echoTimes: Tone.Param<"time">[] = [];
  /** Faces' plucked stab, on the stab track (see setVoices). */
  private readonly stabPluck: NativeMonoSynth;
  /** Faces' chorus stab, held and open, for the stab notes marked `alt`. */
  private readonly stabHeld: NativeMonoSynth;
  /** Faces' arpeggio, a softer copy of its pluck, on the arp track. */
  private readonly arpPluck: NativeMonoSynth;
  /** Self Control's verse line (a glockenspiel) and its break's stab, on the stab track. */
  private readonly stabGlock: NativeFMSynth;
  private readonly stabGlockTop: NativeFMSynth;
  private readonly stabSwell: NativeMonoSynth;
  /** Self Control's chorus comp, a saw stab and an FM piano, on the counter track (setVoices). */
  private readonly counterBright: NativeMonoSynth;
  private readonly counterEp: NativeFMSynth;
  /** The Euro-disco parts (docs/references/sandra-*.md §12), each on its track (see setVoices). */
  private readonly euro: {
    pad: NativeSynth;
    padFilter: FixedFilter;
    riffClick: NativeMonoSynth;
    riffGlide: NativeMonoSynth;
    arpTriangle: NativeMonoSynth;
    arpSaw: NativeMonoSynth;
    stabSaw: NativeMonoSynth;
    synthSaw: NativeMonoSynth;
  };
  /** Each track's sends to the reverb and the shared delay, so a voice can change them. */
  private readonly sends = {} as Record<Track, { reverb?: Tone.Gain; delay?: Tone.Gain }>;
  /** The delay bus every track's delay send feeds. */
  private readonly delay: Tone.FeedbackDelay;
  private voices: Voices = SYNTHPOP_VOICES;
  private readonly arp: NativeFMSynth;
  private readonly stab: NativeSynth;
  private readonly stabNoise: Tone.NoiseSynth;
  private readonly seq: NativeMonoSynth;
  /** Plucked strings: louder voices for down-strokes, softer for up-strokes. */
  private readonly guitar: { down: Tone.PluckSynth[]; up: Tone.PluckSynth[]; next: number };
  /** Where each channel's output goes (the master, its effect sends): see setActiveTracks. */
  private readonly routes = {} as Record<Track, Tone.InputNode[]>;
  private readonly connected = new Set<Track>(TRACKS);
  private readonly disconnecting = new Map<Track, ReturnType<typeof setTimeout>>();

  private constructor(reverb: Tone.Reverb, gatedVerb: Tone.Reverb, lite: boolean) {
    this.ready = Promise.all([reverb.ready, gatedVerb.ready]).then(() => undefined);
    // Bus glue, matched to the references' level and band balance (scripts/compare_mix.py). Two
    // shelves and a gain, cheap enough for lite mode too.
    const eq = new FixedEQ3({
      low: -2.5,
      mid: 1.5,
      high: 2.5,
      lowFrequency: 150,
      highFrequency: 3500,
    });
    const comp = new Tone.Compressor({ threshold: -20, ratio: 2.5, attack: 0.02, release: 0.25 });
    const limiter = new Tone.Limiter(-1);
    // Tone's Limiter is a fast compressor, so drum transients overshoot it and clipped (245
    // full-scale frames in one song): the soft clipper rounds them off.
    const clip = softClipper(lite);
    // Headroom trim: without it the bus compressor and limiter squashed TF-style songs to a crest
    // factor of 11 dB (the records: 15–18).
    const trim = new Tone.Gain(Tone.dbToGain(-5.5));
    this.master.chain(trim, eq, comp, limiter, ...clip, Tone.getDestination());
    clip.at(-1)!.fan(this.fft, this.waveform);

    const delay = (this.delay = new Tone.FeedbackDelay({
      delayTime: "8n.",
      feedback: 0.32,
      wet: 1,
    }));
    const delayFilter = new FixedFilter("highpass", 600);
    delay.chain(delayFilter, this.master);
    reverb.connect(this.master);

    this.channels = Object.fromEntries(
      TRACKS.map((t) => {
        // channelCount 2: Tone.Channel defaults to mono, which collapsed every chorus and reverb.
        const ch = new Tone.Channel({
          volume: DEFAULT_VOLUMES[t],
          pan: PANS[t],
          channelCount: 2,
        });
        const { reverb: rv, delay: dl } = SENDS[t];
        const routes: Tone.InputNode[] = [this.master];
        const sends: { reverb?: Tone.Gain; delay?: Tone.Gain } = {};
        if (rv > 0) routes.push((sends.reverb = new Tone.Gain(rv).connect(reverb)));
        if (dl > 0) routes.push((sends.delay = new Tone.Gain(dl).connect(delay)));
        this.sends[t] = sends;
        ch.fan(...routes);
        this.routes[t] = routes;
        return [t, ch];
      }),
    ) as Record<Track, Tone.Channel>;

    // Drums + 80s gated reverb: snare/clap → reverb → a gate opened on each hit (see gateHit).
    this.drums.output.connect(this.channels.drums);
    this.drums.gateSend.connect(gatedVerb);
    gatedVerb.chain(this.gate, this.channels.drums);

    // Sequenced bass, voiced on the recordings' Demucs bass stems. A saw whose harmonics fall
    // about 9 dB per octave above 200 Hz (a one-pole lowpass: TF's still carries 1.7 kHz within
    // 22 dB of the fundamental), with a constant brightness through each note: it punches, holds,
    // and falls linearly to a third by 200 ms. An FM body under it, a touch of drive, and a lean
    // lowest octave. TF's tone is brighter than DS's: see setBassTone. The level lives here, not
    // on the channel, so saved mixer settings keep their meaning.
    const bassDrive = new Tone.Distortion({
      distortion: 0.2,
      oversample: lite ? "none" : "2x",
      wet: 0.15,
    });
    const bassEq = new FixedFilter("lowshelf", 100, { gain: -6 });
    // Presence, so the harmonics stay audible against the mid parts (strongest for TF).
    this.bassPresence = new FixedFilter("peaking", 700, { Q: 0.6, gain: 4 });
    this.bassTone = new Tone.OnePoleFilter(220, "lowpass");
    this.bassTone.chain(bassDrive, bassEq, this.bassPresence);
    const lowCuts = [new FixedFilter("highpass", 65), new FixedFilter("highpass", 65)];
    this.bassLowCut = { filters: lowCuts, cut: new Tone.Gain(0), through: new Tone.Gain(1) };
    this.bassPresence.fan(lowCuts[0]!, this.bassLowCut.through);
    lowCuts[0]!.chain(lowCuts[1]!, this.bassLowCut.cut, this.channels.bass);
    this.bassLowCut.through.connect(this.channels.bass);
    this.bassFm = new Tone.FMSynth({
      volume: -10,
      harmonicity: 1,
      modulationIndex: 3,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.25, decayCurve: "linear", sustain: 0.2, release: 0.04 },
      modulationEnvelope: { attack: 0.002, decay: 0.1, sustain: 0.2, release: 0.05 },
    }).connect(bassEq);
    this.bassSaw = new Tone.MonoSynth({
      volume: 8,
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.002, decay: 0.25, decayCurve: "linear", sustain: 0.2, release: 0.04 },
      // Nearly open: only a small pluck at the attack. The tone comes from bassTone.
      filterEnvelope: {
        attack: 0.002,
        decay: 0.08,
        sustain: 0.6,
        release: 0.05,
        baseFrequency: 2500,
        octaves: 0.6,
      },
    }).connect(this.bassTone);
    // You Came's bass is two oscillators an octave apart (its 2nd harmonic as loud as the
    // fundamental, the 3rd 18–20 dB down, the 4th louder than the 3rd): a saw an octave up over
    // the low oscillator played as a triangle (see setBassTone), through the same tone.
    this.bassOctLevel.connect(this.bassTone);
    this.bassOct = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.002, decay: 0.25, decayCurve: "linear", sustain: 0.2, release: 0.04 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.08,
        sustain: 0.6,
        release: 0.05,
        baseFrequency: 2500,
        octaves: 0.6,
      },
    }).connect(this.bassOctLevel);
    this.bassOct.volume.value = 8;

    // Melodic high bass: plucky pulse through a chorus pedal and a touch of drive.
    const hookChorus = new Tone.Chorus({
      frequency: 3,
      delayTime: 3.5,
      depth: 0.6,
      wet: 0.6,
    }).start();
    const hookDrive = new Tone.Distortion({ distortion: 0.2, wet: 0.25 });
    this.hook = new Tone.MonoSynth({
      oscillator: { type: "pulse", width: 0.3 } as Tone.OmniOscillatorOptions,
      filter: { type: "lowpass", rolloff: -12, Q: 1 },
      envelope: { attack: 0.002, decay: 0.45, sustain: 0.45, release: 0.15 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.3,
        sustain: 0.3,
        release: 0.2,
        baseFrequency: 260,
        octaves: 3.6,
      },
    }).chain(hookDrive, hookChorus, this.channels.hook);

    // Pad: detuned saws, slow attack, darkened and chorused. High-passed so it leaves the bass's
    // harmonics audible (Demucs on a render showed the pad and other mid parts swallowing them).
    const padHighpass = new FixedFilter("highpass", 220);
    const padFilter = new FixedFilter("lowpass", 2800);
    const padChorus = new Tone.Chorus({
      frequency: 0.8,
      delayTime: 4,
      depth: 0.5,
      wet: 0.5,
    }).start();
    this.pad = new NativeSynth({
      oscillator: { type: "sawtooth", count: lite ? 2 : 3, spread: 22 },
      envelope: { attack: 0.35, decay: 0.6, sustain: 0.8, release: 1.1 },
      // Releases overlap the next chord, so this is about two chords' worth (lite: one and a bit).
      maxPolyphony: lite ? 8 : 16,
    }).chain(padHighpass, padFilter, padChorus, this.channels.pad);

    // Riff: DX bell-pluck layered with a bright saw pluck.
    this.riffFm = new NativeFMSynth({
      harmonicity: 3.01,
      modulationIndex: 9,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.08, release: 0.3 },
      modulationEnvelope: { attack: 0.001, decay: 0.18, sustain: 0.1, release: 0.2 },
    }).connect(this.channels.riff);
    // The Night's riff: a nearly unfiltered saw (h2 −9 dB, h3 −14, h4 −17; the-night.md §10.3).
    this.riffPlain = new NativeSynth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.2, sustain: 0.5, release: 0.08 },
      volume: -4,
    }).chain(new FixedFilter("lowpass", 6000), this.channels.riff);
    // Self Control's riff (branigan-self-control.md §11, §12): a guitar on the record, played
    // around F♯3 (the MIDI transcription). Its 2–4 kHz as loud as its 500 Hz band, about 6 dB over
    // a plain saw's, and slow to fade: 3 dB down after about 250 ms, 6 dB after 500 ms.
    this.riffBright = new NativeSynth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.7, sustain: 0.45, release: 0.08 },
      volume: -7,
    }).chain(
      new FixedFilter("peaking", 3200, { Q: 0.8, gain: 9 }),
      new FixedFilter("lowpass", 8000),
      this.channels.riff,
    );
    // Get Closer's hook (get-closer.md §10): a 12% pulse (every harmonic within 3 dB up to 2 kHz)
    // through a fixed 12 dB low-pass at 3.5 kHz, gated at 70% of a 16th by the notes. Then a
    // dotted-8th echo whose repeats fall about 4 dB each and darken (a 2.5 kHz low-pass in the
    // feedback loop, as on an analog or tape delay), and a stereo chorus as wide as the pads.
    // The Night's lead synth plays the same patch on its own track: its measured nearly-sine tone
    // (the-night.md §10.1) sounded nothing like the record by ear (docs/italo/mix.md).
    const hookPulse = (out: Tone.ToneAudioNode, volume: number) => {
      const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.5, wet: 0.5 });
      chorus.start().connect(out);
      const echoIn = new Tone.Gain(1);
      const echoDelay = new Tone.Delay(0.4, 1);
      const echoTone = new FixedFilter("lowpass", 2500);
      const echoFeedback = new Tone.Gain(0.63);
      echoIn.connect(chorus);
      echoIn.connect(echoDelay);
      echoDelay.chain(echoTone, echoFeedback, echoDelay);
      echoTone.connect(new Tone.Gain(0.63).connect(chorus));
      this.echoTimes.push(echoDelay.delayTime);
      return new NativeMonoSynth({
        oscillator: {
          type: "square",
          partials: [
            1, 0.93, 0.82, 0.68, 0.52, 0.35, 0.19, 0.04, 0.08, 0.16, 0.21, 0.22, 0.21, 0.16, 0.11,
            0.04,
          ],
        },
        filter: { type: "lowpass", rolloff: -12, Q: 1 },
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.04 },
        filterEnvelope: {
          attack: 0.002,
          decay: 0.1,
          sustain: 1,
          release: 0.05,
          baseFrequency: 3500,
          octaves: 0,
        },
        maxPolyphony: 4,
        volume,
      }).connect(echoIn);
    };
    this.riffPulse = hookPulse(this.channels.riff, 0);
    // By ear (clips 6b2 and 8), 8 dB above the old tone's measured balance (the Italo mix's lead
    // synth).
    this.synth = hookPulse(this.channels.synth, -6);
    const riffFilter = new FixedFilter("lowpass", 3200);
    this.riffSaw = new NativeSynth({
      volume: -6,
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0.15, release: 0.2 },
    }).chain(riffFilter, this.channels.riff);

    // The lead: portamento + vibrato on detuned saws ("synth"), or one saw shaped by three vowel
    // formants with a breath of noise ("voice"; setLeadPatch).
    const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.07 });
    // The mix: the shelves, the level, and a 14 ms copy on the right for width (setLeadTone).
    const leadCutoff = new Tone.Filter({ type: "lowpass", frequency: 4500, rolloff: -12 });
    const leadLow = new Tone.Filter({ type: "lowshelf", frequency: 220, gain: 0 });
    const leadMid = new Tone.Filter({ type: "peaking", frequency: 1800, Q: 0.9, gain: 0 });
    const leadHigh = new Tone.Filter({ type: "highshelf", frequency: 3000, gain: 0 });
    const leadLevel = new Tone.Gain(1);
    // A singer's compressor: the shelves above lift the voice's peaks along with its tone, and
    // uncompressed they drove the master limiter into audible clipping (twice the samples near
    // full scale in a You Came-style song). It holds the voice's level and keeps its peaks off the
    // bus; the synth lead bypasses it (threshold 0 dB).
    const leadComp = new Tone.Compressor({
      threshold: 0,
      ratio: 4,
      knee: 6,
      attack: 0.002,
      release: 0.09,
    });
    const leadMakeup = new Tone.Gain(1);
    vibrato.chain(
      leadCutoff,
      leadLow,
      leadMid,
      leadHigh,
      leadComp,
      leadMakeup,
      leadLevel,
      this.channels.lead,
    );
    const leadWidth = new Tone.Gain(0);
    leadLevel.chain(new Tone.Delay(0.014), new Tone.Panner(1), leadWidth, this.channels.lead);
    // Sibilance: the breath's own path above 5 kHz, past the formants.
    const leadAir = new Tone.Gain(0).connect(leadLow);
    const leadIn = new Tone.Gain(1);
    const leadDry = new Tone.Gain(1).connect(vibrato);
    // The bank loses level to its narrow bands: made up here, so the patches sit level.
    const leadFormants = new Tone.Gain(0).connect(vibrato);
    const bands = [800, 1150, 2900].map((f, i) => {
      const band = new Tone.Filter({ type: "bandpass", frequency: f, Q: [5, 8, 10][i] ?? 8 });
      leadIn.chain(band, new Tone.Gain([2.6, 1.6, 0.9][i] ?? 1), leadFormants);
      return band;
    });
    leadIn.connect(leadDry);
    const breathLevel = new Tone.Gain(0);
    const breath = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.5, release: 0.2 },
    }).chain(breathLevel, leadIn);
    breath.chain(new FixedFilter("highpass", 5000), leadAir);
    this.leadVoice = { vibrato, dry: leadDry, formants: leadFormants, bands, breath, breathLevel };
    this.leadMix = {
      level: leadLevel,
      low: leadLow,
      mid: leadMid,
      high: leadHigh,
      width: leadWidth,
      cutoff: leadCutoff,
      air: leadAir,
      comp: leadComp,
      makeup: leadMakeup,
    };
    const leadOptions: ConstructorParameters<typeof Tone.MonoSynth>[0] = {
      portamento: 0.045,
      oscillator: { type: "fatsawtooth", count: 2, spread: 14 } as Tone.OmniOscillatorOptions,
      filter: { type: "lowpass", rolloff: -12, Q: 1.5 },
      envelope: { attack: 0.025, decay: 0.3, sustain: 0.75, release: 0.22 },
      filterEnvelope: {
        attack: 0.03,
        decay: 0.4,
        sustain: 0.5,
        release: 0.3,
        baseFrequency: 1100,
        octaves: 2.2,
      },
    };
    this.lead = new Tone.MonoSynth(leadOptions).connect(leadIn);
    this.leadOct = new Tone.MonoSynth(leadOptions).connect(leadIn);

    // TF's chorus counter-line (MIDI "Synth Lead"): a plucked electric-piano tone. Measured on
    // Demucs "other" stems of chorus 1 (record and our render alike), its held notes strike hard
    // and fade about 11 dB over 0.75 s, and its harmonics fall about 5, 11, 17, 22 and 25 dB under
    // the fundamental, early and late in the note alike; it plays 3 dB above
    // the record's level, which by ear sounded a bit quiet. The carrier plays those harmonics; a
    // 1:1 FM strike brightens only the first tenth of a second.
    this.counter = new NativeFMSynth({
      harmonicity: 1,
      modulationIndex: 1.6,
      oscillator: { type: "sine", partials: [1, 0.56, 0.28, 0.14, 0.08, 0.056, 0.018, 0.016] },
      modulation: { type: "sine" },
      // A 7.3 s decay to 0.15 falls with a 0.4 s time constant: -11 dB at 0.75 s.
      envelope: { attack: 0.003, decay: 7.3, sustain: 0.15, release: 0.35 },
      modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.2 },
      volume: 3,
      maxPolyphony: lite ? 2 : 4,
    }).connect(this.channels.counter);

    // Get Closer's chorus countervoice (get-closer.md §10): soft and nearly sine-like (h2 and h3
    // about 18 dB down), rising in about 30 ms and settling 8–10 dB down; near-mono, no effects.
    // The Night's line plays on it too, 3 dB louder by ear (clip 9): its own pluck sounded no
    // closer to the record (docs/italo/mix.md).
    const softVoice = (volume: number) =>
      new NativeSynth({
        oscillator: { type: "sine", partials: [1, 0.12, 0.1] },
        envelope: { attack: 0.025, decay: 0.25, sustain: 0.35, release: 0.35 },
        maxPolyphony: 4,
        volume,
      }).connect(this.channels.counter);
    this.counterSoft = softVoice(-3);
    this.counterSoftNight = softVoice(0);

    // Self Control's chorus comp (branigan-self-control.md §13): bright stabs stacked over three
    // octaves. The upper chords play a saw stab and an FM piano together, the guitar's triad the
    // FM piano alone. On the record the hits peak at 1–2 kHz with 4–8 kHz only 5 dB down, stay
    // bright about 50 ms, then fade: about 5 dB by 90 ms, 13 by 200 ms.
    this.counterBright = new NativeMonoSynth({
      oscillator: { type: "sawtooth", count: 2, spread: 10 },
      filter: { type: "lowpass", rolloff: -12, Q: 0.9 },
      envelope: { attack: 0.003, decay: 0.3, sustain: 0.15, release: 0.12 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.4,
        sustain: 0.4,
        release: 0.1,
        baseFrequency: 5500,
        octaves: 1.2,
      },
      maxPolyphony: lite ? 8 : 18,
      volume: -11,
    }).chain(
      // The record's stabs carry 4–8 kHz but nothing above.
      new FixedFilter("peaking", 4500, { Q: 0.9, gain: 6 }),
      new FixedFilter("lowpass", 8000),
      this.channels.counter,
    );
    this.counterEp = new NativeFMSynth({
      harmonicity: 1,
      modulationIndex: 4,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 1.2, sustain: 0.15, release: 0.3 },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.15, release: 0.2 },
      maxPolyphony: lite ? 8 : 24,
      volume: -9,
    }).connect(this.channels.counter);

    const arpOptions = {
      harmonicity: 4,
      modulationIndex: 3,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 },
      modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: ARP_STAB_GAIN_DB,
    };
    this.arp = new NativeFMSynth(arpOptions).connect(this.channels.arp);

    // Stab: saw-brass chord plus a noise burst, a nod to the sampled orchestral hit.
    this.stab = new NativeSynth({
      oscillator: { type: "sawtooth", count: lite ? 2 : 3, spread: 30 },
      envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
      volume: ARP_STAB_GAIN_DB,
    }).connect(this.channels.stab);
    // Faces' plucked stab (faces.md §10.1): one saw (a detuned pair cancels its fundamental at
    // note-on), its filter open for 40–50 ms then shut to about 1.6 kHz by 80 ms, linearly; the
    // level falls to silence by 230 ms. EQ'd (−5 dB at 1.4 kHz, +5 at 5.5) and chorused, with one
    // strong repeat 300 ms later on the right (not tempo-synced), about 2 dB under the dry hit.
    const pluckBus = new Tone.Gain(1);
    const pluckChorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6, wet: 0.5 });
    pluckBus.chain(
      new FixedFilter("peaking", 1400, { Q: 1, gain: -5 }),
      new FixedFilter("peaking", 5500, { Q: 0.8, gain: 5 }),
      pluckChorus.start(),
      this.channels.stab,
    );
    pluckChorus.chain(
      new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.35, wet: 1 }),
      new Tone.Panner(1),
      new Tone.Gain(0.8),
      this.channels.stab,
    );
    this.stabPluck = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: 3 },
      envelope: { attack: 0.003, decay: 0.23, decayCurve: "linear", sustain: 0, release: 0.03 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.08,
        decayCurve: "linear",
        sustain: 0,
        release: 0.05,
        baseFrequency: 1600,
        octaves: 3,
      },
      maxPolyphony: lite ? 6 : 8,
      volume: ARP_STAB_GAIN_DB - 2,
    }).connect(pluckBus);
    // Faces' chorus stab (faces.md §10.3): held through the 8th, bright, darkening slowly; and its
    // arpeggio (§10.4), a softer, darker copy of the pluck. Both through the pluck's EQ, chorus and
    // echo.
    this.stabHeld = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: 0 },
      envelope: { attack: 0.003, decay: 0.6, decayCurve: "linear", sustain: 0, release: 0.03 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.25,
        sustain: 0,
        release: 0.05,
        baseFrequency: 3000,
        octaves: 1.5,
      },
      maxPolyphony: lite ? 8 : 12,
      // 9 dB over the pluck's level: against the record's stems the pluck (like Self Control's
      // stabs) rendered about 12 dB too loud, this one about 3 dB, and Faces' stab fader takes
      // the pluck's 12 dB off (docs/italo/mix.md).
      volume: ARP_STAB_GAIN_DB + 3,
    }).connect(pluckBus);
    const arpBus = new Tone.Gain(1);
    arpBus.connect(this.channels.arp);
    this.arpPluck = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: 2 },
      envelope: { attack: 0.003, decay: 0.4, sustain: 0.3, release: 0.05 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.15,
        sustain: 0,
        release: 0.05,
        baseFrequency: 1400,
        octaves: 2,
      },
      maxPolyphony: 3,
      // On the record the arpeggio sits about 1 dB under the stab (faces.md §10.4). It's one note
      // where the stab plays three, and at +9 dB it rendered 3 dB under it at default faders;
      // with Italo's stab fader 12 dB down (docs/italo/mix.md), it comes down 10.
      volume: ARP_STAB_GAIN_DB - 7,
    });
    this.arpPluck.chain(
      new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start(),
      arpBus,
    );
    this.arpPluck.chain(
      new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.35, wet: 1 }),
      new Tone.Panner(1),
      new Tone.Gain(0.8),
      arpBus,
    );
    // Self Control's verse line (branigan-self-control.md §12; a glockenspiel in the MIDI
    // transcription; by ear the first bell "isn't a bell at all", then "it should be one", and
    // strings under it trailed on where a bell only decays; then "a bigger bell, more deep"): a
    // struck FM bell at the line's own pitch, its modulator at an inharmonic 2.76 (a metal bar's
    // second mode) and dying fast, ringing out over about 3 s.
    // Its break stab, below, is a low chord.
    this.stabGlock = new NativeFMSynth({
      harmonicity: 2.76,
      modulationIndex: 4,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 3.2, sustain: 0, release: 1.6 },
      modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.05, release: 0.3 },
      maxPolyphony: 6,
      volume: ARP_STAB_GAIN_DB + 2,
    }).connect(this.channels.stab);
    // Its bright, high voice (by ear the record's bell is "piercing" and "high pitched", ours "too
    // soft"): on the record the bell sounds an octave over the written line, its fundamental 20 dB
    // under its strong 3rd and 4th harmonics (G♯6 under 5.0 and 6.6 kHz on the written G♯5). A
    // harmonic FM tone an octave up, struck hard and rich in those harmonics, fading in about a
    // second over the deep bell's body.
    this.stabGlockTop = new NativeFMSynth({
      harmonicity: 1,
      modulationIndex: 1.5,
      // Partials as measured: the fundamental 20 dB and the 2nd 14 dB under the 3rd, the 4th 3 dB.
      oscillator: { type: "sine", partials: [0.1, 0.2, 1, 0.7, 0.3, 0.2, 0.1] },
      modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.5 },
      modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.3 },
      maxPolyphony: 6,
      volume: ARP_STAB_GAIN_DB + 5,
    }).connect(this.channels.stab);
    // The break stab hits hard (2026-11-12, by ear: "a powerful sound"; a distorted guitar's power
    // chord over the bass in the MIDI transcription): two detuned saws struck at once, driven, then
    // darkened, ringing on into the reverb.
    const swellBus = new Tone.Gain(1);
    swellBus.chain(
      new Tone.Distortion({ distortion: 0.55, oversample: lite ? "none" : "2x", wet: 0.8 }),
      new FixedFilter("lowpass", 3000, { Q: 0.6 }),
      // Level after the drive, which flattens what goes in.
      new Tone.Gain(Tone.dbToGain(5)),
      this.channels.stab,
    );
    this.stabSwell = new NativeMonoSynth({
      oscillator: { type: "sawtooth", count: 2, spread: 14 },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      // Falls away to silence across the bar, as the record's does (23 dB from peak to floor).
      envelope: { attack: 0.004, decay: 1.1, sustain: 0.05, release: 0.8 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.3,
        sustain: 0.5,
        release: 0.3,
        baseFrequency: 1500,
        octaves: 1.2,
      },
      maxPolyphony: lite ? 3 : 6,
      // The stab fader came up 6 dB for the verse line: this comes down as much.
      volume: ARP_STAB_GAIN_DB + 6,
    }).connect(swellBus);
    const stabNoiseFilter = new FixedFilter("bandpass", 2500);
    this.stabNoise = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
      volume: ARP_STAB_GAIN_DB,
    }).chain(stabNoiseFilter, this.channels.stab);

    // The Euro-disco parts, measured from the Sandra records' "other" stems (§12 of each analysis).
    // Pads: three detuned saws as ours, a quicker attack (0.2–0.3 s), a lighter chorus (L/R
    // correlation 0.70–0.87), and a low-pass set per reference (setVoices).
    const euroPadFilter = new FixedFilter("lowpass", 2500, { Q: 0.7 });
    const euroPad = new NativeSynth({
      oscillator: { type: "sawtooth", count: lite ? 2 : 3, spread: 22 },
      envelope: { attack: 0.25, decay: 0.6, sustain: 0.8, release: 0.8 },
      maxPolyphony: lite ? 8 : 16,
    });
    euroPad.chain(
      new FixedFilter("highpass", 220),
      euroPadFilter,
      new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.5, wet: 0.3 }).start(),
      this.channels.pad,
    );
    // Crazy Juliet's sequence and chorus riff: a soft square body with a click (a 12 dB low-pass
    // whose envelope opens 2.5 octaves over 1.4 kHz for 50 ms), lightly chorused.
    const clickChorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0.3 });
    clickChorus.start().connect(this.channels.riff);
    const riffClick = new NativeMonoSynth({
      oscillator: { type: "square" },
      filter: { type: "lowpass", rolloff: -12, Q: 1 },
      envelope: { attack: 0.002, decay: 0.25, sustain: 0.3, release: 0.12 },
      filterEnvelope: {
        attack: 0.001,
        decay: 0.05,
        sustain: 0,
        release: 0.05,
        baseFrequency: 1400,
        octaves: 2.5,
      },
      maxPolyphony: 4,
      volume: -6,
    }).connect(clickChorus);
    // Heaven Can Wait's intro motif (clip 4b matched the record within 1–2 dB to 7.6 kHz): three
    // saws 25 cents apart, legato, the filter falling from about 8 kHz to 3.2 kHz over 0.3 s, a
    // long release into a chorus and an extra reverb send.
    const glideBus = new Tone.Gain(1);
    glideBus.chain(
      new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.5, wet: 0.4 }).start(),
      this.channels.riff,
    );
    glideBus.connect(new Tone.Gain(0.3).connect(reverb));
    const riffGlide = new NativeMonoSynth({
      oscillator: { type: "sawtooth", count: lite ? 2 : 3, spread: 25 },
      filter: { type: "lowpass", rolloff: -12, Q: 1 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.9, release: 1.5 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.3,
        sustain: 0,
        release: 0.3,
        baseFrequency: 3200,
        octaves: 1.3,
      },
      maxPolyphony: 3,
      volume: -10,
    }).connect(glideBus);
    // The 16th parts: Crazy Juliet's verse figure and Innocent Love's intro, a soft triangle
    // pluck (falling 8–10 dB a 16th) through 1.5 kHz, chorused; Heaven Can Wait's pulse, a saw
    // through a fixed 2.9 kHz low-pass, held for most of each 16th.
    const arpChorus = new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.5, wet: 0.5 });
    arpChorus.start().connect(this.channels.arp);
    const arpTriangle = new NativeMonoSynth({
      oscillator: { type: "triangle" },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.004, decay: 0.15, sustain: 0.2, release: 0.1 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.1,
        sustain: 1,
        release: 0.1,
        baseFrequency: 1500,
        octaves: 0,
      },
      maxPolyphony: lite ? 4 : 6,
      volume: ARP_STAB_GAIN_DB + 6,
    }).connect(arpChorus);
    const arpSaw = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0.55, release: 0.05 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.1,
        sustain: 1,
        release: 0.1,
        baseFrequency: 2900,
        octaves: 0,
      },
      maxPolyphony: lite ? 4 : 6,
      volume: ARP_STAB_GAIN_DB - 2,
    }).connect(this.channels.arp);
    // Innocent Love's stabs: a saw chord through a fixed 3.7 kHz low-pass, re-struck and falling
    // about 5 dB a 16th, centred, no echo.
    const stabSaw = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.003, decay: 0.2, sustain: 0.45, release: 0.08 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.1,
        sustain: 1,
        release: 0.1,
        baseFrequency: 3700,
        octaves: 0,
      },
      maxPolyphony: lite ? 6 : 8,
      volume: ARP_STAB_GAIN_DB - 4,
    }).connect(this.channels.stab);
    // Crazy Juliet's instrumental lead (within 1.6–1.8 dB of the stem): a saw through a 12 dB
    // low-pass at 4.7 kHz, Q 1, a 4.4 Hz vibrato of about ±20 cents, no echo, near the centre.
    const sawVibrato = new Tone.Vibrato({ frequency: 4.4, depth: 0.17 });
    sawVibrato.connect(this.channels.synth);
    const synthSaw = new NativeMonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 1 },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.45, release: 0.1 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.1,
        sustain: 1,
        release: 0.1,
        baseFrequency: 4700,
        octaves: 0,
      },
      maxPolyphony: 2,
      volume: -8,
    }).connect(sawVibrato);
    this.euro = {
      pad: euroPad,
      padFilter: euroPadFilter,
      riffClick,
      riffGlide,
      arpTriangle,
      arpSaw,
      stabSaw,
      synthSaw,
    };

    // TF's high sequencer: a plucky square on 16ths.
    this.seq = new NativeMonoSynth({
      oscillator: { type: "square" },
      filter: { type: "lowpass", rolloff: -24, Q: 2 },
      envelope: { attack: 0.003, decay: 0.15, sustain: 0.35, release: 0.08 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.12,
        sustain: 0.2,
        release: 0.1,
        baseFrequency: 700,
        octaves: 2.5,
      },
      maxPolyphony: lite ? 6 : 12,
    }).chain(new FixedFilter("highpass", 200), this.channels.seq);

    // Rhythm guitar: Karplus–Strong strings, DI'd and overdriven (Sound On Sound on Sumner's
    // guitar), darkened and lightly chorused.
    // Lite: no chorus, and fewer strings (each is an AudioWorklet that runs even when silent).
    const guitarBus = new Tone.Gain(1);
    guitarBus.chain(
      new Tone.Distortion({ distortion: 0.6, oversample: lite ? "none" : "2x", wet: 0.85 }),
      new FixedFilter("lowpass", 3200),
      new FixedFilter("highpass", 180),
      ...(lite
        ? []
        : [new Tone.Chorus({ frequency: 1.2, delayTime: 3, depth: 0.3, wet: 0.3 }).start()]),
      this.channels.guitar,
    );
    const plucks = (volume: number) =>
      Array.from({ length: lite ? 3 : 8 }, () =>
        new Tone.PluckSynth({
          attackNoise: 1.2,
          dampening: 3800,
          resonance: 0.97,
          release: 0.25,
          volume,
        }).connect(guitarBus),
      );
    this.guitar = { down: plucks(14), up: plucks(9), next: 0 };
  }

  /**
   * Builds every node at once, in Tone's current context; await `ready` before playing. Nothing
   * here may straddle an await: an offline render borrows the global context, and nodes built
   * across that swap would end up in two contexts.
   */
  static create({ lite = false }: InstrumentOptions = {}): Instruments {
    // Lite: shorter impulse responses. The gate shuts 200 ms after each hit, so the gated one
    // only needs to reach the next snare.
    const reverb = new Tone.Reverb({ decay: lite ? 2.2 : 3.2, preDelay: 0.02, wet: 1 });
    const gated = new Tone.Reverb({ decay: lite ? 0.8 : 1.6, preDelay: 0.005, wet: 1 });
    return new Instruments(reverb, gated, lite);
  }

  /**
   * Keeps only these tracks connected. Browsers skip nodes that don't reach the output, but still
   * process muted ones, so a song's unused instruments cost nothing once disconnected. A track
   * dropped keeps sounding a few seconds first (the bar still playing, its release tail).
   */
  setActiveTracks(active: ReadonlySet<Track>): void {
    for (const t of TRACKS) {
      if (active.has(t)) this.connect(t);
      else if (this.connected.has(t) && !this.disconnecting.has(t)) {
        const timer = setTimeout(() => {
          this.disconnecting.delete(t);
          this.channels[t].disconnect();
          this.connected.delete(t);
        }, UNUSED_TRACK_DELAY_MS);
        this.disconnecting.set(t, timer);
      }
    }
  }

  private connect(t: Track): void {
    const timer = this.disconnecting.get(t);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.disconnecting.delete(t);
    }
    if (this.connected.has(t)) return;
    this.channels[t].fan(...this.routes[t]);
    this.connected.add(t);
  }

  drum(hit: DrumHit, time: number): void {
    this.drums.trigger(hit.voice, time, hit.vel);
    if (this.snareGated && (hit.voice === "snare" || hit.voice === "clap")) this.gateHit(time);
  }

  /** Opens the gated-reverb return for ~200 ms, then slams it shut. */
  private gateHit(time: number): void {
    const g = this.gate.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.9, time);
    g.setValueAtTime(0.9, time + 0.17);
    g.linearRampToValueAtTime(0, time + 0.2);
  }

  /** Schedules one bar's notes for a track. Chordal tracks are grouped by onset. */
  play(track: MelodicTrack, notes: readonly Note[], barTime: number, sixteenth: number): void {
    const at = (n: Note) => barTime + n.step * sixteenth;
    const len = (n: Note) => Math.max(0.03, n.dur * sixteenth);
    switch (track) {
      case "bass":
        for (const n of notes) {
          const f = midiToFreq(n.midi);
          this.bassFm.triggerAttackRelease(f, len(n), at(n), n.vel);
          this.bassSaw.triggerAttackRelease(f, len(n), at(n), n.vel);
          if (this.bassOctOn) this.bassOct.triggerAttackRelease(f * 2, len(n), at(n), n.vel);
        }
        break;
      case "hook":
        for (const n of notes)
          this.hook.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      case "lead":
        for (const n of notes) {
          // The voice leaves a gap before the next word.
          const sung = Math.max(0.06, len(n) * this.leadSettings.legato);
          this.lead.triggerAttackRelease(midiToFreq(n.midi), sung, at(n), n.vel);
          this.voiceNote(n, at(n), sung);
        }
        break;
      case "leadOct":
        for (const n of notes) {
          this.leadOct.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        }
        break;
      case "counter": {
        const voice =
          this.voices.countervoice === "pluck8"
            ? this.counterSoftNight
            : this.voices.countervoice === "arp8"
              ? this.counterSoft
              : this.counter;
        for (const n of notes) {
          // Self Control's comp: the guitar's triad (`alt`) on the saw stab, the piano's on FM.
          if (this.voices.countervoice === "comp") {
            // Self Control's comp: the upper chords on the saw stab and the FM piano, the
            // guitar's triad (`alt`) on the FM piano alone.
            if (!n.alt)
              this.counterBright.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            this.counterEp.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            continue;
          }
          voice.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        }
        break;
      }
      case "riff":
        for (const n of notes) {
          if (this.voices.riffPatch === "click" || this.voices.riffPatch === "glide") {
            const synth =
              this.voices.riffPatch === "click" ? this.euro.riffClick : this.euro.riffGlide;
            synth.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            continue;
          }
          if (this.voices.riffPatch === "saw") {
            this.riffPlain.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            continue;
          }
          if (this.voices.riffPatch === "bright") {
            this.riffBright.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            continue;
          }
          if (this.voices.riffPatch === "pulse") {
            this.riffPulse.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
            continue;
          }
          this.riffFm.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
          this.riffSaw.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        }
        break;
      case "synth": {
        const synth = this.voices.synthPatch === "saw" ? this.euro.synthSaw : this.synth;
        for (const n of notes) synth.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      }
      case "arp": {
        const arp =
          this.voices.arpPatch === "pluck"
            ? this.arpPluck
            : this.voices.arpPatch === "triangle"
              ? this.euro.arpTriangle
              : this.voices.arpPatch === "saw"
                ? this.euro.arpSaw
                : this.arp;
        for (const n of notes) arp.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      }
      case "pad":
        for (const group of byOnset(notes)) {
          const [first] = group;
          if (!first) continue;
          (this.voices.padTone ? this.euro.pad : this.pad).triggerAttackRelease(
            group.map((n) => midiToFreq(n.midi)),
            len(first),
            at(first),
            first.vel,
          );
        }
        break;
      case "stab":
        for (const group of byOnset(notes)) {
          const [first] = group;
          if (!first) continue;
          const freqs = group.map((n) => midiToFreq(n.midi));
          if (this.voices.stabPatch === "pluck") {
            const voice = first.alt ? this.stabHeld : this.stabPluck;
            voice.triggerAttackRelease(freqs, len(first), at(first), first.vel);
            continue;
          }
          if (this.voices.stabPatch === "glockenspiel") {
            // The break's stab (marked `alt`) swells and rings for most of the bar.
            if (first.alt) {
              this.stabSwell.triggerAttackRelease(freqs, len(first), at(first), first.vel);
              continue;
            }
            // The bell, struck: it rings out on its own (by ear, no strings trailing under it).
            const ring = Math.max(len(first), 1.5);
            this.stabGlock.triggerAttackRelease(freqs, ring, at(first), first.vel);
            this.stabGlockTop.triggerAttackRelease(
              freqs.map((f) => f * 2),
              ring,
              at(first),
              first.vel,
            );
            continue;
          }
          if (this.voices.stabPatch === "saw") {
            this.euro.stabSaw.triggerAttackRelease(freqs, len(first), at(first), first.vel);
            continue;
          }
          this.stab.triggerAttackRelease(freqs, len(first), at(first), first.vel);
          this.stabNoise.triggerAttackRelease(0.1, at(first), 0.5);
        }
        break;
      case "guitar":
        // Strummed: down-strokes low string first, up-strokes high first, 6 ms apart.
        for (const group of byOnset(notes)) {
          const [first] = group;
          if (!first) continue;
          const down = Math.round(first.step) % 2 === 0;
          const strings = down ? group : [...group].reverse();
          const pool = down ? this.guitar.down : this.guitar.up;
          strings.forEach((n, i) => {
            const voice = pool[this.guitar.next++ % pool.length];
            voice?.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n) + i * 0.006);
          });
        }
        break;
      case "seq":
        for (const group of byOnset(notes)) {
          const [first] = group;
          if (!first) continue;
          this.seq.triggerAttackRelease(
            group.map((n) => midiToFreq(n.midi)),
            len(first),
            at(first),
            first.vel,
          );
        }
        break;
    }
  }

  /** Sets the bass's brightness from the genre profile (genres.ts `bassTone`): for synthpop, more
   * open toward True Faith than The Different Story, as their stems measure. */
  setBassTone(tone: BassTone): void {
    this.bassTone.frequency = tone.frequency;
    this.bassPresence.gain.value = tone.presence;
    this.bassSaw.filterEnvelope.baseFrequency = tone.sawCutoff;
    this.bassOct.filterEnvelope.baseFrequency = tone.sawCutoff * 2;
    this.bassOctLevel.gain.value = tone.octave;
    this.bassOctOn = tone.octave > 0;
    const type = this.bassOctOn ? "triangle" : tone.pulse > 0 ? "pulse" : "sawtooth";
    if (this.bassSaw.oscillator.type !== type) this.bassSaw.oscillator.type = type;
    // Tone's pulse width runs from −1 to 1, 0 a square: a duty cycle d is 1 − 2d.
    if (type === "pulse") this.bassSaw.oscillator.set({ width: 1 - 2 * tone.pulse });
    this.bassSaw.envelope.sustain = tone.sustain;
    this.bassSaw.filterEnvelope.octaves = tone.sweep;
    this.bassSaw.filterEnvelope.sustain = tone.struck ? 0 : 0.6;
    this.bassSaw.filterEnvelope.decay = tone.struck ? 0.23 : 0.08;
    const lowCut = this.bassLowCut;
    lowCut.cut.gain.value = tone.lowCut > 0 ? 1 : 0;
    lowCut.through.gain.value = tone.lowCut > 0 ? 0 : 1;
    if (tone.lowCut > 0) for (const f of lowCut.filters) f.input.frequency.value = tone.lowCut;
    this.bassOct.envelope.sustain = tone.sustain;
  }

  /** The sounds the song's dominant reference brings (genres.ts `dominantVoices`): which patch
   * plays the riff and the counter track. */
  setVoices(voices: Voices): void {
    this.voices = voices;
    // Faces' pluck has its own echo and little reverb (faces.md §10.1). Self Control's verse
    // line is drier than the brass, and has no echo.
    const pluck = voices.stabPatch === "pluck";
    const glock = voices.stabPatch === "glockenspiel";
    const stab = this.sends.stab;
    if (stab.reverb) stab.reverb.gain.value = pluck ? 0.15 : glock ? 0.3 : SENDS.stab.reverb;
    if (stab.delay)
      stab.delay.gain.value = pluck || glock || voices.stabPatch === "saw" ? 0 : SENDS.stab.delay;
    // Faces' arpeggio (§10.4) is centred on the record, with the pluck's echo and little reverb.
    const arpPluck = voices.arpPatch === "pluck";
    const arp = this.sends.arp;
    if (arp.reverb) arp.reverb.gain.value = arpPluck ? 0.15 : SENDS.arp.reverb;
    if (arp.delay) arp.delay.gain.value = arpPluck ? 0 : SENDS.arp.delay;
    this.channels.arp.pan.value = arpPluck ? 0 : PANS.arp;
    if (voices.padTone) this.euro.padFilter.input.frequency.value = voices.padTone;
  }

  /** A DJ's echo out from `time`: every track's delay send at `send` and the delay's feedback at
   * `feedback`, so what plays then dissolves into its echoes (render ahead's outgoing deck, whose
   * instruments end with the transition). */
  echoOut(time: number, send: number, feedback: number): void {
    for (const t of TRACKS) this.sends[t].delay?.gain.setValueAtTime(send, time);
    this.delay.feedback.setValueAtTime(feedback, time);
  }

  /** Picks the sung lead's sound (LeadPatch). */
  setLeadPatch(patch: LeadPatch): void {
    const s = (this.leadSettings = LEAD_SETTINGS[patch]);
    for (const synth of [this.lead, this.leadOct]) {
      synth.oscillator.set(s.oscillator as never);
      synth.portamento = s.portamento;
    }
    const v = this.leadVoice;
    v.dry.gain.value = s.dry;
    v.formants.gain.value = s.formants;
    v.breathLevel.gain.value = s.breath;
    v.vibrato.frequency.value = s.vibratoHz;
    v.vibrato.depth.value = s.vibratoDepth;
    for (const synth of [this.lead, this.leadOct]) {
      synth.filterEnvelope.baseFrequency = s.filterBase;
      synth.filterEnvelope.octaves = s.filterOctaves;
    }
    this.leadMix.cutoff.frequency.value = s.cutoff;
    const send = this.sends.lead.reverb;
    if (send) send.gain.value = s.reverb;
    this.applyLeadTone();
  }

  /** The genre's voice mix for the song (genres.ts `leadTone`); only the voice takes it. */
  setLeadTone(tone: LeadTone): void {
    this.leadTone = tone;
    this.applyLeadTone();
  }

  private applyLeadTone(): void {
    const t = this.leadSettings.mixed
      ? this.leadTone
      : { level: 0, low: 0, mid: 0, high: 0, air: 0, width: 0 };
    const m = this.leadMix;
    m.level.gain.value = Tone.dbToGain(t.level);
    // The voice compresses from 30 dB under full scale; the makeup gives back about what 4:1 takes
    // off the body of a phrase, so the measured levels hold.
    const mixed = this.leadSettings.mixed;
    m.comp.threshold.value = mixed ? -30 : 0;
    m.makeup.gain.value = mixed ? Tone.dbToGain(LEAD_COMP_MAKEUP_DB) : 1;
    m.low.gain.value = t.low;
    m.mid.gain.value = t.mid;
    m.air.gain.value = this.leadSettings.air * Tone.dbToGain(t.air);
    m.high.gain.value = t.high;
    m.width.gain.value = t.width;
  }

  /** A sung note's vowel, breath and vibrato onset. */
  private voiceNote(n: Note, time: number, duration: number): void {
    const s = this.leadSettings;
    if (s.formants === 0) return;
    const vowel = VOWELS[(n.midi * 7 + Math.round(n.step) * 3) % VOWELS.length];
    this.leadVoice.bands.forEach((band, i) =>
      band.frequency.linearRampToValueAtTime(vowel?.[i] ?? 1000, time + 0.06),
    );
    if (s.breath > 0) this.leadVoice.breath.triggerAttackRelease(duration, time, n.vel);
    if (s.vibratoDelay) {
      const depth = this.leadVoice.vibrato.depth;
      depth.cancelScheduledValues(time);
      depth.setValueAtTime(0, time);
      depth.linearRampToValueAtTime(s.vibratoDepth, time + Math.min(0.4, duration * 0.6));
    }
  }

  /** Sets the dotted-8th echoes to the song's tempo. */
  setTempo(bpm: number): void {
    for (const t of this.echoTimes) t.value = (0.75 * 60) / bpm;
  }

  /** Gated reverb on the snare and clap (TF, DS), or an open, untreated tail (You Came's long,
   * smooth snare: −10 dB at 80 ms, −20 dB at 220 ms, no gate cut-off). */
  setSnareGate(gated: boolean): void {
    this.snareGated = gated;
    const g = this.gate.gain;
    g.cancelScheduledValues(0);
    g.value = gated ? 0 : 0.35;
  }

  /**
   * Releases the polyphonic synths' notes at `time`. They start a note only once its time comes,
   * so one just about to start when releaseAll ran needs this second release.
   */
  releaseChords(time: number): void {
    const synths = [
      this.pad,
      this.stab,
      this.seq,
      this.riffFm,
      this.riffSaw,
      this.arp,
      this.counter,
      this.counterSoft,
      this.counterSoftNight,
      this.riffPlain,
      this.riffPulse,
      this.riffBright,
      this.synth,
      this.stabPluck,
      this.stabHeld,
      this.arpPluck,
      this.stabGlock,
      this.stabGlockTop,
      this.stabSwell,
      this.counterBright,
      this.counterEp,
      this.euro.pad,
      this.euro.riffClick,
      this.euro.riffGlide,
      this.euro.arpTriangle,
      this.euro.arpSaw,
      this.euro.stabSaw,
      this.euro.synthSaw,
    ];
    for (const s of synths) s.releaseAll(time);
  }

  /** Plays a note on the lead synth right now (recording: hear what you play). null releases. */
  monitor(midi: number | null, velocity = 0.85): void {
    this.connect("lead");
    const now = Tone.now();
    if (midi === null) this.lead.triggerRelease(now);
    else this.lead.triggerAttack(midiToFreq(midi), now, velocity);
  }

  /** Lets held pad and lead notes ring out when the transport stops. */
  /**
   * Releases every held note at `time` (now by default). The one-voice synths also drop what was
   * scheduled after it, so a note of the song being left can't cut into the next one's first notes.
   */
  releaseAll(time = Tone.now()): void {
    this.releaseChords(time);
    for (const s of [this.lead, this.leadOct, this.hook, this.bassSaw, this.bassOct]) {
      s.envelope.cancel(time);
      s.filterEnvelope.cancel(time);
      s.triggerRelease(time);
    }
    this.bassFm.envelope.cancel(time);
    this.bassFm.modulationEnvelope.cancel(time);
    this.bassFm.triggerRelease(time);
  }
}

function byOnset(notes: readonly Note[]): Note[][] {
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const g = groups.get(n.step);
    if (g) g.push(n);
    else groups.set(n.step, [n]);
  }
  return [...groups.values()];
}
