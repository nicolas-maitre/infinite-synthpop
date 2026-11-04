/**
 * Creator mode, built into the player. The section timeline selects (click), reorders (drag and
 * drop) and adds (the + at its end) sections; the current chords display edits the selected
 * section's chords bar by bar; its other parameters and the song settings appear under the piano
 * roll. Every edit goes to the engine as a new spec (spec.ts) and plays from the next bar.
 */
import type { Layers, MelodyKind, SectionKind, Song } from "./composer";
import { KIT_LABELS } from "./drums";
import {
  blankSpec,
  CHORD_CHOICES,
  DRUM_MODES,
  KITS,
  SECTION_INSTRUMENTS,
  SECTION_KINDS,
  type Creation,
  type SectionSpec,
  type SongSpec,
} from "./spec";
import { chord, chordName, keyName } from "./theory";

export interface CreatorHost {
  song(): Song;
  creation(): Creation | null;
  /** Starts a creation; `keepPosition` keeps playing from the current bar. */
  play(creation: Creation, keepPosition: boolean): void;
  edit(spec: SongSpec): void;
  /** Shows a section: jumps there (and loops it when looping is on). */
  select(sectionIndex: number): void;
  saved(): Creation | null;
  /** Copies the song's link; resolves false if the clipboard isn't available. */
  copyLink(): Promise<boolean>;
}

export interface Creator {
  readonly active: boolean;
  setActive(on: boolean): void;
  /** After the timeline is built: makes its sections draggable and adds the + button. */
  decorateTimeline(timeline: HTMLElement): void;
  /** Shows section `index`: its chords in the progression list, its settings in the panel. */
  show(index: number, currentBar: number): void;
}

const INSTRUMENT_LABELS: Record<(typeof SECTION_INSTRUMENTS)[number], string> = {
  bass: "Seq bass",
  seq: "Sequence",
  guitar: "Guitar",
  hook: "Melodic bass",
  pad: "Pad",
  riff: "Riff",
  arp: "Arp",
  stabs: "Stabs",
};
const DRUM_LABELS: Record<string, string> = {
  off: "No drums",
  kick: "Kick only",
  half: "Half-time",
  full: "Full",
  big: "Big (chorus)",
  groove: "Intro groove",
};
const ADD_KINDS: readonly SectionKind[] = [
  "verse",
  "chorus",
  "intro",
  "interlude",
  "bridge",
  "turnaround",
  "break",
  "outro",
];

export function mountCreator(
  chords: HTMLOListElement,
  panel: HTMLElement,
  host: CreatorHost,
): Creator {
  let active = false;
  /** What's on screen, so repeated bar updates don't rebuild (and close) open pickers. */
  let shownSong: Song | null = null;
  let shownIndex = -1;
  let chordCells: HTMLElement[] = [];

  const spec = () => host.creation()?.spec ?? null;
  /** Copies the spec, applies `change` to the copy, sends it to the engine. */
  const update = (change: (s: SongSpec) => void) => {
    const current = spec();
    if (!current) return;
    const next = structuredClone(current);
    change(next);
    host.edit(next);
  };

  function show(index: number, currentBar: number): void {
    const song = host.song();
    const s = spec();
    if (!active || !s) return;
    if (song !== shownSong || index !== shownIndex) {
      shownSong = song;
      shownIndex = index;
      renderChords(s, index);
      renderPanel(s, index);
    }
    const section = song.sections[index];
    if (section) {
      const bar = (currentBar - section.startBar) % section.progression.length;
      chordCells.forEach((cell, i) => cell.classList.toggle("active", i === bar));
    }
  }

  // ── Chords: the current chords display becomes one picker per bar ──────────────────────────

  function renderChords(s: SongSpec, index: number): void {
    const section = s.sections[index];
    if (!section) return;
    const key = section.key ?? s.key;
    const choices = CHORD_CHOICES[key.mode];
    const options = (allowNone: boolean): [string, string][] => [
      ...(allowNone ? ([["", "+ half"]] as [string, string][]) : []),
      ...choices.map((n): [string, string] => [n, `${chordName(key, chord(n))} · ${n}`]),
    ];
    chordCells = section.progression.map((bar, b) => {
      const li = el("li", "chord-edit");
      const first = select(options(false), bar[0] ?? "i", (v) =>
        update((n) => {
          const t = at(n, index);
          t.progression = t.progression.map((x, j) => (j === b ? [v, ...x.slice(1)] : x));
        }),
      );
      first.setAttribute("aria-label", `Bar ${b + 1} chord`);
      const second = select(options(true), bar[1] ?? "", (v) =>
        update((n) => {
          const t = at(n, index);
          t.progression = t.progression.map((x, j) =>
            j !== b ? x : v ? [x[0] ?? "i", v] : [x[0] ?? "i"],
          );
        }),
      );
      second.setAttribute("aria-label", `Bar ${b + 1}: second chord for the bar's second half`);
      second.title = "Split the bar: a second chord for its second half";
      li.append(first, second);
      return li;
    });
    const tools = el("li", "chord-tools");
    const add = button("+", () =>
      update((n) => {
        const t = at(n, index);
        if (t.progression.length < 16)
          t.progression = [...t.progression, [...(t.progression.at(-1) ?? ["i"])]];
      }),
    );
    add.title = "Add a bar to the chord pattern";
    const remove = button("−", () =>
      update((n) => {
        const t = at(n, index);
        if (t.progression.length > 1) t.progression = t.progression.slice(0, -1);
      }),
    );
    remove.title = "Remove the pattern's last bar";
    remove.disabled = section.progression.length === 1;
    tools.append(add, remove);
    chords.classList.add("editing");
    chords.replaceChildren(...chordCells, tools);
  }

  // ── The selected section's settings, then the song's ────────────────────────────────────────

  function renderPanel(s: SongSpec, index: number): void {
    const section = s.sections[index];
    panel.hidden = !section;
    if (!section) return;
    const L = section.layers;

    const name = input("text", section.label, (v) =>
      update((n) => (at(n, index).label = v.trim() || "Section")),
    );
    name.className = "section-name-input";
    name.setAttribute("aria-label", "Section name");
    const kind = select(
      SECTION_KINDS.map((k) => [k, k]),
      section.kind,
      (v) => update((n) => (at(n, index).kind = SECTION_KINDS.find((k) => k === v) ?? "verse")),
    );
    kind.setAttribute("aria-label", "Section type");
    const bars = input("number", String(section.bars), (v) =>
      update((n) => (at(n, index).bars = Math.min(64, Math.max(1, Math.round(Number(v)) || 1)))),
    );
    bars.min = "1";
    bars.max = "64";
    const sectionKey = select(
      [
        ["song", `Song key (${keyName(s.key)})`],
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap((t) =>
          (["minor", "major"] as const).map((m): [string, string] => [
            `${t}:${m}`,
            keyName({ tonic: t, mode: m }),
          ]),
        ),
      ],
      section.key ? `${section.key.tonic}:${section.key.mode}` : "song",
      (v) =>
        update((n) => {
          const t = at(n, index);
          if (v === "song") delete t.key;
          else {
            const [tonic, mode] = v.split(":");
            t.key = { tonic: Number(tonic), mode: mode === "major" ? "major" : "minor" };
          }
        }),
    );
    sectionKey.setAttribute("aria-label", "Section key");
    const dup = button("Duplicate", () => {
      update((n) => n.sections.splice(index + 1, 0, structuredClone(at(n, index))));
      host.select(index + 1);
    });
    const del = button("Delete", () => {
      update((n) => n.sections.splice(index, 1));
      host.select(Math.max(0, index - 1));
    });
    del.disabled = s.sections.length === 1;
    const head = row(
      "section-editor-head",
      name,
      kind,
      labelled("bars", bars),
      sectionKey,
      dup,
      del,
    );

    const drums = select(
      DRUM_MODES.map((m) => [m, DRUM_LABELS[m] ?? m]),
      L.drums ?? "off",
      (v) => update((n) => (at(n, index).layers.drums = DRUM_MODES.find((m) => m === v))),
    );
    const lead = select(
      [
        ["", "No lead"],
        ["verse", "Verse melody"],
        ["chorus", "Chorus melody"],
      ],
      L.lead ?? "",
      (v) =>
        update(
          (n) =>
            (at(n, index).layers.lead = v === "verse" || v === "chorus" ? (v as MelodyKind) : null),
        ),
    );
    const layer = (label: string, key: keyof Layers, on: boolean) =>
      toggle(label, on, (value) => update((n) => setLayer(at(n, index).layers, key, value)));
    const instruments = row(
      "section-editor-instruments",
      labelled("Drums", drums),
      ...SECTION_INSTRUMENTS.map((i) => layer(INSTRUMENT_LABELS[i], i, !!L[i])),
      labelled("Lead", lead),
      layer("Double lead", "leadDouble", !!L.leadDouble),
      layer("Staccato bass", "bassShort", !!L.bassShort),
      toggle("Fill at end", section.fill ?? defaultFill(s, index), (on) =>
        update((n) => (at(n, index).fill = on)),
      ),
    );

    panel.replaceChildren(head, instruments, songSettings(s));
  }

  function songSettings(s: SongSpec): HTMLElement {
    const box = el("details", "song-settings");
    const summary = el("summary");
    summary.textContent = `Song: ${s.title} · ${keyName(s.key)} · ${s.bpm} BPM`;
    const title = input("text", s.title, (v) => update((n) => (n.title = v.trim() || "Untitled")));
    title.setAttribute("aria-label", "Song title");
    const tonic = select(
      Array.from({ length: 12 }, (_, t) => [String(t), keyName({ tonic: t, mode: s.key.mode })]),
      String(s.key.tonic),
      (v) => update((n) => (n.key = { ...n.key, tonic: Number(v) })),
    );
    const mode = select(
      [
        ["minor", "minor"],
        ["major", "major"],
      ],
      s.key.mode,
      (v) => update((n) => (n.key = { ...n.key, mode: v === "major" ? "major" : "minor" })),
    );
    const bpm = input("number", String(s.bpm), (v) =>
      update((n) => (n.bpm = Math.min(160, Math.max(60, Number(v) || n.bpm)))),
    );
    bpm.min = "60";
    bpm.max = "160";
    bpm.step = "0.5";
    const kit = select(
      KITS.map((k) => [k, KIT_LABELS[k]]),
      s.kit,
      (v) => update((n) => (n.kit = KITS.find((k) => k === v) ?? n.kit)),
    );
    const bass = select(
      [
        ["tf", "True Faith"],
        ["ds", "The Different Story"],
      ],
      s.bassStyle,
      (v) => update((n) => (n.bassStyle = v === "ds" ? "ds" : "tf")),
    );
    const feel = input("range", String(s.style), (v) => update((n) => (n.style = Number(v))));
    feel.min = "0";
    feel.max = "1";
    feel.step = "0.05";
    feel.title = "Feel: True Faith ↔ The Different Story (hats, drum details)";

    const copy = button("Copy link", () => {
      void host.copyLink().then((ok) => {
        copy.textContent = ok ? "Link copied ✓" : "Copy the address bar";
        setTimeout(() => (copy.textContent = "Copy link"), 2000);
      });
    });
    const blank = button("New blank song", () => {
      if (confirm("Start a new blank song? Copy the link first to keep this one.")) {
        host.play({ seed: host.song().seed, spec: blankSpec() }, false);
        host.select(0);
      }
    });
    const actions: HTMLElement[] = [copy, blank];
    const saved = host.saved();
    if (saved && saved.spec.title !== s.title) {
      actions.push(
        button(`Resume “${saved.spec.title}”`, () => {
          host.play(saved, false);
          host.select(0);
        }),
      );
    }

    box.append(
      summary,
      row(
        "song-settings-row",
        labelled("Title", title),
        labelled("Key", tonic, mode),
        labelled("Tempo", bpm),
        labelled("Drums", kit),
        labelled("Bass figure", bass),
        labelled("Feel", feel),
      ),
      row("song-settings-row", ...actions),
    );
    return box;
  }

  // ── Timeline: drag to reorder, + to add ─────────────────────────────────────────────────────

  function decorateTimeline(timeline: HTMLElement): void {
    if (!active || !spec()) return;
    const blocks = [...timeline.querySelectorAll<HTMLElement>(".sec")];
    let from = -1;
    const clearMarks = () =>
      blocks.forEach((b) => b.classList.remove("drop-before", "drop-after", "dragging"));
    blocks.forEach((block, i) => {
      block.draggable = true;
      block.addEventListener("dragstart", (e) => {
        from = i;
        block.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      block.addEventListener("dragend", clearMarks);
      block.addEventListener("dragover", (e) => {
        if (from < 0) return;
        e.preventDefault();
        const after = isAfter(e, block);
        blocks.forEach((b) => b.classList.remove("drop-before", "drop-after"));
        block.classList.add(after ? "drop-after" : "drop-before");
      });
      block.addEventListener("drop", (e) => {
        e.preventDefault();
        const after = isAfter(e, block);
        clearMarks();
        if (from < 0) return;
        let to = i + (after ? 1 : 0);
        if (from < to) to--;
        const moved = from;
        from = -1;
        if (to === moved) return;
        update((n) => {
          const [item] = n.sections.splice(moved, 1);
          if (item) n.sections.splice(to, 0, item);
        });
        host.select(to);
      });
    });

    const add = el("div", "sec-add");
    const plus = button("+", () => menu.toggleAttribute("hidden"));
    plus.title = "Add a section at the end";
    plus.setAttribute("aria-label", "Add a section");
    const menu = el("div", "sec-add-menu");
    menu.hidden = true;
    for (const kind of ADD_KINDS) {
      menu.append(
        button(kind, () => {
          menu.hidden = true;
          const s = spec();
          if (!s) return;
          update((n) => n.sections.push(newSection(kind, n)));
          host.select(s.sections.length);
        }),
      );
    }
    add.append(plus, menu);
    timeline.append(add);
  }

  return {
    get active() {
      return active;
    },
    setActive(on: boolean) {
      active = on;
      shownSong = null;
      shownIndex = -1;
      if (!on) {
        panel.hidden = true;
        panel.replaceChildren();
        chords.classList.remove("editing");
      }
    },
    decorateTimeline,
    show,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Whether the pointer is over the right half of a timeline block. */
function isAfter(e: MouseEvent, block: HTMLElement): boolean {
  const r = block.getBoundingClientRect();
  return e.clientX > r.left + r.width / 2;
}

function at(spec: SongSpec, index: number): SectionSpec {
  const s = spec.sections[index];
  if (!s) throw new Error(`No section ${index}`);
  return s;
}

function setLayer(layers: Partial<Layers>, key: keyof Layers, on: boolean): void {
  (layers as Record<string, unknown>)[key] = on;
}

/** Whether a section gets a fill when the spec doesn't say: before a verse or chorus. */
function defaultFill(spec: SongSpec, index: number): boolean {
  const next = spec.sections[index + 1];
  return !!next && (next.kind === "verse" || next.kind === "chorus");
}

/** A new section: a copy of the last one of its kind, or a sensible default. */
function newSection(kind: SectionKind, spec: SongSpec): SectionSpec {
  const like = [...spec.sections].reverse().find((s) => s.kind === kind);
  const count = spec.sections.filter((s) => s.kind === kind).length;
  const name = `${kind[0]?.toUpperCase()}${kind.slice(1)}`;
  if (like) return { ...structuredClone(like), label: `${name} ${count + 1}`, fill: undefined };
  const layers: Partial<Layers> = {
    drums: kind === "chorus" ? "big" : kind === "break" ? "off" : "full",
    bass: kind !== "break",
    pad: true,
  };
  if (kind === "verse" || kind === "chorus") layers.lead = kind;
  if (kind === "bridge") layers.hook = true;
  return {
    kind,
    label: name,
    bars: kind === "break" || kind === "turnaround" ? 2 : 8,
    progression: (kind === "verse" ? spec.verse : spec.chorus).map((b) => [...b]),
    layers,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function row(cls: string, ...children: HTMLElement[]): HTMLElement {
  const r = el("div", cls);
  r.append(...children);
  return r;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "btn small");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function toggle(text: string, on: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = el("button", "btn small layer-toggle");
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => onChange(b.getAttribute("aria-pressed") !== "true"));
  return b;
}

function input(type: string, value: string, onChange: (v: string) => void): HTMLInputElement {
  const i = el("input");
  i.type = type;
  i.value = value;
  i.addEventListener("change", () => onChange(i.value));
  return i;
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

function labelled(text: string, ...controls: HTMLElement[]): HTMLElement {
  const l = el("label", "editor-field");
  const span = el("span");
  span.textContent = text;
  l.append(span, ...controls);
  return l;
}
