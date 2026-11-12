/**
 * Genre profiles: everything the generator weighs differently from one reference song to another.
 * A genre is a discrete choice; blending happens only between its own references.
 *
 * The blend is one weight per reference, in `references` order. The UI sets them with a point
 * inside a regular polygon, one reference per vertex (polygon.ts, blendpad.ts); with two
 * references that is a slider. The scalar `style` (0 = the first reference … 1 = the second) is
 * the older form, kept for saved settings and links: `referenceWeights` turns it into
 * `[1 − style, style, 0, …]`. Every style-dependent number is a `Blend`: a base plus what each
 * reference adds in proportion to its weight. That is the form the original expressions had
 * (`0.1 + 0.7 * (1 - style)` is a base of 0.1 plus 0.7 from True Faith), so the profile reproduces
 * them bit for bit.
 */
import type { BassStyle, KitName } from "./composer";
import type { DrumVoice } from "./arranger";
import type { BankEntry, Progression, ProgressionKind } from "./progressions";
import { REFERENCES, type ReferenceId } from "./references";
import type { Track } from "./instruments";
import type { Mode } from "./theory";
import { polygonVertices, quantize, randomPoint, weightsAt, type Point } from "./polygon";
import type { Rng } from "./rng";
import { euroTitle, italoTitle, synthpopTitle } from "./titles";

export type GenreId = "synthpop" | "italo" | "euro";

/** A reference's title, for the style pad and the wizard. */
export function styleName(id: ReferenceId): string {
  return REFERENCES[id].title;
}

/** A number that varies with the references' weights: `base + Σ by[ref] × weight(ref)`. */
export interface Blend {
  base?: number;
  by?: Partial<Record<ReferenceId, number>>;
}

/** Drum details a reference has that the genre doesn't by default. They apply while that
 * reference outweighs every other one. */
export interface DrumTraits {
  /** A low tom on 4& of every other intro bar (TF's MIDI bars 1–15). */
  introLowTom: boolean;
  /** An open hat on beat 3 of every other bar (TF, intro to outro). */
  openHatBeat3: boolean;
  /** Big sections may add a soft kick on the last 16th's 8th (DS). */
  bigKick14: boolean;
  /** Big sections' extra percussion: a tambourine on the 8th offbeats (DS) or 16th cabasa (TF);
   * none for You Came, whose choruses keep the verse kit. */
  bigPercussion: Extract<DrumVoice, "tamb" | "cabasa"> | "none";
  /** The hats: every 16th (TF, DS), or on the beat, the "&" and the "a" with the "a" open in about
   * a third of the bars (You Came, §6.4), or 8ths (The Night, Get Closer), with an open hat on 3a
   * (Faces' verses), or Self Control's: quiet 8ths in the verses, 16ths from the pre-chorus on
   * with an open 4a every other big bar, 8ths in the intro. The breaks' `hats16` mode always plays 16ths. */
  hats: "16ths" | "beat-and-a" | "8ths" | "8ths-open3a" | "quiet-verse";
  /** You Came's fill: snare on every 8th but the downbeats, hats down to 8ths, in the last bar of
   * every 8-bar phrase, then a crash on the next phrase's 1 (the hats skip it). Otherwise fills
   * come only at section ends, as one of the random snare, tom or flam fills. */
  phraseFills: boolean;
  /** A soft pickup snare on 4& in about a third of the bars (You Came). */
  snarePickup: boolean;
  /** The snare and clap feed the 80s gated reverb (TF, DS); You Came's snare has a long, smooth
   * plate tail with no gate. */
  gatedSnare: boolean;
  // The Italo references' details. Unset, each keeps synthpop's behaviour.
  /** Big sections' hats: open hats on the off-beat 8ths (unset; The Night's chorus), or Faces'
   * galloping 16th cell, x x x . │ x . x x every two beats, with a kick on 3& every 4th bar. */
  bigHats?: "open8" | "gallop";
  /** A clap doubles the snare in every section, not only the big ones (The Night). */
  clapAlways?: boolean;
  /** A crash opens each section (unset: yes). The Night and Faces have none. */
  crashes?: boolean;
  /** Section-end fills: the random snare, tom or flam fills (unset), snare 16ths only (Get
   * Closer), none (The Night: not one in 5:46), or Faces' 3&–4–4& snare pickup closing every 8
   * bars. */
  fills?: "random" | "snare" | "none" | "pickup8";
  /** Big sections' claps: with the snare on 2 and 4 (unset), or Self Control's: one on 4, and every
   * other bar a syncopated one on 3e; in the outro, on 2 alone. */
  bigClaps?: "4-and-3e";
  /** The kick: on every beat (unset), or Self Control's on 1 and 3, with 3& and 3a in its intro. */
  kick?: "1-and-3";
  /** A backbeat kit played from a pattern table instead of the four-on-the-floor kick and the hat
   * loop (the Euro-disco references). Unset everywhere else. */
  groove?: Grooves;
}

/**
 * One drum pattern, read from an analysis's grid: a string per bar, one character per 16th.
 * - Kick and snare: "X" a full hit, "x" about 3 dB under, "g" a ghost about 6 dB under, "?" a
 *   ghost in about half the bars, "." none.
 * - Hats: "x" closed, "o" open, "?" closed in about half the bars, "%" open in about a third of the
 *   bars and closed in the others, "." none.
 */
export interface Groove {
  /** The kick's cycle, one string per bar (2- and 4-bar cycles), from the section's first bar. */
  kick: readonly string[];
  hats: string;
  /** Unset: the snare on 2 and 4. */
  snare?: string;
  /** A low drum (Innocent Love's intro: on 2 and 4, under the 16th hats). */
  tom?: string;
}

/** A backbeat kit (`DrumTraits.groove`): a pattern per kind of section, and its own fills and stops. */
export interface Grooves {
  /** Verses, intros and instrumentals ("full"). */
  verse: Groove;
  /** Pre-choruses; unset, the verse's. */
  prechorus?: Groove;
  /** Choruses and the outro ("big"). */
  chorus: Groove;
  /** The intro before the kick ("hats16"). Unset: 16th hats alone. */
  intro?: Groove;
  /** A crash on every section start and 8-bar phrase, the hats skipping 1e–1a there (Crazy Juliet).
   * Otherwise no crashes. */
  phraseCrash: boolean;
  /** Phrase ends: Crazy Juliet's snare run (2, 2e, 3, 3e, 4, 4&, 4a) in a chorus's last bar and a
   * 4e–4& pickup closing every 8 bars; Heaven Can Wait's 3e and 4e snare pickups; or nothing
   * (Innocent Love stops instead). */
  fills: "run" | "pickup" | "none";
  /** A stop bar (`Layers.stop`): one kick-and-snare hit on 2, then silence (Innocent Love); or the
   * bar played to the snare on 4, an open hat on 3a, the kick on 1 and 3 only (Crazy Juliet). */
  stop: "hit2" | "beat4";
}

/** How a genre plays some parts. Unset: synthpop's way. */
export interface PartStyle {
  /** Stabs: one chord hit every 4 bars (synthpop), gated 8th-note chords (Faces), or chords on the
   * bass's chorus rhythm, 1, 1&, 2e, 2&, 3& and 4e (Innocent Love). */
  stabs: "hit" | "gated8" | "follow";
}

/** The parts and sounds a reference brings while it outweighs the others (like `DrumTraits`). */
export interface Voices {
  /** The riff: synthpop's call-and-response motif; Get Closer's hook, short stepwise figures in
   * D4–B4 that a dotted-8th echo spins out (composer.ts `generateEchoHook`); or The Night's two-note
   * figure, the tonic and the 7th below in 16ths, every other bar (the-night.md §7); or Self
   * Control's syncopated riff (1, 1a, 2&, then a step or two), played in unison by the bass
   * (branigan-self-control.md §4.1). */
  riff: "motif" | "echo" | "pair" | "unison" | "sync" | "run";
  /** The riff's sound: the FM bell layered with a saw pluck (synthpop); The Night's bright, nearly
   * unfiltered saw (the-night.md §10.3); or Get Closer's gated 12% pulse with a darkening
   * dotted-8th echo and a stereo chorus (get-closer.md §10); or Self Control's saw with its 2–4
   * kHz lifted, as bright there as at its fundamentals (branigan-self-control.md §11). */
  riffPatch: "fm" | "saw" | "pulse" | "bright" | "click" | "glide";
  /** The chorus countervoice: none; The Night's line on the off-beat 8ths, stepping down through
   * each chord's tones in the voice's register (the-night.md §10.2); or Get Closer's 8th arpeggio
   * up and down the chord from beat 2, in C6–B6 (get-closer.md §10), both on Get Closer's soft,
   * near-sine voice (docs/italo/mix.md); or Self Control's bright chorus comp: close chords around
   * E4–C♯5, syncopated in one bar and on the 8ths in the next (branigan-self-control.md §11,
   * §12). */
  countervoice: "none" | "pluck8" | "arp8" | "comp";
  /** Pads: one close voicing (synthpop, Get Closer); the triad stacked an octave up too (The
   * Night's span C4–A♭6); or Faces' open voicings, the root in octave 3, the 7th in the middle
   * (faces.md §10.3). */
  pad: "close" | "octaves" | "open";
  /** The stabs' sound: the saw brass with a noise burst (synthpop), or Faces' plucked saw with its
   * 300 ms echo on the right, in close three-note voicings (faces.md §10.1), and its held, open
   * chorus stab (§10.3); Self Control's verse line, three long notes a bar on a bell over bowed
   * strings (branigan-self-control.md §12); or Innocent Love's saw stab (sandra-innocent-love.md
   * §12). */
  stabPatch: "brass" | "pluck" | "bell" | "saw";
  /** The arpeggio's sound: the FM bell (synthpop), a softer copy of Faces' pluck through its echo
   * (faces.md §10.4), a soft triangle pluck through a 1.5 kHz low-pass (Crazy Juliet's verse
   * figure, Innocent Love's intro), or a gated saw at 2.9 kHz (Heaven Can Wait's pulse). */
  arpPatch: "bell" | "pluck" | "triangle" | "saw";
  // The Euro-disco references' parts (docs/references/sandra-*.md §12). Unset: as before.
  /** The 16th part: the song's arpeggio motif (unset), or Heaven Can Wait's pulse, every 16th on
   * the chord's root and 5th in B♭3–F5, or Self Control's pre-chorus pairs: the motif read as
   * scale steps from the root, each 8th struck twice as 16ths (branigan-self-control.md §12). */
  arp?: "motif" | "pulse" | "pairs";
  /** The pads' low-pass, Hz (unset: 2.8 kHz with a heavier chorus): Crazy Juliet's are far darker
   * (1.2 kHz), Heaven Can Wait's and Innocent Love's about ours (2.5 and 3 kHz). */
  padTone?: number;
  /** The lead synth's sound: The Night's struck FM tone (unset), or a saw through a 4.7 kHz
   * low-pass with a 4.4 Hz vibrato and no echo, an octave up (Crazy Juliet's instrumental lead). */
  synthPatch?: "fm" | "saw";
}

/** Synthpop's parts and sounds, for every genre that doesn't say otherwise. */
export const SYNTHPOP_VOICES: Voices = {
  riff: "motif",
  riffPatch: "fm",
  countervoice: "none",
  pad: "close",
  stabPatch: "brass",
  arpPatch: "bell",
};

/** The Italo planner's odds (composer.ts `planItalo`). */
export interface ItaloForm {
  /** The opening, one drawn per song in proportion to these: The Night's tonic-pedal intro, Faces'
   * build (bass and kick, then stabs, then the groove), or Get Closer's 16-bar instrumental hook. */
  pedalIntro: Blend;
  buildIntro: Blend;
  hookIntro: Blend;
  /** An instrumental on the verse loop with the lead synth in place of the second verse (The
   * Night). */
  leadSection: Blend;
  /** A 16-bar breakdown without bass or voice before the last choruses, then an instrumental with
   * the lead synth (Faces; Get Closer's 12″ break). */
  breakdown: Blend;
  /** The second half restarts: the opening's pedal block again, a verse and a chorus (The Night). */
  reprise: Blend;
  /** The 16th arpeggio through the verses (The Night). */
  verseArp: Blend;
  /** Gated stabs through the verses and choruses (Faces). */
  stabs: Blend;
  /** The first verse's bass holds long roots instead of its figure (Faces). */
  bareFirstVerse: Blend;
  /** A short instrumental on the verse loop after the first chorus (Faces' 8 bars, Get Closer's
   * hook reprise). */
  afterChorus: Blend;
  // Self Control's (branigan-self-control.md §2.1), each drawn from its own random stream.
  /** The opening: a pad on i7 over the percussion, then the riff and the bass in unison on i–v. */
  riffIntro: Blend;
  /** A pre-chorus on the verse loop before the first chorus, with 16th hats and the title line. */
  preChorus: Blend;
  /** A 4-bar break after the choruses (one stab on beat 2, the voice), with 2 bars of drums and
   * voice after the first. */
  stabBreak: Blend;
  /** The second verse at half length. */
  halfVerse: Blend;
  /** Stacked voices in the choruses (its backing voices). */
  backing: Blend;
  /** A song to fade ends on the i–v vamp after its second chorus, not on a last chorus. */
  vampOutro: Blend;
}

/** The Euro-disco planner's odds (composer.ts `planEuro`). */
export interface EuroForm {
  /** The opening, one drawn per song in proportion to these: Crazy Juliet's staggered entries over
   * the verse chords, Heaven Can Wait's solo motif then drums and bass alone, or Innocent Love's
   * pads on i–v over 16th hats, then ♭VI–♭VII and the bass's link. */
  staggeredIntro: Blend;
  motifIntro: Blend;
  padIntro: Blend;
  /** 16-bar verses (Crazy Juliet) rather than 8. */
  longVerse: Blend;
  /** Verses of drums, bass and voice alone (Heaven Can Wait). */
  bareVerse: Blend;
  /** The pre-chorus ends on a stop bar (Innocent Love's turn, Crazy Juliet's 5th bar). */
  stop: Blend;
  /** After the first and the last chorus, one of: a 2-bar tag on i (Heaven Can Wait), a 2-bar stop
   * on ♭VII without drums or bass (Innocent Love), or straight on (in proportion to `straight`). */
  tag: Blend;
  chorusStop: Blend;
  straight: Blend;
  /** The second half, one drawn per song: instrumental choruses with the lead synth between the
   * sung ones (Crazy Juliet), an instrumental chorus ending in a 2-bar break without bass on V
   * (Heaven Can Wait), or a 4-bar link, a verse without voice and the pre-chorus (Innocent Love). */
  leadChoruses: Blend;
  instrumentalChorus: Blend;
  instrumentalBlock: Blend;
  /** A 10-bar Aeolian bridge before the last choruses (Innocent Love). */
  bridge: Blend;
  /** The 16th part in the verses (Crazy Juliet) and in the choruses (Heaven Can Wait's pulse). */
  verseArp: Blend;
  chorusArp: Blend;
  /** The riff over the choruses (Crazy Juliet). */
  chorusRiff: Blend;
  /** Chord stabs on the bass's rhythm in the choruses, and stacked chorus voices (Innocent Love). */
  stabs: Blend;
  stack: Blend;
}

/** The bass's tone controls (instruments.ts `setBassTone`). */
export interface BassTone {
  /** The tone shelf's corner, Hz. */
  frequency: number;
  /** The presence boost, dB. */
  presence: number;
  /** The saw bass's own filter cutoff, Hz. */
  sawCutoff: number;
  /** Level of a second saw an octave above, through the same filter (0 = off): You Came's
   * octave-layered bass, whose 2nd harmonic is as loud as its fundamental. Above 0 the low
   * oscillator turns from a saw to a triangle, whose 3rd harmonic sits 19 dB down as the
   * record's does (a saw's: 9.5). */
  octave: number;
  /** The level each note decays to (of its peak), so how deep the dips between re-struck 8ths
   * are: TF/DS fall to a fifth. You Came's record dips about 5 dB; 0.35 keeps the re-strikes
   * audible as onsets, which a 5 dB dip on this envelope didn't. */
  sustain: number;
  /** A high-pass corner under the bass, Hz, 24 dB per octave (0 = none): Self Control's
   * fundamental sits 4–14 dB under its 2nd harmonic, the lowest notes the most. */
  lowCut: number;
  /** How long each note takes to fall to its `sustain`, seconds (linearly): 0.25, or Self
   * Control's punchy 0.1 (about 4 dB down after 40 ms, 7 after 80 on its stem). */
  decay: number;
}

/** The sung voice's mix (instruments.ts `setLeadTone`), matched to each record's vocal stem with
 * scripts/compare_voice.py, the boosts capped (high shelf +9 dB, breath +6) where matching the
 * stems' air band, which carries hat bleed, drove the master clipper into distortion: its level, a low shelf at 220 Hz, a presence peak at 1.8 kHz and a
 * high shelf at 3 kHz (dB), its breath above 5 kHz (dB over the voice's own), and its width (the level of a 14 ms copy on the right; 0 = mono). The
 * records' low band is mostly their singers' lower range, which EQ can't give a melody that sits
 * higher, so the low shelves stay small. */
export interface LeadTone {
  level: number;
  low: number;
  mid: number;
  high: number;
  air: number;
  width: number;
}

/** When a progression substitution may fire: chords one reference uses where the other uses
 * another (`mutate`). Tried in order; the first whose chance comes up wins. */
export interface Substitution {
  from: string;
  /** One chord, or two splitting the bar (only where `from` fills the bar). */
  to: string | readonly [string, string];
  chance: Blend;
  /** Only in a progression's last bar. */
  lastBar?: boolean;
  /** Only in these progressions. */
  kinds?: readonly ProgressionKind[];
  /** Only in songs in this mode. A substitution limited to a mode draws nothing in the other. */
  mode?: Mode;
}

export interface Genre {
  id: GenreId;
  name: string;
  /** Titles for its generated songs (titles.ts), drawn from the song's own "title" stream. */
  title: (rng: Rng) => string;
  /** The references the blend runs between, one per vertex of the style polygon (polygon.ts): the
   * first two on its bottom edge, left to right (the legacy `style` runs from the first, 0, to the
   * second, 1), the others round from there. List similar references next to each other, so they
   * get neighbouring vertices. */
  references: readonly ReferenceId[];
  /** Auto tempos fall in `range`, around `center`; `note` says where the records sit. With a
   * `floor`, they don't fall under it (rounded down to a half BPM, and never under the range):
   * a reference can open the range's low end without moving the others' tempos. */
  tempo: { range: readonly [number, number]; center: Blend; note: string; floor?: Blend };
  /** The section planner: synthpop's (True Faith's, The Different Story's and You Came's blocks,
   * drawn with `form`'s odds) or Italo's (`italo`'s odds). */
  planner: "synthpop" | "italo" | "euro";
  italo?: ItaloForm;
  euro?: EuroForm;
  parts?: PartStyle;
  /** Its songs' fader levels on auto, in dB over instruments.ts `DEFAULT_VOLUMES`, blended by
   * the song's references like the rest of the profile (`mixAt`). Each voice's own gain makes it
   * as loud as the voice it replaces at the same fader; this is the balance between the tracks
   * that suits each record. A track only some references play takes its level as `base`, so a
   * blend with the others doesn't dilute it. */
  mix?: Partial<Record<Track, Blend>>;
  /** The parts and sounds when no reference outweighs the others, and per reference while it
   * does. Unset: `SYNTHPOP_VOICES`. */
  voices?: Voices;
  voiceTraits?: Partial<Record<ReferenceId, Voices>>;
  /** Where generated verse and chorus melodies sit, when not composer.ts `LEAD_RANGES`. */
  leadRanges?: Record<"verse" | "chorus", readonly [number, number]>;
  /** Key tonic (pitch class) → weight, for minor keys. */
  keyWeights: readonly (readonly [number, number])[];
  /** Chance of a major key, and the major tonics' weights. */
  major: Blend;
  majorKeyWeights: readonly (readonly [number, number])[];
  /** The progression bank; each entry's `style` places it on the same axis as the slider. */
  bank: Record<ProgressionKind, readonly BankEntry[]>;
  substitutions: readonly Substitution[];
  kits: readonly (readonly [KitName, Blend])[];
  bassFigures: readonly (readonly [BassStyle, Blend])[];
  /** Chance of ending on a lift to IV rather than a chorus to fade. */
  liftEnding: Blend;
  /** Chance a generated song gets the chorus counter-line. */
  counter: Blend;
  /** The section planner's odds (composer.ts `planSections`). */
  form: {
    /** The high 16th sequencer after the first chorus. */
    seq: Blend;
    /** The rhythm guitar in choruses, instrumentals and the outro. */
    guitar: Blend;
    /** Stabs in a chorus (drawn per chorus). */
    stabs: Blend;
    /** The opening intro's drums: the groove, else kick only, else full. */
    introGroove: Blend;
    introKick: Blend;
    /** The melodic bass in the opening intro and in the riff intro. */
    introHook: Blend;
    riffIntroHook: Blend;
    riffIntroArp: Blend;
    /** After a chorus: the DS block (interlude, turnaround, break) instead of TF's instrumental. */
    dsBlock: Blend;
    /** The melodic bass over the DS interlude and the TF instrumentals. */
    interludeHook: Blend;
    instrumentalHook: Blend;
    /** TF's two-bar VI–VII turn into a verse. */
    turn: Blend;
    /** A third verse and chorus block (standard form). */
    thirdVerse: Blend;
    /** A third final chorus (standard form). */
    extraChorus: Blend;
    // You Came's blocks (§7.2). Each is drawn from its own random stream, so at weight 0 nothing
    // else about a song changes.
    /** The verse plays over the chorus's loop. */
    verseOnLoop: Blend;
    /** An 8-bar pre-chorus between each verse and chorus, entered from a pushed tonic. */
    preChorus: Blend;
    /** Stacked voices in the choruses (a diatonic 3rd under the lead). */
    stack: Blend;
    /** The riff in the choruses too, and an octave higher (C♯6–G♯6). */
    chorusRiff: Blend;
    /** Straight from the first chorus into verse 2, with no instrumental block between. */
    straightOn: Blend;
    /** After chorus 2: a breakdown verse (no bass, no snare) and a 4-bar bridge. */
    breakdown: Blend;
    /** Before the last chorus: a break without bass or voice and an instrumental, both with
     * 16th hats. */
    instrumental16: Blend;
    /** End by holding IV instead of a lift or a chorus to fade. */
    holdEnding: Blend;
  };
  /** Drum details when no reference outweighs the others. */
  drums: DrumTraits;
  /** Per reference, the drum details it brings while it outweighs the others. */
  drumTraits: Partial<Record<ReferenceId, DrumTraits>>;
  bassTone: {
    frequency: Blend;
    presence: Blend;
    sawCutoff: Blend;
    octave: Blend;
    sustain: Blend;
    lowCut: Blend;
    /** Added to the 0.25 s decay (unset: nothing). */
    decay?: Blend;
  };
  leadTone: { level: Blend; low: Blend; mid: Blend; high: Blend; air: Blend; width: Blend };
}

const TF = "true-faith";
const DS = "different-story";
const YC = "you-came";

/** You Came's loop: IV │ V │ IV │ V–I⁶, the bass dropping to the 3rd on bar 4 (§6.2). */
const YC_LOOP: Progression = [["IV"], ["V"], ["IV"], ["V", "I/3"]];

/** You Came's loops, in major, and the climb they make in a minor key. */
function ycLoops(kind: "verse" | "chorus"): BankEntry[] {
  return [
    { name: `YC ${kind} loop (measured)`, bars: YC_LOOP, mode: "major", ref: YC, weight: 2 },
    {
      // Chorus 3 and the outro drop to the 3rd only every 8 bars.
      name: `YC ${kind} loop, 8 bars (measured)`,
      bars: [["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V", "I/3"]],
      mode: "major",
      ref: YC,
    },
    {
      name: `YC ${kind} loop, plain`,
      bars: [["IV"], ["V"], ["IV"], ["V"]],
      mode: "major",
      ref: YC,
    },
    // Not measured: the loop's climb in a minor key, as ♭VI–♭VII under a tonic opening.
    { name: `${kind}: i, then the climb`, bars: [["i"], ["VI"], ["VII"], ["VII"]], ref: YC },
  ];
}

/** Measured from the recordings (docs/analysis.md §3, §6). TF and DS entries sit on the style
 * axis (`style`); You Came's carry `ref` and weigh in with its weight. */
const SYNTHPOP_BANK: Record<ProgressionKind, readonly BankEntry[]> = {
  verse: [
    // TF's verse from the MIDI transcription's sequence bass: the second line moves differently.
    {
      name: "TF verse (MIDI)",
      bars: [
        ["i"],
        ["VI", "VII"],
        ["v"],
        ["v"],
        ["i"],
        ["VI", "VII"],
        ["v"],
        ["VII"],
        ["i"],
        ["VII"],
        ["VI"],
        ["v"],
        ["VII"],
        ["VI"],
        ["v"],
        ["v", "V"],
      ],
      style: 0,
    },
    { name: "TF verse line 1", bars: [["i"], ["VI", "VII"], ["v"], ["v"]], style: 0.1 },
    { name: "TF verse (Hooktheory)", bars: [["i"], ["VI"], ["VII"], ["v", "VII"]], style: 0.15 },
    {
      name: "DS verse (measured)",
      bars: [["i"], ["VI"], ["VII"], ["v"], ["i"], ["VI"], ["iv"], ["V"]],
      style: 1,
    },
    { name: "DS verse line 2", bars: [["i"], ["VI"], ["iv"], ["V"]], style: 0.85 },
    {
      name: "v then V",
      bars: [["i"], ["VI", "VII"], ["v"], ["v"], ["i"], ["VI", "VII"], ["v"], ["V"]],
      style: 0.5,
    },
    { name: "aeolian climb", bars: [["i"], ["VI"], ["VII"], ["v"]], style: 0.5 },
    // You Came's verse is its chorus loop (§6.2); the loop's A–B is the minor keys' ♭VI–♭VII climb,
    // run without landing on the tonic.
    ...ycLoops("verse"),
  ],
  chorus: [
    // TF's chorus (MIDI): one note away from DS's, the major IV against the minor iv.
    { name: "TF chorus (MIDI)", bars: [["i"], ["III"], ["VII"], ["IV"]], style: 0 },
    { name: "TF chorus (plain)", bars: [["i"], ["VII"], ["VII"], ["IV"]], style: 0.1 },
    { name: "DS chorus (measured)", bars: [["i"], ["III"], ["VII"], ["iv"]], style: 1 },
    { name: "DS chorus (C turn)", bars: [["i"], ["III"], ["VII"], ["iv", "VI"]], style: 0.9 },
    { name: "TF chorus (F–C split)", bars: [["i"], ["III", "VII"], ["VII"], ["IV"]], style: 0.3 },
    { name: "chorus → V", bars: [["i"], ["III"], ["VII"], ["V"]], style: 0.7 },
    ...ycLoops("chorus"),
  ],
  interlude: [
    { name: "DS interlude (measured)", bars: [["III"], ["VII"], ["iv"], ["i", "VII"]], style: 1 },
    { name: "relative lift", bars: [["III"], ["VII"], ["iv"], ["i"]], style: 0.75 },
    { name: "TF instrumental", bars: [["i"], ["III"], ["VII"], ["IV"]], style: 0 },
    // You Came's break (3:18) and instrumental (3:34).
    { name: "YC break (measured)", bars: [["IVadd9"], ["V"]], mode: "major", ref: YC },
    { name: "YC instrumental (the loop)", bars: YC_LOOP, mode: "major", ref: YC },
  ],
  turnaround: [
    { name: "DS Dorian turnaround (measured)", bars: [["ii"], ["ii"], ["IV"], ["IV"]], style: 1 },
    { name: "TF turnaround on VI (measured)", bars: [["VI"], ["VI"]], style: 0 },
    { name: "TF turnaround VI–VII (MIDI)", bars: [["VI"], ["VII"]], style: 0.1 },
    { name: "VI–VII–VI–VII", bars: [["VI"], ["VII"], ["VI"], ["VII"]], style: 0.5 },
    // You Came's breakdown (2:22): bare IV and V.
    { name: "YC breakdown IV–V (measured)", bars: [["IV"], ["V"]], mode: "major", ref: YC },
    {
      name: "IV–IV–V–V",
      bars: [["IV"], ["IV"], ["V"], ["V"]],
      mode: "major",
      ref: YC,
      weight: 0.5,
    },
  ],
  bridge: [
    { name: "TF i–IV vamp (measured)", bars: [["i", "IV"], ["IV"], ["i", "IV"], ["IV"]], style: 0 },
    { name: "DS long-version bridge", bars: [["ii"], ["ii"], ["IV"], ["V"]], style: 1 },
    { name: "subdominant", bars: [["iv"], ["VI"], ["VII"], ["i"]], style: 0.5 },
    // You Came's 4-bar bridge (2:38): Amaj7 │ B(add9) │ A/C♯ │ Bsus4–B.
    {
      name: "YC bridge (measured)",
      bars: [["IVmaj7"], ["Vadd9"], ["IV/3"], ["Vsus4", "V"]],
      mode: "major",
      ref: YC,
    },
    { name: "YC bridge, plain", bars: [["IV"], ["V"], ["IV/3"], ["V"]], mode: "major", ref: YC },
  ],
  // TF's outro: the chorus's IV becomes the new tonic (major), vamping with the odd V.
  lift: [
    { name: "TF outro vamp (measured)", bars: [["I"], ["I"], ["I"], ["I", "V"]], style: 0 },
    { name: "lift I–IV", bars: [["I"], ["I", "IV"], ["I"], ["V"]], style: 0.3 },
    { name: "lift I–IV–V", bars: [["I"], ["IV"], ["I"], ["V"]], style: 0.6 },
  ],
  // You Came's pre-chorus (0:45, 1:33): V/ii │ ii │ I │ v │ ii │ I │ V/vi sus4 │ V/vi⁷, leaving
  // deceptively to the loop's IV. TF and DS have none, so the minor entries are derived, not
  // measured: the same climb read in the relative major, ending on the minor key's own V7.
  prechorus: [
    {
      name: "YC pre-chorus (measured)",
      bars: [["V/ii"], ["ii"], ["I"], ["v"], ["ii"], ["I"], ["Vsus4/vi"], ["V7/vi"]],
      mode: "major",
      ref: YC,
      weight: 2,
    },
    {
      name: "YC pre-chorus, second line",
      bars: [["ii"], ["I"], ["Vsus4/vi"], ["V7/vi"]],
      mode: "major",
      ref: YC,
    },
    {
      name: "pre-chorus, plain dominant",
      bars: [["V/ii"], ["ii"], ["I"], ["v"], ["ii"], ["I"], ["V7/vi"], ["V7/vi"]],
      mode: "major",
      ref: YC,
    },
    {
      name: "pre-chorus via the relative major",
      bars: [["VI"], ["iv"], ["III"], ["v"], ["iv"], ["III"], ["Vsus4"], ["V7"]],
      ref: YC,
    },
    { name: "minor pre-chorus build", bars: [["iv"], ["VI"], ["VII"], ["V7"]], ref: YC },
  ],
};

const TN = "the-night";
const GC = "get-closer";
const FC = "faces";
const SC = "self-control";

/** Self Control's one loop, under its verse, pre-chorus and chorus (branigan-self-control.md §3.2):
 * i–v–i–v–♭VII–iv–♭VI–♭III, pure Aeolian, the minor v throughout. */
const SC_LOOP: Progression = [["i"], ["v"], ["i"], ["v"], ["VII"], ["iv"], ["VI"], ["III"]];

/** Measured from the Italo records (docs/italo/the-night.md §4 and §9, get-closer.md §4 and §9,
 * faces.md §4 and §9), all written in the minor key: Faces' A major chorus is read from A minor
 * (its I, v7, IVmaj7 and vi7 borrow from the major). Entries without a `ref` are unmeasured
 * genre-wide loops; they also make each pool weigh the measured entries by their reference. */
const ITALO_BANK: Record<ProgressionKind, readonly BankEntry[]> = {
  verse: [
    // The Night: i │ ♭VII over the tonic │ v7 │ IV, Dorian, over an F pedal in the bass's bar 2.
    {
      name: "TN verse loop (measured)",
      bars: [["i"], ["VII/i"], ["v7"], ["IV"]],
      ref: TN,
      weight: 2,
    },
    { name: "TN verse loop, plain", bars: [["i"], ["VII"], ["v"], ["IV"]], ref: TN },
    // Get Closer's two-layer loop: pads i │ ♭VII │ IV │ ♭VI over a bass i │ i │ IV │ ♭VII.
    {
      name: "GC loop (measured)",
      bars: [["i"], ["VII/i"], ["IV"], ["VI/VII"]],
      ref: GC,
      weight: 2,
    },
    { name: "GC loop, IV⁶ walk", bars: [["i"], ["VII/i"], ["IV/3"], ["VI/VII"]], ref: GC },
    // Faces' royal road, VI△7–♭VIIsus4 │ v7–i7 (the record holds a C/G pedal over it; not played yet).
    {
      name: "FC royal road (measured)",
      bars: [
        ["VImaj7", "VIIsus4"],
        ["v7", "i7"],
      ],
      ref: FC,
      weight: 2,
    },
    {
      name: "FC royal road, 4 bars",
      bars: [
        ["VImaj7", "VIIsus4"],
        ["v7", "i7"],
        ["VImaj7", "VII"],
        ["v7", "i"],
      ],
      ref: FC,
    },
    { name: "SC loop (measured)", bars: SC_LOOP, ref: SC, weight: 2 },
    { name: "aeolian loop", bars: [["i"], ["VI"], ["VII"], ["i"]], weight: 0.5 },
    { name: "i–VII–VI–VII", bars: [["i"], ["VII"], ["VI"], ["VII"]], weight: 0.5 },
  ],
  chorus: [
    // The Night: a I–IV⁶–♭VII–V7 cadence in the relative major, III(add9) │ VI⁶ │ ♭II │ ♭VII7sus4–7.
    {
      name: "TN chorus (measured)",
      bars: [["IIIadd9"], ["VI/3"], ["II"], ["VII7sus4", "VII7"]],
      ref: TN,
      weight: 2,
    },
    { name: "TN chorus, plain", bars: [["III"], ["VI"], ["II"], ["VII7"]], ref: TN },
    // Get Closer: i │ ♭VI over the tonic │ ♭VII │ IV/V → V (Em │ C/E │ D │ A/B → B), the
    // harmonic-minor V entered through a V11.
    {
      name: "GC chorus (measured)",
      bars: [["i"], ["VI/3"], ["VII"], ["IV/V", "V"]],
      ref: GC,
      weight: 2,
    },
    // Faces: the parallel major, I │ v7–IV△7 three times, then the I–vi7 │ ♭VII–V7sus4 turnaround.
    {
      name: "FC chorus (measured)",
      bars: [
        ["I"],
        ["v7", "IVmaj7"],
        ["I"],
        ["v7", "IVmaj7"],
        ["I"],
        ["v7", "IVmaj7"],
        ["I", "vi7"],
        ["VII", "V7sus4"],
      ],
      ref: FC,
      weight: 2,
    },
    {
      name: "FC chorus, doubled turnaround",
      bars: [["I"], ["v7", "IVmaj7"], ["I", "vi7"], ["VII", "V7sus4"]],
      ref: FC,
    },
    // Self Control: the chorus is the verse's loop; the louder parts set it apart.
    { name: "SC loop (measured)", bars: SC_LOOP, ref: SC, weight: 2 },
    { name: "relative-major lift", bars: [["III"], ["VII"], ["VI"], ["VII"]], weight: 0.5 },
  ],
  // The breakdowns and instrumentals that don't run on the verse loop.
  interlude: [
    { name: "TN pedal (measured)", bars: [["i"], ["VII/i"]], ref: TN },
    { name: "GC break, the pads alone", bars: [["i"], ["VII"], ["IV"], ["VI"]], ref: GC },
    {
      name: "FC breakdown on the turnaround (measured)",
      bars: [
        ["I", "vi7"],
        ["VII", "V7sus4"],
      ],
      ref: FC,
    },
    // Self Control's breaks and outro.
    { name: "SC i–v vamp (measured)", bars: [["i"], ["v"]], ref: SC },
    { name: "i–VII–VI–VII", bars: [["i"], ["VII"], ["VI"], ["VII"]], weight: 0.5 },
  ],
  // Not measured: Italo's turnarounds, bridges and lifts aren't played by its planner, but the
  // wizard and creator offer them.
  turnaround: [{ name: "VI–VII", bars: [["VI"], ["VII"]] }],
  bridge: [{ name: "subdominant", bars: [["iv"], ["VI"], ["VII"], ["i"]] }],
  lift: [{ name: "lift I–IV–V", bars: [["I"], ["IV"], ["I"], ["V"]] }],
  prechorus: [],
};

const NO_FORM: Genre["form"] = {
  seq: {},
  guitar: {},
  stabs: {},
  introGroove: {},
  introKick: {},
  introHook: {},
  riffIntroHook: {},
  riffIntroArp: {},
  dsBlock: {},
  interludeHook: {},
  instrumentalHook: {},
  turn: {},
  thirdVerse: {},
  extraChorus: {},
  verseOnLoop: {},
  preChorus: {},
  stack: {},
  chorusRiff: {},
  straightOn: {},
  breakdown: {},
  instrumental16: {},
  holdEnding: {},
};

const ITALO_DRUMS: DrumTraits = {
  introLowTom: false,
  openHatBeat3: false,
  bigKick14: false,
  bigPercussion: "none",
  hats: "8ths",
  phraseFills: false,
  snarePickup: false,
  gatedSnare: false,
  crashes: false,
  fills: "snare",
};

const IL = "innocent-love";
const HCW = "heaven-can-wait";
const CJ = "crazy-juliet";

/** Crazy Juliet's chorus (sandra-crazy-juliet.md §4): (♭III–IV │ v) three times, then the tag
 * ♭III │ ii⁷ │ V sus4 │ V¹¹ (F♯ over G♯). In a minor key, the same bars read from its minor v:
 * the VI–VII climb landing on i, then VI │ v⁷ │ i sus4 │ ♭VII over the tonic. */
const CJ_CHORUS: Progression = [
  ["III", "IV"],
  ["v"],
  ["III", "IV"],
  ["v"],
  ["III", "IV"],
  ["v"],
  ["III"],
  ["ii7"],
  ["Vsus4"],
  ["IV/V"],
];
const CJ_CHORUS_MINOR: Progression = [
  ["VI", "VII"],
  ["i"],
  ["VI", "VII"],
  ["i"],
  ["VI", "VII"],
  ["i"],
  ["VI"],
  ["v7"],
  ["Isus4"],
  ["VII/i"],
];
/** Innocent Love's chorus loop (§4.2): i │ IV sus4 → IV │ ♭VII9sus4 │ ♭III, a chain of falling
 * fifths, 3½ times round. */
const IL_LOOP: Progression = [["i"], ["IVsus4", "IV"], ["VII9sus4"], ["III"]];
/** Heaven Can Wait's chorus (§4): 14 bars, i–VII twice, then iv VI i i and the harmonic-minor
 * V sus4 → V. */
const HCW_CHORUS: Progression = [
  ["i"],
  ["i"],
  ["VII"],
  ["VII"],
  ["i"],
  ["i"],
  ["VII"],
  ["VII"],
  ["iv"],
  ["VI"],
  ["i"],
  ["i"],
  ["Vsus4"],
  ["V"],
];

/** Measured from the three Sandra records (docs/references/sandra-*.md §4), in their own keys'
 * terms: Heaven Can Wait and Innocent Love in E♭ minor, Crazy Juliet in C♯ (major) and, for minor
 * songs, read from its chorus's G♯ minor. Choruses keep their measured lengths (10 and 14 bars):
 * the planner plays a chorus for as long as its progression. Entries without a `ref` are
 * genre-wide loops that make each pool weigh the measured ones by their reference. */
const EURO_BANK: Record<ProgressionKind, readonly BankEntry[]> = {
  verse: [
    // Heaven Can Wait: no chord instrument, a riff on the Dorian IV⁷ (A♭7 in E♭ minor).
    { name: "HCW verse vamp on IV⁷ (measured)", bars: [["IV7"], ["IV7"]], ref: HCW, weight: 2 },
    // Innocent Love: a pedal on the minor v under v │ ii⁷ │ v │ I (B♭m │ Fm7/B♭ │ B♭m │ E♭/B♭).
    {
      name: "IL verse on the v pedal (measured)",
      bars: [["v"], ["ii7/v"], ["v"], ["I/v"]],
      ref: IL,
      weight: 2,
    },
    { name: "IL verse, plain v pedal", bars: [["v"], ["v"], ["v"], ["I/v"]], ref: IL },
    // Crazy Juliet: I I I I │ ii │ ♭VII │ I I, Mixolydian; in minor, the same from its v.
    {
      name: "CJ verse (measured)",
      bars: [["I"], ["I"], ["I"], ["I"], ["ii"], ["VII"], ["I"], ["I"]],
      mode: "major",
      ref: CJ,
      weight: 2,
    },
    {
      name: "CJ verse, read from the v",
      bars: [["IV"], ["IV"], ["IV"], ["IV"], ["v"], ["III"], ["IV"], ["IV"]],
      ref: CJ,
    },
    { name: "minor vamp", bars: [["i"], ["i"], ["VII"], ["VII"]], weight: 0.5 },
  ],
  prechorus: [
    // Heaven Can Wait: over the IV pedal, the upper chord steps down by fifths, twice.
    {
      name: "HCW pre-chorus over the IV pedal (measured)",
      bars: [["III/IV"], ["VII/IV"], ["IV"], ["IV"], ["III/IV"], ["VII/IV"], ["IV"], ["IV"]],
      ref: HCW,
      weight: 2,
    },
    // Innocent Love: i │ viø7 twice (the Dorian 6th), then the turn ♭VI │ V.
    {
      name: "IL pre-chorus and turn (measured)",
      bars: [["i"], ["viø7"], ["i"], ["viø7"], ["VI"], ["V"]],
      ref: IL,
      weight: 2,
    },
    // Crazy Juliet: iv │ ♭III(add9) │ ♭VII │ IV⁷sus4 │ IV⁷, the 5th a stop bar.
    {
      name: "CJ pre-chorus (measured)",
      bars: [["iv"], ["IIIadd9"], ["VII"], ["IV7sus4"], ["IV7"]],
      mode: "major",
      ref: CJ,
      weight: 2,
    },
    {
      name: "CJ pre-chorus, read from the v",
      bars: [["vii"], ["VIadd9"], ["III"], ["VII7sus4"], ["VII7"]],
      ref: CJ,
    },
    { name: "minor build", bars: [["iv"], ["VI"], ["VII"], ["Vsus4", "V"]], weight: 0.5 },
  ],
  chorus: [
    { name: "HCW chorus (measured)", bars: HCW_CHORUS, ref: HCW, weight: 2 },
    {
      name: "IL chorus loop, 14 bars (measured)",
      bars: [...IL_LOOP, ...IL_LOOP, ...IL_LOOP, ["i"], ["IVsus4", "IV"]],
      ref: IL,
      weight: 2,
    },
    { name: "CJ chorus (measured)", bars: CJ_CHORUS, mode: "major", ref: CJ, weight: 2 },
    { name: "CJ chorus, read from the v", bars: CJ_CHORUS_MINOR, ref: CJ },
    {
      name: "climb to i, 14 bars",
      bars: [
        ["i"],
        ["i"],
        ["VII"],
        ["VII"],
        ["VI"],
        ["VI"],
        ["VII"],
        ["VII"],
        ["iv"],
        ["VI"],
        ["i"],
        ["i"],
        ["Vsus4"],
        ["V"],
      ],
      weight: 0.5,
    },
  ],
  // The instrumental blocks run on the verse or chorus chords; these are for the wizard and the
  // breaks: Heaven Can Wait's break on V, Innocent Love's intro on i and v.
  interlude: [
    { name: "HCW break on V (measured)", bars: [["V"], ["V"]], ref: HCW },
    { name: "IL intro, i–v (measured)", bars: [["i"], ["i"], ["v"], ["v"]], ref: IL },
    { name: "CJ chorus loop", bars: [["III", "IV"], ["v"]], mode: "major", ref: CJ },
    { name: "climb", bars: [["VI"], ["VII"], ["i"], ["i"]], weight: 0.5 },
  ],
  turnaround: [
    { name: "IL turn ♭VI–V (measured)", bars: [["VI"], ["V"]], ref: IL },
    { name: "HCW tag on i (measured)", bars: [["i"], ["i"]], ref: HCW },
    { name: "CJ tag (measured)", bars: [["Vsus4"], ["IV/V"]], mode: "major", ref: CJ },
    { name: "VI–VII", bars: [["VI"], ["VII"]], weight: 0.5 },
  ],
  bridge: [
    // Innocent Love's late bridge (§4.4), all Aeolian: the chorus's IV turns minor.
    {
      name: "IL bridge (measured)",
      bars: [
        ["VI"],
        ["VI", "VII"],
        ["i"],
        ["III"],
        ["VII"],
        ["iv"],
        ["III"],
        ["i"],
        ["VI"],
        ["VI"],
      ],
      ref: IL,
      weight: 2,
    },
    { name: "subdominant", bars: [["iv"], ["VI"], ["VII"], ["i"]] },
    { name: "CJ verse turn", bars: [["ii"], ["VII"], ["I"], ["I"]], mode: "major", ref: CJ },
  ],
  lift: [{ name: "lift I–IV–V", bars: [["I"], ["IV"], ["I"], ["V"]] }],
};

const EURO_NO_DRUM_TRAITS: Omit<DrumTraits, "groove"> = {
  introLowTom: false,
  openHatBeat3: false,
  bigKick14: false,
  bigPercussion: "none",
  hats: "16ths",
  phraseFills: false,
  snarePickup: false,
  // All three snares ring out: Innocent Love's tail about 400 ms with no gate, Heaven Can Wait's
  // longer in the chorus, Crazy Juliet's within 11–14 dB for 130 ms.
  gatedSnare: false,
};

/** Innocent Love (§6): kick 1, 3, 3& and a soft 2a (verse), 1, 2a, 3, 3&, 4& (chorus); no running
 * hats, only the beats and 3& (an open 1& in the chorus); 16th hats and a low drum on 2 and 4 in
 * the intro, without kick; stops instead of fills. */
const IL_GROOVE: Grooves = {
  verse: { kick: ["X......gX.x....."], hats: "x...x...x.x.x..." },
  prechorus: { kick: ["X.....x.?......."], hats: "x...x...x.x.x..." },
  chorus: { kick: ["X......xX.x...x."], hats: "x.o.x..xx.x.x.?." },
  intro: {
    kick: ["................"],
    snare: "................",
    tom: "....x.......x...",
    hats: "xxxxxxxxxxxxxxxx",
  },
  phraseCrash: false,
  fills: "none",
  stop: "hit2",
};

/** Heaven Can Wait (§6, ear-checked hit by hit): kick 1, 2& and 3 with one extra per bar in a
 * fixed 4-bar order (the pre-chorus pushes each 4-bar group on 4a); a 2-bar chorus kick
 * 1, 2a, 3, 4e │ 1, 3, 3e, 3& with ghosts on 1a and 2a; sparse 1e/3e/3a hats in the verse, every
 * 16th but the "e" after each snare in the chorus, open on the "&"s in some bars. */
const HCW_GROOVE: Grooves = {
  verse: {
    kick: ["X.....x.X.......", "X.....x.X..g....", "X.....x.X......g", "X.g...x.X..g...."],
    hats: ".?.......x.x....",
  },
  prechorus: {
    kick: ["X.....x.X.......", "X.....x.X..g....", "X.....x.X......g", "X.g...x.X..g...g"],
    hats: ".?.......x.x....",
  },
  chorus: { kick: ["X..g...XX?...X..", "X..g...gXXx...?."], hats: "xx%x..%xxxxx..%x" },
  phraseCrash: false,
  fills: "pickup",
  stop: "hit2",
};

/** Crazy Juliet (§6): the kick on 1 and 3 only, with a 4-bar cycle of syncopated kicks (2a │
 * 2& + 4& │ 2a │ 3& + 4&; the chorus adds 2& + 2a in its odd bars); 16th hats skipping the "e"
 * after each backbeat (in the verse, only some bars); a quieter snare on 1 in some chorus bars; a
 * crash on every section and 8-bar phrase; the chorus's snare run and the 4e–4& phrase pickups. */
const CJ_GROOVE: Grooves = {
  verse: {
    kick: ["X......xX.......", "X.....x.X.....x.", "X......xX.......", "X.........x...x."],
    hats: "xxxxx?xxxxxxx?xx",
  },
  prechorus: { kick: ["X.......X.?...?."], hats: "x?x?x?x?x?x?x?x?" },
  chorus: {
    kick: ["X.....xxX.......", "X.....x.X.....x.", "X.....xxX.......", "X.........x...x."],
    hats: "xxxxx.xxxxxxx.xx",
    snare: "?...X.......X...",
  },
  intro: { kick: ["...............x"], hats: "xxxxxxxxxxxxxxxx" },
  phraseCrash: true,
  fills: "run",
  stop: "beat4",
};

/** The Euro-disco parts and sounds, measured from the "other" stems (each analysis's §12). */
const EURO_VOICE_TRAITS: Partial<Record<ReferenceId, Voices>> = {
  // Pads like ours; the intro's soft triangle figure; saw stabs on the bass's rhythm; a bright lead
  // over the instrumental link.
  "innocent-love": {
    riff: "motif",
    riffPatch: "click",
    countervoice: "none",
    pad: "close",
    stabPatch: "saw",
    arp: "motif",
    arpPatch: "triangle",
    padTone: 3000,
    synthPatch: "saw",
  },
  // The solo intro motif (three detuned saws, legato, a filter falling from 8 to 3.2 kHz, a long
  // reverb), the gated saw pulse in the pre-chorus and chorus.
  "heaven-can-wait": {
    riff: "run",
    riffPatch: "glide",
    countervoice: "none",
    pad: "close",
    stabPatch: "saw",
    arp: "pulse",
    arpPatch: "saw",
    padTone: 2500,
    synthPatch: "saw",
  },
  // The clicky, chorused sequence and chorus riff on syncopated chord tones, the verse's triangle
  // figure, dark pads, and the saw lead of the instrumental choruses.
  "crazy-juliet": {
    riff: "sync",
    riffPatch: "click",
    countervoice: "none",
    pad: "close",
    stabPatch: "saw",
    arp: "motif",
    arpPatch: "triangle",
    padTone: 1200,
    synthPatch: "saw",
  },
};
const EURO_VOICES: Voices = EURO_VOICE_TRAITS["heaven-can-wait"] ?? SYNTHPOP_VOICES;

/** The voice's mix at each corner, matched with scripts/compare_voice.py to each record's vocal
 * stem: level and width within 0.5 dB; the high shelf and breath held at the caps (+9, +6), which
 * leaves the 1–2.5 kHz band 1–3.5 dB and the presence and air bands 1–4 dB short of the records. All
 * three sit forward and wider than a mono lead, Crazy Juliet the narrowest, Heaven Can Wait the
 * furthest back. */
const EURO_LEAD_TONE: Genre["leadTone"] = {
  level: { by: { "innocent-love": 1.8, "heaven-can-wait": -1.7, "crazy-juliet": 0.4 } },
  low: { by: { "innocent-love": 4, "heaven-can-wait": 1, "crazy-juliet": 6 } },
  mid: { by: { "innocent-love": 12, "heaven-can-wait": 9, "crazy-juliet": 8 } },
  high: { by: { "innocent-love": 9, "heaven-can-wait": 9, "crazy-juliet": 9 } },
  air: { by: { "innocent-love": 6, "heaven-can-wait": 6, "crazy-juliet": 6 } },
  width: { by: { "innocent-love": 0.5, "heaven-can-wait": 0.45, "crazy-juliet": 0.3 } },
};

export const GENRES: Record<GenreId, Genre> = {
  synthpop: {
    id: "synthpop",
    name: "Synthpop",
    title: synthpopTitle,
    references: [TF, DS, YC],
    // True Faith measures 117.0 BPM, The Different Story 119.8: centred between them. You Came's
    // 119.0 sits inside.
    tempo: { range: [116, 121], center: { base: 118.5 }, note: "the originals run at 117–119.8" },
    planner: "synthpop",
    // Weighted toward the originals' keys: D minor (True Faith) and E minor (The Different Story).
    keyWeights: [
      [2, 3],
      [4, 3],
      [9, 2],
      [0, 1.5],
      [7, 1.5],
      [11, 1],
      [5, 1],
      [6, 1],
      [1, 0.5],
    ],
    // You Came is in E major (§6.1); TF and DS are minor.
    major: { by: { [YC]: 1 } },
    majorKeyWeights: [
      [4, 3],
      [9, 2],
      [2, 1.5],
      [7, 1.5],
      [11, 1],
      [0, 1],
      [5, 1],
      [6, 0.5],
    ],
    bank: SYNTHPOP_BANK,
    // IV ↔ iv is the one-note difference between the choruses; DS cadences on V, TF on v.
    substitutions: [
      { from: "IV", to: "iv", chance: { by: { [DS]: 1 } } },
      { from: "iv", to: "IV", chance: { by: { [TF]: 1 } } },
      { from: "v", to: "V", chance: { by: { [DS]: 1 } }, lastBar: true },
      { from: "V", to: "v", chance: { by: { [TF]: 1 } } },
      { from: "iv", to: "VI", chance: { base: 0.3 }, lastBar: true, kinds: ["chorus"] },
      // You Came's colours (§7.1), in major keys only: the borrowed minor v, the sus4 → 7 delay on
      // a secondary dominant, the deceptive V/vi → IV into a chorus on IV, and the bridge's IVmaj7
      // and V(add9).
      {
        from: "V",
        to: "v",
        chance: { by: { [YC]: 0.5 } },
        kinds: ["prechorus", "bridge"],
        mode: "major",
      },
      { from: "V7/vi", to: ["Vsus4/vi", "V7/vi"], chance: { by: { [YC]: 1 } }, mode: "major" },
      {
        from: "V",
        to: "V7/vi",
        chance: { by: { [YC]: 0.5 } },
        lastBar: true,
        kinds: ["verse"],
        mode: "major",
      },
      {
        from: "IV",
        to: "IVmaj7",
        chance: { by: { [YC]: 0.6 } },
        kinds: ["bridge", "interlude"],
        mode: "major",
      },
      {
        from: "V",
        to: "Vadd9",
        chance: { by: { [YC]: 0.6 } },
        kinds: ["bridge", "interlude"],
        mode: "major",
      },
    ],
    // You Came's kit is sample-based, most likely a LinnDrum or Linn 9000 (§6.4).
    kits: [
      ["sp12", { base: 1.5, by: { [DS]: -1, [YC]: -1.3 } }],
      ["linndrum", { base: 0.5, by: { [DS]: 1, [YC]: 1.5 } }],
      ["dmx", { base: 0.4, by: { [DS]: 0.4, [YC]: -0.2 } }],
    ],
    bassFigures: [
      ["ds", { base: 0.3, by: { [DS]: 2, [YC]: -0.2 } }],
      ["tf", { base: 0.3, by: { [TF]: 2, [YC]: -0.2 } }],
      ["yc", { by: { [YC]: 2.3 } }],
    ],
    liftEnding: { base: 0.1, by: { [TF]: 0.7, [YC]: -0.1 } },
    // Four TF-style songs out of five, one DS-style song in five; You Came has none.
    counter: { base: 0.2, by: { [TF]: 0.6, [YC]: -0.2 } },
    // You Came has no high sequencer, guitar, stabs, intro groove or melodic bass (§6.5).
    form: {
      seq: { base: 0.15, by: { [TF]: 0.7, [YC]: -0.15 } },
      guitar: { base: 0.1, by: { [TF]: 0.7, [YC]: -0.1 } },
      stabs: { base: 0.1, by: { [DS]: 0.5, [YC]: -0.1 } },
      introGroove: { by: { [TF]: 0.6 } },
      introKick: { base: 0.5, by: { [TF]: 0.3 } },
      introHook: { by: { [TF]: 0.5 } },
      riffIntroHook: { base: 0.1, by: { [TF]: 0.6, [YC]: -0.1 } },
      riffIntroArp: { by: { [DS]: 0.3 } },
      dsBlock: { by: { [DS]: 1 } },
      interludeHook: { by: { [TF]: 0.3 } },
      instrumentalHook: { base: 0.2, by: { [TF]: 0.5, [YC]: -0.2 } },
      turn: { base: 0.2, by: { [TF]: 0.7, [YC]: -0.2 } },
      thirdVerse: { base: 0.2, by: { [TF]: 0.6, [YC]: -0.2 } },
      extraChorus: { by: { [DS]: 0.6 } },
      verseOnLoop: { by: { [YC]: 1 } },
      preChorus: { by: { [YC]: 1 } },
      stack: { by: { [YC]: 1 } },
      chorusRiff: { by: { [YC]: 1 } },
      straightOn: { by: { [YC]: 1 } },
      breakdown: { by: { [YC]: 1 } },
      instrumental16: { by: { [YC]: 1 } },
      holdEnding: { by: { [YC]: 1 } },
    },
    drums: {
      introLowTom: false,
      openHatBeat3: false,
      bigKick14: false,
      bigPercussion: "cabasa",
      hats: "16ths",
      phraseFills: false,
      snarePickup: false,
      gatedSnare: true,
    },
    drumTraits: {
      [TF]: {
        introLowTom: true,
        openHatBeat3: true,
        bigKick14: false,
        bigPercussion: "cabasa",
        hats: "16ths",
        phraseFills: false,
        snarePickup: false,
        gatedSnare: true,
      },
      [DS]: {
        introLowTom: false,
        openHatBeat3: false,
        bigKick14: true,
        bigPercussion: "tamb",
        hats: "16ths",
        phraseFills: false,
        snarePickup: false,
        gatedSnare: true,
      },
      // §6.4: beat-&-a hats, a snare-8ths fill every 8 bars into a crash, a 4& pickup, no toms,
      // and a long plate tail on the snare instead of a gate.
      [YC]: {
        introLowTom: false,
        openHatBeat3: false,
        bigKick14: false,
        bigPercussion: "none",
        hats: "beat-and-a",
        phraseFills: true,
        snarePickup: true,
        gatedSnare: false,
      },
    },
    // TF's bass is brighter than DS's: spectral centroid 559 Hz vs 425 Hz, and DS's falls off
    // faster above 220 Hz (about 12 dB per octave). You Came's is two oscillators an octave apart
    // through a low lowpass: harmonics within 22 dB of the fundamental only up to 250–740 Hz (§6.3).
    // The records' vocal stems against our voice at each corner (compare_voice.py): True Faith's
    // is the fullest low down, You Came's the most forward, all of them wider than a mono lead.
    leadTone: {
      level: { by: { [TF]: 0.5, [DS]: 1.5, [YC]: 2 } },
      low: { by: { [TF]: 3, [DS]: 2, [YC]: 1 } },
      mid: { by: { [TF]: 2, [DS]: 4, [YC]: 5 } },
      high: { by: { [TF]: 7, [DS]: 6, [YC]: 8 } },
      air: { by: { [TF]: 6, [DS]: 6, [YC]: 5 } },
      width: { by: { [TF]: 0.45, [DS]: 0.55, [YC]: 0.58 } },
    },
    bassTone: {
      frequency: { base: 240, by: { [DS]: -80, [YC]: -60 } },
      presence: { base: 7, by: { [DS]: -6, [YC]: -5 } },
      sawCutoff: { base: 2500, by: { [DS]: -2200, [YC]: -1900 } },
      octave: { by: { [YC]: 1 } },
      sustain: { base: 0.2, by: { [YC]: 0.15 } },
      lowCut: {},
    },
  },
  italo: {
    id: "italo",
    name: "Italo",
    title: italoTitle,
    // The two Valerie Dore records share the bottom edge; Faces, the brighter DJ record, and Self
    // Control, the slowest and glossiest, the top: Self Control between Faces and The Night.
    references: [TN, GC, FC, SC],
    // 110.3 (The Night), 111.8 (Get Closer), 120.1 (Faces), 106.7 (Self Control): the centre
    // follows the blend. Only Self Control's weight opens the range below 108.
    tempo: {
      range: [106, 122],
      floor: { base: 108, by: { [SC]: -2 } },
      center: { by: { [TN]: 110.3, [GC]: 111.8, [FC]: 120.1, [SC]: 106.7 } },
      note: "Self Control runs at 106.7, Valerie Dore at 110–112, Faces at 120",
    },
    planner: "italo",
    // E minor (Get Closer), F minor (The Night), A minor (Faces).
    keyWeights: [
      [4, 3],
      [5, 3],
      [9, 3],
      [2, 1.5],
      [7, 1.5],
      [0, 1],
      [11, 1],
      [1, 0.5],
      [6, 0.5],
    ],
    // All four are minor songs; Faces' major chorus is written into its progressions.
    major: {},
    majorKeyWeights: [[9, 1]],
    bank: ITALO_BANK,
    substitutions: [
      // The Night's ♭VII over the tonic pedal and its v7; Get Closer's IV⁶ walk and its V11 into V.
      { from: "VII", to: "VII/i", chance: { by: { [TN]: 0.6 } }, kinds: ["verse", "interlude"] },
      // Self Control's triads stay plain: pure Aeolian, no 7ths.
      { from: "v", to: "v7", chance: { base: 0.2, by: { [TN]: 0.6, [SC]: -0.2 } } },
      { from: "IV", to: "IV/3", chance: { by: { [GC]: 0.5 } }, kinds: ["verse"] },
      { from: "VII7", to: ["VII7sus4", "VII7"], chance: { by: { [TN]: 1 } }, kinds: ["chorus"] },
      { from: "V", to: ["IV/V", "V"], chance: { by: { [GC]: 1 } }, lastBar: true },
    ],
    // The Night's deep, pitch-swept kick and burst clap, Faces' 909-like kick: synthesized kits,
    // with the drier sample machines for Get Closer's short kick and long snare, and Self Control's
    // dead kick and clean clap (most likely a LinnDrum, branigan-self-control.md §5.1).
    kits: [
      ["synth", { base: 0.8, by: { [TN]: 0.6, [FC]: 0.8, [SC]: -0.6 } }],
      ["dmx", { base: 0.3, by: { [GC]: 0.8, [TN]: 0.3 } }],
      ["linndrum", { base: 0.3, by: { [GC]: 0.3, [SC]: 1.5 } }],
      ["sp12", { base: 0.1 }],
    ],
    bassFigures: [
      ["italo", { base: 0.3, by: { [GC]: 2 } }],
      ["night", { by: { [TN]: 2 } }],
      ["faces", { by: { [FC]: 2 } }],
      ["sc", { by: { [SC]: 2 } }],
    ],
    liftEnding: {},
    counter: {},
    // Self Control sings its verse on the chorus's loop.
    form: { ...NO_FORM, verseOnLoop: { by: { [SC]: 1 } } },
    italo: {
      pedalIntro: { by: { [TN]: 1 } },
      buildIntro: { by: { [FC]: 1 } },
      hookIntro: { by: { [GC]: 1 } },
      leadSection: { by: { [TN]: 1 } },
      breakdown: { base: 0.2, by: { [FC]: 0.8, [GC]: 0.5, [SC]: -0.2 } },
      reprise: { by: { [TN]: 0.7 } },
      // None measured: The Night's "arpeggio" was its lead synth (the-night.md §10.3).
      verseArp: {},
      // Faces' gated stabs, Self Control's verse line.
      stabs: { base: 0.1, by: { [FC]: 0.9, [SC]: 0.9 } },
      bareFirstVerse: { by: { [FC]: 0.7 } },
      afterChorus: { base: 0.2, by: { [FC]: 0.8, [GC]: 0.6, [SC]: -0.2 } },
      riffIntro: { by: { [SC]: 1 } },
      preChorus: { by: { [SC]: 1 } },
      stabBreak: { by: { [SC]: 1 } },
      halfVerse: { by: { [SC]: 1 } },
      backing: { by: { [SC]: 1 } },
      vampOutro: { by: { [SC]: 1 } },
    },
    parts: { stabs: "gated8" },
    voices: {
      riff: "echo",
      riffPatch: "pulse",
      countervoice: "arp8",
      pad: "close",
      stabPatch: "pluck",
      arpPatch: "bell",
    },
    voiceTraits: {
      // The two-note intro riff on a bright saw, the countervoice in every chorus, octave pads
      // (the-night.md §10).
      [TN]: {
        riff: "pair",
        riffPatch: "saw",
        countervoice: "pluck8",
        pad: "octaves",
        stabPatch: "pluck",
        arpPatch: "bell",
      },
      // The echoing pulse hook and the soft chorus arpeggio (get-closer.md §10).
      [GC]: {
        riff: "echo",
        riffPatch: "pulse",
        countervoice: "arp8",
        pad: "close",
        stabPatch: "pluck",
        arpPatch: "bell",
      },
      // The plucked stab, open chorus pads, and no countervoice: the high held note in its chorus
      // is the singer's (faces.md §10).
      [FC]: {
        riff: "echo",
        riffPatch: "pulse",
        countervoice: "none",
        pad: "open",
        stabPatch: "pluck",
        arpPatch: "pluck",
      },
      // The riff in unison with the bass, brighter than a saw, the bell verse line, the bright
      // chorus comp and the pre-chorus's paired 16ths (branigan-self-control.md §11, §12).
      [SC]: {
        riff: "unison",
        riffPatch: "bright",
        countervoice: "comp",
        pad: "close",
        stabPatch: "bell",
        arpPatch: "bell",
        arp: "pairs",
      },
    },
    // The verses sit low (Faces C4–E4, Get Closer G3–A4), the choruses a 5th or so higher (Faces
    // C♯4–B4, Get Closer D4–B4, The Night A♭4–E♭5): the lift that sets the chorus apart.
    leadRanges: { verse: [55, 67], chorus: [63, 76] },
    drums: ITALO_DRUMS,
    drumTraits: {
      // Clap and snare on 2 and 4 throughout, quiet 8th hats opening on the chorus off-beats, not
      // a fill or a crash in 5:46 (the-night.md §6).
      [TN]: { ...ITALO_DRUMS, clapAlways: true, fills: "none" },
      // 8th hats, snare-16th fills closing the choruses, a noise hit on the phrase starts.
      [GC]: { ...ITALO_DRUMS, crashes: true },
      // 8ths with an open 3a, the galloping 16th cell in the choruses, the 3&–4–4& snare pickup
      // every 8 bars, no claps (faces.md §6).
      [FC]: { ...ITALO_DRUMS, hats: "8ths-open3a", bigHats: "gallop", fills: "pickup8" },
      // The kick on 1 and 3, quiet 8th hats in the verses, 16ths from the pre-chorus, the clap on 4
      // and the syncopated one on 3e in the choruses, a few snare 16ths at the section ends
      // (branigan-self-control.md §5, §12).
      [SC]: { ...ITALO_DRUMS, hats: "quiet-verse", bigClaps: "4-and-3e", kick: "1-and-3" },
    },
    // The Night's bass is dark and octave-layered, legato; Get Closer's plucked (16 dB down per
    // 8th) and dark; Faces' a bright, plucky saw with its octave partial above the fundamental.
    // The Night's voice is the brightest in the presence band and the widest (a long, wide
    // reverb); Get Closer's narrow and dark up top; Faces' thin low down and airy.
    leadTone: {
      level: { by: { [TN]: -4, [FC]: 1, [SC]: -2 } },
      low: { by: { [TN]: 1, [GC]: 1, [FC]: -3, [SC]: 5 } },
      mid: { by: { [TN]: 7, [GC]: 5, [FC]: 4, [SC]: 7 } },
      high: { by: { [TN]: 9, [GC]: 7, [FC]: 4, [SC]: 9 } },
      air: { by: { [TN]: 4, [GC]: 4, [FC]: 6, [SC]: 6 } },
      width: { by: { [TN]: 1.1, [GC]: 0.28, [FC]: 0.42, [SC]: 0.79 } },
    },
    bassTone: {
      frequency: { base: 160, by: { [FC]: 100, [SC]: -80 } },
      presence: { base: 1, by: { [FC]: 5 } },
      sawCutoff: { base: 520, by: { [FC]: 1500, [SC]: -400 } },
      octave: { by: { [TN]: 1, [GC]: 0.3, [FC]: 1 } },
      sustain: { by: { [TN]: 0.35, [GC]: 0.15, [FC]: 0.2, [SC]: 0.3 } },
      lowCut: { by: { [SC]: 65 } },
      decay: { by: { [SC]: -0.15 } },
    },
    // Each record's balance (docs/italo/mix.md): the instrumental tracks fitted to its voice-free
    // material (its instrumental sections, Self Control's instrumental version), then the voice
    // measured on top of them in its sung sections. Faces' and Get Closer's drums want more than
    // the fader gives, so their other tracks and voice come down instead. The Night's lead synth
    // and countervoice were set by ear.
    mix: {
      drums: { by: { [GC]: 3, [FC]: 3, [SC]: 2 } },
      // Self Control's bass, pads, pre-chorus 16ths and chorus chords moved by ear over the fit
      // (2026-11-12: a "really weak" bass, lines "almost inaudible"; docs/italo/mix.md).
      bass: { by: { [TN]: -10.5, [GC]: 2, [FC]: -1.5, [SC]: 2 } },
      pad: { by: { [TN]: -8.5, [GC]: -8, [FC]: -7, [SC]: -5 } },
      riff: { by: { [GC]: 1.5, [SC]: 2 } },
      counter: { by: { [GC]: 6, [SC]: 6 } },
      arp: { by: { [SC]: 4 } },
      stab: { base: -13, by: { [FC]: 1.5, [SC]: -0.5 } },
      synth: { base: 3.5 },
      lead: { by: { [GC]: -1, [FC]: -1.5 } },
    },
  },
  euro: {
    id: "euro",
    name: "Euro-disco",
    title: euroTitle,
    // The two E♭-minor records share the bottom edge; Crazy Juliet, the fastest and the one in a
    // major key, the top.
    references: [IL, HCW, CJ],
    // 115.2 (Innocent Love), 117.9 and 119.1 (Heaven Can Wait's verse and chorus clocks), 123.0
    // (Crazy Juliet).
    tempo: {
      range: [113, 125],
      center: { by: { [IL]: 115.2, [HCW]: 118.5, [CJ]: 123 } },
      note: "Innocent Love runs at 115, Heaven Can Wait at 118–119, Crazy Juliet at 123",
    },
    planner: "euro",
    // E♭ minor (Innocent Love, Heaven Can Wait, a sharp E♭ near E), G♯ minor (Crazy Juliet's
    // chorus), and the synthpop keys next to them.
    keyWeights: [
      [3, 3],
      [4, 2.5],
      [2, 1.5],
      [8, 1.5],
      [1, 1],
      [6, 1],
      [9, 1],
      [11, 1],
      [5, 0.5],
      [7, 0.5],
      [0, 0.5],
    ],
    // Crazy Juliet rests on C♯ major (its verse; ear-checked as the ending, §10 item 1).
    major: { by: { [CJ]: 1 } },
    majorKeyWeights: [
      [1, 3],
      [0, 1.5],
      [2, 1.5],
      [3, 1],
      [11, 1],
      [4, 1],
      [6, 0.5],
    ],
    bank: EURO_BANK,
    substitutions: [
      // Heaven Can Wait's chorus delays its V with a sus4; Crazy Juliet turns iv into IV⁷ on the
      // same root; Innocent Love's ♭VII hangs without its third.
      { from: "V", to: ["Vsus4", "V"], chance: { by: { [HCW]: 0.8 } }, lastBar: true },
      { from: "iv", to: "IV7", chance: { by: { [CJ]: 0.5 } }, kinds: ["prechorus"] },
      { from: "VII", to: "VII9sus4", chance: { by: { [IL]: 0.6 } }, kinds: ["chorus"] },
      // The verse's Dorian IV, the chorus's or bridge's Aeolian iv (Heaven Can Wait, Innocent Love).
      {
        from: "IV",
        to: "iv",
        chance: { by: { [HCW]: 0.4, [IL]: 0.4 } },
        kinds: ["chorus", "bridge"],
        mode: "minor",
      },
    ],
    // Innocent Love's Linn 9000 (credited on Mirrors); short, pitched sample kicks in all three.
    kits: [
      ["linndrum", { base: 0.6, by: { [IL]: 1, [HCW]: 0.4 } }],
      ["sp12", { base: 0.3, by: { [HCW]: 0.5, [CJ]: 0.6 } }],
      ["dmx", { base: 0.1, by: { [CJ]: 0.4 } }],
    ],
    bassFigures: [
      ["innocent", { by: { [IL]: 2 } }],
      ["heaven", { by: { [HCW]: 2 } }],
      ["juliet", { by: { [CJ]: 2 } }],
    ],
    liftEnding: {},
    counter: {},
    // The pre-chorus is picked in every key (compose's `preChorus` check); the rest is planEuro's.
    form: { ...NO_FORM, preChorus: { base: 1 } },
    euro: {
      staggeredIntro: { by: { [CJ]: 1 } },
      motifIntro: { by: { [HCW]: 1 } },
      padIntro: { by: { [IL]: 1 } },
      longVerse: { by: { [CJ]: 1 } },
      bareVerse: { by: { [HCW]: 1 } },
      stop: { by: { [IL]: 1, [CJ]: 1 } },
      tag: { by: { [HCW]: 1 } },
      chorusStop: { by: { [IL]: 1 } },
      straight: { by: { [CJ]: 1 } },
      leadChoruses: { by: { [CJ]: 1 } },
      instrumentalChorus: { by: { [HCW]: 1 } },
      instrumentalBlock: { by: { [IL]: 1 } },
      bridge: { by: { [IL]: 0.8 } },
      verseArp: { by: { [CJ]: 0.9 } },
      chorusArp: { by: { [HCW]: 1, [CJ]: 0.2 } },
      chorusRiff: { by: { [CJ]: 1 } },
      stabs: { by: { [IL]: 1 } },
      stack: { by: { [IL]: 0.8 } },
    },
    parts: { stabs: "follow" },
    voices: EURO_VOICES,
    voiceTraits: EURO_VOICE_TRAITS,
    // Innocent Love's verse sits low (A3–F4) and its chorus a 4th up, centred on A♭4; Heaven Can
    // Wait's verse spans D4–C♯5 and its hook A♭4–B♭4; Crazy Juliet's verse C♯4–G♯4, chorus C♯4–B4.
    leadRanges: { verse: [57, 69], chorus: [61, 73] },
    drums: { ...EURO_NO_DRUM_TRAITS, groove: HCW_GROOVE },
    drumTraits: {
      [IL]: { ...EURO_NO_DRUM_TRAITS, groove: IL_GROOVE },
      [HCW]: { ...EURO_NO_DRUM_TRAITS, groove: HCW_GROOVE },
      [CJ]: { ...EURO_NO_DRUM_TRAITS, groove: CJ_GROOVE },
    },
    leadTone: EURO_LEAD_TONE,
    // All three basses are octave-layered and dark: harmonics within 22 dB of the fundamental up to
    // 310–420 Hz (Crazy Juliet, Heaven Can Wait). Innocent Love's is a little brighter, its 8th
    // harmonic only 11 dB down on B♭1, with a weak fundamental. Notes fill their 8ths and 16ths
    // and stop at the rests.
    bassTone: {
      frequency: { base: 170, by: { [IL]: 70 } },
      presence: { base: 1, by: { [IL]: 2 } },
      sawCutoff: { base: 480, by: { [IL]: 520 } },
      octave: { base: 1 },
      sustain: { base: 0.45 },
      lowCut: {},
    },
  },
};

/** Every genre, in the order the genre select lists them. */
export const GENRE_IDS = Object.keys(GENRES) as GenreId[];

/** The genre songs, links and settings fall back to when they name none: everything made before
 * genres existed is synthpop. */
export const DEFAULT_GENRE: GenreId = "synthpop";

export function isGenreId(id: unknown): id is GenreId {
  return typeof id === "string" && Object.hasOwn(GENRES, id);
}

/** The genre an original belongs to. */
export function genreOfReference(ref: ReferenceId): GenreId {
  return GENRE_IDS.find((id) => GENRES[id].references.includes(ref)) ?? DEFAULT_GENRE;
}

/** One weight per reference, in `genre.references` order, from the legacy scalar `style`: it runs
 * from the first reference to the second; the others get 0. Saved settings and links from before
 * the weights still play this way. */
export function referenceWeights(genre: Genre, style: number): readonly number[] {
  return genre.references.map((_, i) => (i === 0 ? 1 - style : i === 1 ? style : 0));
}

/** Do these weights say no more than a legacy `style` would? (Then links store only the style.) */
export function isStyleWeights(genre: Genre, weights: readonly number[], style: number): boolean {
  const legacy = referenceWeights(genre, style);
  return weights.length === legacy.length && weights.every((w, i) => w === legacy[i]);
}

/** Weights read from storage or a link: one finite, non-negative number per reference (missing
 * ones 0), not all 0; null otherwise. */
export function parseWeights(genre: Genre, raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > genre.references.length) return null;
  const w = genre.references.map((_, i) => Number(raw[i] ?? 0));
  if (!w.every((x) => Number.isFinite(x) && x >= 0) || !w.some((x) => x > 0)) return null;
  return w.map((x) => Math.min(1, x));
}

/** The genre's style polygon: one vertex per reference (polygon.ts). */
export function genreVertices(genre: Genre): Point[] {
  return polygonVertices(genre.references.length);
}

/** The weights at a point of the genre's polygon, rounded to hundredths (they travel in links). */
export function weightsAtPoint(genre: Genre, p: Point): number[] {
  return quantize(weightsAt(genreVertices(genre), p));
}

/** A random point of the genre's polygon, as weights: the "auto" style. */
export function randomWeights(genre: Genre, random: () => number): number[] {
  return weightsAtPoint(genre, randomPoint(genreVertices(genre), random));
}

/** The genre's references' weights for a spec: its own, else its legacy style's. */
export function specWeights(genre: Genre, spec: { style: number; weights?: readonly number[] }) {
  return spec.weights ?? referenceWeights(genre, spec.style);
}

/** All the weight on one reference (an original playing). */
export function soloWeights(genre: Genre, ref: ReferenceId): readonly number[] {
  return genre.references.map((r) => (r === ref ? 1 : 0));
}

/** A reference's weight (0 when the genre doesn't have it). */
export function weightOf(genre: Genre, weights: readonly number[], ref: ReferenceId): number {
  const i = genre.references.indexOf(ref);
  return i >= 0 ? (weights[i] ?? 0) : 0;
}

/** Where weights sit on the slider's axis: the second reference's share of the first two. */
export function styleOf(weights: readonly number[]): number {
  const [a = 0, b = 0] = weights;
  return a + b > 0 ? b / (a + b) : 0.5;
}

/** Evaluates a blend. Terms are added in reference order and zero ones skipped, which keeps the
 * results identical to the expressions they replaced. */
export function blend(genre: Genre, b: Blend, weights: readonly number[]): number {
  let v = b.base ?? 0;
  genre.references.forEach((ref, i) => {
    const c = b.by?.[ref];
    if (c) v += c * (weights[i] ?? 0);
  });
  return v;
}

/** The profile read at one style: blends evaluated, drum traits resolved. */
export interface GenreAt {
  genre: Genre;
  weights: readonly number[];
  at: (b: Blend) => number;
  drums: DrumTraits;
  voices: Voices;
}

/** The profile at a slider `style`, or at explicit per-reference weights. */
export function genreAt(genre: Genre, at: number | readonly number[]): GenreAt {
  const weights = typeof at === "number" ? referenceWeights(genre, at) : at;
  return {
    genre,
    weights,
    at: (b) => blend(genre, b, weights),
    drums: dominantDrums(genre, weights),
    voices: dominantVoices(genre, weights),
  };
}

/** The reference that outweighs every other one, if any. */
function dominantReference(genre: Genre, weights: readonly number[]): ReferenceId | undefined {
  const i = weights.findIndex((w, i) => weights.every((o, j) => j === i || w > o));
  return i >= 0 ? genre.references[i] : undefined;
}

/** A reference's parts and sounds apply while it outweighs every other reference. */
export function dominantVoices(genre: Genre, weights: readonly number[]): Voices {
  const ref = dominantReference(genre, weights);
  return (ref && genre.voiceTraits?.[ref]) ?? genre.voices ?? SYNTHPOP_VOICES;
}

/** A reference's drum traits apply while it outweighs every other reference; on a tie, the
 * genre's own. (With two references: style < 0.5 is the first's, > 0.5 the second's.) */
export function dominantDrums(genre: Genre, weights: readonly number[]): DrumTraits {
  const ref = dominantReference(genre, weights);
  return (ref && genre.drumTraits[ref]) ?? genre.drums;
}

export function leadTone(genre: Genre, at: number | readonly number[]): LeadTone {
  const g = genreAt(genre, at);
  return {
    level: g.at(genre.leadTone.level),
    low: g.at(genre.leadTone.low),
    mid: g.at(genre.leadTone.mid),
    high: g.at(genre.leadTone.high),
    air: g.at(genre.leadTone.air),
    width: g.at(genre.leadTone.width),
  };
}

/** The fader offsets (dB over the defaults) a song plays at on auto, at its references' weights. */
export function mixAt(
  genre: Genre,
  at: number | readonly number[],
): Partial<Record<Track, number>> {
  const g = genreAt(genre, at);
  return Object.fromEntries(
    Object.entries(genre.mix ?? {}).map(([track, b]) => [track, g.at(b)]),
  ) as Partial<Record<Track, number>>;
}

export function bassTone(genre: Genre, at: number | readonly number[]): BassTone {
  const g = genreAt(genre, at);
  return {
    frequency: g.at(genre.bassTone.frequency),
    presence: g.at(genre.bassTone.presence),
    sawCutoff: g.at(genre.bassTone.sawCutoff),
    octave: g.at(genre.bassTone.octave),
    sustain: g.at(genre.bassTone.sustain),
    lowCut: g.at(genre.bassTone.lowCut),
    decay: 0.25 + g.at(genre.bassTone.decay ?? {}),
  };
}
