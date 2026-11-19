/**
 * What a song took from the records the generator was measured from, for the player's
 * "Inspired by" panel (inspiration.ts): each record's share over the whole song, and which record
 * each part (form and chords, drums, bass, riff, keys, voice) leans on most. Plus the records'
 * credits and their sleeves on the Cover Art Archive.
 */
import type { Song } from "./composer";
import { PARTS, type Part, type RefWeights } from "./profile";
import type { ReferenceId } from "./references";

export interface RecordInfo {
  artist: string;
  year: number;
  /** Its MusicBrainz release group, whose front cover the Cover Art Archive serves. The single's
   * where it has a scan; else the album the song is on. */
  releaseGroup: string;
}

export const RECORDS: Record<ReferenceId, RecordInfo> = {
  "true-faith": {
    artist: "New Order",
    year: 1987,
    releaseGroup: "ebe62324-25fa-3bc9-98c0-b7aa20767946",
  },
  // The single has no scan: the album's sleeve.
  "different-story": {
    artist: "Peter Schilling",
    year: 1989,
    releaseGroup: "9c1b4c53-4f9e-3bb7-86a4-858940fae2a6",
  },
  "you-came": {
    artist: "Kim Wilde",
    year: 1988,
    releaseGroup: "1fd7bddf-596c-30b1-91df-62e8fd2c3814",
  },
  "the-night": {
    artist: "Valerie Dore",
    year: 1984,
    releaseGroup: "2dd8d183-14f1-4543-95ab-3332c5a653bd",
  },
  "get-closer": {
    artist: "Valerie Dore",
    year: 1984,
    releaseGroup: "f7b2b302-b36c-30f9-8a27-d94f920e139c",
  },
  faces: { artist: "Clio", year: 1985, releaseGroup: "3a31866f-2a68-4127-a5ad-c627e77200e1" },
  "self-control": {
    artist: "Laura Branigan",
    year: 1984,
    releaseGroup: "7e836549-1631-43ea-8b26-7df7cb4183c4",
  },
  "innocent-love": {
    artist: "Sandra",
    year: 1986,
    releaseGroup: "834cf860-3d13-3e07-b95d-998e8c5f2e58",
  },
  "heaven-can-wait": {
    artist: "Sandra",
    year: 1988,
    releaseGroup: "7f91469d-a194-3072-8ee9-631e4266efb9",
  },
  // Not a single: the album it is on, Into a Secret Land.
  "crazy-juliet": {
    artist: "Sandra",
    year: 1988,
    releaseGroup: "59dc477e-49ed-3669-bc3c-42d1c7f60922",
  },
};

/** A record's front cover, `size` pixels wide (the archive's thumbnails). */
export function coverUrl(id: ReferenceId, size: 250 | 500 | 1200): string {
  return `https://coverartarchive.org/release-group/${RECORDS[id].releaseGroup}/front-${size}`;
}

export const PART_CREDITS: Record<Part, string> = {
  song: "Form & chords",
  drums: "Drums",
  bass: "Bass",
  riff: "Riff & lead synth",
  keys: "Keys",
  voice: "Voice",
};

/** Shares below this don't count as an influence. */
export const MIN_SHARE = 0.02;

export interface Influence {
  id: ReferenceId;
  /** Of the whole song, 0–1: the record's weight averaged over the parts. */
  share: number;
}

function normalized(weights: RefWeights): [ReferenceId, number][] {
  const entries = Object.entries(weights).filter(([, w]) => (w ?? 0) > 0) as [
    ReferenceId,
    number,
  ][];
  const total = entries.reduce((n, [, w]) => n + w, 0);
  return total > 0 ? entries.map(([id, w]) => [id, w / total]) : [];
}

/** The records a song took from, largest share first; an original is all its own record. */
export function influences(song: Pick<Song, "reference" | "blends">): Influence[] {
  if (song.reference) return [{ id: song.reference, share: 1 }];
  const shares = new Map<ReferenceId, number>();
  for (const part of PARTS) {
    for (const [id, w] of normalized(song.blends[part])) {
      shares.set(id, (shares.get(id) ?? 0) + w / PARTS.length);
    }
  }
  return [...shares]
    .map(([id, share]) => ({ id, share }))
    .filter((i) => i.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share);
}

/** Credits list a record in a part from this share. */
export const CREDIT_SHARE = 0.1;

export interface PartCredit {
  part: Part;
  /** The records the part takes from, largest share first. */
  records: Influence[];
}

/**
 * Per part, the records it takes from (CREDIT_SHARE and up). Empty when every part has the same
 * blend (an original; a song blended as one): the overall influences already say it all.
 */
export function partCredits(song: Song): PartCredit[] {
  if (song.reference) return [];
  const credits = PARTS.map((part) => ({
    part,
    records: normalized(song.blends[part])
      .filter(([, share]) => share >= CREDIT_SHARE)
      .sort((a, b) => b[1] - a[1])
      .map(([id, share]) => ({ id, share })),
  }));
  const same = (c: PartCredit) => JSON.stringify(c.records.map((r) => [r.id, r.share.toFixed(2)]));
  return credits.every((c) => same(c) === same(credits[0]!)) ? [] : credits;
}
