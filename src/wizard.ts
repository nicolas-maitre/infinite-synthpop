/**
 * The "create new song" wizard: choose the style, key, tempo, drum machine, bass figure, the verse
 * and chorus progressions (from the measured bank or chord by chord), the length and the ending,
 * then generate. The result is a creation (spec.ts), so it can be shared and edited further.
 */
import { compose, type BassStyle, type KitName, type Song, type SongForm } from "./composer";
import { KIT_LABELS } from "./drums";
import { BANK, type Progression } from "./progressions";
import { randomSeed } from "./rng";
import { CHORD_CHOICES, KITS, songToSpec, type Creation } from "./spec";
import { chord, chordName, keyName, type Key } from "./theory";

export interface WizardChoices {
  title: string;
  style: number;
  tonic: number;
  /** null = the generator picks (115–120 BPM). */
  bpm: number | null;
  kit: KitName | "auto";
  bassStyle: BassStyle | "auto";
  verse: Progression;
  chorus: Progression;
  form: SongForm;
  ending: "auto" | "lift" | "fade";
}

const STORE_KEY = "infinite-synthpop:wizard:v1";

function defaults(): WizardChoices {
  return {
    title: "",
    style: 0.5,
    tonic: 2,
    bpm: null,
    kit: "auto",
    bassStyle: "auto",
    verse: BANK.verse[0]?.bars ?? [["i"], ["VI"], ["VII"], ["v"]],
    chorus: BANK.chorus[0]?.bars ?? [["i"], ["III"], ["VII"], ["IV"]],
    form: "standard",
    ending: "auto",
  };
}

function load(): WizardChoices {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...defaults(), ...(JSON.parse(raw) as Partial<WizardChoices>) } : defaults();
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
    style: c.style,
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

    const style = el("input");
    style.type = "range";
    style.min = "0";
    style.max = "1";
    style.step = "0.05";
    style.value = String(c.style);
    const styleOut = el("output");
    styleOut.value = styleName(c.style);
    style.addEventListener("input", () => {
      choices.style = Number(style.value);
      styleOut.value = styleName(choices.style);
    });
    // Re-rank the presets for the new style.
    style.addEventListener("change", render);

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
    bpm.title = "Leave empty for 115–120 BPM (both originals: 117.45)";
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
      [
        ["auto", "Auto (by style)"],
        ["tf", "True Faith"],
        ["ds", "The Different Story"],
      ],
      c.bassStyle,
      (v) => (choices.bassStyle = v === "tf" || v === "ds" ? v : "auto"),
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
      ],
      c.ending,
      (v) => (choices.ending = v === "lift" || v === "fade" ? v : "auto"),
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

    form.append(
      heading,
      title,
      field("Style", style, styleOut),
      row(field("Key", tonic), field("Tempo", bpm), field("Drums", kit), field("Bass", bass)),
      progressionPicker("Verse chords", "verse", key),
      progressionPicker("Chorus chords", "chorus", key),
      row(field("Length", formPick), field("Ending", ending)),
      actions,
    );
    dialog.replaceChildren(form);
  }

  /** A preset select (ranked by closeness to the style) over editable per-bar chord pickers. */
  function progressionPicker(label: string, kind: "verse" | "chorus", key: Key): HTMLElement {
    const current = choices[kind];
    const presets = [...BANK[kind]].sort(
      (a, b) => Math.abs(a.style - choices.style) - Math.abs(b.style - choices.style),
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

function styleName(v: number): string {
  if (v < 0.2) return "True Faith";
  if (v > 0.8) return "The Different Story";
  return v < 0.45 ? "leaning True Faith" : v > 0.55 ? "leaning The Different Story" : "half & half";
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
