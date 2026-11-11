/**
 * The originals as songs for the same engine: the measured form, chords per section, key, tempo,
 * drum machine and bass figure (docs/analysis.md §1–§3 and, for You Came, §2 and §6; section
 * lengths rounded to whole phrases). The lead melodies, riffs and melodic bass are generated, not transcribed: those are
 * the copyrighted compositions, while harmony, form and groove are what the generator studies.
 */
import type { BassStyle, CustomMelody, KitName, Layers, SectionKind } from "./composer";
import type { GenreId } from "./genres";
import type { Progression } from "./progressions";
import type { Key } from "./theory";

export type ReferenceId = "true-faith" | "different-story" | "you-came";

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
  /** Where the song sits on the style axis (0 = True Faith … 1 = The Different Story). An
   * original plays with all the weight on itself whatever this says (You Came sits off the axis,
   * at 0.5). */
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

const band = { drums: "full", bass: true, pad: true } as const;

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
};
