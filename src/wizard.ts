/**
 * The "create new song" wizard: choose the style, key, tempo, drum machine, bass figure, the verse
 * and chorus progressions (from the measured bank or chord by chord), the length and the ending,
 * then generate. The result is a creation (spec.ts), so it can be shared and edited further.
 */
import {
  BASS_STYLES,
  compose,
  isBassStyle,
  type BassStyle,
  type KitName,
  type Song,
  type SongEnding,
  type SongForm,
} from "./composer";
import { BlendPad, initials, weightsSummary } from "./blendpad";
import { KIT_LABELS } from "./drums";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  isGenreId,
  parseWeights,
  referenceWeights,
  styleName,
  styleOf,
  weightOf,
  weightsAtPoint,
  type GenreId,
} from "./genres";
import { CENTRE } from "./polygon";
import type { BankEntry, Progression } from "./progressions";
import { randomSeed } from "./rng";
import { CHORD_CHOICES, KITS, songToSpec, type Creation } from "./spec";
import { chord, chordName, keyName, type Key } from "./theory";

export interface WizardChoices {
  title: string;
  /** The genre the song is generated in (genres.ts). */
  genre: GenreId;
  /** That genre's references' weights (genres.ts), set with the style polygon. */
  weights: number[];
  /** The generator picks a point per song (the triangle keeps the last fixed one). */
  styleAuto: boolean;
  tonic: number;
  /** null = the generator picks (116–121 BPM). */
  bpm: number | null;
  kit: KitName | "auto";
  bassStyle: BassStyle | "auto";
  verse: Progression;
  chorus: Progression;
  form: SongForm;
  ending: "auto" | SongEnding;
}

const STORE_KEY = "infinite-synthpop:wizard:v1";
/** The wizard generates in minor keys; picking a major key comes later. */
const minorOnly = (entries: readonly BankEntry[]) =>
  entries.filter((e) => (e.mode ?? "minor") === "minor");

/** A genre's verse and chorus presets. */
function bankOf(genre: GenreId): Record<"verse" | "chorus", BankEntry[]> {
  const { bank } = GENRES[genre];
  return { verse: minorOnly(bank.verse), chorus: minorOnly(bank.chorus) };
}

/** "TF 30 · DS 30 · YC 40" for a genre's weights. */
function weightsLabel(genre: GenreId, weights: readonly number[]): string {
  const names = GENRES[genre].references.map(styleName);
  return weightsSummary(names, initials(names), weights);
}

function defaults(genre: GenreId = DEFAULT_GENRE): WizardChoices {
  const bank = bankOf(genre);
  return {
    title: "",
    genre,
    weights: weightsAtPoint(GENRES[genre], CENTRE),
    styleAuto: true,
    tonic: 2,
    bpm: null,
    kit: "auto",
    bassStyle: "auto",
    verse: bank.verse[0]?.bars ?? [["i"], ["VI"], ["VII"], ["v"]],
    chorus: bank.chorus[0]?.bars ?? [["i"], ["III"], ["VII"], ["IV"]],
    form: "standard",
    ending: "auto",
  };
}

function load(): WizardChoices {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaults();
    const stored = JSON.parse(raw) as Partial<WizardChoices> & { style?: unknown };
    // Saved before genres: synthpop.
    const genre = isGenreId(stored.genre) ? stored.genre : DEFAULT_GENRE;
    // Saved before the triangle: only a style, which plays as [1 − style, style, 0].
    const style = typeof stored.style === "number" ? Math.min(1, Math.max(0, stored.style)) : null;
    const weights =
      parseWeights(GENRES[genre], stored.weights) ??
      (style === null ? defaults(genre).weights : [...referenceWeights(GENRES[genre], style)]);
    delete stored.style;
    return { ...defaults(genre), ...stored, genre, weights };
  } catch {
    return defaults();
  }
}

function save(c: WizardChoices): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    // Not saved; the wizard just starts from its defaults next time.
  }
}

/** Generates a song from the wizard's choices, as a creation. */
export function generateFromChoices(c: WizardChoices, seed = randomSeed()): Creation {
  const song: Song = compose({
    seed,
    genre: c.genre,
    weights: c.styleAuto ? "auto" : c.weights,
    key: { tonic: c.tonic, mode: "minor" },
    bpm: c.bpm,
    kit: c.kit,
    progressions: { verse: c.verse, chorus: c.chorus },
    form: c.form,
    ...(c.ending === "auto" ? {} : { ending: c.ending }),
    ...(c.bassStyle === "auto" ? {} : { bassStyle: c.bassStyle }),
  });
  const spec = songToSpec(song);
  if (c.title.trim()) spec.title = c.title.trim().slice(0, 60);
  return { seed, spec };
}

export function mountWizard(
  dialog: HTMLDialogElement,
  onCreate: (c: Creation) => void,
): () => void {
  let choices = load();

  function render(): void {
    const c = choices;
    const key: Key = { tonic: c.tonic, mode: "minor" };
    const form = el("form", "wizard");
    form.method = "dialog";

    const heading = el("h3");
    heading.textContent = "Create a new song";

    const title = el("input");
    title.type = "text";
    title.placeholder = "Title (generated if left empty)";
    title.value = c.title;
    title.addEventListener("input", () => (choices.title = title.value));

    const genre = select(
      GENRE_IDS.map((id): [string, string] => [id, GENRES[id].name]),
      c.genre,
      (v) => {
        if (!isGenreId(v) || v === choices.genre) return;
        // Another genre has other references: its polygon starts from the centre.
        choices.genre = v;
        choices.weights = weightsAtPoint(GENRES[v], CENTRE);
        render();
      },
    );

    const styleOut = el("output");
    styleOut.value = c.styleAuto ? "" : weightsLabel(c.genre, c.weights);
    const style = new BlendPad({
      names: GENRES[c.genre].references.map(styleName),
      weights: c.weights,
      label: "Style",
      onInput: (w) => (styleOut.value = weightsLabel(c.genre, w)),
      onChange: (w) => {
        choices.weights = w;
        styleOut.value = weightsLabel(c.genre, w);
        // Re-rank the presets for the new style (only them: the pad keeps its focus).
        refreshPickers();
      },
    });
    style.disabled = c.styleAuto;
    const styleAuto = el("label", "wizard-radios");
    const styleAutoBox = el("input");
    styleAutoBox.type = "checkbox";
    styleAutoBox.checked = c.styleAuto;
    styleAutoBox.addEventListener("change", () => {
      choices.styleAuto = styleAutoBox.checked;
      render();
    });
    styleAuto.append(styleAutoBox, " Auto (a new point each song)");

    const tonic = select(
      Array.from({ length: 12 }, (_, t) => [String(t), keyName({ tonic: t, mode: "minor" })]),
      String(c.tonic),
      (v) => {
        choices.tonic = Number(v);
        render();
      },
    );
    const bpm = el("input");
    bpm.type = "number";
    bpm.min = "60";
    bpm.max = "160";
    bpm.step = "0.5";
    bpm.placeholder = "auto";
    bpm.value = c.bpm === null ? "" : String(c.bpm);
    bpm.title = "Leave empty for 116–121 BPM (the originals: 117 and 119.8)";
    bpm.addEventListener("change", () => {
      const v = Number(bpm.value);
      choices.bpm = bpm.value && Number.isFinite(v) ? Math.min(160, Math.max(60, v)) : null;
    });
    const kit = select(
      [["auto", "Auto"], ...KITS.map((k): [string, string] => [k, KIT_LABELS[k]])],
      c.kit,
      (v) => (choices.kit = (KITS as readonly string[]).includes(v) ? (v as KitName) : "auto"),
    );
    const bass = select(
      [["auto", "Auto (by style)"], ...BASS_STYLES],
      c.bassStyle,
      (v) => (choices.bassStyle = isBassStyle(v) ? v : "auto"),
    );

    const formPick = radios(
      "form",
      [
        ["short", "Short (~2½ min)"],
        ["standard", "Standard (~4 min)"],
        ["long", "Long (~5 min)"],
      ],
      c.form,
      (v) => (choices.form = v === "short" || v === "long" ? v : "standard"),
    );
    const ending = select(
      [
        ["auto", "Auto (by style)"],
        ["lift", "Lift to the major IV (True Faith)"],
        ["fade", "Chorus to fade (The Different Story)"],
        ["hold", "Hold IV (You Came)"],
      ],
      c.ending,
      (v) => (choices.ending = v === "lift" || v === "fade" || v === "hold" ? v : "auto"),
    );

    const actions = el("div", "wizard-actions");
    const cancel = el("button", "btn");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close());
    const go = el("button", "btn primary");
    go.type = "submit";
    go.textContent = "Generate";
    actions.append(cancel, go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      save(choices);
      dialog.close();
      onCreate(generateFromChoices(choices));
    });

    let verse = progressionPicker("Verse chords", "verse", key);
    let chorus = progressionPicker("Chorus chords", "chorus", key);
    const refreshPickers = () => {
      const [v, ch] = [
        progressionPicker("Verse chords", "verse", key),
        progressionPicker("Chorus chords", "chorus", key),
      ];
      verse.replaceWith(v);
      chorus.replaceWith(ch);
      [verse, chorus] = [v, ch];
    };

    // A div, not a label: a click on the pad mustn't toggle the auto box.
    const styleField = el("div", "wizard-field wizard-style");
    const styleHead = el("span", "wizard-style-head");
    const styleTitle = el("span");
    styleTitle.textContent = "Style";
    styleHead.append(styleTitle, styleOut);
    styleField.append(styleHead, style.element, styleAuto);

    form.append(
      heading,
      title,
      field("Genre", genre),
      styleField,
      row(field("Key", tonic), field("Tempo", bpm), field("Drums", kit), field("Bass", bass)),
      verse,
      chorus,
      row(field("Length", formPick), field("Ending", ending)),
      actions,
    );
    dialog.replaceChildren(form);
  }

  /** A preset select (ranked by closeness to the style, unless it's auto) over editable per-bar
   * chord pickers. */
  function progressionPicker(label: string, kind: "verse" | "chorus", key: Key): HTMLElement {
    const current = choices[kind];
    const bank = bankOf(choices.genre)[kind];
    const presets = choices.styleAuto
      ? bank
      : bank.sort(
          (a, b) =>
            closeness(choices.genre, b, choices.weights) -
            closeness(choices.genre, a, choices.weights),
        );
    const match = presets.findIndex((p) => same(p.bars, current));
    const preset = select(
      [
        ...presets.map((p, i): [string, string] => [String(i), `${p.name}: ${names(p.bars, key)}`]),
        ["custom", "Custom"],
      ],
      match >= 0 ? String(match) : "custom",
      (v) => {
        const p = presets[Number(v)];
        if (p) choices[kind] = p.bars.map((b) => [...b]);
        render();
      },
    );
    preset.className = "wizard-preset";

    const options = (none: boolean): [string, string][] => [
      ...(none ? ([["", "+ half"]] as [string, string][]) : []),
      ...CHORD_CHOICES.minor.map((n): [string, string] => [
        n,
        `${chordName(key, chord(n))} · ${n}`,
      ]),
    ];
    const bars = el("div", "wizard-bars");
    current.forEach((bar, b) => {
      const cell = el("div", "wizard-bar");
      const first = select(options(false), bar[0] ?? "i", (v) => {
        choices[kind] = current.map((x, j) => (j === b ? [v, ...x.slice(1)] : x));
        render();
      });
      const second = select(options(true), bar[1] ?? "", (v) => {
        choices[kind] = current.map((x, j) => (j !== b ? x : v ? [x[0] ?? "i", v] : [x[0] ?? "i"]));
        render();
      });
      const remove = el("button", "chord-remove");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove this bar";
      remove.disabled = current.length === 1;
      remove.addEventListener("click", () => {
        choices[kind] = current.filter((_, j) => j !== b);
        render();
      });
      cell.append(first, second, remove);
      bars.append(cell);
    });
    const add = el("button", "btn small");
    add.type = "button";
    add.textContent = "+";
    add.title = "Add a bar";
    add.disabled = current.length >= 16;
    add.addEventListener("click", () => {
      choices[kind] = [...current, [...(current.at(-1) ?? ["i"])]];
      render();
    });
    bars.append(add);

    const box = el("fieldset", "wizard-progression");
    const legend = el("legend");
    legend.textContent = label;
    box.append(legend, preset, bars);
    return box;
  }

  return () => {
    choices = load();
    render();
    dialog.showModal();
  };
}

/** How well a bank entry fits the weights: an entry on the first two references' axis by its
 * distance along it, scaled by their share; one leaning to a reference by that one's weight. */
function closeness(genre: GenreId, e: BankEntry, weights: readonly number[]): number {
  if (e.ref) return weightOf(GENRES[genre], weights, e.ref);
  const axis = (weights[0] ?? 0) + (weights[1] ?? 0);
  return (1 - Math.abs((e.style ?? 0.5) - styleOf(weights))) * axis;
}

function names(p: Progression, key: Key): string {
  return p.map((bar) => bar.map((n) => chordName(key, chord(n))).join(" ")).join(" │ ");
}

function same(a: Progression, b: Progression): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function row(...children: HTMLElement[]): HTMLElement {
  const r = el("div", "wizard-row");
  r.append(...children);
  return r;
}

function field(text: string, ...controls: HTMLElement[]): HTMLElement {
  const l = el("label", "wizard-field");
  const span = el("span");
  span.textContent = text;
  l.append(span, ...controls);
  return l;
}

function select(
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = el("select");
  for (const [v, text] of options) s.append(new Option(text, v));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function radios(
  name: string,
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const box = el("div", "wizard-radios");
  for (const [v, text] of options) {
    const label = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = v;
    input.checked = v === value;
    input.addEventListener("change", () => input.checked && onChange(v));
    label.append(input, ` ${text}`);
    box.append(label);
  }
  return box;
}
