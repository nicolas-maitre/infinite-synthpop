/**
 * Creator mode's song format. A spec is what the originals are written in (references.ts): the
 * sections in order, each with its length, chords per bar, instruments and key, plus song-level
 * key, tempo, drum machine and bass style. A creation is a spec plus the seed its motifs, melodies
 * and drum details come from. Creations travel compactly in the URL and in local storage.
 */
import type {
  BassStyle,
  CustomMelody,
  DrumMode,
  KitName,
  Layers,
  MelodyKind,
  SectionKind,
  Song,
} from "./composer";
import type { Progression } from "./progressions";
import type { ReferenceSection, ReferenceSong } from "./references";
import { chord, type Key, type Mode } from "./theory";

export type SongSpec = ReferenceSong;
export type SectionSpec = ReferenceSection;

export interface Creation {
  seed: number;
  spec: SongSpec;
  /** Its entry in My songs (library.ts). Local to this browser: links don't carry it. */
  id?: string;
}

/** A fresh id for a saved song. */
export function newSongId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const SECTION_KINDS: readonly SectionKind[] = [
  "intro",
  "verse",
  "chorus",
  "interlude",
  "turnaround",
  "break",
  "bridge",
  "outro",
];
export const DRUM_MODES: readonly DrumMode[] = ["off", "kick", "half", "full", "big", "groove"];
export const KITS: readonly KitName[] = ["sp12", "linndrum", "dmx", "synth"];

/** The chords the picker offers in each mode, the songs' usual ones first. */
export const CHORD_CHOICES: Record<Mode, readonly string[]> = {
  minor: ["i", "III", "VI", "VII", "iv", "IV", "v", "V", "ii", "ii°", "iii", "vi", "I"],
  major: ["I", "IV", "V", "vi", "ii", "iii", "VII", "VI", "III", "iv", "v", "i"],
};

/** The on/off instruments a section can play, besides drums and lead. */
export const SECTION_INSTRUMENTS = [
  "bass",
  "seq",
  "guitar",
  "hook",
  "pad",
  "riff",
  "counter",
  "arp",
  "stabs",
] as const satisfies readonly (keyof Layers)[];

/** The playing song as an editable spec. With the same seed, it sounds the same. */
export function songToSpec(song: Song): SongSpec {
  return {
    title: song.title,
    style: song.style,
    key: { ...song.key },
    bpm: song.bpm,
    kit: song.kit,
    bassStyle: song.bassStyle,
    verse: song.progressions.verse,
    chorus: song.progressions.chorus,
    ...(song.spec?.melodies ? { melodies: structuredClone(song.spec.melodies) } : {}),
    sections: song.sections.map((s) => ({
      kind: s.kind,
      label: s.label,
      bars: s.bars,
      progression: s.progression.map((bar) => [...bar]),
      layers: { ...s.layers },
      fill: s.fill,
      ...(s.melody ? { melody: s.melody } : {}),
      ...(sameKey(s.key, song.key) ? {} : { key: { ...s.key } }),
    })),
  };
}

const VERSE: Progression = [["i"], ["VI"], ["VII"], ["v"]];
const CHORUS: Progression = [["i"], ["III"], ["VII"], ["IV"]];

/** A minimal song to build from: intro, two verses and choruses, an outro. */
export function blankSpec(): SongSpec {
  const section = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
  ): SectionSpec => ({ kind, label, bars, progression: progression.map((b) => [...b]), layers });
  const band: Partial<Layers> = { drums: "full", bass: true, pad: true };
  return {
    title: "Untitled",
    style: 0.5,
    key: { tonic: 2, mode: "minor" },
    bpm: 117.5,
    kit: "sp12",
    bassStyle: "tf",
    verse: VERSE,
    chorus: CHORUS,
    sections: [
      section("intro", "Intro", 4, CHORUS, { drums: "kick", bass: true }),
      section("verse", "Verse 1", 8, VERSE, { ...band, lead: "verse" }),
      section("chorus", "Chorus", 8, CHORUS, { ...band, drums: "big", lead: "chorus" }),
      section("verse", "Verse 2", 8, VERSE, { ...band, lead: "verse" }),
      section("chorus", "Chorus", 8, CHORUS, { ...band, drums: "big", lead: "chorus" }),
      section("outro", "Outro", 8, CHORUS, band),
    ],
  };
}

export function sameKey(a: Key, b: Key): boolean {
  return a.tonic === b.tonic && a.mode === b.mode;
}

// ── Encoding ──────────────────────────────────────────────────────────────────────────────────

/** Short layer codes for the URL: instruments that play, drums, lead, flags. */
interface CompactSection {
  k: SectionKind;
  l: string;
  b: number;
  /** Bars separated by "|", split bars by " ": "i|VI VII|v|v". */
  p: string;
  d: DrumMode;
  on: string[];
  ld?: MelodyKind;
  x?: 1;
  st?: 1;
  /** Drum fill at the end: 1 on, 0 off, absent = default. */
  f?: 0 | 1;
  /** Custom melody id. */
  ml?: string;
  key?: [number, Mode];
}

interface CompactCreation {
  v: 1;
  seed: number;
  t: string;
  st: number;
  key: [number, Mode];
  bpm: number;
  kit: KitName;
  bs: BassStyle;
  /** The song's own verse and chorus progressions (its main melodies are written over them). */
  pv?: string;
  pc?: string;
  /** Custom melodies: name, key tonic, bars, notes as "bar,step,dur,pitch,vel;…". */
  m?: Record<string, { n: string; k: number; b: number; t: string }>;
  s: CompactSection[];
}

export function encodeCreation({ seed, spec }: Creation): string {
  const compact: CompactCreation = {
    v: 1,
    seed,
    t: spec.title,
    st: Math.round(spec.style * 100) / 100,
    key: [spec.key.tonic, spec.key.mode],
    bpm: spec.bpm,
    kit: spec.kit,
    bs: spec.bassStyle,
    pv: progressionText(spec.verse),
    pc: progressionText(spec.chorus),
    ...(spec.melodies && Object.keys(spec.melodies).length
      ? {
          m: Object.fromEntries(
            Object.entries(spec.melodies).map(([id, m]) => [
              id,
              {
                n: m.name,
                k: m.tonic,
                b: m.bars,
                t: m.notes
                  .map((x) => [x.bar, x.step, x.dur, x.pitch, x.vel].map(round2).join(","))
                  .join(";"),
              },
            ]),
          ),
        }
      : {}),
    s: spec.sections.map((s) => {
      const L = s.layers;
      return {
        k: s.kind,
        l: s.label,
        b: s.bars,
        p: progressionText(s.progression),
        d: L.drums ?? "off",
        on: SECTION_INSTRUMENTS.filter((i) => L[i]),
        ...(L.lead ? { ld: L.lead } : {}),
        ...(L.leadDouble ? { x: 1 as const } : {}),
        ...(L.bassShort ? { st: 1 as const } : {}),
        ...(s.fill === undefined ? {} : { f: s.fill ? (1 as const) : (0 as const) }),
        ...(s.melody ? { ml: s.melody } : {}),
        ...(s.key ? { key: [s.key.tonic, s.key.mode] as [number, Mode] } : {}),
      };
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parses and validates an encoded creation; null if it isn't one. */
export function decodeCreation(encoded: string): Creation | null {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const c = JSON.parse(new TextDecoder().decode(bytes)) as CompactCreation;
    if (c.v !== 1 || !Array.isArray(c.s) || c.s.length === 0) return null;
    const key = toKey(c.key) ?? { tonic: 2, mode: "minor" };
    const sections: SectionSpec[] = c.s.map((s) => {
      const layers: Partial<Layers> = {
        drums: DRUM_MODES.includes(s.d) ? s.d : "full",
        lead: s.ld === "verse" || s.ld === "chorus" ? s.ld : null,
        leadDouble: s.x === 1,
        bassShort: s.st === 1,
      };
      for (const i of SECTION_INSTRUMENTS) layers[i] = s.on.includes(i);
      const sectionKey = s.key ? toKey(s.key) : null;
      return {
        kind: SECTION_KINDS.includes(s.k) ? s.k : "verse",
        label: String(s.l).slice(0, 40),
        bars: clampInt(s.b, 1, 64),
        progression: parseProgression(s.p),
        layers,
        ...(s.f === 0 || s.f === 1 ? { fill: s.f === 1 } : {}),
        ...(typeof s.ml === "string" && c.m?.[s.ml] ? { melody: s.ml } : {}),
        ...(sectionKey ? { key: sectionKey } : {}),
      };
    });
    const first = (kind: SectionKind) => sections.find((s) => s.kind === kind)?.progression;
    return {
      seed: clampInt(c.seed, 0, 999_999),
      spec: {
        title: String(c.t || "Untitled").slice(0, 60),
        style: Math.min(1, Math.max(0, Number(c.st) || 0)),
        key,
        bpm: Math.min(160, Math.max(60, Number(c.bpm) || 117.5)),
        kit: KITS.includes(c.kit) ? c.kit : "sp12",
        bassStyle: c.bs === "ds" ? "ds" : "tf",
        verse: c.pv ? parseProgression(c.pv) : (first("verse") ?? VERSE),
        chorus: c.pc ? parseProgression(c.pc) : (first("chorus") ?? CHORUS),
        ...(c.m ? { melodies: parseMelodies(c.m, key.tonic) } : {}),
        sections,
      },
    };
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMelodies(
  m: Record<string, { n: string; k?: number; b: number; t: string }>,
  songTonic: number,
): Record<string, CustomMelody> {
  const out: Record<string, CustomMelody> = {};
  for (const [id, raw] of Object.entries(m).slice(0, 32)) {
    const bars = clampInt(raw.b, 1, 32);
    const notes = String(raw.t || "")
      .split(";")
      .filter(Boolean)
      .slice(0, 2000)
      .map((t) => t.split(",").map(Number))
      .filter((v) => v.length === 5 && v.every(Number.isFinite))
      .map(([bar = 0, step = 0, dur = 1, pitch = 60, vel = 0.8]) => ({
        bar: clampInt(bar, 0, bars - 1),
        step: Math.min(15.99, Math.max(0, step)),
        dur: Math.min(64, Math.max(0.1, dur)),
        pitch: clampInt(pitch, 0, 127),
        vel: Math.min(1, Math.max(0.05, vel)),
      }));
    out[String(id).slice(0, 12)] = {
      name: String(raw.n || id).slice(0, 40),
      tonic: raw.k === undefined ? songTonic : clampInt(raw.k, 0, 11),
      bars,
      notes,
    };
  }
  return out;
}

function progressionText(p: Progression): string {
  return p.map((bar) => bar.join(" ")).join("|");
}

/** "i|VI VII|v" → [["i"], ["VI", "VII"], ["v"]], keeping only known numerals. */
function parseProgression(text: string): Progression {
  const bars = String(text)
    .split("|")
    .map((bar) =>
      bar
        .trim()
        .split(/\s+/)
        .filter((n) => isNumeral(n))
        .slice(0, 2),
    )
    .filter((bar) => bar.length > 0)
    .slice(0, 16);
  return bars.length ? bars : [["i"]];
}

function isNumeral(n: string): boolean {
  try {
    chord(n);
    return true;
  } catch {
    return false;
  }
}

function toKey(k: unknown): Key | null {
  if (!Array.isArray(k)) return null;
  const [tonic, mode] = k as [unknown, unknown];
  if (typeof tonic !== "number" || (mode !== "minor" && mode !== "major")) return null;
  return { tonic: clampInt(tonic, 0, 11), mode };
}

function clampInt(n: unknown, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
}
