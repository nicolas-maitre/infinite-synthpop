/**
 * Polyphonic synths built from plain native nodes, a few per note, made when the note is scheduled
 * and stopped when it ends. Tone's synths build each voice from a dozen-odd nodes (signals,
 * envelopes, scalers, volume stages), many of which run even between notes, and Firefox pays for
 * every node on every 128-frame block.
 *
 * They sound the same as the Tone synths they replace: the envelopes write the same automation
 * Tone's Envelope does for a voice starting from silence (a linear attack, decay and release that
 * approach their target with Tone's time constant, finished by a linear ramp), the fat oscillator
 * uses Tone's detune spread, phase offsets and per-oscillator level, and the FM voice Tone's
 * routing and levels.
 */
import * as Tone from "tone";

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  decayCurve?: "linear" | "exponential";
}

/** One automation event. "target" is setTargetAtTime toward `value`. */
interface EnvEvent {
  kind: "set" | "linear" | "target";
  time: number;
  value: number;
  timeConstant?: number;
}

/** Tone's exponentialApproachValueAtTime time constant for a ramp of `rampTime` seconds. */
const timeConstant = (rampTime: number) => Math.log(rampTime + 1) / Math.log(200);

/**
 * An envelope's attack and decay from silence, as Tone writes them.
 */
function attackDecay(env: Adsr, start: number, peak: number, sampleTime: number): EnvEvent[] {
  const events: EnvEvent[] = [];
  if (env.attack < sampleTime) events.push({ kind: "set", time: start, value: peak });
  else {
    events.push({ kind: "set", time: start, value: 0 });
    events.push({ kind: "linear", time: start + env.attack, value: peak });
  }
  if (env.decay && env.sustain < 1) {
    const from = start + env.attack;
    const level = peak * env.sustain;
    if (env.decayCurve === "linear") {
      events.push({ kind: "linear", time: from + env.decay, value: level });
    } else {
      approach(events, from, peak, level, env.decay);
    }
  }
  return events;
}

/** Tone's exponential approach: setTarget, then a linear ramp over the last tenth. */
function approach(events: EnvEvent[], from: number, start: number, to: number, ramp: number) {
  const tc = timeConstant(ramp);
  const holdAt = from + ramp * 0.9;
  events.push({ kind: "target", time: from, value: to, timeConstant: tc });
  events.push({
    kind: "set",
    time: holdAt,
    value: to + (start - to) * Math.exp(-(ramp * 0.9) / tc),
  });
  events.push({ kind: "linear", time: from + ramp, value: to });
}

/** The value the events give at `time`. */
function valueAt(events: readonly EnvEvent[], time: number): number {
  let value = 0;
  let prevTime = 0;
  let target: EnvEvent | null = null;
  for (const e of events) {
    if (e.time > time) {
      if (e.kind === "linear") {
        const span = e.time - prevTime;
        return span > 0 ? value + ((e.value - value) * (time - prevTime)) / span : e.value;
      }
      break;
    }
    if (e.kind === "target") {
      target = e;
      continue;
    }
    value = e.value;
    prevTime = e.time;
    target = null;
  }
  if (target) {
    return (
      target.value + (value - target.value) * Math.exp(-(time - target.time) / target.timeConstant!)
    );
  }
  return value;
}

/**
 * The events cut at `time` (ending there at the value they had), followed by Tone's release
 * toward 0. Returns the events and when the release reaches 0.
 */
function withRelease(
  events: readonly EnvEvent[],
  time: number,
  release: number,
  sampleTime: number,
): { events: EnvEvent[]; silentAt: number } {
  const v = valueAt(events, time);
  const kept = events.filter((e) => e.time < time);
  const cut = events.find((e) => e.time >= time);
  kept.push({ kind: cut?.kind === "linear" ? "linear" : "set", time, value: v });
  if (v <= 0) return { events: kept, silentAt: time };
  if (release < sampleTime) {
    kept.push({ kind: "set", time, value: 0 });
    return { events: kept, silentAt: time };
  }
  approach(kept, time, v, 0, release);
  return { events: kept, silentAt: time + release };
}

/** Writes events (those at or after `from`) to a param, mapped by `offset + scale * value`. */
function write(param: AudioParam, events: readonly EnvEvent[], scale = 1, offset = 0, from = 0) {
  for (const e of events) {
    if (e.time < from) continue;
    const value = offset + scale * e.value;
    if (e.kind === "set") param.setValueAtTime(value, e.time);
    else if (e.kind === "linear") param.linearRampToValueAtTime(value, e.time);
    else param.setTargetAtTime(value, e.time, e.timeConstant!);
  }
}

/** A sounding note: what to rewrite when it is released early. */
interface Voice {
  start: number;
  /** When it falls silent (its sources stop then). */
  end: number;
  /** Oscillators and other sources, the first of which ends last. */
  sources: AudioScheduledSourceNode[];
  /** Params driven by envelopes, with each envelope's events and mapping. */
  envelopes: {
    params: AudioParam[];
    events: EnvEvent[];
    release: number;
    scale: number;
    offset: number;
  }[];
  /** Nodes to disconnect once silent. */
  nodes: AudioNode[];
}

type WaveType = "sine" | "square" | "sawtooth" | "triangle";

/** Tone's periodic wave for a basic shape started at `phase` (radians). */
const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function phasedWave(context: BaseAudioContext, type: WaveType, phase: number): PeriodicWave {
  let cache = waves.get(context);
  if (!cache) waves.set(context, (cache = new Map()));
  const key = `${type}:${phase}`;
  let wave = cache.get(key);
  if (!wave) {
    const size = 2048;
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    for (let n = 1; n < size; n++) {
      const piFactor = 2 / (n * Math.PI);
      const b =
        type === "sine"
          ? n === 1
            ? 1
            : 0
          : type === "square"
            ? n & 1
              ? 2 * piFactor
              : 0
            : type === "sawtooth"
              ? piFactor * (n & 1 ? 1 : -1)
              : n & 1
                ? 2 * piFactor * piFactor * (((n - 1) >> 1) & 1 ? -1 : 1)
                : 0;
      real[n] = -b * Math.sin(phase * n);
      imag[n] = b * Math.cos(phase * n);
    }
    wave = context.createPeriodicWave(real, imag);
    cache.set(key, wave);
  }
  return wave;
}

export interface OscillatorSpec {
  type: WaveType;
  /** Fat oscillator: this many detuned copies (1 = a plain oscillator). */
  count?: number;
  /** Fat oscillator: detune spread in cents. */
  spread?: number;
}

/**
 * Base for the native polysynths: an output gain (the synth's volume), voice bookkeeping, the
 * polyphony cap, and early release.
 */
abstract class NativePoly extends Tone.ToneAudioNode {
  readonly input = undefined;
  readonly output: GainNode;
  private voices: Voice[] = [];

  constructor(
    volumeDb: number,
    /** Notes beyond this many sounding are dropped, as PolySynth does. */
    public maxPolyphony = 32,
  ) {
    super();
    this.output = this.context.createGain();
    this.output.gain.value = Tone.dbToGain(volumeDb);
  }

  protected get raw(): BaseAudioContext {
    return this.context.rawContext as unknown as BaseAudioContext;
  }

  /** Plays a note, or a chord (one voice per note). */
  triggerAttackRelease(
    frequency: number | readonly number[],
    duration: number,
    time: number,
    velocity = 1,
  ): void {
    this.prune(time);
    for (const f of typeof frequency === "number" ? [frequency] : frequency) {
      const sounding = this.voices.filter((v) => v.start <= time && v.end > time).length;
      if (sounding >= this.maxPolyphony) return;
      const voice = this.makeVoice(f, time, time + duration, velocity);
      this.voices.push(voice);
      voice.sources[0]!.onended = () => {
        for (const n of voice.nodes) n.disconnect();
      };
    }
  }

  protected abstract makeVoice(
    frequency: number,
    start: number,
    release: number,
    velocity: number,
  ): Voice;

  /** Builds `count` oscillators per Tone's FatOscillator (or one plain one). */
  protected oscillators(spec: OscillatorSpec, frequency: number, start: number): OscillatorNode[] {
    const count = spec.count ?? 1;
    const spread = spec.spread ?? 0;
    return Array.from({ length: count }, (_, i) => {
      const osc = this.raw.createOscillator();
      const phase = count > 1 ? ((i / count) * 360 * Math.PI) / 180 : 0;
      if (phase === 0) osc.type = spec.type;
      else osc.setPeriodicWave(phasedWave(this.raw, spec.type, phase));
      osc.frequency.value = frequency;
      if (count > 1) osc.detune.value = -spread / 2 + (spread / (count - 1)) * i;
      osc.start(start);
      return osc;
    });
  }

  /** Each oscillator's level in a fat oscillator, as Tone sets it. */
  protected static fatGain(spec: OscillatorSpec): number {
    const count = spec.count ?? 1;
    return count > 1 ? Tone.dbToGain(-6 - count * 1.1) : 1;
  }

  /** Schedules an envelope on params; returns its events cut by the release and when it ends. */
  protected envelope(
    voice: Pick<Voice, "envelopes">,
    params: AudioParam[],
    env: Adsr,
    start: number,
    releaseAt: number,
    peak: number,
    scale = 1,
    offset = 0,
  ): number {
    const sampleTime = 1 / this.raw.sampleRate;
    const { events, silentAt } = withRelease(
      attackDecay(env, start, peak, sampleTime),
      releaseAt,
      env.release,
      sampleTime,
    );
    for (const p of params) write(p, events, scale, offset);
    voice.envelopes.push({ params, events, release: env.release, scale, offset });
    // A voice with no sustain falls silent at the end of its decay.
    const decayEnd = start + env.attack + env.decay;
    return env.sustain === 0 ? Math.min(silentAt, decayEnd) : silentAt;
  }

  /**
   * Releases every note sounding at `time`, and drops those that would start after it (Tone's
   * PolySynth started a note only when its time came, so a cut couldn't reach them).
   */
  releaseAll(time = this.now()): void {
    const sampleTime = 1 / this.raw.sampleRate;
    for (const voice of this.voices) {
      if (voice.end <= time) continue;
      if (voice.start >= time) {
        for (const o of voice.sources) o.stop(voice.start);
        voice.end = voice.start;
        continue;
      }
      let end = time;
      for (const e of voice.envelopes) {
        const cut = withRelease(e.events, time, e.release, sampleTime);
        for (const p of e.params) {
          p.cancelScheduledValues(time);
          write(p, cut.events, e.scale, e.offset, time);
        }
        e.events = cut.events;
        end = Math.max(end, cut.silentAt);
      }
      voice.end = Math.min(voice.end, end);
      for (const o of voice.sources) o.stop(voice.end);
    }
  }

  private prune(time: number): void {
    if (this.voices.length > 64) this.voices = this.voices.filter((v) => v.end > time - 1);
  }
}

/** Tone.PolySynth(Tone.Synth): oscillator(s) through an amplitude envelope. */
export class NativeSynth extends NativePoly {
  readonly name = "NativeSynth";

  constructor(
    private readonly options: {
      oscillator: OscillatorSpec;
      envelope: Adsr;
      volume?: number;
      maxPolyphony?: number;
    },
  ) {
    super(options.volume ?? 0, options.maxPolyphony);
  }

  protected makeVoice(frequency: number, start: number, release: number, velocity: number): Voice {
    const { oscillator, envelope } = this.options;
    const amp = this.raw.createGain();
    amp.gain.value = 0;
    amp.connect(this.output);
    const oscillators = this.oscillators(oscillator, frequency, start);
    for (const o of oscillators) o.connect(amp);
    const voice: Voice = {
      start,
      end: 0,
      sources: [...oscillators],
      envelopes: [],
      nodes: [amp, ...oscillators],
    };
    voice.end = this.envelope(
      voice,
      [amp.gain],
      envelope,
      start,
      release,
      velocity,
      NativePoly.fatGain(oscillator),
    );
    for (const o of oscillators) o.stop(voice.end);
    return voice;
  }
}

/** Tone.PolySynth(Tone.MonoSynth) without portamento: oscillator, enveloped filter, amp. */
export class NativeMonoSynth extends NativePoly {
  readonly name = "NativeMonoSynth";

  constructor(
    private readonly options: {
      oscillator: OscillatorSpec;
      filter: { type: BiquadFilterType; rolloff: -12 | -24 | -48; Q: number };
      envelope: Adsr;
      /** `exponent` shapes the sweep: 2 by default, as in MonoSynth. */
      filterEnvelope: Adsr & { baseFrequency: number; octaves: number; exponent?: 1 | 2 };
      volume?: number;
      maxPolyphony?: number;
    },
  ) {
    super(options.volume ?? 0, options.maxPolyphony);
  }

  protected makeVoice(frequency: number, start: number, release: number, velocity: number): Voice {
    const { oscillator, filter, envelope, filterEnvelope } = this.options;
    const amp = this.raw.createGain();
    amp.gain.value = 0;
    amp.connect(this.output);
    // Tone cascades 1, 2, 3 or 4 biquads for -12, -24, -48 or -96 dB.
    const count = [-12, -24, -48, -96].indexOf(filter.rolloff) + 1;
    const stages = Array.from({ length: count }, () => {
      const f = this.raw.createBiquadFilter();
      f.type = filter.type;
      f.Q.value = filter.Q;
      return f;
    });
    stages.at(-1)!.connect(amp);
    for (let i = 0; i + 1 < stages.length; i++) stages[i]!.connect(stages[i + 1]!);
    const oscillators = this.oscillators(oscillator, frequency, start);
    for (const o of oscillators) o.connect(stages[0]!);
    const voice: Voice = {
      start,
      end: 0,
      sources: [...oscillators],
      envelopes: [],
      nodes: [amp, ...stages, ...oscillators],
    };
    // Tone's FrequencyEnvelope maps the envelope e (0–1) onto base + range · e^exponent, where
    // range reaches base·2^octaves.
    const base = filterEnvelope.baseFrequency;
    const range = base * (2 ** filterEnvelope.octaves - 1);
    if ((filterEnvelope.exponent ?? 2) === 2) {
      // e² as a signal: the envelope (scaled by √range) multiplied by itself in a gain.
      const env = this.raw.createConstantSource();
      const squared = this.raw.createGain();
      squared.gain.value = 0;
      env.connect(squared);
      env.connect(squared.gain);
      for (const f of stages) {
        f.frequency.value = base;
        squared.connect(f.frequency);
      }
      env.start(start);
      voice.sources.push(env);
      voice.nodes.push(env, squared);
      this.envelope(voice, [env.offset], filterEnvelope, start, release, 1, Math.sqrt(range));
    } else {
      this.envelope(
        voice,
        stages.map((f) => f.frequency),
        filterEnvelope,
        start,
        release,
        1,
        range,
        base,
      );
    }
    voice.end = this.envelope(
      voice,
      [amp.gain],
      envelope,
      start,
      release,
      velocity,
      NativePoly.fatGain(oscillator),
    );
    for (const o of voice.sources) o.stop(voice.end);
    return voice;
  }
}

/**
 * Tone.PolySynth(Tone.FMSynth): a carrier whose frequency is pushed by a modulator at
 * `harmonicity` × the note, scaled by `modulationIndex` × the note. Both run at -10 dB, as in
 * Tone's ModulationSynth.
 */
export class NativeFMSynth extends NativePoly {
  readonly name = "NativeFMSynth";

  constructor(
    private readonly options: {
      harmonicity: number;
      modulationIndex: number;
      oscillator?: OscillatorSpec;
      modulation?: OscillatorSpec;
      envelope: Adsr;
      modulationEnvelope: Adsr;
      volume?: number;
      maxPolyphony?: number;
    },
  ) {
    super(options.volume ?? 0, options.maxPolyphony);
  }

  protected makeVoice(frequency: number, start: number, release: number, velocity: number): Voice {
    const o = this.options;
    const level = Tone.dbToGain(-10);
    const amp = this.raw.createGain();
    amp.gain.value = 0;
    amp.connect(this.output);
    const depth = this.raw.createGain();
    depth.gain.value = 0;
    const [carrier] = this.oscillators(o.oscillator ?? { type: "sine" }, frequency, start);
    const [modulator] = this.oscillators(
      o.modulation ?? { type: "square" },
      frequency * o.harmonicity,
      start,
    );
    modulator!.connect(depth);
    depth.connect(carrier!.frequency);
    carrier!.connect(amp);
    const voice: Voice = {
      start,
      end: 0,
      sources: [carrier!, modulator!],
      envelopes: [],
      nodes: [amp, depth, carrier!, modulator!],
    };
    const modEnd = this.envelope(
      voice,
      [depth.gain],
      o.modulationEnvelope,
      start,
      release,
      velocity,
      level * frequency * o.modulationIndex,
    );
    const end = this.envelope(voice, [amp.gain], o.envelope, start, release, velocity, level);
    voice.end = end;
    carrier!.stop(end);
    modulator!.stop(Math.max(modEnd, start));
    return voice;
  }
}
