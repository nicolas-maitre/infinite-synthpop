import { describe, expect, it } from "vitest";
import { arrangeBar, MELODIC_TRACKS } from "./arranger";
import { compose, COUNTER_RANGE, LEAD_RANGES } from "./composer";
import { bassTone, GENRES } from "./genres";
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
    expect(bassTone(SYNTHPOP, 0)).toEqual({ frequency: 240, presence: 7, sawCutoff: 2500 });
    expect(bassTone(SYNTHPOP, 1)).toEqual({ frequency: 160, presence: 1, sawCutoff: 300 });
    expect(bassTone(SYNTHPOP, 0.35)).toEqual({
      frequency: 240 - 80 * 0.35,
      presence: 7 - 6 * 0.35,
      sawCutoff: 2500 - 2200 * 0.35,
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
