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
  type SectionKind,
  type Song,
} from "./composer";
import { GENRES, genreAt, type DrumTraits } from "./genres";
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
  "counter",
  "arp",
  "stab",
  "seq",
  "guitar",
  "synth",
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
  const parts = GENRES[song.genre].parts;
  const profile = genreAt(GENRES[song.genre], song.weights);
  const voices = profile.voices;
  // Self Control's riff is played by the bass too, in unison, four octaves down.
  const unison = L.riff && voices.riff === "unison";
  const notes: Record<MelodicTrack, Note[]> = {
    bass: !L.bass
      ? []
      : song.bassStyle === "sc"
        ? unison
          ? motifNotes(song.riff, barInSection, key, slots, "scale", 36, 0.95)
          : scBassLine(figureContext("bass"), rng.fork("bass"), section.kind)
        : song.bassStyle === "yc"
          ? ycBassLine(figureContext("bass"), rng.fork("bass"), section.kind !== "prechorus")
          : song.bassStyle === "italo" || song.bassStyle === "night"
            ? italoBassLine(figureContext("bass"), song.bassStyle === "night", barInSection)
            : song.bassStyle === "faces"
              ? facesBassLine(
                  figureContext("bass"),
                  barInSection,
                  section.kind === "chorus" || !!L.bassHeld,
                )
              : bassLine(song.bassStyle, figureContext("bass")),
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
    pad: L.pad
      ? padChords(
          key,
          slots,
          // Faces' chorus brings sustained pads in over the stabs: louder than verse pads.
          section.kind === "break" ||
            (section.kind === "chorus" && L.stabs && parts?.stabs === "gated8")
            ? 0.75
            : // Get Closer's verse pads sit 3–5 dB under its choruses'.
              parts && section.kind === "verse"
              ? 0.4
              : 0.55,
          voices.pad,
        )
      : [],
    riff: !L.riff
      ? []
      : voices.riff === "echo"
        ? motifNotes(song.riff, barInSection, key, slots, "scale", 62, 0.95)
        : voices.riff === "pair"
          ? pairNotes(song.riff, barInSection, key)
          : unison
            ? motifNotes(song.riff, barInSection, key, slots, "scale", 84, 0.8)
            : motifNotes(
                song.riff,
                barInSection,
                key,
                slots,
                "chord",
                song.riffHigh ? 79 : 67,
                0.85,
              ),
    lead: [],
    leadOct: [],
    counter: [],
    arp: L.arp ? motifNotes(song.arp, barInSection, key, slots, "chord", 72, 0.5) : [],
    stab: !L.stabs
      ? []
      : L.drums === "stab"
        ? breakStab(key, slots)
        : voices.stabPatch === "chop"
          ? chops(key, slots)
          : parts?.stabs === "gated8"
            ? voices.stabPatch === "pluck"
              ? pluckedStabs(key, slots, section.kind === "chorus" || section.kind === "outro")
              : gatedStabs(key, slots)
            : barInSection % 4 === 0
              ? stabChord(key, slots)
              : [],
    seq: L.seq ? sequenceLine(song, key) : [],
    guitar: L.guitar ? guitarStrums(key, slots) : [],
    synth: [],
  };
  if (L.leadSynth) {
    const melody = song.sectionMelodies[sectionIndex];
    notes.synth = (melody?.bars[barInSection % melody.bars.length] ?? []).map((n) => ({ ...n }));
  }

  // Faces' plucked arpeggio joins for the second 8 bars of a loop section (faces.md §10.4).
  if (L.held && voices.arpPatch === "pluck" && (section.bars <= 8 || barInSection >= 8))
    notes.arp = facesArpeggio(key, slots);
  if (L.lead) {
    const melody = song.sectionMelodies[sectionIndex] ?? song.melodies[L.lead];
    const lead = melody.bars[barInSection % melody.bars.length] ?? [];
    notes.lead = lead.map((n) => ({ ...n }));
    if (L.leadStack) {
      notes.leadOct = lead.map((n) => ({
        ...n,
        midi: thirdBelow(key, slots, n),
        vel: n.vel * 0.6,
      }));
    } else if (L.leadDouble)
      notes.leadOct = lead.map((n) => ({ ...n, midi: n.midi + 12, vel: n.vel * 0.55 }));
  }
  const counter =
    L.counter && voices.countervoice === "none"
      ? (song.sectionCounters[sectionIndex] ?? song.counter)
      : null;
  if (L.counter && voices.countervoice === "pluck8")
    notes.counter = pluckedCountervoice(key, slots, rng.fork("counter"));
  if (L.counter && voices.countervoice === "sync16") {
    const next = bar + 1 < song.totalBars ? arrangeTarget(song, bar + 1) : undefined;
    notes.counter = syncCountervoice(key, slots, next?.slots[0], rng.fork("counter"));
  }
  if (L.counter && voices.countervoice === "arp8") {
    const next = bar + 1 < song.totalBars ? arrangeTarget(song, bar + 1) : undefined;
    notes.counter = arpCountervoice(key, slots, next?.slots[0], rng.fork("counter"));
  }
  if (counter)
    notes.counter = (counter.bars[barInSection % counter.bars.length] ?? []).map((n) => ({ ...n }));
  // Parts from a MIDI file replace the generated ones (midi.ts).
  for (const [track, bars] of Object.entries(song.imported?.notes ?? {})) {
    notes[track as MelodicTrack] = (bars[bar] ?? []).map((n) => ({ ...n }));
    if (track === "lead") notes.leadOct = [];
  }

  const isLastBar = barInSection === section.bars - 1;
  const importedDrums = song.imported?.drums;
  const drums = importedDrums
    ? (importedDrums[bar] ?? []).map((h) => ({ ...h }))
    : drumBar(L.drums, rng.fork("drums"), profile.drums, {
        kind: section.kind,
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
 * DS A1–G♯2 (Demucs stems: B1, E2, A2), You Came F♯1–F2 (stems: A1 and B1 in the loop, F♯1 to E2
 * in the pre-chorus). An inverted chord puts its bass note there instead of its root. */
function bassRoot(style: BassStyle, key: Key, c: Chord): number {
  const [lo, hi] =
    style === "tf"
      ? [31, 42]
      : style === "yc"
        ? [30, 41]
        : style === "ds"
          ? [33, 44]
          : // Self Control's is the lowest of all, C♯1–B1 (branigan-self-control.md §4.2).
            style === "sc"
            ? [25, 36]
            : // The Italo basses: The Night E♭1–G♭2, Get Closer A1–E2, Faces E1–A1.
              [28, 40];
  let root = nearestWithPc(mod12(key.tonic + (c.bass ?? c.root)), (lo + hi) / 2);
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

/**
 * You Came's bass (analysis §6.3): legato 8ths on the root, re-struck every 8th, the "&"s a little
 * stronger than the beats (an off-beat pump). In loop bars it repeats the root as a 16th on 4a in
 * about two thirds of the bars; unlike the TF/DS figure it never anticipates the next chord. A bar
 * with two chords changes on beat 3, except that a root-position tonic is pushed an 8th early and
 * drops an octave on beat 4 (the bar into the pre-chorus: B B B E E E E₁ E₁). A ii bar hops up
 * the octave on beats 2 and 4, and a v bar walks: root, a step up, root, then two steps down.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *   loop     R  -  R  -  R  -  R  -  R  -  R  -  R  -  R  R
 *   ii       R  -  R  -  R8 -  R  -  R  -  R  -  R8 -  R  -
 *   v        R  -  R  -  +1 -  +1 -  R  -  R  -  −1 -  −2 -
 */
function ycBassLine(ctx: FigureContext, rng: Rng, loop: boolean): Note[] {
  const [first, second] = ctx.slots;
  if (!first) return [];
  const pushed = second?.chord.numeral === "I";
  const change = second ? (pushed ? 6 : second.step) : 16;
  const out: Note[] = [];
  for (let step = 0; step < 16; step += 2) {
    const c = (step >= change && second ? second : first).chord;
    let midi = bassRoot("yc", ctx.key, c);
    if (!second && c.numeral === "ii" && (step === 4 || step === 12)) midi += 12;
    if (!second && c.numeral === "v") {
      const scale = notesInRange(scaleForChord(ctx.key, c), midi - 5, midi + 3);
      const at = scale.indexOf(midi);
      const by = step === 4 || step === 6 ? 1 : step === 12 ? -1 : step === 14 ? -2 : 0;
      midi = scale[at + by] ?? midi;
    }
    if (pushed && step >= 12 && midi - 12 >= 28) midi -= 12;
    out.push({ step, dur: 1.9, midi, vel: step % 4 === 0 ? 0.85 : 0.95 });
  }
  const last = out.at(-1);
  if (loop && !second && last && rng.chance(0.67)) {
    // Cut short, so the 4a is struck afresh.
    last.dur = 0.6;
    out.push({ step: 15, dur: 0.95, midi: last.midi, vel: 0.95 });
  }
  if (ctx.short) for (const n of out) n.dur = Math.min(0.95, n.dur);
  return out;
}

/**
 * The Italo root 8ths (Get Closer §5, The Night §5): every 8th re-struck on the chord's bass note
 * (a slash chord's, so Get Closer's pads move over a bass of their own), the off-beats a little
 * stronger, no anticipations and no pickups. The tone (genres.ts `bassTone`) makes Get Closer's a
 * plucked decay and The Night's legato. With `lifts`, The Night's octave lifts: on 2& and 3 of
 * each 4-bar loop's first bar, and on the last 8th before the bass changes note.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *   plain    R  -  R  -  R  -  R  -  R  -  R  -  R  -  R  -
 *   lifts    R  -  R  -  R  -  R8 -  R8 -  R  -  R  -  R8 -   (bar 1 of 4, before a change)
 */
function italoBassLine(ctx: FigureContext, lifts: boolean, barInSection: number): Note[] {
  const out: Note[] = [];
  const nextRoot = ctx.next ? bassRoot("italo", ctx.key, ctx.next.chord) : undefined;
  for (let step = 0; step < 16; step += 2) {
    const slot = slotAt(ctx.slots, step);
    if (!slot) continue;
    let midi = bassRoot("italo", ctx.key, slot.chord);
    if (lifts) {
      const following =
        step === 14
          ? nextRoot
          : bassRoot("italo", ctx.key, slotAt(ctx.slots, step + 2)?.chord ?? slot.chord);
      const loopStart = barInSection % 4 === 0 && (step === 6 || step === 8);
      if (loopStart || (following !== undefined && following !== midi)) midi += 12;
    }
    out.push({ step, dur: ctx.short ? 0.95 : 1.8, midi, vel: step % 4 === 0 ? 0.85 : 1 });
  }
  return out;
}

/**
 * Faces' bass (§5): a two-bar staccato figure on the chord's bass note, short notes on the four
 * beats in one bar and on 1&, 2& and 3& in the next, each bar rolling legato into the next root on
 * 4&, tied over the bar line. Every other pair hops up an octave on the on-beat bar's beat 4 and
 * takes the pickup in that octave. In choruses, the dark sustained bass: the root held for each
 * chord.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *   on       R  -  -  -  R  -  -  -  R  -  -  -  R  -  N  ~
 *   off      ~  -  R  -  -  -  R  -  -  -  R  -  -  -  N  ~
 */
function facesBassLine(ctx: FigureContext, barInSection: number, sustained: boolean): Note[] {
  if (sustained) {
    return ctx.slots.map((s) => ({
      step: s.step,
      dur: s.length - 0.1,
      midi: bassRoot("faces", ctx.key, s.chord),
      vel: 0.9,
    }));
  }
  const offBar = barInSection % 2 === 1;
  const hop = !offBar && barInSection % 4 === 2;
  const out: Note[] = [];
  for (const step of offBar ? [2, 6, 10] : [0, 4, 8, 12]) {
    // The downbeat is the last bar's 4& tied over.
    if (step === 0 && ctx.heldIn) continue;
    const slot = slotAt(ctx.slots, step);
    if (!slot) continue;
    const midi = bassRoot("faces", ctx.key, slot.chord) + (hop && step === 12 ? 12 : 0);
    out.push({ step, dur: 0.9, midi, vel: step % 4 === 0 ? 0.95 : 0.9 });
  }
  const last = slotAt(ctx.slots, 14);
  const next = ctx.next ? bassRoot("faces", ctx.key, ctx.next.chord) : undefined;
  const pickup = next ?? (last ? bassRoot("faces", ctx.key, last.chord) : undefined);
  if (pickup !== undefined) {
    out.push({
      step: 14,
      dur: next !== undefined ? 2.4 : 1.8,
      midi: pickup + (hop ? 12 : 0),
      vel: 0.9,
    });
  }
  if (ctx.short) for (const n of out) n.dur = Math.min(0.95, n.dur);
  return out;
}

/**
 * Self Control's bass (branigan-self-control.md §4): one note on every beat, on the chord's bass
 * note, an 8th long, then silence, doubling the kick. Very low (C♯1–B1). Every change lands on
 * beat 1: no anticipations. In the choruses and the outro some bars add the octave on the "&"s
 * (a fifth to a quarter of chorus 2's bars).
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *   loop     R  -  .  .  R  -  .  .  R  -  .  .  R  -  .  .
 *   octaves  R  -  R8 .  R  -  R8 .  R  -  R8 .  R  -  .  .   (some chorus bars)
 */
function scBassLine(ctx: FigureContext, rng: Rng, kind: SectionKind): Note[] {
  const out: Note[] = [];
  const octaves = (kind === "chorus" || kind === "outro") && rng.chance(0.2);
  for (let step = 0; step < 16; step += 2) {
    const slot = slotAt(ctx.slots, step);
    if (!slot) continue;
    const root = bassRoot("sc", ctx.key, slot.chord);
    if (step % 4 === 0) out.push({ step, dur: 1.8, midi: root, vel: 0.95 });
    else if (octaves && step < 14) out.push({ step, dur: 0.9, midi: root + 12, vel: 0.7 });
  }
  return out;
}

/** The Night's two-note riff (`generatePair`): the tonic around F4 (idx 1) and the 7th below it
 * (idx 0), whatever the chord. */
function pairNotes(motif: Motif, barInSection: number, key: Key): Note[] {
  const offset = (barInSection % motif.bars) * 16;
  const tonic = nearestWithPc(key.tonic, 65);
  return motif.notes
    .filter((n) => n.step >= offset && n.step < offset + 16)
    .map((n) => ({
      step: n.step - offset,
      dur: n.dur,
      midi: n.idx === 1 ? tonic : tonic - 2,
      vel: n.vel * 0.9,
    }));
}

/**
 * The Night's chorus countervoice (the-night.md §10.2): a plucked note on every off-beat 8th and on
 * some beats, in the voice's register (A♭4–E♭5 on the record), stepping down through the chord's
 * tones (its added 9th, 4th or 7th included) over the bar.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *            ?  -  x  -  ?  -  x  -  ?  -  x  -  ?  -  x  -   (x always, ? some bars)
 */
function pluckedCountervoice(key: Key, slots: readonly ChordSlot[], rng: Rng): Note[] {
  const out: Note[] = [];
  const beats = [0, 4, 8, 12].filter((s) => rng.chance(s === 0 || s === 12 ? 0.5 : 0.3));
  const steps = [...beats, 2, 6, 10, 14].sort((a, b) => a - b);
  let i = 0;
  let current: ChordSlot | undefined;
  for (const step of steps) {
    const slot = slotAt(slots, step);
    if (!slot) continue;
    if (slot !== current) {
      current = slot;
      i = 0;
    }
    const tones = notesInRange(chordPitchClasses(key, slot.chord), 67, 76).reverse();
    const midi = tones[Math.min(i, tones.length - 1)] ?? tones[0];
    if (midi === undefined) continue;
    // Each note rings on for most of a bar (the envelope fades it), overlapping the next.
    out.push({ step, dur: 8, midi, vel: step % 4 === 2 ? 0.8 : 0.6 });
    // Down through the tones, once per off-beat; a beat repeats its neighbour.
    if (step % 4 === 2) i = (i + 1) % Math.max(1, tones.length);
  }
  return out;
}

/**
 * Get Closer's chorus countervoice (get-closer.md §10): a rest on beat 1, then 8ths from beat 2, up
 * the chord from its root in C6–B6 (root, 3rd, 5th) and back down, or on up through the 6th and
 * 7th; the last 8th is a tone of the next chord. Each note rings about a quarter, overlapping the
 * next.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *            -  -  -  -  R  -  3  -  5  -  3  -  R  -  N  -   (or R 3 5 6 7 6)
 */
function arpCountervoice(
  key: Key,
  slots: readonly ChordSlot[],
  next: ChordSlot | undefined,
  rng: Rng,
): Note[] {
  const out: Note[] = [];
  const climb = rng.chance(0.3);
  let last: number | undefined;
  [4, 6, 8, 10, 12, 14].forEach((step, i) => {
    const slot = slotAt(slots, step);
    if (!slot) return;
    // The root nearest D6, so the arpeggio stays around C6–B6 (Em, C and D bars: E G B, C E G A B,
    // D F♯ A on the record) in any key.
    const lo = nearestWithPc(mod12(key.tonic + slot.chord.root), 86);
    const up = notesInRange(scaleForChord(key, slot.chord), lo, lo + 12);
    const tones = notesInRange(chordPitchClasses(key, slot.chord), lo, lo + 12);
    let midi: number | undefined;
    if (i === 5 && next) {
      const target = last ?? lo;
      midi = closestTo(notesInRange(chordPitchClasses(key, next.chord), 82, 97), target);
    } else if (climb && i >= 3) {
      // On up through the 6th and the 7th, then back to the 6th.
      const fifth = tones[2] ?? lo;
      const above = up.filter((n) => n > fifth);
      midi = [above[0], above[1], above[0]][i - 3] ?? fifth;
    } else {
      midi = [tones[0], tones[1], tones[2], tones[1], tones[0], tones[1]][i];
    }
    if (midi === undefined) return;
    last = midi;
    out.push({ step, dur: 3.6, midi, vel: i === 0 ? 0.8 : 0.7 });
  });
  return out;
}

/**
 * Self Control's bright chorus part (branigan-self-control.md §6, §11): chord tones in C♯5–G♯6,
 * leaping between the lowest tone and its octave on the "&"s and beats 2 and 3, the top tone on
 * 3a and, on 4a, the next chord's nearest tone, tied over the bar line. 3a and 4a are the accents.
 *
 *            1  e  &  a  2  e  &  a  3  e  &  a  4  e  &  a
 *            .  .  L  .  O  .  M  .  O  .  .  T  .  .  .  N
 */
function syncCountervoice(
  key: Key,
  slots: readonly ChordSlot[],
  next: ChordSlot | undefined,
  rng: Rng,
): Note[] {
  const out: Note[] = [];
  const middle = rng.chance(0.3) ? 2 : 1;
  for (const [step, vel] of [
    [2, 0.7],
    [4, 0.55],
    [6, 0.7],
    [8, 0.8],
    [11, 0.9],
    [15, 0.95],
  ] as const) {
    const slot = slotAt(slots, step);
    if (!slot) continue;
    const tones = notesInRange(chordPitchClasses(key, slot.chord), 73, 92);
    const low = tones[0];
    const top = tones.at(-1);
    if (low === undefined || top === undefined) continue;
    const octave = low + 12 <= 92 ? low + 12 : low;
    let midi = step === 2 ? low : step === 6 ? (tones[middle] ?? low) : step === 11 ? top : octave;
    if (step === 15)
      midi = closestTo(notesInRange(chordPitchClasses(key, (next ?? slot).chord), 73, 92), top);
    out.push({ step, dur: step === 15 ? 2.6 : 1.5, midi, vel });
  }
  return out;
}

/** A diatonic 3rd under a lead note: the stacked voice of You Came's choruses. */
function thirdBelow(key: Key, slots: readonly ChordSlot[], n: Note): number {
  const slot = slotAt(slots, n.step);
  if (!slot) return n.midi - 3;
  const below = notesInRange(scaleForChord(key, slot.chord), n.midi - 6, n.midi - 1);
  return below.at(-2) ?? n.midi - 3;
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

/** "octaves": The Night's pads, the triad stacked an octave up as well (they span C4–A♭6). "open":
 * Faces' chorus pads (faces.md §10.3), see openVoicing. */
function padChords(
  key: Key,
  slots: readonly ChordSlot[],
  vel: number,
  style: "close" | "octaves" | "open" = "close",
): Note[] {
  const octaves = style === "octaves";
  const out: Note[] = [];
  for (const slot of slots) {
    const pcs = chordPitchClasses(key, slot.chord);
    if (style === "open") {
      for (const midi of openVoicing(key, slot.chord)) {
        out.push({ step: slot.step, dur: slot.length - 0.1, midi, vel });
      }
      continue;
    }
    // No low root: the bass has it, and a C3-area pad note masks the bass's harmonics.
    for (const midi of voiceChord(pcs, 62)) {
      out.push({ step: slot.step, dur: slot.length - 0.1, midi, vel });
    }
    if (octaves) {
      for (const midi of voiceChord(pcs.slice(0, 3), 76)) {
        out.push({ step: slot.step, dur: slot.length - 0.1, midi, vel: vel * 0.55 });
      }
    }
  }
  return out;
}

/**
 * Faces' intro arpeggio (faces.md §10.4): on 8ths, the chord's root in octave 4, its octave and its
 * 5th, cycling and starting over at each chord change; a sus chord comes an 8th late, as the stab
 * does (F4 F5 C5 F4 F5 │ G4 G5 D5 over F–Gsus4).
 */
function facesArpeggio(key: Key, slots: readonly ChordSlot[]): Note[] {
  const out: Note[] = [];
  let i = 0;
  let current: ChordSlot | undefined;
  for (let step = 0; step < 16; step += 2) {
    let slot = slotAt(slots, step);
    if (!slot) continue;
    if (step > 0 && step === slot.step && slot.chord.quality.includes("sus"))
      slot = slotAt(slots, step - 1) ?? slot;
    if (slot !== current) {
      current = slot;
      i = 0;
    }
    const root = nearestWithPc(mod12(key.tonic + slot.chord.root), 65);
    const midi = [root, root + 12, root + 7][i % 3] ?? root;
    out.push({ step, dur: 1.8, midi, vel: step % 4 === 2 ? 0.62 : 0.55 });
    i++;
  }
  return out;
}

function closestTo(notes: readonly number[], target: number): number {
  return notes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), target);
}

/**
 * Faces' open pad voicing (faces.md §10.3): the root in octave 3, then the 7th (or, in a triad, the
 * 5th) in the middle, and on top the 3rd or 5th nearest A4. A triad leaves its 3rd out (the
 * singer has it): A3 E4 A4 on A, E3 D4 G4 on Em7, D3 C♯4 A4 on Dmaj7.
 */
function openVoicing(key: Key, c: Chord): number[] {
  const iv = intervalsOf(c);
  const root = nearestWithPc(mod12(key.tonic + c.root), 53);
  const seventh = iv.find((i) => i === 10 || i === 11);
  if (seventh === undefined) return [root, root + (iv[2] ?? 7), root + 12];
  const top = [iv[1] ?? 4, iv[2] ?? 7]
    .map((i) => root + 12 + i)
    .reduce((a, b) => (Math.abs(b - 68) < Math.abs(a - 68) ? b : a));
  return [root, root + seventh, top];
}

/** A chord's intervals above its root, from its pitch classes. */
function intervalsOf(c: Chord): number[] {
  return chordPitchClasses({ tonic: 0, mode: "major" }, { ...c, root: 0 }).map((pc) => mod12(pc));
}

/**
 * Faces' plucked stab (faces.md §10.1): a close three-note chord on every 8th, around D4–E5, the
 * 7th chords without their root (A C E on Fmaj7, D G B on Em7, E G C on Am7). A sus chord comes in
 * an 8th after the bass (Gsus4 on 3&). In a chorus it plays only the "&"s, lower (A3–A4). The
 * "&"s are a little louder.
 */
function pluckedStabs(key: Key, slots: readonly ChordSlot[], chorus: boolean): Note[] {
  if (chorus) return chorusStabs(key, slots);
  const out: Note[] = [];
  for (let step = chorus ? 2 : 0; step < 16; step += chorus ? 4 : 2) {
    let slot = slotAt(slots, step);
    if (!slot) continue;
    // A sus chord lands an 8th late: the 8th on its boundary still plays the chord before.
    if (step > 0 && step === slot.step && slot.chord.quality.includes("sus"))
      slot = slotAt(slots, step - 1) ?? slot;
    const pcs = chordPitchClasses(key, slot.chord);
    const notes = pcs.length > 3 ? pcs.slice(1) : pcs;
    for (const midi of voiceChord(notes, chorus ? 62 : 68)) {
      out.push({ step, dur: 1.8, midi, vel: step % 4 === 2 ? 0.62 : 0.5 });
    }
  }
  return out;
}

/**
 * Faces' chorus stab (faces.md §10.3): its own sound (held through the 8th, bright), on every 8th,
 * the "&"s louder, in low open voicings from A2: the root, the 5th, then the 7th and the 3rd (or
 * 4th) above, or in a triad the octave and the 5th above it (A2 A3 E4 A4, E3 B3 D4 G4, D3 A3 C♯4
 * F♯4, G3 D4 G4).
 */
function chorusStabs(key: Key, slots: readonly ChordSlot[]): Note[] {
  const out: Note[] = [];
  for (let step = 0; step < 16; step += 2) {
    const slot = slotAt(slots, step);
    if (!slot) continue;
    const iv = intervalsOf(slot.chord);
    const root = nearestWithPc(mod12(key.tonic + slot.chord.root), 50);
    const seventh = iv.find((i) => i === 10 || i === 11);
    const third = iv[1] ?? 4;
    const voicing =
      seventh === undefined
        ? root < 48
          ? [root, root + 12, root + 19, root + 24]
          : [root, root + 7, root + 12]
        : [root, root + 7, root + seventh, root + 12 + third];
    for (const midi of voicing) {
      out.push({ step, dur: 1.7, midi, vel: step % 4 === 2 ? 0.62 : 0.45, alt: true });
    }
  }
  return out;
}

/** Self Control's offbeat chop (branigan-self-control.md §6, §11): a short close triad around
 * F♯4 over its lowest note an octave down, on every "&", the first a little stronger. */
function chops(key: Key, slots: readonly ChordSlot[]): Note[] {
  const out: Note[] = [];
  for (const step of [2, 6, 10, 14]) {
    const slot = slotAt(slots, step);
    if (!slot) continue;
    const voicing = voiceChord(chordPitchClasses(key, slot.chord).slice(0, 3), 66);
    for (const midi of [(voicing[0] ?? 48) - 12, ...voicing]) {
      out.push({ step, dur: 1, midi, vel: step === 2 ? 0.68 : 0.6 });
    }
  }
  return out;
}

/** Self Control's break (branigan-self-control.md §5, §6): one low chord on beat 2, most of its
 * energy in C2–C3, left to ring into the reverb. */
function breakStab(key: Key, slots: readonly ChordSlot[]): Note[] {
  const slot = slotAt(slots, 4);
  if (!slot) return [];
  const voicing = voiceChord(chordPitchClasses(key, slot.chord).slice(0, 3), 55);
  return [(voicing[0] ?? 48) - 12, ...voicing].map((midi) => ({
    step: 4,
    dur: 10,
    midi,
    vel: 0.85,
    alt: true,
  }));
}

/** Faces' gated stabs (§7): the chord on every 8th, cut short, the off-beats a little louder. */
function gatedStabs(key: Key, slots: readonly ChordSlot[]): Note[] {
  const out: Note[] = [];
  for (let step = 0; step < 16; step += 2) {
    const slot = slotAt(slots, step);
    if (!slot) continue;
    for (const midi of voiceChord(chordPitchClasses(key, slot.chord), 67)) {
      out.push({ step, dur: 0.9, midi, vel: step % 4 === 2 ? 0.6 : 0.48 });
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
  kind: SectionKind;
  barInSection: number;
  sectionStart: boolean;
  lastBar: boolean;
  intro: boolean;
  fill: boolean;
  intoChorus: boolean;
}

function drumBar(mode: DrumMode, rng: Rng, traits: DrumTraits, ctx: DrumBarContext): DrumHit[] {
  if (mode === "off") return [];
  const { barInSection, sectionStart, intoChorus } = ctx;
  const hits: DrumHit[] = [];
  const hit = (voice: DrumVoice, step: number, vel: number) => hits.push({ voice, step, vel });
  // You Came's fill closes every 8-bar phrase (and a section that fills), and a crash opens the
  // next phrase. It replaces the random fills.
  const kitMode = mode === "full" || mode === "big" || mode === "hats16";
  const phraseFill = traits.phraseFills && (ctx.fill || (kitMode && barInSection % 8 === 7));
  const phraseStart = traits.phraseFills && kitMode && barInSection > 0 && barInSection % 8 === 0;
  // The groove carries its own fill in its last bar. The Night has none; Faces closes every 8 bars
  // with a snare pickup instead.
  const fills = traits.fills ?? "random";
  const fill =
    ctx.fill && mode !== "groove" && !phraseFill && (fills === "random" || fills === "snare");
  const pickup8 = fills === "pickup8" && kitMode && (ctx.fill || barInSection % 8 === 7);
  const fillFrom = fill ? (intoChorus ? 8 : 12) : 16;
  const evenBar = barInSection % 2 === 0;

  // Self Control: no hats in the verses, 16ths from the pre-chorus on (see below).
  const scHats = traits.hats === "verse-off";

  // Kick: four on the floor — "the drums do one thing: stomp". You Came's breakdown keeps it to
  // the 1 for three bars. Self Control's breaks hit once, on beat 2, kick and snare together.
  if (mode === "stab") {
    hit("kick", 4, 1);
    hit("snare", 4, 1);
  } else if (mode === "half" || (mode === "breakdown" && barInSection < 3)) hit("kick", 0, 1);
  else for (const s of [0, 4, 8, 12]) if (s < fillFrom || s === 12) hit("kick", s, 1);
  if (mode === "big" && traits.bigKick14 && rng.chance(0.4)) hit("kick", 14, 0.7);

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
  if (traits.introLowTom && ctx.intro && !evenBar && mode !== "half" && fillFrom === 16)
    hit("toml", 14, 0.8);

  // Snare on 2 and 4 (beat 3 in half time), doubled by a clap in big sections. None in a
  // breakdown, nor in the first half of You Came's break.
  const snare = kitMode && !(mode === "hats16" && ctx.kind === "break" && barInSection < 4);
  if (snare) {
    for (const s of [4, 12]) {
      if (s >= fillFrom) continue;
      hit("snare", s, 1);
      if ((mode === "big" && !traits.bigClaps) || traits.clapAlways) hit("clap", s, 0.75);
    }
  } else if (mode === "half" && scHats && ctx.intro) {
    // Self Control's intro: no snare, toms on 3& and 4e every other bar.
    if (!evenBar && fillFrom === 16) {
      hit("toml", 10, 0.7);
      hit("tomm", 13, 0.75);
    }
  } else if (mode === "half") hit("snare", 8, 0.95);
  // Self Control's chorus claps: on 4, and every other bar on 3e; in the outro, on 2 alone.
  if (mode === "big" && traits.bigClaps === "4-and-3e") {
    if (ctx.kind === "outro") hit("clap", 4, 0.8);
    else {
      if (12 < fillFrom) hit("clap", 12, 0.85);
      if (!evenBar && 9 < fillFrom) hit("clap", 9, 0.75);
    }
  }

  // Hats were played live on the record, so humanise velocity and timing.
  const humanise = (s: number) => (s === 0 ? 0 : (rng.next() - 0.5) * 0.12);
  const ycHats =
    phraseFill ||
    (traits.hats === "beat-and-a" && (mode === "full" || mode === "big" || mode === "breakdown"));
  if (ycHats) {
    // You Came: the beat, the "&" and (in most bars) the "a", never the "e"; the "a" rings open
    // in about a third of the bars. A fill bar drops to 8ths; a crash takes the 1's hat.
    const open = rng.chance(1 / 3);
    for (let s = 0; s < 16; s++) {
      const pos = s % 4;
      if (pos === 1 || (s === 0 && (sectionStart || phraseStart))) continue;
      if (pos === 3) {
        if (phraseFill || !rng.chance(0.75)) continue;
        hit(open ? "openhat" : "hat", s + humanise(s), 0.6 + rng.next() * 0.1);
      } else hit("hat", s + humanise(s), (pos === 0 ? 0.55 : 0.7) + rng.next() * 0.12);
    }
  }
  // Faces' chorus hats: x x x . │ x . x x every two beats, and a kick on 3& every 4th bar.
  const gallop = mode === "big" && traits.bigHats === "gallop" && !ycHats;
  if (gallop) {
    for (let s = 0; s < fillFrom; s++) {
      if (s % 8 === 3 || s % 8 === 5) continue;
      hit(
        "hat",
        s + humanise(s),
        (s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.68 : 0.42) + rng.next() * 0.1,
      );
    }
    if (barInSection % 4 === 3 && fillFrom > 10) hit("kick", 10, 0.85);
  }
  // Self Control's hats (branigan-self-control.md §5): none in the verses; 8ths in the intro;
  // from the pre-chorus on, programmed 16ths at one level, without the "e" after the backbeat. In
  // the chorus every other bar leaves 3e and 3& to the clap and opens the 4a.
  if (scHats && mode !== "stab" && (ctx.kind !== "verse" || mode === "hats16")) {
    const sixteenths = mode === "hats16" || (!ctx.intro && mode !== "kick" && mode !== "half");
    const barB = mode === "big" && ctx.kind !== "outro" && !evenBar;
    for (let s = 0; s < fillFrom; s++) {
      if (!sixteenths) {
        if (s % 2 === 0)
          hit("hat", s + humanise(s), (s % 4 === 0 ? 0.45 : 0.65) + rng.next() * 0.1);
        continue;
      }
      if (s === 5 || s === 13 || (barB && (s === 9 || s === 10))) continue;
      if (barB && s === 15) hit("openhat", s, 0.55);
      else hit("hat", s + humanise(s), 0.5 + rng.next() * 0.06);
    }
  }
  // The Italo 8th hats: nothing on the "e" and "a" (Faces' verses open the 3a).
  const hats8 = traits.hats === "8ths" || traits.hats === "8ths-open3a";
  for (let s = 0; s < 16 && !ycHats && !gallop && !scHats; s++) {
    if (s >= fillFrom) break;
    if (hats8 && s % 2 === 1 && mode !== "hats16") {
      if (traits.hats === "8ths-open3a" && s === 11 && mode === "full") hit("openhat", s, 0.5);
      continue;
    }
    const offbeat8 = s % 4 === 2;
    // TF opens a hat on beat 3 of every other bar (MIDI, intro to outro).
    if (traits.openHatBeat3 && s === 8 && evenBar && mode !== "kick" && mode !== "half") {
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
    if (traits.bigPercussion === "tamb") {
      for (const s of [2, 6, 10, 14]) if (s < fillFrom) hit("tamb", s, 0.45);
    } else if (traits.bigPercussion === "cabasa") {
      for (let s = 1; s < fillFrom; s += 2) hit("cabasa", s, 0.3 + rng.next() * 0.1);
    }
  }

  if ((sectionStart || phraseStart) && mode !== "half" && traits.crashes !== false)
    hit("crash", 0, 0.8);

  // You Came's fill: the snare on 2 and 4 and on every "&", none on 1 and 3.
  if (phraseFill) for (const s of [2, 4, 6, 10, 12, 14]) hit("snare", s, s % 8 === 4 ? 1 : 0.75);
  // …and its pickup snare on 4& in a third of the other bars.
  else if (traits.snarePickup && snare && rng.chance(0.35)) hit("snare", 14, 0.7);

  // Faces: snare on 3&, 4 and 4&.
  if (pickup8)
    for (const [s, v] of [
      [10, 0.6],
      [12, 1],
      [14, 0.8],
    ] as const)
      hit("snare", s, v);

  if (fill) {
    const kind =
      fills === "snare"
        ? "snare16"
        : rng.weighted([
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
