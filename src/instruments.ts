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
import type { BassTone } from "./genres";
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
  lead: "Lead",
  counter: "Counter line",
  arp: "Arp",
  stab: "Stabs",
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
};

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
};

/** Post-fader send levels (gain) to the reverb and delay buses. */
const SENDS: Record<Track, { reverb: number; delay: number }> = {
  drums: { reverb: 0.08, delay: 0 },
  bass: { reverb: 0, delay: 0 },
  seq: { reverb: 0.25, delay: 0.12 },
  guitar: { reverb: 0.18, delay: 0 },
  hook: { reverb: 0.2, delay: 0.05 },
  pad: { reverb: 0.45, delay: 0 },
  riff: { reverb: 0.3, delay: 0.25 },
  lead: { reverb: 0.35, delay: 0.2 },
  counter: { reverb: 0.45, delay: 0.15 },
  arp: { reverb: 0.4, delay: 0.3 },
  stab: { reverb: 0.5, delay: 0.1 },
};

export interface InstrumentOptions {
  /** Lighter voices and effects, for phones (quality.ts). Offline renders always use the full set. */
  lite?: boolean;
}

/** How long a track keeps sounding after a song stops using it (the bar still playing, release
 * tails), before it is disconnected so the browser stops processing it. */
const UNUSED_TRACK_DELAY_MS = 5000;

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
  private readonly hook: Tone.MonoSynth;
  private readonly pad: NativeSynth;
  private readonly riffFm: NativeFMSynth;
  private readonly riffSaw: NativeSynth;
  private readonly lead: Tone.MonoSynth;
  private readonly leadOct: Tone.MonoSynth;
  private readonly counter: NativeFMSynth;
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
    // full-scale frames in one song). The soft clipper is linear below -2 dBFS and rounds off
    // anything above toward a -0.5 dBFS ceiling, up to +6 dB in (the halving gain keeps that
    // inside the shaper's ±1 input).
    const knee = 0.79;
    const ceiling = 0.944;
    const softClip = new Tone.WaveShaper((x) => {
      const v = Math.abs(x * 2);
      const y = v <= knee ? v : knee + (ceiling - knee) * Math.tanh((v - knee) / (ceiling - knee));
      return Math.sign(x) * y;
    }, 4096);
    // Headroom trim: without it the bus compressor and limiter squashed TF-style songs to a crest
    // factor of 11 dB (the records: 15–18).
    const trim = new Tone.Gain(Tone.dbToGain(-5.5));
    this.master.chain(trim, eq, comp, limiter, new Tone.Gain(0.5), softClip, Tone.getDestination());
    softClip.fan(this.fft, this.waveform);

    const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.32, wet: 1 });
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
        if (rv > 0) routes.push(new Tone.Gain(rv).connect(reverb));
        if (dl > 0) routes.push(new Tone.Gain(dl).connect(delay));
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
    this.bassTone.chain(bassDrive, bassEq, this.bassPresence, this.channels.bass);
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
    const riffFilter = new FixedFilter("lowpass", 3200);
    this.riffSaw = new NativeSynth({
      volume: -6,
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0.15, release: 0.2 },
    }).chain(riffFilter, this.channels.riff);

    // Lead "voice": portamento + vibrato on detuned saws.
    const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.07 });
    const leadFilter = new FixedFilter("lowpass", 4500);
    vibrato.chain(leadFilter, this.channels.lead);
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
    this.lead = new Tone.MonoSynth(leadOptions).connect(vibrato);
    this.leadOct = new Tone.MonoSynth(leadOptions).connect(vibrato);

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
    const stabNoiseFilter = new FixedFilter("bandpass", 2500);
    this.stabNoise = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
      volume: ARP_STAB_GAIN_DB,
    }).chain(stabNoiseFilter, this.channels.stab);

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
        for (const n of notes)
          this.lead.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      case "leadOct":
        for (const n of notes) {
          this.leadOct.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        }
        break;
      case "counter":
        for (const n of notes)
          this.counter.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      case "riff":
        for (const n of notes) {
          this.riffFm.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
          this.riffSaw.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        }
        break;
      case "arp":
        for (const n of notes)
          this.arp.triggerAttackRelease(midiToFreq(n.midi), len(n), at(n), n.vel);
        break;
      case "pad":
        for (const group of byOnset(notes)) {
          const [first] = group;
          if (!first) continue;
          this.pad.triggerAttackRelease(
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
          this.stab.triggerAttackRelease(
            group.map((n) => midiToFreq(n.midi)),
            len(first),
            at(first),
            first.vel,
          );
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
    const type = this.bassOctOn ? "triangle" : "sawtooth";
    if (this.bassSaw.oscillator.type !== type) this.bassSaw.oscillator.type = type;
    this.bassSaw.envelope.sustain = tone.sustain;
    this.bassOct.envelope.sustain = tone.sustain;
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
