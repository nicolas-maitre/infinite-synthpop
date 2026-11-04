/**
 * A minimal Standard MIDI File reader, so a MIDI file the user supplies can drive a track at
 * runtime (e.g. an original's lead line). Nothing from the file is stored in the app.
 */
import type { DrumHit, DrumVoice } from "./arranger";
import type { Note } from "./composer";
import type { Track } from "./instruments";

export interface MidiNote {
  tick: number;
  /** In ticks. */
  duration: number;
  midi: number;
  velocity: number;
}

export interface MidiTrack {
  name: string;
  /** The channel most of its notes are on (9 = General MIDI drums). */
  channel: number;
  notes: MidiNote[];
}

export interface MidiFile {
  ticksPerBeat: number;
  tracks: MidiTrack[];
}

export function parseMidi(buffer: ArrayBuffer): MidiFile {
  const data = new DataView(buffer);
  let pos = 0;
  const u8 = () => data.getUint8(pos++);
  const u16 = () => ((pos += 2), data.getUint16(pos - 2));
  const u32 = () => ((pos += 4), data.getUint32(pos - 4));
  const text = (n: number) => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8());
    return s;
  };
  const varLen = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return value;
  };

  if (text(4) !== "MThd") throw new Error("Not a MIDI file");
  const headerEnd = u32() + pos;
  u16(); // format
  const trackCount = u16();
  const division = u16();
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files are not supported");
  pos = headerEnd;

  const tracks: MidiTrack[] = [];
  for (let t = 0; t < trackCount && pos < data.byteLength; t++) {
    if (text(4) !== "MTrk") throw new Error("Malformed MIDI track");
    const end = u32() + pos;
    const open = new Map<number, { tick: number; velocity: number }>();
    const track: MidiTrack = { name: "", channel: 0, notes: [] };
    const channels = new Map<number, number>();
    let tick = 0;
    let status = 0;
    const close = (key: number) => {
      const on = open.get(key);
      if (!on) return;
      open.delete(key);
      track.notes.push({
        tick: on.tick,
        duration: tick - on.tick,
        midi: key & 0x7f,
        velocity: on.velocity,
      });
    };
    while (pos < end) {
      tick += varLen();
      let byte = u8();
      if (byte === 0xff) {
        const type = u8();
        const len = varLen();
        if (type === 0x03) track.name = text(len);
        else pos += len;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        pos += varLen();
        continue;
      }
      if (byte & 0x80) status = byte;
      else pos--; // running status: this byte is the first data byte
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const a = u8();
      byte = kind === 0xc0 || kind === 0xd0 ? 0 : u8();
      // Key notes by channel too, so the same pitch on two channels doesn't collide.
      const key = (channel << 7) | a;
      if (kind === 0x90 && byte > 0) {
        close(key);
        open.set(key, { tick, velocity: byte });
        channels.set(channel, (channels.get(channel) ?? 0) + 1);
      } else if (kind === 0x80 || kind === 0x90) {
        close(key);
      }
    }
    pos = end;
    track.channel = [...channels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    if (track.notes.length) tracks.push(track);
  }
  return { ticksPerBeat: division, tracks };
}

/**
 * How loud each instrument's generated part typically plays (its usual note velocity). A MIDI
 * track replacing it is scaled so its median note lands here, keeping the mix balanced:
 * transcriptions often have flat, arbitrary velocities.
 */
export const TYPICAL_VELOCITY: Partial<Record<Track, number>> = {
  pad: 0.55,
  seq: 0.65,
  arp: 0.5,
};
const DEFAULT_VELOCITY = 0.8;

/**
 * A track's notes as bars of 16th steps (4/4), for arrangeBar. The file's own tempo is ignored:
 * notes land by bar and step, so the engine's tempo applies. Velocities are scaled so the median
 * note plays at `level` (see TYPICAL_VELOCITY).
 */
export function toBars(track: MidiTrack, ticksPerBeat: number, level = DEFAULT_VELOCITY): Note[][] {
  const sixteenth = ticksPerBeat / 4;
  const scale = velocityScale([track], level);
  const bars: Note[][] = [];
  for (const n of track.notes) {
    const at = n.tick / sixteenth;
    const bar = Math.floor(at / 16);
    (bars[bar] ??= []).push({
      step: at - bar * 16,
      dur: Math.max(0.25, n.duration / sixteenth),
      midi: n.midi,
      vel: Math.min(1, Math.max(0.1, n.velocity * scale)),
    });
  }
  return bars;
}

/** The factor that brings the tracks' median velocity to `level`. */
function velocityScale(tracks: readonly MidiTrack[], level: number): number {
  const v = tracks.flatMap((t) => t.notes.map((n) => n.velocity)).sort((a, b) => a - b);
  return level / Math.max(1, v[Math.floor(v.length / 2)] ?? 100);
}

/** General MIDI percussion keys → the drum machine's voices. Unlisted keys are dropped. */
const GM_DRUMS: Record<number, DrumVoice> = {
  35: "kick",
  36: "kick",
  37: "rim",
  38: "snare",
  39: "clap",
  40: "snare",
  41: "toml",
  42: "hat",
  43: "toml",
  44: "hat",
  45: "tomm",
  46: "openhat",
  47: "tomm",
  48: "tomh",
  49: "crash",
  50: "tomh",
  52: "crash",
  54: "tamb",
  55: "crash",
  57: "crash",
  69: "cabasa",
  70: "cabasa",
  82: "cabasa",
};

/** Drum tracks (General MIDI keys) as bars of hits on 16th steps, merged; velocities scaled as
 * in toBars. */
export function toDrumBars(
  tracks: readonly MidiTrack[],
  ticksPerBeat: number,
  level = DEFAULT_VELOCITY,
): DrumHit[][] {
  const sixteenth = ticksPerBeat / 4;
  const scale = velocityScale(tracks, level);
  const bars: DrumHit[][] = [];
  for (const track of tracks) {
    for (const n of track.notes) {
      const voice = GM_DRUMS[n.midi];
      if (!voice) continue;
      const at = n.tick / sixteenth;
      const bar = Math.floor(at / 16);
      (bars[bar] ??= []).push({
        voice,
        step: at - bar * 16,
        vel: Math.min(1, Math.max(0.1, n.velocity * scale)),
      });
    }
  }
  return bars;
}

/** A MIDI track choice per instrument: track indices into the file ([] = none, i.e. silent). */
export type MidiAssignment = Partial<Record<Track, number[]>>;

/**
 * Guesses which of the file's tracks plays each instrument, by track name (then channel and
 * register). Instruments with no match are left out, so they stay generated.
 */
export function matchTracks(file: MidiFile): MidiAssignment {
  const used = new Set<number>();
  const melodic = file.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.channel !== 9);
  const pick = (test: (name: string) => boolean, byLowest = false) => {
    const found = melodic
      .filter(({ t, i }) => !used.has(i) && test(t.name.toLowerCase()))
      .sort((a, b) => (byLowest ? meanPitch(a.t) - meanPitch(b.t) : 0));
    const hit = found[0];
    if (!hit) return undefined;
    used.add(hit.i);
    return [hit.i];
  };
  const out: MidiAssignment = {};
  const drums = file.tracks.flatMap((t, i) => (t.channel === 9 ? [i] : []));
  if (drums.length) out.drums = drums;
  // Most specific first, so "Sequence Bass" is the bass before "Sequence" can claim it.
  const bass =
    pick((n) => /(seq|sequence|synth)[^a-z]*bass|bass[^a-z]*(seq|synth)/.test(n)) ??
    pick((n) => n.includes("bass"), true);
  if (bass) out.bass = bass;
  const hook = pick((n) => n.includes("bass"));
  if (hook) out.hook = hook;
  const lead = pick((n) => /lead|melody|vocal|voice/.test(n));
  if (lead) out.lead = lead;
  const guitar = pick((n) => /guitar|gtr/.test(n));
  if (guitar) out.guitar = guitar;
  const seq = pick((n) => /sequence|sequencer|arp/.test(n));
  if (seq) out.seq = seq;
  const pad = pick((n) => n.includes("strings")) ?? pick((n) => n.includes("pad"));
  if (pad) out.pad = pad;
  return out;
}

function meanPitch(track: MidiTrack): number {
  return track.notes.reduce((sum, n) => sum + n.midi, 0) / Math.max(1, track.notes.length);
}

/** Several tracks as one instrument's part: bars of notes from all of them, at its level. */
export function mergeBars(
  tracks: readonly MidiTrack[],
  ticksPerBeat: number,
  instrument: Track,
): Note[][] {
  const level = TYPICAL_VELOCITY[instrument] ?? DEFAULT_VELOCITY;
  const bars: Note[][] = [];
  for (const track of tracks) {
    toBars(track, ticksPerBeat, level).forEach((notes, bar) => (bars[bar] ??= []).push(...notes));
  }
  return bars;
}
