/**
 * Creator mode's melody tools, pure: turn a section's melody into an editable one, write a new one
 * with a chosen range and density, take one from MIDI bars, and give a melody to a section (and to
 * every section that shared its melody, so editing "the verse melody" edits all the verses).
 */
import {
  generateMelody,
  LEAD_RANGES,
  type CustomMelody,
  type MelodyKind,
  type Note,
  type Song,
} from "./composer";
import type { MidiTrack } from "./midi";
import { createRng } from "./rng";
import type { SongSpec } from "./spec";
import type { Key } from "./theory";

export type MelodyRange = "low" | "mid" | "high";
export type MelodyDensity = "sparse" | "normal" | "busy";

const RANGE_SHIFT: Record<MelodyRange, number> = { low: -5, mid: 0, high: 5 };
/** Target notes per bar. */
const DENSITY: Record<MelodyDensity, number> = { sparse: 2, normal: 3.2, busy: 5 };

/** Bars of absolute notes → a custom melody, pitches relative to `key`. */
export function fromBars(bars: readonly (readonly Note[])[], key: Key, name: string): CustomMelody {
  return {
    name,
    tonic: key.tonic,
    bars: Math.max(1, bars.length),
    notes: bars.flatMap((notes, bar) =>
      notes.map((n) => ({ bar, step: n.step, dur: n.dur, pitch: n.midi - key.tonic, vel: n.vel })),
    ),
  };
}

/** The melody section `index` plays now, as an editable custom melody. */
export function currentMelody(song: Song, index: number, name: string): CustomMelody | null {
  const melody = song.sectionMelodies[index];
  const section = song.sections[index];
  if (!melody || !section) return null;
  return fromBars(melody.bars, section.key, name);
}

/**
 * A new melody over section `index`'s chords. Several candidates are written and the one closest
 * to the density wanted is kept.
 */
export function writeMelody(
  song: Song,
  index: number,
  range: MelodyRange,
  density: MelodyDensity,
  seed: number,
  name: string,
): CustomMelody | null {
  const section = song.sections[index];
  if (!section) return null;
  const kind: MelodyKind = section.layers.lead ?? (section.kind === "chorus" ? "chorus" : "verse");
  const [lo, hi] = LEAD_RANGES[kind];
  const shift = RANGE_SHIFT[range];
  const target = DENSITY[density];
  let best: { melody: Note[][]; score: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const m = generateMelody(createRng(seed * 31 + i), section.key, section.progression, [
      lo + shift,
      hi + shift,
    ]);
    const perBar = m.bars.reduce((n, bar) => n + bar.length, 0) / m.bars.length;
    const score = Math.abs(perBar - target);
    if (!best || score < best.score) best = { melody: m.bars, score };
  }
  if (!best) return null;
  const bars = density === "sparse" ? thin(best.melody, target) : best.melody;
  return fromBars(bars, section.key, name);
}

/**
 * Drops off-beat notes (shortest first) until the melody is down to `perBar` notes a bar, letting
 * the note before each one ring on in its place.
 */
function thin(bars: readonly (readonly Note[])[], perBar: number): Note[][] {
  const out = bars.map((bar) => bar.map((n) => ({ ...n })).sort((a, b) => a.step - b.step));
  const total = () => out.reduce((n, bar) => n + bar.length, 0);
  while (total() > perBar * out.length) {
    let pick: { bar: number; i: number; weight: number } | null = null;
    out.forEach((bar, b) =>
      bar.forEach((n, i) => {
        if (i === 0) return; // keep each bar's first note
        const weight = (n.step % 4 === 0 ? 10 : n.step % 2 === 0 ? 4 : 0) + n.dur;
        if (!pick || weight < pick.weight) pick = { bar: b, i, weight };
      }),
    );
    if (!pick) break;
    const { bar, i } = pick as { bar: number; i: number };
    const notes = out[bar];
    const gone = notes?.[i];
    const before = notes?.[i - 1];
    if (!notes || !gone || !before) break;
    before.dur = gone.step + gone.dur - before.step;
    notes.splice(i, 1);
  }
  return out;
}

/**
 * Bars [startBar, startBar + bars) of a MIDI track as a melody, moved by octaves into the lead's
 * register and kept monophonic (the highest note wins where notes start together).
 */
export function importMelody(
  track: MidiTrack,
  ticksPerBeat: number,
  startBar: number,
  bars: number,
  key: Key,
  kind: MelodyKind,
  name: string,
): CustomMelody {
  const sixteenth = ticksPerBeat / 4;
  const from = startBar * 16;
  const to = (startBar + bars) * 16;
  const picked = new Map<number, { step: number; dur: number; midi: number; vel: number }>();
  for (const n of track.notes) {
    const at = n.tick / sixteenth;
    if (at < from || at >= to) continue;
    const slot = Math.round(at * 4);
    const prev = picked.get(slot);
    if (prev && prev.midi >= n.midi) continue;
    picked.set(slot, {
      step: at - from,
      dur: Math.max(0.25, n.duration / sixteenth),
      midi: n.midi,
      vel: n.velocity / 127,
    });
  }
  const notes = [...picked.values()];
  // Octave-shift so the notes' middle lands in the lead's range.
  const [lo, hi] = LEAD_RANGES[kind];
  const mid = notes.length
    ? (Math.min(...notes.map((n) => n.midi)) + Math.max(...notes.map((n) => n.midi))) / 2
    : (lo + hi) / 2;
  const octaves = Math.round(((lo + hi) / 2 - mid) / 12) * 12;
  const velocities = notes.map((n) => n.vel).sort((a, b) => a - b);
  const median = velocities[Math.floor(velocities.length / 2)] || 0.8;
  return {
    name,
    tonic: key.tonic,
    bars: Math.max(1, bars),
    notes: notes.map((n) => ({
      bar: Math.floor(n.step / 16),
      step: n.step % 16,
      dur: n.dur,
      pitch: n.midi + octaves - key.tonic,
      vel: Math.min(1, Math.max(0.1, (n.vel / median) * 0.8)),
    })),
  };
}

/**
 * Gives `melody` to section `index`: it replaces the custom melody the section already plays, or
 * becomes a new one shared by every section that played the same generated melody. Returns its id.
 */
export function assignMelody(
  spec: SongSpec,
  song: Song,
  index: number,
  melody: CustomMelody,
): string {
  const melodies = (spec.melodies ??= {});
  const section = spec.sections[index];
  if (!section) return "";
  const existing = section.melody && melodies[section.melody] ? section.melody : null;
  if (existing) {
    melodies[existing] = { ...melody, name: melodies[existing]?.name ?? melody.name };
    return existing;
  }
  const id = nextId(spec);
  melodies[id] = melody;
  const shared = song.sectionMelodies[index];
  spec.sections.forEach((s, j) => {
    if (j === index || (shared && song.sectionMelodies[j] === shared && !s.melody)) {
      s.melody = id;
      s.layers.lead ??= section.layers.lead ?? "verse";
    }
  });
  return id;
}

/** "Melody A", "Melody B", … */
export function nextMelodyName(spec: SongSpec): string {
  return `Melody ${nextId(spec)}`;
}

function nextId(spec: SongSpec): string {
  const used = new Set(Object.keys(spec.melodies ?? {}));
  for (let i = 0; i < 26 * 26; i++) {
    const id =
      i < 26
        ? String.fromCharCode(65 + i)
        : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
    if (!used.has(id)) return id;
  }
  return `M${used.size}`;
}
