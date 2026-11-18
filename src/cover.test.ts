import { describe, expect, it } from "vitest";
import { compose } from "./composer";
import {
  contrast,
  creationCover,
  describeSleeve,
  GENRE_MOTIFS,
  luminance,
  mix,
  neon,
  RECORD_COLOURS,
  type Sleeve,
} from "./cover";
import { GENRE_IDS } from "./genres";
import { influences } from "./influence";
import { REFERENCES } from "./references";
import { songToSpec } from "./spec";

const HEX = /^#[0-9a-f]{6}$/;
const SEEDS = [1, 42, 777, 4242, 90210];

/** Every point and size in the sleeve, to check they stay on it. */
function numbers(s: Sleeve): number[] {
  const m = s.motif;
  if (m.kind === "minimal") return [m.at.x, m.at.y, m.size];
  if (m.kind === "neon")
    return [m.horizon, m.sun.x, m.sun.r, ...m.stars.flatMap((x) => [x.at.x, x.at.y])];
  return [
    ...m.rings.flatMap((r) => [r.at.x, r.at.y, r.r]),
    m.sphere.at.x,
    m.sphere.at.y,
    ...m.sparkles.flatMap((x) => [x.at.x, x.at.y]),
  ];
}

describe("sleeves", () => {
  it("colours every record from its sleeve", () => {
    expect(Object.keys(RECORD_COLOURS).sort()).toEqual(Object.keys(REFERENCES).sort());
    for (const c of Object.values(RECORD_COLOURS)) {
      expect(c.field).toMatch(HEX);
      expect(c.ink).toMatch(HEX);
    }
  });

  it("gives the same song the same sleeve, every time", () => {
    for (const genre of [...GENRE_IDS, "auto"] as const) {
      for (const seed of SEEDS) {
        const a = describeSleeve(compose({ seed, genre }));
        const b = describeSleeve(compose({ seed, genre }));
        expect(b).toEqual(a);
      }
    }
  });

  it("draws a stored song's sleeve without composing it", () => {
    for (const genre of [...GENRE_IDS, "auto"] as const) {
      for (const seed of SEEDS) {
        const song = compose({ seed, genre });
        const stored = creationCover({ seed: song.seed, spec: songToSpec(song) });
        expect(describeSleeve(stored)).toEqual(describeSleeve(song));
      }
    }
  });

  it("varies from song to song", () => {
    for (const genre of GENRE_IDS) {
      const keys = SEEDS.map((seed) =>
        JSON.stringify(describeSleeve(compose({ seed, genre })).motif),
      );
      expect(new Set(keys).size).toBeGreaterThan(3);
    }
  });

  it("takes the genre's motif, the main record's colour and an ISP catalogue number", () => {
    for (const genre of GENRE_IDS) {
      for (const seed of SEEDS) {
        const song = compose({ seed, genre });
        const s = describeSleeve(song);
        const [main, ...rest] = influences(song);
        expect(s.motif.kind).toBe(GENRE_MOTIFS[song.genre]);
        expect(s.palette.ground).toBe(RECORD_COLOURS[main!.id].field);
        expect(s.palette.accents.map((a) => a.share)).toEqual(
          rest.map((r) => Math.round(r.share * 100) / 100),
        );
        expect(s.catalogue).toMatch(/^ISP-\d{4}$/);
        expect(s.label.length).toBeGreaterThan(2);
        for (const n of numbers(s)) expect(n).toBeGreaterThanOrEqual(-0.25);
        for (const n of numbers(s)) expect(n).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it("reads cold blue for True Faith and warm magenta for Innocent Love", () => {
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(RECORD_COLOURS["true-faith"].field.slice(i, i + 2), 16),
    );
    expect(b).toBeGreaterThan(r! + 60);
    expect(b).toBeGreaterThan(g!);
    const love = describeSleeve(compose({ seed: 9, blend: { "innocent-love": 1 } }));
    expect(love.palette.ground).toBe(RECORD_COLOURS["innocent-love"].field);
  });

  it("marks a song across genres with the other genre's touches", () => {
    const song = compose({ seed: 5, blend: { "true-faith": 0.55, "heaven-can-wait": 0.45 } });
    const s = describeSleeve(song);
    expect(s.motif.kind).toBe(GENRE_MOTIFS[song.genre]);
    expect(s.touch?.kind).toBe(song.genre === "euro" ? "minimal" : "chrome");
    expect(s.touch!.share).toBeGreaterThan(0.3);
    expect(describeSleeve(compose({ seed: 5, genre: "synthpop" })).touch).toBeNull();
  });

  it("sets plain type that reads on the ground", () => {
    for (const genre of GENRE_IDS) {
      for (const seed of SEEDS) {
        const s = describeSleeve(compose({ seed, genre }));
        if (s.type.finish === "plain" && s.motif.kind === "minimal")
          expect(contrast(s.type.colour, s.palette.ground)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("mixes and lights colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(neon("#808080")).toBe("#ff4fa3");
    expect(luminance(neon("#2f45a0"))).toBeGreaterThan(luminance("#2f45a0"));
  });
});
