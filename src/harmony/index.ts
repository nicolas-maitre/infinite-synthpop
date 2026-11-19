/**
 * Theory progressions for a song part (docs/plans/theory-chords.md §5): the chorus first, then the
 * verse through a section relation, then the pre-chorus into the chorus, then the interlude,
 * turnaround, bridge and lift against the verse and chorus (§4.2). Every genre has an analysis
 * (synthpop.ts, italo.ts, euro.ts); a song part whose blend spans genres reads them merged by
 * their shares (merge.ts).
 *
 * Each section draws from its own stream (`harmony:chorus`, `harmony:verse`, …), so classic's
 * draws, made first either way, stay as they are.
 */
import { blend, type Blend, type Genre, type GenreAt, type GenreId } from "../genres";
import type { Progression } from "../progressions";
import { REFERENCES, type ReferenceId } from "../references";
import type { GenreShare } from "../profile";
import type { Rng } from "../rng";
import type { Mode } from "../theory";
import type { HarmonyAnalysis, SectionKind } from "./analysis";
import {
  approachWeight,
  choosePart,
  SECTION_CHOICE,
  SHAPE_CHOICE,
  progressionText,
  score,
  scoreSection,
  writeLoop,
  writePrechorus,
  writeSection,
  type HarmonyContext,
} from "./generate";
import { EURO_HARMONY } from "./euro";
import { ITALO_HARMONY } from "./italo";
import { mergeAnalyses } from "./merge";
import { SYNTHPOP_HARMONY } from "./synthpop";

/** The genres with an analysis. */
export const HARMONY: Partial<Record<GenreId, HarmonyAnalysis>> = {
  synthpop: SYNTHPOP_HARMONY,
  italo: ITALO_HARMONY,
  euro: EURO_HARMONY,
};

/** A song part's blend: one genre at its weights, or (`mixed`) its genres' shares. */
export type HarmonyBlend = GenreAt & { mixed?: boolean; shares?: readonly GenreShare[] };

/** A blend's merged planner plays a chorus for 8 bars when its body is synthpop, and for 16 when
 * it's Italo, so a blend's loops are 2, 4 or 8 bars long. */
const fitsMerged = (bars: number) => bars <= 8 && 8 % bars === 0;

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

const bankOf = (genres: readonly Genre[]) =>
  new Set(
    genres.flatMap((g) =>
      (["verse", "chorus", "prechorus"] as const).flatMap((k) =>
        g.bank[k].map((e) => progressionText(e.bars)),
      ),
    ),
  );

/** The generator's view of a genre at a blend, or of several genres merged by their shares. */
export function harmonyContext(p: HarmonyBlend, mode: Mode): HarmonyContext | null {
  if (p.mixed && p.shares) {
    const parts = p.shares.flatMap((s) => {
      const analysis = HARMONY[s.genre.id];
      return analysis
        ? [{ analysis, share: s.share, at: (b: Blend) => blend(s.genre, b, s.weights) }]
        : [];
    });
    if (!parts.length) return null;
    return {
      analysis: mergeAnalyses(parts),
      mode,
      at: (b) => b.base ?? 0,
      bank: bankOf(p.shares.map((s) => s.genre)),
      fits: fitsMerged,
    };
  }
  const analysis = HARMONY[p.genre.id];
  if (!analysis) return null;
  return { analysis, mode, at: p.at, bank: bankOf([p.genre]) };
}

/** The reference with the most weight among those in the song's key mode (a minor song can't
 * quote You Came's major loop). */
export function strongestReference(p: HarmonyBlend, mode: Mode): ReferenceId | null {
  let best: ReferenceId | null = null;
  let most = 0;
  const shares =
    p.mixed && p.shares ? p.shares : [{ genre: p.genre, share: 1, weights: p.weights }];
  for (const s of shares)
    s.genre.references.forEach((r, i) => {
      const w = s.share * (s.weights[i] ?? 0);
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
  p: HarmonyBlend,
  mode: Mode,
  opts: TheoryOptions,
): TheoryChords | null {
  const ctx = harmonyContext(p, mode);
  if (!ctx) return null;
  const rngQuote = root.fork("harmony:quote");
  const ref = strongestReference(p, mode);
  let quoted: TheoryChords["quoted"] = null;
  if (ref && rngQuote.chance(ctx.at(ctx.analysis.quote)))
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
  // The form's verse on the chorus's loop (You Came, Self Control); Italo's holds only for a chorus
  // in the home key, on its tonic.
  const onTonic = chorus[0]?.[0] === (mode === "major" ? "I" : "i");
  const sameLoop = opts.sameLoop && (!ctx.analysis.sameLoopOnTonic || onTonic);
  const verse = sameLoop
    ? chorus
    : quoted === "verse" && ref
      ? quoteOf(ref, "verse")
      : choosePart(
          root.fork("harmony:verse"),
          (r) => writeLoop(r, ctx, "verse"),
          (c) => score(ctx, c, { kind: "verse", chorus }),
        );
  const tonic = mode === "major" ? "I" : "i";
  const traits = ctx.analysis.modes[mode];
  const verseFirst = verse[0]?.[0] ?? tonic;
  const chorusFirst = chorus[0]?.[0] ?? tonic;
  let prechorus: Progression | undefined;
  // Synthpop's planner pushes the verse's last bar to the tonic before a pre-chorus; Euro's plays
  // the verse as it is.
  const entry = traits.prechorus.fromVerse ? (verse[verse.length - 1]?.at(-1) ?? tonic) : tonic;
  if (opts.prechorus)
    prechorus = choosePart(
      root.fork("harmony:prechorus"),
      (r) => writePrechorus(r, ctx, chorusFirst, tonic, entry),
      (c) => score(ctx, c, { kind: "prechorus", entry, exit: chorusFirst }),
      ...(traits.prechorus.byShape ? [SHAPE_CHOICE] : []),
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
