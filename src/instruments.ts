/**
 * Synth voices, effect buses and the mixer. Each voice is modelled on the gear in
 * docs/analysis.md §4: DX-style FM bass, chorused melodic bass, Emulator/Voyetra-ish pad, FM riff,
 * a singing mono lead, FM bell arp, and saw-brass stabs.
 */
import * as Tone from "tone";
import type { DrumHit, MelodicTrack } from "./arranger";
import type { Note } from "./composer";
import { DrumKit } from "./drums";
import { midiToFreq } from "./theory";

export const TRACKS = ["drums", "bass", "hook", "pad", "riff", "lead", "arp", "stab"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  drums: "Drums",
  bass: "Seq bass",
  hook: "Melodic bass",
  pad: "Pad",
  riff: "Riff",
  lead: "Lead",
  arp: "Arp",
  stab: "Stabs",
};

export const DEFAULT_VOLUMES: Record<Track, number> = {
  drums: -3,
  bass: -10,
  hook: -9,
  pad: -10,
  riff: -8,
  lead: -6,
  arp: -16,
  stab: -14,
};

/** Spread the motif layers across the stereo field; bass, lead and drums stay centred. */
const PANS: Record<Track, number> = {
  drums: 0,
  bass: 0,
  hook: -0.15,
  pad: 0,
  riff: -0.3,
  lead: 0,
  arp: 0.35,
  stab: 0.1,
};

/** Post-fader send levels (gain) to the reverb and delay buses. */
const SENDS: Record<Track, { reverb: number; delay: number }> = {
  drums: { reverb: 0.08, delay: 0 },
  bass: { reverb: 0, delay: 0 },
  hook: { reverb: 0.2, delay: 0.05 },
  pad: { reverb: 0.45, delay: 0 },
  riff: { reverb: 0.3, delay: 0.25 },
  lead: { reverb: 0.35, delay: 0.2 },
  arp: { reverb: 0.4, delay: 0.3 },
  stab: { reverb: 0.5, delay: 0.1 },
};

export class Instruments {
  readonly channels: Record<Track, Tone.Channel>;
  readonly master = new Tone.Volume(0);
  readonly fft = new Tone.Analyser("fft", 256);
  readonly waveform = new Tone.Analyser("waveform", 1024);
  readonly drums = new DrumKit();

  private readonly gate = new Tone.Gain(0);
  private readonly bassFm: Tone.FMSynth;
  private readonly bassSaw: Tone.MonoSynth;
  private readonly hook: Tone.MonoSynth;
  private readonly pad: Tone.PolySynth;
  private readonly riffFm: Tone.PolySynth<Tone.FMSynth>;
  private readonly riffSaw: Tone.PolySynth;
  private readonly lead: Tone.MonoSynth;
  private readonly leadOct: Tone.MonoSynth;
  private readonly arp: Tone.PolySynth<Tone.FMSynth>;
  private readonly stab: Tone.PolySynth;
  private readonly stabNoise: Tone.NoiseSynth;

  private constructor(reverb: Tone.Reverb, gatedVerb: Tone.Reverb) {
    // Bus glue, matched to the references' level and band balance (scripts/compare_mix.py).
    const eq = new Tone.EQ3({
      low: -1.5,
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
    this.master.chain(eq, comp, limiter, new Tone.Gain(0.5), softClip, Tone.getDestination());
    softClip.fan(this.fft, this.waveform);

    const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.32, wet: 1 });
    const delayFilter = new Tone.Filter(600, "highpass");
    delay.chain(delayFilter, this.master);
    reverb.connect(this.master);

    this.channels = Object.fromEntries(
      TRACKS.map((t) => {
        // channelCount 2: Tone.Channel defaults to mono, which collapsed every chorus and reverb.
        const ch = new Tone.Channel({
          volume: DEFAULT_VOLUMES[t],
          pan: PANS[t],
          channelCount: 2,
        }).connect(this.master);
        const { reverb: rv, delay: dl } = SENDS[t];
        if (rv > 0) ch.connect(new Tone.Gain(rv).connect(reverb));
        if (dl > 0) ch.connect(new Tone.Gain(dl).connect(delay));
        return [t, ch];
      }),
    ) as Record<Track, Tone.Channel>;

    // Drums + 80s gated reverb: snare/clap → reverb → a gate opened on each hit (see gateHit).
    this.drums.output.connect(this.channels.drums);
    this.drums.gateSend.connect(gatedVerb);
    gatedVerb.chain(this.gate, this.channels.drums);

    // Sequenced bass: DX-style FM thump layered with a filtered saw for weight.
    this.bassFm = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 5,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.25, sustain: 0.55, release: 0.06 },
      modulationEnvelope: { attack: 0.002, decay: 0.12, sustain: 0.25, release: 0.08 },
    }).connect(this.channels.bass);
    this.bassSaw = new Tone.MonoSynth({
      volume: -8,
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: 2 },
      envelope: { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.05 },
      filterEnvelope: {
        attack: 0.002,
        decay: 0.14,
        sustain: 0.2,
        release: 0.08,
        baseFrequency: 110,
        octaves: 3,
      },
    }).connect(this.channels.bass);

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

    // Pad: detuned saws, slow attack, darkened and chorused.
    const padFilter = new Tone.Filter(2800, "lowpass", -12);
    const padChorus = new Tone.Chorus({
      frequency: 0.8,
      delayTime: 4,
      depth: 0.5,
      wet: 0.5,
    }).start();
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 22 } as Tone.OmniOscillatorOptions,
      envelope: { attack: 0.35, decay: 0.6, sustain: 0.8, release: 1.1 },
    }).chain(padFilter, padChorus, this.channels.pad);
    this.pad.maxPolyphony = 16;

    // Riff: DX bell-pluck layered with a bright saw pluck.
    this.riffFm = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 9,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.08, release: 0.3 },
      modulationEnvelope: { attack: 0.001, decay: 0.18, sustain: 0.1, release: 0.2 },
    }).connect(this.channels.riff);
    const riffFilter = new Tone.Filter(3200, "lowpass");
    this.riffSaw = new Tone.PolySynth(Tone.Synth, {
      volume: -6,
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0.15, release: 0.2 },
    }).chain(riffFilter, this.channels.riff);

    // Lead "voice": portamento + vibrato on detuned saws.
    const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.07 });
    const leadFilter = new Tone.Filter(4500, "lowpass");
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

    this.arp = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 4,
      modulationIndex: 3,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 },
      modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
    }).connect(this.channels.arp);

    // Stab: saw-brass chord plus a noise burst, a nod to the sampled orchestral hit.
    this.stab = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 30 } as Tone.OmniOscillatorOptions,
      envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
    }).connect(this.channels.stab);
    const stabNoiseFilter = new Tone.Filter(2500, "bandpass");
    this.stabNoise = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    }).chain(stabNoiseFilter, this.channels.stab);
  }

  static async create(): Promise<Instruments> {
    const reverb = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 1 });
    const gated = new Tone.Reverb({ decay: 1.6, preDelay: 0.005, wet: 1 });
    await Promise.all([reverb.ready, gated.ready]);
    return new Instruments(reverb, gated);
  }

  drum(hit: DrumHit, time: number): void {
    this.drums.trigger(hit.voice, time, hit.vel);
    if (hit.voice === "snare" || hit.voice === "clap") this.gateHit(time);
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
    }
  }

  /** Lets held pad and lead notes ring out when the transport stops. */
  releaseAll(): void {
    const now = Tone.now();
    this.pad.releaseAll(now);
    this.stab.releaseAll(now);
    this.riffFm.releaseAll(now);
    this.riffSaw.releaseAll(now);
    this.arp.releaseAll(now);
    for (const s of [this.lead, this.leadOct, this.hook, this.bassSaw]) s.triggerRelease(now);
    this.bassFm.triggerRelease(now);
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
