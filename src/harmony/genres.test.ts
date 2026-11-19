/**
 * Theory chords for Italo and Euro-disco (docs/plans/theory-chords.md §7 phase 4): every chord
 * parses, the bass treatments don't clash, each reference's measured loops are reachable at its
 * weight alone, the section relations hold, songs are deterministic, everything but the chords is
 * as classic draws it, and the variety targets are met.
 */
import { describe, expect, it } from "vitest";
import { compose, type Song } from "../composer";
import { GENRES, genreAt, type GenreId } from "../genres";
import type { Bar, Progression } from "../progressions";
import type { ReferenceId } from "../references";
import { createRng } from "../rng";
import { chord, chordPitchClasses, mod12, type Mode } from "../theory";
import { measureVariety } from "../variety";
import { progressionText, writeLoop, type HarmonyContext, type LoopKind } from "./generate";
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
