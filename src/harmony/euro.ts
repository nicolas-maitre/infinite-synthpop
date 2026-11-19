/**
 * Euro-disco's harmonic analysis (docs/plans/theory-chords.md §4): why Innocent Love's, Heaven Can
 * Wait's and Crazy Juliet's progressions work, as traits that blend over the three references.
 * Written from docs/references/sandra-innocent-love.md §4, sandra-heaven-can-wait.md §4,
 * sandra-crazy-juliet.md §2 and §4, docs/plans/euro-disco-genre.md, and the comments on EURO_BANK
 * (genres.ts). The measured loops stay in the bank; harmony.test.ts checks that each reference
 * alone reaches its own.
 *
 * What the three share: a static verse over a pedal or a vamp, a pre-chorus that turns or stops,
 * and a chorus that changes chords faster and runs long (10 or 14 bars) by repeating a short cell
 * and then cadencing. The Euro planner lays a chorus out for its progression's length (8–16 bars)
 * and a pre-chorus for its own (2–8, the last bar a stop), so those lengths come through as
 * written. Crazy Juliet is a major song; the minor key reads it from its chorus's G♯ minor, as the
 * bank does.
 *
 * Numerals follow theory.ts: in minor, III, VI and VII are ♭III, ♭VI and ♭VII, lowercase vi the
 * major-scale one (IL's Cø7 is viø7), vii the minor-scale ♭vii; `ii7/v` is ii⁷ over the v pedal.
 */
import type { HarmonyAnalysis, ModeTraits, Schema, SectionShape, SectionTraits } from "./analysis";
import { cad, colour, fixed, line, o, shape } from "./helpers";

const IL = "innocent-love";
const HCW = "heaven-can-wait";
const CJ = "crazy-juliet";

// ── Minor: Innocent Love, Heaven Can Wait, and Crazy Juliet read from its v ───────────────────

const MINOR_SCHEMAS: Schema[] = [
  {
    name: "over the v pedal",
    source:
      "sandra-innocent-love.md §4.3: v │ ii⁷ │ v │ I over the B♭ pedal (B♭m │ Fm7/B♭ │ B♭m │ " +
      "E♭/B♭), B♭ Dorian's i–v7–i–IV; the tonic appears only in its major form, over the dominant",
    weight: { verse: { base: 0.1, by: { [IL]: 1.3 } }, chorus: {} },
    pedal: "v",
    bars: [
      fixed("v"),
      [
        o("ii7", { base: 0.3, by: { [IL]: 1 } }),
        o("v", { base: 0.3, by: { [IL]: 0.3 } }, "genres.ts 'IL verse, plain v pedal'"),
        o("VII", { base: 0.2 }),
        o("ii", { base: 0.15 }),
      ],
      [o("v", { base: 1 }), o("ii7", { base: 0.15 })],
      [
        o("I", { base: 0.3, by: { [IL]: 1 } }),
        o("III", { base: 0.3 }),
        o("i", { base: 0.2 }),
        o("VII", { base: 0.15 }),
      ],
    ],
  },
  {
    name: "the Dorian IV⁷ vamp",
    source:
      "sandra-heaven-can-wait.md §4: no chord instrument, a riff on A♭7 (IV⁷, Dorian), the third " +
      "left to the melody; an A♭9sus4 sound fits as well; the pre-chorus's upper chords over it",
    weight: { verse: { base: 0.05, by: { [HCW]: 1.3 } }, chorus: {} },
    bars: [
      fixed("IV7"),
      [
        // The measured IV⁷ │ IV⁷ is the bank's; the vamp's second bar mostly moves its upper notes,
        // as the pre-chorus does over the same bass.
        o("IV7", { base: 0.05 }),
        o("IV9sus4", { by: { [HCW]: 0.5 } }, "§4: an A♭9sus4 held over both bars fits too"),
        o("III/IV", { by: { [HCW]: 0.35 } }, "§4 pre-chorus bar 1: G♭/A♭"),
        o("VII/IV", { by: { [HCW]: 0.35 } }, "§4 pre-chorus bar 2: D♭/A♭"),
        o("IV7sus4", { base: 0.2 }),
      ],
    ],
  },
  {
    name: "the IV⁷ vamp, 4 bars",
    source: "sandra-heaven-can-wait.md §4: the vamp's riff, its last bar turning before the next",
    weight: { verse: { base: 0.03, by: { [HCW]: 0.8 } }, chorus: {} },
    bars: [
      fixed("IV7"),
      [o("IV7", { base: 1 }), o("IV9sus4", { base: 0.4 })],
      fixed("IV7"),
      [
        o("III/IV", { base: 0.5 }),
        o("VII/IV", { base: 0.5 }),
        o("IV7sus4", { base: 0.4 }),
        o("IV9sus4", { base: 0.3 }),
        o("i", { base: 0.15 }),
      ],
    ],
  },
  {
    name: "Mixolydian, from the v",
    source:
      "sandra-crazy-juliet.md §4 verse, I I I I │ ii │ ♭VII │ I I, read from its chorus's G♯ minor " +
      "(genres.ts 'CJ verse, read from the v'): IV │ IV │ IV │ IV │ v │ III │ IV │ IV",
    weight: { verse: { base: 0.02, by: { [CJ]: 1 } }, chorus: {} },
    bars: [
      fixed("IV"),
      fixed("IV"),
      [o("IV", { base: 1 }), o("IV7", { base: 0.4 })],
      [o("IV", { base: 1 }), o("IV7", { base: 0.3 })],
      [o("v", { base: 1 }), o("VI", { base: 0.3 })],
      [o("III", { base: 1 }), o("I", { base: 0.2 })],
      fixed("IV"),
      [o("IV", { base: 1 }), o("III", { base: 0.2 })],
    ],
  },
  {
    name: "minor vamp",
    source:
      "genres.ts 'minor vamp' i │ i │ ♭VII │ ♭VII; sandra-innocent-love.md §4.1: the intro on i " +
      "and v, the two chords the verse and chorus start from",
    weight: { verse: { base: 0.2 }, chorus: { base: 0.05 } },
    bars: [
      fixed("i"),
      [o("i", { base: 1 }), o("i7", { base: 0.3 })],
      [o("VII", { base: 1 }), o("v", { base: 0.5 }), o("VI", { base: 0.3 })],
      [o("VII", { base: 1 }), o("v", { base: 0.4 }), o("VI", { base: 0.3 })],
    ],
  },
  {
    name: "falling fifths, 14 bars",
    source:
      "sandra-innocent-love.md §4.2: i │ IV sus4 → IV │ ♭VII9sus4 │ ♭III, a chain of falling " +
      "fifths 3½ times round (14 bars); the IV the Dorian one, the ♭VII a hanging 9sus4",
    weight: { verse: {}, chorus: { base: 0.05, by: { [IL]: 1.2 } } },
    bars: [
      [o("i", { base: 1 }), o("i7", { base: 0.15 })],
      [
        o(["IVsus4", "IV"], { base: 0.3, by: { [IL]: 1 } }),
        o("IV", { base: 0.5 }),
        o(["IVsus4", "IV7"], { base: 0.15 }),
        o("iv", { base: 0.15 }),
      ],
      [
        o("VII9sus4", { base: 0.2, by: { [IL]: 1 } }),
        o("VIIsus4", { base: 0.3 }),
        o("VII", { base: 0.5 }),
      ],
      [o("III", { base: 1 }), o("IIIadd9", { base: 0.15 }), o("VI", { base: 0.2 })],
    ],
    cell: {
      repeats: [
        {
          value: 3,
          weight: { base: 0.3, by: { [IL]: 1.2 } },
          source: "§4.1: the chorus is 14 bars",
        },
        { value: 2, weight: { base: 0.4, by: { [IL]: -0.2 } } },
      ],
      tag: [0, 1],
    },
  },
  {
    name: "falling fifths, cadenced",
    source:
      "§4.2's cell twice, then a cadence to the harmonic-minor V (sandra-heaven-can-wait.md §4: " +
      "B♭sus4 → B♭ at every chorus end) or IL's ♭VI–V turn",
    // Not Innocent Love's: its loop never cadences, it runs round and stops (§4.1).
    weight: { verse: {}, chorus: { base: 0.1, by: { [HCW]: 0.3 } } },
    bars: [
      fixed("i"),
      [o(["IVsus4", "IV"], { base: 0.5 }), o("IV", { base: 0.5 }), o("iv", { base: 0.2 })],
      [o("VII", { base: 1 }), o("VII9sus4", { base: 0.4 }), o("VIIsus4", { base: 0.3 })],
      [o("III", { base: 1 }), o("VI", { base: 0.2 })],
    ],
    cell: {
      repeats: [
        { value: 2, weight: { base: 1 } },
        { value: 3, weight: { base: 0.3 } },
      ],
      tag: [
        [o("VI", { base: 1 }), o("iv", { base: 0.6 })],
        [o(["Vsus4", "V"], { base: 1 }), o("V", { base: 0.6 }), o(["VI", "V"], { base: 0.3 })],
      ],
    },
  },
  {
    name: "the tonic and ♭VII, then the cadence",
    source:
      "sandra-heaven-can-wait.md §4 chorus: i i ♭VII ♭VII twice, then iv │ ♭VI │ i │ i │ V sus4 │ " +
      "V (14 bars), the verse's major IV turned minor, the harmonic-minor V at the end",
    weight: { verse: {}, chorus: { base: 0.1, by: { [HCW]: 1.3 } } },
    bars: [
      fixed("i"),
      [o("i", { base: 1 }), o("i7", { base: 0.2 })],
      [o("VII", { base: 1 }), o("VI", { base: 0.3 }), o("v", { base: 0.15 })],
      [o("VII", { base: 1 }), o("VI", { base: 0.3 }), o("III", { base: 0.15 })],
    ],
    cell: {
      repeats: [
        { value: 2, weight: { base: 0.5, by: { [HCW]: 1 } } },
        { value: 1, weight: { base: 0.4 } },
      ],
      tag: [
        [o("iv", { base: 1 }), o("VI", { base: 0.3 })],
        [o("VI", { base: 1 }), o("iv", { base: 0.3 }), o("VII", { base: 0.3 })],
        fixed("i"),
        [o("i", { base: 1 }), o("VII", { base: 0.3 }), o("VI", { base: 0.2 })],
        [o("Vsus4", { base: 1 }), o("iv", { base: 0.3 })],
        [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
      ],
    },
  },
  {
    name: "the climb to i, then the tag",
    source:
      "sandra-crazy-juliet.md §4 chorus read from G♯ minor (genres.ts 'CJ chorus, read from the " +
      "v'): (VI–VII │ i) three times, then the tag VI │ v⁷ │ i sus4 │ ♭VII over the tonic, the " +
      "harmony slowing to a chord a bar",
    weight: { verse: {}, chorus: { base: 0.05, by: { [CJ]: 1.2 } } },
    bars: [
      [
        o(["VI", "VII"], { base: 1 }),
        o(["iv", "VII"], { base: 0.3 }),
        o(["VI", "VIIadd9"], { by: { [CJ]: 0.3 } }, "§4: F♯(add9) from beat 3"),
      ],
      [o("i", { base: 1 }), o("i7", { base: 0.2 })],
    ],
    cell: {
      repeats: [
        { value: 3, weight: { base: 0.3, by: { [CJ]: 1 } } },
        { value: 2, weight: { base: 0.4 } },
      ],
      tag: [
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [o("v7", { base: 1 }), o("iv7", { base: 0.3 }), o("VII", { base: 0.2 })],
        [o("Isus4", { base: 0.5, by: { [CJ]: 1 } }), o("Vsus4", { base: 0.4 })],
        [
          o("VII/i", { base: 0.5, by: { [CJ]: 1 } }),
          o("V", { base: 0.4 }),
          o("VII", { base: 0.3 }),
        ],
      ],
    },
  },
  {
    name: "falling fifths, a 4-bar loop",
    source:
      "sandra-innocent-love.md §4.2: the chorus cell as a plain loop, for a blend's 8-bar chorus " +
      "(Innocent Love's own runs 14 bars)",
    weight: { verse: {}, chorus: { base: 0.1 } },
    bars: [
      fixed("i"),
      [o("IV", { base: 1 }), o(["IVsus4", "IV"], { base: 0.6 }), o("iv", { base: 0.3 })],
      [o("VII", { base: 1 }), o("VII9sus4", { base: 0.4 })],
      [o("III", { base: 1 }), o("VI", { base: 0.4 }), o(["VI", "V"], { base: 0.3 })],
    ],
  },
  {
    name: "Heaven Can Wait in 8",
    source: "sandra-heaven-can-wait.md §4: i │ i │ ♭VII │ ♭VII then iv │ ♭VI │ V sus4 │ V, halved",
    weight: { verse: {}, chorus: { base: 0.1, by: { [HCW]: 0.25 } } },
    bars: [
      fixed("i"),
      fixed("i"),
      [o("VII", { base: 1 }), o("VI", { base: 0.3 })],
      fixed("VII"),
      [o("iv", { base: 1 }), o("VI", { base: 0.4 })],
      [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
      [o("Vsus4", { base: 1 }), o("i", { base: 0.4 })],
      [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
    ],
  },
];

const MINOR_SECTIONS: SectionTraits = {
  interlude: [
    shape(
      "the break on V",
      { base: 0.2, by: { [HCW]: 1 } },
      "sandra-heaven-can-wait.md: the 2-bar break on V without bass (genres.ts 'HCW break on V')",
      [fixed("V"), [o("V", { base: 1 }), o("Vsus4", { base: 0.4 })]],
    ),
    shape(
      "the intro on i and v",
      { base: 0.2, by: { [IL]: 1 } },
      "sandra-innocent-love.md §4.4 intro A: E♭m │ E♭m │ B♭m │ B♭m",
      [
        fixed("i"),
        [o("i", { base: 1 }), o("i7", { base: 0.3 })],
        fixed("v"),
        [o("v", { base: 1 }), o("VII", { base: 0.3 })],
      ],
    ),
    shape(
      "the climb",
      { base: 0.3 },
      "genres.ts 'climb' ♭VI │ ♭VII │ i │ i; IL's intro B: ♭VI │ ♭VII",
      [fixed("VI"), fixed("VII"), fixed("i"), [o("i", { base: 1 }), o("VII", { base: 0.3 })]],
    ),
    shape(
      "the chorus's cell, from the v",
      { by: { [CJ]: 1 } },
      "genres.ts 'CJ chorus loop' read from G♯ minor: VI–VII │ i",
      [[o(["VI", "VII"], { base: 1 })], [o("i", { base: 1 }), o("v", { base: 0.3 })]],
    ),
  ],
  turnaround: [
    shape(
      "the ♭VI–V turn",
      { base: 0.2, by: { [IL]: 1 } },
      "sandra-innocent-love.md §4.3: the turn B │ B♭, ♭VI then the harmonic-minor V",
      [
        [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
        [o("V", { base: 1 }), o("Vsus4", { base: 0.3 })],
      ],
    ),
    shape(
      "the tag on i",
      { base: 0.1, by: { [HCW]: 1 } },
      "sandra-heaven-can-wait.md: the 2-bar tag on i after the chorus",
      [fixed("i"), [o("i", { base: 1 }), o("VII", { base: 0.3 })]],
    ),
    shape("the climb", { base: 0.3 }, "genres.ts 'VI–VII'", [fixed("VI"), fixed("VII")]),
    shape(
      "the tag, from the v",
      { by: { [CJ]: 1 } },
      "sandra-crazy-juliet.md §4 tag read from G♯ minor: i sus4 │ ♭VII over the tonic",
      [
        [o("Isus4", { base: 1 }), o("Vsus4", { base: 0.3 })],
        [o("VII/i", { base: 1 }), o("VII", { base: 0.4 })],
      ],
    ),
  ],
  bridge: [
    shape(
      "Innocent Love's Aeolian bridge",
      { base: 0.05, by: { [IL]: 1.2 } },
      "sandra-innocent-love.md §4.4: ♭VI │ ♭VI–♭VII │ i │ ♭III │ ♭VII │ iv │ ♭III │ i │ ♭VI │ ♭VI, " +
        "the chorus's IV turned minor, no Dorian or harmonic-minor note",
      [
        fixed("VI"),
        [o(["VI", "VII"], { base: 1 }), o("VI", { base: 0.3 })],
        fixed("i"),
        [o("III", { base: 1 }), o("VI", { base: 0.3 })],
        [o("VII", { base: 1 }), o("v", { base: 0.3 })],
        [o("iv", { base: 1 }), o("VI", { base: 0.2 })],
        [o("III", { base: 1 }), o("VII", { base: 0.3 })],
        [o("i", { base: 1 }), o("v", { base: 0.2 })],
        fixed("VI"),
        [o("VI", { base: 1 }), o("VII", { base: 0.4 })],
      ],
    ),
    shape("subdominant", { base: 0.4 }, "genres.ts 'subdominant': iv │ VI │ VII │ i", [
      [o("iv", { base: 1 }), o("IV", { base: 0.3 })],
      [o("VI", { base: 1 }), o("iv", { base: 0.3 })],
      [o("VII", { base: 1 }), o("V", { base: 0.4 })],
      [o("i", { base: 0.6 }), o("VII", { base: 0.4 }), o("V", { base: 0.5 })],
    ]),
    shape(
      "over the IV pedal",
      { base: 0.1, by: { [HCW]: 1 } },
      "sandra-heaven-can-wait.md §4 pre-chorus: G♭ → D♭ → A♭ over the A♭, falling by fifths",
      [
        [o("III/IV", { base: 1 }), o("VI/IV", { base: 0.3 })],
        [o("VII/IV", { base: 1 }), o("III/IV", { base: 0.2 })],
        fixed("IV"),
        [o("IV7", { base: 1 }), o("V", { base: 0.4 })],
      ],
    ),
  ],
  approach: [
    {
      interval: 5,
      weight: { base: 0.4, by: { [HCW]: 0.8 } },
      source: "sandra-heaven-can-wait.md: the tag's i into the verse's IV⁷; V → i",
    },
    {
      interval: 7,
      weight: { base: 0.3, by: { [IL]: 0.5 } },
      source: "i → v: into Innocent Love's verse on the v pedal",
    },
    {
      interval: 9,
      weight: { base: 0.1, by: { [IL]: 0.6 } },
      source: "sandra-innocent-love.md §4.4: the link's D♭ (♭VII) into the verse's B♭m",
    },
    { interval: 2, weight: { base: 0.4 }, source: "♭VII → i" },
    { interval: 11, weight: { base: 0.1, by: { [CJ]: 0.3 } }, source: "♭VI → v, down a semitone" },
    {
      interval: 10,
      weight: { base: 0.1, by: { [CJ]: 0.5 } },
      source: "v → IV, CJ's tag into its verse, from the v",
    },
  ],
  palette: ["VII", "V", "VI", "iv", "i", "v", "III", "IV7"],
};

const MINOR: ModeTraits = {
  schemas: MINOR_SCHEMAS,
  cadences: {
    verse: [cad("VII", { base: 0.5 }), cad("v", { base: 0.4 }), cad("i", { base: 0.3 })],
    chorus: [
      cad("V", { base: 0.5 }),
      cad(["Vsus4", "V"], { base: 0.4, by: { [HCW]: 0.5 } }),
      cad("III", { base: 0.3, by: { [IL]: 0.5 } }),
      cad("VII", { base: 0.3 }),
    ],
  },
  colours: [
    colour(
      "IV",
      ["IVsus4", "IV"],
      { by: { [IL]: 0.6 } },
      "sandra-innocent-love.md §4.2: A♭sus4 → A♭",
    ),
    colour("VII", "VII9sus4", { by: { [IL]: 0.5 } }, "§4.2: D♭9sus4"),
    colour(
      "III",
      "IIIadd9",
      { by: { [CJ]: 0.4 } },
      "sandra-crazy-juliet.md §4 pre-chorus: E(add9)",
    ),
    colour("VI", "VIadd9", { by: { [CJ]: 0.3 } }, "CJ's pre-chorus read from its v"),
    colour("i", "i7", { by: { [HCW]: 0.3, [IL]: 0.2 } }, "IL's link on E♭m7"),
  ],
  colourChance: { base: 0.05, by: { [IL]: 0.3, [CJ]: 0.3, [HCW]: 0.1 } },
  colourChords: ["V", "I", "II"],
  colourPerLine: 2,
  anticipate: {},
  secondLine: {
    verse: [line("repeat", { base: 1 }), line("answer", { base: 0.15 })],
    chorus: [line("repeat", { base: 1 }), line("answer", { base: 0.3 })],
  },
  prechorus: {
    source:
      "sandra-heaven-can-wait.md §4 (the upper chords fall by fifths over the IV pedal, handing the " +
      "chorus a IV); sandra-innocent-love.md §4.3 (i │ viø7 twice, then the ♭VI │ V turn); " +
      "sandra-crazy-juliet.md §4 (iv → ♭III(add9) → ♭VII → IV⁷sus4 → IV⁷ stop), read from its v",
    long: [
      {
        name: "falling fifths over the IV pedal",
        weight: { base: 0.3, by: { [HCW]: 1 } },
        bars: [
          [o("III/IV", { base: 1 }), o("VI/IV", { base: 0.2 })],
          [o("VII/IV", { base: 1 }), o("III/IV", { base: 0.2 })],
          [o("IV", { base: 1 }), o("IV7", { base: 0.3 })],
          [o("IV", { base: 1 }), o("IVsus4", { base: 0.3 })],
          [o("III/IV", { base: 1 }), o("VII/IV", { base: 0.2 })],
          [o("VII/IV", { base: 1 }), o("III/IV", { base: 0.2 })],
        ],
      },
    ],
    longWeight: { base: 0.03, by: { [HCW]: 0.8 } },
    short: [
      {
        name: "i and its Dorian 6th",
        weight: { base: 0.3, by: { [IL]: 1 } },
        bars: [
          fixed("i"),
          [
            o("viø7", { base: 0.5, by: { [IL]: 1 } }),
            o("iv", { base: 0.4 }),
            o("ii", { base: 0.2 }),
          ],
          fixed("i"),
          [
            o("viø7", { base: 0.5, by: { [IL]: 1 } }),
            o("iv", { base: 0.4 }),
            o("VI", { base: 0.2 }),
          ],
        ],
      },
      {
        name: "the build, from the v",
        weight: { base: 0.2, by: { [CJ]: 1 } },
        bars: [
          [o("vii", { by: { [CJ]: 1 } }), o("iv", { base: 0.5 })],
          [o("VIadd9", { by: { [CJ]: 1 } }), o("VI", { base: 0.5 })],
          [o("III", { base: 1 }), o("VII", { base: 0.3 })],
        ],
      },
      {
        name: "subdominant build",
        weight: { base: 0.3 },
        bars: [
          [o("iv", { base: 1 }), o("VI", { base: 0.6 })],
          [o("VI", { base: 1 }), o("VII", { base: 0.6 })],
        ],
      },
    ],
    susDelay: { base: 0.5 },
    deceptive: {},
    endings: [
      {
        value: [["IV"], ["IV"]],
        weight: { by: { [HCW]: 1 } },
        leads: [7],
        source: "HCW: the pre-chorus hands the chorus's i a IV",
      },
      {
        value: [["VI"], ["V"]],
        weight: { base: 0.3, by: { [IL]: 1 } },
        leads: [5],
        source: "IL's turn ♭VI │ V into i",
      },
      {
        value: [["VII7sus4"], ["VII7"]],
        weight: { by: { [CJ]: 1 } },
        // Into the chorus's ♭VI–♭VII, down a step.
        leads: [10],
        source: "CJ's IV⁷sus4 │ IV⁷ stop, from the v",
      },
      { value: [["Vsus4"], ["V"]], weight: { base: 0.3 }, leads: [5, 1] },
      { value: [["iv"], ["V"]], weight: { base: 0.2 }, leads: [5, 1] },
    ],
    endingWeight: { base: 1 },
    byShape: true,
    fromVerse: true,
  },
  sections: MINOR_SECTIONS,
  maxHold: { verse: 4, chorus: 2 },
  rhythmContrast: { base: 0.3, by: { [IL]: 0.7, [HCW]: 0.7 } },
};

// ── Major: Crazy Juliet, and the other two read in a major key ───────────────────────────────

const MAJOR_SCHEMAS: Schema[] = [
  {
    name: "Mixolydian verse",
    source:
      "sandra-crazy-juliet.md §4 verse: I I I I │ ii │ ♭VII │ I I, the bass's B pickup the ♭7 " +
      "(Mixolydian)",
    weight: { verse: { base: 0.1, by: { [CJ]: 1.3 } }, chorus: {} },
    bars: [
      fixed("I"),
      fixed("I"),
      [o("I", { base: 1 }), o("I7", { base: 0.3 }, "§4: the bass's B pickup")],
      [o("I", { base: 1 }), o("I7", { base: 0.4 })],
      [o("ii", { base: 1 }), o("IV", { base: 0.3 }), o("vi", { base: 0.2 })],
      [o("VII", { base: 1 }), o("IV", { base: 0.3 }), o("V", { base: 0.15 })],
      fixed("I"),
      [o("I", { base: 1 }), o("VII", { base: 0.2 })],
    ],
  },
  {
    name: "Mixolydian verse, 4 bars",
    source: "§4 verse, its second half as a loop: I │ I │ ii │ ♭VII",
    weight: { verse: { base: 0.1, by: { [CJ]: 0.5 } }, chorus: {} },
    bars: [
      fixed("I"),
      [o("I", { base: 1 }), o("I7", { base: 0.4 })],
      [o("ii", { base: 1 }), o("IV", { base: 0.4 })],
      [o("VII", { base: 1 }), o("IV", { base: 0.3 })],
    ],
  },
  {
    name: "over the V pedal",
    source: "sandra-innocent-love.md §4.3 in a major key: the verse over the dominant",
    weight: { verse: { base: 0.05, by: { [IL]: 1 } }, chorus: {} },
    pedal: "V",
    bars: [
      fixed("V"),
      [o("ii7", { base: 1 }), o("IV", { base: 0.4 })],
      fixed("V"),
      [o("I", { base: 1 }), o("IV", { base: 0.3 })],
    ],
  },
  {
    name: "the IV vamp",
    source: "sandra-heaven-can-wait.md §4 in a major key: a vamp on the IV, its 7th from the riff",
    weight: { verse: { base: 0.05, by: { [HCW]: 1 } }, chorus: {} },
    bars: [fixed("IV"), [o("IV7", { base: 1 }), o("IV", { base: 0.5 })]],
  },
  {
    name: "Crazy Juliet's chorus",
    source:
      "sandra-crazy-juliet.md §4 chorus: (♭III │ IV, v) three times, then the tag ♭III │ ii⁷ │ " +
      "V sus4 │ V¹¹ (F♯ over G♯), the harmony slowing to a chord a bar (10 bars)",
    weight: { verse: {}, chorus: { base: 0.1, by: { [CJ]: 1.3 } } },
    bars: [
      [
        o(["III", "IV"], { base: 1 }),
        o(["III", "IVadd9"], { by: { [CJ]: 0.3 } }, "§4: F♯(add9) from beat 3"),
        o(["ii", "IV"], { base: 0.1 }),
      ],
      [o("v", { base: 1 }), o("vi", { base: 0.3 }), o("ii", { base: 0.15 })],
    ],
    cell: {
      repeats: [
        { value: 3, weight: { base: 0.3, by: { [CJ]: 1 } } },
        { value: 2, weight: { base: 0.4 } },
      ],
      tag: [
        [o("III", { base: 1 }), o("IV", { base: 0.3 })],
        [o("ii7", { base: 1 }), o("IV", { base: 0.3 }), o("vi7", { base: 0.2 })],
        [o("Vsus4", { base: 1 }), o("ii7", { base: 0.2 })],
        [
          o("IV/V", { base: 0.5, by: { [CJ]: 1 } }),
          o("V", { base: 0.4 }),
          o(["Vsus4", "V"], { base: 0.3 }),
        ],
      ],
    },
  },
  {
    name: "falling fifths, in major",
    source: "sandra-innocent-love.md §4.2 in a major key: I │ IV │ ♭VII │ ♭III",
    weight: { verse: {}, chorus: { base: 0.05, by: { [IL]: 1 } } },
    bars: [
      fixed("I"),
      [o(["IVsus4", "IV"], { base: 1 }), o("IV", { base: 0.6 })],
      [o("VII", { base: 1 }), o("VII9sus4", { base: 0.4 })],
      [o("III", { base: 0.6 }), o("vi", { base: 0.4 })],
    ],
    cell: {
      repeats: [
        { value: 3, weight: { base: 0.5, by: { [IL]: 1 } } },
        { value: 2, weight: { base: 0.5 } },
      ],
      tag: [0, 1],
    },
  },
  {
    name: "the tonic and ♭VII, in major",
    source: "sandra-heaven-can-wait.md §4 chorus in a major key: I I ♭VII ♭VII, then the cadence",
    weight: { verse: {}, chorus: { base: 0.05, by: { [HCW]: 1 } } },
    bars: [fixed("I"), fixed("I"), [o("VII", { base: 1 }), o("IV", { base: 0.4 })], fixed("VII")],
    cell: {
      repeats: [
        { value: 2, weight: { base: 1 } },
        { value: 1, weight: { base: 0.4 } },
      ],
      tag: [
        [o("IV", { base: 1 }), o("ii", { base: 0.4 })],
        [o("vi", { base: 0.6 }), o("VI", { base: 0.4 })],
        fixed("I"),
        fixed("I"),
        [o("Vsus4", { base: 1 }), o("IV", { base: 0.3 })],
        fixed("V"),
      ],
    },
  },
  {
    name: "Mixolydian loop",
    source: "genres.ts 'CJ verse turn' ii │ ♭VII │ I │ I, as a 4-bar chorus loop",
    weight: { verse: { base: 0.03 }, chorus: { base: 0.15 } },
    bars: [
      fixed("I"),
      [o("VII", { base: 1 }), o("ii", { base: 0.4 })],
      [o("IV", { base: 1 }), o(["III", "IV"], { base: 0.4 })],
      [o("V", { base: 0.6 }), o(["Vsus4", "V"], { base: 0.5 }), o("IV/V", { base: 0.3 })],
    ],
  },
];

const MAJOR_SECTIONS: SectionTraits = {
  interlude: [
    shape("the chorus's cell", { base: 0.2, by: { [CJ]: 1 } }, "genres.ts 'CJ chorus loop'", [
      [o(["III", "IV"], { base: 1 })],
      [o("v", { base: 1 }), o("vi", { base: 0.3 })],
    ]),
    shape("the climb", { base: 0.3 }, "genres.ts 'climb', in a major key", [
      fixed("VI"),
      fixed("VII"),
      fixed("I"),
      fixed("I"),
    ]),
    shape("the verse's turn", { base: 0.2 }, "sandra-crazy-juliet.md §4: ii │ ♭VII │ I │ I", [
      fixed("I"),
      fixed("I"),
      [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
      fixed("VII"),
    ]),
  ],
  turnaround: [
    shape(
      "the tag",
      { base: 0.2, by: { [CJ]: 1 } },
      "sandra-crazy-juliet.md §4: G♯sus4 │ G♯7sus4 (F♯/G♯), V¹¹ → I into verse 2",
      [[o("Vsus4", { base: 1 })], [o("IV/V", { base: 1 }), o("V", { base: 0.4 })]],
    ),
    shape("♭VI–♭VII", { base: 0.3 }, "genres.ts 'VI–VII' in a major key", [
      fixed("VI"),
      fixed("VII"),
    ]),
    shape("into the dominant", { base: 0.3 }, "a pre-dominant and V into I", [
      [o("IV", { base: 1 }), o("ii", { base: 0.5 })],
      [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.5 })],
    ]),
  ],
  bridge: [
    shape("the verse's turn", { base: 0.3, by: { [CJ]: 0.6 } }, "genres.ts 'CJ verse turn'", [
      fixed("ii"),
      fixed("VII"),
      fixed("I"),
      [o("I", { base: 1 }), o("V", { base: 0.3 })],
    ]),
    shape("subdominant", { base: 0.4 }, "plan §4.2: a bridge visits the subdominant side", [
      fixed("IV"),
      [o("vi", { base: 0.6 }), o("iv", { base: 0.4 })],
      [o("ii", { base: 1 }), o("IV", { base: 0.3 })],
      [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.3 })],
    ]),
  ],
  approach: [
    { interval: 5, weight: { base: 0.6 }, source: "V → I" },
    {
      interval: 7,
      weight: { base: 0.4, by: { [CJ]: 0.6 } },
      source: "CJ's tag: F♯ over G♯ into C♯, a IV → I over the dominant bass",
    },
    { interval: 2, weight: { base: 0.4 }, source: "♭VII → I" },
    { interval: 1, weight: { base: 0.05 } },
  ],
  palette: ["V", "IV", "ii", "VII", "vi", "I"],
};

const MAJOR: ModeTraits = {
  schemas: MAJOR_SCHEMAS,
  cadences: {
    verse: [cad("VII", { base: 0.5 }), cad("I", { base: 0.3 }), cad("V", { base: 0.3 })],
    chorus: [
      cad("V", { base: 0.6 }),
      cad(["Vsus4", "V"], { base: 0.4 }),
      cad("IV/V", { base: 0.3 }),
    ],
  },
  colours: [
    colour("III", "IIIadd9", { by: { [CJ]: 0.4 } }, "sandra-crazy-juliet.md §4: E(add9)"),
    colour("IV", ["IVsus4", "IV"], { by: { [IL]: 0.4 } }, "IL's sus4 → IV"),
  ],
  colourChance: { base: 0.05, by: { [CJ]: 0.3, [IL]: 0.2 } },
  // Crazy Juliet's ♭III and minor v are its chorus's own chords, not colours.
  colourChords: ["VI", "iv"],
  colourPerLine: 3,
  anticipate: {},
  secondLine: {
    verse: [line("repeat", { base: 1 }), line("answer", { base: 0.15 })],
    chorus: [line("repeat", { base: 1 }), line("answer", { base: 0.3 })],
  },
  prechorus: {
    source:
      "sandra-crazy-juliet.md §4 pre-chorus: iv │ ♭III(add9) │ ♭VII │ IV⁷sus4 │ IV⁷, the 5th a stop " +
      "bar, iv → IV⁷ on the same root, the IV⁷ resolving to the chorus's ♭III",
    long: [
      {
        name: "over the IV pedal, in major",
        weight: { base: 0.3, by: { [HCW]: 1 } },
        bars: [
          [o("III/IV", { base: 1 }), o("VI/IV", { base: 0.3 })],
          [o("VII/IV", { base: 1 }), o("III/IV", { base: 0.2 })],
          fixed("IV"),
          [o("IV", { base: 1 }), o("IV7", { base: 0.3 })],
          [o("III/IV", { base: 1 }), o("ii/IV", { base: 0.3 })],
          [o("VII/IV", { base: 1 }), o("IV", { base: 0.3 })],
        ],
      },
    ],
    longWeight: { base: 0.03, by: { [HCW]: 0.6 } },
    short: [
      {
        name: "Crazy Juliet's build",
        weight: { base: 0.3, by: { [CJ]: 1 } },
        bars: [
          [o("iv", { by: { [CJ]: 1 } }, "§4: F♯m by ear"), o("ii", { base: 0.5 })],
          [o("IIIadd9", { by: { [CJ]: 1 } }), o("III", { base: 0.3 }), o("IV", { base: 0.3 })],
          [o("VII", { base: 1 }), o("IV", { base: 0.2 })],
        ],
      },
      {
        name: "subdominant build",
        weight: { base: 0.3 },
        bars: [
          [o("IV", { base: 1 }), o("ii", { base: 0.6 })],
          [o("vi", { base: 1 }), o("IV", { base: 0.4 })],
        ],
      },
    ],
    susDelay: { base: 0.5 },
    deceptive: {},
    endings: [
      {
        value: [["IV7sus4"], ["IV7"]],
        weight: { base: 0.1, by: { [CJ]: 1 } },
        // §4: the IV⁷ resolves to the chorus's ♭III, not to the I.
        leads: [10],
        source: "CJ: IV⁷sus4 │ IV⁷, the stop bar",
      },
      { value: [["Vsus4"], ["V"]], weight: { base: 0.4 }, leads: [5, 1] },
      {
        value: [["VI"], ["V"]],
        weight: { by: { [IL]: 0.6 } },
        leads: [5],
        source: "IL's ♭VI │ V turn, in major",
      },
      {
        value: [["IV"], ["IV"]],
        weight: { by: { [HCW]: 1 } },
        leads: [7],
        source: "HCW: the IV handed to the chorus's I",
      },
    ],
    endingWeight: { base: 1 },
    byShape: true,
    fromVerse: true,
  },
  sections: MAJOR_SECTIONS,
  maxHold: { verse: 4, chorus: 2 },
  rhythmContrast: { base: 0.3, by: { [CJ]: 0.5, [IL]: 0.5, [HCW]: 0.5 } },
};

const LIFT: SectionShape[] = [
  shape("I–IV–V", { base: 1 }, "genres.ts 'lift I–IV–V': Euro's bank lift", [
    fixed("I"),
    [o("IV", { base: 1 }), o(["III", "IV"], { by: { [CJ]: 0.5 } })],
    [o("I", { base: 1 }), o("vi", { base: 0.2 })],
    [o("V", { base: 1 }), o(["Vsus4", "V"], { base: 0.4 })],
  ]),
];

export const EURO_HARMONY: HarmonyAnalysis = {
  modes: { minor: MINOR, major: MAJOR },
  motion: {
    source:
      "sandra-innocent-love.md §4.2: the chorus falls by fifths; sandra-heaven-can-wait.md §4: the " +
      "pre-chorus's upper chords fall by fifths, the chorus holds i and ♭VII two bars each; " +
      "sandra-crazy-juliet.md §4: the ♭III–IV–v climb, the verse holds I for four bars",
    step: { base: 1 },
    fourth: { base: 1.1, by: { [IL]: 0.2 } },
    // IL §4.2: "Back to E♭m is a rising minor third", and its pre-chorus's i → viø7 falls one;
    // CJ §4: the chorus cell's v falls a third to ♭III every other bar.
    third: { base: 0.5, by: { [IL]: 0.4, [CJ]: 0.5 } },
    // HCW's chorus holds i and ♭VII two bars each; CJ's verse holds I for four.
    hold: { base: 0.3, by: { [HCW]: 0.9, [CJ]: 0.4 } },
    tritone: { base: 0.05 },
  },
  quote: { base: 0.12 },
  quoteChorus: 0.7,
  formPlays: [],
  lift: LIFT,
  quoteSections: {
    chance: 0.5,
    loops: {
      [IL]: {
        turnaround: [["VI"], ["V"]],
        bridge: [
          ["VI"],
          ["VI", "VII"],
          ["i"],
          ["III"],
          ["VII"],
          ["iv"],
          ["III"],
          ["i"],
          ["VI"],
          ["VI"],
        ],
      },
      [HCW]: { interlude: [["V"], ["V"]], turnaround: [["i"], ["i"]] },
      [CJ]: { turnaround: [["Vsus4"], ["IV/V"]] },
    },
  },
};
