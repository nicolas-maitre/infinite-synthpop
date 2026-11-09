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
 * Three-band bus EQ in dB, built from shelves: an overall `mid` gain, a low shelf at
 * `lowFrequency` to bring the lows to `low`, and a high shelf at `highFrequency` to bring the highs
 * to `high`. With all gains at 0 it is flat. It replaces a Tone.EQ3-style band split (2nd-order,
 * Q 1, lowpass + bandpass + highpass summed): at each corner the summed bands cancel, so that split
 * notched the whole mix by about 20 dB near 120 Hz and 25 dB near 3.3 kHz, on the bass and the
 * lead harmonics.
 */
export class FixedEQ3 extends Tone.ToneAudioNode {
  readonly name = "FixedEQ3";
  readonly input: Tone.Gain;
  readonly output: FixedFilter;

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
    this.input = new Tone.Gain(Tone.dbToGain(mid));
    const lowShelf = new FixedFilter("lowshelf", lowFrequency, { gain: low - mid });
    this.output = new FixedFilter("highshelf", highFrequency, { gain: high - mid });
    this.input.chain(lowShelf, this.output);
  }
}
