/**
 * The Euro-disco planner (Innocent Love, Heaven Can Wait, Crazy Juliet): kept as it was when cross-genre blending arrived (docs/plans/cross-genre-blend.md), so
 * songs within one genre stay exactly what they were. Blends that span genres use the merged
 * planner (planner.ts) instead. Change nothing here that would move a single-genre song.
 */
import type { Layers, Progressions, Section, SectionKind, SongEnding, SongForm } from "../composer";
import { LAYERS_OFF, placeSections, type PlannedSection } from "../form";
import type { Blend, GenreAt } from "../genres";
import type { Progression } from "../progressions";
import type { Rng } from "../rng";
import type { Key } from "../theory";

/**
 * The Euro-disco form (docs/plans/euro-disco-genre.md), from the three Sandra records:
 * - an opening, one of three: Crazy Juliet's staggered entries over the verse chords (pads and the
 *   sequence, then 16th hats and the bass, then the kit without the bass), Heaven Can Wait's solo
 *   synth motif then 4 bars of drums and bass alone, or Innocent Love's pads on i and v over 16th
 *   hats (no kick, no bass), then ♭VI–♭VII, then the bass alone;
 * - verse (16 or 8 bars; Heaven Can Wait's bare), pre-chorus (its progression's length, ending on a
 *   stop bar for Innocent Love and Crazy Juliet), chorus (its progression's length: 10 or 14 bars),
 *   then a 2-bar tag on i (Heaven Can Wait) or a 2-bar stop on ♭VII (Innocent Love);
 * - the second verse, pre-chorus and chorus;
 * - the second half, one of three: a chorus and two instrumental choruses with the lead synth
 *   (Crazy Juliet); an instrumental chorus ending in a 2-bar break on V without bass (Heaven Can
 *   Wait); or a 4-bar link with the kick on every beat, a verse without voice and the pre-chorus
 *   (Innocent Love), who may add a chorus and a 10-bar bridge;
 * - choruses back to back, and the chorus to fade all three records end on.
 */
export function planEuro(
  rng: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
): Section[] {
  const odds = g.genre.euro;
  if (!odds) throw new Error(`${g.genre.id} has no Euro-disco form odds`);
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
  const chance = (b: Blend) => rng.chance(g.at(b));
  /** One of several options, in proportion to their blends (the fallback when all are 0). */
  const pickOne = <T extends string>(options: readonly (readonly [T, Blend])[], fallback: T): T => {
    const weighted = options.map(([k, b]) => [k, g.at(b)] as const).filter(([, w]) => w > 0);
    return weighted.length ? rng.weighted(weighted) : fallback;
  };
  const short = form === "short";
  const major = key.mode === "major";
  const tonic = major ? "I" : "i";
  /** `bars` bars of a progression from bar `from`, round and round. */
  const slice = (prog: Progression, from: number, bars: number): Progression =>
    Array.from({ length: bars }, (_, i) => prog[(from + i) % prog.length] ?? [tonic]);

  const opening = pickOne(
    [
      ["staggered", odds.staggeredIntro],
      ["motif", odds.motifIntro],
      ["pads", odds.padIntro],
    ],
    "pads",
  );
  const verseBars = short ? 8 : chance(odds.longVerse) ? 16 : 8;
  const bare = chance(odds.bareVerse);
  const stop = chance(odds.stop);
  const afterFirst = pickOne(
    [
      ["tag", odds.tag],
      ["stop", odds.chorusStop],
      ["straight", odds.straight],
    ],
    "straight",
  );
  const secondHalf = pickOne(
    [
      ["lead", odds.leadChoruses],
      ["instrumental", odds.instrumentalChorus],
      ["block", odds.instrumentalBlock],
    ],
    "instrumental",
  );
  const bridge = !short && chance(odds.bridge);
  const verseArp = chance(odds.verseArp);
  const chorusArp = chance(odds.chorusArp);
  const chorusRiff = chance(odds.chorusRiff);
  const stabs = chance(odds.stabs);
  const stack = chance(odds.stack);
  const pre: Progression =
    p.prechorus ?? (major ? [["IV"], ["IV"], ["V"], ["V"]] : [["iv"], ["VI"], ["VII"], ["V"]]);
  // A chorus lasts as long as its progression: Crazy Juliet's 10 bars, the others' 14.
  const chorusBars = Math.min(16, Math.max(8, p.chorus.length));

  const verse = (label: string, extra: Partial<Layers> = {}) =>
    add("verse", label, verseBars, p.verse, {
      drums: "full",
      bass: true,
      pad: !bare,
      lead: "verse",
      arp: verseArp,
      ...extra,
    });
  // Pads come in (Heaven Can Wait's verse has none), and a 16th part where the song has one.
  const preChorus = (extra: Partial<Layers> = {}) =>
    add("prechorus", "Pre-chorus", Math.min(8, Math.max(2, pre.length)), pre, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      arp: verseArp || chorusArp,
      ...(stop ? { stop: true } : {}),
      ...extra,
    });
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, chorusBars, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: chorusArp,
      riff: chorusRiff,
      stabs,
      ...(stack ? { leadStack: true } : {}),
      ...extra,
    });
  // Heaven Can Wait's tag keeps the chorus kit on i, the voice gone; Innocent Love's stop holds
  // ♭VII over a hat on the beats, without bass.
  const afterChorus = (which: typeof afterFirst) => {
    if (which === "tag")
      add("chorus", "Tag", 2, [[tonic]], { drums: "big", bass: true, pad: true, arp: chorusArp });
    else if (which === "stop") add("break", "Stop", 2, [["VII"]], { drums: "half", pad: true });
  };

  if (opening === "staggered") {
    add("intro", "Intro", 4, slice(p.verse, 0, 4), { pad: true, riff: true });
    add("intro", "Intro · hats and bass", 2, slice(p.verse, 4, 2), {
      drums: "hats16",
      bass: true,
      pad: true,
      riff: true,
    });
    add("intro", "Intro · kit", 2, slice(p.verse, 6, 2), { drums: "full", pad: true, riff: true });
  } else if (opening === "motif") {
    add("intro", "Intro · motif", 4, [[tonic]], { riff: true });
    add("intro", "Groove", 4, p.verse, { drums: "full", bass: true });
  } else {
    add("intro", "Intro", short ? 4 : 8, [[tonic], [tonic], ["v"], ["v"]], {
      drums: "hats16",
      pad: true,
      arp: true,
    });
    add("intro", "Intro · climb", 4, [["VI"], ["VII"]], { drums: "hats16", pad: true, arp: true });
    add("intro", "Link", 2, [[tonic], ["VII"]], { bass: true });
  }
  verse("Verse 1");
  preChorus();
  chorus("Chorus");
  afterChorus(afterFirst);
  verse("Verse 2");
  preChorus();
  chorus("Chorus");
  if (afterFirst === "stop") afterChorus("stop");
  if (!short) {
    if (secondHalf === "lead") {
      chorus("Chorus");
      for (let i = 0; i < 2; i++)
        chorus("Instrumental chorus", { lead: null, leadStack: false, leadSynth: true });
    } else if (secondHalf === "instrumental") {
      add("chorus", "Instrumental chorus", Math.max(4, chorusBars - 2), p.chorus, {
        drums: "big",
        bass: true,
        pad: true,
        arp: true,
        stabs,
      });
      add("break", "Break", 2, [["V"], ["V"]], { drums: "full", pad: true });
    } else {
      add("interlude", "Instrumental link", 4, slice(p.verse, 0, 4), {
        drums: "groove",
        bass: true,
        pad: true,
        leadSynth: true,
      });
      verse("Instrumental verse", { lead: null, leadSynth: true });
      preChorus({ lead: null });
    }
    if (bridge) {
      chorus("Chorus");
      add("bridge", "Bridge", Math.min(16, p.bridge.length), p.bridge, {
        drums: "big",
        bass: true,
        pad: true,
        lead: "chorus",
        stabs,
        ...(stack ? { leadStack: true } : {}),
        ...(stop ? { stop: true } : {}),
      });
    }
    if (form === "long") chorus("Chorus");
  }
  chorus("Chorus · last");
  if (ending === "hold") {
    add("outro", "Ending · IV held", 4, [["IV"]], { pad: true });
  } else if (ending === "lift") {
    add(
      "outro",
      "Outro · lift to IV",
      16,
      p.lift,
      { drums: "full", bass: true, pad: true, riff: true, arp: true },
      liftKey,
    );
  } else {
    add("outro", "Outro · chorus to fade", chorusBars, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      arp: chorusArp,
      riff: chorusRiff,
      stabs,
      ...(stack ? { leadStack: true } : {}),
    });
  }
  return placeSections(plan, rng);
}
