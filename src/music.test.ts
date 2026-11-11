import { describe, expect, it } from "vitest";
import { arrangeBar, MELODIC_TRACKS } from "./arranger";
import { compose, COUNTER_RANGE, LEAD_RANGES } from "./composer";
import {
  bassTone,
  genreAt,
  genreOfReference,
  GENRE_IDS,
  GENRES,
  referenceWeights,
  specWeights,
  styleName,
} from "./genres";
import { REFERENCES, type ReferenceId } from "./references";
import { resolveQuality } from "./quality";
import { barAtSeconds, barSeconds, silentWav, songSeconds } from "./mediasession";
import { italoTitle, synthpopTitle } from "./titles";
import { songToMidi } from "./export";
import { matchTracks, parseMidi, toBars, toDrumBars, type MidiFile } from "./midi";
import { Library, LIBRARY_KEY } from "./library";
import { scheduleBar, scheduleStep, type Player } from "./schedule";
import { blankSpec, decodeCreation, encodeCreation, songToSpec } from "./spec";
import { assignMelody, currentMelody, importMelody, writeMelody } from "./melodies";
import { mutate, pickProgression } from "./progressions";

const SYNTHPOP = GENRES.synthpop;
const BANK = SYNTHPOP.bank;
const BPM_RANGE = SYNTHPOP.tempo.range;
import { createRng } from "./rng";
import { chord, chordName, chordPitchClasses, mod12, scaleForChord, voiceChord } from "./theory";

const D_MINOR = { tonic: 2, mode: "minor" } as const;
const E_MINOR = { tonic: 4, mode: "minor" } as const;

describe("theory", () => {
  it("spells the measured choruses: TF's major IV vs DS's minor iv", () => {
    expect(["i", "III", "VII", "IV"].map((n) => chordName(D_MINOR, chord(n)))).toEqual([
      "Dm",
      "F",
      "C",
      "G",
    ]);
    expect(["i", "III", "VII", "iv"].map((n) => chordName(E_MINOR, chord(n)))).toEqual([
      "Em",
      "G",
      "D",
      "Am",
    ]);
  });

  it("spells DS's Dorian turnaround", () => {
    expect(["ii", "IV"].map((n) => chordName(E_MINOR, chord(n)))).toEqual(["F♯m", "A"]);
  });

  it("spells The Different Story verse in E minor, with the major V", () => {
    expect(["i", "VI", "VII", "V"].map((n) => chordName(E_MINOR, chord(n)))).toEqual([
      "Em",
      "C",
      "D",
      "B",
    ]);
    expect(chordPitchClasses(E_MINOR, chord("V"))).toEqual([11, 3, 6]);
  });

  it("raises the leading tone only over a major V, and the 6th over Dorian IV / ii", () => {
    expect(scaleForChord(D_MINOR, chord("V"))).toContain(1); // C♯
    expect(scaleForChord(D_MINOR, chord("v"))).toContain(0); // C
    expect(scaleForChord(D_MINOR, chord("IV"))).toContain(11); // B♮
    expect(scaleForChord(D_MINOR, chord("iv"))).toContain(10); // B♭
    // You Came's E major: V/ii's E♯ (F) replaces E, V/vi's B♯ (C) replaces B, the borrowed v's
    // D♮ replaces D♯.
    const eMajor = { tonic: 4, mode: "major" } as const;
    expect(scaleForChord(eMajor, chord("V/ii"))).toContain(5);
    expect(scaleForChord(eMajor, chord("V/ii"))).not.toContain(4);
    expect(scaleForChord(eMajor, chord("V7/vi"))).toContain(0);
    expect(scaleForChord(eMajor, chord("V7/vi"))).not.toContain(11);
    expect(scaleForChord(eMajor, chord("v"))).toContain(2);
    expect(scaleForChord(eMajor, chord("v"))).not.toContain(3);
    expect(chordName(eMajor, chord("I/3"))).toBe("E/G♯");
    expect(chordName(eMajor, chord("Vsus4/vi"))).toBe("G♯sus4");
  });

  it("voices chords around the centre", () => {
    const v = voiceChord([2, 5, 9], 62);
    expect(v).toHaveLength(3);
    expect(v.map(mod12).sort()).toEqual([2, 5, 9]);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(12);
  });
});

describe("progressions", () => {
  it("always opens a chorus or verse on the tonic", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed);
      for (const kind of ["chorus", "verse"] as const) {
        const p = mutate(
          SYNTHPOP,
          pickProgression(SYNTHPOP, kind, (seed % 5) / 4, rng),
          kind,
          (seed % 5) / 4,
          rng,
          1,
        );
        expect(p[0]).toEqual(["i"]);
      }
    }
  });

  it("prefers True Faith entries at style 0 and Different Story entries at style 1", () => {
    const count = (style: number, name: string) => {
      const target = BANK.chorus.find((e) => e.name === name)?.bars;
      const rng = createRng(1);
      let n = 0;
      for (let i = 0; i < 500; i++)
        if (pickProgression(SYNTHPOP, "chorus", style, rng) === target) n++;
      return n;
    };
    expect(count(0, "TF chorus (MIDI)")).toBeGreaterThan(count(1, "TF chorus (measured)") * 3);
    expect(count(1, "DS chorus (measured)")).toBeGreaterThan(count(0, "DS chorus (measured)") * 3);
  });
});

describe("genre profile", () => {
  it("keeps the measured bass tone at both ends of synthpop", () => {
    expect(bassTone(SYNTHPOP, 0)).toEqual({
      frequency: 240,
      presence: 7,
      sawCutoff: 2500,
      octave: 0,
      sustain: 0.2,
    });
    expect(bassTone(SYNTHPOP, 1)).toEqual({
      frequency: 160,
      presence: 1,
      sawCutoff: 300,
      octave: 0,
      sustain: 0.2,
    });
    expect(bassTone(SYNTHPOP, 0.35)).toEqual({
      frequency: 240 - 80 * 0.35,
      presence: 7 - 6 * 0.35,
      sawCutoff: 2500 - 2200 * 0.35,
      octave: 0,
      sustain: 0.2,
    });
    // You Came's: darker than TF's, with the octave layer.
    expect(bassTone(SYNTHPOP, [0, 0, 1])).toEqual({
      frequency: 180,
      presence: 2,
      sawCutoff: 600,
      octave: 1,
      sustain: 0.35,
    });
  });
});

describe("compose", () => {
  it("is deterministic for a seed", () => {
    expect(compose({ seed: 42, style: 0.5 })).toEqual(compose({ seed: 42, style: 0.5 }));
    expect(compose({ seed: 42, style: 0.5 }).title).not.toEqual(
      compose({ seed: 43, style: 0.5 }).title,
    );
  });

  it("keeps the form stable when only the key changes", () => {
    const a = compose({ seed: 7, style: 0.2 });
    const b = compose({ seed: 7, style: 0.2, key: E_MINOR });
    expect(b.sections.map((s) => [s.label, s.bars])).toEqual(
      a.sections.map((s) => [s.label, s.bars]),
    );
  });

  it("picks a style per song when none is given, and keeps an override", () => {
    const styles = Array.from({ length: 40 }, (_, seed) => compose({ seed }).style);
    expect(new Set(styles).size).toBeGreaterThan(20);
    expect(Math.min(...styles)).toBeLessThan(0.2);
    expect(Math.max(...styles)).toBeGreaterThan(0.8);
    expect(compose({ seed: 5 })).toEqual(compose({ seed: 5, style: null }));
    expect(compose({ seed: 5, style: 0.3 }).style).toBe(0.3);
  });

  it("plans a contiguous song in the expected tempo range", () => {
    for (let seed = 0; seed < 50; seed++) {
      const song = compose({ seed, style: seed / 50 });
      expect(song.bpm).toBeGreaterThanOrEqual(BPM_RANGE[0]);
      expect(song.bpm).toBeLessThanOrEqual(BPM_RANGE[1]);
      let bar = 0;
      for (const s of song.sections) {
        expect(s.startBar).toBe(bar);
        bar += s.bars;
      }
      expect(song.totalBars).toBe(bar);
      expect(song.sections.filter((s) => s.kind === "chorus").length).toBeGreaterThanOrEqual(3);
      expect(song.sections[0]?.progression).toBe(song.progressions.chorus);
      expect(song.sections.at(-1)?.fade).toBe(true);
    }
  });

  it("writes diatonic melodies that mostly land on chord tones", () => {
    let total = 0;
    let chordTones = 0;
    for (let seed = 0; seed < 40; seed++) {
      const song = compose({ seed, style: 0.5 });
      for (const kind of ["verse", "chorus"] as const) {
        const prog = song.progressions[kind];
        song.melodies[kind].bars.forEach((bar, b) =>
          bar.forEach((n) => {
            const numerals = prog[b % prog.length] ?? [];
            const c = chord(numerals[numerals.length > 1 && n.step >= 8 ? 1 : 0] ?? "i");
            expect(scaleForChord(song.key, c)).toContain(mod12(n.midi));
            total++;
            if (chordPitchClasses(song.key, c).includes(mod12(n.midi))) chordTones++;
          }),
        );
      }
    }
    // The analysis measured ~64% chord tones in True Faith.
    expect(chordTones / total).toBeGreaterThan(0.45);
    expect(chordTones / total).toBeLessThan(0.9);
  });
});

describe("arrangeBar", () => {
  it("anticipates the next chord on 4a and ties it over the bar line", () => {
    for (let seed = 0; seed < 20; seed++) {
      const song = compose({ seed, style: seed / 19 });
      const verse = song.sections.find((s) => s.kind === "verse");
      if (!verse) continue;
      const bar = arrangeBar(song, verse.startBar);
      const next = arrangeBar(song, verse.startBar + 1);
      const last = bar.notes.bass.at(-1);
      expect(last?.step).toBe(15);
      expect((last?.midi ?? 0) % 12).toBe(
        (next.key.tonic + (next.chords[0]?.chord.root ?? 0)) % 12,
      );
      // Tied over: the next bar doesn't strike its downbeat, it re-strikes on 1e.
      expect(next.notes.bass[0]?.step).toBe(1);
    }
  });

  it("plays the bass figure: 8ths on the root, the hiccup on beat 4, the tie on 4a", () => {
    const figure = [1, 2, 4, 6, 8, 10, 12, 13, 15];
    for (let seed = 0; seed < 20; seed++) {
      const song = compose({ seed, style: seed / 19 });
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        if (!ev.section.layers.bass) continue;
        const steps = ev.notes.bass.map((n) => n.step).filter((s) => s !== 0);
        // TF's pickup run into a verse rests until beat 4 (tested below).
        if (ev.section.layers.bassShort && steps[0] === 12) continue;
        expect(steps).toEqual(figure);
        for (const n of ev.notes.bass) {
          expect(n.midi).toBeGreaterThanOrEqual(31);
          expect(n.midi).toBeLessThanOrEqual(46);
        }
      }
    }
  });

  it("fades out over the last bars of the song", () => {
    const song = compose({ seed: 3, style: 0.5 });
    const loud = arrangeBar(song, song.totalBars - 9);
    const quiet = arrangeBar(song, song.totalBars - 1);
    const peak = (ev: typeof loud) =>
      Math.max(0, ...ev.drums.map((h) => h.vel), ...ev.notes.pad.map((n) => n.vel));
    expect(peak(quiet)).toBeLessThan(peak(loud) * 0.3);
  });

  it("produces sane events for every bar of many songs", () => {
    for (let seed = 0; seed < 25; seed++) {
      const song = compose({ seed, style: (seed % 5) / 4 });
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        for (const track of MELODIC_TRACKS) {
          for (const n of ev.notes[track]) {
            expect(n.step).toBeGreaterThanOrEqual(0);
            expect(n.step).toBeLessThan(16);
            expect(n.dur).toBeGreaterThan(0);
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(100);
            expect(n.vel).toBeGreaterThan(0);
            expect(n.vel).toBeLessThanOrEqual(1);
          }
        }
        const keys = ev.drums.map((h) => `${h.voice}@${h.step}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const h of ev.drums) {
          expect(h.step).toBeGreaterThanOrEqual(0);
          expect(h.step).toBeLessThan(16);
        }
      }
    }
  }, 30_000);
});

describe("counter-line", () => {
  it("plays above the sung chorus, in TF's choruses only", () => {
    const tf = compose({ seed: 1987, style: 0.5, reference: "true-faith" });
    for (const section of tf.sections) {
      const notes = Array.from({ length: section.bars }, (_, b) =>
        arrangeBar(tf, section.startBar + b),
      ).flatMap((ev) => ev.notes.counter);
      if (section.kind !== "chorus") {
        expect(notes).toEqual([]);
        continue;
      }
      expect(notes.length).toBeGreaterThan(section.bars);
      for (const n of notes) {
        expect(n.midi).toBeGreaterThanOrEqual(COUNTER_RANGE[0]);
        expect(n.midi).toBeLessThanOrEqual(COUNTER_RANGE[1]);
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const lead = Array.from({ length: section.bars }, (_, b) =>
        arrangeBar(tf, section.startBar + b),
      ).flatMap((ev) => ev.notes.lead.map((n) => n.midi));
      expect(mean(notes.map((n) => n.midi))).toBeGreaterThan(mean(lead) + 7);
    }
  });

  it("loops with a 4-bar chorus and holds long notes", () => {
    const tf = compose({ seed: 1987, style: 0.5, reference: "true-faith" });
    const bars = tf.counter.bars;
    expect(bars).toHaveLength(8);
    expect(bars.slice(4)).toEqual(bars.slice(0, 4));
    expect(bars.flat().some((n) => n.dur >= 6)).toBe(true);
  });

  it("comes with most TF-style songs and few DS-style ones", () => {
    const share = (style: number) =>
      Array.from({ length: 40 }, (_, seed) => compose({ seed, style })).filter((song) =>
        song.sections.some((s) => s.layers.counter),
      ).length / 40;
    expect(share(0)).toBeGreaterThan(0.6);
    expect(share(1)).toBeLessThan(0.4);
    for (let seed = 0; seed < 40; seed++) {
      const song = compose({ seed, style: 0 });
      for (const s of song.sections) {
        if (s.layers.counter) expect(s.kind === "chorus" || s.kind === "outro").toBe(true);
      }
    }
  });
});

describe("references", () => {
  it("lays out both originals at their measured key, tempo and length", () => {
    const tf = compose({ seed: 1987, style: 0.5, reference: "true-faith" });
    const ds = compose({ seed: 1989, style: 0.5, reference: "different-story" });
    expect(tf.key).toEqual({ tonic: 2, mode: "minor" });
    expect(ds.key).toEqual({ tonic: 4, mode: "minor" });
    expect(tf.bpm).toBe(117);
    expect(ds.bpm).toBe(119.8);
    // TF: the MIDI transcription's ~173 bars; DS: 112 measured, rounded to whole phrases.
    expect(Math.abs(tf.totalBars - 173)).toBeLessThanOrEqual(2);
    expect(Math.abs(ds.totalBars - 112)).toBeLessThanOrEqual(2);
    expect(tf.sections.at(-1)?.key).toEqual({ tonic: 7, mode: "major" });
    expect(tf.sections.at(-1)?.fade).toBe(true);
  });

  it("lays out You Came's album version in E major at 119 BPM", () => {
    const yc = compose({ seed: 1988, reference: "you-came" });
    expect(yc.key).toEqual({ tonic: 4, mode: "major" });
    expect([yc.bpm, yc.kit, yc.bassStyle, yc.totalBars]).toEqual([119, "linndrum", "yc", 135]);
    expect(yc.weights).toEqual([0, 0, 1]);
    // The record ends on IV.
    expect(yc.sections.at(-1)?.progression).toEqual([["IV"]]);
    for (let bar = 0; bar < yc.totalBars; bar++) {
      const ev = arrangeBar(yc, bar);
      // The hats never play the "e" outside the break and the instrumental's 16ths.
      if (ev.section.layers.drums !== "hats16") {
        for (const h of ev.drums) if (h.voice === "hat") expect(Math.round(h.step) % 4).not.toBe(1);
      }
      for (const track of MELODIC_TRACKS) {
        for (const n of ev.notes[track]) expect(Number.isFinite(n.midi)).toBe(true);
      }
    }
  });

  it("plays You Came's bass: the pushed tonic, the ii's octaves and the v's walk", () => {
    const yc = compose({ seed: 1988, reference: "you-came" });
    const pre = yc.sections.find((s) => s.label === "Pre-chorus 1");
    if (!pre) throw new Error("no pre-chorus");
    const bass = (bar: number) => arrangeBar(yc, bar).notes.bass.map((n) => n.midi);
    // B1 B1 B1, then E2 an 8th early, dropping to E1 on beat 4.
    expect(bass(pre.startBar - 1)).toEqual([35, 35, 35, 40, 40, 40, 28, 28]);
    expect(bass(pre.startBar + 1)).toEqual([30, 30, 42, 30, 30, 30, 42, 30]);
    expect(bass(pre.startBar + 3)).toEqual([35, 35, 37, 37, 35, 35, 33, 32]);
  });

  it("gives You Came's weight nothing to do from the slider", () => {
    expect(compose({ seed: 9, style: 0.3 })).toEqual(compose({ seed: 9, weights: [0.7, 0.3, 0] }));
  });

  it("plays a legacy style as the weights [1 − style, style, 0], exactly", () => {
    // Saved settings from before the weights hold only a style; they now go in as these weights.
    for (const seed of [1, 9, 4242])
      for (const style of [0, 0.05, 0.15, 0.3, 0.37, 0.5, 0.65, 0.93, 1]) {
        const weights = referenceWeights(SYNTHPOP, style);
        expect(weights).toEqual([1 - style, style, 0]);
        expect(compose({ seed, weights })).toEqual(compose({ seed, style }));
      }
  });

  it("picks a point of the triangle per song when the weights are auto", () => {
    const songs = Array.from({ length: 60 }, (_, seed) => compose({ seed, weights: "auto" }));
    expect(compose({ seed: 5, weights: "auto" })).toEqual(songs[5]);
    // Each reference leads some songs, and the weights are hundredths that add up.
    const leads = new Set(songs.map((s) => s.weights.indexOf(Math.max(...s.weights))));
    expect(leads).toEqual(new Set([0, 1, 2]));
    for (const { weights } of songs) {
      expect(weights.reduce((a, b) => a + Math.round(b * 100), 0)).toBe(100);
      expect(weights.map((w) => Math.round(w * 100) / 100)).toEqual(weights);
    }
    // A point is not a style: auto weights don't change the legacy auto style's songs.
    expect(compose({ seed: 5 })).toEqual(compose({ seed: 5, style: null, weights: null }));
  });

  it("plays TF's pickup run into verse 2 and its drum groove in the intro", () => {
    const tf = compose({ seed: 1987, style: 0.5, reference: "true-faith" });
    const verse2 = tf.sections.find((s) => s.label === "Verse 2");
    if (!verse2) throw new Error("no Verse 2");
    // MIDI bar 46: three beats' rest, then C2 G2 A2 → D2.
    expect(arrangeBar(tf, verse2.startBar - 1).notes.bass.map((n) => [n.step, n.midi])).toEqual([
      [12, 36],
      [13, 43],
      [14, 45],
      [15, 38],
    ]);
    const intro = arrangeBar(tf, 0).drums;
    expect(intro.filter((h) => h.voice === "kick").map((h) => h.step)).toEqual([
      0, 4, 8, 12, 13, 14, 15,
    ]);
  });

  it("ignores the key, tempo and kit settings, and arranges every bar", () => {
    const song = compose({
      seed: 1,
      style: 1,
      key: { tonic: 0, mode: "minor" },
      bpm: 130,
      kit: "dmx",
      reference: "true-faith",
    });
    expect([song.key.tonic, song.bpm, song.kit, song.bassStyle]).toEqual([2, 117, "sp12", "tf"]);
    for (let bar = 0; bar < song.totalBars; bar++) {
      const ev = arrangeBar(song, bar);
      for (const track of MELODIC_TRACKS) {
        for (const n of ev.notes[track]) expect(Number.isFinite(n.midi)).toBe(true);
      }
    }
  });
});

describe("midi", () => {
  it("reads note events, running status and track names into bars of 16ths", () => {
    const bytes = (...b: number[]) => b;
    const vlq = (n: number) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);
    const name = [...new TextEncoder().encode("Synth Lead")];
    // 96 ticks per beat: a 16th is 24 ticks, a bar 384.
    const events = [
      ...bytes(0, 0xff, 0x03, name.length, ...name),
      ...bytes(0, 0x90, 62, 100), // D4 on at 0
      ...vlq(48),
      ...bytes(62, 0), // running status, velocity 0 = off after an 8th
      ...vlq(384 - 48 + 24),
      ...bytes(0x90, 69, 64), // A4 on at bar 1, step 1
      ...vlq(24),
      ...bytes(0x80, 69, 0),
      ...bytes(0, 0xff, 0x2f, 0),
    ];
    const file = new Uint8Array([
      ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 96],
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length],
      ...events,
    ]);
    const midi = parseMidi(file.buffer);
    expect(midi.ticksPerBeat).toBe(96);
    expect(midi.tracks.map((t) => t.name)).toEqual(["Synth Lead"]);
    const bars = toBars(midi.tracks[0]!, midi.ticksPerBeat);
    expect(bars[0]?.map((n) => [n.step, n.dur, n.midi])).toEqual([[0, 2, 62]]);
    expect(bars[1]?.map((n) => [n.step, n.dur, n.midi])).toEqual([[1, 1, 69]]);
  });
});

describe("midi mapping", () => {
  const track = (name: string, channel: number, midi: number) => ({
    name,
    channel,
    notes: [{ tick: 0, duration: 24, midi, velocity: 100 }],
  });
  // True Faith's MIDI transcription, as the user supplied it.
  const file: MidiFile = {
    ticksPerBeat: 96,
    tracks: [
      track("Guitar (Bernard Sumner)", 6, 60),
      track("Bass (Peter Hook)", 3, 50),
      track("Sequence Bass (Gillian Gilbert)", 10, 38),
      track("Synth Strings (Gillian Gilbert)", 2, 62),
      track("Sequence (Gillian Gilbert)", 4, 69),
      track("Synth Lead (Gillian Gilbert)", 7, 76),
      track("Synth Pad (Gillian Gilbert)", 1, 62),
      track("Drumkit", 9, 36),
      track("Drumkit", 9, 42),
    ],
  };

  it("matches each instrument to the right track by name", () => {
    expect(matchTracks(file)).toEqual({
      drums: [7, 8],
      bass: [2],
      hook: [1],
      counter: [5],
      guitar: [0],
      seq: [4],
      pad: [3],
    });
  });

  it("keeps a lead track pitched where a voice sings on the lead", () => {
    const sung: MidiFile = { ticksPerBeat: 96, tracks: [track("Lead vocal", 0, 66)] };
    expect(matchTracks(sung)).toEqual({ lead: [0] });
    const high: MidiFile = { ticksPerBeat: 96, tracks: [track("Melody", 0, 80)] };
    expect(matchTracks(high)).toEqual({ counter: [0] });
  });

  it("maps General MIDI drum keys to the drum machine", () => {
    const bars = toDrumBars(file.tracks.slice(7), file.ticksPerBeat);
    expect(bars[0]?.map((h) => h.voice)).toEqual(["kick", "hat"]);
  });

  it("lets imported parts replace or silence generated ones", () => {
    const song = compose({ seed: 1987, style: 0.5, reference: "true-faith" });
    song.imported = {
      notes: { bass: [[{ step: 0, dur: 4, midi: 38, vel: 1 }]], riff: [] },
      drums: [[{ voice: "kick", step: 0, vel: 1 }]],
    };
    const bar0 = arrangeBar(song, 0);
    expect(bar0.notes.bass).toEqual([{ step: 0, dur: 4, midi: 38, vel: 1 }]);
    expect(bar0.drums).toEqual([{ voice: "kick", step: 0, vel: 1 }]);
    const instrumental = song.sections.find((s) => s.layers.riff);
    if (!instrumental) throw new Error("no riff section");
    expect(arrangeBar(song, instrumental.startBar).notes.riff).toEqual([]);
  });
});

/** Every note and hit of every bar, for comparing two songs. */
function arrangement(song: ReturnType<typeof compose>): string {
  return JSON.stringify(
    Array.from({ length: song.totalBars }, (_, bar) => {
      const ev = arrangeBar(song, bar);
      return [ev.drums, Object.values(ev.notes)];
    }),
  );
}

describe("creator specs", () => {
  it("turns a song into a spec that plays the same, and survives the link encoding", () => {
    for (const seed of [3, 2001, 4242]) {
      const song = compose({ seed, style: seed === 2001 ? 0.15 : 0.6 });
      const spec = songToSpec(song);
      const again = compose({ seed, style: 0, custom: spec });
      expect(arrangement(again)).toBe(arrangement(song));
      const decoded = decodeCreation(encodeCreation({ seed, spec }));
      expect(decoded?.seed).toBe(seed);
      expect(arrangement(compose({ seed, style: 0, custom: decoded?.spec }))).toBe(
        arrangement(song),
      );
    }
  });

  it("keeps a creation's weights through the link, so You Came's details survive", () => {
    const yc = compose({ seed: 1988, reference: "you-came" });
    const weighted = compose({ seed: 3, weights: [0.12, 0.18, 0.7] });
    for (const song of [yc, weighted]) {
      const spec = songToSpec(song);
      expect(spec.weights).toEqual(song.weights);
      const link = encodeCreation({ seed: song.seed, spec });
      const decoded = decodeCreation(link);
      expect(decoded?.spec.weights).toEqual(song.weights);
      const again = compose({ seed: song.seed, custom: decoded?.spec });
      expect(again.weights).toEqual(song.weights);
      expect(arrangement(again)).toBe(arrangement(compose({ seed: song.seed, custom: spec })));
    }
    // From the original: You Came's drums (beat-&-a hats, no gate) and bass tone.
    const fromYc = compose({
      seed: 1988,
      custom: decodeCreation(encodeCreation({ seed: 1988, spec: songToSpec(yc) }))?.spec,
    });
    expect(genreAt(SYNTHPOP, fromYc.weights).drums).toEqual(SYNTHPOP.drumTraits["you-came"]);
    expect(bassTone(SYNTHPOP, fromYc.weights).octave).toBe(1);
    expect(fromYc.riffHigh).toBe(yc.riffHigh);
  });

  it("decodes an old link (style only) to the weights [1 − st, st, 0]", () => {
    const song = compose({ seed: 2001, style: 0.15 });
    const link = encodeCreation({ seed: 2001, spec: songToSpec(song) });
    // A style song's weights say nothing more: the link stays in the old form.
    expect(link).not.toContain(btoa('"w":').slice(0, 3));
    const decoded = decodeCreation(link);
    expect(decoded?.spec.weights).toBeUndefined();
    expect(specWeights(SYNTHPOP, decoded!.spec)).toEqual([0.85, 0.15, 0]);
    expect(compose({ seed: 2001, custom: decoded?.spec }).weights).toEqual([0.85, 0.15, 0]);
  });

  it("rejects malformed weights in a link and falls back to the style", () => {
    const spec = songToSpec(compose({ seed: 3, style: 0.4 }));
    for (const w of [[-1, 0, 2], [0, 0, 0], ["x", 1, 0], [0.2, 0.3, 0.5, 0.1], "1,0,0"]) {
      const json = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(encodeCreation({ seed: 3, spec }).replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        ),
      ) as Record<string, unknown>;
      json.w = w;
      const bytes = new TextEncoder().encode(JSON.stringify(json));
      const link = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const decoded = decodeCreation(link);
      expect(decoded?.spec.weights).toBeUndefined();
      expect(compose({ seed: 3, custom: decoded?.spec }).weights).toEqual([0.6, 0.4, 0]);
    }
  });

  it("writes an edited section its own melody and keeps the others'", () => {
    const song = compose({ seed: 77, style: 0.5 });
    const spec = songToSpec(song);
    const verses = spec.sections.flatMap((s, i) => (s.kind === "verse" ? [i] : []));
    const [edited, other] = verses;
    if (edited === undefined || other === undefined) throw new Error("need two verses");
    spec.sections[edited]!.progression = [["iv"], ["VII"], ["III"], ["VI"]];
    const changed = compose({ seed: 77, style: 0.5, custom: spec });
    expect(changed.sectionMelodies[edited]).not.toBe(changed.melodies.verse);
    expect(changed.sectionMelodies[other]).toBe(changed.melodies.verse);
  });

  it("rejects garbage links and keeps only known chords", () => {
    expect(decodeCreation("not-a-song")).toBeNull();
    const spec = blankSpec();
    spec.sections[0]!.progression = [["i", "VII"], ["IV"]];
    const decoded = decodeCreation(encodeCreation({ seed: 1, spec }));
    expect(decoded?.spec.sections[0]?.progression).toEqual([["i", "VII"], ["IV"]]);
  });
});

describe("titles", () => {
  it("gives each genre its own vocabulary, decided by the seed", () => {
    expect(italoTitle(createRng(7).fork("title"))).toBe(italoTitle(createRng(7).fork("title")));
    const italo = new Set(
      Array.from({ length: 400 }, (_, seed) => italoTitle(createRng(seed).fork("title"))),
    );
    const synthpop = new Set(
      Array.from({ length: 400 }, (_, seed) => synthpopTitle(createRng(seed).fork("title"))),
    );
    // Plenty of variety, and the two genres barely overlap.
    expect(italo.size).toBeGreaterThan(250);
    expect([...italo].filter((t) => synthpop.has(t)).length).toBeLessThan(5);
    for (const t of italo) {
      expect(t).not.toMatch(/\b(\w+) in the \1\b/);
      expect(t).not.toMatch(/^(\w+) \1$/);
    }
  });

  it("titles synthpop songs from the synthpop list", () => {
    expect(compose({ seed: 42, style: 0.5 }).title).toBe(
      synthpopTitle(createRng(42).fork("title")),
    );
  });
});

describe("system media controls", () => {
  it("gives each song a length and maps the scrubber to its bars", () => {
    const song = { bpm: 120, totalBars: 100 };
    expect(barSeconds(song)).toBe(2);
    expect(songSeconds(song)).toBe(200);
    expect(barAtSeconds(song, 0)).toBe(0);
    expect(barAtSeconds(song, 1.99)).toBe(0);
    expect(barAtSeconds(song, 2)).toBe(1);
    expect(barAtSeconds(song, 199.9)).toBe(99);
    expect(barAtSeconds(song, 500)).toBe(99);
    expect(barAtSeconds(song, -3)).toBe(0);
    const real = compose({ seed: 42, style: 0.5 });
    expect(barAtSeconds(real, 17 * barSeconds(real))).toBe(17);
  });

  it("writes ten seconds of silence as a valid WAV", async () => {
    const wav = new Uint8Array(await silentWav().arrayBuffer());
    const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual([
      "RIFF",
      "WAVE",
      "fmt ",
      "data",
    ]);
    expect(wav.length).toBe(44 + 80_000);
    expect(wav.slice(44).every((b) => b === 128)).toBe(true);
  });
});

describe("performance setting", () => {
  it("lets the URL win, then the saved choice, then the device", () => {
    expect(resolveQuality(null, "auto", "lite")).toBe("lite");
    expect(resolveQuality(null, "auto", "full")).toBe("full");
    expect(resolveQuality(null, "full", "lite")).toBe("full");
    expect(resolveQuality(null, "lite", "full")).toBe("lite");
    expect(resolveQuality("full", "lite", "lite")).toBe("full");
    expect(resolveQuality("lite", "full", "full")).toBe("lite");
    expect(resolveQuality("bogus", "full", "lite")).toBe("full");
  });
});

describe("genres in links", () => {
  /** A link's JSON, changed and re-encoded. */
  const relink = (link: string, change: (json: Record<string, unknown>) => void) => {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(link.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    ) as Record<string, unknown>;
    change(json);
    const bytes = new TextEncoder().encode(JSON.stringify(json));
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };

  it("lists every reference in exactly one genre", () => {
    for (const id of Object.keys(REFERENCES) as ReferenceId[]) {
      expect(GENRE_IDS.filter((g) => GENRES[g].references.includes(id))).toEqual([
        genreOfReference(id),
      ]);
    }
  });

  it("leaves synthpop out of links and specs, as before genres", () => {
    const song = compose({ seed: 5, weights: [0.2, 0.3, 0.5] });
    expect(song.genre).toBe("synthpop");
    const spec = songToSpec(song);
    expect(spec.genre).toBeUndefined();
    const link = encodeCreation({ seed: 5, spec });
    expect(relink(link, () => {})).toBe(link);
    let hasG = true;
    relink(link, (json) => (hasG = "g" in json));
    expect(hasG).toBe(false);
  });

  it("reads a named genre, and refuses one it doesn't know", () => {
    const link = encodeCreation({ seed: 5, spec: songToSpec(compose({ seed: 5, style: 0.3 })) });
    const named = decodeCreation(relink(link, (json) => (json.g = "synthpop")));
    expect(named?.spec.genre).toBeUndefined();
    expect(compose({ seed: 5, custom: named?.spec }).genre).toBe("synthpop");
    expect(decodeCreation(relink(link, (json) => (json.g = "italo-from-the-future")))).toBeNull();
    expect(decodeCreation(relink(link, (json) => (json.g = "toString")))).toBeNull();
  });

  it("plays a creation in its genre and an original in the one that lists it", () => {
    expect(compose({ seed: 1, reference: "you-came" }).genre).toBe(genreOfReference("you-came"));
    const spec = { ...songToSpec(compose({ seed: 2, style: 0.5 })), genre: "synthpop" as const };
    expect(compose({ seed: 2, custom: spec }).genre).toBe("synthpop");
  });
});

describe("italo genre", () => {
  const italo = GENRES.italo;
  const corners = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const;

  it("writes songs in 4-, 8-, 12- and 16-bar blocks (The Night's 2-bar drop) that never drop the kick", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const song = compose({ seed, genre: "italo", weights: "auto" });
      expect(song.genre).toBe("italo");
      expect(song.key.mode).toBe("minor");
      expect(song.bpm).toBeGreaterThanOrEqual(108);
      expect(song.bpm).toBeLessThanOrEqual(122);
      expect(["italo", "night", "faces"]).toContain(song.bassStyle);
      for (const s of song.sections) {
        expect(s.layers.drums).not.toBe("off");
        expect([2, 4, 8, 12, 16]).toContain(s.bars);
      }
      expect(song.sections.at(-1)?.label).toBe("Outro · chorus to fade");
      // Every bar arranges, chords and all.
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        expect(ev.drums.some((h) => h.voice === "kick")).toBe(true);
      }
    }
  });

  it("follows each record's tempo, intro and bass at its corner", () => {
    const at = (weights: readonly number[], seed: number) =>
      compose({ seed, genre: "italo", weights });
    const tempo = (w: readonly number[]) =>
      Array.from({ length: 20 }, (_, i) => at(w, i + 1).bpm).reduce((a, b) => a + b) / 20;
    expect(tempo(corners[0])).toBeLessThan(113);
    expect(tempo(corners[2])).toBeGreaterThan(118);
    const intros = corners.map((w) => at(w, 7).sections[0]?.label);
    expect(intros).toEqual(["Intro · pedal", "Intro", "Intro · bass and kick"]);
    expect(corners.map((w) => at(w, 3).bassStyle)).toEqual(["night", "italo", "faces"]);
  });

  it("plays 8th hats, Faces' gallop in its choruses, and The Night without crashes or fills", () => {
    const night = compose({ seed: 4, genre: "italo", weights: corners[0] });
    const nightHits = Array.from({ length: night.totalBars }, (_, b) => arrangeBar(night, b).drums);
    expect(nightHits.flat().some((h) => h.voice === "crash" || h.voice.startsWith("tom"))).toBe(
      false,
    );
    const verseBar = night.sections.find((s) => s.kind === "verse")?.startBar ?? 0;
    const hats = arrangeBar(night, verseBar).drums.filter((h) => h.voice === "hat");
    expect(hats.every((h) => Math.round(h.step) % 2 === 0)).toBe(true);
    const claps = arrangeBar(night, verseBar).drums.filter((h) => h.voice === "clap");
    expect(claps.map((h) => h.step)).toEqual([4, 12]);

    const faces = compose({ seed: 4, genre: "italo", weights: corners[2] });
    const chorusBar = faces.sections.find((s) => s.kind === "chorus")?.startBar ?? 0;
    const gallop = arrangeBar(faces, chorusBar)
      .drums.filter((h) => h.voice === "hat")
      .map((h) => Math.round(h.step));
    expect(gallop.slice(0, 6)).toEqual([0, 1, 2, 4, 6, 7]);
  });

  it("puts Get Closer's pads over a bass of their own", () => {
    const song = compose({
      seed: 2,
      genre: "italo",
      weights: corners[1],
      progressions: { verse: [["i"], ["VII/i"], ["IV"], ["VI/VII"]] },
    });
    const verse = song.sections.find((s) => s.kind === "verse");
    if (!verse) throw new Error("no verse");
    const bar = (i: number) => arrangeBar(song, verse.startBar + i);
    // Bar 2: D major over E (E minor), bar 4: C over D.
    const pcs = (notes: readonly { midi: number }[]) => new Set(notes.map((n) => mod12(n.midi)));
    expect(pcs(bar(1).notes.bass)).toEqual(new Set([mod12(song.key.tonic)]));
    expect(pcs(bar(1).notes.pad)).toEqual(
      new Set([10, 2, 5].map((i) => mod12(song.key.tonic + i))),
    );
    expect(pcs(bar(3).notes.bass)).toEqual(new Set([mod12(song.key.tonic + 10)]));
    expect(bar(0).notes.bass.map((n) => n.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("gives Get Closer its echo hook and chorus arpeggio, and The Night its lead synth, riff and countervoice", () => {
    const gc = compose({ seed: 7, genre: "italo", weights: corners[1] });
    const hook = gc.sections.find((s) => s.label === "Hook");
    if (!hook) throw new Error("no hook");
    // Short dry figures in D4–B4 on beats 3–4 of bar 1 and beat 4 of bar 3; the echo does the rest.
    const hookBar = (i: number) => arrangeBar(gc, hook.startBar + i).notes.riff;
    expect(hookBar(0).length).toBeGreaterThanOrEqual(4);
    expect(hookBar(0).every((n) => n.step >= 8 && n.dur < 1)).toBe(true);
    expect(hookBar(1)).toEqual([]);
    expect(hookBar(2).map((n) => n.step)).toEqual([12, 13, 14, 15]);
    expect(hookBar(3)).toEqual([]);
    const hookNotes = [0, 2].flatMap(hookBar).map((n) => n.midi);
    expect(Math.min(...hookNotes)).toBeGreaterThanOrEqual(59);
    expect(Math.max(...hookNotes)).toBeLessThanOrEqual(74);
    // The chorus countervoice: 8ths from beat 2 in C6–B6, in every chorus and the outro only.
    for (const s of gc.sections) {
      const counter = arrangeBar(gc, s.startBar).notes.counter;
      if (s.kind === "chorus" || s.kind === "outro") {
        expect(counter.map((n) => n.step)).toEqual([4, 6, 8, 10, 12, 14]);
        // Roots within a tritone of D6, so the line keeps to about octave 6.
        expect(counter.every((n) => n.midi >= 79 && n.midi <= 104)).toBe(true);
      } else expect(counter).toEqual([]);
    }
    // No 16th part in the chorus.
    const chorus = gc.sections.find((s) => s.kind === "chorus");
    expect(arrangeBar(gc, chorus?.startBar ?? 0).notes.arp).toEqual([]);

    const tn = compose({ seed: 7, genre: "italo", weights: corners[0] });
    expect(tn.sections.slice(0, 6).map((s) => [s.label, s.bars])).toEqual([
      ["Intro · pedal", 4],
      ["Intro · riff", 4],
      ["Intro · bass drop", 2],
      ["Lead synth", 12],
      ["Verse 1", 16],
      ["Chorus", 16],
    ]);
    // The lead synth plays on its own track, in E♭4–C5-ish phrases with rests, never under the voice.
    const synth = tn.sections.find((s) => s.label === "Lead synth");
    if (!synth) throw new Error("no lead synth");
    const bars = Array.from({ length: synth.bars }, (_, i) => arrangeBar(tn, synth.startBar + i));
    expect(bars.every((b) => b.notes.lead.length === 0)).toBe(true);
    const played = bars.flatMap((b) => b.notes.synth);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((n) => n.midi >= 62 && n.midi <= 74)).toBe(true);
    expect(bars.filter((b) => b.notes.synth.length === 0).length).toBeGreaterThanOrEqual(3);
    // The two-note riff: the tonic and the 7th below it.
    const riff = tn.sections.find((s) => s.label === "Intro · riff");
    const pcs = new Set(
      arrangeBar(tn, riff?.startBar ?? 0).notes.riff.map((n) => mod12(n.midi - tn.key.tonic)),
    );
    expect(pcs).toEqual(new Set([0, 10]));
    // The countervoice in every chorus and the chorus to fade, on all the off-beat 8ths, nowhere else.
    for (const s of tn.sections) {
      const counter = arrangeBar(tn, s.startBar).notes.counter;
      if (s.kind !== "chorus" && s.kind !== "outro") expect(counter).toEqual([]);
      else
        expect(counter.filter((n) => n.step % 4 === 2).map((n) => n.step)).toEqual([2, 6, 10, 14]);
    }
  });

  it("keeps Faces' verses to plucked stabs, and brings open pads in for the chorus", () => {
    const song = compose({ seed: 5, genre: "italo", weights: corners[2] });
    const verse = song.sections.find((s) => s.kind === "verse");
    const chorus = song.sections.find((s) => s.kind === "chorus");
    if (!verse || !chorus) throw new Error("no verse or chorus");
    const v = arrangeBar(song, verse.startBar);
    expect(v.notes.pad).toEqual([]);
    // The stab: close three-note chords on every 8th in the verse, the "&"s only in the chorus.
    expect(new Set(v.notes.stab.map((n) => n.step))).toEqual(new Set([0, 2, 4, 6, 8, 10, 12, 14]));
    const c = arrangeBar(song, chorus.startBar);
    expect(new Set(c.notes.stab.map((n) => n.step))).toEqual(new Set([2, 6, 10, 14]));
    // The chorus pads: open, the root in octave 3 (A3 E4 A4 on A).
    const pad = c.notes.pad.map((n) => n.midi).sort((a, b) => a - b);
    expect(pad).toHaveLength(3);
    expect(pad[0]).toBeGreaterThanOrEqual(47);
    expect(pad[0]).toBeLessThan(59);
    expect((pad[2] ?? 0) - (pad[0] ?? 0)).toBeGreaterThanOrEqual(12);
    const intro = song.sections.find((s) => s.label === "Intro · groove");
    if (!intro) throw new Error("no groove intro");
    // The held line comes in at the instrumental's 9th bar.
    expect(arrangeBar(song, intro.startBar).notes.lead).toEqual([]);
    const line = arrangeBar(song, intro.startBar + 8).notes.lead;
    expect(line.length).toBeGreaterThan(0);
    expect(line.every((n) => n.midi >= 60 && n.midi <= 69)).toBe(true);
    // The chorus voice sits higher than the verse's.
    const mean = (m: { bars: { midi: number }[][] }) => {
      const all = m.bars.flat().map((n) => n.midi);
      return all.reduce((a, b) => a + b, 0) / all.length;
    };
    expect(mean(song.melodies.chorus) - mean(song.melodies.verse)).toBeGreaterThan(4);
  });

  it("plays Faces' bass on the beat, then off it, rolling into the next root on 4&", () => {
    const song = compose({ seed: 5, genre: "italo", weights: corners[2], bassStyle: "faces" });
    const verse = song.sections.find((s) => s.kind === "verse" && !s.layers.bassHeld);
    if (!verse) throw new Error("no verse with the figure");
    const steps = (i: number) => arrangeBar(song, verse.startBar + i).notes.bass.map((n) => n.step);
    expect(steps(2)).toEqual([4, 8, 12, 14]);
    expect(steps(3)).toEqual([2, 6, 10, 14]);
  });

  it("names its chords, and borrows their tones for the melodies", () => {
    const fMinor = { tonic: 5, mode: "minor" as const };
    expect(chordName(fMinor, chord("VII/i"))).toBe("E♭/F");
    expect(chordName(fMinor, chord("VI/3"))).toBe("D♭/F");
    expect(chordName(fMinor, chord("VII7sus4"))).toBe("E♭7sus4");
    expect(chordName(fMinor, chord("v7"))).toBe("Cm7");
    const aMinor = { tonic: 9, mode: "minor" as const };
    // Faces' A major chorus chord: C♯ takes C's place, the rest stays A minor.
    expect(scaleForChord(aMinor, chord("I")).map((pc) => mod12(pc))).toEqual([
      9, 11, 1, 2, 4, 5, 7,
    ]);
    // The Night's ♭II: G♭ takes G's place, the tonic stays.
    expect(scaleForChord(fMinor, chord("II"))).toContain(6);
    expect(scaleForChord(fMinor, chord("II"))).toContain(5);
  });

  it("travels in links, with its own weights", () => {
    const song = compose({ seed: 9, genre: "italo", weights: [0.2, 0.3, 0.5] });
    const spec = songToSpec(song);
    expect(spec.genre).toBe("italo");
    const back = decodeCreation(encodeCreation({ seed: 9, spec }));
    expect(back?.spec.genre).toBe("italo");
    expect(back?.spec.weights).toEqual([0.2, 0.3, 0.5]);
    expect(compose({ seed: 9, custom: back?.spec }).genre).toBe("italo");
  });

  it("names its references and keeps a bank for every progression kind", () => {
    expect(italo.references.map(styleName)).toEqual(["The Night", "Get Closer", "Faces"]);
    for (const kind of ["verse", "chorus", "interlude", "turnaround", "bridge", "lift"] as const) {
      expect(italo.bank[kind].length).toBeGreaterThan(0);
      for (const e of italo.bank[kind]) for (const bar of e.bars) for (const n of bar) chord(n);
    }
  });
});

describe("export", () => {
  it("writes a MIDI file whose tracks hold exactly the arrangement's notes", () => {
    const song = compose({ seed: 2001, style: 0.15 });
    const file = parseMidi(songToMidi(song).buffer);
    expect(file.ticksPerBeat).toBe(480);
    const count = (tracks: readonly string[]) => {
      let n = 0;
      for (let bar = 0; bar < song.totalBars; bar++) {
        const ev = arrangeBar(song, bar);
        for (const t of tracks) n += ev.notes[t as keyof typeof ev.notes].length;
      }
      return n;
    };
    const byName = Object.fromEntries(file.tracks.map((t) => [t.name, t.notes.length]));
    expect(byName["Seq bass"]).toBe(count(["bass"]));
    expect(byName["Lead"]).toBe(count(["lead", "leadOct"]));
    const drums = file.tracks.find((t) => t.name === "Drums");
    expect(drums?.channel).toBe(9);
    let hits = 0;
    for (let bar = 0; bar < song.totalBars; bar++) hits += arrangeBar(song, bar).drums.length;
    expect(drums?.notes.length).toBe(hits);
  });
});

describe("wizard options", () => {
  const verse = [["i"], ["iv"], ["VII"], ["III"]];
  const chorus = [["VI"], ["VII"], ["i"], ["i"]];
  it("uses the chosen progressions, length, ending and bass figure", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const opts = { seed, style: 0.5, progressions: { verse, chorus }, bassStyle: "ds" as const };
      const short = compose({ ...opts, form: "short", ending: "fade" });
      const long = compose({ ...opts, form: "long", ending: "lift" });
      for (const song of [short, long]) {
        expect(song.bassStyle).toBe("ds");
        for (const s of song.sections) {
          if (s.kind === "verse") expect(s.progression).toEqual(verse);
          if (s.kind === "chorus") expect(s.progression).toEqual(chorus);
        }
      }
      expect(short.totalBars).toBeLessThan(long.totalBars);
      expect(short.sections.some((s) => s.label === "Verse 3")).toBe(false);
      expect(long.sections.some((s) => s.label === "Verse 3")).toBe(true);
      expect(short.sections.at(-1)?.label).toContain("fade");
      expect(long.sections.at(-1)?.key.mode).toBe("major");
    }
  });

  it("leaves generated songs unchanged when no options are given", () => {
    const plain = compose({ seed: 42, style: 0.4 });
    const standard = compose({ seed: 42, style: 0.4, form: "standard" });
    expect(arrangement(standard)).toBe(arrangement(plain));
  });
});

describe("custom melodies", () => {
  it("shares a customised melody across the sections that played it, and survives the link", () => {
    const song = compose({ seed: 9, style: 0.5 });
    const spec = songToSpec(song);
    const verses = song.sections.flatMap((s, i) => (s.kind === "verse" ? [i] : []));
    const [first] = verses;
    if (first === undefined) throw new Error("no verse");
    const melody = currentMelody(song, first, "Mine");
    if (!melody) throw new Error("no melody");
    melody.notes = melody.notes.map((n) => ({ ...n, pitch: n.pitch + 2 }));
    const id = assignMelody(spec, song, first, melody);
    // Every verse that shared the generated melody now plays the custom one.
    for (const v of verses) {
      if (song.sectionMelodies[v] === song.sectionMelodies[first])
        expect(spec.sections[v]?.melody).toBe(id);
    }
    const edited = compose({ seed: 9, style: 0.5, custom: spec });
    const original = song.sectionMelodies[first]!.bars[0]!;
    const now = edited.sectionMelodies[first]!.bars[0]!;
    expect(now.map((n) => n.midi)).toEqual(original.map((n) => n.midi + 2));
    const decoded = decodeCreation(encodeCreation({ seed: 9, spec }));
    expect(arrangement(compose({ seed: 9, style: 0.5, custom: decoded?.spec }))).toBe(
      arrangement(edited),
    );
  });

  it("follows key changes, since pitches are stored relative to the tonic", () => {
    const song = compose({ seed: 9, style: 0.5 });
    const spec = songToSpec(song);
    const v = song.sections.findIndex((s) => s.kind === "verse");
    assignMelody(spec, song, v, currentMelody(song, v, "Mine")!);
    const up = structuredClone(spec);
    up.key = { ...up.key, tonic: (up.key.tonic + 3) % 12 };
    for (const s of up.sections) delete s.key;
    const a = compose({ seed: 9, style: 0.5, custom: spec }).sectionMelodies[v]!.bars[0]!;
    const b = compose({ seed: 9, style: 0.5, custom: up }).sectionMelodies[v]!.bars[0]!;
    // Up a minor third: every note 3 semitones higher, not 9 lower.
    expect(b.map((n) => n.midi)).toEqual(a.map((n) => n.midi + 3));
  });

  it("writes new melodies at the density asked for", () => {
    const song = compose({ seed: 12, style: 0.5 });
    const v = song.sections.findIndex((s) => s.kind === "verse");
    const perBar = (d: "sparse" | "busy") => {
      const m = writeMelody(song, v, "mid", d, 5, "x")!;
      return m.notes.length / m.bars;
    };
    expect(perBar("sparse")).toBeLessThanOrEqual(2.5);
    expect(perBar("busy")).toBeGreaterThan(perBar("sparse") + 1.5);
  });

  it("imports MIDI bars into the lead's register, one note per onset", () => {
    const track = {
      name: "Lead",
      channel: 0,
      notes: [
        { tick: 384 * 2, duration: 48, midi: 88, velocity: 100 },
        { tick: 384 * 2, duration: 48, midi: 84, velocity: 100 },
        { tick: 384 * 2 + 96, duration: 48, midi: 91, velocity: 100 },
        { tick: 384 * 5, duration: 48, midi: 40, velocity: 100 },
      ],
    };
    const m = importMelody(track, 96, 2, 2, { tonic: 0, mode: "minor" }, "verse", "x");
    expect(m.bars).toBe(2);
    expect(m.notes.map((n) => [n.bar, n.step])).toEqual([
      [0, 0],
      [0, 4],
    ]);
    const pitches = m.notes.map((n) => n.pitch);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBe(3);
    expect(Math.min(...pitches)).toBeGreaterThanOrEqual(LEAD_RANGES.verse[0] - 12);
  });
});

describe("live scheduling", () => {
  /** A player that writes down every note and hit it is given, with its time. */
  function recorder(): { player: Player; log: string[] } {
    const log: string[] = [];
    const player: Player = {
      drum: (hit, time) => log.push(`d ${hit.voice} ${time.toFixed(4)}`),
      play: (track, notes, barTime, sixteenth) => {
        for (const n of notes)
          log.push(`${track} ${n.midi} ${(barTime + n.step * sixteenth).toFixed(4)}`);
      },
    };
    return { player, log };
  }

  it("schedules a bar a 16th at a time exactly as it would all at once", () => {
    const song = compose({ seed: 4242, style: 0.5, key: null, bpm: null, kit: "auto" });
    const sixteenth = 60 / song.bpm / 4;
    for (const bar of [0, 9, 40, song.totalBars - 1]) {
      const ev = arrangeBar(song, bar);
      const whole = recorder();
      scheduleBar(whole.player, ev, 10, song.bpm);
      const steps = recorder();
      for (let k = 0; k < 16; k++) scheduleStep(steps.player, ev, 10 + k * sixteenth, sixteenth, k);
      expect(steps.log.sort()).toEqual(whole.log.sort());
      expect(whole.log.length).toBeGreaterThan(0);
    }
  });
});

describe("my songs", () => {
  function memoryStore(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    };
  }
  const song = compose({ seed: 77, style: 0.4, key: null, bpm: null, kit: "auto" });
  const creation = { seed: 77, spec: songToSpec(song) };

  it("keeps each creation as one entry, updated in place, and survives a reload", () => {
    const store = memoryStore();
    let now = 1000;
    const library = new Library(store, () => now);
    const first = library.save({ ...creation, id: "a" }, "summary");
    now = 2000;
    library.save({ ...creation, id: "a" }, "summary"); // unchanged: not bumped
    expect(library.get("a")?.updated).toBe(1000);
    library.save({ id: "a", seed: 77, spec: { ...creation.spec, title: "Renamed" } }, "summary");
    expect(library.list()).toHaveLength(1);
    expect(library.get("a")?.title).toBe("Renamed");
    expect(library.get("a")?.updated).toBe(2000);
    const reloaded = new Library(store);
    expect(reloaded.list().map((s) => s.id)).toEqual([first.id]);
    expect(reloaded.creation("a")?.spec.title).toBe("Renamed");
  });

  it("finds ♡-saved songs by origin and links by content, and can undo a delete", () => {
    const library = new Library(memoryStore());
    const saved = library.save(creation, "summary", "seed:77");
    expect(saved.id).toBeTruthy();
    expect(library.findFrom("seed:77")?.id).toBe(saved.id);
    expect(library.findData(encodeCreation(creation))?.id).toBe(saved.id);
    const gone = library.remove(saved.id);
    expect(library.list()).toHaveLength(0);
    if (gone) library.restore(gone);
    expect(library.list()).toHaveLength(1);
  });

  it("moves the single creation earlier versions kept into the list", () => {
    const store = memoryStore();
    store.setItem("old", encodeCreation(creation));
    const library = new Library(store);
    library.migrate("old", () => "summary");
    expect(library.list()).toHaveLength(1);
    expect(store.getItem("old")).toBeNull();
    expect(JSON.parse(store.getItem(LIBRARY_KEY) ?? "[]")).toHaveLength(1);
  });
});
