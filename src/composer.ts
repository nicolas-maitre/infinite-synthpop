/**
 * Turns a seed (plus a few settings) into a Song: the section plan, the progressions, and the
 * per-song motifs and melodies. Pure and deterministic; no audio here. See docs/analysis.md.
 */
import type { DrumHit, MelodicTrack } from "./arranger";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  genreAt,
  genreOfReference,
  randomWeights,
  referenceWeights,
  soloWeights,
  specWeights,
  styleOf,
  type Blend,
  type GenreAt,
  type GenreId,
} from "./genres";
import { mutate, pickProgression, type Progression, type ProgressionKind } from "./progressions";
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
  /** The genre whose profile the song was generated with. */
  genre: GenreId;
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
export const COUNTER_RANGE = [74, 86] as const;

export function compose(opts: ComposeOptions): Song {
  const ref = opts.custom ?? (opts.reference ? REFERENCES[opts.reference] : undefined);
  const root = createRng(opts.seed);
  // Its own stream, so an auto style draws nothing from the others.
  const autoStyle = Math.round(root.fork("style").next() * 100) / 100;
  // A creation plays in its own genre, an original in the one that lists it.
  const genreId = opts.custom
    ? (opts.custom.genre ?? DEFAULT_GENRE)
    : opts.reference
      ? genreOfReference(opts.reference)
      : opts.genre === "auto"
        ? root.fork("genre").pick(GENRE_IDS)
        : (opts.genre ?? DEFAULT_GENRE);
  const genre = GENRES[genreId];
  // The auto point draws from its own stream too.
  const rngPoint = root.fork("point");
  // With the genre picked per song, the point is too: weights given for one genre don't fit another.
  const weightsOpt =
    opts.genre === "auto" && !opts.custom && !opts.reference ? "auto" : opts.weights;
  const given =
    weightsOpt === "auto" ? randomWeights(genre, () => rngPoint.next()) : (weightsOpt ?? null);
  const style = ref
    ? ref.style
    : given
      ? styleOf(given)
      : Math.min(1, Math.max(0, opts.style ?? autoStyle));
  // An original plays with all the weight on itself; a creation with its own weights (or its
  // legacy style's).
  const weights = opts.custom
    ? specWeights(genre, opts.custom)
    : ref && opts.reference
      ? soloWeights(genre, opts.reference)
      : (given ?? referenceWeights(genre, style));
  const g = genreAt(genre, weights);
  const rngSetup = root.fork("setup");
  // You Came's choices draw from their own streams, so at its weight 0 a song is what it was.
  const rngMode = root.fork("mode");
  const rngYc = root.fork("you-came");
  const yc = (b: Blend) => rngYc.chance(g.at(b));

  // The minor tonic is drawn first either way, so the draws after it stay where they were.
  const autoKey = (): Key => {
    const tonic = rngSetup.weighted(genre.keyWeights);
    return rngMode.chance(g.at(genre.major))
      ? { tonic: rngMode.weighted(genre.majorKeyWeights), mode: "major" }
      : { tonic, mode: "minor" };
  };
  const key: Key = ref?.key ?? opts.key ?? autoKey();
  const [rangeLo, bpmHi] = genre.tempo.range;
  // A reference may take the range below its usual floor (Self Control): the grid only reaches
  // down there with its weight, so the others' tempos draw as they did.
  const floor = genre.tempo.floor;
  const bpmLo = floor ? Math.max(rangeLo, Math.floor(g.at(floor) * 2) / 2) : rangeLo;
  const autoBpm = rngSetup.weighted(
    Array.from({ length: (bpmHi - bpmLo) * 2 + 1 }, (_, i) => {
      const bpm = bpmLo + i / 2;
      return [bpm, Math.exp(-((bpm - g.at(genre.tempo.center)) ** 2) / 3)] as const;
    }),
  );
  const bpm = ref?.bpm ?? opts.bpm ?? autoBpm;
  const autoKit = rngSetup.weighted<KitName>(genre.kits.map(([kit, w]) => [kit, g.at(w)]));
  const kit = ref?.kit ?? (!opts.kit || opts.kit === "auto" ? autoKit : opts.kit);
  const pickedBass = rngSetup.weighted<BassStyle>(
    genre.bassFigures.map(([figure, w]) => [figure, g.at(w)] as const).filter(([, w]) => w > 0),
  );
  const bassStyle = ref?.bassStyle ?? opts.bassStyle ?? pickedBass;

  const rngProg = root.fork("progressions");
  const prog = (kind: ProgressionKind, rng = rngProg) =>
    mutate(
      genre,
      pickProgression(genre, kind, style, rng, { mode: key.mode, weights }),
      kind,
      weights,
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
  if (key.mode === "major" || g.at(genre.form.preChorus) > 0)
    progressions.prechorus = prog("prechorus", root.fork("prechorus"));
  // You Came's verse is its chorus loop.
  if (yc(genre.form.verseOnLoop)) progressions.verse = progressions.chorus;
  Object.assign(progressions, opts.progressions);
  if (ref) {
    progressions.verse = ref.verse;
    progressions.chorus = ref.chorus;
  }
  const riffHigh = yc(genre.form.chorusRiff);

  const rngForm = root.fork("form");
  const liftKey: Key = { tonic: mod12(key.tonic + 5), mode: "major" };
  const liftChance = rngForm.chance(g.at(genre.liftEnding));
  const holdChance = yc(genre.form.holdEnding);
  const ending: SongEnding = opts.ending ?? (holdChance ? "hold" : liftChance ? "lift" : "fade");
  const sections = ref
    ? referenceSections(ref)
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
  if (!ref) addCounter(root.fork("counter"), sections, g);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);

  const counter = generateCounter(root.fork("counter-line"), key, progressions.chorus);
  const leadRanges = genre.leadRanges ?? LEAD_RANGES;
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

const LAYERS_OFF: Layers = {
  drums: "off",
  bass: false,
  hook: false,
  pad: false,
  riff: false,
  arp: false,
  stabs: false,
  seq: false,
  bassShort: false,
  guitar: false,
  lead: null,
  leadDouble: false,
  leadStack: false,
  counter: false,
};

/** A progression over `bars` bars whose last bar turns to the tonic halfway, pushed into what
 * follows (You Came's verse into its pre-chorus). */
function intoTonic(prog: Progression, bars: number, tonic: string): Progression {
  const out = Array.from({ length: bars }, (_, i) => prog[i % prog.length] ?? [tonic]);
  out[bars - 1] = [out[bars - 1]?.[0] ?? tonic, tonic];
  return out;
}

function planSections(
  rng: Rng,
  rngYc: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
  chorusRiff: boolean,
): Section[] {
  const plan: PlannedSection[] = [];
  const add = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey = key,
  ) =>
    plan.push({
      kind,
      label,
      bars,
      progression,
      key: sectionKey,
      layers: { ...LAYERS_OFF, ...layers },
    });

  const odds = g.genre.form;
  const chance = (b: Blend) => rng.chance(g.at(b));
  const tonic = key.mode === "major" ? "I" : "i";
  // You Came's blocks (analysis §7.2), decided up front from their own stream.
  const yc = (b: Blend) => rngYc.chance(g.at(b));
  const preChorus = yc(odds.preChorus) && !!p.prechorus;
  const stack = yc(odds.stack);
  const straightOn = yc(odds.straightOn);
  const breakdown = yc(odds.breakdown);
  const instrumental16 = yc(odds.instrumental16);
  const stabs = () => chance(odds.stabs);
  // TF's sequenced chord synth plays the figure from the intro to the end of the song.
  // TF's high sequencer comes in after the first chorus and plays to the end (MIDI: bar 46 on).
  const useSeq = chance(odds.seq);
  // TF's rhythm guitar: choruses, instrumentals and the outro (MIDI: never in the verses).
  const guitar = chance(odds.guitar);
  let seq = false;
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, 8, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: rng.chance(0.5),
      stabs: stabs(),
      seq,
      guitar,
      ...(stack ? { leadStack: true } : {}),
      ...(chorusRiff ? { riff: true } : {}),
      ...extra,
    });
  // You Came: the verse turns to the tonic in its last bar, pushed into the pre-chorus.
  const verse = (label: string, bars: number, extra: Partial<Layers> = {}) => {
    add("verse", label, bars, preChorus ? intoTonic(p.verse, bars, tonic) : p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      seq,
      ...extra,
    });
    if (preChorus && p.prechorus) {
      add("prechorus", "Pre-chorus", Math.min(8, p.prechorus.length), p.prechorus, {
        drums: "full",
        bass: true,
        pad: true,
        arp: true,
        lead: "verse",
        seq,
      });
    }
  };
  // DS: interlude, the Dorian ii–IV turnaround, then a 2-bar break on the tonic.
  const dsBlock = () => {
    add("interlude", "Interlude", 8, p.interlude, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      hook: chance(odds.interludeHook),
      arp: rng.chance(0.5),
    });
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      arp: true,
    });
    if (rng.chance(0.7)) {
      add("break", "Break", 2, [[tonic]], { drums: "kick", riff: true, pad: true });
    }
  };
  // TF: the band plays the chorus chords instrumentally, riff and melodic bass on top.
  // TF's way into a verse (MIDI bars 45–46): two staccato bars on VI–VII, the second resting until
  // the bass's pickup run (see bassLine).
  const tfTurn = () => {
    if (!chance(odds.turn)) return;
    add("turnaround", "Turn · VI–VII", 2, [["VI"], ["VII"]], {
      drums: "full",
      bass: true,
      bassShort: true,
      pad: true,
      seq,
      guitar,
    });
  };
  // The melodic bass (Peter Hook's part) never plays under a verse: in the TF MIDI it's in the
  // intro, the bridge solo, the instrumentals and the outro only, and DS has none.
  const tfInstrumental = (label: string, bars: number) =>
    add("interlude", label, bars, p.chorus, {
      drums: "full",
      bass: true,
      seq,
      guitar,
      pad: true,
      riff: true,
      hook: chance(odds.instrumentalHook),
    });

  // Both songs open with drums + bass, then an instrumental over the chorus chords.
  add("intro", "Intro", 4, p.chorus, {
    drums: chance(odds.introGroove) ? "groove" : chance(odds.introKick) ? "kick" : "full",
    bass: true,
    hook: chance(odds.introHook),
  });
  add("intro", "Intro · riff", rng.pick([8, 8, 12]), p.chorus, {
    drums: "full",
    bass: true,
    pad: true,
    riff: true,
    hook: chance(odds.riffIntroHook),
    arp: chance(odds.riffIntroArp),
  });
  const verseBars = form === "short" ? 8 : rng.chance(0.8) ? 16 : 8;
  verse("Verse 1", verseBars);
  chorus("Chorus");
  seq = useSeq;
  if (straightOn) {
    // You Came: straight on to verse 2.
  } else if (chance(odds.dsBlock)) dsBlock();
  else {
    tfInstrumental("Instrumental", 8);
    tfTurn();
  }
  verse("Verse 2", verseBars === 16 && rng.chance(0.5) ? 16 : 8);
  chorus("Chorus", { arp: true });
  if (form === "short") {
    // Straight on to the final choruses.
  } else if (breakdown) {
    // You Came (2:22): a breakdown verse over the loop's first two chords with no bass and no
    // snare, then a 4-bar bridge into the last choruses.
    add("verse", "Breakdown", 8, p.chorus.slice(0, 2), {
      drums: "breakdown",
      pad: true,
      lead: "verse",
    });
    add("bridge", "Bridge", 4, p.bridge, { drums: "breakdown", pad: true, lead: "verse" });
  } else if (chance(odds.dsBlock)) {
    dsBlock();
  } else {
    // TF: a turnaround on VI, the i–IV vamp with the melodic-bass solo, an instrumental chorus.
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
    });
    add("bridge", "Bridge · bass solo", 8, p.bridge, {
      drums: "full",
      bass: true,
      pad: true,
      hook: true,
    });
    tfInstrumental("Instrumental chorus", 8);
  }
  if (form === "long" || (form === "standard" && chance(odds.thirdVerse))) {
    tfTurn();
    verse("Verse 3", rng.chance(0.5) ? 16 : 8);
  }
  chorus("Chorus");
  if (instrumental16) {
    // You Came (3:18): a break without bass or voice, then an instrumental, both on 16th hats,
    // the riff joining for its second half.
    add("break", "Break", 8, p.chorus.slice(0, 2), { drums: "hats16", pad: true });
    add("interlude", "Instrumental", 8, p.chorus, { drums: "hats16", bass: true, pad: true });
    add("interlude", "Instrumental · riff", 8, p.chorus, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
    });
  }
  chorus("Chorus · double", { leadDouble: true, arp: true });
  if (form === "long" || (form === "standard" && chance(odds.extraChorus)))
    chorus("Chorus", { leadDouble: true });
  if (ending === "hold") {
    // You Came (4:23): the loop's IV held to the end.
    add("outro", "Ending · IV held", 4, [["IV"]], { pad: true, riff: chorusRiff });
  } else if (ending === "lift") {
    // TF: the chorus's IV becomes the new tonic.
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      {
        drums: "full",
        bass: true,
        bassShort: guitar,
        pad: true,
        riff: true,
        hook: true,
        guitar,
        seq,
      },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", 16, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      guitar,
      lead: "chorus",
      riff: rng.chance(0.5),
      arp: true,
    });
  }

  return placeSections(plan, rng);
}

type PlannedSection = Omit<Section, "startBar" | "fill" | "fade">;

/** Lays planned sections end to end: a fill before each verse and chorus (and half the others),
 * and a fade on the last. */
function placeSections(plan: readonly PlannedSection[], rng: Rng): Section[] {
  let startBar = 0;
  return plan.map((s, i) => {
    const next = plan[i + 1];
    const fill =
      !!next &&
      s.layers.drums !== "off" &&
      (next.kind === "chorus" || next.kind === "verse" || rng.chance(0.5));
    const section: Section = { ...s, startBar, fill, fade: !next };
    startBar += s.bars;
    return section;
  });
}

/**
 * The Italo form (docs/plans/italo-genre.md), in 16-bar blocks (8 in a short song):
 * - an opening, one of three: The Night's tonic pedal (i │ ♭VII/i with the arpeggio, then the riff
 *   alone), Faces' build (bass and kick, then gated stabs, then the groove), or Get Closer's
 *   instrumental hook on the verse loop;
 * - verse and chorus; the first verse may run without bass (Faces);
 * - an 8-bar instrumental after the first chorus (Faces; Get Closer's hook reprise);
 * - a second verse, or The Night's instrumental with the lead synth in its place;
 * - a second chorus; then The Night's reprise (the pedal block, a short verse, a chorus) or, in a
 *   long song, a third verse and chorus;
 * - a breakdown without bass or voice and an instrumental with the lead synth (Faces, Get
 *   Closer's 12″);
 * - a last chorus, and the chorus to fade all three records end on.
 * Self Control's devices (branigan-self-control.md §2.1) draw from their own random stream, so at
 * its weight 0 a song is what it was: its opening (pad on i7, then the riff and the bass in unison
 * on i–v), a pre-chorus with the title line before the first chorus, a 4-bar break after each
 * chorus (one stab on beat 2, the voice) with 2 bars of drums and voice after the first, a
 * half-length second verse, stacked voices in the choruses, and an i–v vamp to fade in place of the
 * last chorus, the riff back for its second half.
 * The kick never stops: every section has the drums.
 */
function planItalo(
  rng: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
): Section[] {
  const odds = g.genre.italo;
  if (!odds) throw new Error(`${g.genre.id} has no Italo form odds`);
  const plan: PlannedSection[] = [];
  const add = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey = key,
  ) =>
    plan.push({
      kind,
      label,
      bars,
      progression,
      key: sectionKey,
      layers: { ...LAYERS_OFF, ...layers },
    });
  const chance = (b: Blend) => rng.chance(g.at(b));
  const short = form === "short";
  const block = short ? 8 : 16;
  const tonic = key.mode === "major" ? "I" : "i";
  const pedal: Progression = [[tonic], ["VII/i"]];
  const vamp: Progression = [[tonic], [key.mode === "major" ? "V" : "v"]];
  // Self Control's choices.
  const rngSc = rng.fork("self-control");
  const scChance = (b: Blend) => rngSc.chance(g.at(b));
  const preChorus = scChance(odds.preChorus);
  const stabBreak = scChance(odds.stabBreak);
  const halfVerse = scChance(odds.halfVerse);
  const backing = scChance(odds.backing);
  const vampOutro = ending === "fade" && scChance(odds.vampOutro);

  const openings = (
    [
      ["pedal", g.at(odds.pedalIntro)],
      ["build", g.at(odds.buildIntro)],
      ["hook", g.at(odds.hookIntro)],
      ["riff", g.at(odds.riffIntro)],
    ] as const
  ).filter(([, w]) => w > 0);
  const opening = openings.length ? rng.weighted(openings) : "hook";
  const stabs = chance(odds.stabs);
  const verseArp = chance(odds.verseArp);
  const bareFirstVerse = chance(odds.bareFirstVerse);
  const afterChorus = !short && chance(odds.afterChorus);
  const leadSection = chance(odds.leadSection);
  const reprise = !short && chance(odds.reprise);
  const breakdown = !short && chance(odds.breakdown);

  // The Night's opening (bars 1–6, again at 87–96): pads on the pedal, then the riff alone without
  // pads, then the riff again with the bass dropped out.
  const pedalBlock = (label: string) => {
    add("intro", label, 4, pedal, { drums: "full", bass: true, pad: true });
    add("intro", "Intro · riff", 4, pedal, { drums: "full", bass: true, riff: true });
    add("intro", "Intro · bass drop", 2, pedal, { drums: "full", riff: true });
  };
  // The Night's lead synth: 12 bars over the verse loop after each intro block, before the voice.
  const leadSynth = (label: string, bars: number) =>
    add("interlude", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      leadSynth: true,
    });
  // The Night's plucked countervoice plays in every chorus and nowhere else.
  const countervoice = g.voices.countervoice !== "none";
  // Faces' verse world: stabs instead of pads, which the chorus brings in. Self Control's verse
  // line plays over the pads.
  const glockLine = g.voices.stabPatch === "glockenspiel";
  const verseWorld: Partial<Layers> = stabs && !glockLine ? { pad: false, held: true } : {};
  const verse = (label: string, bars: number, extra: Partial<Layers> = {}) =>
    add("verse", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      arp: verseArp,
      stabs,
      ...verseWorld,
      ...extra,
    });
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, block, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      stabs,
      // No 16th part in any of the three records' choruses: their motion is the countervoice's.
      arp: false,
      counter: countervoice,
      ...(backing ? { leadStack: true } : {}),
      ...extra,
    });
  // Self Control's break: the voice over one reverbed stab on beat 2 of each bar; after the first
  // chorus, 2 bars of the kit and the voice.
  const breakBlock = (first: boolean) => {
    add("break", "Break · stab on 2", 4, vamp, {
      drums: "stab",
      bass: true,
      stabs: true,
      lead: "chorus",
    });
    if (first) add("break", "Drums and voice", 2, vamp, { drums: "full", lead: "chorus" });
  };
  // Faces' instrumentals keep the verse world, its sustained line on top; the others play the
  // riff (Get Closer's 16th line).
  const instrumental = (label: string, bars: number) =>
    add("interlude", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      riff: !stabs,
      arp: !stabs,
      stabs,
      ...verseWorld,
    });

  // After the pedal block, The Night's lead synth (bars 7–22), else 4 bars of the loop.
  const afterPedal = () => {
    if (leadSection) leadSynth("Lead synth", short ? 8 : 12);
    else add("intro", "Intro · loop", 4, p.verse, { drums: "full", bass: true, pad: true });
  };
  if (opening === "pedal") {
    pedalBlock("Intro · pedal");
    afterPedal();
  } else if (opening === "build") {
    add("intro", "Intro · bass and kick", 4, p.verse, { drums: "kick", bass: true });
    add("intro", "Intro · stabs", 8, p.verse, { drums: "kick", bass: true, stabs: true });
    add("intro", "Intro · groove", short ? 8 : 16, p.verse, {
      drums: "full",
      bass: true,
      stabs: true,
      held: true,
    });
  } else if (opening === "riff") {
    // Self Control: a pad on i7 over the percussion, then the riff in unison with the bass.
    add("intro", "Intro · pad", 4, [[key.mode === "major" ? "I" : "i7"]], {
      drums: "half",
      pad: true,
    });
    add("intro", "Intro · riff", 4, vamp, { drums: "full", bass: true, riff: true });
  } else {
    // Get Closer: 8 bars of drums, bass and pads, then the hook with its 16th line.
    add("intro", "Intro", short ? 4 : 8, p.verse, { drums: "full", bass: true, pad: true });
    add("intro", "Hook", block, p.verse, { drums: "full", bass: true, pad: true, riff: true });
  }
  verse("Verse 1", block, bareFirstVerse ? { bassHeld: true } : {});
  if (preChorus) {
    add("prechorus", "Pre-chorus · title line", block, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      titleLine: true,
      // Its 16ths in pairs (branigan-self-control.md §12).
      arp: true,
      stabs,
      ...verseWorld,
    });
  }
  chorus("Chorus");
  if (stabBreak) breakBlock(true);
  if (afterChorus) instrumental("Instrumental", 8);
  verse("Verse 2", halfVerse ? block / 2 : block);
  chorus("Chorus");
  if (reprise) {
    // The Night's second half: the pedal block and the lead synth again, a verse, a chorus.
    pedalBlock("Reprise · pedal");
    afterPedal();
    verse("Verse 3", block);
    chorus("Chorus");
  } else if (form === "long") {
    verse("Verse 3", block);
    chorus("Chorus");
  }
  if (breakdown) {
    add("break", "Breakdown", 16, p.interlude, { drums: "full", pad: true, arp: true });
    instrumental("Instrumental", rng.pick([8, 16]));
  }
  // Self Control fades on the i–v vamp straight after its second chorus and break; after a
  // breakdown the song still needs its last chorus.
  if (!vampOutro || breakdown) chorus("Chorus · last", { leadDouble: true });
  if (vampOutro) {
    if (stabBreak) breakBlock(false);
    // The riff comes back for the vamp's second half (branigan-self-control.md §12).
    const outro = (label: string, riff: boolean) =>
      add("outro", label, 8, vamp, {
        drums: "big",
        bass: true,
        pad: true,
        stabs,
        riff,
        lead: "chorus",
        counter: countervoice,
      });
    outro("Outro · i–v vamp", false);
    outro("Outro · vamp and riff", true);
  } else if (ending === "hold") {
    add("outro", "Ending · IV held", 4, [["IV"]], { pad: true });
  } else if (ending === "lift") {
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      { drums: "full", bass: true, pad: true, riff: true, arp: true },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", 16, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      stabs,
      // A chorus to fade: the countervoice carries on to the end (Get Closer's outro).
      counter: countervoice,
    });
  }
  return placeSections(plan, rng);
}

/**
 * The Euro-disco form (docs/plans/euro-disco-genre.md), from the three Sandra records:
 * - an opening, one of three: Crazy Juliet's staggered entries over the verse chords (pads and the
 *   sequence, then 16th hats and the bass, then the kit without the bass), Heaven Can Wait's solo
 *   synth motif then 4 bars of drums and bass alone, or Innocent Love's pads on i and v over 16th
 *   hats (no kick, no bass), then ♭VI–♭VII, then the bass alone;
 * - verse (16 or 8 bars; Heaven Can Wait's bare), pre-chorus (its progression's length, ending on a
 *   stop bar for Innocent Love and Crazy Juliet), chorus (its progression's length: 10 or 14 bars),
 *   then a 2-bar tag on i (Heaven Can Wait) or a 2-bar stop on ♭VII (Innocent Love);
 * - the second verse, pre-chorus and chorus;
 * - the second half, one of three: a chorus and two instrumental choruses with the lead synth
 *   (Crazy Juliet); an instrumental chorus ending in a 2-bar break on V without bass (Heaven Can
 *   Wait); or a 4-bar link with the kick on every beat, a verse without voice and the pre-chorus
 *   (Innocent Love), who may add a chorus and a 10-bar bridge;
 * - choruses back to back, and the chorus to fade all three records end on.
 */
function planEuro(
  rng: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
): Section[] {
  const odds = g.genre.euro;
  if (!odds) throw new Error(`${g.genre.id} has no Euro-disco form odds`);
  const plan: PlannedSection[] = [];
  const add = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey = key,
  ) =>
    plan.push({
      kind,
      label,
      bars,
      progression,
      key: sectionKey,
      layers: { ...LAYERS_OFF, ...layers },
    });
  const chance = (b: Blend) => rng.chance(g.at(b));
  /** One of several options, in proportion to their blends (the fallback when all are 0). */
  const pickOne = <T extends string>(options: readonly (readonly [T, Blend])[], fallback: T): T => {
    const weighted = options.map(([k, b]) => [k, g.at(b)] as const).filter(([, w]) => w > 0);
    return weighted.length ? rng.weighted(weighted) : fallback;
  };
  const short = form === "short";
  const major = key.mode === "major";
  const tonic = major ? "I" : "i";
  /** `bars` bars of a progression from bar `from`, round and round. */
  const slice = (prog: Progression, from: number, bars: number): Progression =>
    Array.from({ length: bars }, (_, i) => prog[(from + i) % prog.length] ?? [tonic]);

  const opening = pickOne(
    [
      ["staggered", odds.staggeredIntro],
      ["motif", odds.motifIntro],
      ["pads", odds.padIntro],
    ],
    "pads",
  );
  const verseBars = short ? 8 : chance(odds.longVerse) ? 16 : 8;
  const bare = chance(odds.bareVerse);
  const stop = chance(odds.stop);
  const afterFirst = pickOne(
    [
      ["tag", odds.tag],
      ["stop", odds.chorusStop],
      ["straight", odds.straight],
    ],
    "straight",
  );
  const secondHalf = pickOne(
    [
      ["lead", odds.leadChoruses],
      ["instrumental", odds.instrumentalChorus],
      ["block", odds.instrumentalBlock],
    ],
    "instrumental",
  );
  const bridge = !short && chance(odds.bridge);
  const verseArp = chance(odds.verseArp);
  const chorusArp = chance(odds.chorusArp);
  const chorusRiff = chance(odds.chorusRiff);
  const stabs = chance(odds.stabs);
  const stack = chance(odds.stack);
  const pre: Progression =
    p.prechorus ?? (major ? [["IV"], ["IV"], ["V"], ["V"]] : [["iv"], ["VI"], ["VII"], ["V"]]);
  // A chorus lasts as long as its progression: Crazy Juliet's 10 bars, the others' 14.
  const chorusBars = Math.min(16, Math.max(8, p.chorus.length));

  const verse = (label: string, extra: Partial<Layers> = {}) =>
    add("verse", label, verseBars, p.verse, {
      drums: "full",
      bass: true,
      pad: !bare,
      lead: "verse",
      arp: verseArp,
      ...extra,
    });
  // Pads come in (Heaven Can Wait's verse has none), and a 16th part where the song has one.
  const preChorus = (extra: Partial<Layers> = {}) =>
    add("prechorus", "Pre-chorus", Math.min(8, Math.max(2, pre.length)), pre, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      arp: verseArp || chorusArp,
      ...(stop ? { stop: true } : {}),
      ...extra,
    });
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, chorusBars, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: chorusArp,
      riff: chorusRiff,
      stabs,
      ...(stack ? { leadStack: true } : {}),
      ...extra,
    });
  // Heaven Can Wait's tag keeps the chorus kit on i, the voice gone; Innocent Love's stop holds
  // ♭VII over a hat on the beats, without bass.
  const afterChorus = (which: typeof afterFirst) => {
    if (which === "tag")
      add("chorus", "Tag", 2, [[tonic]], { drums: "big", bass: true, pad: true, arp: chorusArp });
    else if (which === "stop") add("break", "Stop", 2, [["VII"]], { drums: "half", pad: true });
  };

  if (opening === "staggered") {
    add("intro", "Intro", 4, slice(p.verse, 0, 4), { pad: true, riff: true });
    add("intro", "Intro · hats and bass", 2, slice(p.verse, 4, 2), {
      drums: "hats16",
      bass: true,
      pad: true,
      riff: true,
    });
    add("intro", "Intro · kit", 2, slice(p.verse, 6, 2), { drums: "full", pad: true, riff: true });
  } else if (opening === "motif") {
    add("intro", "Intro · motif", 4, [[tonic]], { riff: true });
    add("intro", "Groove", 4, p.verse, { drums: "full", bass: true });
  } else {
    add("intro", "Intro", short ? 4 : 8, [[tonic], [tonic], ["v"], ["v"]], {
      drums: "hats16",
      pad: true,
      arp: true,
    });
    add("intro", "Intro · climb", 4, [["VI"], ["VII"]], { drums: "hats16", pad: true, arp: true });
    add("intro", "Link", 2, [[tonic], ["VII"]], { bass: true });
  }
  verse("Verse 1");
  preChorus();
  chorus("Chorus");
  afterChorus(afterFirst);
  verse("Verse 2");
  preChorus();
  chorus("Chorus");
  if (afterFirst === "stop") afterChorus("stop");
  if (!short) {
    if (secondHalf === "lead") {
      chorus("Chorus");
      for (let i = 0; i < 2; i++)
        chorus("Instrumental chorus", { lead: null, leadStack: false, leadSynth: true });
    } else if (secondHalf === "instrumental") {
      add("chorus", "Instrumental chorus", Math.max(4, chorusBars - 2), p.chorus, {
        drums: "big",
        bass: true,
        pad: true,
        arp: true,
        stabs,
      });
      add("break", "Break", 2, [["V"], ["V"]], { drums: "full", pad: true });
    } else {
      add("interlude", "Instrumental link", 4, slice(p.verse, 0, 4), {
        drums: "groove",
        bass: true,
        pad: true,
        leadSynth: true,
      });
      verse("Instrumental verse", { lead: null, leadSynth: true });
      preChorus({ lead: null });
    }
    if (bridge) {
      chorus("Chorus");
      add("bridge", "Bridge", Math.min(16, p.bridge.length), p.bridge, {
        drums: "big",
        bass: true,
        pad: true,
        lead: "chorus",
        stabs,
        ...(stack ? { leadStack: true } : {}),
        ...(stop ? { stop: true } : {}),
      });
    }
    if (form === "long") chorus("Chorus");
  }
  chorus("Chorus · last");
  if (ending === "hold") {
    add("outro", "Ending · IV held", 4, [["IV"]], { pad: true });
  } else if (ending === "lift") {
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      { drums: "full", bass: true, pad: true, riff: true, arp: true },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", chorusBars, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: chorusArp,
      riff: chorusRiff,
      stabs,
      ...(stack ? { leadStack: true } : {}),
    });
  }
  return placeSections(plan, rng);
}

/**
 * Gives a generated song TF's chorus counter-line: in every chorus, and the outro when it is a
 * chorus to fade, in about four TF-style songs out of five and one DS-style song in five. Its own
 * random stream, so adding it changed nothing else about any seed.
 */
function addCounter(rng: Rng, sections: Section[], g: GenreAt): void {
  if (!rng.chance(g.at(g.genre.counter))) return;
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
