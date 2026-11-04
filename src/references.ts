/**
 * The two originals as songs for the same engine: the measured form, chords per section, key,
 * tempo, drum machine and bass figure (docs/analysis.md §1–§3; section lengths rounded to whole
 * phrases). The lead melodies, riffs and melodic bass are generated, not transcribed: those are
 * the copyrighted compositions, while harmony, form and groove are what the generator studies.
 */
import type { BassStyle, CustomMelody, KitName, Layers, SectionKind } from "./composer";
import type { Progression } from "./progressions";
import type { Key } from "./theory";

export type ReferenceId = "true-faith" | "different-story";

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
  /** Where the song sits on the style axis (0 = True Faith … 1 = The Different Story). */
  style: number;
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

const band = { drums: "full", bass: true, pad: true } as const;

export const REFERENCES: Record<ReferenceId, ReferenceSong> = {
  // 5:55, about 173 bars (the MIDI transcription's layout; the audio beat count lost bars in the
  // fade). The sequence bass plays the figure from 0:08 (bar 4) to the end, Hook's bass joins in
  // the intro, and the high 16th sequencer runs from the first turnaround (the MIDI's bar 46) on.
  // The bridge sits on a D pedal. The outro modulates: the chorus's IV (G) becomes the tonic.
  "true-faith": {
    title: "True Faith",
    style: 0,
    key: { tonic: 2, mode: "minor" },
    bpm: 117.45,
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
        layers: { guitar: true, ...band, drums: "big", lead: "chorus" },
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
        layers: { guitar: true, ...band, drums: "big", seq: true, lead: "chorus", arp: true },
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
        layers: { guitar: true, ...band, drums: "big", seq: true, lead: "chorus", arp: true },
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
    bpm: 117.45,
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
};
