/**
 * Progression bank and style-weighted substitutions, measured from the recordings
 * (docs/analysis.md §3). A progression is a list of bars; each bar holds 1 chord, or 2 that split the
 * bar in half. `style` places an entry on the axis 0 = True Faith … 1 = The Different Story.
 */
import type { Rng } from "./rng";

export type Bar = readonly string[];
export type Progression = readonly Bar[];
export type ProgressionKind = "verse" | "chorus" | "interlude" | "turnaround" | "bridge" | "lift";

interface BankEntry {
  name: string;
  bars: Progression;
  style: number;
}

export const BANK: Record<ProgressionKind, readonly BankEntry[]> = {
  verse: [
    { name: "TF verse (measured)", bars: [["i"], ["VI", "VII"], ["v"], ["v"]], style: 0 },
    { name: "TF verse (Hooktheory)", bars: [["i"], ["VI"], ["VII"], ["v", "VII"]], style: 0.15 },
    {
      name: "DS verse (measured)",
      bars: [["i"], ["VI"], ["VII"], ["v"], ["i"], ["VI"], ["iv"], ["V"]],
      style: 1,
    },
    { name: "DS verse line 2", bars: [["i"], ["VI"], ["iv"], ["V"]], style: 0.85 },
    {
      name: "v then V",
      bars: [["i"], ["VI", "VII"], ["v"], ["v"], ["i"], ["VI", "VII"], ["v"], ["V"]],
      style: 0.5,
    },
    { name: "aeolian climb", bars: [["i"], ["VI"], ["VII"], ["v"]], style: 0.5 },
  ],
  chorus: [
    { name: "TF chorus (measured)", bars: [["i"], ["III", "VII"], ["VII"], ["IV"]], style: 0 },
    { name: "TF chorus (plain)", bars: [["i"], ["VII"], ["VII"], ["IV"]], style: 0.1 },
    { name: "DS chorus (measured)", bars: [["i"], ["III"], ["VII"], ["iv"]], style: 1 },
    { name: "DS chorus (C turn)", bars: [["i"], ["III"], ["VII"], ["iv", "VI"]], style: 0.9 },
    { name: "Dorian bridge-chorus", bars: [["i"], ["III"], ["VII"], ["IV"]], style: 0.45 },
    { name: "chorus → V", bars: [["i"], ["III"], ["VII"], ["V"]], style: 0.7 },
  ],
  interlude: [
    { name: "DS interlude (measured)", bars: [["III"], ["VII"], ["iv"], ["i", "VII"]], style: 1 },
    { name: "relative lift", bars: [["III"], ["VII"], ["iv"], ["i"]], style: 0.75 },
    { name: "TF instrumental", bars: [["i"], ["VII"], ["VII"], ["IV"]], style: 0 },
  ],
  turnaround: [
    { name: "DS Dorian turnaround (measured)", bars: [["ii"], ["ii"], ["IV"], ["IV"]], style: 1 },
    { name: "TF turnaround on VI (measured)", bars: [["VI"], ["VI"]], style: 0 },
    { name: "VI–VII", bars: [["VI"], ["VII"]], style: 0.5 },
  ],
  bridge: [
    { name: "TF i–IV vamp (measured)", bars: [["i", "IV"], ["IV"], ["i", "IV"], ["IV"]], style: 0 },
    { name: "DS long-version bridge", bars: [["ii"], ["ii"], ["IV"], ["V"]], style: 1 },
    { name: "subdominant", bars: [["iv"], ["VI"], ["VII"], ["i"]], style: 0.5 },
  ],
  // TF's outro: the chorus's IV becomes the new tonic (major), vamping with the odd V.
  lift: [
    { name: "TF outro vamp (measured)", bars: [["I"], ["I"], ["I"], ["I", "V"]], style: 0 },
    { name: "lift I–IV", bars: [["I"], ["I", "IV"], ["I"], ["V"]], style: 0.3 },
    { name: "lift I–IV–V", bars: [["I"], ["IV"], ["I"], ["V"]], style: 0.6 },
  ],
};

/** Closer entries on the style axis are far more likely, but nothing is ruled out. */
export function pickProgression(kind: ProgressionKind, style: number, rng: Rng): Progression {
  const entries = BANK[kind].map((e) => {
    const d = e.style - style;
    return [e.bars, Math.exp(-(d * d) / (2 * 0.3 * 0.3)) + 0.04] as const;
  });
  return rng.weighted(entries);
}

/**
 * Applies the substitutions the two songs demonstrate: IV ↔ iv (the one-note difference between the
 * choruses), v ↔ V, and iv ↔ VI at the chorus end. The opening bar (and a chorus's VII) stay put.
 */
export function mutate(
  prog: Progression,
  kind: ProgressionKind,
  style: number,
  rng: Rng,
  amount = 0.3,
): Progression {
  if (kind === "lift" || kind === "turnaround") return prog;
  const bars = prog.map((bar) => [...bar]);
  for (let b = 1; b < bars.length; b++) {
    const bar = bars[b];
    if (!bar) continue;
    for (let c = 0; c < bar.length; c++) {
      if (!rng.chance(amount)) continue;
      const n = bar[c];
      if (n === "IV" && rng.chance(style)) bar[c] = "iv";
      else if (n === "iv" && rng.chance(1 - style)) bar[c] = "IV";
      else if (n === "v" && b === bars.length - 1 && rng.chance(style)) bar[c] = "V";
      else if (n === "V" && rng.chance(1 - style)) bar[c] = "v";
      else if (kind === "chorus" && b === bars.length - 1 && n === "iv" && rng.chance(0.3)) {
        bar[c] = "VI";
      }
    }
  }
  return bars;
}
