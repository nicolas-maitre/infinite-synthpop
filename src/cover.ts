/**
 * Every generated song's sleeve, drawn in the browser from the song itself (coverart.ts draws it):
 * nothing stored, nothing downloaded, and the same song always gets the same sleeve. This is the
 * pure part, what the sleeve is: its palette from the records the song took from (the main
 * record's sleeve colour as the ground, the others' as accents by their shares), a motif per genre
 * (synthpop: a few minimal shapes in a lot of space; Italo: neon grid, sunset, airbrush;
 * Euro-disco: chrome rings, stars, gloss), the details drawn from the song's seed, and the type: the
 * title and an invented label and catalogue number.
 *
 * Originals keep their real sleeves (influence.ts coverUrl), not one of these.
 */
import type { Song } from "./composer";
import { DEFAULT_GENRE, GENRES, genreOfReference, specWeights, type GenreId } from "./genres";
import { influences, type Influence } from "./influence";
import { simpleBlends, toRefWeights } from "./profile";
import type { ReferenceId } from "./references";
import { createRng, type Rng } from "./rng";
import type { Creation } from "./spec";

/** What a sleeve is drawn from. */
export type CoverSong = Pick<Song, "seed" | "title" | "genre" | "reference" | "blends">;

// ── Colours ──────────────────────────────────────────────────────────────────────────────────

/** Each record's colours, picked from its sleeve (sampled once from the Cover Art Archive's
 * scans): the field it reads as, and the colour that pops on it. Fixed, so a sleeve draws at
 * once, offline, and the same every time. */
export const RECORD_COLOURS: Record<ReferenceId, { field: string; ink: string }> = {
  // The ultramarine cloth and the gold leaf.
  "true-faith": { field: "#2f45a0", ink: "#f2b01e" },
  // Smoky red behind the hat.
  "different-story": { field: "#7a1c12", ink: "#e0482c" },
  // The dark red room and the red WILDE strip.
  "you-came": { field: "#3e1519", ink: "#dc3630" },
  // Ivory satin and the hat's roses.
  "the-night": { field: "#d6c2b9", ink: "#d9809a" },
  // Pale sky and the blue lettering.
  "get-closer": { field: "#a7bdd0", ink: "#2f58b0" },
  // Nagel pink on white.
  faces: { field: "#e5477f", ink: "#2f5fc8" },
  // The black dress and the sunlit rock.
  "self-control": { field: "#1d1513", ink: "#cf8a5e" },
  // The red bars over grey paper.
  "innocent-love": { field: "#b02a5e", ink: "#eee4df" },
  // Lemon yellow and the bronze hair.
  "heaven-can-wait": { field: "#f0df66", ink: "#a8693a" },
  // The twilight sky over the sea, in a silver frame.
  "crazy-juliet": { field: "#3c5592", ink: "#d8dde8" },
};

type Rgb = [number, number, number];

export function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` moved toward `b` by `t` (0–1). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexRgb(a), hexRgb(b)];
  return rgbHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

/** Relative luminance, 0–1. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbHex([f(0), f(8), f(4)]);
}

/** A colour as a lit neon tube: its hue, saturated and bright. Greys (silver, ivory) go to the
 * genre's own pink. */
export function neon(hex: string): string {
  const [h, s] = hsl(hex);
  return s < 0.15 ? "#ff4fa3" : fromHsl(h, 1, 0.62);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** How far apart two colours look, roughly (0–441). */
function distance(a: string, b: string): number {
  const [x, y] = [hexRgb(a), hexRgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export interface Accent {
  colour: string;
  /** The record's share of the song. */
  share: number;
}

export interface Palette {
  /** The main record's field: what the sleeve is mostly. */
  ground: string;
  /** The main record's ink. */
  ink: string;
  /** The other records' colours, largest share first: each one's field, or its ink when the
   * field would vanish into the ground. */
  accents: Accent[];
  /** A pale ground: dark type, and pastel rather than neon. */
  light: boolean;
  /** Type that reads on the ground. */
  text: string;
}

/** Shares are rounded to hundredths, so a song rebuilt from its stored form draws the same. */
const round2 = (x: number) => Math.round(x * 100) / 100;

export function palette(list: readonly Influence[]): Palette {
  const main = RECORD_COLOURS[list[0]?.id ?? "true-faith"];
  const light = luminance(main.field) > 0.4;
  const accents = list.slice(1).map(({ id, share }) => {
    const c = RECORD_COLOURS[id];
    return { colour: distance(c.field, main.field) < 90 ? c.ink : c.field, share: round2(share) };
  });
  return {
    ground: main.field,
    ink: main.ink,
    accents,
    light,
    text: light ? mix(main.field, "#14101a", 0.86) : mix(main.field, "#fbf7f2", 0.92),
  };
}

// ── The sleeve ───────────────────────────────────────────────────────────────────────────────

export type MotifKind = "minimal" | "neon" | "chrome";

export const GENRE_MOTIFS: Record<GenreId, MotifKind> = {
  synthpop: "minimal",
  italo: "neon",
  euro: "chrome",
};

/** Points and sizes are shares of the sleeve's side (0–1, from the top left). */
export interface Point {
  x: number;
  y: number;
}

/** Synthpop, after the Factory sleeves: one object in a lot of space. */
export interface MinimalMotif {
  kind: "minimal";
  /** disc: a flat circle; code: a colour code, a block per record by its share; arc: a big
   * quarter circle bleeding off a corner; petal: a floating leaf-like form with its shadow. */
  object: "disc" | "code" | "arc" | "petal";
  at: Point;
  size: number;
  /** Radians. */
  angle: number;
  /** A photographed cloth behind (dark grounds): soft folds, lighter (+) or darker (−). */
  folds: { at: Point; r: number; shade: number }[];
  /** A hairline across, near the type. */
  rule: boolean;
}

/** Italo: a neon night, or an airbrushed pastel one on pale grounds. */
export interface NeonMotif {
  kind: "neon";
  scene: "sunset" | "laser" | "airbrush";
  /** Where the sky meets the floor. */
  horizon: number;
  sun: { x: number; r: number; bands: number };
  /** Ridge heights along the horizon (shares of the sleeve), or none. */
  ridge: number[] | null;
  /** Laser beams' origin and their angles (radians, 0 = right). */
  beams: { from: Point; angles: number[] };
  stars: { at: Point; r: number }[];
  /** Airbrush: the big shape and the stripes' angle. */
  shape: "circle" | "triangle";
  stripes: number;
}

/** Euro-disco: chrome and glitter. */
export interface ChromeMotif {
  kind: "chrome";
  scene: "rings" | "sparkle" | "sphere";
  rings: { at: Point; r: number; w: number }[];
  sphere: { at: Point; r: number };
  sparkles: { at: Point; r: number }[];
  /** A glossy floor line with the scene's reflection. */
  floor: number | null;
}

export type Motif = MinimalMotif | NeonMotif | ChromeMotif;

export type Face = "grotesk" | "geometric" | "serif" | "script" | "condensed";

export interface SleeveType {
  face: Face;
  /** plain: flat ink; neon: a lit tube; chrome: metal lettering. */
  finish: "plain" | "neon" | "chrome";
  bold: boolean;
  italic: boolean;
  upper: boolean;
  /** Letter spacing, in ems. */
  tracking: number;
  /** The title's type size. */
  size: number;
  /** Where the title block sits: a corner, or a band across the top or bottom. */
  anchor: "tl" | "tr" | "bl" | "br" | "top" | "bottom";
  colour: string;
}

export interface Sleeve {
  /** Same key, same sleeve: what the drawings are cached by. */
  key: string;
  title: string;
  label: string;
  catalogue: string;
  /** "12″ Maxi-Single" and such, or none. */
  format: string | null;
  palette: Palette;
  motif: Motif;
  /** A song across genres: the other genre's motif, as touches, by its share. */
  touch: { kind: MotifKind; share: number } | null;
  type: SleeveType;
  /** A paper border around the picture. */
  frame: boolean;
  /** The record's wear: the disc's ring showing through, 0 (none) to 1. */
  wear: number;
}

/** Below this share, another genre leaves no mark on the sleeve. */
export const TOUCH_SHARE = 0.2;

const LABELS: Record<MotifKind, { names: string[]; kinds: string[] }> = {
  minimal: {
    names: [
      "Northlight",
      "Parallax",
      "Glasshouse",
      "Lumen",
      "Quiet Machine",
      "Polar Arc",
      "Westwind",
    ],
    kinds: ["Records", "Recordings", ""],
  },
  neon: {
    names: ["Luna Notte", "Stella Blu", "Fiamma", "Cristallo", "Laguna", "Neon Lido", "Mezzanotte"],
    kinds: ["Dischi", "Records", "Music"],
  },
  chrome: {
    names: ["Polarlicht", "Kristall", "Sternklang", "Nordstern", "Silberpfeil", "Lichtwerk"],
    kinds: ["Musik", "Records", "Tonträger"],
  },
};

const FORMATS: Record<MotifKind, (string | null)[]> = {
  minimal: [null, null, "12″", "45 RPM"],
  neon: ["12″ Maxi-Single", "Extended Version", "45 Giri", "Special Dance Mix"],
  chrome: ["Maxi-Single", "Extended Version", "Special Remix", "12″ Maxi"],
};

const point = (rng: Rng, lo = 0, hi = 1): Point => ({
  x: lo + rng.next() * (hi - lo),
  y: lo + rng.next() * (hi - lo),
});

function minimalMotif(rng: Rng, p: Palette): MinimalMotif {
  const object = rng.weighted<MinimalMotif["object"]>([
    ["disc", 1],
    ["code", p.accents.length ? 1.2 : 0.4],
    ["arc", 1],
    ["petal", 1],
  ]);
  // Off centre, on a third: the space is the point.
  const thirds = [0.3, 0.36, 0.64, 0.7];
  const at = { x: rng.pick(thirds), y: rng.pick([0.32, 0.38, 0.6, 0.66]) };
  const size =
    object === "disc"
      ? 0.12 + rng.next() * 0.12
      : object === "code"
        ? 0.3 + rng.next() * 0.16
        : object === "arc"
          ? 0.55 + rng.next() * 0.3
          : 0.3 + rng.next() * 0.14;
  const folds = p.light
    ? []
    : Array.from({ length: 6 }, () => ({
        at: point(rng, -0.2, 1.2),
        r: 0.3 + rng.next() * 0.45,
        shade: (rng.next() - 0.45) * 0.9,
      }));
  return {
    kind: "minimal",
    object,
    at,
    size,
    angle: (rng.next() - 0.5) * (object === "petal" ? 2.4 : object === "code" ? 0 : 1),
    folds,
    rule: rng.chance(0.45),
  };
}

function neonMotif(rng: Rng, p: Palette): NeonMotif {
  // Pale grounds lean pastel, an airbrushed day; dark ones are always a neon night.
  const scene = rng.weighted<NeonMotif["scene"]>([
    ["sunset", p.light ? 0.35 : 0.6],
    ["laser", p.light ? 0.15 : 0.4],
    ["airbrush", p.light ? 0.5 : 0],
  ]);
  const horizon = 0.56 + rng.next() * 0.12;
  const ridge = rng.chance(0.55)
    ? Array.from({ length: 9 }, (_, i) => (i % 2 ? 0.03 : 0.06) + rng.next() * 0.07)
    : null;
  const from = { x: 0.2 + rng.next() * 0.6, y: horizon };
  const count = rng.int(5, 9);
  const spread = 0.5 + rng.next() * 0.9;
  const angles = Array.from(
    { length: count },
    (_, i) => -Math.PI / 2 + (i / (count - 1) - 0.5) * spread * 2,
  );
  return {
    kind: "neon",
    scene,
    horizon,
    sun: { x: 0.3 + rng.next() * 0.4, r: 0.17 + rng.next() * 0.1, bands: rng.int(4, 7) },
    ridge,
    beams: { from, angles },
    stars: Array.from({ length: rng.int(14, 30) }, () => ({
      at: { x: rng.next(), y: rng.next() * horizon * 0.85 },
      r: 0.6 + rng.next() * 1.8,
    })),
    shape: rng.chance(0.5) ? "circle" : "triangle",
    stripes: rng.int(3, 6),
  };
}

function chromeMotif(rng: Rng): ChromeMotif {
  const scene = rng.weighted<ChromeMotif["scene"]>([
    ["rings", 1.2],
    ["sparkle", 0.9],
    ["sphere", 0.9],
  ]);
  const rings: ChromeMotif["rings"] = [];
  if (scene === "rings") {
    const r = 0.17 + rng.next() * 0.06;
    const count = rng.int(2, 3);
    const cx = 0.5 + (rng.next() - 0.5) * 0.1;
    const cy = 0.4 + rng.next() * 0.1;
    const step = r * 1.15;
    for (let i = 0; i < count; i++) {
      rings.push({
        at: { x: cx + (i - (count - 1) / 2) * step, y: cy + (i % 2 ? r * 0.35 : 0) },
        r,
        w: r * (0.2 + rng.next() * 0.08),
      });
    }
  }
  const sparkles = Array.from({ length: rng.int(4, 8) }, (_, i) => ({
    at: point(rng, 0.08, 0.92),
    // One big star leads the sparkle scene.
    r: scene === "sparkle" && i === 0 ? 0.2 + rng.next() * 0.08 : 0.015 + rng.next() * 0.045,
  }));
  return {
    kind: "chrome",
    scene,
    rings,
    sphere: {
      at: { x: 0.35 + rng.next() * 0.3, y: 0.38 + rng.next() * 0.1 },
      r: 0.2 + rng.next() * 0.08,
    },
    sparkles,
    floor: rng.chance(0.6) ? 0.66 + rng.next() * 0.08 : null,
  };
}

function sleeveType(rng: Rng, kind: MotifKind, p: Palette, motif: Motif): SleeveType {
  if (kind === "minimal") {
    // Small, set like a catalogue entry, in a corner away from the object.
    const m = motif as MinimalMotif;
    const left = m.at.x > 0.5;
    const top = m.object === "arc" ? m.at.y > 0.5 : m.at.y > 0.5;
    return {
      face: rng.pick<Face>(["grotesk", "geometric", "grotesk", "serif"]),
      finish: "plain",
      bold: rng.chance(0.4),
      italic: false,
      upper: rng.chance(0.55),
      tracking: rng.pick([0.04, 0.12, 0.22]),
      size: 0.032 + rng.next() * 0.016,
      anchor: top ? (left ? "tl" : "tr") : left ? "bl" : "br",
      // The ink only where it reads on the ground.
      colour: rng.chance(0.4) && contrast(p.ink, p.ground) >= 3 ? p.ink : p.text,
    };
  }
  if (kind === "neon") {
    const pastel = (motif as NeonMotif).scene === "airbrush";
    const script = rng.chance(0.5);
    return {
      face: script ? "script" : rng.pick<Face>(["geometric", "condensed"]),
      finish: pastel ? "plain" : "neon",
      bold: !script,
      italic: !script,
      upper: !script && rng.chance(0.6),
      tracking: script ? 0 : 0.04,
      size: script ? 0.1 + rng.next() * 0.03 : 0.075 + rng.next() * 0.025,
      anchor: rng.pick(["top", "top", "tl", "bottom"] as const),
      colour: pastel ? mix(p.ink, "#1a1030", 0.25) : neon(p.accents[0]?.colour ?? p.ink),
    };
  }
  return {
    face: rng.pick<Face>(["geometric", "condensed", "serif"]),
    finish: "chrome",
    bold: true,
    italic: rng.chance(0.5),
    upper: true,
    tracking: 0.02,
    size: 0.08 + rng.next() * 0.03,
    anchor: rng.pick(["top", "bottom", "bottom", "tl"] as const),
    colour: p.text,
  };
}

/** Each genre's share of the song, by its records. */
export function genreShares(list: readonly Influence[]): Map<GenreId, number> {
  const shares = new Map<GenreId, number>();
  for (const { id, share } of list) {
    const g = genreOfReference(id);
    shares.set(g, (shares.get(g) ?? 0) + share);
  }
  return shares;
}

/** A generated song's sleeve (an original has its own: see coverUrl). */
export function describeSleeve(song: CoverSong): Sleeve {
  const list = influences(song);
  const p = palette(list);
  const kind = GENRE_MOTIFS[song.genre];
  // Its own stream: drawing more details one day won't reshuffle the songs' music.
  const rng = createRng(song.seed).fork("sleeve");
  const motif =
    kind === "minimal"
      ? minimalMotif(rng, p)
      : kind === "neon"
        ? neonMotif(rng, p)
        : chromeMotif(rng);
  const type = sleeveType(rng, kind, p, motif);

  let touch: Sleeve["touch"] = null;
  for (const [genre, share] of genreShares(list)) {
    const other = GENRE_MOTIFS[genre];
    if (other !== kind && share >= TOUCH_SHARE && share > (touch?.share ?? 0))
      touch = { kind: other, share: round2(share) };
  }

  const labels = LABELS[kind];
  const name = rng.pick(labels.names);
  const label = [name, rng.pick(labels.kinds)].filter(Boolean).join(" ");
  const catalogue = `ISP-${1000 + (song.seed % 9000)}`;
  const format = rng.pick(FORMATS[kind]);

  const key = [
    song.seed,
    song.genre,
    song.title,
    list.map((i) => `${i.id}:${round2(i.share)}`).join(","),
  ].join("|");
  return {
    key,
    title: song.title,
    label,
    catalogue,
    format,
    palette: p,
    motif,
    touch,
    type,
    frame: kind !== "minimal" && rng.chance(0.3),
    wear: rng.chance(0.5) ? 0.4 + rng.next() * 0.6 : 0,
  };
}

/** What a stored creation (a previous song, a favourite) draws its sleeve from, without
 * composing it: the same seed, title, genre and blends compose() gives the song. */
export function creationCover(creation: Creation): CoverSong {
  const { seed, spec } = creation;
  const genre = spec.genre ?? DEFAULT_GENRE;
  return {
    seed,
    title: spec.title,
    genre,
    reference: null,
    blends:
      spec.blends ?? simpleBlends(toRefWeights(GENRES[genre], specWeights(GENRES[genre], spec))),
  };
}
