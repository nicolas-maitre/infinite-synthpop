import { describe, expect, it } from "vitest";
import { compose } from "./composer";
import { parseSeedLink, seedLink } from "./links";

const params = (link: string) => new URLSearchParams(link.slice(1));

describe("progressions switch", () => {
  it("defaults to classic: omitting chords composes the same song", () => {
    for (const seed of [1, 42, 777]) {
      const plain = compose({ seed });
      expect(plain.chords).toBe("classic");
      expect(compose({ seed, chords: "classic" })).toEqual(plain);
    }
  });

  it("records the mode on generated songs", () => {
    expect(compose({ seed: 42, chords: "theory" }).chords).toBe("theory");
  });
});

describe("seed links", () => {
  it("round-trips both modes", () => {
    for (const chords of ["classic", "theory"] as const) {
      expect(parseSeedLink(params(seedLink(123, chords)))).toEqual({ seed: 123, chords });
    }
  });

  it("writes old-style links for classic songs", () => {
    expect(seedLink(42, "classic")).toBe("#seed=42");
    expect(seedLink(42, "theory")).toBe("#seed=42&chords=theory");
  });

  it("reads a link without chords as classic", () => {
    expect(parseSeedLink(params("#seed=42"))).toEqual({ seed: 42, chords: "classic" });
    expect(parseSeedLink(params("#seed=42&chords=bogus"))).toEqual({ seed: 42, chords: "classic" });
  });

  it("ignores hashes without a valid seed", () => {
    for (const link of ["", "#ref=true-faith", "#seed=abc", "#seed=0", "#seed=1.5"]) {
      expect(parseSeedLink(params(link))).toBeNull();
    }
  });
});
