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
import { arrangeBar } from "./arranger";
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

function summarise(song: Song) {
  const bars = Array.from({ length: song.totalBars }, (_, bar) => {
    const e = arrangeBar(song, bar);
    return { chords: e.chords, drums: e.drums, notes: e.notes, key: e.key };
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

describe("output snapshot", () => {
  it.each(CASES)("%s", (_, opts) => {
    expect(summarise(compose(opts))).toMatchSnapshot();
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
