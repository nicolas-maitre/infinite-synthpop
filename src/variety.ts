/**
 * How varied the generated songs are: how often verses and choruses come out exactly as a bank
 * entry or a reference record's, how many distinct ones a batch has, and how alike the forms are
 * (docs/plans/theory-chords.md §1, §6). `pnpm variety` prints it for every genre and chords mode.
 */
import { compose, type ChordsMode } from "./composer";
import { GENRES, type GenreId } from "./genres";
import type { Progression } from "./progressions";
import { REFERENCES } from "./references";

export interface Variety {
  genre: GenreId;
  chords: ChordsMode;
  songs: number;
  verse: PartVariety;
  chorus: PartVariety;
  /** Distinct verse + chorus pairs. */
  pairs: number;
  /** Distinct interludes, turnarounds, bridges and lifts (written whether or not the form plays
   * them). */
  sections: Record<(typeof SECTIONS)[number], number>;
  /** Distinct forms by section kind and length, and by kind alone. */
  forms: number;
  skeletons: number;
  /** Share of songs whose form (kind and length per section) is a reference's. */
  referenceForm: number;
  /** Distinct progressions in one song, on average. */
  perSong: number;
  /** Share of songs that quote a reference's loop (theory mode). */
  quoted: number;
  topSkeletons: (readonly [string, number])[];
}

export interface PartVariety {
  distinct: number;
  /** Shares of songs (0–1). */
  bankEntry: number;
  /** The same share among songs that quote no reference loop (theory mode's nods to the records;
   * classic never quotes). */
  bankEntryUnquoted: number;
  reference: number;
  top: (readonly [string, number])[];
}

const SECTIONS = ["interlude", "turnaround", "bridge", "lift"] as const;

export const progressionText = (p: Progression): string =>
  p.map((bar) => bar.join("–")).join(" │ ");

export function measureVariety(
  genre: GenreId,
  chords: ChordsMode,
  songs = 400,
  firstSeed = 1,
): Variety {
  const g = GENRES[genre];
  const bank = {
    verse: new Set(g.bank.verse.map((e) => progressionText(e.bars))),
    chorus: new Set(g.bank.chorus.map((e) => progressionText(e.bars))),
  };
  const refs = g.references.map((r) => REFERENCES[r]);
  const reference = {
    verse: new Set(refs.map((r) => progressionText(r.verse))),
    chorus: new Set(refs.map((r) => progressionText(r.chorus))),
  };
  const refForms = new Set(refs.map((r) => r.sections.map((s) => `${s.kind}${s.bars}`).join(" ")));

  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const seen = { verse: new Map<string, number>(), chorus: new Map<string, number>() };
  const hits = { verse: [0, 0, 0], chorus: [0, 0, 0] };
  let quoted = 0;
  const pairs = new Set<string>();
  const sections = Object.fromEntries(SECTIONS.map((k) => [k, new Set<string>()])) as Record<
    (typeof SECTIONS)[number],
    Set<string>
  >;
  const forms = new Set<string>();
  const skeletons = new Map<string, number>();
  let referenceForm = 0;
  let perSong = 0;
  for (let i = 0; i < songs; i++) {
    // Spread the seeds: neighbouring seeds are independent anyway, but this matches the first
    // measurement (plan §1).
    const song = compose({ seed: (firstSeed + i) * 7919, genre, weights: "auto", chords });
    if (song.quoted) quoted++;
    for (const part of ["verse", "chorus"] as const) {
      const text = progressionText(song.progressions[part]);
      count(seen[part], text);
      if (bank[part].has(text)) hits[part][0]!++;
      if (bank[part].has(text) && !song.quoted) hits[part][2]!++;
      if (reference[part].has(text)) hits[part][1]!++;
    }
    for (const k of SECTIONS) sections[k].add(progressionText(song.progressions[k]));
    pairs.add(
      `${progressionText(song.progressions.verse)} // ${progressionText(song.progressions.chorus)}`,
    );
    const form = song.sections.map((s) => `${s.kind}${s.bars}`).join(" ");
    forms.add(form);
    if (refForms.has(form)) referenceForm++;
    count(skeletons, song.sections.map((s) => s.kind).join(" "));
    perSong += new Set(song.sections.map((s) => progressionText(s.progression))).size;
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const part = (p: "verse" | "chorus"): PartVariety => ({
    distinct: seen[p].size,
    bankEntry: hits[p][0]! / songs,
    bankEntryUnquoted: songs > quoted ? hits[p][2]! / (songs - quoted) : 0,
    reference: hits[p][1]! / songs,
    top: top(seen[p], 5),
  });
  return {
    genre,
    chords,
    songs,
    verse: part("verse"),
    chorus: part("chorus"),
    pairs: pairs.size,
    sections: Object.fromEntries(SECTIONS.map((k) => [k, sections[k].size])) as Variety["sections"],
    forms: forms.size,
    skeletons: skeletons.size,
    referenceForm: referenceForm / songs,
    perSong: perSong / songs,
    quoted: quoted / songs,
    topSkeletons: top(skeletons, 4),
  };
}

/** A readable report of one measurement. */
export function varietyReport(v: Variety): string {
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  const share = (n: number) => `${((100 * n) / v.songs).toFixed(1)}%`.padStart(6);
  const unquoted = (p: PartVariety) =>
    v.quoted > 0 ? ` (${pct(p.bankEntryUnquoted)} without quotes)` : "";
  const part = (name: string, p: PartVariety) => [
    `${name}: ${p.distinct} distinct · ${pct(p.bankEntry)} exactly a bank entry${unquoted(p)} · ${pct(p.reference)} exactly a reference's`,
    ...p.top.map(([t, n]) => `  ${share(n)}  ${t}`),
  ];
  return [
    `== ${v.genre} · ${v.chords} (${v.songs} songs, auto style) ==`,
    ...part("verse", v.verse),
    ...part("chorus", v.chorus),
    `verse + chorus pairs: ${v.pairs} distinct`,
    `distinct ${SECTIONS.join(" / ")}: ${SECTIONS.map((k) => v.sections[k]).join(" / ")}`,
    `forms: ${v.forms} distinct (${v.skeletons} by section kind alone) · ${pct(v.referenceForm)} a reference's`,
    ...v.topSkeletons.map(([t, n]) => `  ${share(n)}  ${t}`),
    `distinct progressions per song: ${v.perSong.toFixed(2)}`,
    ...(v.quoted > 0 ? [`songs quoting a reference's loop: ${pct(v.quoted)}`] : []),
  ].join("\n");
}
