/**
 * Locks down the generator's output: the composed song and every arranged bar, for a fixed set of
 * seeds, styles, forms and the originals, plus a creation round-tripped through a share link.
 * Songs with You Came's weight above 0 set the weights directly (or pick them: "auto").
 * Old share links (legacy-links.json, made when creations carried only the scalar style) must
 * decode to the songs they played then. Refactors that must not change what plays are checked against this snapshot. The full arranged
 * events would make a multi-megabyte file, so each song's bars are stored as one digest
 * next to a readable summary of the song.
 */
import { describe, expect, it } from "vitest";
import { arrangeBar, MELODIC_TRACKS, type MelodicTrack } from "./arranger";
import { compose, type ComposeOptions, type Song } from "./composer";
import { GENRES } from "./genres";
import { decodeCreation, encodeCreation, songToSpec } from "./spec";
import LEGACY_LINKS from "./legacy-links.json";

const SEEDS = [1, 42, 1234, 98765];
const STYLES = [0, 0.25, 0.5, 0.75, 1, null];

/** Two independent 32-bit FNV-1a variants over the JSON: enough to catch any change. */
function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + text.length;
}

/** The tracks the snapshot was made with, in their order. A track added since must stay silent in
 * these songs, and stays out of the digest. */
const LOCKED_TRACKS = [
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
] as const satisfies readonly MelodicTrack[];

/** `tracks`: the tracks digested. The synthpop cases keep `LOCKED_TRACKS`; the Italo and
 * Euro-disco cases, added later, lock every melodic track. */
function summarise(song: Song, tracks: readonly MelodicTrack[] = LOCKED_TRACKS) {
  const bars = Array.from({ length: song.totalBars }, (_, bar) => {
    const e = arrangeBar(song, bar);
    for (const [track, notes] of Object.entries(e.notes)) {
      if (!(tracks as readonly string[]).includes(track)) expect(notes).toEqual([]);
    }
    const notes = Object.fromEntries(tracks.map((t) => [t, e.notes[t]]));
    return { chords: e.chords, drums: e.drums, notes, key: e.key };
  });
  return {
    title: song.title,
    key: song.key,
    bpm: song.bpm,
    style: song.style,
    kit: song.kit,
    bassStyle: song.bassStyle,
    progressions: song.progressions,
    sections: song.sections.map(
      (s) =>
        `${s.kind}|${s.label}|${s.bars}|${s.key.tonic}${s.key.mode}|fill=${s.fill}|` +
        `${s.progression.map((b) => b.join("-")).join(" ")}|` +
        Object.entries(s.layers)
          .filter(([, v]) => v)
          .map(([k, v]) => (v === true ? k : `${k}=${String(v)}`))
          .join(","),
    ),
    totalBars: song.totalBars,
    motifs: digest([song.riff, song.hook, song.arp, song.sequence]),
    melodies: digest([song.melodies, song.sectionMelodies, song.counter, song.sectionCounters]),
    bars: digest(bars),
  };
}

const CASES: [string, ComposeOptions][] = [
  ...SEEDS.flatMap((seed) =>
    STYLES.map((style): [string, ComposeOptions] => [
      `seed ${seed} style ${style}`,
      { seed, style },
    ]),
  ),
  ...(["short", "long"] as const).flatMap((form) =>
    [0.2, 0.8].map((style): [string, ComposeOptions] => [
      `seed 7 style ${style} ${form}`,
      { seed: 7, style, form },
    ]),
  ),
  [
    "seed 7 fade, kit and bass forced",
    { seed: 7, style: 0.3, ending: "fade", kit: "dmx", bassStyle: "ds" },
  ],
  ["true-faith", { seed: 5, reference: "true-faith" }],
  ["different-story", { seed: 5, reference: "different-story" }],
  ["you-came", { seed: 5, reference: "you-came" }],
  // Weights in GENRES.synthpop.references order: True Faith, The Different Story, You Came.
  ...(
    [
      [0, 0, 1],
      [0.5, 0, 0.5],
      [0, 0.6, 0.4],
      [0.3, 0.3, 0.4],
    ] as const
  ).flatMap((weights) =>
    [3, 42].map((seed): [string, ComposeOptions] => [
      `seed ${seed} weights ${weights.join("/")}`,
      { seed, weights },
    ]),
  ),
  // A random point of the triangle per song (the UI's auto).
  ...[1, 42].map((seed): [string, ComposeOptions] => [
    `seed ${seed} weights auto`,
    { seed, weights: "auto" },
  ]),
];

/** The Italo and Euro-disco songs, locked before cross-genre blending (docs/plans/
 * cross-genre-blend.md) so that refactor can't move them: seeds at each corner, the centre and a
 * random point, short and long forms, and every original. */
const GENRE_CASES: [string, ComposeOptions][] = (["italo", "euro"] as const).flatMap((genre) => {
  const n = GENRES[genre].references.length;
  const corners = GENRES[genre].references.map((_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  const centre = Array.from({ length: n }, () => Math.round(100 / n) / 100);
  return [
    ...[...corners, centre].flatMap((weights) =>
      [1, 42].map((seed): [string, ComposeOptions] => [
        `${genre} seed ${seed} weights ${weights.join("/")}`,
        { seed, genre, weights },
      ]),
    ),
    ...[1, 42, 1234].map((seed): [string, ComposeOptions] => [
      `${genre} seed ${seed} weights auto`,
      { seed, genre, weights: "auto" },
    ]),
    ...(["short", "long"] as const).map((form): [string, ComposeOptions] => [
      `${genre} seed 7 ${form}`,
      { seed: 7, genre, weights: centre, form },
    ]),
    ...(["lift", "hold"] as const).map((ending): [string, ComposeOptions] => [
      `${genre} seed 9 ${ending}`,
      { seed: 9, genre, weights: centre, ending },
    ]),
    ...GENRES[genre].references.map((reference): [string, ComposeOptions] => [
      reference,
      { seed: 5, reference },
    ]),
  ];
});

describe("output snapshot", () => {
  it.each(CASES)("%s", (_, opts) => {
    expect(summarise(compose(opts))).toMatchSnapshot();
  });

  it.each(GENRE_CASES)("%s", (_, opts) => {
    expect(summarise(compose(opts), MELODIC_TRACKS)).toMatchSnapshot();
  });

  it("round-trips a creation through a share link", () => {
    const song = compose({ seed: 314, style: 0.6 });
    const decoded = decodeCreation(encodeCreation({ seed: song.seed, spec: songToSpec(song) }));
    expect(decoded).toMatchSnapshot();
    if (!decoded) return;
    expect(summarise(compose({ seed: decoded.seed, custom: decoded.spec }))).toMatchSnapshot();
  });

  // Share links made before creations carried weights (only the scalar `st`), recorded with that
  // code: they must keep playing exactly the same song.
  it.each(Object.entries(LEGACY_LINKS))("plays the old link %s as before", (_, link) => {
    const decoded = decodeCreation(link);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(summarise(compose({ seed: decoded.seed, custom: decoded.spec }))).toMatchSnapshot();
  });

  it("keeps the progression bank", () => {
    expect(
      Object.fromEntries(
        Object.entries(GENRES.synthpop.bank).map(([kind, entries]) => [
          kind,
          entries.map(
            (e) =>
              `${e.name}|${e.style ?? e.ref}${e.mode === "major" ? " major" : ""}|` +
              e.bars.map((b) => b.join("-")).join(" "),
          ),
        ]),
      ),
    ).toMatchSnapshot();
  });
});
