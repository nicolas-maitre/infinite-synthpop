import { describe, expect, it } from "vitest";
import { MIN_RECORDS, songShares, tasteOf } from "./foryou";
import { simpleBlends, type PartBlends, type RefWeights } from "./profile";

const song = (w: RefWeights): PartBlends => simpleBlends(w);

describe("songShares", () => {
  it("averages each part's normalized blend", () => {
    const blends: PartBlends = {
      ...simpleBlends({ "true-faith": 3, "different-story": 1 }),
      voice: { "the-night": 2 },
    };
    const s = songShares(blends);
    expect(s["true-faith"]).toBeCloseTo((5 * 0.75) / 6);
    expect(s["different-story"]).toBeCloseTo((5 * 0.25) / 6);
    expect(s["the-night"]).toBeCloseTo(1 / 6);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("tasteOf", () => {
  it("is null without favourites", () => {
    expect(tasteOf([], [song({ "true-faith": 1 })])).toBeNull();
  });

  it("plays the favourites' records with a tenth or more, largest first", () => {
    const taste = tasteOf(
      [
        song({ "true-faith": 0.6, "different-story": 0.35, faces: 0.05 }),
        song({ "true-faith": 0.2, "the-night": 0.8 }),
      ],
      [],
    )!;
    // TF 0.4, TN 0.4, DS 0.175, Faces 0.025.
    expect(taste.shares["true-faith"]).toBeCloseTo(0.4);
    expect(taste.shares.faces).toBeCloseTo(0.025);
    expect(taste.refs.slice(2)).toEqual(["different-story"]);
    expect(new Set(taste.refs.slice(0, 2))).toEqual(new Set(["true-faith", "the-night"]));
  });

  it("takes off half a favourite per quick skip, clamped at 0", () => {
    const liked = [
      song({ "true-faith": 0.5, "the-night": 0.5 }),
      song({ "true-faith": 0.5, "innocent-love": 0.5 }),
    ];
    // Without skips: TF 0.5, TN 0.25, IL 0.25.
    const skipped = [song({ "the-night": 1 })];
    const taste = tasteOf(liked, skipped)!;
    // TN 0.25 − 0.5/2 = 0: gone. TF 0.5 and IL 0.25 renormalized.
    expect(taste.shares["the-night"]).toBe(0);
    expect(taste.shares["true-faith"]).toBeCloseTo(2 / 3);
    expect(taste.shares["innocent-love"]).toBeCloseTo(1 / 3);
    expect(taste.refs).toEqual(["true-faith", "innocent-love"]);
    // Skipped over and over: never below 0.
    const many = tasteOf(liked, [skipped[0]!, skipped[0]!, skipped[0]!])!;
    expect(many.shares["the-night"]).toBe(0);
  });

  it("pads to two records, from the favourites first", () => {
    const taste = tasteOf([song({ "self-control": 0.95, faces: 0.05 })], [])!;
    expect(taste.refs).toEqual(["self-control", "faces"]);
    expect(taste.refs.length).toBe(MIN_RECORDS);
  });

  it("pads a single record with its genre's", () => {
    const taste = tasteOf([song({ "heaven-can-wait": 1 })], [])!;
    expect(taste.refs[0]).toBe("heaven-can-wait");
    expect(["innocent-love", "crazy-juliet"]).toContain(taste.refs[1]);
  });

  it("falls back on the favourites when the skips take everything", () => {
    const liked = [song({ "true-faith": 0.7, "you-came": 0.3 })];
    const taste = tasteOf(liked, [liked[0]!, liked[0]!, liked[0]!])!;
    expect(taste.refs).toEqual(["true-faith", "you-came"]);
  });
});
