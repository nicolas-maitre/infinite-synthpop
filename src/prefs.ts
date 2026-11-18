/**
 * The settings kept per browser (localStorage), shared by the simple and advanced views.
 * Everything still works without storage.
 */
import { CHORDS_MODES, type ChordsMode, type KitName, type LengthRange } from "./composer";
import {
  DEFAULT_VOLUMES,
  LEAD_PATCHES,
  PREVIOUS_DEFAULT_VOLUMES,
  TRACKS,
  type LeadPatch,
  type Track,
} from "./instruments";
import {
  centreFor,
  parsePadWeights,
  parsePartValue,
  parseRefs,
  PART_ROWS,
  type PartValue,
} from "./blendpicker";
import {
  DEFAULT_GENRE,
  GENRES,
  isGenreId,
  parseWeights,
  referenceWeights,
  weightsAtPoint,
  type GenreId,
} from "./genres";
import type { Part } from "./profile";
import type { ReferenceId } from "./references";
import { isStationId, type StationId } from "./stations";
import { CENTRE } from "./polygon";

export interface Prefs {
  /** The genre generated songs come from (genres.ts). */
  /** "auto": a genre per song. "open": a blend of `openRefs`, of any genres. */
  genre: GenreId | "auto" | "open";
  /** The style pad's weights: the genre's references' (genres.ts), or with "open" `openRefs`'. */
  weights: number[];
  /** The references an open blend runs between (2–10), in reference order. */
  openRefs: ReferenceId[];
  /** The player's station last chosen (stations.ts): the genre settings above say what plays;
   * this tells For you from a mix with the same records, and For you's records follow its profile. */
  station: StationId;
  /** Blend the parts on their own (`parts`), not all from the style. */
  partsOn: boolean;
  /** Each part's own blend; a part left out plays the style's. */
  parts: Partial<Record<Exclude<Part, "song">, PartValue>>;
  styleAuto: boolean;
  bpm: number;
  bpmAuto: boolean;
  key: number | null;
  kit: KitName | "auto";
  /** Each fader's level by hand, used for the tracks in `manual`. */
  volumes: Record<Track, number>;
  /** Faders taken off auto. The others follow the playing song's genre (genres.ts `mix`). */
  manual: Track[];
  muted: Track[];
  master: number;
  /** Start playing as soon as the page loads (or at the first interaction, if the browser asks). */
  autoplay: boolean;
  /** Switch songs, sections and bars right away instead of at the next bar line. */
  instant: boolean;
  /** The sung lead's sound: a formant voice, or the original lead synth. */
  lead: LeadPatch;
  /** Play the synths live, or render the music ahead (engine.ts); auto renders ahead where it can. */
  playback: Playback;
  /** Seconds to render ahead; 0 = auto (more on phones). */
  buffer: number;
  /** DJ mode: each song mixes into the next, like a DJ set (engine.ts, dj.ts). */
  dj: boolean;
  /** How DJ mode hands over: crossfade, morph, or auto's pick per transition. */
  djStyle: DjStyle;
  /** How generated songs pick their chords: the theory generator, or the classic picks. */
  progressions: ChordsMode;
  /** Which view the page shows: the simple player, or every control. */
  view: View;
  /** DJ mode has been turned on once as the default (for settings saved before it was). */
  djDefaulted: boolean;
  /** Play the song again when it ends, instead of moving on (the DJ doesn't mix out). */
  repeat: boolean;
  /** How long songs run (seconds): the form generated songs get, and where the DJ mixes out. */
  length: LengthRange;
}

/** The length setting's bounds and step (seconds). */
export const LENGTH_BOUNDS = { min: 120, max: 480, step: 30 } as const;

/** A stored length range, or null when it isn't one the setting can show. */
export function parseLength(raw: unknown): LengthRange | null {
  const r = raw as Partial<LengthRange> | null;
  const ok = (v: unknown): v is number =>
    typeof v === "number" &&
    v >= LENGTH_BOUNDS.min &&
    v <= LENGTH_BOUNDS.max &&
    v % LENGTH_BOUNDS.step === 0;
  return r && ok(r.min) && ok(r.max) && r.min < r.max ? { min: r.min, max: r.max } : null;
}

export type View = "simple" | "advanced";
export const VIEWS: readonly View[] = ["simple", "advanced"];

export type DjStyle = "auto" | "crossfade" | "morph";
export const DJ_STYLES: readonly DjStyle[] = ["auto", "crossfade", "morph"];

export type Playback = "auto" | "live" | "ahead";
export const PLAYBACKS: readonly Playback[] = ["auto", "live", "ahead"];
export const BUFFERS = [0, 10, 20, 30, 60, 120];

const PREFS_KEY = "infinite-synthpop:prefs:v1";

/** A genre's style polygon at its centre: an equal mix of its references. */
export function centreWeights(genre: GenreId): number[] {
  return weightsAtPoint(GENRES[genre], CENTRE);
}

// Everything a first visit plays is picked per song: press play and it keeps going.
const defaults: Prefs = {
  genre: "auto",
  weights: centreWeights(DEFAULT_GENRE),
  openRefs: ["true-faith", "get-closer"],
  station: "auto",
  partsOn: false,
  parts: {},
  styleAuto: true,
  bpm: 118,
  bpmAuto: true,
  key: null,
  kit: "auto",
  volumes: { ...DEFAULT_VOLUMES },
  manual: [],
  muted: [],
  master: 0,
  autoplay: false,
  instant: false,
  lead: "voice",
  playback: "auto",
  buffer: 0,
  dj: true,
  djStyle: "auto",
  progressions: "theory",
  view: "simple",
  djDefaulted: true,
  repeat: false,
  // Italo's extended versions run past 5 minutes: a lower cap would cut most of them short.
  length: { min: 150, max: 360 },
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return structuredClone(defaults);
    const p = JSON.parse(raw) as Partial<Prefs> & { style?: unknown };
    // Saved before genres: synthpop.
    const genre =
      p.genre === "auto" || p.genre === "open" || isGenreId(p.genre) ? p.genre : DEFAULT_GENRE;
    const openRefs = parseRefs(p.openRefs) ?? defaults.openRefs;
    const parts = Object.fromEntries(
      PART_ROWS.flatMap(([part]) => {
        const v = parsePartValue(p.parts?.[part]);
        return v ? [[part, v]] : [];
      }),
    );
    const partsOn = p.partsOn === true;
    const volumes = { ...defaults.volumes, ...p.volumes };
    // Saved before the triangle: only a style, which plays as [1 − style, style, 0].
    const style = typeof p.style === "number" ? Math.min(1, Math.max(0, p.style)) : null;
    // With the genre picked per song, the weights are too: these are kept for a fixed genre only.
    const fixed = genre === "auto" || genre === "open" ? DEFAULT_GENRE : genre;
    const weights =
      genre === "open"
        ? (parsePadWeights(p.weights, openRefs.length) ?? centreFor(openRefs))
        : (parseWeights(GENRES[fixed], p.weights) ??
          (style === null ? centreWeights(fixed) : [...referenceWeights(GENRES[fixed], style)]));
    delete p.style;
    // Faders left at an old default follow the new one.
    for (const [t, old] of Object.entries(PREVIOUS_DEFAULT_VOLUMES) as [Track, number][]) {
      if (volumes[t] === old) volumes[t] = DEFAULT_VOLUMES[t];
    }
    const lead = LEAD_PATCHES.find((l) => l === p.lead) ?? defaults.lead;
    // Saved before auto levels: a fader moved off its default stays where it was put, by hand.
    const manual = Array.isArray(p.manual)
      ? TRACKS.filter((t) => p.manual!.includes(t))
      : TRACKS.filter((t) => volumes[t] !== DEFAULT_VOLUMES[t]);
    const playback = PLAYBACKS.find((x) => x === p.playback) ?? defaults.playback;
    const buffer = BUFFERS.find((x) => x === p.buffer) ?? defaults.buffer;
    return {
      ...defaults,
      ...p,
      volumes,
      manual,
      genre,
      weights,
      openRefs,
      partsOn,
      parts,
      lead,
      playback,
      buffer,
      // Settings saved before DJ mode was the default get it on once; after that it's theirs.
      dj: p.djDefaulted === true ? p.dj === true : true,
      djDefaulted: true,
      djStyle: DJ_STYLES.find((x) => x === p.djStyle) ?? "auto",
      // Saved before the switch: theory, as for a new install.
      progressions: CHORDS_MODES.find((x) => x === p.progressions) ?? defaults.progressions,
      // Saved before the simple view: it opens first all the same.
      view: VIEWS.find((x) => x === p.view) ?? defaults.view,
      repeat: p.repeat === true,
      station: isStationId(p.station) ? p.station : defaults.station,
      length: parseLength(p.length) ?? { ...defaults.length },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private mode etc.): preferences just won't persist.
  }
}
