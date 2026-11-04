/**
 * (song, bar index) → every event in that bar, for every track. Pure, so the engine stays a thin
 * scheduler and the whole arrangement is testable without audio.
 */
import {
  chordAt,
  type BassStyle,
  type DrumMode,
  type Motif,
  type Note,
  type Section,
  type Song,
} from "./composer";
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
  "seq",
  "guitar",
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

function arrangeTarget(song: Song, bar: number): { section: Section; slots: ChordSlot[] } {
  const section = song.sections[sectionIndexAt(song, bar)];
  if (!section) throw new Error(`No section for bar ${bar}`);
  return { section, slots: chordSlots(section, bar - section.startBar) };
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

  // The figure ties the next chord's root over the bar line, so each bar needs to know whether
  // its neighbours carry the same layer.
  const figureContext = (layer: "bass"): FigureContext => {
    const prev = bar > 0 ? song.sections[sectionIndexAt(song, bar - 1)] : undefined;
    const nextBar = bar + 1 < song.totalBars ? arrangeTarget(song, bar + 1) : undefined;
    return {
      key,
      slots,
      next:
        nextBar?.section.layers[layer] && nextBar.section.key === key
          ? nextBar.slots[0]
          : undefined,
      heldIn: !!prev?.layers[layer] && prev.key === key,
      short: L.bassShort,
      pickup:
        L.bassShort &&
        barInSection === section.bars - 1 &&
        nextBar?.section.kind === "verse" &&
        nextBar.section.startBar === bar + 1,
    };
  };
  const notes: Record<MelodicTrack, Note[]> = {
    bass: L.bass ? bassLine(song.bassStyle, figureContext("bass")) : [],
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
    seq: L.seq ? sequenceLine(song, key) : [],
    guitar: L.guitar ? guitarStrums(key, slots) : [],
  };

  if (L.lead) {
    const melody = song.sectionMelodies[sectionIndex] ?? song.melodies[L.lead];
    const lead = melody.bars[barInSection % melody.bars.length] ?? [];
    notes.lead = lead.map((n) => ({ ...n }));
    if (L.leadDouble)
      notes.leadOct = lead.map((n) => ({ ...n, midi: n.midi + 12, vel: n.vel * 0.55 }));
  }
  // Parts from a MIDI file replace the generated ones (midi.ts).
  for (const [track, bars] of Object.entries(song.imported?.notes ?? {})) {
    notes[track as MelodicTrack] = (bars[bar] ?? []).map((n) => ({ ...n }));
    if (track === "lead") notes.leadOct = [];
  }

  const isLastBar = barInSection === section.bars - 1;
  const importedDrums = song.imported?.drums;
  const drums = importedDrums
    ? (importedDrums[bar] ?? []).map((h) => ({ ...h }))
    : drumBar(L.drums, rng.fork("drums"), song.style, {
        barInSection,
        sectionStart: barInSection === 0 && sectionIndex > 0,
        lastBar: isLastBar,
        intro: section.kind === "intro",
        fill: section.fill && isLastBar,
        intoChorus: song.sections[sectionIndex + 1]?.kind === "chorus",
      });

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

// ── Bass and the sequenced figure ─────────────────────────────────────────────────────────────

/** Where each song's bass sits: TF G1–F♯2 (the MIDI transcription's G1 under the chorus IV),
 * DS A1–G♯2 (Demucs stems: B1, E2, A2). */
function bassRoot(style: BassStyle, key: Key, c: Chord): number {
  const [lo, hi] = style === "tf" ? [31, 42] : [33, 44];
  let root = nearestWithPc(mod12(key.tonic + c.root), (lo + hi) / 2);
  while (root > hi) root -= 12;
  while (root < lo) root += 12;
  return root;
}

/** Which pitch an onset of the figure takes: the current chord's, the approach note, or the next
 * chord's (anticipated). */
type FigureRole = "root" | "approach" | "next";
interface FigureHit {
  step: number;
  dur: number;
  role: FigureRole;
}

/**
 * The signature figure both songs run on: transcribed from Demucs stems (DS long version
 * 4:10–4:46) and confirmed note for note by a True Faith MIDI transcription ("Sequence Bass").
 * Legato 8ths on the root, a 16th hiccup on beat 4 with an approach note on 4e, and the next
 * chord's root a 16th early on 4a, tied over the bar line and struck again on 1e:
 *
 *    1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *   (N) R  R  -  R  -  R  -  R  -  R  -  R  A  -  N
 *
 * `heldIn` is false when the previous bar didn't anticipate this one (it then starts on the
 * downbeat, as TF's does where the bass enters); `tieOut` is false when the next bar has no bass.
 */
function figure(heldIn: boolean, tieOut: boolean): FigureHit[] {
  const hits: FigureHit[] = [];
  if (!heldIn) hits.push({ step: 0, dur: 1, role: "root" });
  hits.push({ step: 1, dur: 1, role: "root" }, { step: 2, dur: 2, role: "root" });
  for (const step of [4, 6, 8, 10]) hits.push({ step, dur: 2, role: "root" });
  hits.push({ step: 12, dur: 1, role: "root" }, { step: 13, dur: 2, role: "approach" });
  hits.push(tieOut ? { step: 15, dur: 2, role: "next" } : { step: 15, dur: 1, role: "root" });
  return hits;
}

/**
 * The 4e note, by the move to the next root as the line actually travels (DS: Demucs stems; TF: the
 * MIDI transcription):
 * - a 4th up: the scale step below the target (A→C→D, and A→C♯→D over a major V);
 * - a 5th up or a 4th/5th down: the scale step above the root (G→A→D, F→G→C, A→B→E);
 * - a major 3rd up: the step in between (B♭→C→D); DS also fills a major 3rd down (E→D→C);
 * - anything else (a step, a minor 3rd: D→D→F, E→E→G, C→C→A): the root.
 */
function approachNote(
  style: BassStyle,
  key: Key,
  chord: Chord,
  root: number,
  next: number,
): number {
  const move = next - root;
  const scale = scaleForChord(key, chord);
  const stepFrom = (from: number, dir: 1 | -1) => {
    for (let d = 1; d <= 2; d++) if (scale.includes(mod12(from + dir * d))) return from + dir * d;
    return root;
  };
  if (move === 5) return stepFrom(next, -1);
  if (move === 7 || move === -5 || move === -7) return stepFrom(root, 1);
  if (move === 4) return stepFrom(root, 1);
  if (move === -4 && style === "ds") return stepFrom(root, -1);
  return root;
}

interface FigureContext {
  key: Key;
  slots: readonly ChordSlot[];
  next: ChordSlot | undefined;
  heldIn: boolean;
  /** Staccato 8ths (TF's turnarounds and outro). */
  short: boolean;
  /** The bar before a verse after a staccato turnaround: TF's pickup run (see bassLine). */
  pickup: boolean;
}

function slotAt(slots: readonly ChordSlot[], step: number): ChordSlot | undefined {
  return slots.find((s) => step >= s.step && step < s.step + s.length) ?? slots[0];
}

function bassLine(style: BassStyle, ctx: FigureContext): Note[] {
  const out: Note[] = [];
  const nextRoot = ctx.next ? bassRoot(style, ctx.key, ctx.next.chord) : undefined;
  // TF's pickup into a verse (MIDI bars 46 and 76): three beats' rest, then on beat 4 the root,
  // the next root's 4th and 5th, and the next root on 4a, tied over.
  const last = ctx.slots.at(-1);
  if (ctx.pickup && nextRoot !== undefined && last) {
    const root = bassRoot(style, ctx.key, last.chord);
    return [root, nextRoot + 5, nextRoot + 7, nextRoot].map((midi, i) => ({
      step: 12 + i,
      dur: i === 3 ? 1.95 : 0.9,
      midi,
      vel: i === 0 ? 1 : 0.85,
    }));
  }
  for (const hit of figure(ctx.heldIn, nextRoot !== undefined)) {
    const slot = slotAt(ctx.slots, hit.step);
    if (!slot) continue;
    const root = bassRoot(style, ctx.key, slot.chord);
    const midi =
      hit.role === "next"
        ? (nextRoot ?? root)
        : hit.role === "approach"
          ? approachNote(style, ctx.key, slot.chord, root, nextRoot ?? root)
          : root;
    const onBeat = hit.step % 4 === 0;
    out.push({
      step: hit.step,
      dur: ctx.short ? Math.min(1, hit.dur) - 0.05 : hit.dur - 0.05,
      midi,
      vel: onBeat ? 1 : hit.dur < 2 ? 0.8 : 0.88,
    });
  }
  return out;
}

/** TF's high sequencer: 16ths on the key's 5th (A4 in D minor), with the tonic a 4th above or the
 * 5th an octave above on the song's generated steps. It ignores the chords, as the recording does. */
function sequenceLine(song: Song, key: Key): Note[] {
  const pedal = nearestWithPc(mod12(key.tonic + 7), 69);
  const out: Note[] = [];
  song.sequence.tops.forEach((top, step) => {
    out.push({ step, dur: 0.6, midi: pedal, vel: step % 4 === 0 ? 0.75 : 0.6 });
    if (top) out.push({ step, dur: 0.6, midi: pedal + top, vel: 0.55 });
  });
  return out;
}

/**
 * TF's rhythm guitar (MIDI "Guitar", 6043 notes): a strum on every 16th, 3–4 strings in G3–G4,
 * changing on the bar line. The major III and IV are voiced as sus chords (F as G–C–F, G as
 * G–C–D). Down-strokes on the 8ths, up-strokes between.
 */
function guitarStrums(key: Key, slots: readonly ChordSlot[]): Note[] {
  const out: Note[] = [];
  for (const slot of slots) {
    const pcs = chordPitchClasses(key, slot.chord);
    const [root = 0, , fifth = 7] = pcs;
    const colour =
      slot.chord.quality === "maj" && slot.chord.numeral === "III"
        ? [root, mod12(root + 2), fifth]
        : slot.chord.quality === "maj" && slot.chord.numeral === "IV"
          ? [root, mod12(root + 5), fifth]
          : pcs;
    const voicing = notesInRange(colour, 55, 67).slice(-4);
    for (let step = slot.step; step < slot.step + slot.length; step++) {
      const down = step % 2 === 0;
      for (const midi of voicing) {
        out.push({ step, dur: 0.9, midi, vel: step % 4 === 0 ? 1 : down ? 0.85 : 0.6 });
      }
    }
  }
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
    // No low root: the bass has it, and a C3-area pad note masks the bass's harmonics.
    for (const midi of voiceChord(pcs, 62)) {
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

interface DrumBarContext {
  barInSection: number;
  sectionStart: boolean;
  lastBar: boolean;
  intro: boolean;
  fill: boolean;
  intoChorus: boolean;
}

function drumBar(mode: DrumMode, rng: Rng, style: number, ctx: DrumBarContext): DrumHit[] {
  if (mode === "off") return [];
  const { barInSection, sectionStart, intoChorus } = ctx;
  const hits: DrumHit[] = [];
  const hit = (voice: DrumVoice, step: number, vel: number) => hits.push({ voice, step, vel });
  // The groove carries its own fill in its last bar.
  const fill = ctx.fill && mode !== "groove";
  const fillFrom = fill ? (intoChorus ? 8 : 12) : 16;
  const evenBar = barInSection % 2 === 0;

  // Kick: four on the floor — "the drums do one thing: stomp".
  if (mode === "half") hit("kick", 0, 1);
  else for (const s of [0, 4, 8, 12]) if (s < fillFrom || s === 12) hit("kick", s, 1);
  if (mode === "big" && style > 0.5 && rng.chance(0.4)) hit("kick", 14, 0.7);

  // TF's drum intro (MIDI bars 0–3): a kick run into every other bar, ghost snares after beat 2,
  // a low tom on 4& in the bars between, and a snare-and-tom fill in the last bar.
  if (mode === "groove") {
    for (const s of [4, 12]) hit("snare", s, 1);
    if (ctx.lastBar) {
      for (const s of [1, 3, 9, 11, 13, 14]) hit("snare", s, 0.5);
      hit("toml", 14, 0.85);
      hit("openhat", 6, 0.55);
    } else {
      hit("snare", 5, 0.45);
      hit("snare", 7, 0.5);
      if (evenBar) for (const s of [13, 14, 15]) hit("kick", s, 0.8);
    }
  }
  // TF's intro keeps a low tom on 4& every other bar (MIDI bars 1–15).
  if (style < 0.5 && ctx.intro && !evenBar && mode !== "half" && fillFrom === 16)
    hit("toml", 14, 0.8);

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
    // TF opens a hat on beat 3 of every other bar (MIDI, intro to outro).
    if (style < 0.5 && s === 8 && evenBar && mode !== "kick" && mode !== "half") {
      hit("openhat", s, 0.6);
    } else if (mode === "big" && offbeat8) {
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
