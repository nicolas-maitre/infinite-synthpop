/**
 * Italo's harmonic analysis (docs/plans/theory-chords.md §4): why The Night's, Get Closer's,
 * Faces' and Self Control's progressions work, as traits that blend over the four references.
 * Written from docs/italo/the-night.md §3–§4 and §9, get-closer.md §2 and §4, faces.md §2.3 and
 * §4, branigan-self-control.md §3, the plans italo-genre.md and euro-disco-genre.md, and the
 * comments on ITALO_BANK (genres.ts). The measured loops stay in the bank; harmony.test.ts checks
 * that each reference alone reaches its own.
 *
 * All four records are minor songs. The major key is for blends that land in one: Faces' verse is
 * literally IV–V–iii–vi in its relative major, The Night's chorus I–IV⁶–♭VII–V7 in its own, and
 * Self Control's loop vi–iii–vi–iii–V–ii–IV–I.
 *
 * Numerals follow theory.ts: in minor, II, III, VI and VII are ♭II, ♭III, ♭VI and ♭VII, while I,
 * IV, V and lowercase vi are the parallel major's (Faces' chorus: I │ v7–IVmaj7, I–vi7 │
 * VII–V7sus4). A slash names the bass: `VII/i` is ♭VII over the tonic pedal, `VI/3` ♭VI over its
 * own 3rd (the tonic again), `VI/VII` Get Closer's C/D. The bass trait writes the held tonic and
 * the step below it (generate.ts `treatBass`), so most shapes here are written in root position.
 */
import type { HarmonyAnalysis, ModeTraits, Schema, SectionShape, SectionTraits } from "./analysis";
import { cad, colour, fixed, line, o, shape } from "./helpers";

const TN = "the-night";
const GC = "get-closer";
const FC = "faces";
const SC = "self-control";

// ── Minor: the four records ──────────────────────────────────────────────────────────────────

const MINOR_SCHEMAS: Schema[] = [
  {
    name: "tonic pedal, Dorian",
    source:
      "the-night.md §4 verse loop: i │ ♭VII/i │ v7 │ IV, the ♭VII over the F pedal, the minor v7 " +
      "and the Dorian IV(add9); the bass trait holds the tonic under bar 2",
    weight: {
      verse: { base: 0.1, by: { [TN]: 1.2, [GC]: 0.2, [SC]: 0.1 } },
      chorus: {},
    },
    bars: [
      fixed("i"),
      [o("VII", { base: 1 }), o("III", { base: 0.15 }), o("VI", { base: 0.15 })],
      [
        o("v7", { base: 0.3, by: { [TN]: 1 } }),
        o("v", { base: 0.4, by: { [SC]: 0.5 } }),
        o("iv", { base: 0.2 }),
        o("VI", { base: 0.15 }),
      ],
      [
        o("IV", { base: 0.3, by: { [TN]: 1 } }),
        o("IVadd9", { by: { [TN]: 0.4 } }, "TN verse bar 4: B♭(add9)"),
        o("iv", { base: 0.2, by: { [SC]: 0.3 } }),
        o("VII", { base: 0.2 }),
        o("VI", { base: 0.1 }),
      ],
    ],
  },
  {
    name: "two layers",
    source:
      "get-closer.md §4 the loop: the pads play i │ ♭VII │ IV │ ♭VI over a bass on i │ i │ IV │ " +
      "♭VII, so bars 2 and 4 become D/E and C/D (the bass trait); verse 1's IV⁶ walk",
    weight: {
      verse: { base: 0.05, by: { [GC]: 1.2, [TN]: 0.2 } },
      chorus: { by: { [GC]: 0.1 } },
    },
    bars: [
      fixed("i"),
      [o("VII", { base: 1 }), o("VI", { base: 0.15 })],
      [
        o("IV", { base: 0.4, by: { [GC]: 1 } }),
        o("IV/3", { by: { [GC]: 0.4 } }, "GC verse 1, bars 7 and 15: A/C♯"),
        o("iv", { base: 0.3 }),
        o("VI", { base: 0.15 }),
      ],
      [
        o("VI", { base: 0.5, by: { [GC]: 1 } }),
        o("VImaj7", { by: { [GC]: 0.3 } }, "GC 12″ break: the C carries its B (Cmaj7)"),
        o("VII", { base: 0.4 }),
        o("iv", { base: 0.15 }),
      ],
    ],
  },
  {
    name: "climb to the harmonic-minor V",
    source:
      "get-closer.md §4 chorus: i │ ♭VI⁶ │ ♭VII │ V¹¹ → V (Em │ C/E │ D │ A/B → B), the only " +
      "dominant in the record, entered through IV over V",
    weight: {
      verse: { base: 0.03, by: { [GC]: 0.1 } },
      chorus: { base: 0.15, by: { [GC]: 1.2, [TN]: 0.1 } },
    },
    bars: [
      fixed("i"),
      [o("VI", { base: 1 }), o("iv", { base: 0.3 }), o("III", { base: 0.2 })],
      [o("VII", { base: 1 }), o("VI", { base: 0.2 }), o("iv", { base: 0.2 })],
      [
        o(["IV/V", "V"], { base: 0.2, by: { [GC]: 1 } }),
        o(["Vsus4", "V"], { base: 0.3 }),
        o("V", { base: 0.3 }),
        o(["iv", "V"], { base: 0.2 }),
        o(["VI", "V"], { base: 0.1 }),
      ],
    ],
  },
  {
    name: "royal road",
    source:
      "faces.md §4.1: VI△7–♭VIIsus4 │ v7–i7, two chords a bar, the tonic held back to the " +
      "last half bar; the G may be Gsus4, G or G11 (F over G); the ii–V–iii–vi variant starts on iv7",
    weight: {
      verse: { base: 0.05, by: { [FC]: 1.3 } },
      chorus: { by: { [FC]: 0.05 } },
    },
    bars: [
      [
        o(["VImaj7", "VIIsus4"], { base: 0.2, by: { [FC]: 1 } }),
        o(["VImaj7", "VII"], { base: 0.3, by: { [FC]: 0.4 } }),
        o(["VImaj7", "VI/VII"], { by: { [FC]: 0.3 } }, "faces.md §4.1: G11, F over G"),
        o(["VI", "VIIsus4"], { base: 0.3 }),
        o(["VI", "VII"], { base: 0.4 }),
        o(["iv7", "VIIsus4"], { base: 0.1, by: { [FC]: 0.3 } }),
        o(["iv7", "VII"], { base: 0.1, by: { [FC]: 0.2 } }),
      ],
      [
        o(["v7", "i7"], { base: 0.2, by: { [FC]: 1 } }),
        o(["v7", "i"], { base: 0.3, by: { [FC]: 0.5 } }),
        o(["v", "i"], { base: 0.4 }),
        o(["III", "i7"], { by: { [FC]: 0.2 } }),
        o(["v7", "iv7"], { by: { [FC]: 0.15 } }),
      ],
    ],
  },
  {
    name: "royal road, 4 bars",
    source:
      "genres.ts 'FC royal road, 4 bars': the 2-bar loop with its second turn landing on a plain " +
      "i; faces.md §4.1 the intro holds the Em through its second bar",
    weight: { verse: { base: 0.02, by: { [FC]: 0.6 } }, chorus: {} },
    bars: [
      [
        o(["VImaj7", "VIIsus4"], { base: 0.3, by: { [FC]: 1 } }),
        o(["VI", "VII"], { base: 0.4 }),
        o(["iv7", "VIIsus4"], { by: { [FC]: 0.3 } }),
      ],
      [
        o(["v7", "i7"], { base: 0.3, by: { [FC]: 1 } }),
        o("v7", { by: { [FC]: 0.3 } }, "faces.md §4.1: the intro's Em held for the whole bar"),
        o(["v", "i"], { base: 0.4 }),
      ],
      [
        o(["VImaj7", "VII"], { base: 0.3, by: { [FC]: 1 } }),
        o(["VImaj7", "VIIsus4"], { by: { [FC]: 0.5 } }),
        o(["iv7", "VII"], { by: { [FC]: 0.3 } }),
        o(["VI", "VII"], { base: 0.4 }),
      ],
      [
        o(["v7", "i"], { base: 0.3, by: { [FC]: 1 } }),
        o(["v7", "i7"], { by: { [FC]: 0.4 } }),
        o(["v", "i"], { base: 0.4 }),
        o(["VII", "i"], { base: 0.1 }),
      ],
    ],
  },
  {
    name: "relative-major cadence",
    source:
      "the-night.md §3–§4 chorus: III(add9) │ VI⁶ │ ♭II │ VII7sus4 → VII7, I–IV⁶–♭VII–V7 in the " +
      "relative major, the ♭II (G♭) its hook; the-night.md §9: IV → III into the chorus",
    weight: {
      verse: { base: 0.02, by: { [TN]: 0.05 } },
      chorus: { base: 0.15, by: { [TN]: 1.3, [GC]: 0.1, [FC]: 0.1 } },
    },
    bars: [
      [
        o("III", { base: 1 }),
        o("IIIadd9", { by: { [TN]: 1 } }, "TN chorus bar 1: A♭(add9)"),
        o("IIImaj7", { base: 0.1 }),
      ],
      [
        o("VI/3", { base: 0.2, by: { [TN]: 1 } }, "TN chorus bar 2: D♭/F, IV⁶ in A♭"),
        o("VI", { base: 0.6 }),
        o("iv", { base: 0.2 }, "ii in the relative major"),
        o("VII", { base: 0.2 }),
      ],
      [
        o("II", { base: 0.15, by: { [TN]: 1 } }, "TN chorus bar 3: G♭, the ♭II"),
        o("iv", { base: 0.4 }),
        o("VI", { base: 0.3 }),
        o("III", { base: 0.15 }),
      ],
      [
        o(["VII7sus4", "VII7"], { base: 0.1, by: { [TN]: 1 } }, "TN chorus bar 4"),
        o(["VIIsus4", "VII"], { base: 0.3, by: { [TN]: 0.3 } }, "the-night.md §4: no 7th fits too"),
        o("VII7", { base: 0.2, by: { [TN]: 0.4 } }),
        o("VII", { base: 0.4 }),
      ],
    ],
  },
  {
    name: "parallel-major chorus",
    source:
      "faces.md §2.3 and §4.2: the chorus in A major over the verse's A minor, I │ v7–IV△7 three " +
      "times, then the I–vi7 │ ♭VII–V7sus4 turnaround (genres.ts 'FC chorus, doubled turnaround' " +
      "plays it once); the E is minor, the Mixolydian v",
    weight: {
      verse: {},
      chorus: { base: 0.02, by: { [FC]: 1.4, [TN]: 0.1 } },
    },
    bars: [
      [o("I", { base: 1 }), o("Imaj7", { by: { [FC]: 0.2 } }, "faces.md §4.4: a faint G♯")],
      [
        o(["v7", "IVmaj7"], { base: 0.3, by: { [FC]: 1 } }),
        o(["v7", "IV"], { base: 0.4 }),
        o(["v", "IV"], { base: 0.3 }),
        o(["ii7", "IVmaj7"], { by: { [FC]: 0.2 } }),
        o(["vi7", "IVmaj7"], { by: { [FC]: 0.15 } }),
        o(["IVmaj7", "v7"], { base: 0.1 }),
      ],
    ],
    cell: {
      repeats: [
        { value: 3, weight: { base: 0.5, by: { [FC]: 1 } }, source: "faces.md §4.2 bars 40–47" },
        { value: 1, weight: { base: 0.5, by: { [FC]: 0.4 } } },
      ],
      tag: [
        [
          o(["I", "vi7"], { base: 0.3, by: { [FC]: 1 } }),
          o(["I", "vi"], { base: 0.4 }),
          o(["I", "IVmaj7"], { base: 0.2 }),
          o(["I", "ii7"], { by: { [FC]: 0.2 } }),
        ],
        [
          o(["VII", "V7sus4"], { base: 0.3, by: { [FC]: 1 } }),
          o(["VII", "Vsus4"], { base: 0.3 }),
          o(["IV", "V7sus4"], { base: 0.2, by: { [FC]: 0.2 } }),
          o(["ii7", "V7sus4"], { by: { [FC]: 0.2 } }),
          o("V7sus4", { base: 0.1 }),
        ],
      ],
    },
  },
  {
    name: "Self Control's loop",
    source:
      "branigan-self-control.md §3.2: i │ v │ i │ v │ ♭VII │ iv │ ♭VI │ ♭III, pure Aeolian, the " +
      "minor v throughout; one loop under verse, pre-chorus and chorus (V–ii–IV–I in the relative " +
      "major, its second half)",
    weight: {
      verse: { base: 0.03, by: { [SC]: 1.2 } },
      chorus: { base: 0.03, by: { [SC]: 1.2 } },
    },
    bars: [
      fixed("i"),
      [o("v", { base: 1 }), o("VII", { base: 0.2 })],
      fixed("i"),
      [o("v", { base: 1 }), o("VII", { base: 0.3 }), o("iv", { base: 0.2 })],
      [o("VII", { base: 1 }), o("VI", { base: 0.4 }), o("iv", { base: 0.2 })],
      [o("iv", { base: 1 }), o("III", { base: 0.3 }), o("v", { base: 0.2 })],
      [o("VI", { base: 1 }), o("VII", { base: 0.3 }), o("iv", { base: 0.2 })],
      [o("III", { base: 1 }), o("VII", { base: 0.5 }), o("v", { base: 0.3 })],
    ],
  },
  {
    name: "i–v vamp",
    source:
      "branigan-self-control.md §3.3: the intro riff, the breaks and the outro on i │ v; " +
      "the-night.md §4 pedal blocks: i │ ♭VII over the F (the bass trait holds it)",
    // A verse only: Self Control's chorus is its 8-bar loop, and the vamp is its intro and outro.
    weight: { verse: { base: 0.02, by: { [SC]: 0.15 } }, chorus: {} },
    bars: [
      fixed("i"),
      [
        o("v", { base: 0.6, by: { [SC]: 1 } }),
        o("v7", { base: 0.2 }),
        o("VII", { base: 0.4 }),
        o("iv", { base: 0.2 }),
      ],
    ],
  },
  {
    name: "Aeolian climb",
    source:
      "genres.ts 'aeolian loop', 'i–VII–VI–VII' and 'relative-major lift': the genre-wide loops " +
      "the four records share (♭VI–♭VII–i)",
    weight: {
      verse: { base: 0.15 },
      chorus: { base: 0.1 },
    },
    bars: [
      [o("i", { base: 1 }), o("III", { base: 0.3 })],
      [o("VI", { base: 1 }), o("VII", { base: 0.6 })],
      [o("VII", { base: 1 }), o("VI", { base: 0.5 })],
      "cadence",
    ],
  },
];

const MINOR_SECTIONS: SectionTraits = {
  interlude: [
    shape(
      "the pedal block",
      { base: 0.1, by: { [TN]: 1 } },
      "the-night.md §4 intro and pedal blocks: Fm │ E♭/F over the F pedal",
      [fixed("i"), [o("VII/i", { base: 1 }), o("v7/i", { base: 0.2 })]],
    ),
    shape(
      "the verse chords without bass",
      { base: 0.1, by: { [TN]: 0.7 } },
      "the-night.md §4 maxi break: Fm │ E♭(add9) │ Cm │ B♭(add9), the ♭VII in root position once " +
        "the F bass is gone",
      [
        fixed("i"),
        [o("VIIadd9", { base: 1 }), o("VII", { base: 0.5 })],
        [o("v", { base: 1 }), o("v7", { base: 0.5 })],
        [o("IVadd9", { base: 1 }), o("IV", { base: 0.5 }), o("iv", { base: 0.2 })],
      ],
    ),
    shape(
      "the pads alone",
      { base: 0.1, by: { [GC]: 1 } },
      "get-closer.md §4: the 12″ break (4:18), Em │ D │ A │ Cmaj7 on the pads without bass",
      [
        fixed("i"),
        [o("VII", { base: 1 }), o("VI", { base: 0.2 })],
        [o("IV", { base: 1 }), o("iv", { base: 0.3 })],
        [o("VImaj7", { base: 1 }), o("VI", { base: 0.5 })],
      ],
    ),
    shape(
      "the turnaround as a loop",
      { by: { [FC]: 1.2 } },
      "faces.md §4.3: the breakdown repeats A – F♯m │ G – E, the chorus turnaround, without bass",
      [
        [o(["I", "vi7"], { base: 1 }), o(["I", "vi"], { base: 0.4 })],
        [o(["VII", "V7sus4"], { base: 1 }), o(["VII", "V"], { base: 0.3 })],
      ],
    ),
    shape(
      "the i–v vamp",
      { base: 0.1, by: { [SC]: 1.2 } },
      "branigan-self-control.md §3.3: the breaks on F♯m │ C♯m",
      [fixed("i"), [o("v", { base: 1 }), o("v7", { base: 0.2 })]],
    ),
    shape("Aeolian", { base: 0.2 }, "genres.ts 'i–VII–VI–VII'", [
      fixed("i"),
      [o("VII", { base: 1 }), o("VI", { base: 0.4 })],
      [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
      [o("VII", { base: 1 }), o("v", { base: 0.3 })],
    ]),
  ],
  turnaround: [
    shape(
      "the climb",
      { base: 0.3, by: { [TN]: 0.6 } },
      "genres.ts 'VI–VII'; the-night.md §4: every chorus–verse join goes E♭7 → Fm",
      [
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [
          o("VII", { base: 1 }),
          o("VII7", { by: { [TN]: 0.6 } }),
          o(["VII7sus4", "VII7"], { by: { [TN]: 0.6 } }),
        ],
      ],
    ),
    shape(
      "into the dominant",
      { base: 0.1, by: { [GC]: 1 } },
      "get-closer.md §4: A/B → B, the harmonic-minor V back to i",
      [
        [o("iv", { base: 1 }), o("VII", { base: 0.5 }), o("VI", { base: 0.5 })],
        [
          o(["IV/V", "V"], { by: { [GC]: 1 } }),
          o(["Vsus4", "V"], { base: 0.5 }),
          o("V", { base: 0.4 }),
        ],
      ],
    ),
    shape(
      "Faces' turnaround",
      { by: { [FC]: 1 } },
      "faces.md §2.3: the chorus ends on E and goes straight to the verse's F, V → ♭VI",
      [
        [o(["I", "vi7"], { base: 1 }), o(["I", "IV"], { base: 0.3 })],
        [o(["VII", "V7sus4"], { base: 1 }), o("V7sus4", { base: 0.3 })],
      ],
    ),
    shape(
      "Self Control's descent",
      { by: { [SC]: 1 } },
      "branigan-self-control.md §3.1: the loop's last chord (A, III) falls back to F♯m",
      [
        [o("iv", { base: 0.6 }), o("VII", { base: 0.5 })],
        [o("VI", { base: 0.5 }), o("III", { base: 1 })],
      ],
    ),
  ],
  bridge: [
    shape("subdominant", { base: 0.4 }, "genres.ts 'subdominant': iv │ VI │ VII │ i", [
      [o("iv", { base: 1 }), o("IV", { base: 0.3 })],
      [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
      [o("VII", { base: 1 }), o("V", { base: 0.3 })],
      [o("i", { base: 0.6 }), o("VII", { base: 0.4 }), o("V", { base: 0.4 })],
    ]),
    shape(
      "in the relative major",
      { base: 0.1, by: { [TN]: 1 } },
      "the-night.md §3: the chorus is where the tonic lets go, to the relative major",
      [
        [o("III", { base: 1 }), o("IIIadd9", { by: { [TN]: 0.5 } })],
        [o("VI/3", { base: 0.5 }), o("VI", { base: 0.5 })],
        [o("iv", { base: 1 }), o("II", { by: { [TN]: 0.4 } })],
        [o(["VII7sus4", "VII7"], { base: 0.4, by: { [TN]: 0.5 } }), o("VII", { base: 0.6 })],
      ],
    ),
    shape(
      "the Dorian IV",
      { base: 0.1, by: { [GC]: 0.6, [TN]: 0.3 } },
      "get-closer.md §2: the loop's A major (C♯, Dorian) against the chorus's harmonic-minor V",
      [
        fixed("IV"),
        [o("IV/3", { base: 0.5 }), o("VII", { base: 0.5 })],
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [o("V", { base: 0.6 }), o(["IV/V", "V"], { by: { [GC]: 0.6 } }), o("VII", { base: 0.4 })],
      ],
    ),
    shape(
      "Faces' parallel major",
      { by: { [FC]: 1 } },
      "faces.md §4.2: the chorus's I–vi7 │ ♭VII–V7sus4, slowed to a chord a bar",
      [
        [o("IVmaj7", { base: 1 }), o("IV", { base: 0.4 })],
        [o("vi7", { base: 1 }), o("I", { base: 0.4 })],
        [o("VII", { base: 1 }), o("ii7", { base: 0.3 })],
        [o("V7sus4", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    ),
  ],
  approach: [
    {
      interval: 2,
      weight: { base: 0.5, by: { [TN]: 0.8, [GC]: 0.2 } },
      source: "the-night.md §4: E♭7 → Fm, the chorus's VII into the verse's i",
    },
    {
      interval: 5,
      weight: { base: 0.3, by: { [GC]: 1 } },
      source: "get-closer.md §4: the chorus's B back to Em",
    },
    {
      interval: 1,
      weight: { base: 0.05, by: { [FC]: 1 } },
      source: "faces.md §2.3: V → ♭VI back into the verse, A minor's deceptive cadence",
    },
    {
      interval: 9,
      weight: { base: 0.05, by: { [SC]: 1 } },
      source: "branigan-self-control.md §3.1: the loop's III falls back to i",
    },
    { interval: 7, weight: { base: 0.2 }, source: "iv → i" },
    { interval: 4, weight: { base: 0.2 }, source: "♭VI → i" },
  ],
  palette: ["VII", "V", "VI", "iv", "IV", "III", "v"],
};

const MINOR: ModeTraits = {
  schemas: MINOR_SCHEMAS,
  cadences: {
    verse: [
      cad("i", { base: 0.5 }),
      cad("VII", { base: 0.5 }),
      cad("v", { base: 0.3, by: { [SC]: 0.5 } }),
      cad("IV", { base: 0.2, by: { [TN]: 0.5 } }),
    ],
    chorus: [
      cad("VII", { base: 0.5 }),
      cad("i", { base: 0.3 }),
      cad(["VIIsus4", "VII"], { base: 0.2, by: { [TN]: 0.5 } }),
      cad("V", { base: 0.2, by: { [GC]: 0.5 } }),
      cad("III", { base: 0.1, by: { [SC]: 0.5 } }),
    ],
  },
  colours: [
    colour("v", "v7", { base: 0.2, by: { [TN]: 0.6 } }, "the-night.md §4: the verse's v is Cm7"),
    colour("III", "IIIadd9", { by: { [TN]: 0.6 } }, "the-night.md §4 chorus bar 1: A♭(add9)"),
    colour("VI", "VI/3", { by: { [TN]: 0.4 } }, "the-night.md §4 chorus bar 2: D♭/F"),
    colour("VI", "VImaj7", { by: { [FC]: 0.6, [GC]: 0.2 } }, "faces.md §4.1: Fmaj7"),
    colour("VII", ["VIIsus4", "VII"], { by: { [FC]: 0.3, [TN]: 0.2 } }, "faces.md §4.1: Gsus4"),
    colour("VII", "VIIadd9", { by: { [TN]: 0.3 } }, "the-night.md §4 maxi break: E♭(add9)"),
    colour("IV", "IV/3", { by: { [GC]: 0.5 } }, "get-closer.md §4: the verse's IV⁶ walk"),
    colour("IV", "IVadd9", { by: { [TN]: 0.4 } }, "the-night.md §4 verse bar 4: B♭(add9)"),
    colour("i", "i7", { by: { [FC]: 0.3, [SC]: 0.1 } }, "faces.md §4.1: Am7; SC's intro pad i7"),
  ],
  // Self Control's triads stay plain (genres.ts substitutions: "pure Aeolian, no 7ths").
  colourChance: { base: 0.1, by: { [TN]: 0.5, [FC]: 0.4, [GC]: 0.3 } },
  // The borrowed chords a line plays once: The Night's ♭II, the harmonic-minor V. Faces' parallel
  // major (I, IVmaj7, vi7) is its chorus's own key, not a colour.
  colourChords: ["II", "V", "IV/V"],
  colourPerLine: 3,
  anticipate: {},
  secondLine: {
    verse: [
      line("repeat", { base: 1 }),
      line(
        "answer",
        { base: 0.15, by: { [GC]: 0.5 } },
        "get-closer.md §4: verse 1's second pass walks the bass up through IV⁶",
      ),
    ],
    chorus: [line("repeat", { base: 1 }), line("answer", { base: 0.2 })],
  },
  prechorus: {
    source:
      "branigan-self-control.md §2.1: the pre-chorus is the loop with the title line; plan §4.2: a " +
      "pre-chorus builds to the chorus's first chord. Italo plays one only in a blend.",
    long: [
      {
        name: "the subdominant side",
        weight: { base: 1 },
        bars: [
          [o("iv", { base: 1 }), o("VI", { base: 0.5 })],
          [o("v", { base: 1 }), o("VII", { base: 0.5 })],
          [o("VI", { base: 1 }), o("iv", { base: 0.4 })],
          [o("VII", { base: 1 }), o("III", { base: 0.3 })],
          [o("iv", { base: 1 }), o("VI", { base: 0.5 })],
          [o("III", { base: 1 }), o("VII", { base: 0.5 })],
        ],
      },
    ],
    longWeight: { base: 0.3 },
    short: [
      {
        name: "climb",
        weight: { base: 1 },
        bars: [
          [o("VI", { base: 1 }), o("iv", { base: 0.6 })],
          [o("VII", { base: 1 }), o("VI", { base: 0.3 })],
        ],
      },
    ],
    susDelay: { base: 0.3, by: { [TN]: 0.4 } },
    deceptive: {},
  },
  sections: MINOR_SECTIONS,
  bass: {
    source:
      "the-night.md §4: bar 2 keeps the F under E♭ (♭VII/i); get-closer.md §4: two layers, the " +
      "bass i │ i │ IV │ ♭VII under the pads' i │ ♭VII │ IV │ ♭VI (D/E, C/D), and C/E in the chorus",
    hold: { base: 0.05, by: { [TN]: 0.9, [GC]: 0.9 } },
    approach: { by: { [GC]: 0.8 } },
  },
};

// ── Major: the same records read in a major key (blends only) ────────────────────────────────

const MAJOR_SCHEMAS: Schema[] = [
  {
    name: "royal road",
    source:
      "faces.md §2.3: the verse is IV–V–iii–vi in C major, the 'royal road', which never " +
      "cadences on I",
    weight: { verse: { base: 0.1, by: { [FC]: 1.2 } }, chorus: { by: { [FC]: 0.1 } } },
    bars: [
      [
        o(["IVmaj7", "Vsus4"], { base: 0.2, by: { [FC]: 1 } }),
        o(["IV", "V"], { base: 0.5 }),
        o(["ii7", "Vsus4"], { by: { [FC]: 0.3 } }),
      ],
      [
        o(["iii7", "vi7"], { base: 0.2, by: { [FC]: 1 } }),
        o(["iii", "vi"], { base: 0.5 }),
        o(["iii7", "vi"], { by: { [FC]: 0.3 } }),
      ],
    ],
  },
  {
    name: "the chorus's cadence",
    source: "the-night.md §3: the chorus heard in A♭, I │ IV⁶ │ ♭VII │ V7sus4 → V7",
    weight: {
      verse: { base: 0.05, by: { [TN]: 0.2 } },
      chorus: { base: 0.2, by: { [TN]: 1.2, [GC]: 0.2 } },
    },
    bars: [
      [o("I", { base: 1 }), o("Iadd9", { by: { [TN]: 0.6 } })],
      [o("IV/3", { base: 0.3, by: { [TN]: 1 } }), o("IV", { base: 0.6 }), o("ii", { base: 0.2 })],
      [o("VII", { base: 0.2, by: { [TN]: 1 } }), o("ii", { base: 0.4 }), o("IV", { base: 0.3 })],
      [
        o(["V7sus4", "V7"], { base: 0.2, by: { [TN]: 1 } }),
        o(["Vsus4", "V"], { base: 0.5 }),
        o("V", { base: 0.4 }),
      ],
    ],
  },
  {
    name: "Mixolydian loop",
    source:
      "the-night.md §4 and get-closer.md §4 read in a major key: I │ ♭VII over the tonic │ v │ IV, " +
      "the ♭VII and the minor v borrowed",
    weight: {
      verse: { base: 0.1, by: { [TN]: 1, [GC]: 1 } },
      chorus: { base: 0.05, by: { [GC]: 0.3 } },
    },
    bars: [
      fixed("I"),
      [o("VII", { base: 1 }), o("IV", { base: 0.3 })],
      [
        o("v7", { by: { [TN]: 1 } }),
        o("IV", { base: 0.5, by: { [GC]: 1 } }),
        o("vi", { base: 0.3 }),
      ],
      [o("IV", { base: 0.5, by: { [TN]: 1 } }), o("V", { base: 0.4 }), o("VII", { base: 0.3 })],
    ],
  },
  {
    name: "Faces' chorus",
    source: "faces.md §4.2 in its own key: I │ v7–IV△7 three times, then I–vi7 │ ♭VII–V7sus4",
    weight: { verse: {}, chorus: { base: 0.1, by: { [FC]: 1.3 } } },
    bars: [
      fixed("I"),
      [
        o(["v7", "IVmaj7"], { base: 0.2, by: { [FC]: 1 } }),
        o(["v", "IV"], { base: 0.4 }),
        o(["ii7", "IVmaj7"], { base: 0.2 }),
      ],
    ],
    cell: {
      repeats: [
        { value: 3, weight: { base: 0.5, by: { [FC]: 1 } } },
        { value: 1, weight: { base: 0.5 } },
      ],
      tag: [
        [o(["I", "vi7"], { base: 1 }), o(["I", "vi"], { base: 0.5 })],
        [o(["VII", "V7sus4"], { base: 0.3, by: { [FC]: 1 } }), o(["IV", "Vsus4"], { base: 0.5 })],
      ],
    },
  },
  {
    name: "Self Control in the relative major",
    source: "branigan-self-control.md §3.2: in A major the loop reads vi–iii–vi–iii–V–ii–IV–I",
    weight: { verse: { base: 0.02, by: { [SC]: 1 } }, chorus: { base: 0.02, by: { [SC]: 1 } } },
    bars: [
      fixed("vi"),
      [o("iii", { base: 1 }), o("V", { base: 0.2 })],
      fixed("vi"),
      [o("iii", { base: 1 }), o("IV", { base: 0.2 })],
      [o("V", { base: 1 }), o("IV", { base: 0.3 })],
      [o("ii", { base: 1 }), o("vi", { base: 0.2 })],
      [o("IV", { base: 1 }), o("ii", { base: 0.2 })],
      [o("I", { base: 1 }), o("V", { base: 0.3 })],
    ],
  },
  {
    name: "I–V vamp",
    source: "branigan-self-control.md §3.3: the i–v vamp, read in a major key",
    weight: { verse: { base: 0.1, by: { [SC]: 0.3 } }, chorus: {} },
    bars: [fixed("I"), [o("V", { base: 0.6 }), o("v", { base: 0.4 }), o("VII", { base: 0.3 })]],
  },
];

const MAJOR_SECTIONS: SectionTraits = {
  interlude: [
    shape("Faces' turnaround as a loop", { base: 0.2, by: { [FC]: 1 } }, "faces.md §4.3", [
      [o(["I", "vi7"], { base: 1 }), o(["I", "vi"], { base: 0.4 })],
      [o(["VII", "V7sus4"], { base: 0.6 }), o(["IV", "V"], { base: 0.5 })],
    ]),
    shape(
      "the pedal block",
      { base: 0.2, by: { [TN]: 1, [GC]: 0.5 } },
      "the-night.md §4: the pedal block, in a major key",
      [fixed("I"), [o("VII/I", { base: 1 }), o("IV/I", { base: 0.4 })]],
    ),
    shape("the loop without bass", { base: 0.3 }, "get-closer.md §4: the pads alone", [
      fixed("I"),
      [o("VII", { base: 0.5 }), o("vi", { base: 0.5 })],
      [o("IV", { base: 1 })],
      [o("V", { base: 0.6 }), o("ii", { base: 0.3 })],
    ]),
  ],
  turnaround: [
    shape("into the dominant", { base: 0.5 }, "the-night.md §3: the chorus's V7 into I", [
      [o("IV", { base: 1 }), o("ii", { base: 0.5 })],
      [o(["V7sus4", "V7"], { base: 0.5, by: { [TN]: 1 } }), o("V", { base: 0.6 })],
    ]),
    shape("Faces' turnaround", { by: { [FC]: 1 } }, "faces.md §4.2", [
      [o(["I", "vi7"], { base: 1 })],
      [o(["VII", "V7sus4"], { base: 1 })],
    ]),
    shape("♭VI–♭VII", { base: 0.2 }, "genres.ts 'VI–VII' in a major key", [
      fixed("VI"),
      fixed("VII"),
    ]),
  ],
  bridge: [
    shape("subdominant", { base: 0.5 }, "plan §4.2: a bridge visits the subdominant side", [
      fixed("IV"),
      [o("vi", { base: 0.6 }), o("iii", { base: 0.4 })],
      [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
      [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
    ]),
    shape(
      "the relative minor",
      { base: 0.2, by: { [FC]: 0.5, [SC]: 0.5 } },
      "faces.md §2.3: the verse on the relative minor's side",
      [
        fixed("vi"),
        [o("IV", { base: 1 })],
        [o("V", { base: 1 })],
        [o("iii", { base: 0.5 }), o("I", { base: 0.5 })],
      ],
    ),
  ],
  approach: [
    { interval: 5, weight: { base: 0.6 }, source: "V → I" },
    { interval: 7, weight: { base: 0.4 }, source: "IV → I" },
    { interval: 2, weight: { base: 0.3, by: { [TN]: 0.3 } }, source: "♭VII → I" },
    { interval: 1, weight: { base: 0.05, by: { [FC]: 0.4 } }, source: "V → vi" },
    { interval: 3, weight: { base: 0.05, by: { [SC]: 0.4 } }, source: "I → vi, into the loop" },
  ],
  palette: ["V", "IV", "ii", "VII", "vi", "I"],
};

const MAJOR: ModeTraits = {
  schemas: MAJOR_SCHEMAS,
  cadences: {
    verse: [cad("V", { base: 0.6 }), cad("IV", { base: 0.4 }), cad(["Vsus4", "V"], { base: 0.3 })],
    chorus: [cad("V", { base: 0.6 }), cad(["V7sus4", "V7"], { base: 0.4 })],
  },
  colours: [
    colour("IV", "IVmaj7", { by: { [FC]: 0.5 } }, "faces.md §4.2: Dmaj7"),
    colour("I", "Iadd9", { by: { [TN]: 0.5 } }, "the-night.md §4: A♭(add9)"),
    colour("IV", "IV/3", { by: { [TN]: 0.4, [GC]: 0.3 } }, "IV⁶: TN's D♭/F, GC's A/C♯"),
  ],
  colourChance: { base: 0.1, by: { [TN]: 0.4, [FC]: 0.4 } },
  colourChords: ["v", "VII", "VI", "v7"],
  colourPerLine: 3,
  anticipate: {},
  secondLine: {
    verse: [line("repeat", { base: 1 }), line("answer", { base: 0.2 })],
    chorus: [line("repeat", { base: 1 }), line("answer", { base: 0.2 })],
  },
  prechorus: {
    source: "plan §4.2: a pre-chorus builds to the chorus's first chord through its dominant",
    long: [
      {
        name: "the relative minor's side",
        weight: { base: 1 },
        bars: [
          [o("vi", { base: 1 }), o("IV", { base: 0.5 })],
          [o("iii", { base: 1 }), o("V", { base: 0.3 })],
          [o("IV", { base: 1 }), o("ii", { base: 0.5 })],
          [o("I/3", { base: 1 }), o("vi", { base: 0.4 })],
          [o("ii", { base: 1 }), o("IV", { base: 0.5 })],
          [o("vi", { base: 0.6 }), o("I/3", { base: 0.5 })],
        ],
      },
    ],
    longWeight: { base: 0.3 },
    short: [
      {
        name: "subdominant",
        weight: { base: 1 },
        bars: [
          [o("IV", { base: 1 }), o("ii", { base: 0.6 })],
          [o("vi", { base: 1 }), o("IV", { base: 0.4 })],
        ],
      },
    ],
    susDelay: { base: 0.4 },
    deceptive: { base: 0.1 },
  },
  sections: MAJOR_SECTIONS,
  bass: {
    source: "the-night.md §4 and get-closer.md §4, in a major key: ♭VII over the held tonic",
    hold: { base: 0.05, by: { [TN]: 0.7, [GC]: 0.7 } },
    approach: {},
  },
};

// ── The lift: the major key a fourth up ──────────────────────────────────────────────────────

const LIFT: SectionShape[] = [
  shape("I–IV–V", { base: 1 }, "genres.ts 'lift I–IV–V': Italo's bank lift", [
    fixed("I"),
    [o("IV", { base: 1 }), o("IVmaj7", { by: { [FC]: 0.6 } }), o("IV/3", { by: { [TN]: 0.4 } })],
    [o("I", { base: 1 }), o("vi", { base: 0.2 })],
    [o("V", { base: 1 }), o(["IV", "V"], { base: 0.4 }), o("V7sus4", { by: { [FC]: 0.5 } })],
  ]),
  shape(
    "Faces' chorus in the new key",
    { by: { [FC]: 1 } },
    "faces.md §4.2: I │ v7–IV△7, the minor-to-major lift once more",
    [
      fixed("I"),
      [o(["v7", "IVmaj7"], { base: 1 })],
      [o(["I", "vi7"], { base: 1 }), o("I", { base: 0.5 })],
      [o(["VII", "V7sus4"], { base: 1 }), o(["IV", "V"], { base: 0.3 })],
    ],
  ),
];

export const ITALO_HARMONY: HarmonyAnalysis = {
  modes: { minor: MINOR, major: MAJOR },
  motion: {
    source:
      "the-night.md §4: the verse i → ♭VII → v → IV (steps and fourths), the chorus III → VI → ♭II " +
      "→ VII (fourths and a third); get-closer.md §4: the bass moves a step at a time; faces.md " +
      "§4.1: the royal road falls by a fourth and climbs by a step; branigan-self-control.md §3.2: " +
      "i–v fifths and ♭VII–iv–♭VI–♭III falling fifths",
    step: { base: 1 },
    fourth: { base: 1.1 },
    third: { base: 0.5, by: { [TN]: 0.3 } },
    hold: { base: 0.15, by: { [SC]: 0.2 } },
    tritone: { base: 0.05 },
  },
  quote: { base: 0.12 },
  quoteChorus: 0.7,
  formPlays: [],
  lift: LIFT,
  quoteSections: {
    chance: 0.5,
    loops: {
      [TN]: { interlude: [["i"], ["VII/i"]] },
      [GC]: { interlude: [["i"], ["VII"], ["IV"], ["VImaj7"]] },
      [FC]: {
        interlude: [
          ["I", "vi7"],
          ["VII", "V7sus4"],
        ],
      },
      [SC]: { interlude: [["i"], ["v"]] },
    },
  },
  // Self Control's verse is its chorus's loop (genres.ts: the form's `verseOnLoop`, by SC).
  sameLoopOnTonic: true,
};
