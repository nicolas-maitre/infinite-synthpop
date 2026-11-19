/**
 * Theory progressions for a song part (docs/plans/theory-chords.md §5): the chorus first, then the
 * verse through a section relation, then the pre-chorus into the chorus, then the interlude,
 * turnaround, bridge and lift against the verse and chorus (§4.2). Phases 2 and 3 cover synthpop;
 * other genres keep classic's chords.
 *
 * Each section draws from its own stream (`harmony:chorus`, `harmony:verse`, …), so classic's
 * draws, made first either way, stay as they are.
 */
import type { GenreAt, GenreId } from "../genres";
import type { Progression } from "../progressions";
import { REFERENCES, type ReferenceId } from "../references";
import type { Rng } from "../rng";
import type { Mode } from "../theory";
import type { HarmonyAnalysis, SectionKind } from "./analysis";
import {
  approachWeight,
  choosePart,
  SECTION_CHOICE,
  progressionText,
  score,
  scoreSection,
  writeLoop,
  writePrechorus,
  writeSection,
  type HarmonyContext,
} from "./generate";
import { SYNTHPOP_HARMONY } from "./synthpop";

/** The genres with an analysis so far. */
export const HARMONY: Partial<Record<GenreId, HarmonyAnalysis>> = { synthpop: SYNTHPOP_HARMONY };

export interface TheoryChords {
  verse: Progression;
  chorus: Progression;
  prechorus?: Progression;
  interlude: Progression;
  turnaround: Progression;
  bridge: Progression;
  /** In the lift key: the major key a fourth up. */
  lift: Progression;
  /** The section played on its strongest reference's measured loop, as a nod to the record. */
  quoted: "verse" | "chorus" | null;
}

export interface TheoryOptions {
  /** The verse plays over the chorus's loop (You Came; the form's `verseOnLoop` draw). */
  sameLoop: boolean;
  /** Write a pre-chorus too (classic made one). */
  prechorus: boolean;
}

/** The generator's view of a genre at a blend. */
export function harmonyContext(p: GenreAt, mode: Mode): HarmonyContext | null {
  const analysis = HARMONY[p.genre.id];
  if (!analysis) return null;
  const bank = new Set(
    (["verse", "chorus", "prechorus"] as const).flatMap((k) =>
      p.genre.bank[k].map((e) => progressionText(e.bars)),
    ),
  );
  return { analysis, mode, at: p.at, bank };
}

/** The reference with the most weight among those in the song's key mode (a minor song can't
 * quote You Came's major loop). */
export function strongestReference(p: GenreAt, mode: Mode): ReferenceId | null {
  let best: ReferenceId | null = null;
  let most = 0;
  p.genre.references.forEach((r, i) => {
    const w = p.weights[i] ?? 0;
    if (w > most && REFERENCES[r].key.mode === mode) {
      best = r;
      most = w;
    }
  });
  return best;
}

/** A reference's measured loop for a section. A verse that ends pushed into its pre-chorus
 * (You Came's) is the chorus loop with that push; the loop itself is quoted. */
function quoteOf(ref: ReferenceId, kind: "verse" | "chorus"): Progression {
  const r = REFERENCES[ref];
  if (kind === "chorus") return r.chorus;
  const last = r.verse[r.verse.length - 1];
  const pushed = last?.length === 2 && (last[1] === "I" || last[1] === "i");
  return pushed ? r.chorus : r.verse;
}

/** The song part's verse, chorus and pre-chorus, or null for a genre without an analysis. */
export function theoryChords(
  root: Rng,
  p: GenreAt,
  mode: Mode,
  opts: TheoryOptions,
): TheoryChords | null {
  const ctx = harmonyContext(p, mode);
  if (!ctx) return null;
  const rngQuote = root.fork("harmony:quote");
  const ref = strongestReference(p, mode);
  let quoted: TheoryChords["quoted"] = null;
  if (ref && rngQuote.chance(p.at(ctx.analysis.quote)))
    quoted = rngQuote.chance(ctx.analysis.quoteChorus) ? "chorus" : "verse";
  // A verse on the chorus's loop quotes through its chorus.
  if (quoted === "verse" && opts.sameLoop) quoted = "chorus";

  const chorus =
    quoted === "chorus" && ref
      ? quoteOf(ref, "chorus")
      : choosePart(
          root.fork("harmony:chorus"),
          (r) => writeLoop(r, ctx, "chorus"),
          (c) => score(ctx, c, { kind: "chorus" }),
        );
  const verse = opts.sameLoop
    ? chorus
    : quoted === "verse" && ref
      ? quoteOf(ref, "verse")
      : choosePart(
          root.fork("harmony:verse"),
          (r) => writeLoop(r, ctx, "verse"),
          (c) => score(ctx, c, { kind: "verse", chorus }),
        );
  const tonic = mode === "major" ? "I" : "i";
  const verseFirst = verse[0]?.[0] ?? tonic;
  const chorusFirst = chorus[0]?.[0] ?? tonic;
  let prechorus: Progression | undefined;
  if (opts.prechorus)
    prechorus = choosePart(
      root.fork("harmony:prechorus"),
      (r) => writePrechorus(r, ctx, chorusFirst, tonic),
      (c) => score(ctx, c, { kind: "prechorus", entry: tonic, exit: chorusFirst }),
    );

  // The secondary sections, against the verse and chorus: a turnaround leads into the verse's
  // first chord, a bridge into the chorus's; the lift is written in the lift key.
  const section = (kind: SectionKind, c: HarmonyContext, exit?: string) =>
    choosePart(
      root.fork(`harmony:${kind}`),
      (r) => writeSection(r, c, kind, kind === "turnaround" ? exit : undefined),
      (x) => scoreSection(c, x, { kind, verse, chorus, ...(exit ? { exit } : {}) }),
      SECTION_CHOICE,
    );
  const out: TheoryChords = {
    verse,
    chorus,
    quoted,
    interlude: section("interlude", ctx),
    turnaround: section("turnaround", ctx, verseFirst),
    bridge: section("bridge", ctx, chorusFirst),
    lift: section("lift", { ...ctx, mode: "major" }),
  };
  if (prechorus) out.prechorus = prechorus;

  // A quoted chorus brings its record's measured sections along now and then, where they fit.
  const measured = quoted === "chorus" && ref ? ctx.analysis.quoteSections.loops[ref] : undefined;
  if (measured) {
    const rng = root.fork("harmony:quote-sections");
    const text = progressionText;
    for (const kind of ["interlude", "turnaround", "bridge"] as const) {
      const loop = measured[kind];
      if (!loop || !rng.chance(ctx.analysis.quoteSections.chance)) continue;
      const last = loop[loop.length - 1]?.at(-1) ?? tonic;
      const fits =
        kind === "turnaround"
          ? approachWeight(ctx, last, verseFirst) > 0
          : text(loop) !== text(chorus) && text(loop) !== text(verse);
      if (fits) out[kind] = loop;
    }
  }
  return out;
}
