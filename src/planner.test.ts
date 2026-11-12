import { describe, expect, it } from "vitest";
import { arrangeBar } from "./arranger";
import { compose, type Song, type SongEnding, type SongForm } from "./composer";
import { GENRES, genreOfReference } from "./genres";
import { planMerged } from "./planner";
import { profileOf, REFERENCE_IDS, songSound, type RefWeights } from "./profile";
import { createRng } from "./rng";
import { mod12 } from "./theory";

const ENDINGS = ["fade", "lift", "hold"] as const satisfies readonly SongEnding[];
const FORMS = ["short", "standard", "long"] as const satisfies readonly SongForm[];

/** A random blend of 2–4 references across at least two genres. */
function crossBlend(rng: ReturnType<typeof createRng>): RefWeights {
  for (;;) {
    const n = 2 + Math.floor(rng.next() * 3);
    const refs = new Set<(typeof REFERENCE_IDS)[number]>();
    while (refs.size < n) refs.add(rng.pick(REFERENCE_IDS));
    if (new Set([...refs].map(genreOfReference)).size < 2) continue;
    return Object.fromEntries([...refs].map((r) => [r, Math.round(rng.next() * 100) / 100 + 0.01]));
  }
}

/** Many songs from blends across genres. */
function crossSongs(count: number, seed = 1): Song[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) =>
    compose({
      seed: i,
      blend: crossBlend(rng),
      form: rng.pick(FORMS),
      ending: rng.pick(ENDINGS),
    }),
  );
}

describe("the merged planner", () => {
  const songs = crossSongs(400);

  it("lays out a whole song: an intro, two verses, choruses, an ending", () => {
    for (const song of songs) {
      const kinds = song.sections.map((s) => s.kind);
      expect(kinds[0]).toBe("intro");
      expect(kinds.at(-1)).toBe("outro");
      expect(kinds.filter((k) => k === "verse").length).toBeGreaterThanOrEqual(2);
      expect(kinds.filter((k) => k === "chorus").length).toBeGreaterThanOrEqual(2);
      expect(song.sections.map((s) => s.label)).toContain("Verse 2");
      expect(song.totalBars).toBe(song.sections.reduce((n, s) => n + s.bars, 0));
      expect(song.sections.at(-1)?.fade).toBe(true);
    }
  });

  it("reaches every genre's blocks", () => {
    const labels = new Set(songs.flatMap((s) => s.sections.map((x) => x.label)));
    for (const label of [
      // Openings: synthpop's, The Night's pedal, Faces' build, Get Closer's hook, Self Control's
      // pad, Crazy Juliet's staggered entries, Heaven Can Wait's motif, Innocent Love's pads.
      "Intro · riff",
      "Intro · pedal",
      "Intro · bass and kick",
      "Hook",
      "Intro · pad",
      "Intro · hats and bass",
      "Intro · motif",
      "Intro · climb",
      // Pre-choruses.
      "Pre-chorus",
      "Pre-chorus · title line",
      // After the first chorus.
      "Turn · VI–VII",
      "Interlude",
      "Break · stab on 2",
      "Tag",
      "Stop",
      // Middles.
      "Bridge · bass solo",
      "Breakdown",
      "Reprise · pedal",
      "Lead synth",
      "Instrumental chorus",
      "Instrumental link",
      "Bridge",
      // Late blocks.
      "Instrumental · riff",
      // Finales and endings.
      "Chorus · double",
      "Chorus · last",
      "Outro · i–v vamp",
      "Outro · chorus to fade",
      "Outro · lift to IV",
      "Ending · IV held",
    ])
      expect(labels).toContain(label);
  });

  it("plays one reference with only its own genre's blocks", () => {
    for (const ref of REFERENCE_IDS) {
      const id = genreOfReference(ref);
      const solo = GENRES[id].references.map((r) => (r === ref ? 1 : 0));
      const legacy = new Set<string>();
      const merged = new Set<string>();
      for (let seed = 0; seed < 120; seed++) {
        for (const form of FORMS) {
          const song = compose({ seed, genre: id, weights: solo, form });
          for (const s of song.sections) legacy.add(s.label);
          if (seed >= 40) continue;
          const ending = song.sections.at(-1)?.label.includes("IV held")
            ? "hold"
            : song.sections.at(-1)?.label.includes("lift")
              ? "lift"
              : "fade";
          const sections = planMerged(
            createRng(seed).fork("form"),
            song.key,
            { tonic: mod12(song.key.tonic + 5), mode: "major" },
            ending,
            song.progressions,
            profileOf({ [ref]: 1 }, id),
            songSound(song).voices,
            form,
          );
          for (const s of sections) merged.add(s.label);
        }
      }
      expect(
        [...merged].filter((l) => !legacy.has(l)),
        ref,
      ).toEqual([]);
    }
  });

  it("arranges every bar", () => {
    for (const song of songs.slice(0, 60)) {
      for (let b = 0; b < song.totalBars; b++) {
        const e = arrangeBar(song, b);
        expect(JSON.stringify([e.chords, e.drums, e.notes])).not.toContain("null");
      }
    }
  });
});

describe("Auto", () => {
  const songs = Array.from({ length: 300 }, (_, seed) => ({
    seed,
    song: compose({ seed, genre: "auto" }),
  }));
  const spans = (song: Song) =>
    new Set(
      Object.entries(song.blends.song)
        .filter(([, w]) => w! > 0)
        .map(([r]) => genreOfReference(r as never)),
    ).size;

  it("plays an open blend across genres in about one song in five", () => {
    const open = songs.filter(({ song }) => spans(song) > 1).length / songs.length;
    expect(open).toBeGreaterThan(0.12);
    expect(open).toBeLessThan(0.28);
  });

  it("plays the other songs exactly as before", () => {
    for (const { seed, song } of songs.filter(({ song }) => spans(song) === 1).slice(0, 40)) {
      // Before open blends, Auto was the picked genre at a random point of its polygon.
      const preset = compose({ seed, genre: song.genre, weights: "auto" });
      expect(song.sections).toEqual(preset.sections);
      expect([song.bpm, song.key, song.kit, song.bassStyle, song.title]).toEqual([
        preset.bpm,
        preset.key,
        preset.kit,
        preset.bassStyle,
        preset.title,
      ]);
      expect(song.melodies).toEqual(preset.melodies);
    }
  });
});
