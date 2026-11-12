import { describe, expect, it } from "vitest";
import { arrangeBar } from "./arranger";
import { compose, type Song } from "./composer";
import {
  bassTone,
  dominantDrums,
  dominantVoices,
  GENRE_IDS,
  GENRES,
  genreOfReference,
  leadTone,
  mixAt,
  randomWeights,
  SYNTHPOP_VOICES,
} from "./genres";
import {
  PARTS,
  profileOf,
  REFERENCE_IDS,
  simpleBlends,
  songSound,
  toRefWeights,
  type PartBlends,
  type RefWeights,
} from "./profile";
import { createRng } from "./rng";

/** What a song plays, for comparing two ways of making it. */
function played(song: Song) {
  return {
    title: song.title,
    bpm: song.bpm,
    key: song.key,
    kit: song.kit,
    bassStyle: song.bassStyle,
    genre: song.genre,
    progressions: song.progressions,
    sections: song.sections,
    melodies: [song.melodies, song.sectionMelodies, song.riff, song.hook, song.arp],
    bars: Array.from({ length: song.totalBars }, (_, b) => arrangeBar(song, b)),
  };
}

describe("single-genre blends read as before", () => {
  const rng = createRng(11);
  for (const id of GENRE_IDS) {
    const genre = GENRES[id];
    const samples = [
      ...genre.references.map((_, i) => genre.references.map((_, j) => (i === j ? 1 : 0))),
      ...Array.from({ length: 12 }, () => randomWeights(genre, () => rng.next())),
    ];

    it(`${id}: the sound matches the genre's own profile`, () => {
      for (const w of samples) {
        const sound = songSound({ blends: simpleBlends(toRefWeights(genre, w)), genre: id });
        expect(sound.bassTone).toEqual(bassTone(genre, w));
        expect(sound.leadTone).toEqual(leadTone(genre, w));
        expect(sound.mix).toEqual(mixAt(genre, w));
        expect(sound.drums).toBe(dominantDrums(genre, w));
        expect(sound.voices).toEqual({ ...dominantVoices(genre, w) });
        expect(sound.parts).toBe(genre.parts);
      }
    });

    it(`${id}: a blend of its references composes the same song as its weights`, () => {
      for (const [seed, w] of samples.slice(0, 6).entries()) {
        const before = compose({ seed, genre: id, weights: w });
        const after = compose({ seed, blend: toRefWeights(genre, w) });
        expect(played(after)).toEqual(played(before));
      }
    });
  }
});

describe("blends across genres", () => {
  it("mixes each genre's value by its share", () => {
    const half: RefWeights = { "true-faith": 0.5, "get-closer": 0.5 };
    const p = profileOf(half, "synthpop");
    expect(p.mixed).toBe(true);
    const tf = profileOf({ "true-faith": 1 }, "synthpop").mix((g) => g.tempo.center);
    const gc = profileOf({ "get-closer": 1 }, "italo").mix((g) => g.tempo.center);
    expect(p.mix((g) => g.tempo.center)).toBeCloseTo((tf + gc) / 2, 10);
    // Each genre reads its own weights normalised to 1.
    expect(p.shares.map((s) => [s.genre.id, s.share, s.weights])).toEqual([
      ["synthpop", 0.5, [1, 0, 0]],
      ["italo", 0.5, [0, 1, 0, 0]],
    ]);
  });

  it("takes discrete traits from the reference that outweighs the others", () => {
    const p = profileOf({ faces: 0.6, "true-faith": 0.4 }, "synthpop");
    expect(p.genre.id).toBe("italo");
    expect(p.voices).toBe(GENRES.italo.voiceTraits?.faces);
    expect(p.drums).toBe(GENRES.italo.drumTraits.faces);
    // A tie between genres falls to the home genre's defaults.
    const tie = profileOf({ "true-faith": 0.5, "the-night": 0.5 }, "synthpop");
    expect(tie.genre.id).toBe("synthpop");
    expect(tie.voices).toBe(SYNTHPOP_VOICES);
    expect(tie.drums).toBe(GENRES.synthpop.drums);
  });

  it("plays each part from its own blend", () => {
    const blends: PartBlends = {
      ...simpleBlends({ "get-closer": 1 }),
      bass: { "true-faith": 1 },
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      const song = compose({ seed, blend: { "get-closer": 1 }, parts: { bass: blends.bass } });
      expect(song.genre).toBe("italo");
      expect(["tf", "ds"]).toContain(song.bassStyle);
      expect(songSound(song).voices.riff).toBe("echo");
      expect(songSound(song).bassTone).toEqual(bassTone(GENRES.synthpop, [1, 0, 0]));
    }
  });

  it("composes and arranges any blend, per part or not", () => {
    const rng = createRng(2026);
    const randomBlend = (): RefWeights => {
      const n = 2 + Math.floor(rng.next() * 3);
      const refs = new Set<(typeof REFERENCE_IDS)[number]>();
      while (refs.size < n) refs.add(rng.pick(REFERENCE_IDS));
      return Object.fromEntries(
        [...refs].map((r) => [r, Math.round(rng.next() * 100) / 100 + 0.01]),
      );
    };
    for (let seed = 0; seed < 120; seed++) {
      const blend = randomBlend();
      const parts = seed % 2 ? Object.fromEntries(PARTS.map((p) => [p, randomBlend()])) : null;
      const song = compose({ seed, blend, parts, form: rng.pick(["short", "standard", "long"]) });
      const genres = new Set(
        Object.keys(song.blends.song).map((r) => genreOfReference(r as never)),
      );
      const lo = Math.min(...[...genres].map((g) => GENRES[g].tempo.range[0]));
      const hi = Math.max(...[...genres].map((g) => GENRES[g].tempo.range[1]));
      expect(song.bpm).toBeGreaterThanOrEqual(lo);
      expect(song.bpm).toBeLessThanOrEqual(hi);
      expect(song.totalBars).toBeGreaterThan(16);
      // JSON turns NaN and Infinity into null: none anywhere in what plays or how it sounds.
      const bars = Array.from({ length: song.totalBars }, (_, b) => {
        const e = arrangeBar(song, b);
        return [e.chords, e.drums, e.notes];
      });
      const text = JSON.stringify([song.bpm, song.key, bars, songSound(song)]);
      expect(text).not.toContain("null");
    }
  });
});
