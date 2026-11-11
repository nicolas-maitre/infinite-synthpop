/**
 * Offline rendering: a whole song (or its first `bars`) to a WAV, faster than real time. Used in dev
 * to measure the generator with scripts/analyze_reference.py, the same way the recordings were.
 */
import * as Tone from "tone";
import { arrangeBar } from "./arranger";
import { compose, type ComposeOptions, type ImportedTracks, type Song } from "./composer";
import { bassTone, genreAt, GENRES, isStyleWeights } from "./genres";
import { scheduleBar } from "./schedule";
import { Instruments, type Track } from "./instruments";

/** Mixer levels (dB) to render with, and a progress callback (0–1). */
export interface RenderOptions {
  volumes?: Partial<Record<Track, number>>;
  master?: number;
  onProgress?: (fraction: number) => void;
}

/** Bars scheduled per step of the offline render. */
const WINDOW_BARS = 2;

/**
 * Not Tone.Offline, for two reasons. It schedules the whole song before rendering, and Chrome's
 * offline render slows down with every automation event still pending: 4 bars took 1.5 s, 16 bars
 * 16 s, and a whole song never finished. It also yields a setTimeout per second of audio, which
 * background tabs throttle to about one a minute.
 *
 * Instead, the native render suspends before each window of bars, so only a few bars are ever
 * pending. Tone's own clock (which PolySynth uses for just-in-time scheduling) is ticked ahead to
 * the end of each window, the way OfflineContext.render() would have ticked it.
 *
 * `solo` renders only those tracks (stems), with their effect sends.
 */
export async function renderSong(
  song: Song,
  bars = song.totalBars,
  solo: readonly Track[] = [],
  mute: readonly Track[] = [],
  options: RenderOptions = {},
): Promise<AudioBuffer> {
  const barSeconds = (60 / song.bpm) * 4;
  const barTime = (bar: number) => 0.05 + bar * barSeconds;
  const original = Tone.getContext();
  // A native context: the standardized-audio-context wrapper Tone creates has no suspend().
  const raw = new OfflineAudioContext(2, Math.ceil((barTime(bars) + 3) * 44100), 44100);
  const context = new Tone.OfflineContext(raw);
  const clock = context as unknown as { _currentTime: number };
  const tickTo = (time: number) => {
    while (clock._currentTime < time) {
      context.emit("tick");
      clock._currentTime += 128 / context.sampleRate;
    }
  };
  // The offline context is Tone's global only while the instruments are built, synchronously:
  // the page's live engine keeps using the global context during the render (its drum hits,
  // Tone.now(), a first Play building its own instruments).
  Tone.setContext(context);
  let inst: Instruments;
  try {
    inst = Instruments.create();
  } finally {
    Tone.setContext(original);
  }
  await inst.ready;
  await inst.drums.loadAll();
  inst.drums.use(song.kit);
  const genre = GENRES[song.genre];
  inst.setBassTone(bassTone(genre, song.weights));
  const profile = genreAt(genre, song.weights);
  inst.setSnareGate(profile.drums.gatedSnare);
  inst.setVoices(profile.voices);
  inst.setTempo(song.bpm);
  for (const track of solo) inst.channels[track].solo = true;
  for (const track of mute) inst.channels[track].mute = true;
  for (const [track, db] of Object.entries(options.volumes ?? {}) as [Track, number][]) {
    inst.channels[track].volume.value = db;
  }
  if (options.master !== undefined) inst.master.volume.value = options.master;
  const scheduleWindow = (from: number) => {
    options.onProgress?.(from / bars);
    const to = Math.min(bars, from + WINDOW_BARS);
    for (let bar = from; bar < to; bar++) {
      scheduleBar(inst, arrangeBar(song, bar), barTime(bar), song.bpm);
    }
    tickTo(barTime(to));
  };
  scheduleWindow(0);
  for (let from = WINDOW_BARS; from < bars; from += WINDOW_BARS) {
    void raw.suspend(barTime(from) - 0.25).then(() => {
      scheduleWindow(from);
      void raw.resume();
    });
  }
  const audio = await raw.startRendering();
  return audio;
}

/** 16-bit PCM WAV. */
export function encodeWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) data.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  data.setUint32(4, 36 + frames * channels * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, channels, true);
  data.setUint32(24, audio.sampleRate, true);
  data.setUint32(28, audio.sampleRate * channels * 2, true);
  data.setUint16(32, channels * 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, frames * channels * 2, true);
  const chans = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of chans) {
      const v = Math.max(-1, Math.min(1, ch[i] ?? 0));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

/** Extra render options: tracks to mute, and parts from a MIDI file (by song bar). */
export interface RenderExtras {
  mute?: readonly Track[];
  imported?: ImportedTracks;
  /** File name suffix. */
  tag?: string;
}

/** Dev only: renders a song and saves it to renders/ through the Vite dev server. */
export async function renderToDisk(
  opts: ComposeOptions,
  bars?: number,
  solo: readonly Track[] = [],
  extras: RenderExtras = {},
): Promise<string> {
  const song = compose(opts);
  if (extras.imported) song.imported = extras.imported;
  const started = performance.now();
  const audio = await renderSong(song, bars, solo, extras.mute);
  const stem = solo.length ? `-solo-${solo.join("+")}` : "";
  // A song a legacy style describes keeps its old name; others name their weights (TF-DS-YC %).
  const blend = isStyleWeights(GENRES[song.genre], song.weights, song.style)
    ? `style-${Math.round(song.style * 100)}`
    : `w-${song.weights.map((w) => Math.round(w * 100)).join("-")}`;
  const base = song.reference ?? `seed-${song.seed}-${blend}`;
  const name = `${base}${stem}${extras.tag ? `-${extras.tag}` : ""}.wav`;
  const res = await fetch(`/__renders/${name}`, { method: "POST", body: encodeWav(audio) });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return `${await res.text()} · "${song.title}" · ${audio.duration.toFixed(0)} s audio in ${seconds} s`;
}
