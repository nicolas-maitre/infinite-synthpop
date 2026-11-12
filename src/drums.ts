/**
 * Drum machine samples, from the first place that has each one:
 * 1. this site (public/samples/<kit>/<voice>.wav, fetched by `pnpm fetch-samples`);
 * 2. GitHub's raw-file CDN, serving the same files from their repository at the pinned commit
 *    (jsDelivr would cache better, but refuses that repository: it is over its 50 MB limit);
 * 3. a synthesized voice (also the whole "synth" kit).
 */
import * as Tone from "tone";
import { FixedFilter } from "./filters";
import { DRUM_VOICES, type DrumVoice } from "./arranger";
import type { KitName } from "./composer";
import SOURCES from "./sample-sources.json";

/** Where each kit's samples came from, voice by voice. */
export interface SampleReport {
  local: number;
  /** Loaded from GitHub. */
  remote: number;
  /** Voices played by the synth instead. */
  missing: DrumVoice[];
}

/** Set at build time: whether public/samples had any samples (vite.config.ts). */
declare const __LOCAL_SAMPLES__: boolean;

const REMOTE = `https://raw.githubusercontent.com/${SOURCES.repo}/${SOURCES.commit}/${SOURCES.root}`;

/** Where GitHub serves a kit's voice, or null if it has none. */
export function remoteUrl(kit: string, voice: DrumVoice): string | null {
  const path = (SOURCES.kits as Record<string, Partial<Record<DrumVoice, string>>>)[kit]?.[voice];
  return path ? `${REMOTE}/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}

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
  /** The sampled kick's path: straight through, or (setKickWeight) through a low shelf. The
   * straight path stays bit for bit what it was. */
  private readonly kickBus = new Tone.Gain(1);
  private readonly kickThrough = new Tone.Gain(1);
  private readonly kickShelved = new Tone.Gain(0);
  private readonly kickShelf = new FixedFilter("lowshelf", 90);
  private readonly buffers = new Map<KitName, Map<DrumVoice, Tone.ToneAudioBuffer>>();
  private readonly synth: Record<DrumVoice, SynthVoice>;
  private current: KitName = "synth";
  private openHat: Tone.ToneBufferSource | null = null;

  constructor() {
    this.snareBus.connect(this.output);
    this.snareBus.connect(this.gateSend);
    this.kickBus.fan(this.kickThrough, this.kickShelf);
    this.kickThrough.connect(this.output);
    this.kickShelf.chain(this.kickShelved, this.output);
    this.synth = buildSynthKit(this.output, this.snareBus);
  }

  get kit(): KitName {
    return this.current;
  }

  /**
   * Loads every sample kit, each voice from the site, else GitHub, else leaving it to the synth.
   * `onProgress` hears how many of the voices are settled. The samples are loaded once per page
   * and shared by every kit after (the live one, each offline render's).
   */
  async loadAll(
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<string, SampleReport>> {
    const { buffers, report } = await loadSampleKits(onProgress);
    for (const [kit, map] of buffers) this.buffers.set(kit, map);
    return report;
  }

  use(kit: KitName): void {
    this.current = kit;
  }

  /** Lifts the sampled kick under 90 Hz by `db` (0: as sampled). Self Control's kick carries
   * its record's whole low end (branigan-self-control.md §12). */
  setKickWeight(db: number): void {
    this.kickThrough.gain.value = db ? 0 : 1;
    this.kickShelved.gain.value = db ? 1 : 0;
    this.kickShelf.input.gain.value = db;
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
    // In the kit's own context, not Tone's global one, which an offline render may be borrowing.
    const src = new Tone.ToneBufferSource({ url: buffer, context: this.output.context });
    src.connect(
      voice === "snare" || voice === "clap"
        ? this.snareBus
        : voice === "kick"
          ? this.kickBus
          : this.output,
    );
    src.onended = () => src.dispose();
    src.start(time, 0, undefined, vel ** 1.4);
    if (voice === "openhat") this.openHat = src;
  }
}

/** A sample, or null when it isn't there (a 404, or a page served in its place). */
type LoadedKits = {
  buffers: Map<KitName, Map<DrumVoice, Tone.ToneAudioBuffer>>;
  report: Record<string, SampleReport>;
};
let loadedKits: Promise<LoadedKits> | null = null;

/** Every sample kit, loaded on the first call; later calls share it. Only the first call's
 * `onProgress` hears the loading. */
export function loadSampleKits(
  onProgress?: (done: number, total: number) => void,
): Promise<LoadedKits> {
  loadedKits ??= (async () => {
    const buffers: LoadedKits["buffers"] = new Map();
    const report: Record<string, SampleReport> = {};
    const total = SAMPLE_KITS.length * DRUM_VOICES.length;
    let done = 0;
    await Promise.all(
      SAMPLE_KITS.map(async (kit) => {
        const map = new Map<DrumVoice, Tone.ToneAudioBuffer>();
        const kitReport: SampleReport = { local: 0, remote: 0, missing: [] };
        report[kit] = kitReport;
        await Promise.all(
          DRUM_VOICES.map(async (voice) => {
            const local = `${import.meta.env.BASE_URL}samples/${kit}/${voice}.wav`;
            const remote = remoteUrl(kit, voice);
            const here = __LOCAL_SAMPLES__ ? await load(local) : null;
            const buffer = here ?? (remote ? await load(remote) : null);
            if (buffer) {
              map.set(voice, buffer);
              kitReport[here ? "local" : "remote"]++;
            } else kitReport.missing.push(voice);
            onProgress?.(++done, total);
          }),
        );
        buffers.set(kit, map);
      }),
    );
    return { buffers, report };
  })();
  return loadedKits;
}

async function load(url: string): Promise<Tone.ToneAudioBuffer | null> {
  try {
    return await new Tone.ToneAudioBuffer().load(url);
  } catch {
    return null;
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
    const f = new FixedFilter(filter, freq).connect(dest);
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
