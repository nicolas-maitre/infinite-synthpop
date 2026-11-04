/**
 * (song, bar index) → every event in that bar, for every track. Pure, so the engine stays a thin
 * scheduler and the whole arrangement is testable without audio.
 */
import { chordAt, type DrumMode, type Motif, type Note, type Section, type Song } from "./composer";
import { createRng, type Rng } from "./rng";
import {
  chordName,
  chordPitchClasses,
  mod12,
  nearestWithPc,
  notesInRange,
  scaleForChord,
  voiceChord,
  type Chord,
  type Key,
} from "./theory";

export const DRUM_VOICES = [
  "kick",
  "snare",
  "hat",
  "openhat",
  "clap",
  "crash",
  "tomh",
  "tomm",
  "toml",
  "rim",
  "tamb",
  "cabasa",
] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];

export interface DrumHit {
  voice: DrumVoice;
  /** 16ths from bar start; may carry a little humanising offset. */
  step: number;
  vel: number;
}

export interface ChordSlot {
  step: number;
  length: number;
  chord: Chord;
  name: string;
}

export const MELODIC_TRACKS = [
  "bass",
  "hook",
  "pad",
  "riff",
  "lead",
  "leadOct",
  "arp",
  "stab",
] as const;
export type MelodicTrack = (typeof MELODIC_TRACKS)[number];

export interface BarEvents {
  bar: number;
  sectionIndex: number;
  section: Section;
  barInSection: number;
  key: Key;
  chords: ChordSlot[];
  drums: DrumHit[];
  notes: Record<MelodicTrack, Note[]>;
}

export function sectionIndexAt(song: Song, bar: number): number {
  const i = song.sections.findIndex((s) => bar >= s.startBar && bar < s.startBar + s.bars);
  return i === -1 ? song.sections.length - 1 : i;
}

export function chordSlots(section: Section, barInSection: number): ChordSlot[] {
  const numerals = section.progression[barInSection % section.progression.length] ?? ["i"];
  const length = 16 / numerals.length;
  return numerals.map((_, i) => {
    const c = chordAt(section.progression, barInSection, i * length);
    return { step: i * length, length, chord: c, name: chordName(section.key, c) };
  });
}

export function arrangeBar(song: Song, bar: number): BarEvents {
  const sectionIndex = sectionIndexAt(song, bar);
  const section = song.sections[sectionIndex];
  if (!section) throw new Error(`No section for bar ${bar}`);
  const barInSection = bar - section.startBar;
  const key = section.key;
  const slots = chordSlots(section, barInSection);
  const L = section.layers;
  const rng = createRng((song.seed * 7919 + bar * 104729) >>> 0);

  const notes: Record<MelodicTrack, Note[]> = {
    bass: L.bass
      ? bassLine(song, key, slots, chordSlots(section, barInSection + 1), barInSection)
      : [],
    hook: L.hook
      ? motifNotes(
          song.hook,
          barInSection,
          key,
          slots,
          "scale",
          50,
          section.kind === "bridge" ? 1 : 0.8,
        )
      : [],
    pad: L.pad ? padChords(key, slots, section.kind === "break" ? 0.75 : 0.55) : [],
    riff: L.riff ? motifNotes(song.riff, barInSection, key, slots, "chord", 67, 0.85) : [],
    lead: [],
    leadOct: [],
    arp: L.arp ? motifNotes(song.arp, barInSection, key, slots, "chord", 72, 0.5) : [],
    stab: L.stabs && barInSection % 4 === 0 ? stabChord(key, slots) : [],
  };

  if (L.lead) {
    const melody = song.melodies[L.lead];
    const lead = melody.bars[barInSection % melody.bars.length] ?? [];
    notes.lead = lead.map((n) => ({ ...n }));
    if (L.leadDouble)
      notes.leadOct = lead.map((n) => ({ ...n, midi: n.midi + 12, vel: n.vel * 0.55 }));
  }

  const isLastBar = barInSection === section.bars - 1;
  const drums = drumBar(
    L.drums,
    rng.fork("drums"),
    song.style,
    barInSection === 0 && sectionIndex > 0,
    section.fill && isLastBar,
    song.sections[sectionIndex + 1]?.kind === "chorus",
  );

  // Both songs end on a fade: ramp everything down over the final section's last 8 bars.
  if (section.fade) {
    const fadeBars = Math.min(8, section.bars);
    const into = barInSection - (section.bars - fadeBars);
    if (into >= 0) {
      const gain = (s: number) => Math.max(0.04, 1 - (into + s / 16) / fadeBars);
      for (const track of MELODIC_TRACKS) for (const n of notes[track]) n.vel *= gain(n.step);
      for (const h of drums) h.vel *= gain(h.step);
    }
  }

  return { bar, sectionIndex, section, barInSection, key, chords: slots, drums, notes };
}

// ── Bass ──────────────────────────────────────────────────────────────────────────────────────

/** D2–C♯3, where the recordings' sequenced bass sits (e.g. DS's E2–A2). */
function bassRoot(key: Key, c: Chord): number {
  let root = nearestWithPc(mod12(key.tonic + c.root), 44);
  while (root > 49) root -= 12;
  while (root < 38) root += 12;
  return root;
}

/** The 16ths where True Faith's octave-up bass notes cluster (bass_octave_up_profile, 13–20%). */
const TF_OCTAVE_STEPS = new Set([2, 3, 6, 7, 13, 14]);

/**
 * The sequenced bass both songs run on: root 16ths on every step, all the way through. The
 * recordings differ only in articulation (docs/analysis.md §1, scripts/analyze_reference.py):
 * - "pulse" (DS): short, gated 16ths with a hard accent on every 8th (its bass band pulses
 *   strongest at the 8th rate), moving to the next chord one 16th early.
 * - "bounce" (TF): longer, smoother 16ths. About one bar in five breaks into octave pairs;
 *   here the last bar of each 4-bar phrase does.
 */
function bassLine(
  song: Song,
  key: Key,
  slots: readonly ChordSlot[],
  nextBar: readonly ChordSlot[],
  barInSection: number,
): Note[] {
  const out: Note[] = [];
  const octaveBar = barInSection % 4 === 3;
  slots.forEach((slot, i) => {
    const root = bassRoot(key, slot.chord);
    const next = slots[i + 1] ?? nextBar[0];
    const nextRoot = next ? bassRoot(key, next.chord) : root;
    const end = slot.step + slot.length;
    for (let s = slot.step; s < end; s++) {
      const pos = s % 4;
      if (song.bassStyle === "pulse") {
        out.push({
          step: s,
          dur: 0.7,
          midi: s === end - 1 ? nextRoot : root,
          vel: pos === 0 ? 1 : pos === 2 ? 0.9 : 0.42,
        });
      } else {
        out.push({
          step: s,
          dur: 0.9,
          midi: octaveBar && TF_OCTAVE_STEPS.has(s) ? root + 12 : root,
          vel: pos === 0 ? 1 : pos === 2 ? 0.85 : 0.72,
        });
      }
    }
  });
  return out;
}

// ── Motifs (riff, melodic bass, arp) ──────────────────────────────────────────────────────────

/**
 * Realises a contour motif over the current chords. "chord" ladders climb the chord tones (riff,
 * arp); "scale" ladders climb the scale from the chord root (melodic bass), so the same motif keeps
 * its shape on every chord.
 */
function motifNotes(
  motif: Motif,
  barInSection: number,
  key: Key,
  slots: readonly ChordSlot[],
  ladderKind: "chord" | "scale",
  base: number,
  level: number,
): Note[] {
  const offset = (barInSection % motif.bars) * 16;
  const out: Note[] = [];
  for (const n of motif.notes) {
    if (n.step < offset || n.step >= offset + 16) continue;
    const step = n.step - offset;
    const slot = slots.find((s) => step >= s.step && step < s.step + s.length) ?? slots[0];
    if (!slot) continue;
    const ladder = buildLadder(key, slot.chord, ladderKind, base);
    const midi = ladder[Math.min(ladder.length - 1, Math.max(0, n.idx))];
    if (midi === undefined) continue;
    out.push({ step, dur: n.dur, midi, vel: n.vel * level });
  }
  return out;
}

function buildLadder(key: Key, c: Chord, kind: "chord" | "scale", base: number): number[] {
  const rootPc = mod12(key.tonic + c.root);
  let root = nearestWithPc(rootPc, base);
  if (root > base) root -= 12;
  const pcs = kind === "chord" ? chordPitchClasses(key, c) : scaleForChord(key, c);
  return notesInRange(pcs, root, root + 30);
}

// ── Pad and stabs ─────────────────────────────────────────────────────────────────────────────

function padChords(key: Key, slots: readonly ChordSlot[], vel: number): Note[] {
  const out: Note[] = [];
  for (const slot of slots) {
    const pcs = chordPitchClasses(key, slot.chord);
    const voicing = voiceChord(pcs, 62);
    const low = nearestWithPc(pcs[0] ?? key.tonic, 48);
    for (const midi of [low, ...voicing]) {
      out.push({ step: slot.step, dur: slot.length - 0.1, midi, vel });
    }
  }
  return out;
}

function stabChord(key: Key, slots: readonly ChordSlot[]): Note[] {
  const slot = slots[0];
  if (!slot) return [];
  const voicing = voiceChord(chordPitchClasses(key, slot.chord), 67);
  return [...voicing, (voicing[0] ?? 60) - 12].map((midi) => ({ step: 0, dur: 2, midi, vel: 0.8 }));
}

// ── Drums ─────────────────────────────────────────────────────────────────────────────────────

function drumBar(
  mode: DrumMode,
  rng: Rng,
  style: number,
  sectionStart: boolean,
  fill: boolean,
  intoChorus: boolean,
): DrumHit[] {
  if (mode === "off") return [];
  const hits: DrumHit[] = [];
  const hit = (voice: DrumVoice, step: number, vel: number) => hits.push({ voice, step, vel });
  const fillFrom = fill ? (intoChorus ? 8 : 12) : 16;

  // Kick: four on the floor — "the drums do one thing: stomp".
  if (mode === "half") hit("kick", 0, 1);
  else for (const s of [0, 4, 8, 12]) if (s < fillFrom || s === 12) hit("kick", s, 1);
  if (mode === "big" && style > 0.5 && rng.chance(0.4)) hit("kick", 14, 0.7);

  // Snare on 2 and 4 (beat 3 in half time), doubled by a clap in big sections.
  if (mode === "full" || mode === "big") {
    for (const s of [4, 12]) {
      if (s >= fillFrom) continue;
      hit("snare", s, 1);
      if (mode === "big") hit("clap", s, 0.75);
    }
  } else if (mode === "half") hit("snare", 8, 0.95);

  // Hats were played live on the record, so humanise velocity and timing.
  const humanise = (s: number) => (s === 0 ? 0 : (rng.next() - 0.5) * 0.12);
  for (let s = 0; s < 16; s++) {
    if (s >= fillFrom) break;
    const offbeat8 = s % 4 === 2;
    if (mode === "big" && offbeat8) {
      hit("openhat", s + humanise(s), 0.55 + rng.next() * 0.15);
    } else if (mode === "kick" || mode === "half") {
      if (s % 2 === 0) hit("hat", s + humanise(s), (offbeat8 ? 0.6 : 0.35) + rng.next() * 0.1);
    } else {
      const v = s % 4 === 0 ? 0.45 : offbeat8 ? 0.7 : 0.3;
      hit("hat", s + humanise(s), v + rng.next() * 0.12);
    }
  }

  if (mode === "big") {
    if (style > 0.5) {
      for (const s of [2, 6, 10, 14]) if (s < fillFrom) hit("tamb", s, 0.45);
    } else {
      for (let s = 1; s < fillFrom; s += 2) hit("cabasa", s, 0.3 + rng.next() * 0.1);
    }
  }

  if (sectionStart && mode !== "half") hit("crash", 0, 0.8);

  if (fill) {
    const kind = rng.weighted([
      ["snare16", 3],
      ["toms", 2],
      ["flam", 1],
    ] as const);
    for (let s = fillFrom; s < 16; s++) {
      const ramp = 0.5 + (0.5 * (s - fillFrom + 1)) / (16 - fillFrom);
      if (kind === "snare16") hit("snare", s, ramp);
      else if (kind === "toms") hit(s < 13 ? "tomh" : s < 15 ? "tomm" : "toml", s, ramp);
      else if (s % 2 === 0 || s === 15) hit("snare", s, ramp);
    }
    if (kind === "flam") hit("clap", 15, 0.8);
  }

  // One hit per voice per step, otherwise sample players are asked to start twice at one time.
  const seen = new Set<string>();
  return hits
    .filter((h) => {
      const k = `${h.voice}@${Math.round(h.step * 100)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.step - b.step);
}
