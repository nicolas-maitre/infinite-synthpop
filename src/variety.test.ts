import { describe, expect, it } from "vitest";
import { measureVariety, varietyReport } from "./variety";

describe("variety measurement", () => {
  it("measures a small batch", () => {
    const v = measureVariety("synthpop", "classic", 8);
    expect(v.songs).toBe(8);
    expect(v.verse.distinct).toBeGreaterThan(0);
    expect(v.verse.distinct).toBeLessThanOrEqual(8);
    expect(v.verse.bankEntry).toBeGreaterThanOrEqual(0);
    expect(v.verse.bankEntry).toBeLessThanOrEqual(1);
    expect(v.perSong).toBeGreaterThan(1);
    expect(varietyReport(v)).toContain("synthpop · classic");
  });
});
