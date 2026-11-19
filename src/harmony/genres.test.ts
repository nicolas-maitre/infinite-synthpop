/**
 * Theory chords for Italo, Euro-disco and blends across genres (docs/plans/theory-chords.md §7
 * phase 4): every chord
 * parses, the bass treatments don't clash, each reference's measured loops are reachable at its
 * weight alone, the section relations hold, songs are deterministic, everything but the chords is
 * as classic draws it, and the variety targets are met.
 */
import { describe, expect, it } from "vitest";
import { compose, type Song } from "../composer";
import { GENRES, genreAt, type GenreId } from "../genres";
import type { Bar, Progression } from "../progressions";
import type { RefWeights } from "../profile";
import type { ReferenceId } from "../references";
import { createRng } from "../rng";
import { chord, chordPitchClasses, mod12, type Mode } from "../theory";
import { measureVariety } from "../variety";
import {
  progressionText,
  writeLoop,
  writePrechorus,
  type HarmonyContext,
  type LoopKind,
} from "./generate";
import { harmonyContext } from "./index";

function contextAt(genre: GenreId, weights: readonly number[], mode: Mode): HarmonyContext {
  const ctx = harmonyContext(genreAt(GENRES[genre], weights), mode);
  if (!ctx) throw new Error(`${genre} has an analysis`);
  return ctx;
}
const soloOf = (genre: GenreId, ref: ReferenceId) =>
  GENRES[genre].references.map((r) => (r === ref ? 1 : 0));

function candidates(ctx: HarmonyContext, kind: LoopKind, n: number, seed = 7): Set<string> {
  const rng = createRng(seed);
  const out = new Set<string>();
  for (let i = 0; i < n; i++) out.add(progressionText(writeLoop(rng, ctx, kind)));
  return out;
}

const songsOf = (genre: GenreId, n = 150, weights: "auto" | readonly number[] = "auto"): Song[] =>
  Array.from({ length: n }, (_, i) =>
    compose({ seed: 2000 + i * 41, genre, weights, chords: "theory" }),
  );

/** A slash chord's tones never sit a semitone from its bass (V over the leading tone, ♭II over i). */
function clashes(numeral: string): boolean {
  const c = chord(numeral);
  if (c.bass === undefined) return false;
  const bass = c.bass;
  return chordPitchClasses({ tonic: 0, mode: "minor" }, c).some(
    (pc) => mod12(pc - bass) === 1 || mod12(bass - pc) === 1,
  );
}

function sharedChecks(genre: GenreId, songs: () => Song[]) {
  it("writes only numerals chord() parses, and slash basses that don't clash", () => {
    for (const song of songs()) {
      for (const p of Object.values(song.progressions) as Progression[])
        for (const bar of p) {
          expect(bar.length).toBeGreaterThan(0);
          expect(bar.length).toBeLessThanOrEqual(2);
          for (const n of bar) {
            expect(() => chord(n), n).not.toThrow();
            expect(clashes(n), `${n} in ${progressionText(p)}`).toBe(false);
          }
        }
      for (const s of song.sections)
        for (const bar of s.progression) for (const n of bar) expect(() => chord(n)).not.toThrow();
    }
  });

  it("never splits a bar into a bare I (the bass takes it as the push into a pre-chorus)", () => {
    for (const song of songs())
      for (const p of Object.values(song.progressions) as Progression[])
        for (const bar of p) expect(bar[1], progressionText(p)).not.toBe("I");
  });

  it("is deterministic per seed", () => {
    for (const seed of [1, 42, 98765]) {
      const a = compose({ seed, genre, weights: "auto", chords: "theory" });
      const b = compose({ seed, genre, weights: "auto", chords: "theory" });
      expect(b.progressions).toEqual(a.progressions);
      expect(b.sections).toEqual(a.sections);
    }
  });

  it("leaves everything but the chords as classic draws it", () => {
    for (let i = 0; i < 40; i++) {
      const opts = { seed: 700 + i * 101, genre, weights: "auto" } as const;
      const c = compose({ ...opts, chords: "classic" });
      const t = compose({ ...opts, chords: "theory" });
      expect([t.key, t.bpm, t.kit, t.bassStyle, t.title]).toEqual([
        c.key,
        c.bpm,
        c.kit,
        c.bassStyle,
        c.title,
      ]);
      expect(t.sections.map((s) => s.kind)).toEqual(c.sections.map((s) => s.kind));
    }
  });

  it("varies far more than classic (plan §6 targets)", () => {
    const classic = measureVariety(genre, "classic", 150);
    const theory = measureVariety(genre, "theory", 150);
    for (const part of ["verse", "chorus"] as const) {
      expect(theory[part].bankEntryUnquoted).toBeLessThan(0.1);
      expect(theory[part].distinct).toBeGreaterThanOrEqual(3 * classic[part].distinct);
    }
  });
}

function reachesMeasured(
  genre: GenreId,
  measured: Partial<Record<ReferenceId, { mode: Mode } & Partial<Record<LoopKind, Bar[][]>>>>,
) {
  it("reaches each reference's measured loops at that reference's weight alone", () => {
    for (const [ref, m] of Object.entries(measured) as [
      ReferenceId,
      (typeof measured)[ReferenceId],
    ][]) {
      if (!m) continue;
      const ctx = contextAt(genre, soloOf(genre, ref), m.mode);
      for (const kind of ["verse", "chorus"] as const) {
        const loops = m[kind];
        if (!loops) continue;
        const seen = candidates(ctx, kind, 20000);
        for (const loop of loops) expect(seen, `${ref} ${kind}`).toContain(progressionText(loop));
      }
    }
  });
}

describe("theory chords: Italo", () => {
  const SONGS = songsOf("italo");
  sharedChecks("italo", () => SONGS);
  reachesMeasured("italo", {
    "the-night": {
      mode: "minor",
      verse: [[["i"], ["VII/i"], ["v7"], ["IV"]]],
      chorus: [[["IIIadd9"], ["VI/3"], ["II"], ["VII7sus4", "VII7"]]],
    },
    "get-closer": {
      mode: "minor",
      verse: [
        [["i"], ["VII/i"], ["IV"], ["VI/VII"]],
        [["i"], ["VII/i"], ["IV/3"], ["VI/VII"]],
      ],
      chorus: [[["i"], ["VI/3"], ["VII"], ["IV/V", "V"]]],
    },
    faces: {
      mode: "minor",
      verse: [
        [
          ["VImaj7", "VIIsus4"],
          ["v7", "i7"],
        ],
      ],
      chorus: [
        [
          ["I"],
          ["v7", "IVmaj7"],
          ["I"],
          ["v7", "IVmaj7"],
          ["I"],
          ["v7", "IVmaj7"],
          ["I", "vi7"],
          ["VII", "V7sus4"],
        ],
        [["I"], ["v7", "IVmaj7"], ["I", "vi7"], ["VII", "V7sus4"]],
      ],
    },
    "self-control": {
      mode: "minor",
      verse: [[["i"], ["v"], ["i"], ["v"], ["VII"], ["iv"], ["VI"], ["III"]]],
      chorus: [[["i"], ["v"], ["i"], ["v"], ["VII"], ["iv"], ["VI"], ["III"]]],
    },
  });

  it("plays every loop for a length the planner's 16- and 8-bar blocks repeat evenly", () => {
    for (const song of SONGS)
      for (const kind of ["verse", "chorus", "interlude"] as const)
        if (!song.quoted) expect([2, 4, 8, 16]).toContain(song.progressions[kind].length);
  });

  it("moves the chorus to the relative or the parallel major, and plays one loop only on the tonic", () => {
    const opens = (genreRef: ReferenceId, first: string) => {
      const songs = songsOf("italo", 80, soloOf("italo", genreRef)).filter((s) => !s.quoted);
      return songs.filter((s) => s.progressions.chorus[0]?.[0] === first).length / songs.length;
    };
    // The Night's chorus on ♭III; Faces' in the parallel major, on I.
    expect(opens("the-night", "III") + opens("the-night", "IIIadd9")).toBeGreaterThan(0.4);
    expect(opens("faces", "I")).toBeGreaterThan(0.4);
    // Self Control's verse is its chorus's loop, which stays on the minor tonic.
    for (const song of SONGS)
      if (song.progressions.verse === song.progressions.chorus && !song.quoted)
        expect(song.progressions.chorus[0]?.[0]).toBe("i");
  });

  it("holds the tonic under ♭VII and steps up into the loop, as The Night and Get Closer do", () => {
    const loops = (ref: ReferenceId) => {
      const ctx = contextAt("italo", soloOf("italo", ref), "minor");
      const rng = createRng(9);
      return Array.from({ length: 2000 }, () => progressionText(writeLoop(rng, ctx, "verse")));
    };
    const share = (ps: string[], s: string) => ps.filter((p) => p.includes(s)).length / ps.length;
    expect(share(loops("the-night"), "VII/i")).toBeGreaterThan(0.3);
    expect(share(loops("get-closer"), "/VII")).toBeGreaterThan(0.2);
    // Self Control's loop is plain Aeolian.
    expect(share(loops("self-control"), "/")).toBeLessThan(0.1);
  });
});

describe("theory chords: Euro-disco", () => {
  const SONGS = songsOf("euro");
  sharedChecks("euro", () => SONGS);
  reachesMeasured("euro", {
    "innocent-love": {
      mode: "minor",
      verse: [[["v"], ["ii7/v"], ["v"], ["I/v"]]],
      chorus: [
        [
          ...[0, 1, 2].flatMap(() => [["i"], ["IVsus4", "IV"], ["VII9sus4"], ["III"]]),
          ["i"],
          ["IVsus4", "IV"],
        ],
      ],
    },
    "heaven-can-wait": {
      mode: "minor",
      verse: [[["IV7"], ["IV7"]]],
      chorus: [
        [
          ...[0, 1].flatMap(() => [["i"], ["i"], ["VII"], ["VII"]]),
          ["iv"],
          ["VI"],
          ["i"],
          ["i"],
          ["Vsus4"],
          ["V"],
        ],
      ],
    },
    "crazy-juliet": {
      mode: "major",
      verse: [[["I"], ["I"], ["I"], ["I"], ["ii"], ["VII"], ["I"], ["I"]]],
      chorus: [
        [...[0, 1, 2].flatMap(() => [["III", "IV"], ["v"]]), ["III"], ["ii7"], ["Vsus4"], ["IV/V"]],
      ],
    },
  });

  it("reaches Crazy Juliet read from its v, and each record's pre-chorus", () => {
    const cj = contextAt("euro", soloOf("euro", "crazy-juliet"), "minor");
    expect(candidates(cj, "chorus", 20000)).toContain(
      "VI–VII │ i │ VI–VII │ i │ VI–VII │ i │ VI │ v7 │ Isus4 │ VII/i",
    );
    const pre = (ref: ReferenceId, mode: Mode, chorusFirst: string) => {
      const ctx = contextAt("euro", soloOf("euro", ref), mode);
      const rng = createRng(5);
      const tonic = mode === "major" ? "I" : "i";
      return new Set(
        Array.from({ length: 4000 }, () =>
          progressionText(writePrechorus(rng, ctx, chorusFirst, tonic)),
        ),
      );
    };
    expect(pre("heaven-can-wait", "minor", "i")).toContain(
      "III/IV │ VII/IV │ IV │ IV │ III/IV │ VII/IV │ IV │ IV",
    );
    expect(pre("innocent-love", "minor", "i")).toContain("i │ viø7 │ i │ viø7 │ VI │ V");
    expect(pre("crazy-juliet", "major", "III")).toContain("iv │ IIIadd9 │ VII │ IV7sus4 │ IV7");
  });

  it("writes choruses and pre-choruses the planner lays out for their own lengths", () => {
    const lengths = new Set<number>();
    for (const song of SONGS) {
      const chorus = song.progressions.chorus.length;
      lengths.add(chorus);
      expect(chorus).toBeGreaterThanOrEqual(4);
      expect(chorus).toBeLessThanOrEqual(16);
      expect(chorus % 2).toBe(0);
      const pre = song.progressions.prechorus;
      if (pre) expect(pre.length).toBeGreaterThanOrEqual(2);
      if (pre) expect(pre.length).toBeLessThanOrEqual(8);
      for (const s of song.sections) {
        if (s.label === "Chorus" && s.progression === song.progressions.chorus)
          expect(s.bars).toBe(Math.max(8, chorus));
        if (s.kind === "prechorus" && pre && s.progression === pre) expect(s.bars).toBe(pre.length);
      }
    }
    // The long loops come through: Innocent Love's and Heaven Can Wait's 14, Crazy Juliet's 10.
    expect(lengths).toContain(10);
    expect(lengths).toContain(14);
  });

  it("changes chords faster in the chorus than in the verse", () => {
    const rate = (p: Progression) => {
      const seq = p.flat();
      return seq.filter((n, i) => n !== seq[(i + 1) % seq.length]).length / p.length;
    };
    const unquoted = SONGS.filter((s) => !s.quoted);
    const faster = unquoted.filter(
      (s) => rate(s.progressions.chorus) > rate(s.progressions.verse),
    ).length;
    expect(faster / unquoted.length).toBeGreaterThan(0.6);
  });
});

describe("theory chords: blends across genres", () => {
  const BLENDS: RefWeights[] = [
    { "true-faith": 0.5, "the-night": 0.5 },
    { "different-story": 0.5, "innocent-love": 0.5 },
    { faces: 0.4, "crazy-juliet": 0.3, "you-came": 0.3 },
    { "get-closer": 0.6, "heaven-can-wait": 0.4 },
  ];
  const songs = (blend: RefWeights, n = 60, chords: "theory" | "classic" = "theory") =>
    Array.from({ length: n }, (_, i) => compose({ seed: 3000 + i * 53, blend, chords }));
  const ALL = BLENDS.flatMap((b) => songs(b));

  it("writes only numerals chord() parses, with slash basses that don't clash", () => {
    for (const song of ALL)
      for (const p of Object.values(song.progressions) as Progression[])
        for (const bar of p) {
          expect(bar.length).toBeLessThanOrEqual(2);
          expect(bar[1]).not.toBe("I");
          for (const n of bar) expect(clashes(n), `${n} in ${progressionText(p)}`).toBe(false);
        }
  });

  it("writes loops the merged planner lays out: 2, 4 or 8 bars, a turnaround 2 or 4", () => {
    // A synthpop body plays an 8-bar chorus and an Italo one 16 or 8, so a 10- or 14-bar Euro
    // chorus would be cut off (as classic's are).
    for (const song of ALL) {
      if (song.quoted) continue;
      const p = song.progressions;
      // A verse may run 16 bars (TF's four-line verse): every planner plays verses of 8 or 16.
      expect([2, 4, 8, 16]).toContain(p.verse.length);
      for (const kind of ["chorus", "interlude", "bridge"] as const)
        expect([2, 4, 8], `${kind} ${progressionText(p[kind])}`).toContain(p[kind].length);
      expect([2, 4]).toContain(p.turnaround.length);
      if (p.prechorus) expect(p.prechorus.length).toBeLessThanOrEqual(8);
    }
  });

  it("mixes the genres' traits by their shares", () => {
    const choruses = songs(BLENDS[0]!, 120)
      .filter((s) => !s.quoted)
      .map((s) => s.progressions.chorus);
    const share = (test: (c: Progression) => boolean) =>
      choruses.filter(test).length / choruses.length;
    // The Night's relative-major chorus, and True Faith's chorus landing on its IV: both turn up,
    // neither takes over.
    const tn = share((c) => /^III/.test(c[0]?.[0] ?? ""));
    const tf = share((c) => ["IV", "iv"].includes(c[c.length - 1]?.at(-1) ?? ""));
    for (const x of [tn, tf]) {
      expect(x).toBeGreaterThan(0.1);
      expect(x).toBeLessThan(0.6);
    }
  });

  it("leaves everything but the chords as classic draws it, deterministically", () => {
    for (const blend of BLENDS)
      for (const seed of [5, 77]) {
        const c = compose({ seed, blend, chords: "classic" });
        const t = compose({ seed, blend, chords: "theory" });
        expect([t.key, t.bpm, t.kit, t.title, t.genre]).toEqual([
          c.key,
          c.bpm,
          c.kit,
          c.title,
          c.genre,
        ]);
        expect(t.sections.map((s) => s.kind)).toEqual(c.sections.map((s) => s.kind));
        expect(compose({ seed, blend, chords: "theory" }).progressions).toEqual(t.progressions);
      }
  });
});
