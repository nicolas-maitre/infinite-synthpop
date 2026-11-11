/**
 * The originals as songs for the same engine: the measured form, chords per section, key, tempo,
 * drum machine and bass figure (docs/analysis.md §1–§3 and, for You Came, §2 and §6; the Italo
 * records from docs/italo/ and docs/references/branigan-self-control.md, the Euro-disco ones from
 * docs/references/sandra-*.md; section lengths rounded to whole phrases). The lead melodies, riffs and melodic bass are generated, not transcribed: those are
 * the copyrighted compositions, while harmony, form and groove are what the generator studies.
 */
import type { BassStyle, CustomMelody, KitName, Layers, SectionKind } from "./composer";
import type { GenreId } from "./genres";
import type { Progression } from "./progressions";
import type { Key } from "./theory";

export type ReferenceId =
  | "true-faith"
  | "different-story"
  | "you-came"
  | "the-night"
  | "get-closer"
  | "faces"
  | "self-control"
  | "innocent-love"
  | "heaven-can-wait"
  | "crazy-juliet";

export interface ReferenceSection {
  kind: SectionKind;
  label: string;
  bars: number;
  progression: Progression;
  layers: Partial<Layers>;
  /** Defaults to the song's key. */
  key?: Key;
  /** A drum fill in the last bar; defaults to one before a verse or chorus. */
  fill?: boolean;
  /** A custom melody (the song's `melodies`) for the lead, instead of the generated one. */
  melody?: string;
}

export interface ReferenceSong {
  title: string;
  /** Where the song sits on its genre's style axis (0 = the genre's first reference … 1 = its
   * second). An original plays with all the weight on itself whatever this says (You Came and
   * Faces sit off the axis, at 0.5). */
  style: number;
  /** The genre's references' weights a creation plays with (genres.ts), in `references` order.
   * Unset: its `style`'s, `[1 − style, style, 0]` (creations from before the weights). An
   * original plays with all the weight on itself whatever this says. */
  weights?: readonly number[];
  /** The genre whose profile a creation plays with (genres.ts). Unset: synthpop (everything made
   * before genres existed). An original plays in the genre that lists it. */
  genre?: GenreId;
  key: Key;
  bpm: number;
  kit: KitName;
  bassStyle: BassStyle;
  /** The progressions the generated lead melodies are written over. */
  verse: Progression;
  chorus: Progression;
  sections: ReferenceSection[];
  /** Creator mode's own melodies, by id. */
  melodies?: Record<string, CustomMelody>;
}

// From the MIDI transcription's sequence bass (the audio chord reading missed the second line).
const TF_VERSE: Progression = [
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
];
const TF_CHORUS: Progression = [["i"], ["III"], ["VII"], ["IV"]];

const DS_VERSE: Progression = [["i"], ["VI"], ["VII"], ["v"], ["i"], ["VI"], ["iv"], ["V"]];
const DS_CHORUS: Progression = [["i"], ["III"], ["VII"], ["iv"]];
const DS_INTERLUDE: Progression = [["III"], ["VII"], ["iv"], ["i", "VII"]];
const DS_TURNAROUND: Progression = [["ii"], ["ii"], ["IV"], ["IV"]];

// You Came, in E major (§6.2). The loop is IV │ V │ IV │ V–I⁶: the bass drops to G♯ (E/G♯) on bar
// 4's beat 3 every 4 bars in the hook, verses and choruses 1–2, every 8 in chorus 3 and the outro.
// Into a pre-chorus, bar 4 turns to E instead, pushed an 8th early by the bass (ycBassLine).
const YC_LOOP: Progression = [["IV"], ["V"], ["IV"], ["V", "I/3"]];
const YC_LOOP8: Progression = [["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V", "I/3"]];
const YC_VERSE: Progression = [
  ["IV"],
  ["V"],
  ["IV"],
  ["V", "I/3"],
  ["IV"],
  ["V"],
  ["IV"],
  ["V", "I"],
];
// Chorus 2's 12th bar (2:12) lands on E, the only root-position tonic inside a chorus.
const YC_CHORUS2: Progression = [
  ...YC_LOOP,
  ...YC_LOOP,
  ["IV"],
  ["V"],
  ["IV"],
  ["V", "I"],
  ...YC_LOOP,
];
// C♯ │ F♯m │ E │ Bm │ F♯m │ E │ G♯sus4 │ G♯7, leaving deceptively to the loop's A.
const YC_PRECHORUS: Progression = [
  ["V/ii"],
  ["ii"],
  ["I"],
  ["v"],
  ["ii"],
  ["I"],
  ["Vsus4/vi"],
  ["V7/vi"],
];

// The Night, in F minor (the-night.md §4): the Dorian verse loop over an F pedal in its bar 2, the
// chorus in the relative major, and the intro's pedal.
const TN_VERSE: Progression = [["i"], ["VII/i"], ["v7"], ["IV"]];
const TN_CHORUS: Progression = [["IIIadd9"], ["VI/3"], ["II"], ["VII7sus4", "VII7"]];
const TN_PEDAL: Progression = [["i"], ["VII/i"]];

// Get Closer, in E minor (get-closer.md §4): pads i │ ♭VII │ IV │ ♭VI over a bass i │ i │ IV │ ♭VII.
// Verse 1 puts C♯ under the A in its 7th and 15th bars (IV⁶), so the bass climbs E–C♯–D.
const GC_LOOP: Progression = [["i"], ["VII/i"], ["IV"], ["VI/VII"]];
const GC_VERSE1: Progression = [...GC_LOOP, ["i"], ["VII/i"], ["IV/3"], ["VI/VII"]];
const GC_CHORUS: Progression = [["i"], ["VI/3"], ["VII"], ["IV/V", "V"]];

// Faces, in A minor (faces.md §4): the royal-road loop, which the intro plays with the Em held
// through its second bar; the A major chorus, 8 + 8 bars; the breakdown on its turnaround.
const FC_LOOP: Progression = [
  ["VImaj7", "VIIsus4"],
  ["v7", "i7"],
];
const FC_INTRO: Progression = [["VImaj7", "VIIsus4"], ["v7"]];
const FC_TURN: Progression = [
  ["I", "vi7"],
  ["VII", "V7sus4"],
];
const FC_CHORUS_A: Progression = [
  ["I"],
  ["v7", "IVmaj7"],
  ["I"],
  ["v7", "IVmaj7"],
  ["I"],
  ["v7", "IVmaj7"],
  ...FC_TURN,
];
const FC_CHORUS_B: Progression = [
  ["I"],
  ["v7", "IVmaj7"],
  ["I"],
  ["v7", "IVmaj7"],
  ...FC_TURN,
  ...FC_TURN,
];
const FC_CHORUS: Progression = [...FC_CHORUS_A, ...FC_CHORUS_B];

const band = { drums: "full", bass: true, pad: true } as const;

// Laura Branigan's Self Control (docs/references/branigan-self-control.md §2–§3), in F♯ minor: one
// 8-bar Aeolian loop under the verse, the pre-chorus and the chorus; the intro riff, the breaks and
// the outro on i–v.
const SC_LOOP: Progression = [["i"], ["v"], ["i"], ["v"], ["VII"], ["iv"], ["VI"], ["III"]];
const SC_VAMP: Progression = [["i"], ["v"]];

// The three Sandra records (docs/references/sandra-*.md §3–§4), as the Euro-disco genre's bank
// reads them (genres.ts).
// Innocent Love, in E♭ minor: the verse over the v pedal, the pre-chorus and its ♭VI–V turn (the
// turn's last bar a stop), the chorus loop 3½ times round, the late Aeolian bridge.
const IL_VERSE: Progression = [["v"], ["ii7/v"], ["v"], ["I/v"]];
const IL_PRE: Progression = [["i"], ["viø7"], ["i"], ["viø7"], ["VI"], ["V"]];
const IL_LOOP: Progression = [["i"], ["IVsus4", "IV"], ["VII9sus4"], ["III"]];
const IL_CHORUS: Progression = [...IL_LOOP, ...IL_LOOP, ...IL_LOOP, ["i"], ["IVsus4", "IV"]];
const IL_BRIDGE: Progression = [
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
];
// Heaven Can Wait, in E♭ minor: the IV⁷ vamp, the pre-chorus over the IV pedal, the 14-bar chorus.
const HCW_VERSE: Progression = [["IV7"], ["IV7"]];
const HCW_PRE: Progression = [
  ["III/IV"],
  ["VII/IV"],
  ["IV"],
  ["IV"],
  ["III/IV"],
  ["VII/IV"],
  ["IV"],
  ["IV"],
];
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
// Crazy Juliet, in C♯ major: the Mixolydian verse, the pre-chorus to IV⁷ (a stop bar), the chorus
// on the minor v with its 4-bar tag.
const CJ_VERSE: Progression = [["I"], ["I"], ["I"], ["I"], ["ii"], ["VII"], ["I"], ["I"]];
const CJ_PRE: Progression = [["iv"], ["IIIadd9"], ["VII"], ["IV7sus4"], ["IV7"]];
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

export const REFERENCES: Record<ReferenceId, ReferenceSong> = {
  // 5:55, about 173 bars (the MIDI transcription's layout; the audio beat count lost bars in the
  // fade). The sequence bass plays the figure from 0:08 (bar 4) to the end, Hook's bass joins in
  // the intro, and the high 16th sequencer runs from the first turnaround (the MIDI's bar 46) on.
  // The bridge sits on a D pedal. The outro modulates: the chorus's IV (G) becomes the tonic.
  // The MIDI's "Synth Lead" is the counter-line above the vocal, in every chorus.
  "true-faith": {
    title: "True Faith",
    style: 0,
    key: { tonic: 2, mode: "minor" },
    bpm: 117,
    kit: "sp12",
    bassStyle: "tf",
    verse: TF_VERSE,
    chorus: TF_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro · drums",
        bars: 4,
        progression: TF_CHORUS,
        layers: { drums: "groove" },
      },
      {
        kind: "intro",
        label: "Intro",
        bars: 11,
        progression: TF_CHORUS,
        layers: { ...band, hook: true },
      },
      {
        kind: "turnaround",
        label: "Turn · VI",
        bars: 2,
        progression: [["VI"]],
        layers: { ...band, hook: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: TF_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 12,
        progression: TF_CHORUS,
        layers: { guitar: true, ...band, drums: "big", lead: "chorus", counter: true },
      },
      {
        kind: "turnaround",
        label: "Turn · VI–VII",
        bars: 2,
        progression: [["VI"], ["VII"]],
        layers: { guitar: true, ...band, seq: true, bassShort: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 16,
        progression: TF_VERSE,
        layers: { ...band, seq: true, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 12,
        progression: TF_CHORUS,
        layers: {
          guitar: true,
          ...band,
          drums: "big",
          seq: true,
          lead: "chorus",
          arp: true,
          counter: true,
        },
      },
      {
        kind: "turnaround",
        label: "Turn · VI–VII",
        bars: 2,
        progression: [["VI"], ["VII"]],
        layers: { guitar: true, ...band, seq: true, bassShort: true },
      },
      {
        kind: "bridge",
        label: "Bridge · D pedal",
        bars: 7,
        progression: [["VI"], ["i"], ["i"], ["i"], ["i", "III"], ["i"], ["v"]],
        layers: { guitar: true, ...band, seq: true, hook: true },
      },
      {
        kind: "interlude",
        label: "Instrumental chorus",
        bars: 13,
        // The MIDI's bars 84–96: an extra i–III pair, then the chorus from its VII.
        progression: [
          ["i"],
          ["III"],
          ["i"],
          ["III"],
          ["VII"],
          ["IV"],
          ["i"],
          ["III"],
          ["VII"],
          ["IV"],
          ["i"],
          ["III"],
          ["VII"],
        ],
        layers: { guitar: true, ...band, seq: true, riff: true, hook: true },
      },
      {
        kind: "turnaround",
        label: "Turn · VI",
        bars: 2,
        progression: [["VI"]],
        layers: { guitar: true, ...band, seq: true },
      },
      {
        kind: "verse",
        label: "Verse 3",
        bars: 16,
        progression: TF_VERSE,
        layers: { ...band, seq: true, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 12,
        progression: TF_CHORUS,
        layers: {
          guitar: true,
          ...band,
          drums: "big",
          seq: true,
          lead: "chorus",
          arp: true,
          counter: true,
        },
      },
      {
        kind: "turnaround",
        label: "Turn · VI",
        bars: 1,
        progression: [["VI"]],
        layers: { guitar: true, ...band, seq: true, bassShort: true },
      },
      {
        kind: "chorus",
        label: "Chorus 4 · double",
        bars: 12,
        progression: TF_CHORUS,
        layers: {
          guitar: true,
          ...band,
          drums: "big",
          seq: true,
          lead: "chorus",
          leadDouble: true,
          arp: true,
          counter: true,
        },
      },
      {
        kind: "turnaround",
        label: "Turn · VI",
        bars: 1,
        progression: [["VI"]],
        layers: { guitar: true, ...band, seq: true, bassShort: true },
      },
      {
        kind: "outro",
        label: "Outro · G major",
        bars: 32,
        progression: [["I"]],
        key: { tonic: 7, mode: "major" },
        layers: { guitar: true, ...band, seq: true, hook: true, riff: true, bassShort: true },
      },
    ],
  },
  // Single version, 3:50, 112 bars: bass from the first bar, interlude + Dorian turnaround +
  // break between the choruses, then choruses to the fade.
  "different-story": {
    title: "The Different Story",
    style: 1,
    key: { tonic: 4, mode: "minor" },
    bpm: 119.8,
    kit: "linndrum",
    bassStyle: "ds",
    verse: DS_VERSE,
    chorus: DS_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro · hit",
        bars: 2,
        progression: [["i"]],
        layers: { drums: "kick", bass: true, stabs: true },
      },
      {
        kind: "intro",
        label: "Intro · riff",
        bars: 12,
        progression: DS_CHORUS,
        layers: { ...band, riff: true, stabs: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: DS_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 8,
        progression: DS_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true },
      },
      {
        kind: "interlude",
        label: "Interlude",
        bars: 8,
        progression: DS_INTERLUDE,
        layers: { ...band, riff: true, arp: true },
      },
      {
        kind: "turnaround",
        label: "Turnaround · ii–IV",
        bars: 4,
        progression: DS_TURNAROUND,
        layers: { ...band },
      },
      { kind: "break", label: "Break", bars: 2, progression: [["i"]], layers: { pad: true } },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 8,
        progression: DS_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 8,
        progression: DS_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true, arp: true },
      },
      {
        kind: "interlude",
        label: "Interlude",
        bars: 8,
        progression: DS_INTERLUDE,
        layers: { ...band, riff: true, arp: true },
      },
      {
        kind: "turnaround",
        label: "Turnaround · ii–IV",
        bars: 4,
        progression: DS_TURNAROUND,
        layers: { ...band },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 8,
        progression: DS_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true, arp: true },
      },
      {
        kind: "chorus",
        label: "Chorus 4 · double",
        bars: 8,
        progression: DS_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadDouble: true, arp: true },
      },
      {
        kind: "outro",
        label: "Chorus to fade",
        bars: 16,
        progression: DS_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadDouble: true, riff: true },
      },
    ],
  },
  // Album version (the file is the 4:33 album cut on Close, not the 7″ edit), 135 bars at 119.0
  // BPM, every section boundary exact to the bar (§2). The kit is the closest sample kit to the
  // measured one (§6.4: short, falling kick, smooth untreated snare tail; LinnDrum or Linn 9000 by
  // the sources). The verse and chorus share the loop: the verse is the lead alone, the chorus
  // stacked voices and the riff. Contrast comes from muting (§6.5): no bass in the intro, the
  // breakdown, the bridge or the break; no snare in the breakdown; the riff rests in the verses.
  // The bridge's bass pickups and the breakdown's bare roots-and-fifths pads are left out.
  "you-came": {
    title: "You Came",
    style: 0.5,
    key: { tonic: 4, mode: "major" },
    bpm: 119,
    kit: "linndrum",
    bassStyle: "yc",
    verse: YC_VERSE,
    chorus: YC_LOOP,
    sections: [
      {
        kind: "intro",
        label: "Intro · pad on IV",
        bars: 2,
        progression: [["IV"]],
        layers: { pad: true },
      },
      {
        kind: "intro",
        label: "Intro · the loop",
        bars: 4,
        progression: [["IV"], ["V"], ["IVadd9"], ["V"]],
        layers: { pad: true },
      },
      {
        kind: "intro",
        label: "Hook",
        bars: 8,
        progression: YC_LOOP,
        layers: { ...band, riff: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 8,
        progression: YC_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus 1",
        bars: 8,
        progression: YC_PRECHORUS,
        layers: { ...band, arp: true, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 8,
        progression: YC_LOOP,
        layers: { ...band, riff: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 8,
        progression: YC_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus 2",
        bars: 8,
        progression: YC_PRECHORUS,
        layers: { ...band, arp: true, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2 · ×2",
        bars: 16,
        progression: YC_CHORUS2,
        layers: { ...band, riff: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "verse",
        label: "Breakdown",
        bars: 8,
        progression: [["IV"], ["V"]],
        layers: { drums: "breakdown", pad: true, lead: "verse" },
      },
      {
        kind: "bridge",
        label: "Bridge",
        bars: 4,
        progression: [["IVmaj7"], ["Vadd9"], ["IV/3"], ["Vsus4", "V"]],
        layers: { drums: "breakdown", pad: true, lead: "verse" },
        fill: true,
      },
      {
        kind: "chorus",
        label: "Chorus 3 · ×2",
        bars: 16,
        progression: YC_LOOP8,
        layers: { ...band, riff: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "break",
        label: "Break",
        bars: 8,
        progression: [["IVadd9"], ["V"]],
        layers: { drums: "hats16", pad: true },
      },
      {
        kind: "interlude",
        label: "Instrumental",
        bars: 8,
        progression: YC_LOOP8,
        layers: { ...band, drums: "hats16" },
      },
      {
        kind: "interlude",
        label: "Instrumental · riff",
        bars: 8,
        progression: YC_LOOP8,
        layers: { ...band, riff: true },
      },
      {
        kind: "chorus",
        label: "Final chorus",
        bars: 8,
        progression: YC_LOOP8,
        layers: { ...band, riff: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "outro",
        label: "Ending · IV held",
        bars: 5,
        progression: [["IV"]],
        layers: { pad: true },
      },
    ],
  },
  // Original Mix, 5:46 at 110.3 BPM, 152 bars (the-night.md §2): the second half repeats the
  // first with a longer pedal block, then the last chorus fades. Chorus 3 and the fade run 25 bars,
  // rounded to 24 (six loops). The layers are the Italo planner's (composer.ts `planItalo`): pads
  // leave for the riff bars, the bass for the drops, the lead synth opens each half before the
  // voice, and the plucked countervoice plays in every chorus. No fills (the drum traits).
  "the-night": {
    title: "The Night",
    style: 0,
    key: { tonic: 5, mode: "minor" },
    bpm: 110.3,
    kit: "synth",
    bassStyle: "night",
    verse: TN_VERSE,
    chorus: TN_CHORUS,
    sections: [
      { kind: "intro", label: "Intro · pedal", bars: 2, progression: TN_PEDAL, layers: band },
      {
        kind: "intro",
        label: "Intro · riff",
        bars: 2,
        progression: TN_PEDAL,
        layers: { drums: "full", bass: true, riff: true },
      },
      {
        kind: "intro",
        label: "Intro · bass drop",
        bars: 2,
        progression: TN_PEDAL,
        layers: { drums: "full", riff: true },
      },
      { kind: "intro", label: "Intro · loop", bars: 4, progression: TN_VERSE, layers: band },
      {
        kind: "interlude",
        label: "Lead synth",
        bars: 12,
        progression: TN_VERSE,
        layers: { ...band, leadSynth: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: TN_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 16,
        progression: TN_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", counter: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 16,
        progression: TN_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 16,
        progression: TN_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", counter: true },
      },
      // Bars 87–96: the pedal and riff blocks twice, then the drop.
      { kind: "intro", label: "Reprise · pedal", bars: 2, progression: TN_PEDAL, layers: band },
      {
        kind: "intro",
        label: "Reprise · riff",
        bars: 2,
        progression: TN_PEDAL,
        layers: { drums: "full", bass: true, riff: true },
      },
      { kind: "intro", label: "Reprise · pedal", bars: 2, progression: TN_PEDAL, layers: band },
      {
        kind: "intro",
        label: "Reprise · riff",
        bars: 2,
        progression: TN_PEDAL,
        layers: { drums: "full", bass: true, riff: true },
      },
      {
        kind: "intro",
        label: "Reprise · bass drop",
        bars: 2,
        progression: TN_PEDAL,
        layers: { drums: "full", riff: true },
      },
      { kind: "intro", label: "Reprise · loop", bars: 4, progression: TN_VERSE, layers: band },
      {
        kind: "interlude",
        label: "Lead synth",
        bars: 12,
        progression: TN_VERSE,
        layers: { ...band, leadSynth: true },
      },
      {
        kind: "verse",
        label: "Verse 3",
        bars: 16,
        progression: TN_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 3 · fade",
        bars: 24,
        progression: TN_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", counter: true },
      },
    ],
  },
  // The single, 3:36 at 112.3 BPM (get-closer.md §3): 16-bar blocks after an 8-bar intro, 96
  // bars. The outro's 8 bars and its 2-bar fade on Em are rounded to 8, the fade over them. The
  // 16th-line hook plays only in the hook, the countervoice in the choruses and the outro (a chorus
  // without the voice). Snare fills close every verse and chorus, none the hook. The kit is the
  // closer of the two sample machines the drums suggest (§6: a DMX or a LinnDrum).
  "get-closer": {
    title: "Get Closer",
    style: 1,
    key: { tonic: 4, mode: "minor" },
    bpm: 112.3,
    kit: "dmx",
    bassStyle: "italo",
    verse: GC_LOOP,
    chorus: GC_CHORUS,
    sections: [
      { kind: "intro", label: "Intro", bars: 8, progression: GC_LOOP, layers: band },
      {
        kind: "intro",
        label: "Hook",
        bars: 16,
        progression: GC_LOOP,
        layers: { ...band, riff: true },
        fill: false,
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: GC_VERSE1,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 16,
        progression: GC_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", counter: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 16,
        progression: GC_LOOP,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 16,
        progression: GC_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", counter: true },
        fill: true,
      },
      {
        kind: "outro",
        label: "Outro · chorus to fade",
        bars: 8,
        progression: GC_CHORUS,
        layers: { ...band, drums: "big", counter: true },
      },
    ],
  },
  // The 12″ mix, 5:40 at 120.1 BPM, 168 bars to the end of the fade (faces.md §3), every section
  // a multiple of 4 bars. The verse world is the Italo planner's: stabs instead of pads, the held
  // line in an instrumental from its 9th bar; the chorus brings the open pads and the held bass.
  // Instrumental 3's stab rest (bars 97–103) and its synth lead before bar 104 are left out: it
  // plays the stabs throughout and the held line from its 9th bar. The breakdown's stabs come back
  // in its second half, as on the record. The last chorus plays the chorus's second half, then its
  // first, and fades.
  faces: {
    title: "Faces",
    style: 0.5,
    key: { tonic: 9, mode: "minor" },
    bpm: 120.1,
    kit: "synth",
    bassStyle: "faces",
    verse: FC_LOOP,
    chorus: FC_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro · bass and kick",
        bars: 4,
        progression: FC_INTRO,
        layers: { drums: "kick", bass: true },
      },
      {
        kind: "intro",
        label: "Intro · stabs",
        bars: 4,
        progression: FC_INTRO,
        layers: { drums: "kick", bass: true, stabs: true },
      },
      {
        kind: "interlude",
        label: "Instrumental 1",
        bars: 16,
        progression: FC_LOOP,
        layers: { drums: "full", bass: true, stabs: true, held: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: FC_LOOP,
        layers: {
          drums: "full",
          bass: true,
          lead: "verse",
          stabs: true,
          held: true,
          bassHeld: true,
        },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 16,
        progression: FC_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true },
      },
      {
        kind: "interlude",
        label: "Instrumental 2",
        bars: 8,
        progression: FC_LOOP,
        layers: { drums: "full", bass: true, stabs: true, held: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 16,
        progression: FC_LOOP,
        layers: { drums: "full", bass: true, lead: "verse", stabs: true, held: true },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 16,
        progression: FC_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true },
      },
      {
        kind: "interlude",
        label: "Instrumental 3",
        bars: 24,
        progression: FC_LOOP,
        layers: { drums: "full", bass: true, stabs: true, held: true },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 16,
        progression: FC_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", stabs: true },
      },
      {
        kind: "break",
        label: "Breakdown",
        bars: 8,
        progression: FC_TURN,
        layers: { drums: "full", pad: true, arp: true },
      },
      {
        kind: "break",
        label: "Breakdown · stabs",
        bars: 8,
        progression: FC_TURN,
        layers: { drums: "full", pad: true, arp: true, stabs: true },
      },
      {
        kind: "chorus",
        label: "Chorus 4 · fade",
        bars: 16,
        progression: [...FC_CHORUS_B, ...FC_CHORUS_A],
        layers: { ...band, drums: "big", lead: "chorus", stabs: true },
      },
    ],
  },
  // The single, 106 bars and a fade at 106.69 BPM, every section boundary exact to the bar (§2.1).
  // The kit is the closest sample kit to the measured one (§5.1: a dead kick, a clean clap, most
  // likely a LinnDrum). The sections differ by their drums and parts, not their chords: no hats in
  // the verses, 16ths from the pre-chorus, claps and the bright high part in the choruses, one
  // reverbed hit on beat 2 in the breaks. The verses play offbeat chops; the pre-chorus carries the
  // title line; the voice is stacked in the choruses (its backing voices).
  "self-control": {
    title: "Self Control",
    style: 0.5,
    key: { tonic: 6, mode: "minor" },
    bpm: 106.7,
    kit: "linndrum",
    bassStyle: "sc",
    verse: SC_LOOP,
    chorus: SC_LOOP,
    sections: [
      {
        kind: "intro",
        label: "Intro · pad",
        bars: 4,
        progression: [["i7"]],
        layers: { drums: "half", pad: true },
      },
      {
        kind: "intro",
        label: "Intro · riff",
        bars: 4,
        progression: SC_VAMP,
        layers: { drums: "full", bass: true, riff: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: SC_LOOP,
        layers: { ...band, stabs: true, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus · title line",
        bars: 16,
        progression: SC_LOOP,
        layers: { ...band, stabs: true, lead: "verse", titleLine: true },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 16,
        progression: SC_LOOP,
        layers: { ...band, drums: "big", counter: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "break",
        label: "Break · stab on 2",
        bars: 4,
        progression: SC_VAMP,
        layers: { drums: "stab", stabs: true, lead: "chorus" },
        fill: true,
      },
      {
        kind: "break",
        label: "Drums and voice",
        bars: 2,
        progression: SC_VAMP,
        layers: { drums: "full", lead: "chorus" },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 8,
        progression: SC_LOOP,
        layers: { ...band, stabs: true, lead: "verse" },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 16,
        progression: SC_LOOP,
        layers: { ...band, drums: "big", counter: true, lead: "chorus", leadStack: true },
      },
      {
        kind: "break",
        label: "Break · stab on 2",
        bars: 4,
        progression: SC_VAMP,
        layers: { drums: "stab", stabs: true, lead: "chorus" },
        fill: true,
      },
      {
        kind: "outro",
        label: "Outro · i–v vamp",
        bars: 16,
        progression: SC_VAMP,
        layers: { ...band, drums: "big", counter: true, lead: "chorus" },
      },
    ],
  },

  // The album version, 150 bars at 115.18 BPM (sandra-innocent-love.md §4.1): an 8 + 4 + 2 bar
  // verse unit (the v pedal, the pre-chorus, the turn with its stop on 2), 14-bar choruses each
  // followed by a 2-bar stop on ♭VII without bass, then the bass's link back; an instrumental block
  // (link, verse and pre-chorus without the voice), the late bridge ending on a stop, and two
  // choruses to the fade (32 bars). The intro's B │ D♭ bars carry no voice here (on the record, a
  // few held notes). Stacked voices and stabs on the bass's rhythm in every chorus.
  "innocent-love": {
    title: "Innocent Love",
    style: 0,
    key: { tonic: 3, mode: "minor" },
    bpm: 115.2,
    kit: "linndrum",
    bassStyle: "innocent",
    verse: IL_VERSE,
    chorus: IL_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro",
        bars: 8,
        progression: [["i"], ["i"], ["v"], ["v"]],
        layers: { drums: "hats16", pad: true, arp: true },
      },
      {
        kind: "intro",
        label: "Intro · ♭VI–♭VII",
        bars: 4,
        progression: [["VI"], ["VII"]],
        layers: { drums: "hats16", pad: true, arp: true },
      },
      {
        kind: "intro",
        label: "Link",
        bars: 2,
        progression: [["i7"], ["VII"]],
        layers: { bass: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 8,
        progression: IL_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus and turn",
        bars: 6,
        progression: IL_PRE,
        layers: { ...band, lead: "verse", stop: true },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 14,
        progression: IL_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadStack: true, stabs: true },
      },
      {
        kind: "break",
        label: "Stop",
        bars: 2,
        progression: [["VII"]],
        layers: { drums: "half", pad: true },
      },
      {
        kind: "intro",
        label: "Link",
        bars: 2,
        progression: [["i7"], ["VII"]],
        layers: { bass: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 8,
        progression: IL_VERSE,
        layers: { ...band, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus and turn",
        bars: 6,
        progression: IL_PRE,
        layers: { ...band, lead: "verse", stop: true },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 14,
        progression: IL_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadStack: true, stabs: true },
      },
      {
        kind: "break",
        label: "Stop",
        bars: 2,
        progression: [["VII"]],
        layers: { drums: "half", pad: true },
      },
      // B♭11 │ E♭maj7 │ B♭11 │ D♭ → E♭, the song's only four-on-the-floor.
      {
        kind: "interlude",
        label: "Instrumental link",
        bars: 4,
        progression: [["ii7/v"], ["I"], ["ii7/v"], ["VII", "I"]],
        layers: { drums: "groove", bass: true, pad: true, leadSynth: true },
      },
      {
        kind: "verse",
        label: "Instrumental verse",
        bars: 8,
        progression: IL_VERSE,
        layers: { ...band, leadSynth: true },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus and turn",
        bars: 6,
        progression: IL_PRE,
        layers: { ...band, stop: true },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 14,
        progression: IL_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadStack: true, stabs: true },
      },
      {
        kind: "bridge",
        label: "Bridge",
        bars: 10,
        progression: IL_BRIDGE,
        layers: {
          ...band,
          drums: "big",
          lead: "chorus",
          leadStack: true,
          stabs: true,
          stop: true,
        },
      },
      {
        kind: "chorus",
        label: "Chorus 4",
        bars: 14,
        progression: IL_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadStack: true, stabs: true },
      },
      {
        kind: "chorus",
        label: "Chorus 5 · fade",
        bars: 18,
        progression: IL_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", leadStack: true, stabs: true },
      },
    ],
  },
  // The album / single version, 4:04 (sandra-heaven-can-wait.md §3), 118 bars. The record runs
  // two clocks, 117.9 BPM until each chorus and 119.1 from it; the engine has one, between them
  // (the genre's centre). A solo synth motif opens it, then drums and bass alone; bare verses of
  // drums, bass and voice; pre-choruses over the IV pedal with pads and the 16th pulse; 14-bar
  // choruses, the first and last followed by a 2-bar tag on i; an instrumental chorus (its first 12
  // bars) into a 2-bar break on V without bass; then pads alone, the kit thinning to hats, to the
  // end.
  "heaven-can-wait": {
    title: "Heaven Can Wait",
    style: 1,
    key: { tonic: 3, mode: "minor" },
    bpm: 118.5,
    kit: "linndrum",
    bassStyle: "heaven",
    verse: HCW_VERSE,
    chorus: HCW_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro · motif",
        bars: 4,
        progression: [["i"]],
        layers: { riff: true },
      },
      {
        kind: "intro",
        label: "Groove",
        bars: 4,
        progression: HCW_VERSE,
        layers: { drums: "full", bass: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 8,
        progression: HCW_VERSE,
        layers: { drums: "full", bass: true, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus",
        bars: 8,
        progression: HCW_PRE,
        layers: { ...band, lead: "verse", arp: true },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 14,
        progression: HCW_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", arp: true },
      },
      {
        kind: "chorus",
        label: "Tag",
        bars: 2,
        progression: [["i"]],
        layers: { ...band, drums: "big", arp: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 8,
        progression: HCW_VERSE,
        layers: { drums: "full", bass: true, lead: "verse" },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus",
        bars: 8,
        progression: HCW_PRE,
        layers: { ...band, lead: "verse", arp: true },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 14,
        progression: HCW_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", arp: true },
      },
      {
        kind: "chorus",
        label: "Instrumental chorus",
        bars: 12,
        progression: HCW_CHORUS,
        layers: { ...band, drums: "big", arp: true },
      },
      {
        kind: "break",
        label: "Break on V",
        bars: 2,
        progression: [["V"]],
        layers: { drums: "full", pad: true },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 14,
        progression: HCW_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", arp: true },
      },
      {
        kind: "chorus",
        label: "Chorus 4",
        bars: 14,
        progression: HCW_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", arp: true },
      },
      {
        kind: "chorus",
        label: "Tag",
        bars: 2,
        progression: [["i"]],
        layers: { ...band, drums: "big", arp: true },
      },
      {
        kind: "outro",
        label: "Outro · pads",
        bars: 4,
        progression: [["VII"], ["VII"], ["i"], ["i"]],
        layers: { drums: "half", pad: true },
      },
    ],
  },
  // The album version, 125 bars at 123.0 BPM (sandra-crazy-juliet.md §3), every section start
  // exact to the bar: the staggered intro over the verse chords, 16-bar verses, 5-bar pre-choruses
  // ending on a stop bar, then 10-bar choruses back to back to the fade, two of them instrumental on
  // the bright lead. The fading 6th chorus's 5 bars round to 6 (three passes of the loop). The
  // verses' 16th figure and the chorus riff play throughout.
  "crazy-juliet": {
    title: "Crazy Juliet",
    style: 0.5,
    key: { tonic: 1, mode: "major" },
    bpm: 123,
    kit: "sp12",
    bassStyle: "juliet",
    verse: CJ_VERSE,
    chorus: CJ_CHORUS,
    sections: [
      {
        kind: "intro",
        label: "Intro",
        bars: 4,
        progression: [["I"]],
        layers: { pad: true, riff: true },
      },
      {
        kind: "intro",
        label: "Intro · hats and bass",
        bars: 2,
        progression: [["ii"], ["VII"]],
        layers: { drums: "hats16", bass: true, pad: true, riff: true },
      },
      {
        kind: "intro",
        label: "Intro · kit",
        bars: 2,
        progression: [["I"]],
        layers: { drums: "full", pad: true, riff: true },
      },
      {
        kind: "verse",
        label: "Verse 1",
        bars: 16,
        progression: CJ_VERSE,
        layers: { ...band, lead: "verse", arp: true },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus",
        bars: 5,
        progression: CJ_PRE,
        layers: { ...band, lead: "verse", arp: true, stop: true },
      },
      {
        kind: "chorus",
        label: "Chorus 1",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
      {
        kind: "verse",
        label: "Verse 2",
        bars: 16,
        progression: CJ_VERSE,
        layers: { ...band, lead: "verse", arp: true },
      },
      {
        kind: "prechorus",
        label: "Pre-chorus",
        bars: 5,
        progression: CJ_PRE,
        layers: { ...band, lead: "verse", arp: true, stop: true },
      },
      {
        kind: "chorus",
        label: "Chorus 2",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
      {
        kind: "chorus",
        label: "Chorus 3",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
      {
        kind: "chorus",
        label: "Instrumental chorus",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", riff: true, leadSynth: true },
      },
      {
        kind: "chorus",
        label: "Instrumental chorus",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", riff: true, leadSynth: true },
      },
      {
        kind: "chorus",
        label: "Chorus 4",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
      {
        kind: "chorus",
        label: "Chorus 5",
        bars: 10,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
      {
        kind: "chorus",
        label: "Chorus 6 · fade",
        bars: 6,
        progression: CJ_CHORUS,
        layers: { ...band, drums: "big", lead: "chorus", riff: true },
      },
    ],
  },
};
