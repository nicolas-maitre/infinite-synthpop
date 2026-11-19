/**
 * Blends across genres (docs/plans/theory-chords.md §7 phase 4): the genres' analyses merged by
 * their shares of the song part, as `pickFromBanks` and `substituteFrom` mix the banks.
 *
 * Each genre's traits are read at its own weights (its references' weights within the blend,
 * normalised), so every weight becomes a number. A list of options (schemas, cadences, shapes,
 * second lines) is scaled so that the genre's options together weigh its share: a 30% Euro blend
 * draws a Euro schema about 30% of the time, however many schemas each analysis lists. A single
 * number (a chance, a motion weight) is the share-weighted mean. The merged analysis holds only
 * constant blends (`{ base }`), which the context reads as they are.
 */
import type { Blend } from "../genres";
import type { Mode } from "../theory";
import type {
  Approach,
  BarOption,
  Cadence,
  Colour,
  HarmonyAnalysis,
  ModeTraits,
  Option,
  PreShape,
  Schema,
  SectionShape,
  SectionTraits,
} from "./analysis";

/** One genre's part: its analysis, its share of the blend, and its traits read at its weights. */
export interface Part {
  analysis: HarmonyAnalysis;
  share: number;
  at: (b: Blend) => number;
}

const k = (n: number): Blend => ({ base: n });
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The share-weighted mean of a number every genre reads its own way. */
function mean(parts: readonly Part[], pick: (p: Part) => number): Blend {
  return k(sum(parts.map((p) => p.share * pick(p))));
}

/** A list's weights scaled so the genre's options together weigh its share. */
function scaled<T>(
  parts: readonly Part[],
  list: (p: Part) => readonly T[],
  weight: (p: Part, x: T) => number,
  make: (p: Part, x: T, w: number) => T,
): T[] {
  return parts.flatMap((p) => {
    const xs = list(p);
    const total = sum(xs.map((x) => Math.max(0, weight(p, x))));
    if (total <= 0) return [];
    return xs.map((x) => make(p, x, (p.share * Math.max(0, weight(p, x))) / total));
  });
}

/** A slot's options read at the genre's weights (their scale within the slot doesn't matter). */
const resolveBar = (p: Part, opts: readonly BarOption[]): BarOption[] =>
  opts.map((x) => ({ ...x, weight: k(p.at(x.weight)) }));
const resolveSlots = (p: Part, slots: Schema["bars"]): Schema["bars"] =>
  slots.map((s) => (s === "cadence" ? s : resolveBar(p, s)));

function mergeSchemas(parts: readonly Part[], m: Mode): Schema[] {
  // Each kind is scaled on its own, so a genre's verse schemas weigh its share of verses.
  type Kind = "verse" | "chorus" | "later";
  const totals = new Map<Part, Record<Kind, number>>();
  for (const p of parts) {
    const schemas = p.analysis.modes[m].schemas;
    totals.set(p, {
      verse: sum(schemas.map((s) => Math.max(0, p.at(s.weight.verse)))),
      chorus: sum(schemas.map((s) => Math.max(0, p.at(s.weight.chorus)))),
      later: sum(schemas.map((s) => Math.max(0, p.at(s.weight.later ?? {})))),
    });
  }
  return parts.flatMap((p) =>
    p.analysis.modes[m].schemas.map((s): Schema => {
      const t = totals.get(p)!;
      const w = (kind: Kind, b: Blend | undefined) =>
        t[kind] > 0 ? k((p.share * Math.max(0, p.at(b ?? {}))) / t[kind]) : k(0);
      return {
        ...s,
        weight: {
          verse: w("verse", s.weight.verse),
          chorus: w("chorus", s.weight.chorus),
          ...(s.weight.later ? { later: w("later", s.weight.later) } : {}),
        },
        bars: resolveSlots(p, s.bars),
        ...(s.cell
          ? {
              cell: {
                repeats: s.cell.repeats.map((r) => ({ ...r, weight: k(p.at(r.weight)) })),
                tag: s.cell.tag.map((x) =>
                  typeof x === "number" || x === "cadence" ? x : resolveBar(p, x),
                ),
              },
            }
          : {}),
      };
    }),
  );
}

const shapes = (parts: readonly Part[], list: (p: Part) => readonly SectionShape[]) =>
  scaled(
    parts,
    list,
    (p, x) => p.at(x.weight),
    (p, x, w) => ({ ...x, weight: k(w), bars: x.bars.map((b) => resolveBar(p, b)) }),
  );
const preShapes = (parts: readonly Part[], list: (p: Part) => readonly PreShape[]) =>
  scaled(
    parts,
    list,
    (p, x) => p.at(x.weight),
    (p, x, w) => ({ ...x, weight: k(w), bars: x.bars.map((b) => resolveBar(p, b)) }),
  );
const options = <T>(parts: readonly Part[], list: (p: Part) => readonly Option<T>[]) =>
  scaled(
    parts,
    list,
    (p, x) => p.at(x.weight),
    (_p, x, w) => ({ ...x, weight: k(w) }),
  );

function cadences(parts: readonly Part[], m: Mode, kind: "verse" | "chorus"): Cadence[] {
  const list = (p: Part) => p.analysis.modes[m].cadences[kind];
  const first = scaled(
    parts,
    list,
    (p, x) => p.at(x.weight),
    (_p, x, w) => ({ ...x, weight: k(w) }),
  );
  const answer = scaled(
    parts,
    list,
    (p, x) => p.at(x.answer ?? x.weight),
    (_p, x, w) => ({ ...x, weight: k(w) }),
  );
  return first.map((c, i) => ({ ...c, answer: answer[i]?.weight ?? c.weight }));
}

function approaches(parts: readonly Part[], m: Mode): Approach[] {
  const by = new Map<number, number>();
  for (const p of parts)
    for (const a of p.analysis.modes[m].sections.approach)
      by.set(a.interval, (by.get(a.interval) ?? 0) + p.share * p.at(a.weight));
  return [...by].map(([interval, w]) => ({ interval, weight: k(w) }));
}

function sections(parts: readonly Part[], m: Mode): SectionTraits {
  const t = (p: Part) => p.analysis.modes[m].sections;
  const byShare = [...parts].sort((a, b) => b.share - a.share);
  return {
    interlude: shapes(parts, (p) => t(p).interlude),
    turnaround: shapes(parts, (p) => t(p).turnaround),
    bridge: shapes(parts, (p) => t(p).bridge),
    approach: approaches(parts, m),
    palette: [...new Set(byShare.flatMap((p) => t(p).palette))],
  };
}

function mergeMode(parts: readonly Part[], m: Mode): ModeTraits {
  const t = (p: Part) => p.analysis.modes[m];
  const lead = [...parts].sort((a, b) => b.share - a.share)[0]!;
  const withEndings = parts.filter((p) => t(p).prechorus.endings?.length);
  const colours = scaled<Colour>(
    parts,
    (p) => t(p).colours,
    (p, x) => p.at(x.weight),
    (_p, x, w) => ({ ...x, weight: k(w) }),
  );
  return {
    schemas: mergeSchemas(parts, m),
    cadences: { verse: cadences(parts, m, "verse"), chorus: cadences(parts, m, "chorus") },
    colours,
    colourChance: mean(parts, (p) => p.at(t(p).colourChance)),
    // The leading genre's sense of what counts as a colour chord.
    colourChords: t(lead).colourChords,
    anticipate: mean(parts, (p) => p.at(t(p).anticipate)),
    secondLine: {
      verse: options(parts, (p) => t(p).secondLine.verse),
      chorus: options(parts, (p) => t(p).secondLine.chorus),
    },
    prechorus: {
      source: parts.map((p) => t(p).prechorus.source).join(" / "),
      long: preShapes(parts, (p) => t(p).prechorus.long),
      longWeight: mean(parts, (p) => p.at(t(p).prechorus.longWeight)),
      short: preShapes(parts, (p) => t(p).prechorus.short),
      susDelay: mean(parts, (p) => p.at(t(p).prechorus.susDelay)),
      deceptive: mean(parts, (p) => p.at(t(p).prechorus.deceptive)),
      ...(withEndings.length
        ? {
            endings: options(withEndings, (p) => t(p).prechorus.endings ?? []),
            endingWeight: mean(withEndings, (p) =>
              p.at(t(p).prechorus.endingWeight ?? { base: 1 }),
            ),
          }
        : {}),
    },
    sections: sections(parts, m),
    bass: {
      source: "merged",
      hold: mean(parts, (p) => p.at(t(p).bass?.hold ?? {})),
      approach: mean(parts, (p) => p.at(t(p).bass?.approach ?? {})),
    },
    colourPerLine: sum(parts.map((p) => p.share * (t(p).colourPerLine ?? 1))),
    maxHold: {
      verse: sum(parts.map((p) => p.share * (t(p).maxHold?.verse ?? 2))),
      chorus: sum(parts.map((p) => p.share * (t(p).maxHold?.chorus ?? 2))),
    },
    rhythmContrast: mean(parts, (p) => p.at(t(p).rhythmContrast ?? {})),
  };
}

/** The genres' analyses merged by share, every weight a constant. */
export function mergeAnalyses(parts: readonly Part[]): HarmonyAnalysis {
  const lead = [...parts].sort((x, y) => y.share - x.share)[0]!;
  const modes = { minor: mergeMode(parts, "minor"), major: mergeMode(parts, "major") };
  const a = (p: Part) => p.analysis;
  return {
    modes,
    motion: {
      source: "merged",
      step: mean(parts, (p) => p.at(a(p).motion.step)),
      fourth: mean(parts, (p) => p.at(a(p).motion.fourth)),
      third: mean(parts, (p) => p.at(a(p).motion.third)),
      hold: mean(parts, (p) => p.at(a(p).motion.hold)),
      tritone: mean(parts, (p) => p.at(a(p).motion.tritone)),
    },
    quote: mean(parts, (p) => p.at(a(p).quote)),
    quoteChorus: sum(parts.map((p) => p.share * a(p).quoteChorus)),
    formPlays: parts.flatMap((p) => a(p).formPlays),
    lift: shapes(parts, (p) => a(p).lift),
    quoteSections: {
      chance: sum(parts.map((p) => p.share * a(p).quoteSections.chance)),
      loops: Object.assign({}, ...parts.map((p) => a(p).quoteSections.loops)),
    },
    ...(lead.analysis.sameLoopOnTonic ? { sameLoopOnTonic: true } : {}),
  };
}
