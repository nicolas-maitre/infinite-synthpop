/**
 * The synthpop planner (True Faith, The Different Story, You Came): kept as it was when cross-genre blending arrived (docs/plans/cross-genre-blend.md), so
 * songs within one genre stay exactly what they were. Blends that span genres use the merged
 * planner (planner.ts) instead. Change nothing here that would move a single-genre song.
 */
import type { Layers, Progressions, Section, SectionKind, SongEnding, SongForm } from "../composer";
import { intoTonic, LAYERS_OFF, placeSections, type PlannedSection } from "../form";
import type { Blend, GenreAt } from "../genres";
import type { Progression } from "../progressions";
import type { Rng } from "../rng";
import type { Key } from "../theory";

export function planSections(
  rng: Rng,
  rngYc: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
  chorusRiff: boolean,
): Section[] {
  const plan: PlannedSection[] = [];
  const add = (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey = key,
  ) =>
    plan.push({
      kind,
      label,
      bars,
      progression,
      key: sectionKey,
      layers: { ...LAYERS_OFF, ...layers },
    });

  const odds = g.genre.form;
  const chance = (b: Blend) => rng.chance(g.at(b));
  const tonic = key.mode === "major" ? "I" : "i";
  // You Came's blocks (analysis §7.2), decided up front from their own stream.
  const yc = (b: Blend) => rngYc.chance(g.at(b));
  const preChorus = yc(odds.preChorus) && !!p.prechorus;
  const stack = yc(odds.stack);
  const straightOn = yc(odds.straightOn);
  const breakdown = yc(odds.breakdown);
  const instrumental16 = yc(odds.instrumental16);
  const stabs = () => chance(odds.stabs);
  // TF's sequenced chord synth plays the figure from the intro to the end of the song.
  // TF's high sequencer comes in after the first chorus and plays to the end (MIDI: bar 46 on).
  const useSeq = chance(odds.seq);
  // TF's rhythm guitar: choruses, instrumentals and the outro (MIDI: never in the verses).
  const guitar = chance(odds.guitar);
  let seq = false;
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, 8, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: rng.chance(0.5),
      stabs: stabs(),
      seq,
      guitar,
      ...(stack ? { leadStack: true } : {}),
      ...(chorusRiff ? { riff: true } : {}),
      ...extra,
    });
  // You Came: the verse turns to the tonic in its last bar, pushed into the pre-chorus.
  const verse = (label: string, bars: number, extra: Partial<Layers> = {}) => {
    add("verse", label, bars, preChorus ? intoTonic(p.verse, bars, tonic) : p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      seq,
      ...extra,
    });
    if (preChorus && p.prechorus) {
      add("prechorus", "Pre-chorus", Math.min(8, p.prechorus.length), p.prechorus, {
        drums: "full",
        bass: true,
        pad: true,
        arp: true,
        lead: "verse",
        seq,
      });
    }
  };
  // DS: interlude, the Dorian ii–IV turnaround, then a 2-bar break on the tonic.
  const dsBlock = () => {
    add("interlude", "Interlude", 8, p.interlude, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      hook: chance(odds.interludeHook),
      arp: rng.chance(0.5),
    });
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
      arp: true,
    });
    if (rng.chance(0.7)) {
      add("break", "Break", 2, [[tonic]], { drums: "kick", riff: true, pad: true });
    }
  };
  // TF: the band plays the chorus chords instrumentally, riff and melodic bass on top.
  // TF's way into a verse (MIDI bars 45–46): two staccato bars on VI–VII, the second resting until
  // the bass's pickup run (see bassLine).
  const tfTurn = () => {
    if (!chance(odds.turn)) return;
    add("turnaround", "Turn · VI–VII", 2, [["VI"], ["VII"]], {
      drums: "full",
      bass: true,
      bassShort: true,
      pad: true,
      seq,
      guitar,
    });
  };
  // The melodic bass (Peter Hook's part) never plays under a verse: in the TF MIDI it's in the
  // intro, the bridge solo, the instrumentals and the outro only, and DS has none.
  const tfInstrumental = (label: string, bars: number) =>
    add("interlude", label, bars, p.chorus, {
      drums: "full",
      bass: true,
      seq,
      guitar,
      pad: true,
      riff: true,
      hook: chance(odds.instrumentalHook),
    });

  // Both songs open with drums + bass, then an instrumental over the chorus chords.
  add("intro", "Intro", 4, p.chorus, {
    drums: chance(odds.introGroove) ? "groove" : chance(odds.introKick) ? "kick" : "full",
    bass: true,
    hook: chance(odds.introHook),
  });
  add("intro", "Intro · riff", rng.pick([8, 8, 12]), p.chorus, {
    drums: "full",
    bass: true,
    pad: true,
    riff: true,
    hook: chance(odds.riffIntroHook),
    arp: chance(odds.riffIntroArp),
  });
  const verseBars = form === "short" ? 8 : rng.chance(0.8) ? 16 : 8;
  verse("Verse 1", verseBars);
  chorus("Chorus");
  seq = useSeq;
  if (straightOn) {
    // You Came: straight on to verse 2.
  } else if (chance(odds.dsBlock)) dsBlock();
  else {
    tfInstrumental("Instrumental", 8);
    tfTurn();
  }
  verse("Verse 2", verseBars === 16 && rng.chance(0.5) ? 16 : 8);
  chorus("Chorus", { arp: true });
  if (form === "short") {
    // Straight on to the final choruses.
  } else if (breakdown) {
    // You Came (2:22): a breakdown verse over the loop's first two chords with no bass and no
    // snare, then a 4-bar bridge into the last choruses.
    add("verse", "Breakdown", 8, p.chorus.slice(0, 2), {
      drums: "breakdown",
      pad: true,
      lead: "verse",
    });
    add("bridge", "Bridge", 4, p.bridge, { drums: "breakdown", pad: true, lead: "verse" });
  } else if (chance(odds.dsBlock)) {
    dsBlock();
  } else {
    // TF: a turnaround on VI, the i–IV vamp with the melodic-bass solo, an instrumental chorus.
    add("turnaround", "Turnaround", p.turnaround.length > 2 ? 4 : 2, p.turnaround, {
      drums: "full",
      bass: true,
      pad: true,
    });
    add("bridge", "Bridge · bass solo", 8, p.bridge, {
      drums: "full",
      bass: true,
      pad: true,
      hook: true,
    });
    tfInstrumental("Instrumental chorus", 8);
  }
  if (form === "long" || (form === "standard" && chance(odds.thirdVerse))) {
    tfTurn();
    verse("Verse 3", rng.chance(0.5) ? 16 : 8);
  }
  chorus("Chorus");
  if (instrumental16) {
    // You Came (3:18): a break without bass or voice, then an instrumental, both on 16th hats,
    // the riff joining for its second half.
    add("break", "Break", 8, p.chorus.slice(0, 2), { drums: "hats16", pad: true });
    add("interlude", "Instrumental", 8, p.chorus, { drums: "hats16", bass: true, pad: true });
    add("interlude", "Instrumental · riff", 8, p.chorus, {
      drums: "full",
      bass: true,
      pad: true,
      riff: true,
    });
  }
  chorus("Chorus · double", { leadDouble: true, arp: true });
  if (form === "long" || (form === "standard" && chance(odds.extraChorus)))
    chorus("Chorus", { leadDouble: true });
  if (ending === "hold") {
    // You Came (4:23): the loop's IV held to the end.
    add("outro", "Ending · IV held", 4, [["IV"]], { pad: true, riff: chorusRiff });
  } else if (ending === "lift") {
    // TF: the chorus's IV becomes the new tonic.
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      {
        drums: "full",
        bass: true,
        bassShort: guitar,
        pad: true,
        riff: true,
        hook: true,
        guitar,
        seq,
      },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", 16, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      guitar,
      lead: "chorus",
      riff: rng.chance(0.5),
      arp: true,
    });
  }

  return placeSections(plan, rng);
}
