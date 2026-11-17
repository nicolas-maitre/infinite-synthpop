/**
 * The theory generator (docs/plans/theory-chords.md §5): it writes a song's chorus, then its verse
 * through a section relation, then its pre-chorus, from a genre's harmonic analysis (analysis.ts)
 * read at the song's reference weights.
 *
 * Each section is drawn several times. A candidate picks a schema (a slot pattern for a 4-bar
 * line), fills its slots from their options weighted by the root motion from the previous chord,
 * draws its cadence from the cadence trait, adds a colour and a split bar now and then, and
 * continues after its first line as the second-line trait says. The candidates are scored (bass
 * motion, a cadence that leads back to the loop's start, colour used sparingly, contrast with the
 * chorus, a penalty for being exactly a bank entry) and one is picked by weighted chance among the
 * best, so near-ties still vary. Every draw comes from the streams it is given.
 */
import type { Blend } from "../genres";
import type { Bar, Progression } from "../progressions";
import type { Rng } from "../rng";
import { chord, mod12, type Chord, type Mode } from "../theory";
import type { BarOption, HarmonyAnalysis, ModeTraits, Option, Schema } from "./analysis";

export type At = (b: Blend) => number;
export type LoopKind = "verse" | "chorus";

export interface HarmonyContext {
  analysis: HarmonyAnalysis;
  mode: Mode;
  /** Reads a trait's weight at the song's blend. */
  at: At;
  /** Progressions (as `progressionText`) a candidate loses points for matching exactly. */
  bank: ReadonlySet<string>;
}

/** How many candidates each section draws, and how many of the best the pick chooses among. */
const CANDIDATES = 24;
const BEST = 8;
/** How fast a candidate's chance falls with its score below the best. */
const TEMPERATURE = 0.4;

/** "i │ VI–VII │ v", as the variety measurement writes progressions. */
export const progressionText = (p: Progression): string =>
  p.map((bar) => bar.join("–")).join(" │ ");

const parsed = new Map<string, Chord>();
function info(numeral: string): Chord {
  let c = parsed.get(numeral);
  if (!c) {
    c = chord(numeral);
    parsed.set(numeral, c);
  }
  return c;
}
const bassOf = (n: string) => info(n).bass ?? info(n).root;
const lastOf = (bar: Bar | undefined) => bar?.[bar.length - 1];
const sameBar = (a: Bar | undefined, b: Bar | undefined) =>
  !!a && !!b && a.length === b.length && a.every((n, i) => n === b[i]);

type Motion = "step" | "fourth" | "third" | "hold" | "tritone";

/** How the bass moves from one chord to the next. A new chord over the same bass (V → V7) counts
 * as a step: it moves, just not in the bass. */
export function motionClass(from: string, to: string): Motion {
  if (from === to) return "hold";
  const d = mod12(bassOf(to) - bassOf(from));
  if (d === 0 || d === 1 || d === 2 || d === 10 || d === 11) return "step";
  if (d === 5 || d === 7) return "fourth";
  if (d === 6) return "tritone";
  return "third";
}

const motionWeight = (ctx: HarmonyContext, from: string | undefined, to: string) =>
  from === undefined ? 1 : ctx.at(ctx.analysis.motion[motionClass(from, to)]);

/** A dominant named by its target (`V/ii`, `V7/vi`, `Vsus4/vi`), not V itself. */
export function isApplied(numeral: string): boolean {
  return /^V(7|sus4|7sus4|9sus4|add9|maj7)?\//.test(numeral) && info(numeral).root !== 7;
}

function choose<T>(rng: Rng, options: readonly (readonly [T, number])[]): T | undefined {
  const live = options.filter(([, w]) => w > 0);
  return live.length ? rng.weighted(live) : undefined;
}

function pickOption<T>(
  rng: Rng,
  ctx: HarmonyContext,
  options: readonly Option<T>[],
): T | undefined {
  return choose(
    rng,
    options.map((o) => [o.value, ctx.at(o.weight)] as const),
  );
}

const traitsOf = (ctx: HarmonyContext): ModeTraits => ctx.analysis.modes[ctx.mode];

/** Every cadence of a kind with its weight for a first or an answering line. */
export function cadenceOptions(
  ctx: HarmonyContext,
  kind: LoopKind,
  answer: boolean,
): (readonly [Bar, number])[] {
  return traitsOf(ctx).cadences[kind].map(
    (c) => [c.value, ctx.at(answer ? (c.answer ?? c.weight) : c.weight)] as const,
  );
}

/** Fills slots in order, each option weighted by its trait and by the motion into it. */
function fill(
  rng: Rng,
  ctx: HarmonyContext,
  kind: LoopKind,
  slots: readonly (readonly BarOption[] | "cadence")[],
  prev: string | undefined,
  answer: boolean,
): Bar[] {
  const bars: Bar[] = [];
  for (const slot of slots) {
    const options: (readonly [Bar, number])[] =
      slot === "cadence"
        ? cadenceOptions(ctx, kind, answer)
        : slot.map((o) => [o.value, ctx.at(o.weight)] as const);
    const weighed = options.map(
      ([bar, w]) => [bar, bar[0] === undefined ? 0 : w * motionWeight(ctx, prev, bar[0])] as const,
    );
    const bar = choose(rng, weighed) ?? choose(rng, options) ?? options[0]?.[0] ?? ["i"];
    bars.push(bar);
    prev = lastOf(bar);
  }
  return bars;
}

function pickSchema(
  rng: Rng,
  ctx: HarmonyContext,
  weight: (s: Schema) => Blend | undefined,
  except?: Schema,
): Schema | undefined {
  return choose(
    rng,
    traitsOf(ctx).schemas.map((s) => [s, s === except ? 0 : ctx.at(weight(s) ?? {})] as const),
  );
}

/** One colour in a line, now and then: a chord swapped for its coloured spelling. The cadence bar
 * keeps its own (the cadence trait has its sus pairs); `from` skips bars copied from line 1. */
function colourLine(rng: Rng, ctx: HarmonyContext, bars: Bar[], from = 0): Bar[] {
  const t = traitsOf(ctx);
  if (!rng.chance(ctx.at(t.colourChance))) return bars;
  const spots: (readonly [readonly [number, number, Bar], number])[] = [];
  for (let b = from; b < bars.length - 1; b++) {
    const bar = bars[b] ?? [];
    bar.forEach((n, i) => {
      for (const c of t.colours)
        if (c.from === n && (c.to.length === 1 || bar.length === 1))
          spots.push([[b, i, c.to], ctx.at(c.weight)] as const);
    });
  }
  const spot = choose(rng, spots);
  if (!spot) return bars;
  const [b, i, to] = spot;
  return bars.map((bar, j) => (j === b ? [...bar.slice(0, i), ...to, ...bar.slice(i + 1)] : bar));
}

/** TF's F–C: bar 2 takes bar 3's chord in its second half. */
function anticipate(rng: Rng, ctx: HarmonyContext, bars: Bar[]): Bar[] {
  const [, second, third] = bars;
  if (!second || !third || second.length !== 1 || third.length !== 1) return bars;
  if (second[0] === third[0] || !rng.chance(ctx.at(traitsOf(ctx).anticipate))) return bars;
  return bars.map((bar, j) => (j === 1 ? [...bar, ...third] : bar));
}

/** A fresh 4-bar line from a schema. */
function writeLine(
  rng: Rng,
  ctx: HarmonyContext,
  kind: LoopKind,
  schema: Schema,
  prev: string | undefined,
  answer = false,
): Bar[] {
  const bars = fill(rng, ctx, kind, schema.bars, prev, answer);
  return anticipate(rng, ctx, colourLine(rng, ctx, bars));
}

/** The same opening, bars 3–4 rewritten toward another ending. Gives up (returns null) when the
 * schema has nothing else to say there. */
function answerLine(rng: Rng, ctx: HarmonyContext, kind: LoopKind, schema: Schema, first: Bar[]) {
  for (let tries = 0; tries < 6; tries++) {
    const end = fill(rng, ctx, kind, schema.bars.slice(2), lastOf(first[1]), true);
    if (sameBar(end[1], first[3])) continue;
    return colourLine(rng, ctx, [...first.slice(0, 2), ...end], 2);
  }
  return null;
}

/** One candidate verse or chorus. */
export function writeLoop(rng: Rng, ctx: HarmonyContext, kind: LoopKind): Progression {
  const t = traitsOf(ctx);
  const schema = pickSchema(rng, ctx, (s) => s.weight[kind]) ?? t.schemas[0];
  if (!schema) return [["i"]];
  const first = writeLine(rng, ctx, kind, schema, undefined);
  const later = (except?: Schema) =>
    t.schemas.some((s) => ctx.at(s.weight.later ?? {}) > 0)
      ? pickSchema(rng, ctx, (s) => s.weight.later, except)
      : pickSchema(rng, ctx, (s) => s.weight[kind], except);
  switch (pickOption(rng, ctx, t.secondLine[kind]) ?? "repeat") {
    case "repeat":
      return first;
    case "answer": {
      const answer = answerLine(rng, ctx, kind, schema, first);
      return answer ? [...first, ...answer] : first;
    }
    case "contrast": {
      const next = later(schema);
      return next ? [...first, ...writeLine(rng, ctx, kind, next, lastOf(first[3]))] : first;
    }
    case "four": {
      const second = answerLine(rng, ctx, kind, schema, first) ?? first;
      const third = later();
      const fourth = later(third);
      if (!third || !fourth) return [...first, ...second];
      const l3 = writeLine(rng, ctx, kind, third, lastOf(second[3]));
      const l4 = writeLine(rng, ctx, kind, fourth, lastOf(l3[3]), true);
      return [...first, ...second, ...l3, ...l4];
    }
  }
}

/** The degree a chord stands on, as a bare numeral (`IVmaj7` → `IV`, `I/3` → `I`). */
function degreeOf(numeral: string): string {
  return /^[b♭#♯♮]?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)/u.exec(numeral)?.[0] ?? "I";
}

/** The chord a pre-chorus's last bar leads into, and how: its dominant, or the deceptive turn
 * when the chorus opens on the chord a semitone above the dominant (V/vi → IV, V → VI). */
export function approaches(
  mode: Mode,
  chorusFirst: string,
): { authentic: string | null; deceptive: string | null | undefined } {
  const target = info(chorusFirst);
  const authentic = target.root === 0 ? null : degreeOf(chorusFirst);
  const deceptive =
    mode === "major" && target.root === 5
      ? "vi"
      : mode === "minor" && target.root === 8
        ? null
        : undefined;
  return { authentic, deceptive };
}

/** `V7/vi`, or plain `V7` before the tonic. */
const dominant = (quality: "" | "7" | "sus4", target: string | null) =>
  target === null ? `V${quality}` : `V${quality}/${target}`;

/** One candidate pre-chorus: a build from the pushed tonic, then two bars into the chorus. */
export function writePrechorus(
  rng: Rng,
  ctx: HarmonyContext,
  chorusFirst: string,
  tonic: string,
): Progression {
  const pc = traitsOf(ctx).prechorus;
  const long = rng.chance(ctx.at(pc.longWeight));
  const shapes = long ? pc.long : pc.short;
  const shape =
    choose(
      rng,
      shapes.map((x) => [x, ctx.at(x.weight)] as const),
    ) ?? shapes[0];
  const bars: Bar[] = [];
  let prev: string | undefined = tonic;
  for (const slot of shape?.bars ?? []) {
    const options = slot.map((o) => [o.value, ctx.at(o.weight)] as const);
    const bar = choose(
      rng,
      options.map(([b, w]) => [b, b[0] ? w * motionWeight(ctx, prev, b[0]) : 0] as const),
    ) ??
      options[0]?.[0] ?? [tonic];
    bars.push(bar);
    prev = lastOf(bar);
  }
  const { authentic, deceptive } = approaches(ctx.mode, chorusFirst);
  const target =
    deceptive !== undefined && rng.chance(ctx.at(pc.deceptive)) ? deceptive : authentic;
  if (rng.chance(ctx.at(pc.susDelay))) {
    bars.push([dominant("sus4", target)], [dominant("7", target)]);
  } else {
    const pre = ctx.mode === "major" ? ["ii", "IV"] : ["iv", "VI"];
    const pick = choose(
      rng,
      pre.map((n) => [n, prev === n ? 0.1 : 1] as const),
    );
    bars.push([pick ?? pre[0] ?? "IV"], [dominant("7", target)]);
  }
  return bars;
}

/** Bars of a progression split into 4-bar lines. */
const linesOf = (p: Progression): Progression[] =>
  Array.from({ length: Math.ceil(p.length / 4) }, (_, i) => p.slice(i * 4, i * 4 + 4));

/** What a candidate is scored against. */
export interface ScoreContext {
  kind: LoopKind | "prechorus";
  /** The chorus a verse is set against, unless the verse is the chorus's loop. */
  chorus?: Progression;
  /** The chord before a pre-chorus (the pushed tonic) and the chorus's first after it. */
  entry?: string;
  exit?: string;
}

/** A motion's score: what the references weigh it at, against a step (log-scaled), and a tritone
 * is always rough. */
function motionScore(ctx: HarmonyContext, m: Motion): number {
  const step = Math.max(1e-3, ctx.at(ctx.analysis.motion.step));
  const w = Math.max(1e-3, ctx.at(ctx.analysis.motion[m]));
  return 1 + 0.5 * Math.log(w / step) - (m === "tritone" ? 1 : 0);
}

/** Each chord's length in half bars, in order, merging a chord that carries over a bar line. */
function holds(p: Progression): number[] {
  const out: [string, number][] = [];
  for (const bar of p)
    for (const n of bar) {
      const halves = bar.length === 1 ? 2 : 1;
      const last = out[out.length - 1];
      if (last && last[0] === n) last[1] += halves;
      else out.push([n, halves]);
    }
  return out.map(([, h]) => h);
}

/** How good a candidate is (higher is better); see the file comment for what counts. */
export function score(ctx: HarmonyContext, p: Progression, s: ScoreContext): number {
  const t = traitsOf(ctx);
  const seq = p.flat();
  const loops = s.kind !== "prechorus";
  const pairs: [string, string][] = [];
  if (s.entry && seq[0]) pairs.push([s.entry, seq[0]]);
  for (let i = 0; i + 1 < seq.length; i++) pairs.push([seq[i] ?? "i", seq[i + 1] ?? "i"]);
  const wrap: [string, string] | null = loops
    ? [seq[seq.length - 1] ?? "i", seq[0] ?? "i"]
    : s.exit
      ? [seq[seq.length - 1] ?? "i", s.exit]
      : null;
  if (wrap) pairs.push(wrap);

  const value = ([a, b]: [string, string]) => motionScore(ctx, motionClass(a, b));
  let total = pairs.length ? (2 * pairs.reduce((n, pr) => n + value(pr), 0)) / pairs.length : 0;

  // The cadence leads back to the start (or into the chorus): a step or a fourth, not a hold.
  if (wrap) total += 0.5 * value(wrap);
  // A dominant named by its target goes there (or a semitone above it, deceptively).
  for (const [a, b] of pairs) {
    if (!isApplied(a)) continue;
    const d = mod12(info(b).root - info(a).root);
    if (d !== 5 && d !== 1) total -= 2;
  }
  // No chord held for more than two bars (TF's v │ v is the longest).
  for (const h of holds(p)) if (h > 4) total -= 1.5;
  for (const line of linesOf(p)) {
    // Colour once per line: bars with a borrowed chord or a coloured quality.
    const coloured = line.filter((bar) =>
      bar.some((n) => {
        const c = info(n);
        return (
          t.colourChords.includes(n) ||
          (c.quality !== "maj" && c.quality !== "min" && c.bass === undefined)
        );
      }),
    ).length;
    if (coloured > 1) total -= 0.7 * (coloured - 1);
    if (new Set(line.flat()).size < 2) total -= 2;
  }
  const text = progressionText(p);
  // Lighter on a pre-chorus: the plan's variety targets are the verse's and the chorus's.
  if (ctx.bank.has(text)) total -= s.kind === "prechorus" ? 0.3 : 0.8;
  if (s.chorus) {
    // An audible contrast: not the chorus, not its first line, not its cadence.
    if (text === progressionText(s.chorus)) total -= 4;
    else if (progressionText(p.slice(0, 4)) === progressionText(s.chorus.slice(0, 4))) total -= 2;
    if (lastOf(p[p.length - 1]) === lastOf(s.chorus[s.chorus.length - 1])) total -= 0.5;
  }
  return total;
}

/**
 * Draws candidates, scores them, and picks by weighted chance among the best. Duplicates stay in:
 * a candidate the blend draws often is a typical one, and keeps that edge among near-ties.
 */
export function choosePart(
  rng: Rng,
  ctx: HarmonyContext,
  draw: (rng: Rng) => Progression,
  s: ScoreContext,
): Progression {
  const scores = new Map<string, number>();
  const drawn: (readonly [Progression, number])[] = [];
  for (let i = 0; i < CANDIDATES; i++) {
    const p = draw(rng);
    const text = progressionText(p);
    let sc = scores.get(text);
    if (sc === undefined) {
      sc = score(ctx, p, s);
      scores.set(text, sc);
    }
    drawn.push([p, sc]);
  }
  const ranked = drawn.sort((a, b) => b[1] - a[1]).slice(0, BEST);
  const best = ranked[0]?.[1] ?? 0;
  return (
    choose(
      rng,
      ranked.map(([p, sc]) => [p, Math.exp((sc - best) / TEMPERATURE)] as const),
    ) ?? [["i"]]
  );
}
