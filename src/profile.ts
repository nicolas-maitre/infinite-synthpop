/**
 * Blending across genres (docs/plans/cross-genre-blend.md). A song has a blend per part: weights
 * over every reference, of any genre. The genre profiles (genres.ts) keep their own data; a value
 * that spans genres is a mixture of each genre's own value, read at that genre's weights
 * normalised to 1, in proportion to the genre's share of the blend:
 *
 *     value = Σ_g share(g) × blend_g(weights in g ÷ their sum)
 *
 * When one genre holds all of a part's weight, the mixture is that genre's own blend read at the
 * raw weights: the very call genres.ts made before, so every single-genre song stays bit for bit
 * what it was. Only a blend that spans genres takes the mixed path.
 */
import {
  bassTone as genreBassTone,
  blend,
  dominantDrums,
  dominantVoices,
  GENRE_IDS,
  GENRES,
  genreOfReference,
  leadTone as genreLeadTone,
  SYNTHPOP_VOICES,
  type BassTone,
  type Blend,
  type DrumTraits,
  type Genre,
  type GenreAt,
  type GenreId,
  type LeadTone,
  type PartStyle,
  type Substitution,
  type Voices,
} from "./genres";
import type { Track } from "./instruments";
import { polygonVertices, quantize, randomPoint, weightsAt } from "./polygon";
import { bankEntries, pickProgression, substitute } from "./progressions";
import type { Progression, ProgressionKind } from "./progressions";
import type { ReferenceId } from "./references";
import type { Rng } from "./rng";
import type { Mode } from "./theory";

/** The part groups a song blends separately. */
export const PARTS = ["song", "drums", "bass", "riff", "keys", "voice"] as const;
export type Part = (typeof PARTS)[number];

/** Every reference, genre by genre, each genre's in its `references` order. */
export const REFERENCE_IDS: readonly ReferenceId[] = GENRE_IDS.flatMap(
  (id) => GENRES[id].references,
);

/** Weights over any references; a missing one weighs 0. */
export type RefWeights = Partial<Record<ReferenceId, number>>;

/** A blend per part. In simple mode all six are the same. */
export type PartBlends = Record<Part, RefWeights>;

/** Which part each mixer track's level follows. */
export const TRACK_PART: Record<Track, Part> = {
  drums: "drums",
  bass: "bass",
  hook: "riff",
  riff: "riff",
  synth: "riff",
  pad: "keys",
  stab: "keys",
  arp: "keys",
  seq: "keys",
  guitar: "keys",
  lead: "voice",
  counter: "voice",
};

/** A genre's weights array (in its `references` order) as reference weights. */
export function toRefWeights(genre: Genre, weights: readonly number[]): RefWeights {
  return Object.fromEntries(genre.references.map((r, i) => [r, weights[i] ?? 0]));
}

/** How often Auto (a genre per song) plays an open blend across genres instead of a preset. */
export const AUTO_OPEN_CHANCE = 0.2;

/** Auto's open blend: two or three references from at least two genres, at a random point of
 * their polygon (rounded to hundredths, as the pad's are). */
export function randomOpenBlend(rng: Rng): RefWeights {
  const first = rng.pick(REFERENCE_IDS);
  const second = rng.pick(
    REFERENCE_IDS.filter((r) => genreOfReference(r) !== genreOfReference(first)),
  );
  const refs = [first, second];
  if (rng.chance(0.5)) refs.push(rng.pick(REFERENCE_IDS.filter((r) => !refs.includes(r))));
  const vertices = polygonVertices(refs.length);
  // Every chosen reference keeps some weight, so the blend really spans genres: a point by a
  // vertex can round the others to 0.
  const draw = () =>
    quantize(
      weightsAt(
        vertices,
        randomPoint(vertices, () => rng.next()),
      ),
    );
  let w = draw();
  for (let tries = 1; tries < 20 && !w.every((x) => x > 0); tries++) w = draw();
  if (!w.every((x) => x > 0)) w = refs.map(() => Math.floor(100 / refs.length) / 100);
  return Object.fromEntries(refs.map((r, i) => [r, w[i] ?? 0]));
}

/** Weights in the order of a list of references (a pad's vertices), as reference weights. */
export function refsBlend(refs: readonly ReferenceId[], weights: readonly number[]): RefWeights {
  return Object.fromEntries(refs.map((r, i) => [r, weights[i] ?? 0]));
}

/** A random point of the polygon of these references, as reference weights rounded to
 * hundredths (the "auto" style of an open blend). */
export function randomBlendOver(refs: readonly ReferenceId[], rng: Rng): RefWeights {
  const vertices = polygonVertices(refs.length);
  return refsBlend(
    refs,
    quantize(
      weightsAt(
        vertices,
        randomPoint(vertices, () => rng.next()),
      ),
    ),
  );
}

/** The same blend for every part (simple mode). */
export function simpleBlends(weights: RefWeights): PartBlends {
  return Object.fromEntries(PARTS.map((p) => [p, weights])) as PartBlends;
}

/** One genre's part of a blend: its share (of 1) and its references' weights in its order. */
export interface GenreShare {
  genre: Genre;
  share: number;
  weights: readonly number[];
}

/** A part's blend read through the genre profiles: `GenreAt` (what the planners and the old code
 * read) for its dominant genre, plus the mixtures across every genre in it. */
export interface Profile extends GenreAt {
  /** The genres with weight in the blend, in genre order. Just one, at its raw weights, when the
   * blend stays within a genre. */
  shares: readonly GenreShare[];
  /** True when the blend spans more than one genre. */
  mixed: boolean;
  /** A number every genre defines its own way (a missing one counts as an empty blend, 0). */
  mix: (pick: (genre: Genre) => Blend | undefined) => number;
  /** A weighted choice whose options' weights are blends: every genre's options, each weighed by
   * its genre's share, in genre order. */
  options: <T>(pick: (genre: Genre) => readonly (readonly [T, Blend])[]) => [T, number][];
  /** A weighted choice with fixed weights per genre, scaled by each genre's share. */
  weighted: <T>(
    pick: (genre: Genre) => readonly (readonly [T, number])[],
  ) => readonly (readonly [T, number])[];
}

/**
 * Reads a part's blend. `home` is the genre a song plays in when the blend doesn't pick one:
 * no weight at all, or a tie between genres.
 */
export function profileOf(weights: RefWeights, home: GenreId): Profile {
  const all = GENRE_IDS.map((id) => {
    const genre = GENRES[id];
    const raw = genre.references.map((r) => weights[r] ?? 0);
    return { genre, raw, sum: raw.reduce((a, b) => a + b, 0) };
  });
  const present = all.filter((x) => x.sum > 0);
  const total = present.reduce((a, x) => a + x.sum, 0);
  // The dominant genre: the largest share, home on a tie.
  const top = Math.max(0, ...present.map((x) => x.sum));
  const tied = present.filter((x) => x.sum === top);
  const dominant =
    tied.find((x) => x.genre.id === home) ?? tied[0] ?? all.find((x) => x.genre.id === home)!;
  const mixed = present.length > 1;

  if (!mixed) {
    // Within one genre: exactly the old reading.
    const { genre, raw } = present[0] ?? dominant;
    const at = (b: Blend) => blend(genre, b, raw);
    return {
      genre,
      weights: raw,
      at,
      drums: dominantDrums(genre, raw),
      voices: dominantVoices(genre, raw),
      shares: [{ genre, share: 1, weights: raw }],
      mixed,
      mix: (pick) => at(pick(genre) ?? {}),
      options: (pick) => pick(genre).map(([t, b]) => [t, at(b)]),
      weighted: (pick) => pick(genre),
    };
  }

  const shares: GenreShare[] = present.map(({ genre, raw, sum }) => ({
    genre,
    share: sum / total,
    weights: raw.map((w) => w / sum),
  }));
  const own = shares.find((s) => s.genre === dominant.genre)!;
  // Discrete traits: the reference with the most weight, of any genre, brings its own. On a tie,
  // the first of the tied references: a genre's defaults could be a reference's that isn't in the
  // blend at all (Italo's are Get Closer's).
  const ref = leadingRef(weights);
  const refGenre = ref ? GENRES[genreOfReference(ref)] : undefined;
  return {
    genre: own.genre,
    weights: own.weights,
    at: (b) => blend(own.genre, b, own.weights),
    drums: (ref && refGenre?.drumTraits[ref]) ?? (refGenre ?? own.genre).drums,
    voices:
      (ref && refGenre?.voiceTraits?.[ref]) ??
      (refGenre ?? own.genre).voices ??
      own.genre.voices ??
      SYNTHPOP_VOICES,
    shares,
    mixed,
    mix: (pick) =>
      shares.reduce((v, s) => v + s.share * blend(s.genre, pick(s.genre) ?? {}, s.weights), 0),
    options: (pick) =>
      shares.flatMap((s) =>
        pick(s.genre).map(([t, b]): [typeof t, number] => [
          t,
          s.share * blend(s.genre, b, s.weights),
        ]),
      ),
    weighted: (pick) =>
      shares.flatMap((s) => pick(s.genre).map(([t, w]) => [t, s.share * w] as const)),
  };
}

/** The reference with the most weight; on a tie, the first of them in reference order. */
function leadingRef(weights: RefWeights): ReferenceId | undefined {
  let best: ReferenceId | undefined;
  for (const r of REFERENCE_IDS) {
    if ((weights[r] ?? 0) > (best ? (weights[best] ?? 0) : 0)) best = r;
  }
  return best;
}

/** A song's six part profiles. */
export type Profiles = Record<Part, Profile>;

export function profilesOf(blends: PartBlends, home: GenreId): Profiles {
  // Parts that share one blend share one reading.
  const read = new Map<RefWeights, Profile>();
  return Object.fromEntries(
    PARTS.map((part) => {
      const w = blends[part];
      let p = read.get(w);
      if (!p) read.set(w, (p = profileOf(w, home)));
      return [part, p];
    }),
  ) as Profiles;
}

/** The genre that holds most of the song part's weight: the song's genre for its name, title and,
 * until the merged planner, its form. */
export function songGenre(blends: PartBlends, home: GenreId): GenreId {
  return profileOf(blends.song, home).genre.id;
}

/** The parts and sounds a song plays, each from its own part: the riff and lead synth from the
 * riff's blend, the countervoice from the voice's, the pads, stabs and 16th part from the keys'. */
export function partVoices(p: Profiles): Voices {
  const riff = p.riff.voices;
  const keys = p.keys.voices;
  const voices: Voices = {
    riff: riff.riff,
    riffPatch: riff.riffPatch,
    countervoice: p.voice.voices.countervoice,
    pad: keys.pad,
    stabPatch: keys.stabPatch,
    arpPatch: keys.arpPatch,
  };
  if (keys.arp !== undefined) voices.arp = keys.arp;
  if (keys.padTone !== undefined) voices.padTone = keys.padTone;
  if (riff.synthPatch !== undefined) voices.synthPatch = riff.synthPatch;
  return voices;
}

/** How the keys play their stabs: the genre of the keys' dominant reference, else their dominant
 * genre's. */
export function partStyle(p: Profile, weights: RefWeights): PartStyle | undefined {
  if (!p.mixed) return p.genre.parts;
  const ref = leadingRef(weights);
  return (ref ? GENRES[genreOfReference(ref)] : p.genre).parts;
}

// ── Song-level choices (compose) ─────────────────────────────────────────────────────────────

/** The auto tempo's grid: the union of the genres' ranges, its floor mixed like the centre. */
export function tempoGrid(p: Profile): { lo: number; hi: number; center: number } {
  const center = p.mix((g) => g.tempo.center);
  if (!p.mixed) {
    const [rangeLo, hi] = p.genre.tempo.range;
    const floor = p.genre.tempo.floor;
    return { lo: floor ? Math.max(rangeLo, Math.floor(p.at(floor) * 2) / 2) : rangeLo, hi, center };
  }
  const lo = Math.min(...p.shares.map((s) => s.genre.tempo.range[0]));
  const hi = Math.max(...p.shares.map((s) => s.genre.tempo.range[1]));
  const floor = p.mix((g) => g.tempo.floor ?? { base: g.tempo.range[0] });
  return { lo: Math.max(lo, Math.floor(floor * 2) / 2), hi, center };
}

/** A progression from the bank of every genre in the blend. `style` is the song's legacy style,
 * which a single-genre song reads as before; mixed, each genre reads its own weights'. */
export function pickFromBanks(
  p: Profile,
  kind: ProgressionKind,
  style: number,
  rng: Rng,
  mode: Mode,
): Progression {
  if (!p.mixed) return pickProgression(p.genre, kind, style, rng, { mode, weights: p.weights });
  const pools = p.shares.map((s) => ({
    s,
    ...bankEntries(s.genre, kind, styleOfWeights(s.weights), { mode, weights: s.weights }),
  }));
  const entries = pools
    .flatMap(({ s, entries }) => entries.map(([bars, w]) => [bars, s.share * w] as const))
    .filter(([, w]) => w > 0);
  if (!entries.length) return pools.find((x) => x.pool[0])?.pool[0]?.bars ?? [["i"]];
  return rng.weighted(entries);
}

/** Where a genre's weights sit on its slider axis (genres.ts `styleOf`). */
function styleOfWeights(weights: readonly number[]): number {
  const [a = 0, b = 0] = weights;
  return a + b > 0 ? b / (a + b) : 0.5;
}

/** Every genre's substitutions in the blend, in genre order, each chance scaled by its share. */
export function substituteFrom(
  p: Profile,
  prog: Progression,
  kind: ProgressionKind,
  rng: Rng,
  amount: number,
  mode: Mode,
): Progression {
  const subs = p.shares.flatMap((s) =>
    s.genre.substitutions.map((sub): readonly [Substitution, () => number] => [
      sub,
      p.mixed
        ? () => s.share * blend(s.genre, sub.chance, s.weights)
        : () => blend(s.genre, sub.chance, s.weights),
    ]),
  );
  return substitute(subs, prog, kind, rng, amount, mode);
}

// ── What the instruments play (engine, ahead, render, arranger) ──────────────────────────────

/** Everything about a song's sound its parts' blends decide. */
export interface SongSound {
  drums: DrumTraits;
  voices: Voices;
  parts: PartStyle | undefined;
  bassTone: BassTone;
  leadTone: LeadTone;
  /** Fader offsets on auto, each track's from its own part. */
  mix: Partial<Record<Track, number>>;
}

const sounds = new WeakMap<object, SongSound>();

/** A song's sound, read once per song. */
export function songSound(song: { blends: PartBlends; genre: GenreId }): SongSound {
  let s = sounds.get(song);
  if (!s) sounds.set(song, (s = readSound(song.blends, song.genre)));
  return s;
}

function readSound(blends: PartBlends, home: GenreId): SongSound {
  const p = profilesOf(blends, home);
  const mix: Partial<Record<Track, number>> = {};
  for (const [track, part] of Object.entries(TRACK_PART) as [Track, Part][]) {
    const prof = p[part];
    if (prof.shares.some((s) => s.genre.mix?.[track])) mix[track] = prof.mix((g) => g.mix?.[track]);
  }
  return {
    drums: p.drums.drums,
    voices: partVoices(p),
    parts: partStyle(p.keys, blends.keys),
    bassTone: p.bass.mixed ? mixedBassTone(p.bass) : genreBassTone(p.bass.genre, p.bass.weights),
    leadTone: p.voice.mixed
      ? mixedLeadTone(p.voice)
      : genreLeadTone(p.voice.genre, p.voice.weights),
    mix,
  };
}

function mixedBassTone(p: Profile): BassTone {
  return {
    frequency: p.mix((g) => g.bassTone.frequency),
    presence: p.mix((g) => g.bassTone.presence),
    sawCutoff: p.mix((g) => g.bassTone.sawCutoff),
    octave: p.mix((g) => g.bassTone.octave),
    sustain: p.mix((g) => g.bassTone.sustain),
    lowCut: p.mix((g) => g.bassTone.lowCut),
    sweep: 0.6 + p.mix((g) => g.bassTone.sweep),
    struck: p.mix((g) => g.bassTone.struck) >= 0.5,
    pulse: p.mix((g) => g.bassTone.pulse),
  };
}

function mixedLeadTone(p: Profile): LeadTone {
  return {
    level: p.mix((g) => g.leadTone.level),
    low: p.mix((g) => g.leadTone.low),
    mid: p.mix((g) => g.leadTone.mid),
    high: p.mix((g) => g.leadTone.high),
    air: p.mix((g) => g.leadTone.air),
    width: p.mix((g) => g.leadTone.width),
  };
}

// ── Blends in specs, links and saved songs ───────────────────────────────────────────────────

/** Two blends with the same weight on every reference. */
export function sameWeights(a: RefWeights, b: RefWeights): boolean {
  return REFERENCE_IDS.every((r) => (a[r] ?? 0) === (b[r] ?? 0));
}

/** Do these part blends say no more than a genre's weights would? (Then specs and links keep the
 * old form, the genre and its weights.) */
export function isGenreBlends(
  blends: PartBlends,
  genre: Genre,
  weights: readonly number[],
): boolean {
  const own = toRefWeights(genre, weights);
  return PARTS.every((p) => sameWeights(blends[p], own));
}

/** Reference weights read from a link or storage: known references, finite, non-negative, at most
 * 1, not all 0; null otherwise. */
export function parseRefWeights(raw: unknown): RefWeights | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: RefWeights = {};
  for (const [r, v] of Object.entries(raw as Record<string, unknown>)) {
    const ref = REFERENCE_IDS.find((x) => x === r);
    const w = Number(v);
    if (!ref || !Number.isFinite(w) || w < 0) return null;
    if (w > 0) out[ref] = Math.min(1, w);
  }
  return Object.keys(out).length ? out : null;
}

/** Part blends as a song blend plus the parts that differ from it. */
export function splitBlends(blends: PartBlends): {
  blend: RefWeights;
  parts: Partial<PartBlends>;
} {
  const blend = blends.song;
  const parts = Object.fromEntries(
    PARTS.filter((p) => !sameWeights(blends[p], blend)).map((p) => [p, blends[p]]),
  ) as Partial<PartBlends>;
  return { blend, parts };
}

/** A blend's weights in reference order, without the zeros: `{ "true-faith": 0.5 }` → the same,
 * keys always in the same order (for links and saved-song identities). */
export function compactWeights(w: RefWeights): RefWeights {
  return Object.fromEntries(REFERENCE_IDS.filter((r) => (w[r] ?? 0) > 0).map((r) => [r, w[r]]));
}

/** A stable text for part blends, for ♡ Save's song identity. */
export function blendsKey(blends: PartBlends): string {
  const text = (w: RefWeights) =>
    Object.entries(compactWeights(w))
      .map(([r, x]) => `${r}:${x}`)
      .join(",");
  const { blend, parts } = splitBlends(blends);
  return [text(blend), ...Object.entries(parts).map(([p, w]) => `${p}=${text(w)}`)].join(";");
}
