import { describe, expect, it } from "vitest";
import { compose, lengthMiss, type LengthRange, type Song } from "./composer";
import { swapBar } from "./dj";
import { GENRE_IDS } from "./genres";
import { createRng } from "./rng";

const seconds = (song: Song) => (song.totalBars * 240) / song.bpm;
const seeds = Array.from({ length: 30 }, (_, i) => i * 7919 + 3);

describe("the length range", () => {
  it("leaves a song that already fits as it was", () => {
    const range = { min: 150, max: 360 };
    for (const genre of GENRE_IDS) {
      for (const seed of seeds) {
        const plain = compose({ seed, genre });
        if (lengthMiss(seconds(plain), range) > 0) continue;
        expect(compose({ seed, genre, length: range }).sections).toEqual(plain.sections);
      }
    }
  });

  it("brings songs nearer, never further", () => {
    const ranges: LengthRange[] = [
      { min: 120, max: 180 },
      { min: 300, max: 360 },
    ];
    let nearer = 0;
    for (const range of ranges) {
      for (const genre of GENRE_IDS) {
        for (const seed of seeds) {
          const before = lengthMiss(seconds(compose({ seed, genre })), range);
          const after = lengthMiss(seconds(compose({ seed, genre, length: range })), range);
          expect(after).toBeLessThanOrEqual(before);
          if (after < before) nearer++;
        }
      }
    }
    expect(nearer).toBeGreaterThan(30);
  });

  it("keeps an asked-for form and the originals as they are", () => {
    const range = { min: 120, max: 150 };
    expect(compose({ seed: 5, form: "long", length: range }).sections).toEqual(
      compose({ seed: 5, form: "long" }).sections,
    );
    expect(compose({ seed: 5, reference: "true-faith", length: range }).totalBars).toBe(
      compose({ seed: 5, reference: "true-faith" }).totalBars,
    );
  });

  it("keeps the DJ's mix-out inside it", () => {
    const range = { min: 180, max: 270 };
    let inside = 0;
    let total = 0;
    for (const genre of GENRE_IDS) {
      for (const seed of seeds) {
        const song = compose({ seed, genre });
        const sec = 240 / song.bpm;
        const swap = swapBar(song, createRng(seed), 0, range);
        total++;
        if (lengthMiss(swap * sec, range) === 0) inside++;
        // Short of the min only when the song ends sooner.
        else if (swap * sec < range.min) expect(swap).toBe(song.totalBars);
      }
    }
    expect(inside / total).toBeGreaterThan(0.9);
  });

  it("draws the same picks after the mix-out with or without it", () => {
    const song = compose({ seed: 42 });
    const a = createRng(1);
    const b = createRng(1);
    swapBar(song, a);
    swapBar(song, b, 0, { min: 120, max: 150 });
    expect(a.next()).toBe(b.next());
  });
});
