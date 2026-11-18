import { describe, expect, it } from "vitest";
import { compose } from "./composer";
import { GENRE_IDS } from "./genres";
import { influences, MIN_SHARE, partCredits, RECORDS } from "./influence";
import { PARTS } from "./profile";
import { REFERENCES } from "./references";

describe("influences", () => {
  it("credits every record", () => {
    expect(Object.keys(RECORDS).sort()).toEqual(Object.keys(REFERENCES).sort());
  });

  it("gives an original all to its own record", () => {
    const song = compose({ seed: 1, reference: "self-control" });
    expect(influences(song)).toEqual([{ id: "self-control", share: 1 }]);
    expect(partCredits(song)).toEqual([]);
  });

  it("shares a generated song among its genre's records, largest first", () => {
    for (const genre of GENRE_IDS) {
      for (const seed of [3, 77, 1234]) {
        const song = compose({ seed, genre });
        const list = influences(song);
        expect(list.length).toBeGreaterThan(0);
        for (const [i, x] of list.entries()) {
          expect(x.share).toBeGreaterThanOrEqual(MIN_SHARE);
          if (i > 0) expect(x.share).toBeLessThanOrEqual(list[i - 1]!.share);
        }
        expect(list.reduce((n, x) => n + x.share, 0)).toBeLessThanOrEqual(1 + 1e-9);
        expect(list.reduce((n, x) => n + x.share, 0)).toBeGreaterThan(0.9);
        // Blended as one: the influences say it all.
        expect(partCredits(song)).toEqual([]);
      }
    }
  });

  it("credits each part's own records when the parts are blended apart", () => {
    const song = compose({
      seed: 9,
      genre: "synthpop",
      parts: { drums: { "self-control": 1 }, bass: { "the-night": 0.6, faces: 0.4 } },
    });
    const credits = partCredits(song);
    expect(credits.map((c) => c.part)).toEqual([...PARTS]);
    expect(credits.find((c) => c.part === "drums")!.records).toEqual([
      { id: "self-control", share: 1 },
    ]);
    expect(credits.find((c) => c.part === "bass")!.records.map((r) => r.id)).toEqual([
      "the-night",
      "faces",
    ]);
    expect(influences(song).map((x) => x.id)).toContain("self-control");
  });
});
