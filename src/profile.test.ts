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
  blendsKey,
  PARTS,
  profileOf,
  sameWeights,
  REFERENCE_IDS,
  simpleBlends,
  songSound,
  toRefWeights,
  type PartBlends,
  type RefWeights,
} from "./profile";
import { centreFor, parsePadWeights, parsePartValue, parseRefs, partBlend } from "./blendpicker";
import { createRng } from "./rng";
import { decodeCreation, encodeCreation, songToSpec } from "./spec";

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
    // A tie between genres: the first tied reference's own, never a genre default from a record
    // outside the blend (Italo's defaults are Get Closer's).
    const tie = profileOf({ "self-control": 0.5, "crazy-juliet": 0.5 }, "synthpop");
    expect(tie.genre.id).toBe("italo");
    expect(tie.voices).toBe(GENRES.italo.voiceTraits?.["self-control"]);
    expect(tie.drums).toBe(GENRES.italo.drumTraits["self-control"]);
    const synthTie = profileOf({ "true-faith": 0.5, "the-night": 0.5 }, "synthpop");
    expect(synthTie.genre.id).toBe("synthpop");
    expect(synthTie.voices).toBe(SYNTHPOP_VOICES);
    expect(synthTie.drums).toBe(GENRES.synthpop.drumTraits["true-faith"]);
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

describe("blends in creations, links and saves", () => {
  /** Every bar as it plays, and how it sounds. */
  const arrangement = (song: Song) =>
    JSON.stringify([
      song.sections,
      Array.from({ length: song.totalBars }, (_, b) => arrangeBar(song, b)),
      songSound(song),
    ]);
  const encoded = (song: Song) => encodeCreation({ seed: song.seed, spec: songToSpec(song) });

  const songs = [
    compose({
      seed: 5,
      blend: { "different-story": 0.67, "crazy-juliet": 0.27, "get-closer": 0.06 },
    }),
    compose({ seed: 8, blend: { "true-faith": 0.5, faces: 0.5 }, form: "long" }),
    // One genre, per part: Get Closer with True Faith's bass and Heaven Can Wait's drums.
    compose({
      seed: 9,
      genre: "italo",
      weights: [0, 1, 0, 0],
      parts: { bass: { "true-faith": 1 }, drums: { "heaven-can-wait": 1 } },
    }),
  ];

  it("turns a blended song into a spec that plays the same, through the link too", () => {
    for (const song of songs) {
      const spec = songToSpec(song);
      expect(spec.blends).toEqual(song.blends);
      expect(arrangement(compose({ seed: song.seed, custom: spec }))).toBe(arrangement(song));
      const decoded = decodeCreation(encoded(song));
      expect(decoded?.spec.blends).toBeDefined();
      for (const part of PARTS)
        expect(sameWeights(decoded!.spec.blends![part], song.blends[part]), part).toBe(true);
      expect(arrangement(compose({ seed: song.seed, custom: decoded!.spec }))).toBe(
        arrangement(song),
      );
    }
  });

  it("writes only the parts that differ from the song's blend", () => {
    const raw = (song: Song) =>
      JSON.parse(atob(encoded(song).replace(/-/g, "+").replace(/_/g, "/"))) as {
        b?: unknown;
        bp?: Record<string, unknown>;
      };
    expect(raw(songs[0]!).bp).toBeUndefined();
    expect(Object.keys(raw(songs[2]!).bp ?? {}).sort()).toEqual(["bass", "drums"]);
    expect(raw(songs[2]!).b).toEqual({ "get-closer": 1 });
  });

  it("keeps single-genre songs in the old form", () => {
    for (const song of [
      compose({ seed: 3, style: 0.4 }),
      compose({ seed: 4, genre: "euro", weights: [0.2, 0.5, 0.3] }),
      compose({ seed: 6, genre: "auto" }),
    ]) {
      if (Object.keys(song.blends.song).some((r) => genreOfReference(r as never) !== song.genre))
        continue;
      expect(songToSpec(song).blends).toBeUndefined();
      expect(decodeCreation(encoded(song))?.spec.blends).toBeUndefined();
    }
  });

  it("drops a malformed blend and plays the song part's genre and weights", () => {
    const link = encoded(songs[0]!);
    const json = JSON.parse(atob(link.replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;
    for (const b of [{ nope: 1 }, { "true-faith": -1 }, { "true-faith": 0 }, [1, 2], "x"]) {
      const bad = btoa(JSON.stringify({ ...json, b })).replace(/=+$/, "");
      const decoded = decodeCreation(bad);
      expect(decoded).not.toBeNull();
      expect(decoded?.spec.blends).toBeUndefined();
      expect(decoded?.spec.genre).toBe(
        "synthpop" === songs[0]!.genre ? undefined : songs[0]!.genre,
      );
    }
    // A bad part falls back to the song part's blend.
    const badPart = btoa(JSON.stringify({ ...json, bp: { bass: { nope: 1 } } })).replace(/=+$/, "");
    expect(decodeCreation(badPart)?.spec.blends?.bass).toEqual(
      decodeCreation(link)?.spec.blends?.song,
    );
  });

  it("names a blend the same way whatever order it was written in", () => {
    const a = simpleBlends({ faces: 0.5, "true-faith": 0.5 });
    const b = simpleBlends({ "true-faith": 0.5, faces: 0.5, "you-came": 0 });
    expect(blendsKey(a)).toBe(blendsKey(b));
    expect(blendsKey(a)).toBe("true-faith:0.5,faces:0.5");
    expect(blendsKey({ ...a, bass: { "you-came": 1 } })).toBe(
      "true-faith:0.5,faces:0.5;bass=you-came:1",
    );
  });
});

describe("open blends from the generator", () => {
  const refs = ["true-faith", "get-closer", "crazy-juliet"] as const;

  it("puts an auto point on the chosen references only, a new one per song", () => {
    const points = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const song = compose({ seed, blendRefs: refs });
      const used = Object.keys(song.blends.song).filter(
        (r) => (song.blends.song[r as never] ?? 0) > 0,
      );
      expect(used.every((r) => (refs as readonly string[]).includes(r))).toBe(true);
      points.add(JSON.stringify(song.blends.song));
      expect(compose({ seed, blendRefs: refs }).blends).toEqual(song.blends);
    }
    expect(points.size).toBeGreaterThan(20);
  });

  it("reads the pad's settings back from storage, rejecting what doesn't fit", () => {
    expect(parseRefs(["get-closer", "true-faith", "nope", "get-closer"])).toEqual([
      "true-faith",
      "get-closer",
    ]);
    expect(parseRefs(["true-faith"])).toBeNull();
    expect(parsePadWeights([0.5, 0.5], 2)).toEqual([0.5, 0.5]);
    expect(parsePadWeights([0.5, 0.5], 3)).toBeNull();
    expect(parsePadWeights([0, 0], 2)).toBeNull();
    expect(parsePartValue({ kind: "genre", genre: "euro", weights: [0.2, 0.3, 0.5] })).toEqual({
      kind: "genre",
      genre: "euro",
      weights: [0.2, 0.3, 0.5],
    });
    expect(parsePartValue({ kind: "genre", genre: "euro", weights: [1, 0] })).toBeNull();
    expect(
      parsePartValue({ kind: "open", refs: ["faces", "you-came"], weights: [0.4, 0.6] }),
    ).toEqual({
      kind: "open",
      refs: ["you-came", "faces"],
      weights: [0.4, 0.6],
    });
    expect(partBlend({ kind: "open", refs: ["you-came", "faces"], weights: [0.4, 0.6] })).toEqual({
      "you-came": 0.4,
      faces: 0.6,
    });
    expect(centreFor(["true-faith", "faces"])).toEqual([0.5, 0.5]);
  });
});
