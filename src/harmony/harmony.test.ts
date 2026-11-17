import { describe, expect, it } from "vitest";
import { compose, type Song } from "../composer";
import { GENRES, genreAt } from "../genres";
import type { Bar, Progression } from "../progressions";
import { REFERENCES, type ReferenceId } from "../references";
import { createRng } from "../rng";
import { chord, mod12, type Mode } from "../theory";
import { measureVariety } from "../variety";
import {
  cadenceOptions,
  progressionText,
  writeLoop,
  writePrechorus,
  type HarmonyContext,
  type LoopKind,
} from "./generate";
import { harmonyContext } from "./index";
import { SYNTHPOP_HARMONY } from "./synthpop";

const SYNTHPOP = GENRES.synthpop;
const REFS = SYNTHPOP.references;

function contextAt(weights: readonly number[], mode: Mode): HarmonyContext {
  const ctx = harmonyContext(genreAt(SYNTHPOP, weights), mode);
  if (!ctx) throw new Error("synthpop has an analysis");
  return ctx;
}
const solo = (ref: ReferenceId) => REFS.map((r) => (r === ref ? 1 : 0));

/** Theory songs across the triangle, as the app makes them (auto style). */
const SONGS: Song[] = Array.from({ length: 150 }, (_, i) =>
  compose({ seed: 1000 + i * 37, genre: "synthpop", weights: "auto", chords: "theory" }),
);

/** Many raw candidates (before scoring) for a kind at a blend. */
function candidates(ctx: HarmonyContext, kind: LoopKind, n: number, seed = 7): Set<string> {
  const rng = createRng(seed);
  const out = new Set<string>();
  for (let i = 0; i < n; i++) out.add(progressionText(writeLoop(rng, ctx, kind)));
  return out;
}

describe("theory chords: synthpop", () => {
  it("writes only numerals chord() parses", () => {
    for (const song of SONGS) {
      for (const p of Object.values(song.progressions) as Progression[])
        for (const bar of p) {
          expect(bar.length).toBeGreaterThan(0);
          expect(bar.length).toBeLessThanOrEqual(2);
          for (const n of bar) expect(() => chord(n), n).not.toThrow();
        }
      for (const s of song.sections)
        for (const bar of s.progression) for (const n of bar) expect(() => chord(n)).not.toThrow();
    }
  });

  it("ends every line on a cadence its traits allow", () => {
    for (const weights of [solo(REFS[0]!), solo(REFS[1]!), solo(REFS[2]!), [0.4, 0.3, 0.3]])
      for (const mode of ["minor", "major"] as const) {
        const ctx = contextAt(weights, mode);
        const traits = SYNTHPOP_HARMONY.modes[mode];
        for (const kind of ["verse", "chorus"] as const) {
          const allowed = new Set(
            [...cadenceOptions(ctx, kind, false), ...cadenceOptions(ctx, kind, true)]
              .filter(([, w]) => w > 0)
              .map(([bar]) => bar.join("–")),
          );
          // Schemas without a cadence slot end on their own fixed bar (the royal road's i).
          for (const s of traits.schemas) {
            const last = s.bars[s.bars.length - 1];
            if (last && last !== "cadence") for (const o of last) allowed.add(o.value.join("–"));
          }
          const rng = createRng(3);
          for (let i = 0; i < 300; i++) {
            const p = writeLoop(rng, ctx, kind);
            for (let b = 3; b < p.length; b += 4) expect(allowed).toContain(p[b]!.join("–"));
          }
        }
      }
  });

  it("leaves every pre-chorus into its chorus through a dominant", () => {
    let checked = 0;
    for (const song of SONGS) {
      const pre = song.progressions.prechorus;
      if (!pre || !song.sections.some((s) => s.kind === "prechorus")) continue;
      const last = chord(pre[pre.length - 1]!.at(-1)!);
      const target = chord(song.progressions.chorus[0]![0]!);
      expect(last.quality).toBe("dom7");
      // Authentic (a fourth up) or deceptive (a semitone up: V/vi → IV, V → VI).
      expect([5, 1]).toContain(mod12(target.root - last.root));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("reaches each reference's measured loops at that reference's weight alone", () => {
    const measured: Record<ReferenceId, { mode: Mode; verse: Bar[][]; chorus: Bar[][] }> = {
      "true-faith": {
        mode: "minor",
        verse: [REFERENCES["true-faith"].verse as Bar[], [["i"], ["VI", "VII"], ["v"], ["v"]]],
        chorus: [REFERENCES["true-faith"].chorus as Bar[], [["i"], ["VII"], ["VII"], ["IV"]]],
      },
      "different-story": {
        mode: "minor",
        verse: [REFERENCES["different-story"].verse as Bar[]],
        chorus: [REFERENCES["different-story"].chorus as Bar[]],
      },
      // You Came's verse is its chorus loop (the verse's last bar turns to I before a pre-chorus).
      "you-came": {
        mode: "major",
        verse: [REFERENCES["you-came"].chorus as Bar[]],
        chorus: [
          REFERENCES["you-came"].chorus as Bar[],
          [["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V"], ["IV"], ["V", "I/3"]],
        ],
      },
    } as Record<ReferenceId, { mode: Mode; verse: Bar[][]; chorus: Bar[][] }>;
    for (const ref of REFS) {
      const m = measured[ref];
      const ctx = contextAt(solo(ref), m.mode);
      for (const kind of ["verse", "chorus"] as const) {
        const seen = candidates(ctx, kind, 30000);
        for (const loop of m[kind]) expect(seen, `${ref} ${kind}`).toContain(progressionText(loop));
      }
    }
    // You Came's pre-chorus, into its loop's IV.
    const yc = contextAt(solo("you-came"), "major");
    const rng = createRng(5);
    const pre = new Set<string>();
    for (let i = 0; i < 3000; i++) pre.add(progressionText(writePrechorus(rng, yc, "IV", "I")));
    expect(pre).toContain("V/ii │ ii │ I │ v │ ii │ I │ Vsus4/vi │ V7/vi");
  });

  it("is deterministic per seed", () => {
    for (const seed of [1, 42, 98765]) {
      const a = compose({ seed, genre: "synthpop", weights: "auto", chords: "theory" });
      const b = compose({ seed, genre: "synthpop", weights: "auto", chords: "theory" });
      expect(b.progressions).toEqual(a.progressions);
      expect(b.quoted).toEqual(a.quoted);
    }
  });

  it("leaves everything but the verse, chorus and pre-chorus as classic draws it", () => {
    for (let i = 0; i < 40; i++) {
      const opts = { seed: 500 + i * 101, genre: "synthpop", weights: "auto" } as const;
      const c = compose({ ...opts, chords: "classic" });
      const t = compose({ ...opts, chords: "theory" });
      expect([t.key, t.bpm, t.kit, t.bassStyle, t.title]).toEqual([
        c.key,
        c.bpm,
        c.kit,
        c.bassStyle,
        c.title,
      ]);
      for (const k of ["interlude", "turnaround", "bridge", "lift"] as const)
        expect(t.progressions[k]).toEqual(c.progressions[k]);
      // The same form; only a pre-chorus's length follows its progression.
      expect(t.sections.map((s) => s.kind)).toEqual(c.sections.map((s) => s.kind));
      t.sections.forEach((s, j) => {
        if (s.kind !== "prechorus") expect(s.bars).toBe(c.sections[j]!.bars);
      });
    }
  });

  it("keeps classic's chords for the genres without an analysis yet", () => {
    for (const genre of ["italo", "euro"] as const)
      for (const seed of [3, 77]) {
        const c = compose({ seed, genre, weights: "auto", chords: "classic" });
        const t = compose({ seed, genre, weights: "auto", chords: "theory" });
        expect(t.progressions).toEqual(c.progressions);
      }
  });

  it("varies far more than classic (plan §6 targets)", () => {
    const classic = measureVariety("synthpop", "classic", 150);
    const theory = measureVariety("synthpop", "theory", 150);
    for (const part of ["verse", "chorus"] as const) {
      expect(theory[part].bankEntryUnquoted).toBeLessThan(0.1);
      expect(theory[part].distinct).toBeGreaterThanOrEqual(3 * classic[part].distinct);
    }
    expect(theory.perSong).toBeGreaterThanOrEqual(4);
  });
});
