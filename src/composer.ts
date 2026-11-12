/**
 * Turns a seed (plus a few settings) into a Song: the section plan, the progressions, and the
 * per-song motifs and melodies. Pure and deterministic; no audio here. See docs/analysis.md.
 */
import type { DrumHit, MelodicTrack } from "./arranger";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  genreOfReference,
  randomWeights,
  referenceWeights,
  soloWeights,
  specWeights,
  styleOf,
  type Blend,
  type Genre,
  type GenreId,
} from "./genres";
import {
  AUTO_OPEN_CHANCE,
  partVoices,
  randomBlendOver,
  randomOpenBlend,
  pickFromBanks,
  profilesOf,
  simpleBlends,
  substituteFrom,
  tempoGrid,
  toRefWeights,
  type Part,
  type PartBlends,
  type Profile,
  type RefWeights,
} from "./profile";
import type { Progression, ProgressionKind } from "./progressions";
import { LAYERS_OFF } from "./form";
import { planEuro } from "./legacy-planners/euro";
import { planItalo } from "./legacy-planners/italo";
import { planSections } from "./legacy-planners/synthpop";
import { planMerged } from "./planner";
import { REFERENCES, type ReferenceId, type ReferenceSong } from "./references";
import { createRng, type Rng } from "./rng";
import {
  chord,
  chordPitchClasses,
  mod12,
  notesInRange,
  scaleForChord,
  type Chord,
  type Key,
} from "./theory";

export type SectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "interlude"
  | "turnaround"
  | "break"
  | "bridge"
  | "outro";
/** "groove": TF's busy intro pattern (kick runs, ghost snares, toms). "breakdown": You Came's
 * breakdown and bridge, no snare and the kick on 1 for three bars. "hats16": the full kit with
 * 16th hats whatever the song's hat pattern (You Came's break and instrumental). "stab": one hit on
 * beat 2 of every bar, kick and snare together (Self Control's breaks).
 * A backbeat kit (genres.ts `Grooves`, Euro-disco) reads them its own way: "full" plays the verse
 * or pre-chorus pattern, "big" the chorus's, "hats16" the intro's (16th hats, no kick), "half" a
 * hat on each beat (Innocent Love's chorus stop), and "groove" a kick on every beat with open hats
 * on the "&"s (Innocent Love's instrumental link). */
export type DrumMode =
  "off" | "kick" | "half" | "full" | "big" | "groove" | "breakdown" | "hats16" | "stab";
export type KitName = "sp12" | "linndrum" | "dmx" | "synth";
/** "ds" and "tf" play the songs' signature bass figure (arranger.ts `figure`), in DS's
 * articulation (16th pickups, approach notes) or TF's (dotted 8ths). "yc" is You Came's root 8ths
 * with a same-note 16th on 4a (arranger.ts `ycBassLine`). The Italo ones (arranger.ts
 * `italoBassLine`, `facesBassLine`): "italo" is Get Closer's plain plucked root 8ths, "night" The
 * Night's root 8ths with octave lifts, "faces" Faces' staccato on-beat/off-beat figure. "sc" is
 * Self Control's staccato root quarters, very low (arranger.ts `scBassLine`). */
export type BassStyle = "ds" | "tf" | "yc" | "italo" | "night" | "faces" | "sc" | EuroBassStyle;
/** The Euro-disco riff basses (arranger.ts `euroBassLine`), each with a verse, pre-chorus and
 * chorus figure: Innocent Love's pedal and slurred chorus figure, Heaven Can Wait's two riffs that
 * rest on beat 2, Crazy Juliet's re-struck held root and legato chorus line. */
export type EuroBassStyle = "innocent" | "heaven" | "juliet";

/** Every bass style with the record it comes from, in the order the pickers list them. */
export const BASS_STYLES: readonly (readonly [BassStyle, string])[] = [
  ["tf", "True Faith"],
  ["ds", "The Different Story"],
  ["yc", "You Came"],
  ["night", "The Night"],
  ["italo", "Get Closer"],
  ["faces", "Faces"],
  ["sc", "Self Control"],
  ["innocent", "Innocent Love"],
  ["heaven", "Heaven Can Wait"],
  ["juliet", "Crazy Juliet"],
];

export function isBassStyle(v: unknown): v is BassStyle {
  return BASS_STYLES.some(([style]) => style === v);
}
export type MelodyKind = "verse" | "chorus";

export interface Layers {
  drums: DrumMode;
  bass: boolean;
  hook: boolean;
  pad: boolean;
  riff: boolean;
  arp: boolean;
  stabs: boolean;
  /** TF's high 16th sequencer on the key's 5th (see SequencePattern). */
  seq: boolean;
  /** Plays the bass figure staccato (TF's turnarounds and outro). */
  bassShort: boolean;
  /** TF's rhythm guitar: 16th strums of sus-coloured triads. */
  guitar: boolean;
  lead: MelodyKind | null;
  /** Doubles the lead an octave up (True Faith's two-voice final chorus). */
  leadDouble: boolean;
  /** Stacks a second voice a diatonic 3rd under the lead (You Came's choruses); it takes the
   * place of `leadDouble`. */
  leadStack: boolean;
  /** TF's chorus counter-line: a high, sparse electric-piano line above the vocal (MIDI "Synth
   * Lead"). */
  counter: boolean;
  /** Faces' verse world (faces.md §10.4): its plucked root–octave–5th arpeggio, in the second 8
   * bars of a 16-bar section and all through a shorter one. Only set when on, so older sections
   * are unchanged. */
  held?: boolean;
  /** The Night's lead synth (the-night.md §10.1): an instrumental line of its own, on the synth
   * track, in its 12 bars after each intro block. Only set when on. */
  leadSynth?: boolean;
  /** Faces' bass holds each root instead of its figure (its first verse; faces.md §11, clip 11).
   * Only set when on. */
  bassHeld?: boolean;
  /** Self Control's pre-chorus (branigan-self-control.md §2, §6): the lead sings a line of its own,
   * the title line, between the verse's register and the chorus's. Only set when on. */
  titleLine?: boolean;
  /** The section's last bar stops (Innocent Love's turn, Crazy Juliet's pre-chorus): the drums and
   * the bass cut off early, the way the song's backbeat kit says (genres.ts `Grooves.stop`). Only
   * set when on. */
  stop?: boolean;
  /** With no pads, they swell in over the section's last two bars, struck on every beat louder
   * and louder (a bare verse into a busier pre-chorus or chorus, in a form across genres). Only
   * set when on. */
  padSwell?: boolean;
}

export interface Section {
  kind: SectionKind;
  label: string;
  startBar: number;
  bars: number;
  progression: Progression;
  key: Key;
  layers: Layers;
  /** Drum fill in the last bar. */
  fill: boolean;
  /** Fade out over the last 8 bars (both songs end on a fade). */
  fade: boolean;
  /** A custom melody (the spec's `melodies`) the lead plays instead of the generated one. */
  melody?: string;
}

/**
 * A melody written, played in, edited or imported in creator mode. Pitches are semitones above
 * the tonic of the key it was written in (MIDI note − `tonic`); in another key it moves by the
 * nearest interval, so it follows key changes without jumping registers.
 */
export interface CustomMelody {
  name: string;
  /** Pitch class of the key the melody was written in. */
  tonic: number;
  /** Length in bars; the melody repeats over longer sections. */
  bars: number;
  notes: { bar: number; step: number; dur: number; pitch: number; vel: number }[];
}

/**
 * TF's high sequencer (MIDI "Sequence", bar 46 to the end): a 16th pedal on the key's 5th, with the
 * tonic a 4th above (5) or the 5th an octave above (12) added on some steps. The original's exact
 * steps are part of the composition, so each song generates its own.
 */
export interface SequencePattern {
  tops: readonly (0 | 5 | 12)[];
}

/** Parts read from a MIDI file at runtime (midi.ts), by song bar. A part present here replaces the
 * generated one, even where the section wouldn't play it; an empty list of bars silences it. */
export interface ImportedTracks {
  notes?: Partial<Record<MelodicTrack, Note[][]>>;
  drums?: DrumHit[][];
}

/** A realised note. `step` and `dur` are in 16ths from the start of the bar. */
export interface Note {
  step: number;
  dur: number;
  midi: number;
  vel: number;
  /** Played by the track's other voice: Faces' chorus stab or Self Control's break stab on the stab
   * track, Self Control's guitar layer in its chorus comp on the counter track. Only set then. */
  alt?: true;
}

/** A motif note whose pitch is an index into a per-chord ladder, so it follows the harmony. */
export interface MotifNote {
  /** 16ths from the start of the motif. */
  step: number;
  dur: number;
  idx: number;
  vel: number;
}
export interface Motif {
  bars: number;
  notes: MotifNote[];
}

/** An 8-bar sung line: bars 0–3 state it, bars 4–7 answer it with a new cadence. */
export interface Melody {
  bars: Note[][];
}

/** A song's progressions by kind. The pre-chorus is only picked where one can play (You Came's
 * weight above 0, or a major key). */
export type Progressions = Record<Exclude<ProgressionKind, "prechorus">, Progression> & {
  prechorus?: Progression;
};

export interface Song {
  seed: number;
  /** Set when this is one of the originals (references.ts) rather than a generated song. */
  reference: ReferenceId | null;
  /** The spec this song was laid out from: an original's, or a creation's (creator mode). */
  spec: ReferenceSong | null;
  title: string;
  bpm: number;
  key: Key;
  style: number;
  /** The genre's references' weights the song was generated with, in `references` order. */
  weights: readonly number[];
  /** The genre whose profile the song was generated with: the one holding most of the song
   * part's weight (profile.ts). */
  genre: GenreId;
  /** Each part's blend over the references, of any genre (profile.ts). A song made from one
   * genre's weights has them in every part. */
  blends: PartBlends;
  kit: KitName;
  bassStyle: BassStyle;
  progressions: Progressions;
  sections: Section[];
  totalBars: number;
  riff: Motif;
  /** The riff an octave up, around C♯6–G♯6 (You Came's register, §7.5). */
  riffHigh: boolean;
  hook: Motif;
  arp: Motif;
  sequence: SequencePattern;
  melodies: Record<MelodyKind, Melody>;
  /** Per section (by index): the melody its lead plays, written over that section's chords. */
  sectionMelodies: (Melody | null)[];
  /** The counter-line over the chorus chords, and per section the one it plays (or null). */
  counter: Melody;
  sectionCounters: (Melody | null)[];
  /** Tracks supplied at runtime from a MIDI file (midi.ts), by song bar; they replace the
   * generated part. */
  imported?: ImportedTracks;
}

export interface ComposeOptions {
  seed: number;
  /** The genre profile to generate with (genres.ts); synthpop by default; "auto" picks one per
   * song (its weights are then that genre's own: given ones are for another genre). A creation
   * plays in its own genre and an original in the one that lists it, whatever this says. */
  genre?: GenreId | "auto";
  /** Legacy: where the song sits between the genre's first two references (synthpop: 0 = True
   * Faith … 1 = The Different Story), as weights `[1 − style, style, 0]`. Unset or null, with no
   * `weights` either, picks a style on that axis per song (as the old slider's auto did). */
  style?: number | null;
  /** The references' weights, in the genre's `references` order; overrides `style`. "auto" picks
   * a random point of the genre's polygon per song. */
  weights?: readonly number[] | "auto" | null;
  /** The references' weights across genres (profile.ts), for every part; overrides `genre`,
   * `style` and `weights`. Not for originals or creations, which keep their own. */
  blend?: RefWeights | null;
  /** A random point of these references' polygon per song, when `blend` is unset (an open
   * blend's "auto" style). */
  blendRefs?: readonly ReferenceId[] | null;
  /** Per-part blends over `blend` (or over the genre's weights). */
  parts?: Partial<PartBlends> | null;
  key?: Key | null;
  bpm?: number | null;
  kit?: KitName | "auto";
  /** Play an original's measured form, chords, key, tempo and kit instead of generating them. */
  reference?: ReferenceId | null;
  /** Lay the song out from this spec instead (creator mode); takes precedence over `reference`. */
  custom?: ReferenceSong | null;
  // The new-song wizard's choices (each optional; unset means the generator decides).
  /** Use these progressions instead of picking from the bank. */
  progressions?: Partial<Progressions>;
  /** Short: one verse/chorus block less, 8-bar verses. Long: always a third verse and chorus. */
  form?: SongForm;
  ending?: SongEnding;
  bassStyle?: BassStyle;
}

export type SongForm = "short" | "standard" | "long";
/** A lift to IV (TF), a chorus to fade (DS), or IV held (You Came). */
export type SongEnding = "lift" | "fade" | "hold";

export const LEAD_RANGES: Record<MelodyKind, readonly [number, number]> = {
  verse: [57, 70],
  chorus: [62, 74],
};
/** The Night's lead synth (the-night.md §10.1): E♭4–C5 on the record, a little room either side. */
export const LEAD_SYNTH_RANGE = [62, 74] as const;

/**
 * The lead synth's phrasing (the-night.md §10.1): phrases of a bar or two with rests between, about
 * 40% of the time, in 16ths and 8ths with the phrase's last note held. Bars 2 and 5–6 of every 8
 * rest; the rest keep their notes, cut to an 8th at most except each phrase's last.
 */
function sparsePhrases(melody: Melody): Melody {
  const rests = new Set([2, 5, 7]);
  return {
    bars: melody.bars.map((bar, i) => {
      if (rests.has(i % 8)) return [];
      const endsPhrase = rests.has((i + 1) % 8);
      return bar.map((n, j) => ({
        ...n,
        dur: endsPhrase && j === bar.length - 1 ? Math.min(n.dur, 8) : Math.min(n.dur, 2),
      }));
    }),
  };
}
/** The counter-line sits above the sung chorus: TF's MIDI keeps it to F5–C6, reaching to A4 and
 * E6. */
/** A partial record without its unset entries, so spreading it keeps what it would override. */
function withoutUnset(parts: Partial<PartBlends>): Partial<PartBlends> {
  return Object.fromEntries(Object.entries(parts).filter(([, w]) => w !== undefined)) as Partial<
    Record<Part, RefWeights>
  >;
}

export const COUNTER_RANGE = [74, 86] as const;

export function compose(opts: ComposeOptions): Song {
  const ref = opts.custom ?? (opts.reference ? REFERENCES[opts.reference] : undefined);
  const root = createRng(opts.seed);
  // Its own stream, so an auto style draws nothing from the others.
  const autoStyle = Math.round(root.fork("style").next() * 100) / 100;
  // A creation plays in its own genre, an original in the one that lists it.
  const legacyGenreId = opts.custom
    ? (opts.custom.genre ?? DEFAULT_GENRE)
    : opts.reference
      ? genreOfReference(opts.reference)
      : opts.genre === "auto"
        ? root.fork("genre").pick(GENRE_IDS)
        : (opts.genre ?? DEFAULT_GENRE);
  const legacyGenre = GENRES[legacyGenreId];
  // The auto point draws from its own stream too.
  const rngPoint = root.fork("point");
  // With the genre picked per song, the point is too: weights given for one genre don't fit another.
  const weightsOpt =
    opts.genre === "auto" && !opts.custom && !opts.reference ? "auto" : opts.weights;
  const given =
    weightsOpt === "auto"
      ? randomWeights(legacyGenre, () => rngPoint.next())
      : (weightsOpt ?? null);
  const legacyStyle = ref
    ? ref.style
    : given
      ? styleOf(given)
      : Math.min(1, Math.max(0, opts.style ?? autoStyle));
  // An original plays with all the weight on itself; a creation with its own weights (or its
  // legacy style's).
  const legacyWeights = opts.custom
    ? specWeights(legacyGenre, opts.custom)
    : ref && opts.reference
      ? soloWeights(legacyGenre, opts.reference)
      : (given ?? referenceWeights(legacyGenre, legacyStyle));
  // Auto (a genre per song) sometimes plays an open blend across genres instead, drawn from its
  // own stream so the preset songs draw as before.
  const rngOpen = root.fork("open");
  const autoOpen =
    opts.genre === "auto" && !ref && !opts.blend && !opts.parts && rngOpen.chance(AUTO_OPEN_CHANCE)
      ? randomOpenBlend(rngOpen)
      : null;
  // An open blend's auto point, on its own stream.
  const openPoint =
    !ref && !opts.blend && opts.blendRefs && opts.blendRefs.length > 1
      ? randomBlendOver(opts.blendRefs, root.fork("open-point"))
      : null;
  const givenBlend = ref ? null : (opts.blend ?? openPoint ?? autoOpen);
  // A creation across genres carries its own blends.
  const specBlends = opts.custom?.blends ?? null;
  // The parts' blends: given ones, else the genre's weights in every part.
  const blended = !!specBlends || (!ref && (!!givenBlend || !!opts.parts));
  const blends: PartBlends = specBlends ?? {
    ...simpleBlends(givenBlend ?? toRefWeights(legacyGenre, legacyWeights)),
    ...(ref ? {} : withoutUnset(opts.parts ?? {})),
  };
  const P = profilesOf(blends, legacyGenreId);
  // The song part decides the genre (until the merged planner, its form too).
  const g: Profile = { ...P.song, voices: partVoices(P) };
  const genre = g.genre;
  const genreId = genre.id;
  const weights = blended ? g.weights : legacyWeights;
  const style = blended && !ref ? styleOf(weights) : legacyStyle;
  const rngSetup = root.fork("setup");
  // You Came's choices draw from their own streams, so at its weight 0 a song is what it was.
  const rngMode = root.fork("mode");
  const rngYc = root.fork("you-came");
  // The song's form odds: its genre's, or mixed across genres when its blend spans them.
  const formOdds = (pick: (x: Genre) => Blend) =>
    P.song.mixed ? P.song.mix(pick) : g.at(pick(genre));

  // The minor tonic is drawn first either way, so the draws after it stay where they were.
  const autoKey = (): Key => {
    const tonic = rngSetup.weighted(P.song.weighted((x) => x.keyWeights));
    return rngMode.chance(P.song.mix((x) => x.major))
      ? { tonic: rngMode.weighted(P.song.weighted((x) => x.majorKeyWeights)), mode: "major" }
      : { tonic, mode: "minor" };
  };
  const key: Key = ref?.key ?? opts.key ?? autoKey();
  // A reference may take the range below its usual floor (Self Control): the grid only reaches
  // down there with its weight, so the others' tempos draw as they did.
  const tempo = tempoGrid(P.song);
  const autoBpm = rngSetup.weighted(
    Array.from({ length: (tempo.hi - tempo.lo) * 2 + 1 }, (_, i) => {
      const bpm = tempo.lo + i / 2;
      return [bpm, Math.exp(-((bpm - tempo.center) ** 2) / 3)] as const;
    }),
  );
  const bpm = ref?.bpm ?? opts.bpm ?? autoBpm;
  const autoKit = rngSetup.weighted<KitName>(P.drums.options((x) => x.kits));
  const kit = ref?.kit ?? (!opts.kit || opts.kit === "auto" ? autoKit : opts.kit);
  const pickedBass = rngSetup.weighted<BassStyle>(
    P.bass.options((x) => x.bassFigures).filter(([, w]) => w > 0),
  );
  const bassStyle = ref?.bassStyle ?? opts.bassStyle ?? pickedBass;

  const rngProg = root.fork("progressions");
  const prog = (kind: ProgressionKind, rng = rngProg) =>
    substituteFrom(
      P.song,
      pickFromBanks(P.song, kind, style, rng, key.mode),
      kind,
      rng,
      0.3,
      key.mode,
    );
  const progressions: Progressions = {
    verse: prog("verse"),
    chorus: prog("chorus"),
    interlude: prog("interlude"),
    turnaround: prog("turnaround"),
    bridge: prog("bridge"),
    lift: prog("lift"),
  };
  if (key.mode === "major" || formOdds((x) => x.form.preChorus) > 0)
    progressions.prechorus = prog("prechorus", root.fork("prechorus"));
  // You Came's verse is its chorus loop.
  if (rngYc.chance(formOdds((x) => x.form.verseOnLoop))) progressions.verse = progressions.chorus;
  Object.assign(progressions, opts.progressions);
  if (ref) {
    progressions.verse = ref.verse;
    progressions.chorus = ref.chorus;
  }
  const riffHigh = rngYc.chance(formOdds((x) => x.form.chorusRiff));

  const rngForm = root.fork("form");
  const liftKey: Key = { tonic: mod12(key.tonic + 5), mode: "major" };
  const liftChance = rngForm.chance(formOdds((x) => x.liftEnding));
  const holdChance = rngYc.chance(formOdds((x) => x.form.holdEnding));
  const ending: SongEnding = opts.ending ?? (holdChance ? "hold" : liftChance ? "lift" : "fade");
  const sections = ref
    ? referenceSections(ref)
    : P.song.mixed
      ? planMerged(
          rngForm,
          key,
          liftKey,
          ending,
          progressions,
          P.song,
          g.voices,
          opts.form ?? "standard",
        )
      : genre.planner === "italo"
        ? planItalo(rngForm, key, liftKey, ending, progressions, g, opts.form ?? "standard")
        : genre.planner === "euro"
          ? planEuro(rngForm, key, liftKey, ending, progressions, g, opts.form ?? "standard")
          : planSections(
              rngForm,
              rngYc,
              key,
              liftKey,
              ending,
              progressions,
              g,
              opts.form ?? "standard",
              riffHigh,
            );
  if (!ref) addCounter(root.fork("counter"), sections, P.voice);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);

  const counter = generateCounter(root.fork("counter-line"), key, progressions.chorus);
  const leadRanges = P.voice.genre.leadRanges ?? LEAD_RANGES;
  const rngMotif = root.fork("motifs");
  const melodies: Record<MelodyKind, Melody> = {
    verse: generateMelody(root.fork("melody-verse"), key, progressions.verse, leadRanges.verse),
    chorus: generateMelody(root.fork("melody-chorus"), key, progressions.chorus, leadRanges.chorus),
  };

  return {
    seed: opts.seed,
    reference: opts.custom ? null : (opts.reference ?? null),
    spec: ref ?? null,
    title: ref?.title ?? genre.title(root.fork("title")),
    bpm,
    key,
    style,
    weights,
    genre: genreId,
    blends,
    kit,
    bassStyle,
    progressions,
    sections,
    totalBars,
    riff:
      g.voices.riff === "echo"
        ? generateEchoHook(rngMotif)
        : g.voices.riff === "pair"
          ? generatePair(rngMotif)
          : g.voices.riff === "unison"
            ? generateUnison(rngMotif)
            : generateRiff(rngMotif),
    riffHigh,
    hook: generateHook(rngMotif),
    arp: generateArp(rngMotif),
    sequence: generateSequence(root.fork("sequence")),
    melodies,
    sectionMelodies: sectionMelodies(
      root,
      sections,
      key,
      progressions,
      melodies,
      ref?.melodies,
      leadRanges,
    ),
    counter,
    sectionCounters: sectionCounters(root, sections, key, progressions.chorus, counter),
  };
}

// ── Form ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Gives a generated song TF's chorus counter-line: in every chorus, and the outro when it is a
 * chorus to fade, in about four TF-style songs out of five and one DS-style song in five. Its own
 * random stream, so adding it changed nothing else about any seed.
 */
function addCounter(rng: Rng, sections: Section[], voice: Profile): void {
  if (!rng.chance(voice.mix((x) => x.counter))) return;
  for (const s of sections) {
    if (s.kind === "chorus" || (s.kind === "outro" && s.layers.lead === "chorus"))
      s.layers.counter = true;
  }
}

/** The counter-line each section plays: the song's own over its chorus chords and key, otherwise
 * one written over the section's chords, shared by every section with the same chords and key. */
function sectionCounters(
  root: Rng,
  sections: readonly Section[],
  key: Key,
  chorus: Progression,
  counter: Melody,
): (Melody | null)[] {
  const written = new Map<string, Melody>();
  return sections.map((section) => {
    if (!section.layers.counter) return null;
    const progression = JSON.stringify(section.progression);
    const sameKey = section.key.tonic === key.tonic && section.key.mode === key.mode;
    if (sameKey && progression === JSON.stringify(chorus)) return counter;
    const id = `${section.key.tonic}${section.key.mode}|${progression}`;
    let line = written.get(id);
    if (!line) {
      line = generateCounter(root.fork(`counter-${id}`), section.key, section.progression);
      written.set(id, line);
    }
    return line;
  });
}

/**
 * The melody for each section with a lead. A section on the song's own verse or chorus progression
 * (and key) plays the song's melody for it; any other (a creator edit, a lifted outro) gets one
 * written over its own chords, shared by every section with the same kind, chords and key, so
 * repeats still repeat.
 */
function sectionMelodies(
  root: Rng,
  sections: readonly Section[],
  key: Key,
  progressions: Progressions,
  melodies: Record<MelodyKind, Melody>,
  custom: Record<string, CustomMelody> = {},
  ranges: Record<MelodyKind, readonly [number, number]> = LEAD_RANGES,
): (Melody | null)[] {
  const written = new Map<string, Melody>();
  return sections.map((section) => {
    const progression = JSON.stringify(section.progression);
    // The Night's lead synth: a line of its own, in sparse phrases.
    if (section.layers.leadSynth) {
      const id = `synth|${section.key.tonic}${section.key.mode}|${progression}`;
      let melody = written.get(id);
      if (!melody) {
        melody = sparsePhrases(
          generateMelody(
            root.fork(`melody-${id}`),
            section.key,
            section.progression,
            LEAD_SYNTH_RANGE,
          ),
        );
        written.set(id, melody);
      }
      return melody;
    }
    const kind = section.layers.lead;
    if (!kind) return null;
    const own = section.melody ? custom[section.melody] : undefined;
    if (own) return customMelody(own, section.key);
    // Self Control's title line: its own melody, between the verse's register and the chorus's.
    if (section.layers.titleLine) {
      const id = `title|${section.key.tonic}${section.key.mode}|${progression}`;
      let melody = written.get(id);
      if (!melody) {
        const range = [
          Math.round((ranges.verse[0] + ranges.chorus[0]) / 2),
          Math.round((ranges.verse[1] + ranges.chorus[1]) / 2),
        ] as const;
        melody = generateMelody(root.fork(`melody-${id}`), section.key, section.progression, range);
        written.set(id, melody);
      }
      return melody;
    }
    const sameKey = section.key.tonic === key.tonic && section.key.mode === key.mode;
    if (sameKey && progression === JSON.stringify(progressions[kind])) return melodies[kind];
    const id = `${kind}|${section.key.tonic}${section.key.mode}|${progression}`;
    let melody = written.get(id);
    if (!melody) {
      melody = generateMelody(
        root.fork(`melody-${id}`),
        section.key,
        section.progression,
        ranges[kind],
      );
      written.set(id, melody);
    }
    return melody;
  });
}

/** A custom melody as bars of notes in `key`. */
export function customMelody(melody: CustomMelody, key: Key): Melody {
  const bars: Note[][] = Array.from({ length: Math.max(1, melody.bars) }, () => []);
  // The nearest way from the melody's key to this one: −6 … +5 semitones.
  const shift = mod12(key.tonic - melody.tonic + 6) - 6;
  for (const n of melody.notes) {
    bars[n.bar % bars.length]?.push({
      step: n.step,
      dur: n.dur,
      midi: n.pitch + melody.tonic + shift,
      vel: n.vel,
    });
  }
  for (const bar of bars) bar.sort((a, b) => a.step - b.step);
  return { bars };
}

/** An original's measured form, laid out like a generated one: fills into verses and choruses,
 * a fade at the end. */
function referenceSections(ref: ReferenceSong): Section[] {
  let startBar = 0;
  return ref.sections.map((s, i) => {
    const next = ref.sections[i + 1];
    const layers = { ...LAYERS_OFF, ...s.layers };
    const section: Section = {
      kind: s.kind,
      label: s.label,
      bars: s.bars,
      progression: s.progression,
      key: s.key ?? ref.key,
      layers,
      startBar,
      fill:
        !!next &&
        layers.drums !== "off" &&
        (s.fill ?? (next.kind === "chorus" || next.kind === "verse")),
      fade: !next,
      ...(s.melody ? { melody: s.melody } : {}),
    };
    startBar += s.bars;
    return section;
  });
}

// ── Motifs ────────────────────────────────────────────────────────────────────────────────────

/** About half the steps carry a top note, mostly the tonic; never the downbeat, so the pedal
 * marks the bar. */
function generateSequence(rng: Rng): SequencePattern {
  const tops = Array.from({ length: 16 }, (_, step): 0 | 5 | 12 =>
    step === 0 || !rng.chance(0.5) ? 0 : rng.chance(0.3) ? 12 : 5,
  );
  return { tops };
}

/** One-beat rhythm cells ("x" = onset on that 16th). */
type Cell = string;

function cellsToOnsets(cells: readonly Cell[]): number[] {
  const onsets: number[] = [];
  cells.forEach((cell, beat) => {
    for (let i = 0; i < 4; i++) if (cell[i] === "x") onsets.push(beat * 4 + i);
  });
  return onsets;
}

function onsetsToNotes(
  onsets: readonly number[],
  length: number,
  maxDur: number,
  pitch: (i: number) => number,
): MotifNote[] {
  return onsets.map((step, i) => {
    const next = onsets[i + 1] ?? length;
    return {
      step,
      dur: Math.min(maxDur, next - step),
      idx: pitch(i),
      vel: step % 4 === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.7,
    };
  });
}

function walk(
  rng: Rng,
  count: number,
  start: number,
  lo: number,
  hi: number,
  moves: readonly (readonly [number, number])[],
): number[] {
  const out: number[] = [];
  let cur = start;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    let next = cur + rng.weighted(moves);
    if (next < lo || next > hi) next = cur - (next - cur);
    cur = Math.min(hi, Math.max(lo, next));
  }
  return out;
}

/** The synth riff: 2 bars, call-and-response; pitches index the current chord's tones. */
function generateRiff(rng: Rng): Motif {
  const cells: [Cell, number][] = [
    ["x.x.", 2],
    ["x..x", 2],
    ["..x.", 1],
    ["x.xx", 1],
    ["xx.x", 1],
    [".x.x", 1],
    ["x...", 1],
  ];
  const bar1 = [rng.weighted(cells), rng.weighted(cells), rng.weighted(cells), rng.weighted(cells)];
  const bar2 = [bar1[0], bar1[1], bar1[2], rng.weighted(cells)] as Cell[];
  const onsets = cellsToOnsets([...bar1, ...bar2]);
  const contour = walk(rng, onsets.length, rng.int(2, 4), 1, 6, [
    [1, 3],
    [-1, 3],
    [2, 1],
    [-2, 1],
    [0, 1],
  ]);
  return { bars: 2, notes: onsetsToNotes(onsets, 32, 3, (i) => contour[i] ?? 3) };
}

/**
 * Get Closer's hook (get-closer.md §10): short stepwise figures in D4–B4, played dry, that the riff's
 * dotted-8th echo spins out (a 3-note cell keeps cycling across the beat). 4 bars: a run of 4–8
 * 16ths down to a 3-note cell on beats 3–4 of bar 1, nothing in bar 2, a 4-note 16th figure on beat
 * 4 of bar 3, nothing in bar 4. Notes are 70% of a 16th, gated. `idx` counts scale steps
 * (arranger.ts plays it on a scale ladder from MIDI 62). Each song writes its own figures.
 *
 *   bar 1    3  e  &  a  4  e  &  a      bar 3    4  e  &  a
 *            x  x  x  x  x  x  x  x               x  x  x  x
 *            (a run down)   (cell: n, n+1, n)     (n, n+1, n+2, n)
 */
function generateEchoHook(rng: Rng): Motif {
  const notes: MotifNote[] = [];
  const push = (step: number, idx: number, vel: number) => notes.push({ step, dur: 0.7, idx, vel });
  const runLength = rng.pick([1, 2, 3, 5]);
  const cell = rng.int(1, 3);
  const top = cell + runLength;
  const runStart = 16 - 3 - runLength;
  for (let i = 0; i < runLength; i++) push(runStart + i, top - i, i === 0 ? 1 : 0.85);
  [cell, cell + 1, cell].forEach((idx, i) => push(13 + i, idx, i === 0 ? 0.95 : 0.85));
  const figure = rng.int(3, 5);
  [figure, figure + 1, figure + 2, figure].forEach((idx, i) =>
    push(32 + 12 + i, idx, i === 0 ? 1 : 0.85),
  );
  return { bars: 4, notes };
}

/**
 * The Night's intro riff (the-night.md §2, §7): two notes, the tonic and the 7th below it, in 16ths
 * in the first bar of two, silent in the second. `idx` 1 is the tonic, 0 the 7th (arranger.ts
 * `pairNotes`). Each song draws its own rhythm, in groups of four 16ths.
 */
function generatePair(rng: Rng): Motif {
  const groups = rng.pick([
    [0, 1, 2, 3],
    [0, 1, 2],
    [0, 2, 3],
    [1, 2, 3],
  ]);
  const notes: MotifNote[] = [];
  for (const g of groups) {
    for (let i = 0; i < 4; i++) {
      const step = g * 4 + i;
      notes.push({ step, dur: 0.9, idx: i % 2 === 0 ? 1 : 0, vel: i === 0 ? 1 : 0.8 });
    }
  }
  return { bars: 2, notes };
}

/**
 * Self Control's intro riff (branigan-self-control.md §4.1, §6), played by the riff and the bass in
 * unison: a 2-bar figure on the scale ladder from each chord's root. Every bar pushes the root on 1,
 * 1a and 2& (the record's signature syncopation), then steps to other scale tones around beats
 * 3–4, one of a few shapes per bar (the record's notes there vary from bar to bar).
 */
function generateUnison(rng: Rng): Motif {
  const tails: readonly (readonly [number, number][])[] = [
    [
      [10, 6],
      [12, 2],
      [15, 1],
    ],
    [
      [11, 0],
      [12, 2],
    ],
    [
      [10, 4],
      [12, 2],
    ],
    [
      [10, 2],
      [14, 4],
    ],
  ];
  const notes: MotifNote[] = [];
  for (let bar = 0; bar < 2; bar++) {
    const hits: [number, number][] = [[0, 0], [3, 0], [6, 0], ...rng.pick(tails)];
    hits.forEach(([step, idx], i) => {
      const next = hits[i + 1]?.[0] ?? 16;
      notes.push({
        step: bar * 16 + step,
        dur: Math.max(1, next - step) * 0.85,
        idx,
        vel: step % 4 === 0 ? 0.85 : 1,
      });
    });
  }
  return { bars: 2, notes };
}

/** Melodic high bass (Peter Hook style): 2 bars; pitches are scale steps above the chord root. */
function generateHook(rng: Rng): Motif {
  const cells: [Cell, number][] = [
    ["x.x.", 3],
    ["x.xx", 2],
    ["xx.x", 1],
    ["x...", 1],
    ["x..x", 1],
    ["..x.", 0.5],
  ];
  const bar1 = [rng.weighted(cells), rng.weighted(cells), rng.weighted(cells), rng.weighted(cells)];
  const bar2 = [bar1[0], bar1[1], rng.weighted(cells), rng.weighted(cells)] as Cell[];
  const onsets = cellsToOnsets([...bar1, ...bar2]);
  const contour = walk(rng, onsets.length, rng.pick([4, 7, 7, 9]), 0, 11, [
    [-1, 3],
    [1, 2],
    [-2, 1],
    [2, 1],
    [0, 1],
    [3, 0.5],
    [-3, 0.5],
  ]);
  return { bars: 2, notes: onsetsToNotes(onsets, 32, 4, (i) => contour[i] ?? 7) };
}

const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5],
  [0, 1, 2, 1, 3, 2, 4, 3],
  [4, 3, 2, 1, 2, 3, 4, 5],
  [0, 2, 4, 2, 1, 3, 5, 3],
];

function generateArp(rng: Rng): Motif {
  const pattern = rng.pick(ARP_PATTERNS);
  const notes: MotifNote[] = Array.from({ length: 16 }, (_, step) => ({
    step,
    dur: 1,
    idx: pattern[step % pattern.length] ?? 0,
    vel: step % 4 === 0 ? 0.9 : 0.6,
  }));
  return { bars: 1, notes };
}

// ── Lead melody ───────────────────────────────────────────────────────────────────────────────

/** The chord sounding at (bar, step) of a progression. */
export function chordAt(progression: Progression, bar: number, step: number): Chord {
  const chords = progression[bar % progression.length] ?? ["i"];
  const slot = chords.length > 1 && step >= 8 ? 1 : 0;
  return chord(chords[slot] ?? chords[0] ?? "i");
}

interface RhythmNote {
  /** 16ths from the start of the 4-bar phrase. */
  step: number;
  dur: number;
}

/** A sung 2-bar line: optional pickup rest, ~one note per beat, ends on a long note. */
function phraseRhythm(rng: Rng, offset: number): RhythmNote[] {
  const out: RhythmNote[] = [];
  let cursor = rng.pick([0, 0, 2, 4]);
  while (cursor < 22) {
    const dur = rng.weighted<number>([
      [2, 4],
      [3, 2],
      [4, 3],
      [6, 1],
      [1, 0.6],
    ]);
    out.push({ step: offset + cursor, dur });
    cursor += dur;
  }
  out.push({ step: offset + cursor, dur: Math.max(4, 30 - cursor) });
  return out;
}

/**
 * Diatonic, mostly stepwise, chord tones on strong beats, an arch per 2-bar phrase, phrase ends on a
 * long chord tone (docs/analysis.md §4). Bars 4–7 replay bars 0–3's rhythm and random choices over
 * their own chords, so the line repeats where the harmony repeats and adapts where it changes
 * (the DS verse's second line), then cadences on the root.
 */
export function generateMelody(
  rng: Rng,
  key: Key,
  progression: Progression,
  range: readonly [number, number],
): Melody {
  const call = phraseRhythm(rng, 0);
  // The answer reuses the call's first bar so the line has a recognisable shape.
  const answer = [
    ...call.filter((n) => n.step < 16).map((n) => ({ ...n, step: n.step + 32 })),
    ...phraseRhythm(rng, 32).filter((n) => n.step >= 48),
  ];
  const rhythm = [...call, ...answer].filter((n) => n.step < 64);
  const cadence = [
    ...rhythm.filter((n) => n.step < 48),
    ...phraseRhythm(rng.fork("cadence"), 32).filter((n) => n.step >= 48),
  ];

  const first = realise(rng.fork("walk"), key, progression, rhythm, range, 0, false);
  const second = realise(rng.fork("walk"), key, progression, cadence, range, 4, true);
  return { bars: [...splitBars(first), ...splitBars(second)] };
}

function realise(
  rng: Rng,
  key: Key,
  progression: Progression,
  rhythm: readonly RhythmNote[],
  [lo, hi]: readonly [number, number],
  barOffset: number,
  endOnRoot: boolean,
): (RhythmNote & { midi: number })[] {
  const out: (RhythmNote & { midi: number })[] = [];
  let prev: number | null = null;
  rhythm.forEach((n, i) => {
    const bar = barOffset + Math.floor(n.step / 16);
    const c = chordAt(progression, bar, n.step % 16);
    const tones = notesInRange(chordPitchClasses(key, c), lo, hi);
    const scale = notesInRange(scaleForChord(key, c), lo, hi);
    const phrasePos = (n.step % 32) / 32;
    const target = lo + (hi - lo) * (0.3 + 0.45 * Math.sin(Math.PI * phrasePos));
    const nextStep = rhythm[i + 1]?.step;
    const phraseEnd =
      nextStep === undefined || Math.floor(nextStep / 32) !== Math.floor(n.step / 32);
    const strong = n.step % 8 === 0 || n.dur >= 4;

    let midi: number;
    if (prev === null) {
      midi = closest(tones, target);
    } else if (phraseEnd) {
      const pool =
        endOnRoot && i === rhythm.length - 1
          ? tones.filter((t) => mod12(t - key.tonic - c.root) === 0)
          : tones;
      midi = closest(pool.length ? pool : tones, prev);
    } else if (strong) {
      const from = prev;
      const near = tones.filter((t) => Math.abs(t - from) <= 5);
      midi = near.length
        ? rng.weighted(near.map((t) => [t, 1 / (1 + Math.abs(t - target) / 3)] as const))
        : closest(tones, prev);
    } else {
      const idx = scale.indexOf(closest(scale, prev));
      const dir = rng.chance(0.7)
        ? Math.sign(target - prev) || 1
        : -(Math.sign(target - prev) || 1);
      const size = rng.weighted([
        [1, 0.72],
        [2, 0.22],
        [3, 0.06],
      ]);
      let j = idx + dir * size;
      if (j < 0 || j >= scale.length) j = idx - dir * size;
      midi = scale[Math.min(scale.length - 1, Math.max(0, j))] ?? prev;
    }
    out.push({ ...n, midi });
    prev = midi;
  });
  return out;
}

function closest(notes: readonly number[], target: number): number {
  let best = notes[0] ?? target;
  for (const n of notes) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
}

function splitBars(notes: readonly (RhythmNote & { midi: number })[]): Note[][] {
  const bars: Note[][] = [[], [], [], []];
  for (const n of notes) {
    const bar = bars[Math.floor(n.step / 16)];
    if (!bar) continue;
    bar.push({ step: n.step % 16, dur: n.dur, midi: n.midi, vel: n.step % 8 === 0 ? 0.9 : 0.78 });
  }
  return bars;
}

// ── Counter-line ──────────────────────────────────────────────────────────────────────────────

/**
 * A statement bar of the counter-line: a held note or two, with shorter notes around them (TF's
 * line holds 6–8 16ths and steps between the holds). [step, dur] pairs.
 */
const COUNTER_STATEMENTS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 6],
    [6, 2],
    [8, 6],
    [14, 2],
  ],
  [
    [0, 2],
    [2, 8],
    [10, 2],
    [12, 4],
  ],
  [
    [0, 8],
    [8, 4],
    [12, 4],
  ],
  [
    [2, 6],
    [8, 2],
    [10, 6],
  ],
  [
    [0, 4],
    [4, 8],
    [12, 2],
    [14, 2],
  ],
];
/** The bar answering it: mostly rest, then a held note or a short run back up. */
const COUNTER_ANSWERS: readonly (readonly [readonly (readonly [number, number])[], number])[] = [
  [[[4, 8]], 2],
  [
    [
      [4, 8],
      [14, 2],
    ],
    2,
  ],
  [
    [
      [8, 2],
      [10, 2],
      [12, 2],
      [14, 2],
    ],
    2,
  ],
  [
    [
      [6, 2],
      [8, 2],
      [10, 2],
      [12, 4],
    ],
    1.5,
  ],
  [[[12, 4]], 1],
];

/**
 * TF's chorus counter-line, written fresh for each song: a 4-bar call and response above the sung
 * melody (COUNTER_RANGE), one statement rhythm played twice, each answered differently, so it
 * loops with the chorus chords. Long notes land on chord tones (realise), the short ones step
 * between them. Bars 4–7 replay the same choices over their own chords, as the sung melody does.
 */
export function generateCounter(rng: Rng, key: Key, progression: Progression): Melody {
  const statement = rng.pick(COUNTER_STATEMENTS);
  const first = rng.weighted(COUNTER_ANSWERS);
  let second = rng.weighted(COUNTER_ANSWERS);
  if (second === first) second = rng.weighted(COUNTER_ANSWERS);
  const rhythm: RhythmNote[] = [statement, first, statement, second].flatMap((bar, i) =>
    bar.map(([step, dur]) => ({ step: i * 16 + step, dur })),
  );
  const half = (barOffset: number) =>
    splitBars(
      realise(rng.fork("walk"), key, progression, rhythm, COUNTER_RANGE, barOffset, false),
    ).map((bar) => bar.map((n) => ({ ...n, vel: n.dur >= 4 ? 0.85 : 0.7 })));
  return { bars: [...half(0), ...half(4)] };
}
