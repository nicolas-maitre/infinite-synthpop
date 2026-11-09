/**
 * Progression picking and style-weighted substitutions. A progression is a list of bars; each bar
 * holds 1 chord, or 2 that split the bar in half. A bank entry's `style` places it on the genre's
 * style axis (for synthpop, 0 = True Faith … 1 = The Different Story). The banks and the
 * substitutions live in the genre profiles (genres.ts).
 */
import { genreAt, type Genre } from "./genres";
import type { Rng } from "./rng";

export type Bar = readonly string[];
export type Progression = readonly Bar[];
export type ProgressionKind = "verse" | "chorus" | "interlude" | "turnaround" | "bridge" | "lift";

export interface BankEntry {
  name: string;
  bars: Progression;
  style: number;
}

/** Closer entries on the style axis are far more likely, but nothing is ruled out. */
export function pickProgression(
  genre: Genre,
  kind: ProgressionKind,
  style: number,
  rng: Rng,
): Progression {
  const entries = genre.bank[kind].map((e) => {
    const d = e.style - style;
    return [e.bars, Math.exp(-(d * d) / (2 * 0.3 * 0.3)) + 0.04] as const;
  });
  return rng.weighted(entries);
}

/**
 * Applies the genre's substitutions (for synthpop, the ones the two songs demonstrate: IV ↔ iv,
 * v ↔ V, and iv → VI at the chorus end). The opening bar (and a chorus's VII) stay put.
 */
export function mutate(
  genre: Genre,
  prog: Progression,
  kind: ProgressionKind,
  style: number,
  rng: Rng,
  amount = 0.3,
): Progression {
  if (kind === "lift" || kind === "turnaround") return prog;
  const g = genreAt(genre, style);
  const bars = prog.map((bar) => [...bar]);
  for (let b = 1; b < bars.length; b++) {
    const bar = bars[b];
    if (!bar) continue;
    const lastBar = b === bars.length - 1;
    for (let c = 0; c < bar.length; c++) {
      if (!rng.chance(amount)) continue;
      const n = bar[c];
      // The first substitution that applies and comes up wins; each draws only if it applies.
      const sub = genre.substitutions.find(
        (s) =>
          (!s.kinds || s.kinds.includes(kind)) &&
          (!s.lastBar || lastBar) &&
          n === s.from &&
          rng.chance(g.at(s.chance)),
      );
      if (sub) bar[c] = sub.to;
    }
  }
  return bars;
}
