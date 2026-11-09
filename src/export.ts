/**
 * Exports of the playing song: a Standard MIDI File of its arrangement (every instrument on its
 * own track, drums on channel 10 with General MIDI keys, section names as markers), and its audio
 * rendered offline with the current mixer, as WAV or MP3 (encoded in the page with LAME).
 */
import { arrangeBar, type DrumVoice, type MelodicTrack } from "./arranger";
import type { Song } from "./composer";
import type { Track } from "./instruments";

const TICKS_PER_BEAT = 480;
const TICKS_PER_16TH = TICKS_PER_BEAT / 4;

/** Each instrument's MIDI track: name, channel and General MIDI program. */
const MIDI_PARTS: {
  name: string;
  tracks: readonly MelodicTrack[];
  channel: number;
  program: number;
}[] = [
  { name: "Seq bass", tracks: ["bass"], channel: 0, program: 38 },
  { name: "Sequence", tracks: ["seq"], channel: 1, program: 80 },
  { name: "Guitar", tracks: ["guitar"], channel: 2, program: 29 },
  { name: "Melodic bass", tracks: ["hook"], channel: 3, program: 33 },
  { name: "Pad", tracks: ["pad"], channel: 4, program: 89 },
  { name: "Riff", tracks: ["riff"], channel: 5, program: 62 },
  { name: "Lead", tracks: ["lead", "leadOct"], channel: 6, program: 81 },
  { name: "Arp", tracks: ["arp"], channel: 7, program: 98 },
  { name: "Stabs", tracks: ["stab"], channel: 8, program: 61 },
  // Channel index 9 is the drums' (GM channel 10). Program 75 is GM 76, Pan Flute, the nearest
  // breathy wind.
  { name: "Counter line", tracks: ["counter"], channel: 10, program: 75 },
];

/** The drum machine's voices as General MIDI percussion keys. */
const GM_KEYS: Record<DrumVoice, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  openhat: 46,
  clap: 39,
  crash: 49,
  tomh: 50,
  tomm: 47,
  toml: 45,
  rim: 37,
  tamb: 54,
  cabasa: 69,
};

interface MidiEvent {
  tick: number;
  /** Sorts note-offs before note-ons at the same tick, metas first. */
  order: number;
  bytes: number[];
}

/** The song's whole arrangement as a type-1 Standard MIDI File. */
export function songToMidi(song: Song): Uint8Array<ArrayBuffer> {
  const parts = MIDI_PARTS.map((p) => ({ ...p, events: [] as MidiEvent[] }));
  const drums: MidiEvent[] = [];
  const note = (
    events: MidiEvent[],
    channel: number,
    tick: number,
    len: number,
    midi: number,
    vel: number,
  ) => {
    const key = Math.min(127, Math.max(0, Math.round(midi)));
    const velocity = Math.min(127, Math.max(1, Math.round(vel * 127)));
    events.push({ tick, order: 2, bytes: [0x90 | channel, key, velocity] });
    events.push({ tick: tick + Math.max(1, len), order: 1, bytes: [0x80 | channel, key, 0] });
  };

  for (let bar = 0; bar < song.totalBars; bar++) {
    const ev = arrangeBar(song, bar);
    const barTick = bar * 16 * TICKS_PER_16TH;
    for (const part of parts) {
      for (const t of part.tracks) {
        for (const n of ev.notes[t]) {
          const tick = barTick + Math.round(n.step * TICKS_PER_16TH);
          note(part.events, part.channel, tick, Math.round(n.dur * TICKS_PER_16TH), n.midi, n.vel);
        }
      }
    }
    for (const hit of ev.drums) {
      const tick = barTick + Math.round(hit.step * TICKS_PER_16TH);
      note(drums, 9, tick, TICKS_PER_16TH / 2, GM_KEYS[hit.voice], hit.vel);
    }
  }

  // Conductor track: title, tempo, 4/4, and a marker per section.
  const conductor: MidiEvent[] = [
    meta(0, 0x03, text(song.title)),
    meta(0, 0x51, tempoBytes(song.bpm)),
    meta(0, 0x58, [4, 2, 24, 8]),
    ...song.sections.map((s) => meta(s.startBar * 16 * TICKS_PER_16TH, 0x06, text(s.label))),
  ];
  const tracks = [conductor];
  for (const part of parts) {
    if (!part.events.length) continue;
    tracks.push([
      meta(0, 0x03, text(part.name)),
      { tick: 0, order: 0, bytes: [0xc0 | part.channel, part.program] },
      ...part.events,
    ]);
  }
  if (drums.length) tracks.push([meta(0, 0x03, text("Drums")), ...drums]);

  const chunks = [
    chunk("MThd", [...u16(1), ...u16(tracks.length), ...u16(TICKS_PER_BEAT)]),
    ...tracks.map((events) => chunk("MTrk", trackBytes(events))),
  ];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function trackBytes(events: MidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes: number[] = [];
  let last = 0;
  for (const e of sorted) {
    bytes.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  bytes.push(0, 0xff, 0x2f, 0); // end of track
  return bytes;
}

function meta(tick: number, type: number, data: number[]): MidiEvent {
  return { tick, order: 0, bytes: [0xff, type, ...varLen(data.length), ...data] };
}

function tempoBytes(bpm: number): number[] {
  const us = Math.round(60_000_000 / bpm);
  return [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
}

function text(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

function varLen(n: number): number[] {
  const bytes = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function chunk(id: string, data: number[]): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  out.set(text(id), 0);
  new DataView(out.buffer).setUint32(4, data.length);
  out.set(data, 8);
  return out;
}

// ── Audio ─────────────────────────────────────────────────────────────────────────────────────

export interface AudioExportOptions {
  volumes: Partial<Record<Track, number>>;
  master: number;
  muted: readonly Track[];
  soloed: readonly Track[];
  /** 0–1 across rendering, then encoding. */
  onProgress?: (fraction: number, stage: "rendering" | "encoding") => void;
}

/** Renders the whole song offline with the given mixer, then encodes it. */
export async function exportAudio(
  song: Song,
  format: "wav" | "mp3",
  options: AudioExportOptions,
): Promise<Blob> {
  const { renderSong, encodeWav } = await import("./render");
  const audio = await renderSong(song, song.totalBars, options.soloed, options.muted, {
    volumes: options.volumes,
    master: options.master,
    onProgress: (f) => options.onProgress?.(f, "rendering"),
  });
  if (format === "wav") return encodeWav(audio);
  return encodeMp3(audio, (f) => options.onProgress?.(f, "encoding"));
}

/** 256 kbps stereo MP3, encoded in slices so the page stays responsive. */
async function encodeMp3(audio: AudioBuffer, onProgress: (f: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(2, audio.sampleRate, 256);
  const left = audio.getChannelData(0);
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
  const parts: BlobPart[] = [];
  const block = 1152 * 64;
  for (let i = 0; i < left.length; i += block) {
    const l = toInt16(left.subarray(i, i + block));
    const r = toInt16(right.subarray(i, i + block));
    const out = encoder.encodeBuffer(l, r);
    if (out.length) parts.push(new Uint8Array(out));
    onProgress(i / left.length);
    await new Promise((done) => setTimeout(done, 0));
  }
  const end = encoder.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: "audio/mpeg" });
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Offers a file to the user. */
export function download(
  data: Blob | Uint8Array<ArrayBuffer>,
  filename: string,
  type: string,
): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A safe file name from a song title. */
export function fileName(title: string, ext: string): string {
  const base = title.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim() || "song";
  return `${base}.${ext}`;
}
