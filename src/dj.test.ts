import { describe, expect, it } from "vitest";
import { arrangeBar } from "./arranger";
import { compose } from "./composer";
import {
  compatibleKeys,
  DRUM_SWAP_BARS,
  glideShape,
  incomingArrange,
  INTRO_BARS,
  MIN_SECONDS,
  nextKey,
  nextTempo,
  outgoingArrange,
  PAD_FADE_BARS,
  swapBar,
} from "./dj";
import { GENRE_IDS } from "./genres";
import { createRng } from "./rng";

const songs = GENRE_IDS.flatMap((genre) =>
  [11, 222, 3333, 44444, 555555].map((seed) => compose({ seed, genre })),
);

describe("swapBar", () => {
  it("hands over at a section line past the first chorus and about 2 minutes, or at the end", () => {
    for (const song of songs) {
      const lines = new Set([...song.sections.map((s) => s.startBar), song.totalBars]);
      const firstChorus = song.sections.find((s) => s.kind === "chorus");
      for (let i = 0; i < 20; i++) {
        const swap = swapBar(song, createRng(song.seed + i));
        expect(lines.has(swap)).toBe(true);
        const at = song.sections.findIndex((s) => s.startBar === swap);
        if (at > 0)
          expect([song.sections[at - 1]!.kind, song.sections[at]!.kind]).not.toEqual([
            "chorus",
            "chorus",
          ]);
        expect(swap).toBeGreaterThanOrEqual(INTRO_BARS);
        if (swap === song.totalBars) continue;
        expect(swap * (240 / song.bpm)).toBeGreaterThanOrEqual(MIN_SECONDS - 1e-6);
        if (firstChorus)
          expect(swap).toBeGreaterThanOrEqual(firstChorus.startBar + firstChorus.bars);
      }
    }
  });

  it("waits for the song's tempo glide to end", () => {
    const song = songs[0]!;
    for (let i = 0; i < 20; i++) {
      expect(swapBar(song, createRng(i), 90)).toBeGreaterThanOrEqual(Math.min(90, song.totalBars));
    }
  });

  it("mixes out at different points from song to song", () => {
    const swaps = new Set(songs.map((s) => swapBar(s, createRng(s.seed)) / s.totalBars));
    expect(swaps.size).toBeGreaterThan(3);
  });
});

describe("tempo and key", () => {
  it("keeps the next tempo within 6 % on the half-BPM grid", () => {
    expect(nextTempo(120, 121.5)).toBe(121.5);
    expect(nextTempo(106.5, 123)).toBe(112.5);
    expect(nextTempo(123, 106.5)).toBe(116);
    expect(nextTempo(120, 100) * 2).toBe(Math.round(nextTempo(120, 100) * 2));
  });

  it("glides 1 BPM per 16 bars, within half the song", () => {
    expect(glideShape(120, 120, 100)).toEqual({ bpm: 120 });
    expect(glideShape(120, 123, 200).glide).toEqual({ to: 123, start: 0, bars: 48 });
    expect(glideShape(116, 123, 100).glide?.bars).toBe(50);
  });

  it("mixes into a key next to the current one on the Camelot wheel", () => {
    const am = { tonic: 9, mode: "minor" as const };
    expect(compatibleKeys(am)).toEqual([
      am,
      { tonic: 4, mode: "minor" },
      { tonic: 2, mode: "minor" },
      { tonic: 0, mode: "major" },
    ]);
    // Its own key when it fits, else a neighbour in its own mode.
    expect(nextKey(am, { tonic: 4, mode: "minor" }, createRng(1))).toEqual({
      tonic: 4,
      mode: "minor",
    });
    for (let i = 0; i < 10; i++) {
      const k = nextKey(am, { tonic: 1, mode: "minor" }, createRng(i));
      expect([9, 4, 2]).toContain(k.tonic);
      expect(k.mode).toBe("minor");
    }
    expect(nextKey(am, { tonic: 7, mode: "major" }, createRng(1))).toEqual({
      tonic: 0,
      mode: "major",
    });
  });
});

describe("the decks around a handoff", () => {
  it("sheds the outgoing drums and melody, then its figures, keeping its bass and pads", () => {
    const song = songs[3]!;
    const swap = swapBar(song, createRng(1));
    const next = songs[7]!;
    const play = outgoingArrange(song, swap, next);
    const before = swap - DRUM_SWAP_BARS - 1;
    expect(play(before)).toEqual(arrangeBar(song, before));
    for (let bar = swap - DRUM_SWAP_BARS; bar < swap; bar++) {
      const { drums, notes } = play(bar);
      const own = arrangeBar(song, bar).notes;
      expect(drums).toEqual([]);
      expect(notes.lead).toEqual([]);
      expect(notes.bass).toEqual(own.bass);
      expect(notes.pad).toEqual(own.pad);
      expect(notes.arp).toEqual(bar < swap - DRUM_SWAP_BARS / 2 ? own.arp : []);
    }
    // Past the swap, its pads alone (if they reached it), fading out, led into the next song's chords.
    const reached = play(swap - 1).notes.pad.length > 0;
    let last = Infinity;
    for (let bar = swap; bar < swap + PAD_FADE_BARS; bar++) {
      const { drums, notes } = play(bar);
      expect(drums).toEqual([]);
      expect(notes.bass).toEqual([]);
      expect(notes.pad.length > 0).toBe(reached);
      const vel = Math.max(0, ...notes.pad.map((n) => n.vel));
      if (reached) expect(vel).toBeLessThan(last);
      last = vel;
      // In the outgoing pads' own register.
      const own = play(swap - 1).notes.pad.map((n) => n.midi);
      for (const n of notes.pad) {
        expect(n.midi).toBeGreaterThanOrEqual(Math.min(...own) - 6);
        expect(n.midi).toBeLessThanOrEqual(Math.max(...own) + 6);
      }
    }
    expect(Object.values(play(swap + PAD_FADE_BARS).notes).flat()).toEqual([]);
  });

  it("plays the incoming groove before bar 0: no kick and fading in, then all of it", () => {
    for (const song of songs) {
      const play = incomingArrange(song);
      for (let bar = -INTRO_BARS; bar < 0; bar++) {
        const ev = play(bar);
        expect(Object.values(ev.notes).every((n) => n.length === 0)).toBe(true);
        if (bar < -DRUM_SWAP_BARS) {
          // Only its hats and shakers, under the outgoing song's backbeat.
          for (const h of ev.drums) expect(["hat", "openhat", "tamb", "cabasa"]).toContain(h.voice);
        } else expect(ev.drums.some((h) => h.voice === "kick")).toBe(true);
      }
      const quiet = play(-INTRO_BARS).drums.map((h) => h.vel);
      const loud = play(-INTRO_BARS + 4).drums.map((h) => h.vel);
      if (quiet.length && loud.length) expect(Math.max(...quiet)).toBeLessThan(Math.max(...loud));
      expect(play(0).notes).toEqual(arrangeBar(song, 0).notes);
      // The beat never drops: drums from bar 0 on, the groove standing in until the song's own.
      for (let bar = 0; bar < 8; bar++) expect(play(bar).drums.length).toBeGreaterThan(0);
    }
  });
});
