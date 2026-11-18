import { describe, expect, it } from "vitest";
import { GENRE_IDS, GENRES } from "./genres";
import { isStationId, stationOf, stationPlay, STATIONS, type GenreSettings } from "./stations";
import { REFERENCES } from "./references";

const settings = (s: Partial<GenreSettings>): GenreSettings => ({
  genre: "auto",
  openRefs: ["true-faith", "get-closer"],
  styleAuto: true,
  partsOn: false,
  ...s,
});

describe("stations", () => {
  it("has Any, every genre, the mixes and For you, eight at most", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(ids[0]).toBe("auto");
    for (const g of GENRE_IDS) expect(ids).toContain(g);
    expect(ids.at(-1)).toBe("for-you");
    expect(ids.length).toBeLessThanOrEqual(8);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isStationId("night-drive")).toBe(true);
    expect(isStationId("nope")).toBe(false);
  });

  it("blends a mix's records within ten BPM, and never just a genre's", () => {
    for (const s of STATIONS) {
      const play = stationPlay(s.id, null);
      if (play?.genre !== "open") continue;
      const refs = play.openRefs!;
      const bpms = refs.map((r) => REFERENCES[r].bpm);
      expect(Math.max(...bpms) - Math.min(...bpms)).toBeLessThanOrEqual(10);
      for (const g of GENRE_IDS) {
        const genre = GENRES[g].references;
        expect(genre.length === refs.length && genre.every((r) => refs.includes(r))).toBe(false);
      }
    }
  });

  it("plays For you only with records, in reference order", () => {
    expect(stationPlay("for-you", null)).toBeNull();
    expect(stationPlay("for-you", ["self-control", "true-faith"])).toEqual({
      genre: "open",
      openRefs: ["true-faith", "self-control"],
    });
  });

  it("finds the station the settings play", () => {
    expect(stationOf(settings({}), null, null)).toBe("auto");
    expect(stationOf(settings({ genre: "italo" }), null, null)).toBe("italo");
    const night = stationPlay("night-drive", null)!.openRefs!;
    expect(stationOf(settings({ genre: "open", openRefs: night }), null, null)).toBe("night-drive");
  });

  it("is custom for what only the advanced view sets", () => {
    expect(stationOf(settings({ partsOn: true }), "auto", null)).toBeNull();
    expect(stationOf(settings({ genre: "euro", styleAuto: false }), "euro", null)).toBeNull();
    expect(stationOf(settings({ genre: "open", styleAuto: false }), null, null)).toBeNull();
    expect(stationOf(settings({ genre: "open" }), null, null)).toBeNull();
  });

  it("tells For you from a mix with the same records by the one chosen", () => {
    const refs = stationPlay("cold-wave", null)!.openRefs!;
    const s = settings({ genre: "open", openRefs: refs });
    expect(stationOf(s, "for-you", refs)).toBe("for-you");
    expect(stationOf(s, "cold-wave", refs)).toBe("cold-wave");
    expect(
      stationOf(settings({ genre: "open", openRefs: ["faces", "true-faith"] }), "for-you", [
        "true-faith",
        "faces",
      ]),
    ).toBe("for-you");
  });
});
