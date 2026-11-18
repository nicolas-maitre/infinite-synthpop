/**
 * The player's stations: what plays next, picked like a radio station. Any (a genre per song),
 * one per genre, a few mixes across records played as open blends (a point of their polygon per
 * song), and For you (foryou.ts). A station is just genre settings: the advanced view's controls
 * show the same thing, and settings no station has are "custom".
 */
import { GENRE_IDS, GENRES, isGenreId, type GenreId } from "./genres";
import { REFERENCE_IDS } from "./profile";
import type { ReferenceId } from "./references";

export const MIX_IDS = ["night-drive", "cold-wave", "bright-lights"] as const;
export type MixId = (typeof MIX_IDS)[number];
export type StationId = "auto" | GenreId | MixId | "for-you";

export interface Station {
  id: StationId;
  name: string;
  /** One line under the name. */
  description: string;
  /** The records on its sleeve mosaic; a mix's are the ones it blends. For you's come from the
   * profile. */
  records: readonly ReferenceId[];
}

/** Within a few BPM of each other: a blend's tempo falls between its records'. */
const MIXES: Record<MixId, Omit<Station, "id">> = {
  // Italo's slow, dark half, without Faces' 120 BPM.
  "night-drive": {
    name: "Night drive",
    description: "Slow and dark, 107–112 BPM",
    records: ["the-night", "get-closer", "self-control"],
  },
  // The minor-key synthpop with Valerie Dore's E minor coolness (112–120 BPM).
  "cold-wave": {
    name: "Cold wave",
    description: "Minor keys, across genres",
    records: ["true-faith", "different-story", "get-closer"],
  },
  // The bright, faster ones from each genre (119–123 BPM).
  "bright-lights": {
    name: "Bright lights",
    description: "Upbeat, 119–123 BPM",
    records: ["you-came", "faces", "crazy-juliet"],
  },
};

const GENRE_LINES: Record<GenreId, string> = {
  synthpop: "New Order, Peter Schilling, Kim Wilde",
  italo: "Valerie Dore, Clio, Laura Branigan",
  euro: "Sandra, 1986–88",
};

export const STATIONS: readonly Station[] = [
  {
    id: "auto",
    name: "Any",
    description: "A genre per song",
    // One of each genre, and one more.
    records: ["true-faith", "the-night", "innocent-love", "you-came"],
  },
  ...GENRE_IDS.map((id) => ({
    id,
    name: GENRES[id].name,
    description: GENRE_LINES[id],
    records: GENRES[id].references,
  })),
  ...MIX_IDS.map((id) => ({ id, ...MIXES[id] })),
  {
    id: "for-you",
    name: "For you",
    description: "From your favourites, in this browser only",
    records: [],
  },
];

export function isStationId(id: unknown): id is StationId {
  return STATIONS.some((s) => s.id === id);
}

/** The genre settings a station plays: `openRefs` (in reference order) for an open blend. */
export interface StationPlay {
  genre: GenreId | "auto" | "open";
  openRefs?: ReferenceId[];
}

/** What a station plays; For you needs its records (null: no favourites yet, nothing to play). */
export function stationPlay(
  id: StationId,
  forYou: readonly ReferenceId[] | null,
): StationPlay | null {
  if (id === "auto" || isGenreId(id)) return { genre: id };
  const refs = id === "for-you" ? forYou : MIXES[id].records;
  return refs && refs.length >= 2
    ? { genre: "open", openRefs: REFERENCE_IDS.filter((r) => refs.includes(r)) }
    : null;
}

export interface GenreSettings {
  genre: GenreId | "auto" | "open";
  openRefs: readonly ReferenceId[];
  styleAuto: boolean;
  partsOn: boolean;
}

const sameRefs = (a: readonly ReferenceId[], b: readonly ReferenceId[]) =>
  a.length === b.length && a.every((r) => b.includes(r));

/**
 * The station these settings play, or null when the advanced view set more than a station does
 * (a style point, part blends, references no station has). Two stations with the same records
 * show as the one last chosen.
 */
export function stationOf(
  s: GenreSettings,
  chosen: StationId | null,
  forYou: readonly ReferenceId[] | null,
): StationId | null {
  if (s.partsOn) return null;
  if (s.genre === "auto") return "auto";
  if (!s.styleAuto) return null;
  if (s.genre !== "open") return s.genre;
  // For you with no favourites left keeps what it last played.
  if (chosen === "for-you" && !forYou) return "for-you";
  const matches = STATIONS.filter((st) => {
    const play = stationPlay(st.id, forYou);
    return play?.openRefs && sameRefs(play.openRefs, s.openRefs);
  }).map((st) => st.id);
  return matches.find((id) => id === chosen) ?? matches[0] ?? null;
}
