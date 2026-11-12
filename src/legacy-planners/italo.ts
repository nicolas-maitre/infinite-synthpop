/**
 * The Italo planner (The Night, Get Closer, Faces, Self Control): kept as it was when cross-genre blending arrived (docs/plans/cross-genre-blend.md), so
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
 * The Italo form (docs/plans/italo-genre.md), in 16-bar blocks (8 in a short song):
 * - an opening, one of three: The Night's tonic pedal (i │ ♭VII/i with the arpeggio, then the riff
 *   alone), Faces' build (bass and kick, then gated stabs, then the groove), or Get Closer's
 *   instrumental hook on the verse loop;
 * - verse and chorus; the first verse may run without bass (Faces);
 * - an 8-bar instrumental after the first chorus (Faces; Get Closer's hook reprise);
 * - a second verse, or The Night's instrumental with the lead synth in its place;
 * - a second chorus; then The Night's reprise (the pedal block, a short verse, a chorus) or, in a
 *   long song, a third verse and chorus;
 * - a breakdown without bass or voice and an instrumental with the lead synth (Faces, Get
 *   Closer's 12″);
 * - a last chorus, and the chorus to fade all three records end on.
 * Self Control's devices (branigan-self-control.md §2.1) draw from their own random stream, so at
 * its weight 0 a song is what it was: its opening (pad on i7, then the riff and the bass in unison
 * on i–v), a pre-chorus with the title line before the first chorus, a 4-bar break after each
 * chorus (one stab on beat 2, the voice) with 2 bars of drums and voice after the first, a
 * half-length second verse, stacked voices in the choruses, and an i–v vamp to fade in place of the
 * last chorus, the riff back for its second half.
 * The kick never stops: every section has the drums.
 */
export function planItalo(
  rng: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  g: GenreAt,
  form: SongForm,
): Section[] {
  const odds = g.genre.italo;
  if (!odds) throw new Error(`${g.genre.id} has no Italo form odds`);
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
  const short = form === "short";
  const block = short ? 8 : 16;
  const tonic = key.mode === "major" ? "I" : "i";
  const pedal: Progression = [[tonic], ["VII/i"]];
  const vamp: Progression = [[tonic], [key.mode === "major" ? "V" : "v"]];
  // Self Control's choices.
  const rngSc = rng.fork("self-control");
  const scChance = (b: Blend) => rngSc.chance(g.at(b));
  const preChorus = scChance(odds.preChorus);
  const stabBreak = scChance(odds.stabBreak);
  const halfVerse = scChance(odds.halfVerse);
  const backing = scChance(odds.backing);
  const vampOutro = ending === "fade" && scChance(odds.vampOutro);

  const openings = (
    [
      ["pedal", g.at(odds.pedalIntro)],
      ["build", g.at(odds.buildIntro)],
      ["hook", g.at(odds.hookIntro)],
      ["riff", g.at(odds.riffIntro)],
    ] as const
  ).filter(([, w]) => w > 0);
  const opening = openings.length ? rng.weighted(openings) : "hook";
  const stabs = chance(odds.stabs);
  const verseArp = chance(odds.verseArp);
  const bareFirstVerse = chance(odds.bareFirstVerse);
  const afterChorus = !short && chance(odds.afterChorus);
  const leadSection = chance(odds.leadSection);
  const reprise = !short && chance(odds.reprise);
  const breakdown = !short && chance(odds.breakdown);

  // The Night's opening (bars 1–6, again at 87–96): pads on the pedal, then the riff alone without
  // pads, then the riff again with the bass dropped out.
  const pedalBlock = (label: string) => {
    add("intro", label, 4, pedal, { drums: "full", bass: true, pad: true });
    add("intro", "Intro · riff", 4, pedal, { drums: "full", bass: true, riff: true });
    add("intro", "Intro · bass drop", 2, pedal, { drums: "full", riff: true });
  };
  // The Night's lead synth: 12 bars over the verse loop after each intro block, before the voice.
  const leadSynth = (label: string, bars: number) =>
    add("interlude", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      leadSynth: true,
    });
  // The Night's plucked countervoice plays in every chorus and nowhere else.
  const countervoice = g.voices.countervoice !== "none";
  // Faces' verse world: stabs instead of pads, which the chorus brings in. Self Control's verse
  // line plays over the pads.
  const glockLine = g.voices.stabPatch === "glockenspiel";
  const verseWorld: Partial<Layers> = stabs && !glockLine ? { pad: false, held: true } : {};
  const verse = (label: string, bars: number, extra: Partial<Layers> = {}) =>
    add("verse", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      arp: verseArp,
      stabs,
      ...verseWorld,
      ...extra,
    });
  const chorus = (label: string, extra: Partial<Layers> = {}) =>
    add("chorus", label, block, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      lead: "chorus",
      stabs,
      // No 16th part in any of the three records' choruses: their motion is the countervoice's.
      arp: false,
      counter: countervoice,
      ...(backing ? { leadStack: true } : {}),
      ...extra,
    });
  // Self Control's break: the voice over one reverbed stab on beat 2 of each bar; after the first
  // chorus, 2 bars of the kit and the voice.
  const breakBlock = (first: boolean) => {
    add("break", "Break · stab on 2", 4, vamp, {
      drums: "stab",
      bass: true,
      stabs: true,
      lead: "chorus",
    });
    if (first) add("break", "Drums and voice", 2, vamp, { drums: "full", lead: "chorus" });
  };
  // Faces' instrumentals keep the verse world, its sustained line on top; the others play the
  // riff (Get Closer's 16th line).
  const instrumental = (label: string, bars: number) =>
    add("interlude", label, bars, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      riff: !stabs,
      arp: !stabs,
      stabs,
      ...verseWorld,
    });

  // After the pedal block, The Night's lead synth (bars 7–22), else 4 bars of the loop.
  const afterPedal = () => {
    if (leadSection) leadSynth("Lead synth", short ? 8 : 12);
    else add("intro", "Intro · loop", 4, p.verse, { drums: "full", bass: true, pad: true });
  };
  if (opening === "pedal") {
    pedalBlock("Intro · pedal");
    afterPedal();
  } else if (opening === "build") {
    add("intro", "Intro · bass and kick", 4, p.verse, { drums: "kick", bass: true });
    add("intro", "Intro · stabs", 8, p.verse, { drums: "kick", bass: true, stabs: true });
    add("intro", "Intro · groove", short ? 8 : 16, p.verse, {
      drums: "full",
      bass: true,
      stabs: true,
      held: true,
    });
  } else if (opening === "riff") {
    // Self Control: a pad on i7 over the percussion, then the riff in unison with the bass.
    add("intro", "Intro · pad", 4, [[key.mode === "major" ? "I" : "i7"]], {
      drums: "half",
      pad: true,
    });
    add("intro", "Intro · riff", 4, vamp, { drums: "full", bass: true, riff: true });
  } else {
    // Get Closer: 8 bars of drums, bass and pads, then the hook with its 16th line.
    add("intro", "Intro", short ? 4 : 8, p.verse, { drums: "full", bass: true, pad: true });
    add("intro", "Hook", block, p.verse, { drums: "full", bass: true, pad: true, riff: true });
  }
  verse("Verse 1", block, bareFirstVerse ? { bassHeld: true } : {});
  if (preChorus) {
    add("prechorus", "Pre-chorus · title line", block, p.verse, {
      drums: "full",
      bass: true,
      pad: true,
      lead: "verse",
      titleLine: true,
      // Its 16ths in pairs (branigan-self-control.md §12).
      arp: true,
      stabs,
      ...verseWorld,
    });
  }
  chorus("Chorus");
  if (stabBreak) breakBlock(true);
  if (afterChorus) instrumental("Instrumental", 8);
  verse("Verse 2", halfVerse ? block / 2 : block);
  chorus("Chorus");
  if (reprise) {
    // The Night's second half: the pedal block and the lead synth again, a verse, a chorus.
    pedalBlock("Reprise · pedal");
    afterPedal();
    verse("Verse 3", block);
    chorus("Chorus");
  } else if (form === "long") {
    verse("Verse 3", block);
    chorus("Chorus");
  }
  if (breakdown) {
    add("break", "Breakdown", 16, p.interlude, { drums: "full", pad: true, arp: true });
    instrumental("Instrumental", rng.pick([8, 16]));
  }
  // Self Control fades on the i–v vamp straight after its second chorus and break; after a
  // breakdown the song still needs its last chorus.
  if (!vampOutro || breakdown) chorus("Chorus · last", { leadDouble: true });
  if (vampOutro) {
    if (stabBreak) breakBlock(false);
    // The riff comes back for the vamp's second half (branigan-self-control.md §12).
    const outro = (label: string, riff: boolean) =>
      add("outro", label, 8, vamp, {
        drums: "big",
        bass: true,
        pad: true,
        stabs,
        riff,
        lead: "chorus",
        counter: countervoice,
      });
    outro("Outro · i–v vamp", false);
    outro("Outro · vamp and riff", true);
  } else if (ending === "hold") {
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
    add("outro", "Outro · chorus to fade", 16, p.chorus, {
      drums: "big",
      bass: true,
      pad: true,
      stabs,
      // A chorus to fade: the countervoice carries on to the end (Get Closer's outro).
      counter: countervoice,
    });
  }
  return placeSections(plan, rng);
}
