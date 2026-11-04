/**
 * Drum machine: local samples (public/samples/<kit>/<voice>.wav, fetched by `pnpm fetch-samples`),
 * with a synthesized voice for anything that's missing or for the "synth" kit.
 */
import * as Tone from "tone";
import { DRUM_VOICES, type DrumVoice } from "./arranger";
import type { KitName } from "./composer";

export const SAMPLE_KITS = ["sp12", "linndrum", "dmx"] as const satisfies readonly KitName[];
export const KIT_LABELS: Record<KitName, string> = {
  sp12: "E-mu SP-12",
  linndrum: "LinnDrum",
  dmx: "Oberheim DMX",
  synth: "Synthesized",
};

type SynthVoice = (time: number, vel: number) => void;

export class DrumKit {
  /** Everything ends up here. */
  readonly output = new Tone.Gain(1);
  /** Snare and clap also feed the gated reverb through this. */
  readonly gateSend = new Tone.Gain(1);
  private readonly snareBus = new Tone.Gain(1);
  private readonly buffers = new Map<KitName, Map<DrumVoice, Tone.ToneAudioBuffer>>();
  private readonly synth: Record<DrumVoice, SynthVoice>;
  private current: KitName = "synth";
  private openHat: Tone.ToneBufferSource | null = null;

  constructor() {
    this.snareBus.connect(this.output);
    this.snareBus.connect(this.gateSend);
    this.synth = buildSynthKit(this.output, this.snareBus);
  }

  get kit(): KitName {
    return this.current;
  }

  /** Loads every sample kit. Returns the voices that fell back to synthesis, per kit. */
  async loadAll(): Promise<Record<string, DrumVoice[]>> {
    const missing: Record<string, DrumVoice[]> = {};
    await Promise.all(
      SAMPLE_KITS.map(async (kit) => {
        const map = new Map<DrumVoice, Tone.ToneAudioBuffer>();
        const lost: DrumVoice[] = [];
        await Promise.all(
          DRUM_VOICES.map(async (voice) => {
            try {
              const url = `${import.meta.env.BASE_URL}samples/${kit}/${voice}.wav`;
              map.set(voice, await new Tone.ToneAudioBuffer().load(url));
            } catch {
              lost.push(voice);
            }
          }),
        );
        this.buffers.set(kit, map);
        if (lost.length) missing[kit] = lost;
      }),
    );
    return missing;
  }

  use(kit: KitName): void {
    this.current = kit;
  }

  /** True when the kit has at least one real sample loaded. */
  hasSamples(kit: KitName): boolean {
    return (this.buffers.get(kit)?.size ?? 0) > 0;
  }

  trigger(voice: DrumVoice, time: number, vel: number): void {
    if (voice === "hat" && this.openHat) {
      // Closed hat chokes the open hat, like on the real machines.
      this.openHat.stop(time);
      this.openHat = null;
    }
    const buffer = this.buffers.get(this.current)?.get(voice);
    if (!buffer) {
      this.synth[voice](time, vel);
      return;
    }
    const src = new Tone.ToneBufferSource(buffer);
    src.connect(voice === "snare" || voice === "clap" ? this.snareBus : this.output);
    src.onended = () => src.dispose();
    src.start(time, 0, undefined, vel ** 1.4);
    if (voice === "openhat") this.openHat = src;
  }
}

function buildSynthKit(
  out: Tone.InputNode,
  snareBus: Tone.InputNode,
): Record<DrumVoice, SynthVoice> {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 },
  }).connect(out);

  const noise = (
    type: "white" | "pink",
    decay: number,
    filter: Tone.FilterOptions["type"],
    freq: number,
    dest = out,
  ) => {
    const f = new Tone.Filter(freq, filter).connect(dest);
    return new Tone.NoiseSynth({
      noise: { type },
      envelope: { attack: 0.001, decay, sustain: 0, release: decay / 2 },
    }).connect(f);
  };

  const snareNoise = noise("white", 0.18, "highpass", 1200, snareBus);
  const snareBody = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
  }).connect(snareBus);
  const clap = noise("white", 0.14, "bandpass", 1300, snareBus);
  const hat = noise("white", 0.035, "highpass", 8000);
  const openhat = noise("white", 0.28, "highpass", 7000);
  const crash = noise("white", 1.6, "highpass", 4500);
  const tamb = noise("white", 0.08, "highpass", 9000);
  const cabasa = noise("pink", 0.03, "highpass", 6000);
  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.08,
    octaves: 2.5,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
  }).connect(out);
  const rim = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
  }).connect(out);

  return {
    kick: (t, v) => kick.triggerAttackRelease(48, 0.3, t, v),
    snare: (t, v) => {
      snareNoise.triggerAttackRelease(0.15, t, v * 0.8);
      snareBody.triggerAttackRelease(185, 0.1, t, v * 0.6);
    },
    clap: (t, v) => clap.triggerAttackRelease(0.12, t, v),
    hat: (t, v) => hat.triggerAttackRelease(0.03, t, v * 0.6),
    openhat: (t, v) => openhat.triggerAttackRelease(0.25, t, v * 0.5),
    crash: (t, v) => crash.triggerAttackRelease(1.2, t, v * 0.5),
    tomh: (t, v) => tom.triggerAttackRelease(200, 0.25, t, v),
    tomm: (t, v) => tom.triggerAttackRelease(150, 0.25, t, v),
    toml: (t, v) => tom.triggerAttackRelease(105, 0.3, t, v),
    rim: (t, v) => rim.triggerAttackRelease(1700, 0.02, t, v * 0.5),
    tamb: (t, v) => tamb.triggerAttackRelease(0.07, t, v * 0.5),
    cabasa: (t, v) => cabasa.triggerAttackRelease(0.03, t, v * 0.5),
  };
}
