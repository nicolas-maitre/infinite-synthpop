/**
 * The player's "For you" station: which records to blend, worked out from the songs kept in
 * Favourites and the ones skipped quickly in Previous songs. Pure, and run in this browser only:
 * main.ts hands it the songs' blends (from library.ts and history.ts), nothing is sent anywhere.
 */
import { genreOfReference } from "./genres";
import { PARTS, REFERENCE_IDS, type PartBlends } from "./profile";
import type { ReferenceId } from "./references";

/** A quick skip takes off this much of what a favourite adds. */
export const SKIP_WEIGHT = 0.5;
/** Records with this share of the profile or more play. */
export const TASTE_SHARE = 0.1;
/** An open blend needs two records at least. */
export const MIN_RECORDS = 2;

export type Shares = Record<ReferenceId, number>;

/** What the station plays: its records (largest share first), and every record's share. */
export interface Taste {
  refs: ReferenceId[];
  shares: Shares;
}

const zero = (): Shares => Object.fromEntries(REFERENCE_IDS.map((id) => [id, 0])) as Shares;

/** A song's records, each part counting the same (as the Inspired by panel adds them up). */
export function songShares(blends: PartBlends): Shares {
  const shares = zero();
  for (const part of PARTS) {
    const entries = Object.entries(blends[part]) as [ReferenceId, number | undefined][];
    const total = entries.reduce((n, [, w]) => n + Math.max(0, w ?? 0), 0);
    if (total <= 0) continue;
    for (const [id, w] of entries) {
      if (id in shares) shares[id] += Math.max(0, w ?? 0) / total / PARTS.length;
    }
  }
  return shares;
}

/**
 * The favourites' averaged blend, less SKIP_WEIGHT of a favourite per quick skip, clamped at 0;
 * the records with TASTE_SHARE of it or more play, padded to MIN_RECORDS from the next largest
 * (the favourites' own order when the skips took everything else away, then the main record's
 * genre). Null without favourites.
 */
export function tasteOf(
  liked: readonly PartBlends[],
  skipped: readonly PartBlends[],
): Taste | null {
  if (!liked.length) return null;
  const likedMean = zero();
  for (const song of liked) {
    const s = songShares(song);
    for (const id of REFERENCE_IDS) likedMean[id] += s[id] / liked.length;
  }
  const raw = { ...likedMean };
  for (const song of skipped) {
    const s = songShares(song);
    for (const id of REFERENCE_IDS) raw[id] -= (SKIP_WEIGHT * s[id]) / liked.length;
  }
  const total = REFERENCE_IDS.reduce((n, id) => n + Math.max(0, raw[id]), 0);
  const shares = zero();
  for (const id of REFERENCE_IDS) shares[id] = total > 0 ? Math.max(0, raw[id]) / total : 0;

  // Largest first; ties, and records the skips cleared, by the favourites alone, then the
  // records of the favourite one's genre (to pad a single record with its neighbours).
  const home = genreOfReference(
    REFERENCE_IDS.reduce((a, b) => (likedMean[b] > likedMean[a] ? b : a)),
  );
  const near = (id: ReferenceId) => (genreOfReference(id) === home ? 1 : 0);
  const order = [...REFERENCE_IDS].sort(
    (a, b) => shares[b] - shares[a] || likedMean[b] - likedMean[a] || near(b) - near(a),
  );
  const refs = order.filter((id) => shares[id] >= TASTE_SHARE);
  for (const id of order) {
    if (refs.length >= MIN_RECORDS) break;
    if (!refs.includes(id)) refs.push(id);
  }
  return { refs, shares };
}
