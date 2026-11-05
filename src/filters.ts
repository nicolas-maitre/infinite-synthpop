/**
 * Fixed filters as plain native biquads. A Tone.Filter drives its biquad's frequency, Q, gain and
 * detune from signal nodes, so browsers recompute the coefficients every sample. Swapping the
 * instruments' fixed filters for these took a busy lite-mode chorus from 26.9% to 24.6% of real
 * time in Firefox on a desktop. For filters whose settings never move, they sound the same as
 * Tone.Filter at its default -12 dB rolloff (one biquad).
 */
import * as Tone from "tone";

export class FixedFilter extends Tone.ToneAudioNode {
  readonly name = "FixedFilter";
  readonly input: BiquadFilterNode;
  readonly output: BiquadFilterNode;

  constructor(type: BiquadFilterType, frequency: number, { Q = 1, gain = 0 } = {}) {
    super();
    const f = this.context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    this.input = f;
    this.output = f;
  }

  /** The filter's gain in dB (shelf and peaking filters). */
  get gain(): AudioParam {
    return this.input.gain;
  }
}

/**
 * Tone.EQ3 rebuilt from fixed biquads: the same band split (12 dB/octave, Q 1) and band gains in
 * dB, without its signal-driven filters.
 */
export class FixedEQ3 extends Tone.ToneAudioNode {
  readonly name = "FixedEQ3";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();

  constructor({
    low,
    mid,
    high,
    lowFrequency,
    highFrequency,
  }: {
    low: number;
    mid: number;
    high: number;
    lowFrequency: number;
    highFrequency: number;
  }) {
    super();
    const band = (db: number, ...filters: FixedFilter[]) =>
      this.input.chain(...filters, new Tone.Gain(Tone.dbToGain(db)), this.output);
    band(low, new FixedFilter("lowpass", lowFrequency));
    band(mid, new FixedFilter("highpass", lowFrequency), new FixedFilter("lowpass", highFrequency));
    band(high, new FixedFilter("highpass", highFrequency));
  }
}
