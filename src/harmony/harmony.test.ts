import { describe, expect, it } from "vitest";
import { compose, type Song } from "../composer";
import { GENRES, genreAt } from "../genres";
import type { Bar, Progression } from "../progressions";
import { REFERENCES, type ReferenceId } from "../references";
import { createRng } from "../rng";
import { chord, chordPitchClasses, mod12, type Mode } from "../theory";
import { measureVariety } from "../variety";
import type { SectionKind } from "./analysis";
import {
  approachWeight,
  cadenceOptions,
  progressionText,
  writeLoop,
  writePrechorus,
  writeSection,
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

  it("leaves everything but the chords as classic draws it", () => {
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
      // The same form; only a pre-chorus's and a turnaround's lengths follow their progressions.
      expect(t.sections.map((s) => s.kind)).toEqual(c.sections.map((s) => s.kind));
      t.sections.forEach((s, j) => {
        if (s.kind !== "prechorus" && s.kind !== "turnaround")
          expect(s.bars).toBe(c.sections[j]!.bars);
      });
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

describe("theory chords: synthpop's secondary sections", () => {
  /** Many raw candidates (before scoring) for a section at a blend. */
  function sectionCandidates(
    ctx: HarmonyContext,
    kind: SectionKind,
    n: number,
    target?: string,
  ): Set<string> {
    const rng = createRng(11);
    const out = new Set<string>();
    for (let i = 0; i < n; i++) out.add(progressionText(writeSection(rng, ctx, kind, target)));
    return out;
  }

  it("leads every turnaround into its verse's first chord", () => {
    for (const song of SONGS) {
      const t = song.progressions.turnaround;
      const last = t[t.length - 1]!.at(-1)!;
      const target = song.progressions.verse[0]![0]!;
      const ctx = contextAt(song.weights, song.key.mode);
      expect(
        approachWeight(ctx, last, target),
        `${progressionText(t)} → ${target}`,
      ).toBeGreaterThan(0);
      // Up a step or a fourth, down a fifth or a step, ♭VI → i, or a semitone up: never a hold, a
      // tritone or a leap up a third.
      expect([1, 2, 4, 5, 7, 10]).toContain(mod12(chord(target).root - chord(last).root));
      // The planner plays a turnaround as 2 or 4 bars, so it ends where its progression ends.
      expect([2, 4]).toContain(t.length);
    }
  });

  it("keeps the lift in its major key", () => {
    const scale = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const song of SONGS) {
      const lift = song.progressions.lift;
      expect(lift[0]).toEqual(["I"]);
      for (const bar of lift)
        for (const n of bar)
          for (const pc of chordPitchClasses({ tonic: 0, mode: "major" }, chord(n)))
            expect(scale, `${n} in ${progressionText(lift)}`).toContain(pc);
      // The outro plays it in the lift key, a fourth up.
      for (const s of song.sections.filter((x) => x.progression === lift))
        expect(s.key).toEqual({ tonic: mod12(song.key.tonic + 5), mode: "major" });
    }
  });

  it("doesn't repeat the chorus in an interlude or a bridge", () => {
    for (const song of SONGS) {
      const chorus = progressionText(song.progressions.chorus);
      expect(progressionText(song.progressions.interlude)).not.toBe(chorus);
      expect(progressionText(song.progressions.bridge)).not.toBe(chorus);
    }
  });

  it("brings a chorus's Dorian IV back in its bridge", () => {
    let iv = 0;
    let dorian = 0;
    for (let i = 0; i < 200; i++) {
      const opts = { seed: 50 + i * 13, genre: "synthpop", weights: solo(REFS[0]!) } as const;
      const t = compose({ ...opts, chords: "theory" });
      const chords = new Set([...t.progressions.verse, ...t.progressions.chorus].flat());
      if (!chords.has("IV") || chords.has("iv")) continue;
      const bridge = new Set(t.progressions.bridge.flat());
      if (bridge.has("iv") && !bridge.has("IV")) iv++;
      if (bridge.has("IV")) dorian++;
    }
    expect(dorian).toBeGreaterThan(10);
    expect(iv).toBeLessThan(dorian / 5);
  });

  it("reaches each reference's measured sections at that reference's weight alone", () => {
    const measured: Record<
      ReferenceId,
      { mode: Mode; verseFirst: string } & Record<Exclude<SectionKind, "lift">, Bar[][]>
    > = {
      "true-faith": {
        mode: "minor",
        verseFirst: "i",
        // "An instrumental chorus" (genres.ts 'TF instrumental').
        interlude: [[["i"], ["III"], ["VII"], ["IV"]]],
        turnaround: [
          [["VI"], ["VI"]],
          [["VI"], ["VII"]],
        ],
        bridge: [[["i", "IV"], ["IV"], ["i", "IV"], ["IV"]]],
      },
      "different-story": {
        mode: "minor",
        verseFirst: "i",
        interlude: [[["III"], ["VII"], ["iv"], ["i", "VII"]]],
        turnaround: [[["ii"], ["ii"], ["IV"], ["IV"]]],
        bridge: [[["ii"], ["ii"], ["IV"], ["V"]]],
      },
      // You Came's verse is its loop, opening on IV.
      "you-came": {
        mode: "major",
        verseFirst: "IV",
        interlude: [
          [["IVadd9"], ["V"]],
          [["IV"], ["V"], ["IV"], ["V", "I/3"]],
        ],
        turnaround: [[["IV"], ["V"]]],
        bridge: [[["IVmaj7"], ["Vadd9"], ["IV/3"], ["Vsus4", "V"]]],
      },
    } as never;
    for (const ref of REFS) {
      const m = measured[ref];
      const ctx = contextAt(solo(ref), m.mode);
      for (const kind of ["interlude", "turnaround", "bridge"] as const) {
        const seen = sectionCandidates(
          ctx,
          kind,
          5000,
          kind === "turnaround" ? m.verseFirst : undefined,
        );
        for (const loop of m[kind]) expect(seen, `${ref} ${kind}`).toContain(progressionText(loop));
      }
    }
    // TF's outro vamp, in the lift key.
    const tf = contextAt(solo("true-faith"), "major");
    expect(sectionCandidates(tf, "lift", 2000)).toContain("I │ I │ I │ I–V");
  });
});
