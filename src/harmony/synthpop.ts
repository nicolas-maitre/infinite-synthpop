/**
 * Synthpop's harmonic analysis (docs/plans/theory-chords.md §4): why True Faith's, The Different
 * Story's and You Came's progressions work, as traits that blend over the three references.
 * Written from docs/analysis.md: §3 ("Shared DNA", "Where they differ"), §5 (the generator rules),
 * §6.2 (You Came's chords bar by bar) and §7 (what You Came adds). The measured loops stay in the
 * bank (genres.ts); harmony.test.ts checks that each reference alone reaches its own.
 *
 * Numerals follow theory.ts: in minor, VI and VII are ♭VI and ♭VII; `/3` is a chord over its own
 * 3rd. Spellings are the canonical ones the arranger keys on (`III` and `IV` for TF's guitar sus
 * voicings, `ii` and `v` for You Came's bass hop and walk, `V/ii` and `V7/vi` for the melodies'
 * raised notes).
 */
import type { Blend } from "../genres";
import type { Bar } from "../progressions";
import type {
  BarOption,
  Cadence,
  Colour,
  HarmonyAnalysis,
  ModeTraits,
  Option,
  Schema,
  SecondLine,
  SectionShape,
  SectionTraits,
} from "./analysis";

const TF = "true-faith";
const DS = "different-story";
const YC = "you-came";

/** A bar option: one chord or a split bar. */
const o = (bar: string | Bar, weight: Blend, source?: string): BarOption => ({
  value: typeof bar === "string" ? [bar] : bar,
  weight,
  ...(source ? { source } : {}),
});
/** A bar that is always this chord. */
const fixed = (c: string): BarOption[] => [o(c, { base: 1 })];
const cad = (bar: string | Bar, weight: Blend, answer?: Blend, source?: string): Cadence => ({
  value: typeof bar === "string" ? [bar] : bar,
  weight,
  ...(answer ? { answer } : {}),
  ...(source ? { source } : {}),
});
const colour = (from: string, to: string | Bar, weight: Blend, source: string): Colour => ({
  from,
  to: typeof to === "string" ? [to] : to,
  weight,
  source,
});
const shape = (
  name: string,
  weight: Blend,
  source: string,
  bars: readonly (readonly BarOption[])[],
): SectionShape => ({ name, weight, source, bars });
const line = (value: SecondLine, weight: Blend, source?: string): Option<SecondLine> => ({
  value,
  weight,
  ...(source ? { source } : {}),
});

// ── Minor: True Faith and The Different Story, and You Came's climb read in a minor key ────────

const MINOR_SCHEMAS: Schema[] = [
  {
    name: "climb",
    source:
      "analysis.md §3 Shared DNA 1: the verse climbs i → VI → VII → v in both songs; DS's second " +
      "line turns i │ VI │ iv │ V",
    weight: {
      verse: { base: 0.1, by: { [TF]: 0.5, [DS]: 1, [YC]: 0.3 } },
      // You Came's loop is this climb run without landing (§7, "The loop also links the corners").
      chorus: { base: 0.1, by: { [YC]: 0.6 } },
      later: { base: 0.1 },
    },
    bars: [
      fixed("i"),
      fixed("VI"),
      [o("VII", { base: 1 }), o("iv", { base: 0.1, by: { [DS]: 0.5 } })],
      "cadence",
    ],
  },
  {
    name: "climb in one bar",
    source: "analysis.md §3 table: TF's verse i │ VI VII │ v │ v, the climb in bar 2, the v held",
    weight: { verse: { by: { [TF]: 1, [DS]: 0.15 } }, chorus: { base: 0.03 } },
    bars: [
      fixed("i"),
      [o(["VI", "VII"], { base: 1 })],
      [o("v", { base: 1 }), o("iv", { base: 0.1 })],
      "cadence",
    ],
  },
  {
    name: "swing to the relative major",
    source:
      "analysis.md §3 Shared DNA 2: the chorus opens on the tonic, swings through ♭VII and lands " +
      "on the subdominant (TF i │ III │ VII │ IV, DS i │ III │ VII │ iv; TF's plain i │ VII │ VII " +
      "│ IV and F–C split)",
    weight: {
      verse: { base: 0.1, by: { [TF]: 0.1 } },
      chorus: { base: 0.1, by: { [TF]: 1, [DS]: 1, [YC]: 0.3 } },
    },
    bars: [
      fixed("i"),
      [
        o("III", { base: 0.1, by: { [TF]: 0.6, [DS]: 1, [YC]: 0.3 } }),
        o("VII", { base: 0.05, by: { [TF]: 0.5 } }),
        o("VI", { base: 0.15 }),
        o("iv", { base: 0.05 }),
        o("v", { base: 0.05 }),
      ],
      [o("VII", { base: 1 }), o("III", { base: 0.15 }), o("VI", { base: 0.1 })],
      "cadence",
    ],
  },
  {
    name: "descent",
    source:
      "TF's MIDI verse, third line: i │ VII │ VI │ v (genres.ts 'TF verse (MIDI)'); plan §4.1 " +
      "'a descent by step'",
    // Measured in TF's verse only: a little in TF's choruses, rarely in DS's.
    weight: {
      verse: { base: 0.05, by: { [TF]: 0.3, [DS]: 0.05 } },
      chorus: { base: 0.05, by: { [TF]: 0.15 } },
      later: { base: 0.2, by: { [TF]: 0.6 } },
    },
    bars: [fixed("i"), fixed("VII"), fixed("VI"), "cadence"],
  },
  {
    name: "descent from VII",
    source: "TF's MIDI verse, last line: VII │ VI │ v │ v V, the tonic held back",
    weight: { verse: {}, chorus: { base: 0.03 }, later: { by: { [TF]: 0.5 } } },
    bars: [fixed("VII"), fixed("VI"), [o("v", { base: 1 }), o("iv", { base: 0.3 })], "cadence"],
  },
  {
    name: "the climb as a loop",
    source:
      "analysis.md §7: You Came's A–B is ♭VI–♭VII in C♯ minor, a climb that runs on without " +
      "landing; its loop IV │ V │ IV │ V–I⁶ read in the relative minor",
    weight: { verse: { by: { [YC]: 0.35 } }, chorus: { by: { [YC]: 0.5 } } },
    bars: [fixed("VI"), fixed("VII"), [o("VI", { base: 1 }), o("iv", { base: 0.3 })], "cadence"],
  },
  {
    name: "royal road",
    source:
      "plan §4.1 Motion: the royal road ♭VI–♭VII–v–i, the tonic held back to the loop's end " +
      "(You Came's tonic placement, §6.1)",
    weight: {
      verse: { base: 0.03, by: { [YC]: 0.2 } },
      chorus: { base: 0.05, by: { [YC]: 0.25 } },
    },
    bars: [fixed("VI"), fixed("VII"), fixed("v"), fixed("i")],
  },
];

// Secondary sections (plan §4.2), written after the verse and chorus and scored against them: an
// interlude and a bridge contrast with the chorus, a turnaround leads into the verse's first chord,
// and the song's colour chords (TF's Dorian IV, DS's iv) recur where they belong.
const MINOR_SECTIONS: SectionTraits = {
  interlude: [
    shape(
      "the relative-major run",
      { base: 0.3, by: { [TF]: 0.2, [DS]: 1.2 } },
      "analysis.md §3 table, Interlude: DS's III │ VII │ iv │ i VII (§2, 1:20: G │ D │ Am │ Em " +
        "D), on the relative major's side of the key",
      [
        [o("III", { base: 1 }), o("VI", { base: 0.25 })],
        [o("VII", { base: 1 }), o("VI", { base: 0.15 })],
        [
          o("iv", { base: 0.3, by: { [DS]: 1 } }),
          o("IV", { by: { [TF]: 0.6 } }, "TF's Dorian IV"),
          o("VI", { base: 0.3 }),
        ],
        [
          o(["i", "VII"], { base: 0.3, by: { [DS]: 1 } }),
          o("i", { base: 0.5 }),
          o("VII", { base: 0.3 }),
          o(["VI", "VII"], { base: 0.2 }),
        ],
      ],
    ),
    shape(
      "an instrumental chorus",
      { base: 0.2, by: { [TF]: 1 } },
      "§3 table, Interlude: TF's is an instrumental chorus (genres.ts 'TF instrumental', " +
        "i │ III │ VII │ IV): the chorus's swing, played as another chorus rather than this one",
      [
        fixed("i"),
        [
          o("III", { base: 0.3, by: { [TF]: 0.6 } }),
          o("VII", { base: 0.2, by: { [TF]: 0.3 } }),
          o("VI", { base: 0.2 }),
        ],
        [o("VII", { base: 1 }), o("III", { base: 0.15 })],
        [
          o("IV", { base: 0.2, by: { [TF]: 1 } }),
          o("iv", { base: 0.2, by: { [DS]: 0.5 } }),
          o("V", { base: 0.2 }),
          o("VII", { base: 0.1 }),
          o(["IV", "V"], { base: 0.1 }),
        ],
      ],
    ),
    shape(
      "YC's break, in the relative minor",
      { by: { [YC]: 1 } },
      "§6.2 Break (3:18): A(add9) │ B, IV(add9) │ V read as ♭VI │ ♭VII",
      [
        [o("VIadd9", { base: 1 }), o("VI", { base: 0.5 })],
        [o("VII", { base: 1 }), o("VIIadd9", { base: 0.3 })],
      ],
    ),
    shape(
      "the climb as an instrumental",
      { by: { [YC]: 0.5 } },
      "§2 You Came 3:34: the instrumental is the loop, read in the relative minor",
      [
        fixed("VI"),
        fixed("VII"),
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [o("VII", { base: 1 }), o(["VII", "III/3"], { base: 0.6 })],
      ],
    ),
  ],
  turnaround: [
    shape(
      "Dorian ii–IV",
      { base: 0.15, by: { [DS]: 1.2 } },
      "§3 table and Shared DNA 3: DS's turnaround ii │ ii │ IV │ IV (F♯m │ F♯m │ A │ A), the " +
        "raised 6th, into the verse's i",
      [
        fixed("ii"),
        [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
        fixed("IV"),
        [o("IV", { base: 1 }), o("V", { base: 0.2 }), o(["IV", "V"], { base: 0.2 })],
      ],
    ),
    shape(
      "on VI",
      { base: 0.2, by: { [TF]: 1, [YC]: 0.6 } },
      "§2 TF 2:32: the turnaround sits on B♭ (VI); its VI–VII into a verse (MIDI bars 45–46) " +
        "is the form's own turn, so here it's the rarer ending; §6.2 You Came's bare IV │ V " +
        "breakdown, read as ♭VI │ ♭VII",
      [
        fixed("VI"),
        [
          o("VI", { base: 0.2, by: { [TF]: 1 } }),
          o("VII", { base: 0.4, by: { [TF]: 0.2, [YC]: 0.6 } }),
          o(["VI", "VII"], { base: 0.2, by: { [TF]: 0.2 } }),
        ],
      ],
    ),
    shape(
      "the climb, twice",
      { base: 0.3, by: { [TF]: 0.2, [DS]: 0.2, [YC]: 0.3 } },
      "genres.ts 'VI–VII–VI–VII' and You Came's IV–IV–V–V: the climb into the tonic, played twice",
      [
        fixed("VI"),
        [o("VII", { base: 1 }), o("VI", { by: { [YC]: 0.5 } })],
        [o("VI", { base: 1 }), o("iv", { base: 0.3 }), o("VII", { by: { [YC]: 0.5 } })],
        [o("VII", { base: 1 }), o("V", { base: 0.3 }), o(["VI", "VII"], { base: 0.2 })],
      ],
    ),
    shape(
      "the harmonic-minor pull",
      { base: 0.1, by: { [DS]: 0.3 } },
      "§3 Where they differ: DS's harmonic-minor V pulls back to the tonic",
      [
        [o("iv", { base: 1 }), o("VI", { base: 0.5 })],
        [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    ),
  ],
  bridge: [
    shape(
      "i–IV vamp",
      { base: 0.2, by: { [TF]: 1.2 } },
      "§3 table, Bridge: TF's i IV │ IV vamp (§2, 2:38: Dm G │ G │ Dm G │ G), the Dorian IV",
      [
        [o(["i", "IV"], { base: 1 }), o("i", { base: 0.2 })],
        fixed("IV"),
        [o(["i", "IV"], { base: 1 }), o(["i", "VII"], { base: 0.2 })],
        [o("IV", { base: 1 }), o("V", { base: 0.2 }), o(["IV", "V"], { base: 0.2 })],
      ],
    ),
    shape(
      "i–iv vamp",
      { base: 0.15, by: { [TF]: 0.2, [DS]: 0.4 } },
      "TF's vamp with the chorus's Aeolian iv, for a song whose chorus has DS's iv (§3 Shared " +
        "DNA 2: the one note between the two choruses)",
      [
        [o(["i", "iv"], { base: 1 }), o("i", { base: 0.2 })],
        fixed("iv"),
        [o(["i", "iv"], { base: 1 }), o(["i", "VII"], { base: 0.2 })],
        [o("iv", { base: 1 }), o("V", { base: 0.3 }), o(["iv", "V"], { base: 0.2 })],
      ],
    ),
    shape(
      "Dorian ii–IV–V",
      { base: 0.15, by: { [DS]: 1.2 } },
      "§2 DS long version: an 8-bar instrumental bridge in the F♯m–A–B area, ii–IV–V",
      [
        fixed("ii"),
        [o("ii", { base: 1 }), o("IV", { base: 0.4 })],
        [o("IV", { base: 1 }), o("ii", { base: 0.2 })],
        [o("V", { base: 1 }), o(["IV", "V"], { base: 0.3 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    ),
    shape(
      "subdominant",
      { base: 0.4, by: { [DS]: 0.3 } },
      "plan §4.2: a bridge visits the subdominant side; genres.ts 'subdominant' iv │ VI │ VII │ i",
      [
        [o("iv", { base: 1 }), o("IV", { base: 0.3 })],
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [o("VII", { base: 1 }), o("V", { base: 0.3 })],
        [o("i", { base: 0.6 }), o("VII", { base: 0.4 }), o("V", { base: 0.4 })],
      ],
    ),
    shape(
      "YC's bridge, in the relative minor",
      { by: { [YC]: 1 } },
      "§6.2 Bridge (2:38): Amaj7 │ B(add9) │ A/C♯ │ Bsus4–B, IV │ V │ IV⁶ │ V read as ♭VI │ ♭VII",
      [
        [o("VImaj7", { base: 1 }), o("VI", { base: 0.4 }), o("VIadd9", { base: 0.3 })],
        [o("VIIadd9", { base: 0.7 }), o("VII", { base: 0.5 })],
        [o("VI/3", { base: 0.6 }), o("VI", { base: 0.4 }), o("iv", { base: 0.3 })],
        [o(["VIIsus4", "VII"], { base: 1 }), o("VII", { base: 0.5 })],
      ],
    ),
  ],
  approach: [
    {
      interval: 2,
      weight: { base: 0.6, by: { [TF]: 0.6, [YC]: 0.3 } },
      source: "§3 Shared DNA 1: up a step, ♭VII → i, the climb",
    },
    {
      interval: 7,
      weight: { base: 0.5, by: { [DS]: 1 } },
      source: "§3 Shared DNA 3: the Dorian lift IV → i, DS's turnaround into its verse",
    },
    {
      interval: 5,
      weight: { base: 0.5, by: { [DS]: 0.6 } },
      source: "§3 Where they differ: a dominant, DS's harmonic-minor V → i",
    },
    {
      interval: 4,
      weight: { base: 0.2, by: { [TF]: 0.8 } },
      source: "§2 TF 2:32: ♭VI → i, the turnaround on VI",
    },
    {
      interval: 10,
      weight: { base: 0.1, by: { [YC]: 0.6 } },
      source: "§2 You Came: down a step, the breakdown's V into the loop's IV",
    },
    { interval: 1, weight: { base: 0.05 } },
  ],
  palette: ["VII", "IV", "V", "VI", "iv", "v", "III", "i"],
};

const MINOR: ModeTraits = {
  schemas: MINOR_SCHEMAS,
  cadences: {
    verse: [
      cad(
        "v",
        { base: 0.2, by: { [TF]: 1, [DS]: 0.7 } },
        { base: 0.1, by: { [TF]: 0.5, [DS]: 0.2 } },
        "§3 Shared DNA 1: both verses sit on the minor v, the unresolved dominant",
      ),
      cad(
        "V",
        { by: { [DS]: 0.2 } },
        { base: 0.1, by: { [DS]: 1 } },
        "§3 Where they differ: DS turns its second verse line toward the harmonic-minor V",
      ),
      cad(
        "VII",
        { base: 0.05, by: { [TF]: 0.3, [YC]: 0.6 } },
        { by: { [TF]: 0.5, [YC]: 0.3 } },
        "TF's MIDI verse, second line ends on VII; You Came's climb never lands",
      ),
      cad(["v", "VII"], { by: { [TF]: 0.3 } }, { by: { [TF]: 0.2 } }, "TF verse (Hooktheory)"),
      cad(
        ["v", "V"],
        { by: { [TF]: 0.1 } },
        { by: { [TF]: 0.4, [DS]: 0.2 } },
        "TF's MIDI verse's last bar",
      ),
      cad("iv", { base: 0.05 }, { base: 0.05, by: { [DS]: 0.2 } }),
      cad(["Vsus4", "V"], { by: { [YC]: 0.15 } }, { by: { [YC]: 0.3 } }, "§6.2: the sus4 delay"),
      cad(
        ["VII", "III/3"],
        { by: { [YC]: 0.3 } },
        undefined,
        "§6.2: You Came's bar 4, V → I⁶, read in the relative minor",
      ),
    ],
    chorus: [
      cad(
        "IV",
        { base: 0.05, by: { [TF]: 1 } },
        { by: { [TF]: 0.6 } },
        "§3 Shared DNA 2–3: TF's Dorian IV",
      ),
      cad(
        "iv",
        { base: 0.05, by: { [DS]: 1 } },
        { by: { [DS]: 0.5 } },
        "§3 Shared DNA 2: DS's Aeolian iv",
      ),
      cad(
        "V",
        { base: 0.25, by: { [DS]: 0.2 } },
        { base: 0.4, by: { [DS]: 0.5 } },
        "§5: v ↔ V; the harmonic-minor pull back to i",
      ),
      cad(
        ["iv", "VI"],
        { by: { [DS]: 0.3 } },
        undefined,
        "§5: iv ↔ VI at the chorus end (DS's C turn)",
      ),
      cad("VI", { base: 0.1 }),
      cad(
        "VII",
        { base: 0.05, by: { [YC]: 0.5 } },
        undefined,
        "an open cadence: the climb runs on",
      ),
      cad(["VII", "III/3"], { by: { [YC]: 0.5 } }, undefined, "§6.2: V → I⁶ in the relative minor"),
      cad(
        ["iv", "V"],
        { by: { [DS]: 0.4 } },
        { by: { [DS]: 0.6 } },
        "§3 Where they differ: DS's harmonic-minor V at a line's end, after its iv",
      ),
      cad(["IV", "V"], { base: 0.05, by: { [TF]: 0.25 } }, undefined, "TF's IV, then the V"),
      cad("v", { base: 0.05 }),
      cad(["Vsus4", "V"], { base: 0.03, by: { [YC]: 0.2 } }, undefined, "§6.2: the sus4 delay"),
    ],
  },
  colours: [
    colour("VI", "VImaj7", { by: { [YC]: 0.3 } }, "§6.2 bridge: Amaj7, ♭VI in C♯ minor"),
    colour("VI", "VIadd9", { by: { [YC]: 0.25 } }, "§6.2 break: A(add9)"),
    colour("VII", ["VIIsus4", "VII"], { by: { [YC]: 0.15 } }, "§6.2 bridge bar 4: Bsus4–B"),
    colour("VII", "VIIadd9", { by: { [YC]: 0.15 } }, "§6.2 bridge: B(add9)"),
  ],
  colourChance: { base: 0.02, by: { [YC]: 0.5 } },
  colourChords: ["IV", "V", "V7", "ii", "Vsus4"],
  // TF's chorus 2: Dm │ F C │ C │ G.
  anticipate: { base: 0.05, by: { [TF]: 0.35 } },
  secondLine: {
    verse: [
      line("repeat", { base: 0.3, by: { [YC]: 0.7 } }),
      line(
        "answer",
        { base: 0.2, by: { [DS]: 1, [TF]: 0.3 } },
        "DS's verse: i VI VII v │ i VI iv V",
      ),
      line("contrast", { base: 0.1, by: { [TF]: 0.2 } }),
      line("four", { by: { [TF]: 0.35 } }, "TF's MIDI verse: two climbing lines, then the descent"),
    ],
    chorus: [
      line("repeat", { base: 1 }),
      line(
        "answer",
        { base: 0.45, by: { [DS]: 0.6 } },
        "TF's chorus plays twice; a second line ending elsewhere keeps the hook and moves on",
      ),
    ],
  },
  prechorus: {
    source:
      "analysis.md §6.2 You Came's pre-chorus, read in the relative major (genres.ts 'pre-chorus " +
      "via the relative major'); plan §4.2: a pre-chorus builds to the chorus's first chord " +
      "through its dominant or a ♭VI–V turn",
    long: [
      {
        name: "YC's pre-chorus in the relative major",
        weight: { base: 1 },
        bars: [
          [o("VI", { base: 1 }), o("iv", { base: 0.6 })],
          [o("iv", { base: 1 }), o("VI", { base: 0.5 })],
          [o("III", { base: 1 }), o("i", { base: 0.4 })],
          [o("v", { base: 1 }), o("VII", { base: 0.6 }), o("iv", { base: 0.2 })],
          [o("iv", { base: 1 }), o("VI", { base: 0.5 })],
          [o("III", { base: 1 }), o("VII", { base: 0.5 })],
        ],
      },
    ],
    longWeight: { base: 0.3, by: { [YC]: 0.3 } },
    short: [
      {
        name: "subdominant build",
        weight: { base: 1 },
        bars: [
          [o("iv", { base: 1 }), o("VI", { base: 1 })],
          [o("VI", { base: 1 }), o("VII", { base: 0.8 }), o("iv", { base: 0.4 })],
        ],
      },
      { name: "the climb", weight: { base: 0.5 }, bars: [fixed("VI"), fixed("VII")] },
    ],
    susDelay: { base: 0.3, by: { [YC]: 0.5 } },
    deceptive: { by: { [YC]: 0.5 } },
  },
  sections: MINOR_SECTIONS,
};

// ── Major: You Came, and the other two's shapes read in a major key ───────────────────────────

const MAJOR_SCHEMAS: Schema[] = [
  {
    name: "IV–V loop",
    source: "analysis.md §6.2 The loop: IV │ V │ IV │ V–I⁶, the tonic only as an inversion; §7.1",
    weight: { verse: { by: { [YC]: 0.7 } }, chorus: { by: { [YC]: 1.2 } } },
    bars: [
      fixed("IV"),
      fixed("V"),
      [o("IV", { base: 1 }), o("ii", { base: 0.2 }), o("vi", { base: 0.1 })],
      "cadence",
    ],
  },
  {
    name: "bass climb to V",
    source:
      "§6.2: the tonic only over its 3rd (bar 4's E/G♯), the pre-chorus's ii; the bass climbs " +
      "F♯–G♯–A–B to the loop's V",
    weight: { verse: { base: 0.1, by: { [YC]: 0.5 } }, chorus: { by: { [YC]: 0.15 } } },
    bars: [fixed("ii"), fixed("I/3"), fixed("IV"), "cadence"],
  },
  {
    name: "the climb past V",
    source: "§6.2: the climb runs on to vi (the pre-chorus's V/vi, the deceptive pull to vi)",
    weight: { verse: { by: { [YC]: 0.2 } }, chorus: { by: { [YC]: 0.2 } } },
    bars: [fixed("IV"), fixed("V"), [o("vi", { base: 1 }), o("iii", { base: 0.3 })], "cadence"],
  },
  {
    name: "royal road",
    source: "plan §4.1 Motion: the royal road, IV–V–iii–vi, never on the tonic (§6.1)",
    weight: { verse: { by: { [YC]: 0.1 } }, chorus: { by: { [YC]: 0.15 } } },
    bars: [fixed("IV"), fixed("V"), fixed("iii"), fixed("vi")],
  },
  {
    name: "from the relative minor",
    source: "§6.1: the tonic held back; the phrase starts away from home",
    weight: {
      verse: { base: 0.1, by: { [YC]: 0.25 } },
      chorus: { base: 0.05, by: { [YC]: 0.2 } },
    },
    bars: [fixed("vi"), fixed("IV"), [o("V", { base: 1 }), o("I/3", { base: 0.4 })], "cadence"],
  },
  {
    name: "swing, in major",
    source:
      "§3 Shared DNA 2 in a major key: tonic, a swing by a third (iii, vi) or to ♭VII, then the " +
      "subdominant; TF's outro vamps on its new I with the odd V",
    weight: { verse: { by: { [TF]: 0.4, [DS]: 0.4 } }, chorus: { by: { [TF]: 1, [DS]: 1 } } },
    bars: [
      fixed("I"),
      [
        o("iii", { by: { [TF]: 0.5, [DS]: 0.5 } }),
        o("vi", { base: 0.3 }),
        o("VII", { by: { [TF]: 0.4 } }),
      ],
      [
        o("VII", { by: { [TF]: 1 } }),
        o("V", { base: 0.3, by: { [DS]: 1 } }),
        o("IV", { base: 0.2 }),
      ],
      "cadence",
    ],
  },
  {
    name: "climb, in major",
    source: "§3 Shared DNA 1 in a major key: from the tonic down a third, then up by step to V",
    weight: {
      verse: { base: 0.05, by: { [TF]: 0.6, [DS]: 0.6 } },
      chorus: { by: { [TF]: 0.2, [DS]: 0.2 } },
    },
    bars: [
      fixed("I"),
      [o("vi", { base: 1 }), o("IV", { base: 0.5 })],
      [o("IV", { base: 1 }), o("ii", { base: 0.5 })],
      "cadence",
    ],
  },
];

const MAJOR_SECTIONS: SectionTraits = {
  interlude: [
    shape(
      "YC's break",
      { base: 0.2, by: { [YC]: 1 } },
      "§6.2 Break (3:18): A(add9) │ B, IV(add9) │ V for 8 bars",
      [
        [o("IVadd9", { base: 1 }), o("IV", { base: 0.4 }), o("IVmaj7", { base: 0.3 })],
        [o("V", { base: 1 }), o("Vadd9", { base: 0.4 })],
      ],
    ),
    shape(
      "the loop as an instrumental",
      { by: { [YC]: 0.6 } },
      "§2 You Came 3:34: the instrumental plays the loop",
      [
        fixed("IV"),
        fixed("V"),
        [o("IV", { base: 1 }), o("ii", { base: 0.3 })],
        [o(["V", "I/3"], { base: 1 }), o("V", { base: 0.5 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    ),
    shape(
      "an instrumental chorus, in major",
      { base: 0.2, by: { [TF]: 1, [DS]: 0.6 } },
      "§3 table: TF's interlude is an instrumental chorus; the swing read in a major key " +
        "(I │ iii │ ♭VII │ IV)",
      [
        fixed("I"),
        [o("iii", { base: 0.5 }), o("vi", { base: 0.4 }), o("VII", { by: { [TF]: 0.4 } })],
        [
          o("VII", { by: { [TF]: 1 } }),
          o("V", { base: 0.3, by: { [DS]: 1 } }),
          o("IV", { base: 0.3 }),
        ],
        [o("IV", { base: 1 }), o("iv", { by: { [DS]: 0.5 } }), o("V", { base: 0.3 })],
      ],
    ),
    shape(
      "the relative-minor run",
      { base: 0.1, by: { [DS]: 0.6 } },
      "§3 table: DS's interlude runs on the relative major's side of its minor key; a major " +
        "key's other side is its relative minor",
      [
        fixed("vi"),
        [o("IV", { base: 1 }), o("iii", { base: 0.3 })],
        [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
        [o("V", { base: 1 }), o(["I", "V"], { base: 0.6 })],
      ],
    ),
  ],
  turnaround: [
    shape(
      "bare IV–V",
      { base: 0.3, by: { [YC]: 1 } },
      "§6.2 Breakdown (2:22): bare IV │ V into the loop",
      [fixed("IV"), fixed("V")],
    ),
    shape(
      "IV │ IV │ V │ V",
      { base: 0.1, by: { [YC]: 0.5 } },
      "genres.ts 'IV–IV–V–V': the breakdown's IV │ V at half the speed",
      [
        fixed("IV"),
        fixed("IV"),
        fixed("V"),
        [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.4 })],
      ],
    ),
    shape(
      "ii–IV, in major",
      { base: 0.1, by: { [DS]: 1 } },
      "§3 table: DS's ii │ ii │ IV │ IV read in a major key",
      [
        fixed("ii"),
        [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
        fixed("IV"),
        [o("IV", { base: 0.5 }), o("V", { base: 1 })],
      ],
    ),
    shape(
      "♭VI–♭VII",
      { by: { [TF]: 0.8 } },
      "TF's VI–VII into a verse (MIDI bars 45–46) in a major key: the borrowed ♭VI–♭VII climbs " +
        "into I",
      [fixed("VI"), fixed("VII")],
    ),
  ],
  bridge: [
    shape(
      "YC's bridge",
      { base: 0.1, by: { [YC]: 1.2 } },
      "§6.2 Bridge (2:38): Amaj7 │ B(add9) │ A/C♯ │ Bsus4–B, IVmaj7 │ Vadd9 │ IV⁶ │ V",
      [
        [o("IVmaj7", { base: 1 }), o("IV", { base: 0.3 }), o("IVadd9", { base: 0.3 })],
        [o("Vadd9", { base: 1 }), o("V", { base: 0.4 })],
        [o("IV/3", { base: 1 }), o("IV", { base: 0.3 }), o("ii", { base: 0.2 })],
        [o(["Vsus4", "V"], { base: 1 }), o("V", { base: 0.4 })],
      ],
    ),
    shape(
      "the IV vamp, in major",
      { by: { [TF]: 0.8 } },
      "§3 table: TF's i IV │ IV vamp read in a major key",
      [
        [o(["I", "IV"], { base: 1 })],
        fixed("IV"),
        [o(["I", "IV"], { base: 1 }), o(["I", "V"], { base: 0.3 })],
        [o("IV", { base: 1 }), o("V", { base: 0.4 })],
      ],
    ),
    shape(
      "ii–IV–V",
      { base: 0.2, by: { [DS]: 1 } },
      "§2 DS long version: the instrumental bridge on ii–IV–V",
      [
        fixed("ii"),
        [o("ii", { base: 1 }), o("IV", { base: 0.4 })],
        fixed("IV"),
        [o("V", { base: 1 }), o(["IV", "V"], { base: 0.3 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    ),
    shape("subdominant", { base: 0.3 }, "plan §4.2: a bridge visits the subdominant side", [
      fixed("IV"),
      [o("vi", { base: 0.6 }), o("I/3", { base: 0.4 })],
      [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
      [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
    ]),
  ],
  approach: [
    {
      interval: 5,
      weight: { base: 0.6, by: { [YC]: 0.3 } },
      source: "a dominant: V → I, V/ii → ii",
    },
    {
      interval: 10,
      weight: { base: 0.2, by: { [YC]: 1 } },
      source: "§2 You Came: down a step, the breakdown's V into the loop's IV",
    },
    { interval: 7, weight: { base: 0.4, by: { [TF]: 0.3 } }, source: "plagal: IV → I" },
    {
      interval: 2,
      weight: { base: 0.4, by: { [TF]: 0.6 } },
      source: "up a step: ♭VII → I (TF's climb), V → vi",
    },
    { interval: 4, weight: { base: 0.1, by: { [TF]: 0.3 } }, source: "♭VI → I, IV → vi" },
    { interval: 1, weight: { base: 0.05 } },
  ],
  palette: ["V", "IV", "ii", "VII", "vi", "iii", "I"],
};

const MAJOR: ModeTraits = {
  schemas: MAJOR_SCHEMAS,
  cadences: {
    verse: [
      cad(["V", "I/3"], { by: { [YC]: 1 } }, { by: { [YC]: 1 } }, "§6.2: bar 4, V → I⁶"),
      cad(
        "V",
        { base: 0.3, by: { [YC]: 0.5 } },
        { base: 0.2, by: { [YC]: 0.3 } },
        "§6.2: the loop's open V",
      ),
      cad(
        ["Vsus4", "V"],
        { by: { [YC]: 0.3 } },
        { by: { [YC]: 0.3 } },
        "§6.2 bridge bar 4: Bsus4–B",
      ),
      cad(
        "V7/vi",
        { by: { [YC]: 0.25 } },
        { by: { [YC]: 0.4 } },
        "§6.2: G♯7 → A, deceptive into IV",
      ),
      cad("IV", { base: 0.1, by: { [TF]: 0.2 } }),
      cad(["IV", "V"], { base: 0.15, by: { [TF]: 0.2, [DS]: 0.2 } }),
      cad("iv", { by: { [DS]: 0.3 } }, undefined, "DS's minor iv, borrowed into major"),
    ],
    chorus: [
      cad(["V", "I/3"], { by: { [YC]: 1 } }, undefined, "§6.2: bar 4, V → I⁶"),
      cad("V", { base: 0.3, by: { [YC]: 0.4 } }, undefined, "§6.2: the loop's open V"),
      cad(["Vsus4", "V"], { by: { [YC]: 0.3 } }, undefined, "§6.2 bridge bar 4: Bsus4–B"),
      cad(
        "IV",
        { by: { [YC]: 0.15, [TF]: 0.5 } },
        undefined,
        "§6.2: the record ends on IV; TF's IV",
      ),
      cad("iv", { by: { [DS]: 0.5 } }, undefined, "DS's minor iv, borrowed into major"),
      cad(["IV", "V"], { base: 0.1 }),
      cad("VII", { by: { [TF]: 0.2 } }, undefined, "TF's ♭VII"),
    ],
  },
  colours: [
    colour("IV", "IVmaj7", { by: { [YC]: 0.4 } }, "§6.2 bridge: Amaj7"),
    colour("IV", "IVadd9", { by: { [YC]: 0.3 } }, "§6.2 intro and break: A(add9)"),
    colour("V", "Vadd9", { by: { [YC]: 0.3 } }, "§6.2 bridge: B(add9)"),
    colour("V", ["Vsus4", "V"], { by: { [YC]: 0.25 } }, "§6.2 bridge bar 4: Bsus4–B"),
    colour("IV", "IV/3", { by: { [YC]: 0.15 } }, "§6.2 bridge bar 3: A/C♯"),
  ],
  colourChance: { base: 0.05, by: { [YC]: 0.45 } },
  colourChords: ["iv", "v", "VII", "VI", "III"],
  anticipate: { base: 0.02, by: { [TF]: 0.3 } },
  secondLine: {
    verse: [
      line("repeat", { base: 0.3, by: { [YC]: 0.6 } }),
      line("answer", { base: 0.2, by: { [YC]: 0.4, [DS]: 0.6, [TF]: 0.3 } }),
      line("contrast", { base: 0.1, by: { [TF]: 0.2 } }),
    ],
    chorus: [
      line("repeat", { base: 1 }),
      line(
        "answer",
        { base: 0.3, by: { [YC]: 0.3 } },
        "§2: chorus 3's loop drops to I⁶ every 8 bars",
      ),
    ],
  },
  prechorus: {
    source:
      "analysis.md §6.2 Pre-chorus: V/ii │ ii │ I │ v │ ii │ I │ V/vi sus4 │ V/vi⁷, entered from " +
      "a pushed I, leaving deceptively to the loop's IV; §7.1",
    long: [
      {
        name: "YC's pre-chorus",
        weight: { base: 0.5, by: { [YC]: 1.5 } },
        bars: [
          [
            o("V/ii", { base: 0.2, by: { [YC]: 1 } }),
            o("ii", { base: 0.5 }),
            o("IV", { base: 0.3 }),
          ],
          fixed("ii"),
          [o("I", { base: 1 }), o("I/3", { base: 0.4 })],
          [
            o("v", { by: { [YC]: 1 } }, "§6.2 bar 4: the borrowed minor v"),
            o("V", { base: 0.3 }),
            o("IV", { base: 0.3 }),
            o("iii", { base: 0.2 }),
          ],
          [o("ii", { base: 1 }), o("IV", { base: 0.5 }), o("vi", { base: 0.3 })],
          [o("I", { base: 1 }), o("I/3", { base: 0.5 })],
        ],
      },
      {
        name: "bass climb",
        weight: { base: 0.5 },
        bars: [
          fixed("IV"),
          [o("V", { base: 0.6 }), o("I/3", { base: 0.6 })],
          fixed("vi"),
          [o("iii", { base: 0.5 }), o("I/3", { base: 0.5 }), o("IV", { base: 0.3 })],
          [o("ii", { base: 1 }), o("IV", { base: 0.6 })],
          [o("I/3", { base: 1 }), o("V", { base: 0.4 })],
        ],
      },
    ],
    longWeight: { base: 0.4, by: { [YC]: 0.4 } },
    short: [
      {
        name: "YC's second line",
        weight: { base: 1 },
        bars: [
          [o("ii", { base: 1 }), o("IV", { base: 0.6 }), o("vi", { base: 0.4 })],
          [o("I", { base: 1 }), o("I/3", { base: 0.6 }), o("IV", { base: 0.3 })],
        ],
      },
      {
        name: "into ii",
        weight: { by: { [YC]: 0.6 } },
        bars: [[o("V/ii", { by: { [YC]: 1 } }), o("ii", { base: 0.3 })], fixed("ii")],
      },
    ],
    susDelay: { base: 0.2, by: { [YC]: 0.8 } },
    deceptive: { base: 0.2, by: { [YC]: 1 } },
  },
  sections: MAJOR_SECTIONS,
};

// ── The lift: TF's outro, the chorus's IV become the tonic of a major key a fourth up ──────────

const LIFT: SectionShape[] = [
  shape(
    "vamp on the new I",
    { base: 0.3, by: { [TF]: 1.2 } },
    "analysis.md §2 TF 4:48: the outro in G major, a G vamp with an occasional D (genres.ts 'TF " +
      "outro vamp'); §3 Where they differ: IV becomes I",
    [
      fixed("I"),
      [o("I", { base: 0.7 }), o(["I", "IV"], { base: 0.3 })],
      fixed("I"),
      [o(["I", "V"], { base: 1 }), o("V", { base: 0.4 }), o(["I", "IV"], { base: 0.2 })],
    ],
  ),
  shape(
    "I–IV",
    { base: 0.5, by: { [DS]: 0.3 } },
    "genres.ts 'lift I–IV', 'lift I–IV–V': the new I with its IV, the old key's ♭VII",
    [
      fixed("I"),
      [o("IV", { base: 1 }), o(["I", "IV"], { base: 0.6 })],
      [o("I", { base: 1 }), o("vi", { base: 0.2 })],
      [o("V", { base: 1 }), o(["IV", "V"], { base: 0.4 }), o("IV", { base: 0.3 })],
    ],
  ),
  shape(
    "the chorus's swing, landed",
    { base: 0.2, by: { [TF]: 0.4 } },
    "§3 Where they differ: the chorus's ♭VII → IV, heard in the new key, is IV → I",
    [
      fixed("I"),
      fixed("IV"),
      [o("I", { base: 1 }), o("vi", { base: 0.3 })],
      [o("IV", { base: 0.6 }), o(["IV", "V"], { base: 0.5 })],
    ],
  ),
];

export const SYNTHPOP_HARMONY: HarmonyAnalysis = {
  modes: { minor: MINOR, major: MAJOR },
  motion: {
    source:
      "§3: steps (VI–VII–i, the climb), fourths and fifths (III → VII → IV) and the third swing " +
      "(i → III) carry both minor songs; TF holds v │ v and VII │ VII; §6.2 the IV–V loop",
    step: { base: 1 },
    fourth: { base: 1 },
    third: { base: 0.6 },
    hold: { base: 0.15, by: { [TF]: 0.35 } },
    tritone: { base: 0.05 },
  },
  // About 1 song in 10 (some songs have no reference in their key mode to quote).
  quote: { base: 0.12 },
  quoteChorus: 0.8,
  // legacy-planners/synthpop.ts's tfTurn: TF's two staccato bars into a verse (MIDI bars 45–46).
  formPlays: [[["VI"], ["VII"]]],
  lift: LIFT,
  // A quoted chorus brings its record's other measured sections along about half the time.
  quoteSections: {
    chance: 0.5,
    loops: {
      [TF]: {
        // §2 2:32 and 2:38. TF's interlude is its chorus, which the quote already plays.
        turnaround: [["VI"], ["VI"]],
        bridge: [["i", "IV"], ["IV"], ["i", "IV"], ["IV"]],
      },
      [DS]: {
        // §2 1:20 and the long version's bridge.
        interlude: [["III"], ["VII"], ["iv"], ["i", "VII"]],
        turnaround: [["ii"], ["ii"], ["IV"], ["IV"]],
        bridge: [["ii"], ["ii"], ["IV"], ["V"]],
      },
      [YC]: {
        // §6.2: the break, the breakdown, the bridge.
        interlude: [["IVadd9"], ["V"]],
        turnaround: [["IV"], ["V"]],
        bridge: [["IVmaj7"], ["Vadd9"], ["IV/3"], ["Vsus4", "V"]],
      },
    },
  },
};
