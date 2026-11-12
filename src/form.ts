/**
 * What every section planner shares: the layers a section starts from, the tonic push into a
 * pre-chorus, and laying the planned sections end to end. The legacy planners
 * (legacy-planners/) and the merged planner (planner.ts) both build on these.
 */
import type { Layers, Section } from "./composer";
import type { Progression } from "./progressions";
import type { Rng } from "./rng";

export const LAYERS_OFF: Layers = {
  drums: "off",
  bass: false,
  hook: false,
  pad: false,
  riff: false,
  arp: false,
  stabs: false,
  seq: false,
  bassShort: false,
  guitar: false,
  lead: null,
  leadDouble: false,
  leadStack: false,
  counter: false,
};

/** A progression over `bars` bars whose last bar turns to the tonic halfway, pushed into what
 * follows (You Came's verse into its pre-chorus). */
export function intoTonic(prog: Progression, bars: number, tonic: string): Progression {
  const out = Array.from({ length: bars }, (_, i) => prog[i % prog.length] ?? [tonic]);
  out[bars - 1] = [out[bars - 1]?.[0] ?? tonic, tonic];
  return out;
}

export type PlannedSection = Omit<Section, "startBar" | "fill" | "fade">;

/** Lays planned sections end to end: a fill before each verse and chorus (and half the others),
 * and a fade on the last. */
export function placeSections(plan: readonly PlannedSection[], rng: Rng): Section[] {
  let startBar = 0;
  return plan.map((s, i) => {
    const next = plan[i + 1];
    const fill =
      !!next &&
      s.layers.drums !== "off" &&
      (next.kind === "chorus" || next.kind === "verse" || rng.chance(0.5));
    const section: Section = { ...s, startBar, fill, fade: !next };
    startBar += s.bars;
    return section;
  });
}
