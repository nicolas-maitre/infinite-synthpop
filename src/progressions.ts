/**
 * Progression picking and style-weighted substitutions. A progression is a list of bars; each bar
 * holds 1 chord, or 2 that split the bar in half. A bank entry's `style` places it on the genre's
 * style axis (for synthpop, 0 = True Faith … 1 = The Different Story); one with a `ref` leans to
 * that reference instead (You Came). The banks and the substitutions live in the genre profiles
 * (genres.ts).
 */
import { genreAt, weightOf, type Genre, type Substitution } from "./genres";
import type { ReferenceId } from "./references";
import type { Rng } from "./rng";
import type { Mode } from "./theory";

export type Bar = readonly string[];
export type Progression = readonly Bar[];
export type ProgressionKind =
  "verse" | "chorus" | "interlude" | "turnaround" | "bridge" | "lift" | "prechorus";

export interface BankEntry {
  name: string;
  bars: Progression;
  /** Where it sits on the style axis; unset for entries placed by `ref` alone. */
  style?: number;
  /** The key mode it is written in; minor by default. Lift entries are always in the (major)
   * lift key and ignore it. */
  mode?: Mode;
  /** The reference it comes from or leans to: among entries without one, it weighs in with that
   * reference's weight, so at weight 0 it is never picked. */
  ref?: ReferenceId;
  /** Relative weight among its peers; 1 by default. */
  weight?: number;
}

/** How strongly a `ref` entry competes with the style-placed ones, per unit of its weight. */
const REF_LEAN = 2;

export interface PickOptions {
  /** The song's key mode: only entries written in it are picked. */
  mode?: Mode;
  /** The per-reference weights `ref` entries weigh in with (all 0 by default). */
  weights?: readonly number[];
}

/** A genre's bank entries for a kind, each with its chance of being picked (closer entries on the
 * style axis are far more likely, but nothing is ruled out), and the pool they came from. Entries
 * at weight 0 are left out rather than weighed at 0, so adding one changes nothing. */
export function bankEntries(
  genre: Genre,
  kind: ProgressionKind,
  style: number,
  { mode = "minor", weights = [] }: PickOptions = {},
): { pool: readonly BankEntry[]; entries: (readonly [Progression, number])[] } {
  const pool = genre.bank[kind].filter((e) => kind === "lift" || (e.mode ?? "minor") === mode);
  const mixed = pool.some((e) => !e.ref);
  const entries = pool
    .map((e) => {
      let w = 1;
      if (e.style !== undefined) {
        const d = e.style - style;
        w = Math.exp(-(d * d) / (2 * 0.3 * 0.3)) + 0.04;
      }
      if (e.weight !== undefined) w *= e.weight;
      if (e.ref && mixed) w *= REF_LEAN * weightOf(genre, weights, e.ref);
      return [e.bars, w] as const;
    })
    .filter(([, w]) => w > 0);
  return { pool, entries };
}

/** Closer entries on the style axis are far more likely, but nothing is ruled out. */
export function pickProgression(
  genre: Genre,
  kind: ProgressionKind,
  style: number,
  rng: Rng,
  opts: PickOptions = {},
): Progression {
  const { pool, entries } = bankEntries(genre, kind, style, opts);
  if (!entries.length) return pool[0]?.bars ?? [["i"]];
  return rng.weighted(entries);
}

/**
 * Applies the genre's substitutions (for synthpop, the ones the songs demonstrate: IV ↔ iv,
 * v ↔ V, and iv → VI at the chorus end; in major keys, You Came's colours). The opening bar (and
 * a chorus's VII) stay put. `at` is a slider style or the per-reference weights.
 */
export function mutate(
  genre: Genre,
  prog: Progression,
  kind: ProgressionKind,
  at: number | readonly number[],
  rng: Rng,
  amount = 0.3,
  mode: Mode = "minor",
): Progression {
  const g = genreAt(genre, at);
  return substitute(
    genre.substitutions.map((s) => [s, () => g.at(s.chance)] as const),
    prog,
    kind,
    rng,
    amount,
    mode,
  );
}

/** `mutate` over substitutions whose chances are already resolved: the first that applies and
 * comes up wins, in order. Several genres' lists can be concatenated (profile.ts). A chance is
 * read only when its substitution applies, as `mutate` always did. */
export function substitute(
  substitutions: readonly (readonly [Substitution, () => number])[],
  prog: Progression,
  kind: ProgressionKind,
  rng: Rng,
  amount = 0.3,
  mode: Mode = "minor",
): Progression {
  if (kind === "lift" || kind === "turnaround") return prog;
  const bars = prog.map((bar) => [...bar]);
  for (let b = 1; b < bars.length; b++) {
    const bar = bars[b];
    if (!bar) continue;
    const lastBar = b === bars.length - 1;
    // A substitution that splits the bar adds a chord, which is not substituted again.
    const chords = bar.length;
    for (let c = 0; c < chords; c++) {
      if (!rng.chance(amount)) continue;
      const n = bar[c];
      // The first substitution that applies and comes up wins; each draws only if it applies.
      const found = substitutions.find(
        ([s, chance]) =>
          (!s.kinds || s.kinds.includes(kind)) &&
          (!s.lastBar || lastBar) &&
          (!s.mode || s.mode === mode) &&
          (typeof s.to === "string" || chords === 1) &&
          n === s.from &&
          rng.chance(chance()),
      );
      const sub = found?.[0];
      if (sub) bar.splice(c, 1, ...(typeof sub.to === "string" ? [sub.to] : sub.to));
    }
  }
  return bars;
}
