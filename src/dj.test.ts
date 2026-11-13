import { describe, expect, it } from "vitest";
import { arrangeBar } from "./arranger";
import { compose } from "./composer";
import {
  autoTransition,
  blendDistance,
  compatibleKeys,
  deckSound,
  morphArrange,
  morphSwitches,
  morphSound,
  MORPH_BARS,
  soundBetween,
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
  KIT_RAMP_BARS,
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

describe("a morph", () => {
  it("turns the drums into the next song's, sheds the melody, then the figures", () => {
    const song = songs[3]!;
    const next = songs[7]!;
    const swap = swapBar(song, createRng(1));
    const play = morphArrange(song, swap, next);
    const theirs = (bar: number) => incomingArrange(next)((bar - swap + 64) % 4).drums;
    expect(play(swap - DRUM_SWAP_BARS - 1)).toEqual(arrangeBar(song, swap - DRUM_SWAP_BARS - 1));
    for (let bar = swap - DRUM_SWAP_BARS; bar < swap; bar++) {
      const { drums, notes } = play(bar);
      const own = arrangeBar(song, bar);
      const tops = (hits: typeof drums) =>
        hits.filter((h) => ["hat", "openhat", "tamb", "cabasa"].includes(h.voice));
      if (bar >= swap - DRUM_SWAP_BARS / 2) expect(drums).toEqual(theirs(bar));
      else expect(tops(drums)).toEqual(tops(theirs(bar)));
      // Past the swap, no drums: the incoming song's carry on as they were.
      expect(play(swap + ((bar - swap + DRUM_SWAP_BARS) % 4)).drums).toEqual([]);
      expect(notes.lead).toEqual([]);
      expect(notes.bass).toEqual(own.notes.bass);
      expect(notes.arp).toEqual(bar < swap - DRUM_SWAP_BARS / 2 ? own.notes.arp : []);
    }
  });

  it("switches the kit and each differing patch on bars of their own, well before the swap", () => {
    let staggered = 0;
    for (const a of songs.slice(0, 12))
      for (const b of songs.slice(12, 24)) {
        const at = morphSwitches(a, b);
        const [x, y] = [deckSound(a), deckSound(b)];
        expect(at.kit !== undefined).toBe(
          x.kit !== y.kit ||
            x.drums.gatedSnare !== y.drums.gatedSnare ||
            x.drums.kickWeight !== y.drums.kickWeight,
        );
        for (const [k, bar] of Object.entries(at)) {
          if (k !== "kit")
            expect(x.voices[k as keyof typeof x.voices]).not.toBe(
              y.voices[k as keyof typeof y.voices],
            );
          expect(bar).toBeLessThanOrEqual(MORPH_BARS - DRUM_SWAP_BARS - 4);
        }
        if (new Set(Object.values(at)).size > 1) staggered++;
      }
    expect(staggered).toBeGreaterThan(0);
  });

  it("brings a new kit in under full level where it switches, rising to full", () => {
    const pair = songs
      .flatMap((a) => songs.map((b) => [a, b] as const))
      .find(([a, b]) => deckSound(a).kit !== deckSound(b).kit)!;
    const [a, b] = pair;
    const swap = swapBar(a, createRng(1));
    const kitBar = swap - MORPH_BARS + morphSwitches(a, b).kit!;
    const play = morphArrange(a, swap, b);
    const peak = (bar: number) => Math.max(0, ...play(bar).drums.map((h) => h.vel));
    const own = (bar: number) => Math.max(0, ...arrangeBar(a, bar).drums.map((h) => h.vel));
    if (own(kitBar) > 0) expect(peak(kitBar)).toBeLessThan(own(kitBar));
    expect(play(kitBar + KIT_RAMP_BARS)).toEqual(arrangeBar(a, kitBar + KIT_RAMP_BARS));
    // The sound: its kit before that bar, the next song's from it.
    const sound = morphSound(a, b, swap);
    expect(sound(kitBar - 1).kit).toBe(deckSound(a).kit);
    expect(sound(kitBar).kit).toBe(deckSound(b).kit);
  });

  it("glides the sound from the song's to the next one's over the window", () => {
    const [a, b] = [
      songs.find((s) => s.genre === "synthpop")!,
      songs.find((s) => s.genre !== "synthpop")!,
    ];
    const swap = 100;
    const sound = morphSound(a, b, swap);
    expect(sound(swap - MORPH_BARS - 1)).toEqual(deckSound(a));
    const end = sound(swap - 1);
    const want = deckSound(b);
    expect([end.volumes, end.bassTone, end.leadTone, end.kit]).toEqual([
      want.volumes,
      want.bassTone,
      want.leadTone,
      want.kit,
    ]);
    for (const k of ["riffPatch", "stabPatch", "arpPatch", "countervoice", "padTone"] as const) {
      expect(end.voices[k]).toBe(want.voices[k]);
    }
    const half = soundBetween(deckSound(a), deckSound(b), 0.5);
    const [x, y] = [deckSound(a).bassTone.sawCutoff, deckSound(b).bassTone.sawCutoff];
    expect(half.bassTone.sawCutoff).toBeCloseTo((x + y) / 2);
    // Each bar a small step: no fader moves more than a dB per bar.
    for (let bar = swap - MORPH_BARS; bar < swap; bar++) {
      const [p, q] = [sound(bar - 1).volumes, sound(bar).volumes];
      for (const t of Object.keys(p) as (keyof typeof p)[]) {
        expect(Math.abs(q[t] - p[t])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("measures how far apart two blends are", () => {
    expect(blendDistance({ "true-faith": 1 }, { "true-faith": 2 })).toBe(0);
    expect(blendDistance({ "true-faith": 1 }, { faces: 1 })).toBe(1);
    expect(blendDistance({ "true-faith": 0.5, faces: 0.5 }, { faces: 1 })).toBeCloseTo(0.5);
  });

  it("is auto's pick only when the next song is close", () => {
    for (const a of songs)
      for (const b of songs) {
        const style = autoTransition(a, b, a.key, a.bpm);
        if (style === "morph") {
          expect(b.genre).toBe(a.genre);
          expect(Math.abs(b.bpm - a.bpm)).toBeLessThanOrEqual(a.bpm * 0.03);
        }
        if (a.genre !== b.genre) expect(style).toBe("crossfade");
      }
    const close = songs.find((s) =>
      songs.some((t) => t !== s && autoTransition(s, t, s.key, s.bpm) === "morph"),
    );
    expect(close).toBeDefined();
  });
});
