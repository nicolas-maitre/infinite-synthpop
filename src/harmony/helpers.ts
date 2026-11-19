/** Shorthands for writing a genre's harmonic analysis (synthpop.ts, italo.ts, euro.ts). */
import type { Blend } from "../genres";
import type { Bar } from "../progressions";
import type { BarOption, Cadence, Colour, Option, SecondLine, SectionShape } from "./analysis";

/** A bar option: one chord or a split bar. */
export const o = (bar: string | Bar, weight: Blend, source?: string): BarOption => ({
  value: typeof bar === "string" ? [bar] : bar,
  weight,
  ...(source ? { source } : {}),
});
/** A bar that is always this chord. */
export const fixed = (c: string): BarOption[] => [o(c, { base: 1 })];
export const cad = (
  bar: string | Bar,
  weight: Blend,
  answer?: Blend,
  source?: string,
): Cadence => ({
  value: typeof bar === "string" ? [bar] : bar,
  weight,
  ...(answer ? { answer } : {}),
  ...(source ? { source } : {}),
});
export const colour = (from: string, to: string | Bar, weight: Blend, source: string): Colour => ({
  from,
  to: typeof to === "string" ? [to] : to,
  weight,
  source,
});
export const shape = (
  name: string,
  weight: Blend,
  source: string,
  bars: readonly (readonly BarOption[])[],
): SectionShape => ({ name, weight, source, bars });
export const line = (value: SecondLine, weight: Blend, source?: string): Option<SecondLine> => ({
  value,
  weight,
  ...(source ? { source } : {}),
});
