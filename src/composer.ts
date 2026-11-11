/**
 * Turns a seed (plus a few settings) into a Song: the section plan, the progressions, and the
 * per-song motifs and melodies. Pure and deterministic; no audio here. See docs/analysis.md.
 */
import type { DrumHit, MelodicTrack } from "./arranger";
import {
  DEFAULT_GENRE,
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
 * 16th hats whatever the song's hat pattern (You Came's break and instrumental). */
export type DrumMode = "off" | "kick" | "half" | "full" | "big" | "groove" | "breakdown" | "hats16";
export type KitName = "sp12" | "linndrum" | "dmx" | "synth";
/** "ds" and "tf" play the songs' signature bass figure (arranger.ts `figure`), in DS's
 * articulation (16th pickups, approach notes) or TF's (dotted 8ths). "yc" is You Came's root 8ths
 * with a same-note 16th on 4a (arranger.ts `ycBassLine`). */
export type BassStyle = "ds" | "tf" | "yc";
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
  /** The genre profile to generate with (genres.ts); synthpop by default. A creation plays in its
   * own genre and an original in the one that lists it, whatever this says. */
  genre?: GenreId;
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
      : (opts.genre ?? DEFAULT_GENRE);
  const genre = GENRES[genreId];
  // The auto point draws from its own stream too.
  const rngPoint = root.fork("point");
  const given =
    opts.weights === "auto" ? randomWeights(genre, () => rngPoint.next()) : (opts.weights ?? null);
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
  const [bpmLo, bpmHi] = genre.tempo.range;
  const autoBpm = rngSetup.weighted(
    Array.from({ length: (bpmHi - bpmLo) * 2 + 1 }, (_, i) => {
      const bpm = bpmLo + i / 2;
      return [bpm, Math.exp(-((bpm - genre.tempo.center) ** 2) / 3)] as const;
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
  const rngMotif = root.fork("motifs");
  const melodies: Record<MelodyKind, Melody> = {
    verse: generateMelody(root.fork("melody-verse"), key, progressions.verse, LEAD_RANGES.verse),
    chorus: generateMelody(
      root.fork("melody-chorus"),
      key,
      progressions.chorus,
      LEAD_RANGES.chorus,
    ),
  };

  return {
    seed: opts.seed,
    reference: opts.custom ? null : (opts.reference ?? null),
    spec: ref ?? null,
    title: ref?.title ?? generateTitle(root.fork("title")),
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
    riff: generateRiff(rngMotif),
    riffHigh,
    hook: generateHook(rngMotif),
    arp: generateArp(rngMotif),
    sequence: generateSequence(root.fork("sequence")),
    melodies,
    sectionMelodies: sectionMelodies(root, sections, key, progressions, melodies, ref?.melodies),
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
  const plan: Omit<Section, "startBar" | "fill" | "fade">[] = [];
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
): (Melody | null)[] {
  const written = new Map<string, Melody>();
  return sections.map((section) => {
    const kind = section.layers.lead;
    if (!kind) return null;
    const own = section.melody ? custom[section.melody] : undefined;
    if (own) return customMelody(own, section.key);
    const progression = JSON.stringify(section.progression);
    const sameKey = section.key.tonic === key.tonic && section.key.mode === key.mode;
    if (sameKey && progression === JSON.stringify(progressions[kind])) return melodies[kind];
    const id = `${kind}|${section.key.tonic}${section.key.mode}|${progression}`;
    let melody = written.get(id);
    if (!melody) {
      melody = generateMelody(
        root.fork(`melody-${id}`),
        section.key,
        section.progression,
        LEAD_RANGES[kind],
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

// ── Titles ────────────────────────────────────────────────────────────────────────────────────

const ADJECTIVES = [
  "Electric",
  "Silent",
  "Blue",
  "Cold",
  "Broken",
  "Neon",
  "Distant",
  "Restless",
  "Endless",
  "Paper",
  "Velvet",
  "Crystal",
  "Hollow",
  "Northern",
  "Midnight",
  "Secret",
  "Fragile",
  "Burning",
  "Perfect",
];
const NOUNS = [
  "Machine",
  "Promise",
  "Signal",
  "Confession",
  "Weather",
  "Station",
  "Kingdom",
  "Mirror",
  "Fever",
  "Shadow",
  "Summer",
  "Distance",
  "Heaven",
  "Motion",
  "Language",
  "Ritual",
  "Harbour",
  "Empire",
];
const ELEMENTS = [
  "Glass",
  "Rain",
  "Steel",
  "Smoke",
  "Gold",
  "Ice",
  "Fire",
  "Light",
  "Dust",
  "Silence",
  "Thunder",
  "Wire",
  "Static",
  "Chrome",
];
const PLACES = ["World", "City", "Age", "Land", "Night", "House", "Sea"];

function generateTitle(rng: Rng): string {
  const pattern = rng.int(0, 3);
  let title: string;
  if (pattern === 0) title = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 1) title = `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 2) {
    const a = rng.pick(ELEMENTS);
    let b = rng.pick(ELEMENTS);
    if (b === a) b = rng.pick(ELEMENTS);
    title = `${rng.pick(NOUNS)} (${rng.pick(PLACES)} of ${a} and ${b})`;
  } else title = `${rng.pick(NOUNS)} ${rng.pick(["Of", "In", "For"])} ${rng.pick(NOUNS)}`;
  if (rng.chance(0.2)) title += rng.pick([" (12″ Mix)", " (Extended)", " (Dub)"]);
  return title;
}
