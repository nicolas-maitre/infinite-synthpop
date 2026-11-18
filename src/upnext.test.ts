import { describe, expect, it } from "vitest";
import { followingSeed, pickHint, upNextText } from "./upnext";

const derive = (seed: number) => seed + 1;

describe("followingSeed", () => {
  it("derives the next seed when nothing was picked", () => {
    expect(followingSeed(41, 3, null, derive)).toBe(42);
  });

  it("takes the pick for that playing of the song", () => {
    expect(followingSeed(41, 3, { serial: 3, seed: 777 }, derive)).toBe(777);
  });

  it("ignores a pick made for another playing", () => {
    // The song played again later (or the next one) goes on as it would have.
    expect(followingSeed(41, 4, { serial: 3, seed: 777 }, derive)).toBe(42);
  });
});

describe("upNextText", () => {
  // 120 BPM: two seconds a bar.
  const bar = 2;

  it("says when the DJ mixes the next song in, from the transition's start", () => {
    expect(upNextText({ kind: "mix", from: 80, swap: 96 }, bar)).toBe("mixes in at 2:40");
    expect(upNextText({ kind: "sleep" }, bar)).toMatch(/sleep timer/);
    expect(upNextText({ kind: "mix", from: 4, swap: 20 }, bar)).toBe("mixes in at 0:08");
  });

  it("says when it comes otherwise", () => {
    expect(upNextText({ kind: "mixing" }, bar)).toBe("mixing in now");
    expect(upNextText({ kind: "end" }, bar)).toBe("after this song");
    expect(upNextText({ kind: "repeat" }, bar)).toBe("this song again");
    expect(upNextText({ kind: "loop" }, bar)).toMatch(/loops/);
  });
});

describe("pickHint", () => {
  it("says what Pick another does while it can", () => {
    expect(pickHint("end", true)).toMatch(/^Pick another song/);
    expect(pickHint("mix", true)).toMatch(/^Pick another song/);
  });

  it("says why it can't", () => {
    expect(pickHint("repeat", false)).toMatch(/Repeat is on/);
    expect(pickHint("loop", false)).toMatch(/creation loops/);
    expect(pickHint("mixing", false)).toMatch(/already mixing/);
    expect(pickHint("mix", false)).toMatch(/Too late/);
    expect(pickHint("end", false)).toMatch(/Too late/);
  });
});
