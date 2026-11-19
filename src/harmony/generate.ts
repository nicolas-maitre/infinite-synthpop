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
import { chord, chordPitchClasses, mod12, type Chord, type Mode } from "../theory";
import type {
  BarOption,
  HarmonyAnalysis,
  ModeTraits,
  Option,
  Schema,
  SectionKind,
  SectionShape,
} from "./analysis";

export type At = (b: Blend) => number;
export type LoopKind = "verse" | "chorus";

export interface HarmonyContext {
  analysis: HarmonyAnalysis;
  mode: Mode;
  /** Reads a trait's weight at the song's blend. */
  at: At;
  /** Progressions (as `progressionText`) a candidate loses points for matching exactly. */
  bank: ReadonlySet<string>;
  /** The loop lengths the song's planner lays out, when not every length fits (a blend's
   * merged planner plays a synthpop chorus for 8 bars). Unset: any. */
  fits?: (bars: number) => boolean;
}

/** How many candidates each section draws, and how many of the best the pick chooses among. */
const CANDIDATES = 24;
const BEST = 8;
/** How fast a candidate's chance falls with its score below the best. */
const TEMPERATURE = 0.4;
/** The same for the secondary sections, which choose among all their candidates rather than the
 * best 8: their shapes are written from the records bar by bar, so the score mostly enforces
 * their relations (into the verse, against the chorus) and near-ties keep the shapes' weights
 * (a cut to the best 8 dropped TF's VI │ VI, 0.1 below the climb, every time). */
export const SECTION_CHOICE = { temperature: 1, best: CANDIDATES };

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
    traitsOf(ctx).schemas.map(
      (s) => [s, s === except || !schemaFits(ctx, s) ? 0 : ctx.at(weight(s) ?? {})] as const,
    ),
  );
}

/** Whether a schema can make a loop the planner lays out (always, without `fits`). */
function schemaFits(ctx: HarmonyContext, s: Schema): boolean {
  const fits = ctx.fits;
  if (!fits) return true;
  if (s.cell) {
    const cell = s.cell;
    return cell.repeats.some((r) => fits(r.value * s.bars.length + cell.tag.length));
  }
  return fits(s.bars.length);
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
  // A long loop (a cell and its tag), or a whole loop of its own length: no second line.
  if (schema.cell) return treatBass(rng, ctx, overPedal(writeCell(rng, ctx, kind, schema), schema));
  const loop = writeLines(rng, ctx, kind, schema);
  return t.bass ? treatBass(rng, ctx, overPedal(loop, schema)) : overPedal(loop, schema);
}

/** A loop from a line schema: its first line, then its second line as the trait says. */
function writeLines(rng: Rng, ctx: HarmonyContext, kind: LoopKind, schema: Schema): Progression {
  const t = traitsOf(ctx);
  const first = writeLine(rng, ctx, kind, schema, undefined);
  if (schema.bars.length !== 4) return first;
  // A later line comes from another 4-bar line schema (not a vamp or a long loop).
  const line = (w: Blend | undefined, s: Schema) => (s.bars.length === 4 && !s.cell ? w : {});
  const later = (except?: Schema) =>
    t.schemas.some((s) => ctx.at(s.weight.later ?? {}) > 0)
      ? pickSchema(rng, ctx, (s) => line(s.weight.later, s), except)
      : pickSchema(rng, ctx, (s) => line(s.weight[kind], s), except);
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

/** A long loop: the cell filled once, played its drawn number of times, then its tag. */
function writeCell(rng: Rng, ctx: HarmonyContext, kind: LoopKind, schema: Schema): Progression {
  const cell = schema.cell;
  if (!cell) return writeLines(rng, ctx, kind, schema);
  const bars = colourLine(rng, ctx, fill(rng, ctx, kind, schema.bars, undefined, false));
  const length = (n: number) => n * bars.length + cell.tag.length;
  const repeats =
    choose(
      rng,
      cell.repeats.map(
        (o) => [o.value, ctx.fits && !ctx.fits(length(o.value)) ? 0 : ctx.at(o.weight)] as const,
      ),
    ) ??
    cell.repeats[0]?.value ??
    1;
  const out: Bar[] = Array.from({ length: repeats }, () => bars.map((b) => [...b])).flat();
  let prev = lastOf(out[out.length - 1]);
  for (const slot of cell.tag) {
    const bar =
      typeof slot === "number"
        ? [...(bars[slot] ?? bars[0] ?? ["i"])]
        : (fill(rng, ctx, kind, [slot], prev, false)[0] ?? ["i"]);
    out.push(bar);
    prev = lastOf(bar);
  }
  return out;
}

const isDominantFamily = (numeral: string) => /^V(?![I])/.test(numeral);

/**
 * A chord over another bass degree (`VII/i`, `ii7/v`, `I/v`, `VI/3` where the bass is its own
 * 3rd), or null where that can't be spelled or would clash: a chord tone a semitone from the bass
 * (V over the tonic's leading tone, ♭II over i). Dominants are left alone, since a slash after V
 * names an applied target.
 */
export function overBass(numeral: string, bass: string): string | null {
  const c = info(numeral);
  const b = info(bass).root;
  if (c.bass !== undefined || isDominantFamily(numeral)) return null;
  if (c.root === b) return numeral;
  const tones = chordPitchClasses({ tonic: 0, mode: "minor" }, c);
  if (tones.some((pc) => mod12(pc - b) === 1 || mod12(b - pc) === 1)) return null;
  const third = tones[1];
  const spelled =
    third !== undefined && third === b && mod12(third - c.root) <= 4
      ? `${numeral}/3`
      : `${numeral}/${bass}`;
  try {
    const parsed = info(spelled);
    return (parsed.bass ?? parsed.root) === b ? spelled : null;
  } catch {
    return null;
  }
}

/** A schema's pedal under every chord of its loop (Innocent Love's v, Heaven Can Wait's IV). */
function overPedal(p: Progression, schema: Schema): Progression {
  const pedal = schema.pedal;
  if (!pedal) return p;
  return p.map((bar) => bar.map((n) => overBass(n, pedal) ?? n));
}

/**
 * The bass trait: once per loop, the tonic held under a plain ♭VII or ♭VI after a root-position
 * tonic bar (The Night's ♭VII/i, Get Closer's D/E, C/E), and the step below the tonic under a last chord
 * on the subdominant side (♭VI or IV) of a loop that starts on it (Get Closer's C/D).
 */
function treatBass(rng: Rng, ctx: HarmonyContext, p: Progression): Progression {
  const b = traitsOf(ctx).bass;
  if (!b) return p;
  const hold = rng.chance(ctx.at(b.hold));
  const approach = rng.chance(ctx.at(b.approach));
  if (!hold && !approach) return p;
  const tonic = ctx.mode === "major" ? "I" : "i";
  const plainTonic = (n: string | undefined) =>
    n !== undefined && info(n).root === 0 && info(n).bass === undefined;
  const out = p.map((bar, k) => {
    const before = p[k - 1];
    const n = bar[0];
    if (!hold || k === 0 || bar.length !== 1 || n === undefined || !plainTonic(lastOf(before)))
      return [...bar];
    // Only a plain ♭VII or ♭VI, as measured: a coloured chord keeps its own voicing (IIIadd9 over
    // F would be a cluster), and a v or iv over the tonic blurs into a i(sus).
    const r = info(n).root;
    if (n !== degreeOf(n) || (r !== 10 && r !== 8)) return [...bar];
    return [overBass(n, tonic) ?? n];
  });
  const last = out[out.length - 1];
  const end = last?.[last.length - 1];
  const side = end !== undefined && (info(end).root === 8 || info(end).root === 5);
  if (approach && last && end !== undefined && side && plainTonic(p[0]?.[0])) {
    const over = overBass(end, "VII");
    if (over) last[last.length - 1] = over;
  }
  return out;
}

/** The degree a chord stands on, as a bare numeral (`IVmaj7` → `IV`, `I/3` → `I`). */
export function degreeOf(numeral: string): string {
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
  // Written-out endings (the Euro turns and stops), when the genre has them.
  if (pc.endings?.length && rng.chance(ctx.at(pc.endingWeight ?? { base: 1 }))) {
    const from = prev;
    const end =
      choose(
        rng,
        pc.endings.map(
          (o) =>
            [
              o.value,
              o.value[0]?.[0] ? ctx.at(o.weight) * motionWeight(ctx, from, o.value[0][0]) : 0,
            ] as const,
        ),
      ) ?? pc.endings[0]?.value;
    return [...bars, ...(end ?? []).map((b) => [...b])];
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
  // No chord held for more than two bars (TF's v │ v is the longest), unless the genre's verse or
  // chorus sits longer (Crazy Juliet's I │ I │ I │ I).
  const maxHold = s.kind === "prechorus" ? 2 : (t.maxHold?.[s.kind] ?? 2);
  for (const h of holds(p)) if (h > 2 * maxHold) total -= 1.5;
  const colourLimit = t.colourPerLine ?? 1;
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
    if (coloured > colourLimit) total -= 0.7 * (coloured - colourLimit);
    if (new Set(line.flat()).size < 2 && maxHold < 4) total -= 2;
  }
  const text = progressionText(p);
  // Lighter on a pre-chorus: the plan's variety targets are the verse's and the chorus's.
  if (ctx.bank.has(text)) total -= s.kind === "prechorus" ? 0.3 : 0.8;
  if (s.chorus) {
    // An audible contrast: not the chorus, not its first line, not its cadence.
    if (text === progressionText(s.chorus)) total -= 4;
    else if (progressionText(p.slice(0, 4)) === progressionText(s.chorus.slice(0, 4))) total -= 2;
    if (lastOf(p[p.length - 1]) === lastOf(s.chorus[s.chorus.length - 1])) total -= 0.5;
    // A static verse into a busier chorus (Innocent Love's pedal, Heaven Can Wait's vamp).
    if (t.rhythmContrast && s.kind === "verse") {
      const faster = changeRate(s.chorus) - changeRate(p);
      total += 2 * ctx.at(t.rhythmContrast) * Math.max(-0.5, Math.min(1, faster));
    }
  }
  return total;
}

/** Chord changes per bar, round the loop (a pedal chord over the same bass counts as one). */
function changeRate(p: Progression): number {
  const seq = p.flat();
  let changes = 0;
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i];
    const b = seq[(i + 1) % seq.length];
    if (a !== undefined && b !== undefined && a !== b) changes++;
  }
  return changes / Math.max(1, p.length);
}

/**
 * Draws candidates, rates them (`score`, `scoreSection`), and picks by weighted chance among the
 * best. Duplicates stay in:
 * a candidate the blend draws often is a typical one, and keeps that edge among near-ties.
 */
export function choosePart(
  rng: Rng,
  draw: (rng: Rng) => Progression,
  rate: (p: Progression) => number,
  { temperature, best: keep } = { temperature: TEMPERATURE, best: BEST },
): Progression {
  const scores = new Map<string, number>();
  const drawn: (readonly [Progression, number])[] = [];
  for (let i = 0; i < CANDIDATES; i++) {
    const p = draw(rng);
    const text = progressionText(p);
    let sc = scores.get(text);
    if (sc === undefined) {
      sc = rate(p);
      scores.set(text, sc);
    }
    drawn.push([p, sc]);
  }
  const ranked = drawn.sort((a, b) => b[1] - a[1]).slice(0, keep);
  const best = ranked[0]?.[1] ?? 0;
  return (
    choose(
      rng,
      ranked.map(([p, sc]) => [p, Math.exp((sc - best) / temperature)] as const),
    ) ?? [["i"]]
  );
}

// ── Secondary sections (plan §4.2) ────────────────────────────────────────────────────────────

/** A section's shapes: the key mode's, or the lift's (always in the major lift key). */
const shapesOf = (ctx: HarmonyContext, kind: SectionKind): readonly SectionShape[] =>
  kind === "lift" ? ctx.analysis.lift : traitsOf(ctx).sections[kind];

/** How well one chord leads into the next section's first (0: it doesn't). */
export function approachWeight(ctx: HarmonyContext, from: string, to: string): number {
  if (from === to) return 0;
  const d = mod12(info(to).root - info(from).root);
  const a = traitsOf(ctx).sections.approach.find((x) => x.interval === d);
  return a ? ctx.at(a.weight) : 0;
}

/**
 * One candidate interlude, turnaround, bridge or lift: a shape, its bars filled in order and
 * weighed by the root motion into each. A turnaround's last bar is weighed by how it leads into
 * `target` (the verse's first chord) too; when the shape has nothing that does, it ends on a
 * chord from the mode's palette that does.
 */
export function writeSection(
  rng: Rng,
  ctx: HarmonyContext,
  kind: SectionKind,
  target?: string,
): Progression {
  const shapes = shapesOf(ctx, kind);
  const fits = (x: SectionShape) => !ctx.fits || ctx.fits(x.bars.length);
  const shape =
    choose(
      rng,
      shapes.map((x) => [x, fits(x) ? ctx.at(x.weight) : 0] as const),
    ) ?? shapes[0];
  const home = kind === "lift" || ctx.mode === "major" ? "I" : "i";
  const bars: Bar[] = [];
  let prev: string | undefined;
  const slots = shape?.bars ?? [];
  slots.forEach((slot, i) => {
    const leads = target !== undefined && i === slots.length - 1;
    const options = slot.map((o) => [o.value, ctx.at(o.weight)] as const);
    const weigh = (bar: Bar, w: number) => {
      const first = bar[0];
      const last = lastOf(bar);
      if (first === undefined || last === undefined) return 0;
      const into = leads && target !== undefined ? approachWeight(ctx, last, target) : 1;
      // A hold weighs as a step, as in scoreSection.
      const held = prev === first ? motionWeight(ctx, "i", "ii") : motionWeight(ctx, prev, first);
      return w * held * into;
    };
    let bar = choose(
      rng,
      options.map(([b, w]) => [b, weigh(b, w)] as const),
    );
    if (!bar && leads)
      bar = choose(
        rng,
        traitsOf(ctx).sections.palette.map((n) => [[n] as Bar, weigh([n], 1)] as const),
      );
    bar ??= choose(rng, options) ?? options[0]?.[0] ?? [home];
    bars.push(bar);
    prev = lastOf(bar);
  });
  return bars.length ? bars : [[home]];
}

/** What a secondary section is scored against. */
export interface SectionScore {
  kind: SectionKind;
  verse: Progression;
  chorus: Progression;
  /** The chord after the section: the verse's first after a turnaround, the chorus's after a
   * bridge. */
  exit?: string;
}

/** The degree tokens of a progression's chords (applied dominants left out: `V/ii` isn't V). */
const degreesOf = (chords: Iterable<string>) =>
  new Set([...chords].filter((n) => !isApplied(n)).map(degreeOf));
const upper = (degree: string) => /[IV]/.test(degree);

/**
 * How well a section echoes the song's palette: a colour chord the verse or chorus has (TF's
 * Dorian IV, DS's iv, You Came's IVmaj7) recurs, and the same degree in the other quality (a iv
 * where the chorus has IV) clashes. Next to a ii, IV is the Dorian pair (DS's turnaround), a
 * colour of its own.
 */
export function echoScore(ctx: HarmonyContext, p: Progression, song: Progression[]): number {
  const t = traitsOf(ctx);
  const songChords = new Set(song.flatMap((x) => x.flat()));
  const songDegrees = degreesOf(songChords);
  const mine = new Set(p.flat());
  const degrees = degreesOf(mine);
  const dorian = degrees.has("ii");
  let total = 0;
  for (const d of degrees) {
    if (songDegrees.has(d)) {
      if (t.colourChords.includes(d)) total += 0.25;
      continue;
    }
    const root = info(d).root;
    const clash = [...songDegrees].some((x) => info(x).root === root && upper(x) !== upper(d));
    if (clash && !(dorian && d === "IV")) total -= 1;
  }
  // A coloured spelling the song has (IVmaj7, Vadd9) recurs.
  for (const n of mine) if (n !== degreeOf(n) && !isApplied(n) && songChords.has(n)) total += 0.2;
  return total;
}

/** How good a secondary-section candidate is (higher is better). */
export function scoreSection(ctx: HarmonyContext, p: Progression, s: SectionScore): number {
  const seq = p.flat();
  const first = seq[0] ?? "i";
  const last = seq[seq.length - 1] ?? "i";
  // A turnaround plays once into what follows; the others loop over their section.
  const loops = s.kind !== "turnaround";
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < seq.length; i++) pairs.push([seq[i] ?? "i", seq[i + 1] ?? "i"]);
  const wrap: [string, string] | null = loops ? [last, first] : null;
  // A turnaround's way into the verse is weighed by the approach trait instead (below).
  const exit: [string, string] | null = s.exit && loops ? [last, s.exit] : null;
  if (wrap) pairs.push(wrap);
  if (exit) pairs.push(exit);

  // Every measured section holds a chord across a bar line (TF's VI │ VI, DS's ii │ ii and IV │ IV,
  // TF's IV │ IV and I │ I), so a hold counts as a step here.
  const value = ([a, b]: [string, string]) => {
    const m = motionClass(a, b);
    return motionScore(ctx, m === "hold" ? "step" : m);
  };
  let total = pairs.length ? pairs.reduce((n, pr) => n + value(pr), 0) / pairs.length : 0;
  const lead = exit ?? wrap;
  if (lead) total += 0.5 * value(lead);

  // A turnaround leads into the verse's first chord, the better the more the references do it.
  if (s.kind === "turnaround" && s.exit) {
    const w = approachWeight(ctx, last, s.exit);
    const best = Math.max(1e-3, ...traitsOf(ctx).sections.approach.map((a) => ctx.at(a.weight)));
    total += w > 0 ? 0.5 * Math.log(w / best) : -3;
  }
  for (const [a, b] of pairs) {
    if (!isApplied(a)) continue;
    const d = mod12(info(b).root - info(a).root);
    if (d !== 5 && d !== 1) total -= 2;
  }
  // An interlude or bridge moves; a lift may vamp (TF's outro), a turnaround may sit (TF's VI).
  if (s.kind === "interlude" || s.kind === "bridge") {
    for (const h of holds(p)) if (h > 4) total -= 1.5;
    if (new Set(seq).size < 2) total -= 2;
  }
  // No bank penalty: a section's measured shape is its character (TF's I │ I │ I │ I–V, You
  // Came's IV │ V), and its slots already vary it.
  const text = progressionText(p);
  // Not what the form already plays elsewhere (TF's VI–VII turn into a verse).
  if (ctx.analysis.formPlays.some((x) => progressionText(x) === text)) total -= 1;
  if (s.kind === "interlude" || s.kind === "bridge") {
    // Not the chorus or the verse again (TF's interlude is "an instrumental chorus", not this
    // chorus).
    // Sharing most of a line's bars is an echo, not a contrast (i │ VII │ VII │ V against a
    // chorus on i │ VII │ VII │ IV).
    const shared = (other: Progression) =>
      p.slice(0, 4).filter((bar, i) => sameBar(bar, other[i])).length;
    if (text === progressionText(s.chorus)) total -= 4;
    else if (shared(s.chorus) >= 3) total -= 2;
    else if (shared(s.chorus) === 2) total -= 0.5;
    if (text === progressionText(s.verse)) total -= 3;
    else if (shared(s.verse) >= 3) total -= 1;
  }
  if (s.kind !== "lift") total += echoScore(ctx, p, [s.verse, s.chorus]);
  return total;
}
