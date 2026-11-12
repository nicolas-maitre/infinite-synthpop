/**
 * The merged planner (docs/plans/cross-genre-blend.md): the form of a song whose song-part blend
 * spans genres. Single-genre songs keep their own planners (legacy-planners/).
 *
 * All three genres' forms share one skeleton:
 *
 *     opening → verse 1 (+ pre-chorus) → chorus → after the chorus → verse 2 (+ pre) → chorus
 *             → middle → [third verse and chorus] → late → last choruses and the ending
 *
 * Each slot draws a genre in proportion to its share of the blend, and that genre's own blocks
 * fill it, with its measured odds read at its own weights. The verses, pre-choruses and choruses
 * come from one "body" genre drawn once per song, so every verse and chorus of a song is dressed
 * alike whichever genre's blocks surround them. Every draw is on its own forked stream.
 *
 * The form decides where parts play; the parts' blends decide what they play. A layer some part
 * doesn't have (a stop bar without a backbeat kit, Self Control's stab break without its bass)
 * plays the way that part plays it.
 */
import type { Layers, Progressions, Section, SectionKind, SongEnding, SongForm } from "./composer";
import { intoTonic, LAYERS_OFF, placeSections, type PlannedSection } from "./form";
import { blend, type Blend, type Genre, type GenreId, type Voices } from "./genres";
import type { GenreShare, Profile } from "./profile";
import type { Progression } from "./progressions";
import type { Rng } from "./rng";
import type { Key } from "./theory";

/** What a genre's blocks build on: the song's facts and the shared section helpers. */
interface Ctx {
  key: Key;
  liftKey: Key;
  p: Progressions;
  form: SongForm;
  short: boolean;
  major: boolean;
  tonic: string;
  voices: Voices;
  /** The countervoice in the choruses, where the voice part has one. */
  counter: boolean;
  add: (
    kind: SectionKind,
    label: string,
    bars: number,
    progression: Progression,
    layers: Partial<Layers>,
    sectionKey?: Key,
  ) => void;
  /** The body genre's verse (with its pre-chorus) and chorus. */
  verse: (label: string, n: number, extra?: Partial<Layers>) => void;
  chorus: (label: string, n: number, extra?: Partial<Layers>) => void;
  /** Choruses so far. */
  choruses: () => number;
}

/** One genre's part in a merged form: its song-wide choices, drawn once, and its blocks. */
interface GenrePlan {
  /** Verse `n` and, where the genre has one, its pre-chorus. */
  verse: (label: string, n: number, extra?: Partial<Layers>) => void;
  chorus: (label: string, n: number, extra?: Partial<Layers>) => void;
  opening: () => void;
  /** After chorus `n` (1 or 2). */
  after: (n: number) => void;
  /** The middle of a full-length song. True when it played a third verse and chorus itself. */
  middle: () => boolean;
  /** A third verse and chorus (or just a chorus), when this genre's odds and the form call for it. */
  third: () => void;
  late: () => void;
  /** The last choruses and the ending. */
  finale: (ending: SongEnding) => void;
}

export function planMerged(
  rng: Rng,
  key: Key,
  liftKey: Key,
  ending: SongEnding,
  p: Progressions,
  song: Profile,
  voices: Voices,
  form: SongForm,
): Section[] {
  const plan: PlannedSection[] = [];
  const major = key.mode === "major";
  let choruses = 0;
  const plans = new Map<GenreId, GenrePlan>();
  const ctx: Ctx = {
    key,
    liftKey,
    p,
    form,
    short: form === "short",
    major,
    tonic: major ? "I" : "i",
    voices,
    counter: voices.countervoice !== "none",
    add: (kind, label, bars, progression, layers, sectionKey = key) => {
      plan.push({
        kind,
        label,
        bars,
        progression,
        key: sectionKey,
        layers: { ...LAYERS_OFF, ...layers },
      });
      if (kind === "chorus") choruses++;
    },
    verse: (label, n, extra) => body.verse(label, n, extra),
    chorus: (label, n, extra) => body.chorus(label, n, extra),
    choruses: () => choruses,
  };
  const planOf = (s: GenreShare): GenrePlan => {
    let gp = plans.get(s.genre.id);
    if (!gp) {
      const r = rng.fork(`plan:${s.genre.id}`);
      const at = (b: Blend) => blend(s.genre, b, s.weights);
      gp =
        s.genre.planner === "italo"
          ? italoPlan(ctx, s.genre, r, at)
          : s.genre.planner === "euro"
            ? euroPlan(ctx, s.genre, r, at)
            : synthpopPlan(ctx, s.genre, r, at);
      plans.set(s.genre.id, gp);
    }
    return gp;
  };
  /** A slot's genre, in proportion to the genres' shares, on the slot's own stream. */
  const slot = (label: string) =>
    planOf(rng.fork(label).weighted(song.shares.map((s) => [s, s.share] as const)));

  const body = slot("body");
  slot("opening").opening();
  ctx.verse("Verse 1", 1);
  ctx.chorus("Chorus", 1);
  slot("after").after(1);
  ctx.verse("Verse 2", 2);
  ctx.chorus("Chorus", 2);
  slot("after-2").after(2);
  if (!ctx.short) {
    const middle = slot("middle");
    if (!middle.middle()) middle.third();
    slot("late").late();
  }
  slot("finale").finale(ending);
  return placeSections(plan, rng.fork("place"));
}

// ── Synthpop: True Faith, The Different Story, You Came ──────────────────────────────────────

function synthpopPlan(c: Ctx, genre: Genre, rng: Rng, at: (b: Blend) => number): GenrePlan {
  const odds = genre.form;
  const chance = (b: Blend) => rng.chance(at(b));
  const preChorus = chance(odds.preChorus) && !!c.p.prechorus;
  const stack = chance(odds.stack);
  const chorusRiff = chance(odds.chorusRiff);
  const straightOn = chance(odds.straightOn);
  const breakdown = chance(odds.breakdown);
  const instrumental16 = chance(odds.instrumental16);
  // TF's high sequencer joins after the first chorus; its rhythm guitar plays the big sections.
  const useSeq = chance(odds.seq);
  const guitar = chance(odds.guitar);
  const verseBars = c.short ? 8 : rng.chance(0.8) ? 16 : 8;
  const seq = () => useSeq && c.choruses() > 0;
  const { add, p, tonic } = c;

  const tfTurn = () => {
    if (!chance(odds.turn)) return;
    add("turnaround", "Turn · VI–VII", 2, [["VI"], ["VII"]], {
      drums: "full",
      bass: true,
      bassShort: true,
      pad: true,
      seq: seq(),
      guitar,
    });
  };
  const tfInstrumental = (label: string) =>
    add("interlude", label, 8, p.chorus, {
      drums: "full",
      bass: true,
      seq: seq(),
      guitar,
      pad: true,
      riff: true,
      hook: chance(odds.instrumentalHook),
    });
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
    if (rng.chance(0.7))
      add("break", "Break", 2, [[tonic]], { drums: "kick", riff: true, pad: true });
  };
  const outro = (ending: SongEnding) => {
    if (ending === "hold") {
      add("outro", "Ending · IV held", 4, [["IV"]], { pad: true, riff: chorusRiff });
    } else if (ending === "lift") {
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
          seq: seq(),
        },
        c.liftKey,
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
        counter: c.counter,
      });
    }
  };

  return {
    verse: (label, n, extra = {}) => {
      const bars =
        n === 1 ? verseBars : n === 2 ? (verseBars === 16 && rng.chance(0.5) ? 16 : 8) : 8;
      add("verse", label, bars, preChorus ? intoTonic(p.verse, bars, tonic) : p.verse, {
        drums: "full",
        bass: true,
        pad: true,
        lead: "verse",
        seq: seq(),
        ...extra,
      });
      if (preChorus && p.prechorus && !extra.leadSynth) {
        add("prechorus", "Pre-chorus", Math.min(8, p.prechorus.length), p.prechorus, {
          drums: "full",
          bass: true,
          pad: true,
          arp: true,
          lead: "verse",
          seq: seq(),
        });
      }
    },
    chorus: (label, n, extra = {}) =>
      add("chorus", label, 8, p.chorus, {
        drums: "big",
        bass: true,
        pad: true,
        lead: "chorus",
        arp: n >= 2 || rng.chance(0.5),
        stabs: chance(odds.stabs),
        seq: seq(),
        guitar,
        counter: c.counter,
        ...(stack ? { leadStack: true } : {}),
        ...(chorusRiff ? { riff: true } : {}),
        ...extra,
      }),
    opening: () => {
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
    },
    after: (n) => {
      if (n !== 1 || straightOn) return;
      if (chance(odds.dsBlock)) dsBlock();
      else {
        tfInstrumental("Instrumental");
        tfTurn();
      }
    },
    middle: () => {
      if (breakdown) {
        add("verse", "Breakdown", 8, p.chorus.slice(0, 2), {
          drums: "breakdown",
          pad: true,
          lead: "verse",
        });
        add("bridge", "Bridge", 4, p.bridge, { drums: "breakdown", pad: true, lead: "verse" });
      } else if (chance(odds.dsBlock)) {
        dsBlock();
      } else {
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
        tfInstrumental("Instrumental chorus");
      }
      return false;
    },
    third: () => {
      if (c.form !== "long" && !chance(odds.thirdVerse)) return;
      tfTurn();
      c.verse("Verse 3", 3);
      c.chorus("Chorus", 3);
    },
    late: () => {
      if (!instrumental16) return;
      add("break", "Break", 8, p.chorus.slice(0, 2), { drums: "hats16", pad: true });
      add("interlude", "Instrumental", 8, p.chorus, { drums: "hats16", bass: true, pad: true });
      add("interlude", "Instrumental · riff", 8, p.chorus, {
        drums: "full",
        bass: true,
        pad: true,
        riff: true,
      });
    },
    finale: (ending) => {
      c.chorus("Chorus · double", 4, { leadDouble: true, arp: true });
      if (c.form === "long" || (c.form === "standard" && chance(odds.extraChorus)))
        c.chorus("Chorus", 5, { leadDouble: true });
      outro(ending);
    },
  };
}

// ── Italo: The Night, Get Closer, Faces, Self Control ────────────────────────────────────────

function italoPlan(c: Ctx, genre: Genre, rng: Rng, at: (b: Blend) => number): GenrePlan {
  const odds = genre.italo;
  if (!odds) throw new Error(`${genre.id} has no Italo form odds`);
  const chance = (b: Blend) => rng.chance(at(b));
  const { add, p, short } = c;
  const block = short ? 8 : 16;
  const pedal: Progression = [[c.tonic], ["VII/i"]];
  const vamp: Progression = [[c.tonic], [c.major ? "V" : "v"]];
  const preChorus = chance(odds.preChorus);
  const stabBreak = chance(odds.stabBreak);
  const halfVerse = chance(odds.halfVerse);
  const backing = chance(odds.backing);
  const vampOutro = chance(odds.vampOutro);
  const openings = (
    [
      ["pedal", at(odds.pedalIntro)],
      ["build", at(odds.buildIntro)],
      ["hook", at(odds.hookIntro)],
      ["riff", at(odds.riffIntro)],
    ] as const
  ).filter(([, w]) => w > 0);
  const opening = openings.length ? rng.weighted(openings) : "hook";
  const stabs = chance(odds.stabs);
  const verseArp = chance(odds.verseArp);
  const bareFirstVerse = chance(odds.bareFirstVerse);
  const afterChorus = !short && chance(odds.afterChorus);
  const leadSection = chance(odds.leadSection);
  const reprise = chance(odds.reprise);
  const breakdown = chance(odds.breakdown);
  // Faces' verse world: stabs instead of pads. Self Control's verse line plays over the pads.
  const verseWorld: Partial<Layers> =
    stabs && c.voices.stabPatch !== "glockenspiel" ? { pad: false, held: true } : {};

  const pedalBlock = (label: string) => {
    add("intro", label, 4, pedal, { drums: "full", bass: true, pad: true });
    add("intro", "Intro · riff", 4, pedal, { drums: "full", bass: true, riff: true });
    add("intro", "Intro · bass drop", 2, pedal, { drums: "full", riff: true });
  };
  const afterPedal = () => {
    if (leadSection)
      add("interlude", "Lead synth", short ? 8 : 12, p.verse, {
        drums: "full",
        bass: true,
        pad: true,
        leadSynth: true,
      });
    else add("intro", "Intro · loop", 4, p.verse, { drums: "full", bass: true, pad: true });
  };
  const breakBlock = (first: boolean) => {
    add("break", "Break · stab on 2", 4, vamp, {
      drums: "stab",
      bass: true,
      stabs: true,
      lead: "chorus",
    });
    if (first) add("break", "Drums and voice", 2, vamp, { drums: "full", lead: "chorus" });
  };
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
  const lastChorus = () => c.chorus("Chorus · last", 4, { leadDouble: true });

  return {
    verse: (label, n, extra = {}) => {
      add("verse", label, n === 2 && halfVerse ? block / 2 : block, p.verse, {
        drums: "full",
        bass: true,
        pad: true,
        lead: "verse",
        arp: verseArp,
        stabs,
        ...verseWorld,
        ...(n === 1 && bareFirstVerse ? { bassHeld: true } : {}),
        ...extra,
      });
      if (n === 1 && preChorus && !extra.leadSynth) {
        add("prechorus", "Pre-chorus · title line", block, p.verse, {
          drums: "full",
          bass: true,
          pad: true,
          lead: "verse",
          titleLine: true,
          arp: true,
          stabs,
          ...verseWorld,
        });
      }
    },
    chorus: (label, _n, extra = {}) =>
      add("chorus", label, block, p.chorus, {
        drums: "big",
        bass: true,
        pad: true,
        lead: "chorus",
        stabs,
        arp: false,
        counter: c.counter,
        ...(backing ? { leadStack: true } : {}),
        ...extra,
      }),
    opening: () => {
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
        add("intro", "Intro · pad", 4, [[c.major ? "I" : "i7"]], { drums: "half", pad: true });
        add("intro", "Intro · riff", 4, vamp, { drums: "full", bass: true, riff: true });
      } else {
        add("intro", "Intro", short ? 4 : 8, p.verse, { drums: "full", bass: true, pad: true });
        add("intro", "Hook", block, p.verse, { drums: "full", bass: true, pad: true, riff: true });
      }
    },
    after: (n) => {
      if (n !== 1) return;
      if (stabBreak) breakBlock(true);
      if (afterChorus) instrumental("Instrumental", 8);
    },
    middle: () => {
      if (!reprise) return false;
      pedalBlock("Reprise · pedal");
      afterPedal();
      c.verse("Verse 3", 3);
      c.chorus("Chorus", 3);
      return true;
    },
    third: () => {
      if (c.form !== "long") return;
      c.verse("Verse 3", 3);
      c.chorus("Chorus", 3);
    },
    late: () => {
      if (!breakdown) return;
      add("break", "Breakdown", 16, p.interlude, { drums: "full", pad: true, arp: true });
      instrumental("Instrumental", rng.pick([8, 16]));
    },
    finale: (ending) => {
      if (ending === "fade" && vampOutro) {
        if (stabBreak) breakBlock(false);
        for (const [label, riff] of [
          ["Outro · i–v vamp", false],
          ["Outro · vamp and riff", true],
        ] as const) {
          add("outro", label, 8, vamp, {
            drums: "big",
            bass: true,
            pad: true,
            stabs,
            riff,
            lead: "chorus",
            counter: c.counter,
          });
        }
        return;
      }
      lastChorus();
      if (ending === "hold") add("outro", "Ending · IV held", 4, [["IV"]], { pad: true });
      else if (ending === "lift")
        add(
          "outro",
          "Outro · lift to IV",
          16,
          p.lift,
          { drums: "full", bass: true, pad: true, riff: true, arp: true },
          c.liftKey,
        );
      else
        add("outro", "Outro · chorus to fade", 16, p.chorus, {
          drums: "big",
          bass: true,
          pad: true,
          stabs,
          counter: c.counter,
        });
    },
  };
}

// ── Euro-disco: Innocent Love, Heaven Can Wait, Crazy Juliet ─────────────────────────────────

function euroPlan(c: Ctx, genre: Genre, rng: Rng, at: (b: Blend) => number): GenrePlan {
  const odds = genre.euro;
  if (!odds) throw new Error(`${genre.id} has no Euro-disco form odds`);
  const chance = (b: Blend) => rng.chance(at(b));
  const pickOne = <T extends string>(options: readonly (readonly [T, Blend])[], fallback: T): T => {
    const weighted = options.map(([k, b]) => [k, at(b)] as const).filter(([, w]) => w > 0);
    return weighted.length ? rng.weighted(weighted) : fallback;
  };
  const { add, p, short, tonic, major } = c;
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
  const bridge = chance(odds.bridge);
  const verseArp = chance(odds.verseArp);
  const chorusArp = chance(odds.chorusArp);
  const chorusRiff = chance(odds.chorusRiff);
  const stabs = chance(odds.stabs);
  const stack = chance(odds.stack);
  const pre: Progression =
    p.prechorus ?? (major ? [["IV"], ["IV"], ["V"], ["V"]] : [["iv"], ["VI"], ["VII"], ["V"]]);
  // A chorus lasts as long as its progression: Crazy Juliet's 10 bars, the others' 14.
  const chorusBars = Math.min(16, Math.max(8, p.chorus.length));

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
  const chorusLayers = (): Partial<Layers> => ({
    drums: "big",
    bass: true,
    pad: true,
    lead: "chorus",
    arp: chorusArp,
    riff: chorusRiff,
    stabs,
    counter: c.counter,
    ...(stack ? { leadStack: true } : {}),
  });
  const afterChorus = (which: typeof afterFirst) => {
    if (which === "tag")
      add("chorus", "Tag", 2, [[tonic]], { drums: "big", bass: true, pad: true, arp: chorusArp });
    else if (which === "stop") add("break", "Stop", 2, [["VII"]], { drums: "half", pad: true });
  };

  return {
    verse: (label, _n, extra = {}) => {
      add("verse", label, verseBars, p.verse, {
        drums: "full",
        bass: true,
        pad: !bare,
        // A bare verse's pads swell in over its last two bars, so the pre-chorus doesn't land on
        // them all at once.
        ...(bare ? { padSwell: true } : {}),
        lead: "verse",
        arp: verseArp,
        ...extra,
      });
      preChorus(extra.lead === null ? { lead: null } : {});
    },
    chorus: (label, _n, extra = {}) =>
      add("chorus", label, chorusBars, p.chorus, { ...chorusLayers(), ...extra }),
    opening: () => {
      if (opening === "staggered") {
        add("intro", "Intro", 4, slice(p.verse, 0, 4), { pad: true, riff: true });
        add("intro", "Intro · hats and bass", 2, slice(p.verse, 4, 2), {
          drums: "hats16",
          bass: true,
          pad: true,
          riff: true,
        });
        add("intro", "Intro · kit", 2, slice(p.verse, 6, 2), {
          drums: "full",
          pad: true,
          riff: true,
        });
      } else if (opening === "motif") {
        add("intro", "Intro · motif", 4, [[tonic]], { riff: true });
        add("intro", "Groove", 4, p.verse, { drums: "full", bass: true });
      } else {
        add("intro", "Intro", short ? 4 : 8, [[tonic], [tonic], ["v"], ["v"]], {
          drums: "hats16",
          pad: true,
          arp: true,
        });
        add("intro", "Intro · climb", 4, [["VI"], ["VII"]], {
          drums: "hats16",
          pad: true,
          arp: true,
        });
        add("intro", "Link", 2, [[tonic], ["VII"]], { bass: true });
      }
    },
    after: (n) => {
      if (n === 1) afterChorus(afterFirst);
      else if (afterFirst === "stop") afterChorus("stop");
    },
    middle: () => {
      if (secondHalf === "lead") {
        c.chorus("Chorus", 3);
        for (let i = 0; i < 2; i++)
          c.chorus("Instrumental chorus", 3, { lead: null, leadStack: false, leadSynth: true });
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
        c.verse("Instrumental verse", 3, { lead: null, leadSynth: true });
      }
      if (bridge) {
        c.chorus("Chorus", 3);
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
      return false;
    },
    third: () => {
      if (c.form === "long") c.chorus("Chorus", 3);
    },
    late: () => {},
    finale: (ending) => {
      c.chorus("Chorus · last", 4);
      if (ending === "hold") add("outro", "Ending · IV held", 4, [["IV"]], { pad: true });
      else if (ending === "lift")
        add(
          "outro",
          "Outro · lift to IV",
          16,
          p.lift,
          { drums: "full", bass: true, pad: true, riff: true, arp: true },
          c.liftKey,
        );
      else add("outro", "Outro · chorus to fade", chorusBars, p.chorus, chorusLayers());
    },
  };
}
